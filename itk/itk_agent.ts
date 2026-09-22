import express from 'express';
import {
  Message,
  AgentCard,
  AGENT_CARD_PATH,
  TaskState,
  Role,
  TaskPushNotificationConfig,
  Task,
} from '../src/index.js';
import { StreamResponse, SubscribeToTaskRequest, CancelTaskRequest } from '../src/types/pb/a2a.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
  RequestContext,
  ExecutionEventBus,
  AgentEvent,
} from '../src/server/index.js';
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
  restHandler,
} from '../src/server/express/index.js';
import { Instruction, CallAgent } from './pb/instruction.js';
import { behaviorFor, run as runActsBehavior } from './acts_behaviors.js';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '../src/client/index.js';
import { GrpcTransportFactory } from '../src/client/transports/grpc/grpc_transport.js';
import process from 'process';
import * as grpc from '@grpc/grpc-js';
import {
  grpcService,
  A2AService,
  UserBuilder as GrpcUserBuilder,
} from '../src/server/grpc/index.js';
import { legacyGrpcService, LegacyA2AService } from '../src/compat/v0_3/server/grpc/index.js';

/**
 * How long the agent holds a task in `WORKING` state after emitting the
 * `task-finished` marker (when an instruction sets `return_response.hold_task`).
 *
 * Matches the v0.3 baselines' behavior (go_v10, python_v03, go_v03 all use
 * a 2s tick × 5 iterations = ~10s window): long enough for a resubscribing
 * client to disconnect, re-fetch the task, observe the marker in its history,
 * cancel it, and tear down cleanly, but short enough to bound resource leaks
 * if the client crashes mid-flow.
 */
const HOLD_TASK_TICK_MS = 2000;
const HOLD_TASK_TICK_COUNT = 5;

export class ItkAgentExecutor implements AgentExecutor {
  // Map of taskId → cancel signal (AbortController) so a `tasks/cancel`
  // call mid-hold can immediately tear down the holding loop instead of
  // waiting out the full timeout window.
  private holdCancellers = new Map<string, AbortController>();

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`Executing task ${context.taskId}`);

    // Dual mode. An ACTS conformance test names a `tck-*` behaviour in its
    // first user message (ACTS §11); anything else is an ITK traversal
    // carrying a protobuf Instruction. The branch is taken before any task is
    // published, because one ACTS behaviour must answer with a bare Message
    // and so must not open a task at all.
    const actsBehavior = behaviorFor(context);
    if (actsBehavior) {
      await runActsBehavior(actsBehavior, context, eventBus);
      return;
    }

    // Publish initial task to satisfy ResultManager
    eventBus.publish(
      AgentEvent.task({
        id: context.taskId,
        contextId: context.contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        artifacts: [],
        history: [context.userMessage],
        metadata: {},
      })
    );

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId: context.taskId,
        contextId: context.contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      })
    );

    const message = context.userMessage;
    const instruction = this.extractInstruction(message);
    if (!instruction) {
      const errorMsg = 'No valid instruction found in request';
      console.error(errorMsg);
      this.publishStatus(eventBus, context, TaskState.TASK_STATE_FAILED, errorMsg);
      return;
    }

    try {
      console.log('Instruction:', JSON.stringify(Instruction.toJSON(instruction)));
      const results = await this.handleInstruction(instruction);
      const responseText = results.join('\n');
      console.log('Response:', responseText);

      if (this.shouldHold(instruction)) {
        // The instruction (or one of its nested return_response steps)
        // requested that the task remain in WORKING state. Emit the
        // response + `task-finished` marker as a working-state status
        // message — resubscribing clients use the marker as their
        // signal to stop draining the event stream — and then keep the
        // task alive for up to HOLD_TASK_TICK_COUNT * HOLD_TASK_TICK_MS
        // by emitting periodic working-state heartbeats. This matches
        // the hold-loop in the v0.3 reference baselines (a2a-go v0.3
        // `main.go:60-91`, a2a-python v0.3 `main.py:445-471`).
        console.log(`[ItkAgent] Holding task ${context.taskId} (will emit task-finished marker)`);
        const cancelled = await this.holdTask(eventBus, context, responseText + '\ntask-finished');
        console.log(`Task ${context.taskId} hold loop completed (cancelled=${cancelled})`);
        // If the hold loop reached its natural end (no cancel),
        // auto-complete the task so the executor reaches a terminal
        // state and the event bus closes cleanly. If the loop exited
        // because of a cancel, `cancelTask` already published
        // TASK_STATE_CANCELED — emitting COMPLETED on top would be a
        // stream-pattern violation.
        if (!cancelled) {
          this.publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, responseText);
        }
      } else {
        this.publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, responseText);
        console.log(`Task ${context.taskId} completed`);
      }
    } catch (error) {
      console.error('Error handling instruction:', error);
      this.publishStatus(eventBus, context, TaskState.TASK_STATE_FAILED, String(error));
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`Cancel requested for task ${taskId}`);
    // Short-circuit any in-progress hold loop so the caller doesn't have
    // to wait for the timeout window to expire after cancelling.
    const canceller = this.holdCancellers.get(taskId);
    if (canceller) {
      canceller.abort();
      this.holdCancellers.delete(taskId);
    }
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: '',
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      })
    );
  }

  /**
   * Recursively checks whether any nested `return_response` in the
   * instruction tree requests `hold_task`. Mirrors `shouldHold(inst)` in
   * the v0.3 reference baselines.
   */
  private shouldHold(inst: Instruction): boolean {
    if (!inst.step) return false;
    if (inst.step.$case === 'returnResponse') {
      return inst.step.value.holdTask === true;
    }
    if (inst.step.$case === 'steps') {
      return inst.step.value.instructions.some((s) => this.shouldHold(s));
    }
    return false;
  }

  /**
   * Emits the `task-finished`-bearing message as a working-state status
   * message and then sends periodic working-state heartbeats for up to
   * HOLD_TASK_TICK_COUNT * HOLD_TASK_TICK_MS. Resolves early if the
   * task is cancelled (via {@link cancelTask}) — the AbortController
   * stored in `holdCancellers` is signalled by `cancelTask` so the
   * timer loop exits without waiting for the next tick.
   */
  private async holdTask(
    eventBus: ExecutionEventBus,
    context: RequestContext,
    finishedText: string
  ): Promise<boolean> {
    const canceller = new AbortController();
    this.holdCancellers.set(context.taskId, canceller);
    try {
      const finishedMessage: Message = {
        messageId: 'task-finished',
        contextId: context.contextId,
        taskId: context.taskId,
        role: Role.ROLE_AGENT,
        parts: [
          {
            content: { $case: 'text', value: finishedText },
            mediaType: 'text/plain',
            filename: '',
            metadata: {},
          },
        ],
        extensions: [],
        referenceTaskIds: [],
        metadata: {},
      };
      // First working-state event carries the response + task-finished
      // marker — this is what resubscribing clients drain for.
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId: context.taskId,
          contextId: context.contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: finishedMessage,
            timestamp: new Date().toISOString(),
          },
          metadata: undefined,
        })
      );

      for (let i = 0; i < HOLD_TASK_TICK_COUNT; i++) {
        try {
          await this.sleep(HOLD_TASK_TICK_MS, canceller.signal);
        } catch (e) {
          if (canceller.signal.aborted) {
            console.log(`[ItkAgent] Hold loop for ${context.taskId} aborted by cancel`);
            return true;
          }
          throw e;
        }
        // Heartbeat — empty working-state update, no message body,
        // matches what the v0.3 baselines emit on every tick.
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId: context.taskId,
            contextId: context.contextId,
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: new Date().toISOString(),
            },
            metadata: undefined,
          })
        );
      }
      return false;
    } finally {
      this.holdCancellers.delete(context.taskId);
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private publishStatus(
    eventBus: ExecutionEventBus,
    context: RequestContext,
    state: TaskState,
    text: string
  ): void {
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId: context.taskId,
        contextId: context.contextId,
        status: {
          state,
          message: {
            messageId: state === TaskState.TASK_STATE_COMPLETED ? 'done' : 'fail',
            parts: [
              {
                content: { $case: 'text', value: text },
                mediaType: 'text/plain',
                filename: '',
                metadata: {},
              },
            ],
            role: Role.ROLE_AGENT,
            metadata: {},
            contextId: context.contextId,
            taskId: context.taskId,
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      })
    );
  }

  private extractInstruction(message: Message): Instruction | null {
    console.log('[ITK Agent] Extracting instruction from message:', JSON.stringify(message));
    if (!message || !message.parts) return null;

    for (const part of message.parts) {
      // 1. Handle binary protobuf part
      if (part.mediaType === 'application/x-protobuf' || part.filename === 'instruction.bin') {
        if (part.content?.$case === 'raw') {
          try {
            return Instruction.decode(part.content.value);
          } catch (e) {
            console.debug('Failed to parse instruction from binary part', e);
          }
        } else if (part.content?.$case === 'text') {
          try {
            return Instruction.decode(Buffer.from(part.content.value, 'base64'));
          } catch (e) {
            console.debug('Failed to parse instruction from text part as base64', e);
          }
        }
      }

      // 2. Handle base64 encoded instruction in any text part
      if (part.content?.$case === 'text') {
        try {
          return Instruction.decode(Buffer.from(part.content.value, 'base64'));
        } catch (e) {
          console.debug('Failed to parse instruction from text part', e);
        }
      }
    }
    return null;
  }

  private async handleInstruction(inst: Instruction): Promise<string[]> {
    if (!inst.step) throw new Error('Unknown instruction type');

    switch (inst.step.$case) {
      case 'returnResponse':
        return [inst.step.value.response];
      case 'callAgent':
        return await this.handleCallAgent(inst.step.value);
      case 'steps': {
        const allResults: string[] = [];
        for (const step of inst.step.value.instructions) {
          const results = await this.handleInstruction(step);
          allResults.push(...results);
        }
        return allResults;
      }
      default:
        throw new Error('Unknown instruction type');
    }
  }

  private async handleCallAgent(call: CallAgent): Promise<string[]> {
    console.log(`Calling agent ${call.agentCardUri} via ${call.transport}`);

    const transportMap: Record<string, string> = {
      JSONRPC: 'JSONRPC',
      'HTTP+JSON': 'HTTP+JSON',
      HTTP_JSON: 'HTTP+JSON',
      REST: 'HTTP+JSON',
      GRPC: 'GRPC',
    };

    const selectedTransport = transportMap[call.transport.toUpperCase()];
    if (!selectedTransport) {
      throw new Error(`Unsupported transport: ${call.transport}`);
    }

    // Enable the v0.3 compat layer on every transport factory and on the
    // agent-card resolver so we can dial both v1.0 and v0.3 baseline agents
    // transparently. The factory dispatches between the v1.0 transport and
    // the v0.3 LegacyTransport based on the matched
    // `AgentInterface.protocolVersion` of the resolved card.
    const legacyCompat = { enabled: true };
    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [
          new JsonRpcTransportFactory({ legacyCompat }),
          new RestTransportFactory({ legacyCompat }),
          new GrpcTransportFactory({ legacyCompat }),
        ],
        preferredTransports: [selectedTransport as 'JSONRPC' | 'HTTP+JSON' | 'GRPC'],
        cardResolver: new DefaultAgentCardResolver({ legacyCompat }),
      })
    );

    // Build push notification config if the instruction specifies push_notification behavior
    let pushNotificationConfig: TaskPushNotificationConfig | undefined;
    if (call.behavior?.$case === 'pushNotification') {
      let url = call.behavior.value.url;
      if (!url) {
        throw new Error('URL not specified in push_notification behavior');
      }
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `http://${url}`;
      }
      pushNotificationConfig = {
        url: `${url}/notifications`,
        token: 'itk-token',
        id: '',
        taskId: '',
        tenant: '',
        authentication: undefined,
      };
    }

    try {
      // Ensure trailing slash so URL resolution correctly appends the agent card path
      // e.g. http://host:port/jsonrpc/ + .well-known/agent-card.json = http://host:port/jsonrpc/.well-known/agent-card.json
      const baseUri = call.agentCardUri.endsWith('/') ? call.agentCardUri : call.agentCardUri + '/';
      const client = await factory.createFromUrl(baseUri);
      console.log('[ItkAgent] Created client for', call.agentCardUri);

      if (!call.instruction) {
        throw new Error('Instruction missing in callAgent step');
      }
      const instBytes = Buffer.from(Instruction.encode(call.instruction).finish());
      const nestedMsg: Message = {
        messageId: Math.random().toString(36).substring(2),
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'raw', value: instBytes },
            filename: 'instruction.bin',
            mediaType: 'application/x-protobuf',
            metadata: {},
          },
        ],
        extensions: [],
        referenceTaskIds: [],
        metadata: {},
      };

      const results: string[] = [];

      const processMessage = (msg: Message | undefined) => {
        if (!msg?.parts) return;
        for (const part of msg.parts) {
          if (part.content?.$case === 'text' && part.content.value) {
            results.push(part.content.value);
          }
        }
      };

      const request = {
        tenant: '',
        message: nestedMsg,
        configuration: pushNotificationConfig
          ? {
              acceptedOutputModes: [],
              taskPushNotificationConfig: pushNotificationConfig,
              returnImmediately: false,
            }
          : undefined,
        metadata: {},
      };

      if (call.behavior?.$case === 'resubscribe') {
        // Resubscribe behavior:
        //   1. Open a streaming `send_message`, drain it just far enough
        //      to learn the remote task_id (first event with one), then
        //      tear down that stream.
        //   2. Open a `tasks/resubscribe` stream against the same task,
        //      consume events until any message carries the
        //      `task-finished` sentinel produced by the peer's
        //      `hold_task` loop.
        //   3. Issue `tasks/cancel` so the held task on the peer can
        //      release its hold loop without waiting out the full
        //      timeout window.
        //
        // Matches the v0.3 baselines' resubscribe flow (a2a-python v0.3
        // `_handle_call_agent_with_resubscribe`, a2a-go v0.3 / v1.0
        // `handleCallAgentWithResubscribe`).
        const resubscribeResults = await this.callAgentWithResubscribe(client, request, (text) =>
          results.push(text)
        );
        results.length = 0;
        results.push(...resubscribeResults);
      } else if (call.streaming) {
        for await (const event of client.sendMessageStream(request)) {
          console.log('Stream event:', JSON.stringify(event));
          const msg = this.extractMessageFromStreamResponse(event);
          processMessage(msg);
        }
      } else {
        const response = await client.sendMessage(request);
        console.log('Response:', JSON.stringify(response));

        // Response can be Message or Task
        if ('parts' in response) {
          processMessage(response as Message);
        } else if ('status' in response) {
          const task = response as Task;
          processMessage(task.status?.message);
          task.history?.forEach(processMessage);
        }
      }

      return results;
    } catch (e) {
      console.error('Failed to call outbound agent', e);
      throw new Error(`Outbound call to ${call.agentCardUri} failed: ${e}`);
    }
  }

  /**
   * Implements the resubscribe behavior: send-disconnect-resubscribe-
   * cancel. Returns the collected text responses (with the
   * `task-finished` sentinel stripped — it's a control marker, not part
   * of the agent's response).
   */
  private async callAgentWithResubscribe(
    client: Awaited<ReturnType<ClientFactory['createFromUrl']>>,
    request: Parameters<Awaited<ReturnType<ClientFactory['createFromUrl']>>['sendMessage']>[0],
    _onText: (text: string) => void
  ): Promise<string[]> {
    // 1. Initial streaming send — keep going only until we learn the
    //    task_id, then close the stream. We use an AbortController so
    //    the SDK promptly cancels the upstream HTTP/SSE connection
    //    instead of waiting out the buffer.
    const initController = new AbortController();
    let taskId: string | undefined;
    try {
      for await (const event of client.sendMessageStream(request, {
        signal: initController.signal,
      })) {
        console.log('[ItkAgent] Resubscribe init event:', JSON.stringify(event));
        taskId = this.extractTaskIdFromStreamResponse(event);
        if (taskId) break;
      }
    } catch (e) {
      // AbortError is expected when we tear down after picking up the
      // task_id; anything else is a real failure on the init leg.
      if (!initController.signal.aborted) {
        throw e;
      }
    } finally {
      initController.abort();
    }

    if (!taskId) {
      throw new Error('Resubscribe: initial send_message did not yield a task_id');
    }
    console.log(`[ItkAgent] Disconnected from task ${taskId}, now re-subscribing`);

    // 2. Resubscribe and drain until we see the `task-finished`
    //    sentinel.
    const responses: string[] = [];
    let finished = false;

    const collect = (msg: Message | undefined): boolean => {
      if (!msg?.parts) return false;
      for (const part of msg.parts) {
        if (part.content?.$case === 'text' && part.content.value) {
          const text = part.content.value.replace(/task-finished/g, '').trim();
          if (text) responses.push(text);
          if (part.content.value.includes('task-finished')) {
            return true;
          }
        }
      }
      return false;
    };

    const resubRequest: SubscribeToTaskRequest = { tenant: '', id: taskId };
    for await (const event of client.resubscribeTask(resubRequest)) {
      console.log('[ItkAgent] Resubscribe event:', JSON.stringify(event));
      if (!event.payload) continue;
      // A resubscribe response can deliver the full `Task` first (with
      // its history) plus subsequent status-updates; drain the history
      // *and* the live event in case the marker landed before we
      // reconnected.
      if (event.payload.$case === 'task') {
        const task = event.payload.value;
        for (const histMsg of task.history ?? []) {
          if (histMsg.role === Role.ROLE_AGENT && collect(histMsg)) {
            finished = true;
            break;
          }
        }
        if (!finished && collect(task.status?.message)) finished = true;
      } else if (event.payload.$case === 'statusUpdate') {
        if (collect(event.payload.value.status?.message)) finished = true;
      } else if (event.payload.$case === 'message') {
        if (collect(event.payload.value)) finished = true;
      }
      if (finished) break;
    }

    // 3. Best-effort cancel so the peer's hold-task loop tears down
    //    immediately instead of waiting out its timeout window.
    try {
      console.log(`[ItkAgent] Canceling task ${taskId} after resubscribe drain`);
      const cancelReq: CancelTaskRequest = { tenant: '', id: taskId, metadata: undefined };
      await client.cancelTask(cancelReq);
    } catch (e) {
      // The hold loop may auto-complete before our cancel arrives; the
      // resubscribe test only cares about the collected responses, so
      // a failed cancel doesn't fail the call.
      console.warn(`[ItkAgent] Cancel after resubscribe failed (non-fatal):`, e);
    }

    return responses;
  }

  private extractTaskIdFromStreamResponse(event: StreamResponse): string | undefined {
    if (!event.payload) return undefined;
    switch (event.payload.$case) {
      case 'task':
        return event.payload.value.id || undefined;
      case 'statusUpdate':
        return event.payload.value.taskId || undefined;
      case 'artifactUpdate':
        return event.payload.value.taskId || undefined;
      default:
        return undefined;
    }
  }

  private extractMessageFromStreamResponse(event: StreamResponse): Message | undefined {
    if (!event.payload) return undefined;
    switch (event.payload.$case) {
      case 'message':
        return event.payload.value;
      case 'statusUpdate':
        return event.payload.value.status?.message;
      case 'task':
        return event.payload.value.status?.message;
      default:
        return undefined;
    }
  }
}

/**
 * What the card advertises — everything, unless the ACTS runner asked for less.
 *
 * Four ACTS tests assert that an agent *without* a capability answers
 * UnsupportedOperationError, so their preconditions require the card not to
 * advertise it and they can never run against a fully capable agent. The
 * runner starts a second SUT with this variable set to reach them.
 *
 * `DefaultRequestHandler` gates push notifications, the extended card and
 * resubscription on this block, and the JSON-RPC transport handler gates
 * `sendMessageStream`, so publishing less is all it takes to refuse them.
 */
function actsCapabilities(): AgentCard['capabilities'] {
  if (reducedCapabilities()) {
    return {
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    };
  }
  return {
    streaming: true,
    pushNotifications: true,
    extensions: [],
    extendedAgentCard: true,
  };
}

function reducedCapabilities(): boolean {
  return Boolean(process.env.ITK_ACTS_REDUCED_CAPABILITIES);
}

/**
 * Credentials the ACTS runner presents. Not secrets: the runner attaches the
 * valid one to every abstract operation and offers the insufficient one from
 * `SEC-EXTCARD-002` and `SEC-AUTH-002`, so a fixture has to recognise both to
 * answer 200 / 403 / 401 as those tests require.
 */
const ACTS_VALID_TOKEN = 'itk-valid-token';
const ACTS_INSUFFICIENT_TOKEN = 'itk-insufficient-token';
const ACTS_SECURITY_SCHEME = 'bearerAuth';

/**
 * Whether to require a credential on the ordinary operation endpoints.
 *
 * Off unless `ITK_ACTS_AUTH` is set, and nothing in the harness sets it. Two
 * reasons, and the second is the one that decides it:
 *
 *  - ITK traversal peers dial this agent with no credential at all, so
 *    enforcing during a traversal run would fail every scenario that calls us.
 *    An environment switch alone would handle that, since the two suites run
 *    as separate processes.
 *  - The ACTS runner attaches its credential to *abstract operations only*;
 *    `dispatch_raw` drops it, which is what keeps the unauthenticated
 *    `SEC-AUTH-001` / `SEC-EXTCARD-001` probes meaningful. But then every
 *    other raw step is unauthenticated too, and fifteen of them expect to
 *    succeed — `JSONRPC-ENV-001`, `DM-FMT-001`, `CORE-ERR-006`,
 *    `REST-STATUS-001` and the rest. An absent `Authorization` header means
 *    "reject me" in one test and "serve me" in the next, and no server can
 *    tell the two apart.
 *
 * Measured, with the switch on: **fourteen** raw steps fail on a 401 (twelve
 * over JSON-RPC, two over REST) and the five `SEC-AUTH-*` tests pass. The
 * fifteenth, `JSONRPC-CT-001`, passes either way — it asserts only that the
 * response content type is JSON, which a 401 error document also satisfies.
 *
 * What the switch buys is now real, where it used to be nothing: those five
 * tests gated on `capabilities.authentication`, a member `AgentCapabilities`
 * does not have, so they skipped against every agent whatever this flag said.
 * They gate on `preconditions.authentication` instead, read off the card's
 * `securitySchemes` and `securityRequirements` — which is why leaving the
 * default off keeps them skipping honestly ("not applicable to this agent")
 * rather than failing.
 *
 * The extended-card endpoint is *not* covered by this switch — see
 * {@link extendedCardGuard}.
 */
function authEnforced(): boolean {
  return Boolean(process.env.ITK_ACTS_AUTH);
}

/**
 * The schemes the card advertises. Declared only when the agent actually
 * enforces them: a card claiming a scheme it does not check would be a lie,
 * and it is what the `authentication` precondition of the `SEC-AUTH-*` tests
 * reads to decide whether they are applicable at all.
 */
function actsSecuritySchemes(): AgentCard['securitySchemes'] {
  if (!authEnforced()) return {};
  return {
    [ACTS_SECURITY_SCHEME]: {
      scheme: {
        $case: 'httpAuthSecurityScheme',
        value: {
          description: 'Bearer token presented by the ACTS runner.',
          scheme: 'Bearer',
          bearerFormat: 'opaque',
        },
      },
    },
  };
}

function actsSecurityRequirements(): AgentCard['securityRequirements'] {
  if (!authEnforced()) return [];
  return [{ schemes: { [ACTS_SECURITY_SCHEME]: { list: [] } } }];
}

/** A `google.rpc.Status` body, the shape A2A §11.6 requires of an error. */
function statusBody(code: number, status: string, message: string, reason: string) {
  return {
    error: {
      code,
      status,
      message,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason,
          domain: 'a2a-protocol.org',
        },
      ],
    },
  };
}

/**
 * Rejects a request that carries no usable credential.
 *
 * Three outcomes, because the tests distinguish them: the valid token passes,
 * the insufficient one authenticates but does not authorize (403), and
 * anything else — including nothing at all — fails authentication (401). The
 * `WWW-Authenticate` challenge is what §3.3.2 asks for on the 401.
 */
function requireCredential(): express.RequestHandler {
  return (req, res, next) => {
    const presented = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '')?.[1]?.trim();
    if (presented === ACTS_VALID_TOKEN) {
      next();
      return;
    }
    if (presented === ACTS_INSUFFICIENT_TOKEN) {
      res
        .status(403)
        .json(
          statusBody(
            403,
            'PERMISSION_DENIED',
            'Token lacks the required scope.',
            'PERMISSION_DENIED'
          )
        );
      return;
    }
    res
      .status(401)
      .set('WWW-Authenticate', `Bearer realm="a2a", scheme="${ACTS_SECURITY_SCHEME}"`)
      .json(statusBody(401, 'UNAUTHENTICATED', 'A bearer token is required.', 'UNAUTHENTICATED'));
  };
}

/**
 * Authentication for `GET /extendedAgentCard`, always on.
 *
 * Independent of {@link authEnforced} because it costs traversal nothing —
 * nothing in the traversal suite fetches an extended card — and because A2A
 * §13.3 makes it unconditional: the operation MUST require authentication.
 * Scoped to the REST route on purpose. An `ExtendedAgentCardProvider` on the
 * request handler would fire on every binding, and the JSON-RPC and gRPC
 * bindings carry the runner's credential on the abstract operation already,
 * so gating there would break `CARD-EXT-001` to no benefit.
 */
function extendedCardGuard(): express.RequestHandler {
  return requireCredential();
}

/**
 * The public agent card stays reachable without a credential.
 *
 * A2A §8.2 makes the well-known URL the discovery mechanism and §7.3 has the
 * client learn which schemes it needs *from that card*, so requiring one to
 * read it is circular. The ITK readiness probe also fetches it unauthenticated.
 */

async function main() {
  const args = process.argv.slice(2);
  let httpPort = 10102;
  let grpcPort = 11002;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--httpPort' && i + 1 < args.length) {
      httpPort = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith('--httpPort=')) {
      httpPort = parseInt(args[i].split('=')[1], 10);
    } else if (args[i] === '--grpcPort' && i + 1 < args.length) {
      grpcPort = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith('--grpcPort=')) {
      grpcPort = parseInt(args[i].split('=')[1], 10);
    }
  }

  console.log(`Starting ITK TS Agent on HTTP port ${httpPort} and gRPC port ${grpcPort}`);

  const agentCard: AgentCard = {
    name: 'ITK TS Agent',
    description: 'TypeScript agent using SDK for ITK tests.',
    version: '1.0.0',
    capabilities: actsCapabilities(),
    // Each binding declared twice — once at v1.0 and once at v0.3 — so
    // a v0.3 baseline peer (go_v03, python_v03) can dial every binding.
    // Strict per-interface advertisement: a binding is only reachable
    // at v0.3 if listed here with `protocolVersion: '0.3'`.
    supportedInterfaces: [
      {
        url: `http://127.0.0.1:${httpPort}/jsonrpc`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `http://127.0.0.1:${httpPort}/jsonrpc`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '0.3',
      },
      {
        url: `127.0.0.1:${grpcPort}`,
        protocolBinding: 'GRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `127.0.0.1:${grpcPort}`,
        protocolBinding: 'GRPC',
        tenant: '',
        protocolVersion: '0.3',
      },
      {
        url: `http://127.0.0.1:${httpPort}/rest`,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `http://127.0.0.1:${httpPort}/rest`,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '0.3',
      },
    ],
    provider: {
      organization: 'A2A Samples',
      url: 'https://example.com/a2a-samples',
    },
    securitySchemes: actsSecuritySchemes(),
    securityRequirements: actsSecurityRequirements(),
    defaultInputModes: ['text/plain', 'application/x-protobuf'],
    defaultOutputModes: ['text/plain'],
    // Declared so ACTS's card tests assert on something real. `CARD-DISC-004`
    // checks every skill has an id and a name, which an empty array satisfies
    // vacuously.
    skills: [
      {
        id: 'acts-behaviors',
        name: 'ACTS behaviours',
        description: 'Implements the ACTS §11 tck-* behaviour contract.',
        tags: ['acts', 'conformance'],
        examples: [],
        inputModes: [],
        outputModes: [],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };

  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new ItkAgentExecutor();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    agentExecutor,
    undefined,
    undefined,
    undefined,
    agentCard,
    undefined,
    { validateInputModes: true }
  );

  const app = express();

  const jsonRpcPath = '/jsonrpc';
  const restPath = '/rest';

  // Enable the v0.3 compat layer on every server handler so a v0.3 baseline
  // peer (go_v03, python_v03) can dial this agent. Dispatch is per-request:
  //  - Agent card: when the request omits `A2A-Version` (or sends a
  //    value in `[0.3, 1.0)`), `agentCardHandler` routes through the
  //    legacy router and emits a hybrid card — v0.3 top-level fields
  //    for v0.3 SDK parsers AND the embedded v1.0
  //    `supportedInterfaces[]` for v1.0 SDK parsers that didn't send
  //    the version header (e.g. baselines that only register v0.3
  //    compat for some transports). v1.0 SDKs that send
  //    `A2A-Version: 1.0` short-circuit through the legacy router and
  //    get the unmodified v1.0 card.
  //  - JSON-RPC: dispatched per-request by body `method` shape
  //    (`message/send` for v0.3 vs `SendMessage` for v1.0).
  //  - REST: dispatched per-request by the `A2A-Version` header (default
  //    '0.3' if absent).
  //  - gRPC: both `A2AService` (v1.0) and `LegacyA2AService` (v0.3) are
  //    bound to the same port; clients select by service descriptor.
  const legacyCompat = { enabled: true };

  // Mount the agent-card endpoint at the root path (in addition to
  // under `/jsonrpc/` and `/rest/`). The a2a-itk readiness check probes
  // `GET http://host:port/.well-known/agent-card.json` directly (see
  // `_check_agent_ready` in `a2a-itk/testlib.py`) — without the root
  // mount the orchestrator times out before any test scenario runs.
  // The per-binding mounts are kept so resolved cards continue to point
  // at their own well-known URL (e.g. callers that derive
  // `<jsonrpc-url>/.well-known/agent-card.json` still find it).
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler, legacyCompat })
  );
  app.use(
    `${jsonRpcPath}/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler, legacyCompat })
  );
  app.use(
    `${restPath}/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler, legacyCompat })
  );

  // Registered after the card mounts, so the public card stays reachable, and
  // before the transport handlers, so nothing reaches an operation without a
  // credential. The extended card is guarded whatever the mode.
  app.use(`${restPath}/extendedAgentCard`, extendedCardGuard());
  if (authEnforced()) {
    app.use(jsonRpcPath, requireCredential());
    app.use(restPath, requireCredential());
  }

  app.use(
    jsonRpcPath,
    jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication, legacyCompat })
  );
  app.use(
    restPath,
    restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication, legacyCompat })
  );

  app.listen(httpPort, () => {
    console.log(`[ItkAgent] Server started on http://localhost:${httpPort}`);
    console.log(
      `[ItkAgent] Agent Card: http://localhost:${httpPort}${jsonRpcPath}/${AGENT_CARD_PATH}`
    );
  });

  // Start gRPC server. Bind both the v1.0 A2AService and the v0.3
  // LegacyA2AService so a v0.3 baseline peer (go_v03, python_v03) can dial
  // this agent via gRPC. There is no shared flag on the gRPC side: the
  // operator picks per-service whether to register the legacy descriptor.
  const grpcServer = new grpc.Server();
  grpcServer.addService(
    A2AService,
    grpcService({
      requestHandler,
      userBuilder: GrpcUserBuilder.noAuthentication,
    })
  );
  grpcServer.addService(
    LegacyA2AService,
    legacyGrpcService({
      requestHandler,
      userBuilder: GrpcUserBuilder.noAuthentication,
    })
  );

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`Failed to bind gRPC server: ${err.message}`);
        return;
      }
      console.log(`gRPC server listening on port ${port}`);
    }
  );
}

main().catch(console.error);

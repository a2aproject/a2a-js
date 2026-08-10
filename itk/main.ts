/**
 * ITK TypeScript v0.3 baseline agent
 */
import express from 'express';
import * as grpc from '@grpc/grpc-js';
import process from 'process';
import { randomUUID } from 'crypto';

import {
  AGENT_CARD_PATH,
  type AgentCard,
  type Message,
  type MessageSendParams,
  type Part,
  type PushNotificationConfig,
  type Task,
  type TaskArtifactUpdateEvent,
  type TaskIdParams,
  type TaskStatusUpdateEvent,
} from '@a2a-js/sdk';

import {
  Client,
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '@a2a-js/sdk/client';
import { GrpcTransportFactory } from '@a2a-js/sdk/client/grpc';

import {
  type AgentExecutor,
  DefaultPushNotificationSender,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryPushNotificationStore,
  InMemoryTaskStore,
  RequestContext,
  type TaskStore,
} from '@a2a-js/sdk/server';

import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';

import {
  A2AService,
  grpcService,
  UserBuilder as GrpcUserBuilder,
} from '@a2a-js/sdk/server/grpc';

import { Instruction, CallAgent } from './pb/instruction.js';

const HOLD_TASK_TICK_MS = 2000;
const HOLD_TASK_TICK_COUNT = 5;

export class ItkV03AgentExecutor implements AgentExecutor {
  private holdCancellers = new Map<string, AbortController>();
  private pushStore?: InMemoryPushNotificationStore;

  constructor(pushStore?: InMemoryPushNotificationStore) {
    this.pushStore = pushStore;
  }

  execute = async (
    context: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> => {
    const { taskId, contextId, userMessage } = context;
    console.log(`[ItkV03] Executing task ${taskId}`);

    // 1) Register the task with the ResultManager so subsequent
    //    status-update events are routed correctly.
    eventBus.publish({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: userMessage ? [userMessage] : [],
    } as Task);

    // 2) Move to working state.
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      final: false,
    } as TaskStatusUpdateEvent);

    // 3) Extract Instruction.
    const inst = this.extractInstruction(userMessage);
    if (!inst) {
      this.publishFinal(
        eventBus,
        context,
        'failed',
        'Error: No valid Instruction found in request.'
      );
      eventBus.finished();
      return;
    }

    try {
      const results = await this.handleInstruction(inst, taskId);
      const response = results.join('\n');
      console.log(`[ItkV03] Response: ${response}`);

      if (this.shouldHold(inst)) {
        console.log(`[ItkV03] Holding task ${taskId}`);
        const cancelled = await this.holdTask(
          eventBus,
          context,
          response + '\ntask-finished'
        );
        if (!cancelled) {
          // Timeout: match python's 'failed' fallback (main.py:473).
          this.publishFinal(eventBus, context, 'failed', response);
        }
      } else {
        this.publishFinal(eventBus, context, 'completed', response);
      }
    } catch (e) {
      console.error('[ItkV03] Error handling instruction:', e);
      this.publishFinal(eventBus, context, 'failed', String(e));
    } finally {
      eventBus.finished();
    }
  };

  cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus
  ): Promise<void> => {
    console.log(`[ItkV03] Cancel requested for task ${taskId}`);
    this.holdCancellers.get(taskId)?.abort();
    this.holdCancellers.delete(taskId);
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId: '',
      status: { state: 'canceled', timestamp: new Date().toISOString() },
      final: true,
    } as TaskStatusUpdateEvent);
    eventBus.finished();
  };

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private extractInstruction(msg: Message): Instruction | null {
    if (!msg?.parts) return null;
    for (const part of msg.parts) {
      if (part.kind === 'file' && part.file && 'bytes' in part.file) {
        try {
          return Instruction.decode(Buffer.from(part.file.bytes, 'base64'));
        } catch (e) {
          console.debug('[ItkV03] file/bytes Instruction.decode failed:', e);
        }
      }
      // Rare fallback: base64-in-text-part.
      if (part.kind === 'text' && part.text) {
        try {
          return Instruction.decode(Buffer.from(part.text, 'base64'));
        } catch (e) {
          console.debug('[ItkV03] text/base64 Instruction.decode failed:', e);
        }
      }
    }
    return null;
  }

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

  private async handleInstruction(
    inst: Instruction,
    taskId: string
  ): Promise<string[]> {
    if (!inst.step) throw new Error('Unknown instruction type');
    switch (inst.step.$case) {
      case 'returnResponse':
        return [inst.step.value.response];
      case 'callAgent':
        return await this.handleCallAgent(inst.step.value, taskId);
      case 'steps': {
        const out: string[] = [];
        for (const step of inst.step.value.instructions) {
          out.push(...(await this.handleInstruction(step, taskId)));
        }
        return out;
      }
    }
  }

  private async handleCallAgent(
    call: CallAgent,
    taskId: string
  ): Promise<string[]> {
    console.log(
      `[ItkV03] Calling agent ${call.agentCardUri} via ${call.transport}`
    );

    const transportMap: Record<string, 'JSONRPC' | 'HTTP+JSON' | 'GRPC'> = {
      JSONRPC: 'JSONRPC',
      GRPC: 'GRPC',
      HTTP_JSON: 'HTTP+JSON',
      'HTTP+JSON': 'HTTP+JSON',
      REST: 'HTTP+JSON',
    };
    const selected = transportMap[call.transport.toUpperCase()];
    if (!selected) throw new Error(`Unsupported transport: ${call.transport}`);

    // Push notification config — v0.3 shape (no root taskId).
    let pnc: PushNotificationConfig | undefined;
    if (call.behavior?.$case === 'pushNotification') {
      let url = call.behavior.value?.url;
      if (!url) throw new Error('URL not specified in push_notification behavior');
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `http://${url}`;
      }
      pnc = { url: `${url}/notifications`, token: 'itk-token' };
      if (this.pushStore) {
        await this.pushStore.save(taskId, pnc);
      }
    }

    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [
          new JsonRpcTransportFactory(),
          new RestTransportFactory(),
          new GrpcTransportFactory(),
        ],
        preferredTransports: [selected],
        cardResolver: new DefaultAgentCardResolver(),
        clientConfig: pnc ? { pushNotificationConfig: pnc } : undefined,
      })
    );

    const baseUri = call.agentCardUri.endsWith('/')
      ? call.agentCardUri
      : call.agentCardUri + '/';
    const client = await factory.createFromUrl(baseUri);

    if (!call.instruction) {
      throw new Error('Instruction missing in callAgent step');
    }
    const instBytes = Instruction.encode(call.instruction).finish();
    const b64 = Buffer.from(instBytes).toString('base64');

    const nestedMsg: Message = {
      kind: 'message',
      messageId: randomUUID(),
      role: 'user',
      parts: [
        {
          kind: 'file',
          file: {
            bytes: b64,
            mimeType: 'application/x-protobuf',
            name: 'instruction.bin',
          },
        },
      ],
      metadata: { 'a2a/protocol_version': '0.3' },
    };

    const req: MessageSendParams = {
      message: nestedMsg,
      configuration: pnc
        ? {
          blocking: true,
          pushNotificationConfig: pnc,
          acceptedOutputModes: ['text'],
        }
        : { blocking: true, acceptedOutputModes: ['text'] },
    };

    if (call.behavior?.$case === 'resubscribe') {
      return await this.resubscribeFlow(client, req);
    }

    const results: string[] = [];
    if (call.streaming) {
      for await (const ev of client.sendMessageStream(req)) {
        this.collectText(ev, results);
      }
    } else {
      const result = await client.sendMessage(req);
      if (result && (result as Message).kind === 'message') {
        this.collectText(result as Message, results);
      } else if (result) {
        const task = result as Task;
        if (task.status?.message) this.collectText(task.status.message, results);
        for (const m of task.history ?? []) {
          if (m.role === 'agent') this.collectText(m, results);
        }
      }
    }
    return results;
  }

  private async resubscribeFlow(
    client: Client,
    req: MessageSendParams
  ): Promise<string[]> {
    const initAbort = new AbortController();
    let taskId: string | undefined;
    try {
      for await (const ev of client.sendMessageStream(req, {
        signal: initAbort.signal,
      })) {
        taskId = this.extractTaskId(ev);
        if (taskId) break;
      }
    } catch (e) {
      if (!initAbort.signal.aborted) {
        console.error('[ItkV03] resubscribe init send_message failed:', e);
        throw e;
      }
    } finally {
      initAbort.abort();
    }
    if (!taskId) {
      throw new Error('Resubscribe: initial send_message yielded no task_id');
    }

    const out: string[] = [];
    let finished = false;

    const consume = (m?: Message) => {
      if (!m?.parts) return;
      for (const p of m.parts) {
        if (p.kind === 'text' && p.text) {
          const cleaned = p.text.replace(/task-finished/g, '').trim();
          if (cleaned) out.push(cleaned);
          if (p.text.includes('task-finished')) finished = true;
        }
      }
    };

    const resubParams: TaskIdParams = { id: taskId };
    for await (const ev of client.resubscribeTask(resubParams)) {
      if (this.isTask(ev)) {
        for (const h of ev.history ?? []) {
          if (h.role === 'agent') {
            consume(h);
            if (finished) break;
          }
        }
        if (!finished) consume(ev.status?.message);
      } else if (this.isStatusUpdate(ev)) {
        consume(ev.status?.message);
      } else if (this.isMessage(ev)) {
        consume(ev);
      }
      if (finished) break;
    }

    try {
      await client.cancelTask({ id: taskId } as TaskIdParams);
    } catch (e) {
      console.warn(`[ItkV03] Cancel after resubscribe failed (non-fatal):`, e);
    }
    return out;
  }

  private extractTaskId(
    ev: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent | undefined
  ): string | undefined {
    if (!ev) return undefined;
    if (this.isTask(ev)) return ev.id || undefined;
    if (this.isStatusUpdate(ev)) return ev.taskId || undefined;
    if (this.isArtifactUpdate(ev)) return ev.taskId || undefined;
    return undefined;
  }

  private isTask(x: unknown): x is Task {
    return !!x && typeof x === 'object' && (x as { kind?: string }).kind === 'task';
  }
  private isStatusUpdate(x: unknown): x is TaskStatusUpdateEvent {
    return (
      !!x &&
      typeof x === 'object' &&
      (x as { kind?: string }).kind === 'status-update'
    );
  }
  private isMessage(x: unknown): x is Message {
    return (
      !!x && typeof x === 'object' && (x as { kind?: string }).kind === 'message'
    );
  }
  private isArtifactUpdate(x: unknown): x is TaskArtifactUpdateEvent {
    return (
      !!x &&
      typeof x === 'object' &&
      (x as { kind?: string }).kind === 'artifact-update'
    );
  }

  private collectText(
    ev: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent | undefined,
    out: string[]
  ) {
    if (!ev) return;
    let m: Message | undefined;
    if (this.isMessage(ev)) m = ev;
    else if (this.isStatusUpdate(ev)) m = ev.status?.message;
    else if (this.isTask(ev)) m = ev.status?.message;
    // TaskArtifactUpdateEvent has no message payload we care about.
    if (!m?.parts) return;
    for (const p of m.parts) {
      if (p.kind === 'text' && p.text) out.push(p.text);
    }
  }

  private publishFinal(
    eventBus: ExecutionEventBus,
    context: RequestContext,
    state: 'completed' | 'failed' | 'canceled',
    text: string
  ): void {
    const textPart: Part = { kind: 'text', text };
    eventBus.publish({
      kind: 'status-update',
      taskId: context.taskId,
      contextId: context.contextId,
      status: {
        state,
        message: {
          kind: 'message',
          messageId: randomUUID(),
          role: 'agent',
          taskId: context.taskId,
          contextId: context.contextId,
          parts: [textPart],
        } as Message,
        timestamp: new Date().toISOString(),
      },
      final: true,
    } as TaskStatusUpdateEvent);
  }

  private async holdTask(
    eventBus: ExecutionEventBus,
    context: RequestContext,
    finishedText: string
  ): Promise<boolean> {
    const canceller = new AbortController();
    this.holdCancellers.set(context.taskId, canceller);
    try {
      const finishedMessage: Message = {
        kind: 'message',
        messageId: 'task-finished',
        contextId: context.contextId,
        taskId: context.taskId,
        role: 'agent',
        parts: [{ kind: 'text', text: finishedText }],
      };

      eventBus.publish({
        kind: 'status-update',
        taskId: context.taskId,
        contextId: context.contextId,
        status: {
          state: 'working',
          message: finishedMessage,
          timestamp: new Date().toISOString(),
        },
        final: false,
      } as TaskStatusUpdateEvent);

      for (let i = 0; i < HOLD_TASK_TICK_COUNT; i++) {
        try {
          await this.sleep(HOLD_TASK_TICK_MS, canceller.signal);
        } catch (e) {
          // Expected on cancel — abort signal fires and sleep rejects.
          if (!canceller.signal.aborted) {
            console.error('[ItkV03] holdTask sleep failed unexpectedly:', e);
          }
          return true;
        }
        eventBus.publish({
          kind: 'status-update',
          taskId: context.taskId,
          contextId: context.contextId,
          status: {
            state: 'working',
            message: finishedMessage,
            timestamp: new Date().toISOString(),
          },
          final: false,
        } as TaskStatusUpdateEvent);
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
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let httpPort = 10101;
  let grpcPort = 11001;

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

  console.log(
    `Starting ITK TS v0.3 baseline agent on HTTP ${httpPort} / gRPC ${grpcPort}`
  );

  const agentCard: AgentCard = {
    name: 'ITK TS v0.3 Baseline Agent',
    description: 'TypeScript v0.3 baseline agent for ITK interoperability tests.',
    protocolVersion: '0.3.0',
    version: '0.3.0',
    url: `http://127.0.0.1:${httpPort}/jsonrpc`,
    preferredTransport: 'JSONRPC',
    additionalInterfaces: [
      { url: `http://127.0.0.1:${httpPort}/jsonrpc`, transport: 'JSONRPC' },
      { url: `http://127.0.0.1:${httpPort}/rest`, transport: 'HTTP+JSON' },
      { url: `127.0.0.1:${grpcPort}`, transport: 'GRPC' },
    ],
    capabilities: {
      streaming: true,
      // MUST be true or DefaultRequestHandler won't persist push configs
      // that arrive on send_message.
      pushNotifications: true,
    },
    defaultInputModes: ['text/plain', 'application/x-protobuf'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'itk_v03_proto_skill',
        name: 'ITK v03 Proto Skill',
        description: 'Handles ITK Instruction protos wrapped as file parts.',
        tags: ['proto', 'v03', 'itk'],
        examples: ['Call another agent', 'Return a response'],
      },
    ],
    provider: {
      organization: 'A2A Samples',
      url: 'https://example.com/a2a-samples',
    },
  };

  const taskStore: TaskStore = new InMemoryTaskStore();
  const pushStore = new InMemoryPushNotificationStore();
  const pushSender = new DefaultPushNotificationSender(pushStore);
  const executor: AgentExecutor = new ItkV03AgentExecutor(pushStore);
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
    undefined,
    pushStore,
    pushSender
  );

  const app = express();
  const jsonRpcPath = '/jsonrpc';
  const restPath = '/rest';

  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler })
  );
  app.use(
    `${jsonRpcPath}/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler })
  );
  app.use(
    `${restPath}/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler })
  );
  app.use(jsonRpcPath, express.json());
  app.use(
    jsonRpcPath,
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    })
  );
  app.use(
    restPath,
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    })
  );

  app.listen(httpPort, () => {
    console.log(`[ItkV03] HTTP server started on http://localhost:${httpPort}`);
  });

  const grpcServer = new grpc.Server();
  grpcServer.addService(
    A2AService,
    grpcService({
      requestHandler,
      userBuilder: GrpcUserBuilder.noAuthentication,
    })
  );

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err: Error | null, port: number) => {
      if (err) {
        console.error(`Failed to bind gRPC server: ${err.message}`);
        return;
      }
      console.log(`[ItkV03] gRPC server listening on port ${port}`);
    }
  );
}

main().catch((err) => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});

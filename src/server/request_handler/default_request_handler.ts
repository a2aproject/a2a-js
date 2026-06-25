import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  RequestMalformedError,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  GenericError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
} from '../../errors.js';

import {
  Message,
  AgentCard,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  Role,
  TaskPushNotificationConfig,
  SendMessageRequest,
  GetTaskRequest,
  CancelTaskRequest,
  GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
  DeleteTaskPushNotificationConfigRequest,
  SubscribeToTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
  ListTaskPushNotificationConfigsResponse,
  StreamResponse,
} from '../../index.js';
import { AgentExecutor } from '../agent_execution/agent_executor.js';
import { RequestContext } from '../agent_execution/request_context.js';
import {
  ExecutionEventBusManager,
  DefaultExecutionEventBusManager,
} from '../events/execution_event_bus_manager.js';
import {
  AgentExecutionEvent,
  AgentEvent,
  assertUnreachableEvent,
  ExecutionEventBus,
} from '../events/execution_event_bus.js';
import { ExecutionEventQueue } from '../events/execution_event_queue.js';
import { ResultManager } from '../result_manager.js';
import { TaskStore } from '../store.js';
import { A2ARequestHandler } from './a2a_request_handler.js';
import {
  InMemoryPushNotificationStore,
  PushNotificationStore,
} from '../push_notification/push_notification_store.js';
import { PushNotificationSender } from '../push_notification/push_notification_sender.js';
import { DefaultPushNotificationSender } from '../push_notification/default_push_notification_sender.js';
import { ServerCallContext } from '../context.js';
import { DEFAULT_PAGE_SIZE } from '../../constants.js';
import {
  AUTH_REQUIRED_STATE_LIST,
  INTERRUPTED_STATE_LIST,
  TERMINAL_STATE_LIST,
  isTask,
  StreamPattern,
} from '../utils.js';
import { AgentCardSignatureGenerator } from '../../signature.js';
import { extractErrorMessage } from '../../errors.js';

/**
 * Default implementation of the A2A request handler.
 *
 * ## Multi-Tenancy
 *
 * This handler supports multi-tenant deployments through the `tenant` field present
 * on all request objects (per A2A spec Sections 3.1.x and 4.4.6). The tenant value
 * flows through the system as follows:
 *
 * 1. **Transport layer** extracts tenant from the protocol-specific source:
 *    - REST: URL path prefix (`/:tenant/...`)
 *    - JSON-RPC: `params.tenant` in the request body
 *    - gRPC: `tenant` field in the request message
 *
 * 2. **`ServerCallContext.tenant`** carries the tenant to all downstream components,
 *    including `TaskStore`, `PushNotificationStore`, and `AgentExecutor`.
 *
 * 3. **`InMemoryTaskStore`** and **`InMemoryPushNotificationStore`** use `context.tenant`
 *    to scope data with composite keys (`{tenant}:{id}`), providing tenant isolation.
 */
export class DefaultRequestHandler implements A2ARequestHandler {
  private readonly agentCard: AgentCard;
  private readonly taskStore: TaskStore;
  private readonly agentExecutor: AgentExecutor;
  private readonly eventBusManager: ExecutionEventBusManager;
  private readonly pushNotificationStore?: PushNotificationStore;
  private readonly pushNotificationSender?: PushNotificationSender;
  private readonly extendedAgentCardProvider?: AgentCard | ExtendedAgentCardProvider;
  private readonly agentCardSignatureGenerator?: AgentCardSignatureGenerator;

  constructor(
    agentCard: AgentCard,
    taskStore: TaskStore,
    agentExecutor: AgentExecutor,
    eventBusManager: ExecutionEventBusManager = new DefaultExecutionEventBusManager(),
    pushNotificationStore?: PushNotificationStore,
    pushNotificationSender?: PushNotificationSender,
    extendedAgentCardProvider?: AgentCard | ExtendedAgentCardProvider,
    agentCardSignatureGenerator?: AgentCardSignatureGenerator
  ) {
    this.agentCard = agentCard;
    this.taskStore = taskStore;
    this.agentExecutor = agentExecutor;
    this.eventBusManager = eventBusManager;
    this.extendedAgentCardProvider = extendedAgentCardProvider;
    this.agentCardSignatureGenerator = agentCardSignatureGenerator;

    // If push notifications are supported, use the provided store and sender.
    // Otherwise, use the default in-memory store and sender.
    if (agentCard.capabilities?.pushNotifications) {
      this.pushNotificationStore = pushNotificationStore || new InMemoryPushNotificationStore();
      this.pushNotificationSender =
        pushNotificationSender || new DefaultPushNotificationSender(this.pushNotificationStore);
    }
  }

  async getAgentCard(): Promise<AgentCard> {
    if (this.agentCardSignatureGenerator) {
      return this.agentCardSignatureGenerator(this.agentCard);
    }
    return this.agentCard;
  }

  async getAuthenticatedExtendedAgentCard(
    _params: GetExtendedAgentCardRequest,
    context: ServerCallContext
  ): Promise<AgentCard> {
    if (!this.agentCard.capabilities?.extendedAgentCard) {
      throw new UnsupportedOperationError('Agent does not support authenticated extended card.');
    }
    if (!this.extendedAgentCardProvider) {
      throw new ExtendedAgentCardNotConfiguredError();
    }
    let agentCard: AgentCard;
    if (typeof this.extendedAgentCardProvider === 'function') {
      agentCard = await this.extendedAgentCardProvider(context);
    } else if (context.user?.isAuthenticated) {
      agentCard = this.extendedAgentCardProvider;
    } else {
      agentCard = this.agentCard;
    }

    if (this.agentCardSignatureGenerator) {
      return this.agentCardSignatureGenerator(agentCard);
    }
    return agentCard;
  }

  private async _createRequestContext(
    incomingMessage: Message,
    context: ServerCallContext
  ): Promise<RequestContext> {
    let task: Task | undefined;
    let referenceTasks: Task[] | undefined;

    // incomingMessage would contain taskId, if a task already exists.
    if (incomingMessage.taskId) {
      task = await this.taskStore.load(incomingMessage.taskId, context);
      if (!task) {
        throw new TaskNotFoundError(`Task not found: ${incomingMessage.taskId}`);
      }
      if (task.status?.state !== undefined && TERMINAL_STATE_LIST.includes(task.status.state)) {
        // Throw UnsupportedOperationError as required by TCK for terminal tasks.
        throw new UnsupportedOperationError(
          `Task ${task.id} is in a terminal state (${task.status!.state}) and cannot be modified.`
        );
      }
      // Validate contextId/taskId consistency per §3.4.3.
      if (
        incomingMessage.contextId &&
        task.contextId &&
        incomingMessage.contextId !== task.contextId
      ) {
        throw new RequestMalformedError(
          `contextId mismatch: message contextId '${incomingMessage.contextId}' ` +
            `does not match task '${task.id}' contextId '${task.contextId}'`
        );
      }
      // Add incomingMessage to history and save the task.
      task.history = [...(task.history || []), incomingMessage];
      await this.taskStore.save(task, context);
    }
    // Ensure taskId is present
    const taskId = incomingMessage.taskId || uuidv4();
    const referenceTaskIds =
      (incomingMessage as Message & { referenceTaskIds?: string[] }).referenceTaskIds || [];

    if (referenceTaskIds.length > 0) {
      referenceTasks = [];
      for (const refId of referenceTaskIds) {
        const refTask = await this.taskStore.load(refId, context);
        if (refTask) {
          referenceTasks.push(refTask);
        } else {
          console.warn(`Reference task ${refId} not found.`);
          // Optionally, throw an error or handle as per specific requirements
        }
      }
    }
    // Ensure contextId is present
    const contextId = incomingMessage.contextId || task?.contextId || uuidv4();

    // Validate requested extensions against agent capabilities per §3.3.4.
    const agentCard = await this.getAgentCard();
    const agentExtensions = agentCard.capabilities?.extensions ?? [];

    // Check that the client declares support for all required extensions.
    // Per §3.3.4: "When a required extension is not declared by the client,
    // server MUST return ExtensionSupportRequiredError."
    const requestedSet = new Set(context.requestedExtensions ?? []);
    const missingRequired = agentExtensions
      .filter((ext) => ext.required && !requestedSet.has(ext.uri))
      .map((ext) => ext.uri);

    if (missingRequired.length > 0) {
      throw new ExtensionSupportRequiredError(
        `Client must declare support for required extensions: ${missingRequired.join(', ')}`
      );
    }

    // Narrow the client-requested set to extensions the agent actually
    // exposes (§4.6.3: "SHOULD ignore the extension … and proceed
    // without it"). Mutate in place — the Express / gRPC transport
    // layer holds a reference to this context and, after dispatch,
    // reads `activatedExtensions` off it to populate the response
    // `A2A-Extensions` header. Replacing the reference would strand
    // later `addActivatedExtension(...)` calls from the executor on a
    // dead object and silently drop the header.
    if (context.requestedExtensions) {
      const exposedExtensions = new Set(agentExtensions.map((ext) => ext.uri));
      context.setRequestedExtensions(
        context.requestedExtensions.filter((extension) => exposedExtensions.has(extension))
      );
    }

    const messageForContext = {
      ...incomingMessage,
      contextId,
      taskId,
    };
    return new RequestContext(messageForContext, taskId, contextId, context, task, referenceTasks);
  }

  private async _processEvents(
    taskId: string,
    resultManager: ResultManager,
    eventQueue: ExecutionEventQueue,
    context: ServerCallContext,
    options?: {
      firstResultResolver?: (value: Message | Task) => void;
      firstResultRejector?: (reason?: unknown) => void;
      /**
       * If provided, fires (at most once) the first time the queue
       * yields a `statusUpdate` whose state is in
       * {@link AUTH_REQUIRED_STATE_LIST}. The callback receives a deep
       * snapshot of the current Task as known to the `ResultManager`
       * immediately after the AUTH_REQUIRED event has been persisted.
       *
       * The drain loop continues iterating after invocation per spec
       * §7.6.1: AUTH_REQUIRED is not a stream-terminating state, so the
       * agent may resume publishing on the same bus as soon as the
       * credential is injected out-of-band.
       *
       * Blocking `sendMessage` uses this hook to return a snapshot to
       * the caller without tearing down the consumer; the
       * `ExecutionEventQueue` is configured (see
       * `INPUT_REQUIRED_STATE_LIST` in `events()`) to keep yielding
       * after AUTH_REQUIRED, so this same `_processEvents` invocation
       * continues draining in the background as a fire-and-forget
       * task until a terminal state — or INPUT_REQUIRED, the other
       * pause state — is reached.
       */
      authRequiredSnapshotResolver?: (snapshot: Task) => void;
    }
  ): Promise<void> {
    let firstResultSent = false;
    let authRequiredSnapshotSent = false;
    try {
      for await (const event of eventQueue.events()) {
        await resultManager.processEvent(event);

        try {
          const streamResponse = await this._mapEventToStreamResponse(event, context);
          await this._sendPushNotificationIfNeeded(context, streamResponse);
        } catch (error) {
          console.error(`Error sending push notification: ${error}`);
        }

        if (options?.firstResultResolver && !firstResultSent) {
          let firstResult: Message | Task | undefined;
          if (event.kind === 'message') {
            firstResult = event.data;
          } else if (event.kind === 'task') {
            firstResult = event.data;
          } else {
            const finalResult = resultManager.getFinalResult();
            if (finalResult && ('messageId' in finalResult || 'id' in finalResult)) {
              firstResult = finalResult;
            }
          }
          if (firstResult) {
            options.firstResultResolver(firstResult);
            firstResultSent = true;
          }
        }

        // §7.6.1 AUTH_REQUIRED snapshot: hand the blocking caller a
        // copy of the current Task at the moment the executor signals
        // it needs a credential, but DO NOT break out of the loop —
        // the queue is configured to keep yielding past AUTH_REQUIRED
        // so the executor can resume publishing once the credential
        // arrives out-of-band.
        if (
          options?.authRequiredSnapshotResolver &&
          !authRequiredSnapshotSent &&
          event.kind === 'statusUpdate' &&
          event.data.status &&
          AUTH_REQUIRED_STATE_LIST.includes(event.data.status.state)
        ) {
          const currentTask = resultManager.getCurrentTask();
          if (currentTask) {
            // Deep-clone so subsequent in-place mutations by the
            // continuing drain (status updates, artifact merges)
            // can't leak into the snapshot the caller already
            // received.
            options.authRequiredSnapshotResolver(structuredClone(currentTask));
            authRequiredSnapshotSent = true;
            // The caller has been handed a result (the snapshot); from
            // `_handleProcessingError`'s perspective this is
            // indistinguishable from the non-blocking
            // first-Task-event resolution. Setting `firstResultSent`
            // routes any subsequent drain error to the
            // "first result already sent" branch, where the failure
            // is persisted as a TASK_STATE_FAILED status update via
            // `ResultManager` instead of being re-thrown into the
            // unattended background drain.
            firstResultSent = true;
          }
        }
      }
      // Non-blocking contract guard: the caller wired a
      // `firstResultResolver` and expects the drain to produce at
      // least one Task / Message event. If the executor returned
      // without publishing one, surface the protocol violation via
      // `firstResultRejector`.
      //
      // This is intentionally gated on `firstResultResolver` (not
      // `firstResultRejector`) so the blocking caller — which also
      // passes `firstResultRejector` to route post-AUTH_REQUIRED
      // drain errors — doesn't trip this branch on a normal
      // INPUT_REQUIRED / terminal exit where no first-result tracking
      // is meaningful.
      if (options?.firstResultResolver && options?.firstResultRejector && !firstResultSent) {
        options.firstResultRejector(
          new RequestMalformedError('Execution finished before a message or task was produced.')
        );
      }
    } catch (error) {
      console.error(`Event processing loop failed for task ${taskId}:`, error);
      this._handleProcessingError(
        error,
        resultManager,
        firstResultSent,
        taskId,
        options?.firstResultRejector
      );
    } finally {
      // Detach this queue from the bus; the bus itself is cleaned up
      // when the executor settles (see `_runExecutor` / `_runStreamExecutor`).
      eventQueue.stop();
    }
  }

  /**
   * Background drain helper used by the blocking `sendMessage` path
   * after an AUTH_REQUIRED snapshot has been returned to the caller.
   *
   * The pending `_processEvents` promise continues iterating the
   * event queue (which, per §7.6.1, is configured to stay open
   * through AUTH_REQUIRED) so subsequent agent events keep flowing
   * into the {@link ResultManager} and push-notification sender until
   * a terminal — or INPUT_REQUIRED — state arrives and the loop
   * naturally exits.
   *
   * Attaches a `.catch` so a thrown error in the unattended drain is
   * logged instead of surfacing as a Node `unhandledRejection`.
   * Drain errors that happen *after* the AUTH_REQUIRED snapshot are
   * already routed through `_handleProcessingError`'s
   * "first result already sent" branch (which persists a FAILED
   * status update via `ResultManager`), so this handler is the
   * last-ditch safety net for synchronous throws inside the drain
   * machinery itself.
   */
  private _continueDraining(taskId: string, pending: Promise<void>): void {
    pending.catch((error) => {
      console.error(
        `Background AUTH_REQUIRED drain failed for task ${taskId}:`,
        error instanceof Error ? error.message : error
      );
    });
  }

  /**
   * Runs the executor for a blocking `sendMessage` call and ties the
   * event bus lifecycle to the executor's settlement.
   *
   * On rejection, publishes a synthetic Task + statusUpdate(FAILED) so
   * the consumer's event loop terminates with a usable final result and
   * any concurrent resubscribers see the failure on the same wire.
   *
   * The bus is cleaned up after the executor settles AND `bus.finished()`
   * has been signalled, so:
   *   - resubscribers attaching mid-execution still find a live bus,
   *   - the executor's own publish calls after the consumer disconnects
   *     don't go into a removed bus.
   */
  private _runExecutor(
    taskId: string,
    eventBus: ExecutionEventBus,
    requestContext: RequestContext,
    finalMessageForAgent: Message
  ): void {
    // Subscribe a lightweight listener that tracks the last task state
    // published on the bus. We can't rely on `resultManager.getCurrentTask()`
    // in the `.finally` block because the consumer loop that drains the
    // queue into `ResultManager` runs in a separate microtask: by the
    // time `.finally()` runs, the consumer has not necessarily processed
    // the events yet.
    const stateTracker = trackLatestTaskState(eventBus);
    this.agentExecutor
      .execute(requestContext, eventBus)
      .catch((err: unknown) => {
        // Promises can reject with any value (Error, string, plain
        // object, `null`, `undefined`, etc.), so coerce defensively
        // before reading `.message` — accessing `.message` on a
        // non-Error rejection would throw a fresh TypeError here and
        // swallow the original failure, leaving the consumer to hang.
        const errorMessage = extractErrorMessage(err);
        console.error(`Agent execution failed for message ${finalMessageForAgent.messageId}:`, err);
        // Publish a synthetic error event so the consumer's event loop
        // can settle the first-result promise and so any concurrent
        // resubscribers see the failure on the wire.
        //
        // The synthetic Task id MUST be `requestContext.taskId` — that's
        // the id the bus is registered under and the id we hand back to
        // the client. Fabricating a fresh `uuidv4()` here would make the
        // returned Task unreachable via `getTask` (TaskNotFoundError).
        const errorTask: Task = {
          id: requestContext.taskId,
          contextId: finalMessageForAgent.contextId!,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            message: {
              role: Role.ROLE_AGENT,
              messageId: uuidv4(),
              taskId: requestContext.taskId,
              contextId: finalMessageForAgent.contextId!,
              parts: [
                {
                  content: { $case: 'text', value: `Agent execution error: ${errorMessage}` },
                  mediaType: 'text/plain',
                  filename: '',
                  metadata: {},
                },
              ],
              metadata: {},
              extensions: [],
              referenceTaskIds: [],
            },
            timestamp: new Date().toISOString(),
          },
          artifacts: [],
          history: requestContext.task?.history ? [...requestContext.task.history] : [],
          metadata: {},
        };
        if (
          finalMessageForAgent &&
          !errorTask.history?.find((m) => m.messageId === finalMessageForAgent.messageId)
        ) {
          errorTask.history?.push(finalMessageForAgent);
        }
        eventBus.publish(AgentEvent.task(errorTask));
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId: errorTask.id,
            contextId: errorTask.contextId,
            status: errorTask.status,
            metadata: {},
          })
        );
      })
      .finally(() => {
        // Closes the bus for terminal tasks; kept alive for
        // INPUT_REQUIRED / AUTH_REQUIRED so follow-up sends and
        // resubscribers can still attach.
        this._settleBus(taskId, eventBus, stateTracker());
      });
  }

  /**
   * Settles the event bus once the executor returns.
   *
   * Terminal states (and the bare-Message pattern in §3.1.2) close the
   * bus immediately. Interrupted states keep it alive but for two
   * subtly different reasons:
   *
   *   * INPUT_REQUIRED (§3.4.3): the executor has stopped publishing
   *     and is waiting on a follow-up `message/send` from the client.
   *     The bus must survive across calls so `createOrGetByTaskId`
   *     finds the same instance when the client resumes, and so
   *     `tasks/resubscribe` can attach in the meantime.
   *
   *   * AUTH_REQUIRED (§7.6.1): the executor is expected to resume
   *     publishing on this same bus as soon as the credential is
   *     injected out-of-band, with no follow-up client message
   *     required. A blocking `sendMessage` has already returned a
   *     snapshot to its caller and its `_processEvents` loop is now
   *     draining in the background (see `_continueDraining`); the
   *     bus stays alive so those subsequent publishes still flow
   *     into `ResultManager` and the push-notification sender.
   *
   * Both cases share the same `INTERRUPTED_STATE_LIST` early-return
   * here because the lifecycle decision — "don't close the bus when
   * `execute()` returns at this state" — is identical.
   */
  private _settleBus(
    taskId: string,
    eventBus: ExecutionEventBus,
    lastState: TaskState | undefined
  ): void {
    if (lastState !== undefined && INTERRUPTED_STATE_LIST.includes(lastState)) {
      return;
    }
    eventBus.finished();
    this.eventBusManager.cleanupByTaskId(taskId);
  }

  /**
   * Streaming variant of {@link _runExecutor}.
   *
   * Error handling mirrors the blocking path:
   *
   *   * If the executor has already published a Task event before
   *     throwing, only a synthetic statusUpdate(FAILED) is published —
   *     publishing a fresh Task event in that state would violate the
   *     §3.1.2 task-lifecycle ordering enforced by
   *     {@link _advanceStreamPattern}.
   *   * If the executor threw BEFORE publishing any Task event (e.g.
   *     argument validation, auth check), we synthesize BOTH the Task
   *     event and the statusUpdate(FAILED) so the SSE consumer sees a
   *     well-formed task-lifecycle stream that terminates in FAILED.
   *     Previously this path silently returned, leaving the client with
   *     an empty stream and no signal that the request failed —
   *     asymmetric with the blocking path which always synthesizes the
   *     error Task.
   *
   * The synthetic Task id is `requestContext.taskId` (the bus
   * registration key and the id the client will use for subsequent
   * `getTask` calls); the executor-published `latestTask` (if any) is
   * preferred for the statusUpdate so the failure carries the same id
   * the consumer has already seen on the wire.
   *
   * Note: we read the most-recent published Task and task state off
   * the bus via {@link trackLatestTaskAndState} rather than from
   * `ResultManager`. The consumer loop that drains the bus into
   * `ResultManager` runs in a separate microtask, so
   * `ResultManager.getCurrentTask()` would still return `undefined`
   * immediately after a synchronous `bus.publish(...)` followed by a
   * `throw` — which is exactly the typical executor pattern.
   */
  private _runStreamExecutor(
    taskId: string,
    eventBus: ExecutionEventBus,
    requestContext: RequestContext
  ): void {
    const finalMessageForAgent = requestContext.userMessage;
    // Single per-execution listener captures both the most-recent Task
    // event and the most-recent task state — see
    // `trackLatestTaskAndState` for why combining them in one listener
    // avoids double dispatch and why reading the snapshot from
    // ResultManager here is unsafe.
    const snapshotTracker = trackLatestTaskAndState(eventBus);
    this.agentExecutor
      .execute(requestContext, eventBus)
      .catch((err: unknown) => {
        // See the `_runExecutor` catch block for why `err` is typed as
        // `unknown` and coerced via `extractErrorMessage` instead of
        // touching `.message` directly.
        const errorMessage = extractErrorMessage(err);
        console.error(
          `Agent execution failed for stream message ${finalMessageForAgent.messageId}:`,
          err
        );

        const latestTask = snapshotTracker().task;
        const errorTaskId = latestTask?.id ?? requestContext.taskId;
        const errorContextId = latestTask?.contextId ?? finalMessageForAgent.contextId!;

        // If no Task event has been published yet, synthesize one first
        // so the SSE consumer's stream pattern transitions into
        // TASK_LIFECYCLE (per §3.1.2) before the statusUpdate(FAILED)
        // lands. Without this, the executor would silently close an
        // empty stream and the client would have no way to learn the
        // request failed — the asymmetry called out in PR 2.
        if (!latestTask) {
          const errorTask: Task = {
            id: requestContext.taskId,
            contextId: finalMessageForAgent.contextId!,
            status: {
              state: TaskState.TASK_STATE_FAILED,
              message: {
                role: Role.ROLE_AGENT,
                messageId: uuidv4(),
                taskId: requestContext.taskId,
                contextId: finalMessageForAgent.contextId!,
                parts: [
                  {
                    content: { $case: 'text', value: `Agent execution error: ${errorMessage}` },
                    mediaType: 'text/plain',
                    filename: '',
                    metadata: {},
                  },
                ],
                metadata: {},
                extensions: [],
                referenceTaskIds: [],
              },
              timestamp: new Date().toISOString(),
            },
            artifacts: [],
            history: requestContext.task?.history ? [...requestContext.task.history] : [],
            metadata: {},
          };
          if (
            finalMessageForAgent &&
            !errorTask.history?.find((m) => m.messageId === finalMessageForAgent.messageId)
          ) {
            errorTask.history?.push(finalMessageForAgent);
          }
          eventBus.publish(AgentEvent.task(errorTask));
        }

        const errorTaskStatus: TaskStatusUpdateEvent = {
          taskId: errorTaskId,
          contextId: errorContextId,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            message: {
              role: Role.ROLE_AGENT,
              messageId: uuidv4(),
              taskId: errorTaskId,
              contextId: errorContextId,
              parts: [
                {
                  content: { $case: 'text', value: `Agent execution error: ${errorMessage}` },
                  mediaType: 'text/plain',
                  filename: '',
                  metadata: {},
                },
              ],
              metadata: {},
              extensions: [],
              referenceTaskIds: [],
            },
            timestamp: new Date().toISOString(),
          },
          metadata: {},
        };
        eventBus.publish(AgentEvent.statusUpdate(errorTaskStatus));
      })
      .finally(() => {
        // Detach the bus listener and read the final state in one
        // call. Closes the bus for terminal tasks; kept alive for
        // INPUT_REQUIRED / AUTH_REQUIRED so follow-up sends and
        // resubscribers can still attach.
        this._settleBus(taskId, eventBus, snapshotTracker().state);
      });
  }

  async sendMessage(
    params: SendMessageRequest,
    context: ServerCallContext
  ): Promise<Message | Task> {
    const incomingMessage = params.message;
    if (!incomingMessage?.messageId) {
      throw new RequestMalformedError('message.messageId is required.');
    }

    // Default to blocking behavior if 'returnImmediately' is not explicitly true.
    const isBlocking = params.configuration?.returnImmediately !== true;
    // Instantiate ResultManager before creating RequestContext
    const resultManager = new ResultManager(this.taskStore, context);
    resultManager.setContext(incomingMessage); // Set context for ResultManager

    const requestContext = await this._createRequestContext(incomingMessage, context);
    const taskId = requestContext.taskId;

    // Use the (potentially updated) contextId from requestContext
    const finalMessageForAgent = requestContext.userMessage;

    // If push notification config is provided, save it to the store.
    if (
      params.configuration?.taskPushNotificationConfig &&
      this.agentCard.capabilities?.pushNotifications
    ) {
      await this.pushNotificationStore?.save(
        taskId,
        context,
        params.configuration.taskPushNotificationConfig
      );
    }

    const eventBus = this.eventBusManager.createOrGetByTaskId(taskId);
    // EventQueue should be attached to the bus, before the agent execution begins.
    const eventQueue = new ExecutionEventQueue(eventBus);

    // Start agent execution (non-blocking).
    // It runs in the background and publishes events to the eventBus.
    // Bus cleanup is tied to the EXECUTOR's lifecycle, not the consumer's,
    // so a `tasks/resubscribe` arriving after the consumer settles (e.g.
    // blocking sendMessage's first-result resolution) can still find the
    // bus via `getByTaskId` while the executor is still publishing.
    this._runExecutor(taskId, eventBus, requestContext, finalMessageForAgent);

    const historyLengthConfig = params.configuration;

    if (isBlocking) {
      // In blocking mode, the call normally resolves after the full
      // event drain finishes — the final result comes from the
      // ResultManager once the queue closes on terminal /
      // INPUT_REQUIRED / Message.
      //
      // AUTH_REQUIRED is the §7.6.1 exception: the blocking caller
      // gets handed a snapshot of the current Task as soon as the
      // AUTH_REQUIRED status update is observed, and the drain loop
      // detaches into the background so the executor can keep
      // publishing on the same bus after the out-of-band credential
      // injection (and so the ResultManager / push-notification
      // pipeline continues servicing those events).
      return new Promise<Message | Task>((resolve, reject) => {
        const pending = this._processEvents(taskId, resultManager, eventQueue, context, {
          authRequiredSnapshotResolver: (snapshot) => {
            this._applyHistoryLengthSemantics(snapshot, historyLengthConfig ?? {});
            resolve(snapshot);
            // Drain continues in the background; see
            // `_continueDraining` for the unhandled-rejection guard.
            this._continueDraining(taskId, pending);
          },
          // Passing `firstResultRejector` keeps the blocking promise
          // in sync with `_handleProcessingError`'s tri-state contract
          // (see `_processEvents`):
          //   * pre-AUTH_REQUIRED drain error → rejects the outer
          //     promise so the caller's `await sendMessage(...)`
          //     throws (same as today's blocking behaviour);
          //   * post-AUTH_REQUIRED drain error → `firstResultSent` is
          //     true (set alongside the snapshot resolve), so
          //     `_handleProcessingError` falls into the
          //     "first result already sent" branch and persists a
          //     FAILED status update via `ResultManager` instead of
          //     re-throwing into the unattended background drain.
          // Calling `reject` after `resolve` is a no-op (Promise
          // settlement is one-shot), so this is safe even when the
          // snapshot path already fired.
          firstResultRejector: reject,
        });
        pending
          .then(() => {
            // If we already resolved with an AUTH_REQUIRED snapshot
            // above, this resolve() call is a no-op — Promise
            // resolution is one-shot, and the background drain only
            // exists to keep ResultManager + push notifications
            // current beyond the snapshot.
            const finalResult = resultManager.getFinalResult();
            if (!finalResult) {
              reject(
                new GenericError(
                  'Agent execution finished without a result, and no task context found.'
                )
              );
              return;
            }
            if (isTask(finalResult)) {
              this._applyHistoryLengthSemantics(finalResult, historyLengthConfig ?? {});
            }
            resolve(finalResult);
          })
          .catch(reject);
      });
    } else {
      // In non-blocking mode, return a promise that will be settled by fullProcessing.
      return new Promise<Message | Task>((resolve, reject) => {
        this._processEvents(taskId, resultManager, eventQueue, context, {
          firstResultResolver: (result) => {
            if (isTask(result)) {
              this._applyHistoryLengthSemantics(result, historyLengthConfig ?? {});
            }
            resolve(result);
          },
          firstResultRejector: reject,
        });
      });
    }
  }

  async *sendMessageStream(
    params: SendMessageRequest,
    context: ServerCallContext
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const incomingMessage = params.message;
    if (!incomingMessage?.messageId) {
      // For streams, messageId might be set by client, or server can generate if not present.
      // Let's assume client provides it or throw for now.
      throw new RequestMalformedError('message.messageId is required for streaming.');
    }

    // Instantiate ResultManager before creating RequestContext
    const resultManager = new ResultManager(this.taskStore, context);
    resultManager.setContext(incomingMessage); // Set context for ResultManager

    const requestContext = await this._createRequestContext(incomingMessage, context);
    const taskId = requestContext.taskId;

    const eventBus = this.eventBusManager.createOrGetByTaskId(taskId);
    const eventQueue = new ExecutionEventQueue(eventBus);

    // If push notification config is provided, save it to the store.
    if (
      params.configuration?.taskPushNotificationConfig &&
      this.agentCard.capabilities?.pushNotifications
    ) {
      await this.pushNotificationStore?.save(
        taskId,
        context,
        params.configuration.taskPushNotificationConfig
      );
    }

    // Start agent execution (non-blocking). Bus cleanup is tied to the
    // EXECUTOR's lifecycle (see `_runStreamExecutor`), not the consumer's:
    // a client that disconnects this stream early (e.g. the
    // send-disconnect-resubscribe pattern in §3.1.6) must still be able
    // to attach via `tasks/resubscribe` while the executor keeps
    // running, so we cannot tear down the bus here when this generator
    // settles.
    this._runStreamExecutor(taskId, eventBus, requestContext);

    let streamPattern = StreamPattern.UNDETERMINED;
    try {
      for await (const event of eventQueue.events()) {
        streamPattern = this._advanceStreamPattern(event, streamPattern);

        await resultManager.processEvent(event); // Update store in background

        const streamResponse = await this._mapEventToStreamResponse(event, context);
        if (streamResponse.payload?.$case === 'task') {
          this._applyHistoryLengthSemantics(
            streamResponse.payload.value,
            params.configuration ?? {}
          );
        }
        await this._sendPushNotificationIfNeeded(context, streamResponse);
        yield streamResponse;
      }
    } finally {
      // Detach THIS consumer's queue from the bus, but leave the bus
      // alive until the executor (and any other live subscribers) is
      // done — see comment above and `_runExecutor` / `_runStreamExecutor`.
      eventQueue.stop();
    }
  }

  async getTask(params: GetTaskRequest, context: ServerCallContext): Promise<Task> {
    const taskId = params.id;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${params.id}`);
    }
    this._applyHistoryLengthSemantics(task, params);
    return task;
  }

  async listTasks(
    params: ListTasksRequest,
    context: ServerCallContext
  ): Promise<ListTasksResponse> {
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    if (pageSize < 1 || pageSize > 100) {
      throw new RequestMalformedError('pageSize must be between 1 and 100');
    }

    if (params.statusTimestampAfter && isNaN(Date.parse(params.statusTimestampAfter))) {
      throw new RequestMalformedError('statusTimestampAfter must be a valid ISO 8601 date string');
    }

    const response = await this.taskStore.list({ ...params, pageSize }, context);
    for (const task of response.tasks) {
      this._applyHistoryLengthSemantics(task, params);
    }
    return response;
  }

  async cancelTask(params: CancelTaskRequest, context: ServerCallContext): Promise<Task> {
    const taskId = params.id;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${params.id}`);
    }

    // §3.3.1: cancel is idempotent — a second cancel on a canceled task
    // returns the snapshot. Other terminal states are not cancelable.
    const currentState = task.status?.state;
    if (currentState === TaskState.TASK_STATE_CANCELED) {
      return task;
    }
    if (currentState !== undefined && TERMINAL_STATE_LIST.includes(currentState)) {
      throw new TaskNotCancelableError(`Task not cancelable: ${params.id}`);
    }

    const eventBus = this.eventBusManager.getByTaskId(taskId);

    if (eventBus) {
      const eventQueue = new ExecutionEventQueue(eventBus);
      await this.agentExecutor.cancelTask(taskId, eventBus);
      // Consume all the events until the task reaches a terminal state.
      await this._processEvents(
        taskId,
        new ResultManager(this.taskStore, context),
        eventQueue,
        context
      );
    } else {
      // Here we are marking task as cancelled. We are not waiting for the executor to actually cancel processing.
      task.status = {
        state: TaskState.TASK_STATE_CANCELED,
        message: {
          role: Role.ROLE_AGENT,
          messageId: uuidv4(),
          taskId: task.id,
          contextId: task.contextId,
          parts: [
            {
              content: { $case: 'text', value: 'Task cancellation requested by user.' },
              mediaType: 'text/plain',
              filename: '',
              metadata: {},
            },
          ],
          metadata: {},
          extensions: [],
          referenceTaskIds: [],
        },
        timestamp: new Date().toISOString(),
      };
      // Add cancellation message to history
      if (task.status?.message) {
        task.history = [...(task.history || []), task.status.message];
      }

      await this.taskStore.save(task, context);
    }

    const latestTask = await this.taskStore.load(taskId, context);
    if (!latestTask) {
      throw new GenericError(`Task ${params.id} not found after cancellation.`);
    }
    if (latestTask.status!.state != TaskState.TASK_STATE_CANCELED) {
      throw new TaskNotCancelableError(`Task not cancelable: ${params.id}`);
    }
    return latestTask;
  }

  async createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }
    const taskId = params.taskId;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${taskId}`);
    }

    await this.pushNotificationStore?.save(taskId, context, params);
    return structuredClone(params);
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }
    const taskId = params.taskId;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${taskId}`);
    }

    const configs = (await this.pushNotificationStore?.load(taskId, context)) || [];
    if (configs.length === 0) {
      throw new GenericError(`Push notification config not found for task ${taskId}.`);
    }

    const config = configs.find((c) => c.id === params.id);

    if (!config) {
      throw new GenericError(
        `Push notification config with id '${params.id}' not found for task ${taskId}.`
      );
    }
    return config;
  }

  async listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigsRequest,
    context: ServerCallContext
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }
    const taskId = params.taskId;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${taskId}`);
    }

    return {
      configs: (await this.pushNotificationStore?.load(taskId, context)) || [],
      nextPageToken: '',
    };
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    context: ServerCallContext
  ): Promise<void> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }
    const taskId = params.taskId;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${taskId}`);
    }
    await this.pushNotificationStore?.delete(taskId, context, params.id);
  }

  async *resubscribe(
    params: SubscribeToTaskRequest,
    context: ServerCallContext
  ): AsyncGenerator<StreamResponse, void, undefined> {
    if (!this.agentCard.capabilities?.streaming) {
      throw new UnsupportedOperationError('Streaming (and thus resubscription) is not supported.');
    }

    const taskId = params.id;

    // Attach to the event bus BEFORE loading the task from the store.
    // This eliminates the race condition where events published between the store
    // load and the subscription would be missed. The ExecutionEventQueue constructor
    // synchronously registers listeners, so all events from this point forward are
    // buffered in the queue's internal array.
    const eventBus = this.eventBusManager.getByTaskId(taskId);
    const eventQueue = eventBus ? new ExecutionEventQueue(eventBus) : undefined;

    try {
      const task = await this.taskStore.load(taskId, context);
      if (!task) {
        throw new TaskNotFoundError(`Task not found: ${taskId}`);
      }
      if (task.status?.state !== undefined && TERMINAL_STATE_LIST.includes(task.status.state)) {
        throw new UnsupportedOperationError(
          `Task ${taskId} is in a terminal state (${task.status.state}) and cannot be subscribed to.`
        );
      }

      // Per spec 3.1.6: "The operation MUST return a Task object as the first event
      // in the stream, representing the current state of the task at the time of
      // subscription."
      yield { payload: { $case: 'task', value: task } };

      // No active event bus means there is no live executor to drain
      // from — but per §3.1.6 the snapshot above is still a valid
      // response. Closing the stream here (instead of throwing
      // `UnsupportedOperationError`) lets clients reconnect to a
      // long-running task after server restart, executor pause, or an
      // INPUT_REQUIRED bus-sleep window.
      if (!eventQueue) {
        return;
      }

      // Stream live events, filtering by taskId.
      // The ResultManager is already handled by the original execution flow;
      // resubscribe only listens for new events.
      for await (const event of eventQueue.events()) {
        switch (event.kind) {
          case 'statusUpdate':
            if (event.data.taskId === taskId) {
              yield { payload: { $case: 'statusUpdate', value: event.data } };
            }
            break;
          case 'artifactUpdate':
            if (event.data.taskId === taskId) {
              yield { payload: { $case: 'artifactUpdate', value: event.data } };
            }
            break;
          case 'task':
            if (event.data.id === taskId) {
              yield { payload: { $case: 'task', value: event.data } };
            }
            break;
          // Messages are not yielded on resubscribe
          case 'message':
            break;
          default:
            assertUnreachableEvent(event);
        }
      }
    } finally {
      eventQueue?.stop();
    }
  }

  /**
   * Maps an AgentExecutionEvent to a StreamResponse.
   *
   * For Task events, the full task is loaded from the store to include
   * accumulated history and artifacts. For all other event types, the
   * event data is wrapped directly in a StreamResponse payload.
   */
  private async _mapEventToStreamResponse(
    event: AgentExecutionEvent,
    context: ServerCallContext
  ): Promise<StreamResponse> {
    switch (event.kind) {
      case 'task': {
        const taskId = event.data.id;
        const fullTask = await this.taskStore.load(taskId, context).catch((error): Task | null => {
          console.warn('Failed to load full task from store, falling back to event data:', error);
          return null;
        });
        return { payload: { $case: 'task', value: fullTask || event.data } };
      }
      case 'message':
        return { payload: { $case: 'message', value: event.data } };
      case 'statusUpdate':
        return { payload: { $case: 'statusUpdate', value: event.data } };
      case 'artifactUpdate':
        return { payload: { $case: 'artifactUpdate', value: event.data } };
      default:
        assertUnreachableEvent(event);
    }
  }

  /**
   * Sends a push notification if configured.
   * Fire-and-forget: push notification delivery should not block the stream or response.
   * Errors are logged but do not propagate to the caller.
   *
   * Per §4.3.3 all four `StreamResponse` payload variants (`task`,
   * `message`, `statusUpdate`, `artifactUpdate`) are valid push-notification
   * payloads. The sender silently skips stand-alone Messages that carry no
   * task association (message-only stream pattern in §3.1.2) since no
   * push config can be registered for them.
   */
  private async _sendPushNotificationIfNeeded(
    context: ServerCallContext,
    streamResponse: StreamResponse
  ): Promise<void> {
    if (this.agentCard.capabilities?.pushNotifications && this.pushNotificationSender) {
      this.pushNotificationSender.send(streamResponse, context).catch((error) => {
        console.error(`Failed to send push notification:`, error);
      });
    }
  }

  private async _handleProcessingError(
    error: unknown,
    resultManager: ResultManager,
    firstResultSent: boolean,
    taskId: string,
    firstResultRejector?: (reason: unknown) => void
  ): Promise<void> {
    // Non-blocking case with with first result not sent
    if (firstResultRejector && !firstResultSent) {
      firstResultRejector(error);
      return;
    }

    // re-throw error for blocking case to catch
    if (!firstResultRejector) {
      throw error;
    }

    // Non-blocking case with first result already sent
    const currentTask = resultManager.getCurrentTask();
    const errorMessage = (error instanceof Error && error.message) || 'Unknown error';
    if (currentTask) {
      const statusUpdateFailed: TaskStatusUpdateEvent = {
        taskId: currentTask.id,
        contextId: currentTask.contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          message: {
            role: Role.ROLE_AGENT,
            messageId: uuidv4(),
            taskId: currentTask.id,
            contextId: currentTask.contextId,
            parts: [
              {
                content: { $case: 'text', value: `Event processing loop failed: ${errorMessage}` },
                mediaType: 'text/plain',
                filename: '',
                metadata: {},
              },
            ],
            metadata: {},
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        metadata: {},
      };

      try {
        await resultManager.processEvent(AgentEvent.statusUpdate(statusUpdateFailed));
      } catch (error) {
        console.error(
          `Event processing loop failed for task ${taskId}: ${(error instanceof Error && error.message) || 'Unknown error'}`
        );
      }
    } else {
      console.error(`Event processing loop failed for task ${taskId}: ${errorMessage}`);
    }
  }

  /**
   * Advances the stream pattern state based on the incoming event per §3.1.2.
   *
   * Determines whether the event is valid for the current pattern and returns
   * the (possibly transitioned) pattern. Throws error for invalid transitions.
   */
  private _advanceStreamPattern(
    event: AgentExecutionEvent,
    currentPattern: StreamPattern
  ): StreamPattern {
    switch (currentPattern) {
      case StreamPattern.UNDETERMINED:
        if (event.kind === 'message') return StreamPattern.MESSAGE_ONLY;
        if (event.kind === 'task') return StreamPattern.TASK_LIFECYCLE;
        throw new UnsupportedOperationError(
          `Received ${event.kind} before initial 'Message'/'Task' event.`
        );

      case StreamPattern.MESSAGE_ONLY:
        throw new UnsupportedOperationError(`Received ${event.kind} after message-only response.`);

      case StreamPattern.TASK_LIFECYCLE:
        if (event.kind !== 'statusUpdate' && event.kind !== 'artifactUpdate')
          throw new UnsupportedOperationError(
            `Stream ordering violation: received ${event.kind} in task lifecycle stream.`
          );
        return currentPattern;
    }
  }

  /**
   * Apply historyLength semantics per §3.2.4:
   * - undefined: no client limit, return all history
   * - 0: omit history
   * - N > 0: return at most N most recent messages
   */
  private _applyHistoryLengthSemantics(task: Task, params: { historyLength?: number }): void {
    if (params.historyLength !== undefined) {
      if (params.historyLength <= 0) {
        task.history = [];
      } else {
        task.history = (task.history ?? []).slice(-params.historyLength);
      }
    }
  }
}

export type ExtendedAgentCardProvider = (context: ServerCallContext) => Promise<AgentCard>;

/**
 * Subscribes a lightweight listener on `bus` that records the most
 * recent task state published — either via a `Task` event or a
 * `TaskStatusUpdateEvent`. Returns a thunk that the caller invokes in
 * the executor's `.finally` block to detach the listener and read the
 * last seen state.
 *
 * Used by `_runExecutor` / `_runStreamExecutor` to decide whether to
 * tear down the bus after `execute()` returns. Reading state from the
 * `ResultManager` directly is unsafe at that point: the consumer loop
 * that drains the bus into the `ResultManager` runs in a separate
 * microtask, so the `ResultManager`'s view of the task may still lag
 * the publish call.
 */
function trackLatestTaskState(bus: ExecutionEventBus): () => TaskState | undefined {
  let lastState: TaskState | undefined;
  const listener = (event: AgentExecutionEvent) => {
    if (event.kind === 'task' && event.data.status?.state !== undefined) {
      lastState = event.data.status.state;
    } else if (event.kind === 'statusUpdate' && event.data.status?.state !== undefined) {
      lastState = event.data.status.state;
    }
  };
  bus.on('event', listener);
  // Detach the listener when the caller reads the state in `.finally()`.
  // Without this, every executor turn on a long-lived bus (kept alive
  // for INPUT_REQUIRED / AUTH_REQUIRED) would accumulate another
  // listener on the same bus.
  return () => {
    bus.off('event', listener);
    return lastState;
  };
}

/**
 * Snapshot exposed by {@link trackLatestTaskAndState}.
 */
interface LatestTaskSnapshot {
  /**
   * The most-recent `Task` event published on the bus, or `undefined`
   * if no Task event has been seen.
   */
  task: Task | undefined;
  /**
   * The most-recent task state observed on the bus — either via a
   * `Task` event or a subsequent `TaskStatusUpdateEvent`. May be more
   * recent than `task.status.state`.
   */
  state: TaskState | undefined;
}

/**
 * Subscribes a single lightweight listener on `bus` that records both:
 *
 *   * the most-recent `Task` event published, and
 *   * the most-recent task state (from `Task` or
 *     `TaskStatusUpdateEvent`, whichever is newer).
 *
 * Returns a thunk that detaches the listener and yields the snapshot.
 *
 * Combines what used to be two separate per-execution listeners into
 * one to avoid double dispatch on every `bus.publish(...)`. Used by
 * {@link DefaultRequestHandler._runStreamExecutor} to make two
 * decisions in the executor's `.finally` / `.catch` blocks:
 *
 *   1. Whether to settle the bus or keep it alive for follow-ups
 *      (driven by `state`).
 *   2. Whether to synthesize a Task event before the terminal
 *      statusUpdate on the error path (driven by `task`).
 *
 * Reading state from `ResultManager` would be unsafe at the point we
 * need to make these decisions: the consumer loop that drains the bus
 * into `ResultManager` runs in a separate microtask, so an executor
 * that synchronously `bus.publish(...)`s a Task and then throws would
 * appear (via `ResultManager`) to have published nothing — and we'd
 * incorrectly re-publish a Task, violating the §3.1.2 stream-pattern
 * ordering enforced by `_advanceStreamPattern`.
 *
 * Detach contract: the returned thunk must be invoked exactly once,
 * in a `.finally` block, so the listener is removed regardless of
 * whether the executor succeeded or threw. Otherwise long-lived buses
 * (kept alive for INPUT_REQUIRED / AUTH_REQUIRED) would accumulate
 * one listener per turn. The thunk's `bus.off` is idempotent at the
 * bus level, so an extra read after the listener is already detached
 * just returns the last-known snapshot.
 */
function trackLatestTaskAndState(bus: ExecutionEventBus): () => LatestTaskSnapshot {
  let lastTask: Task | undefined;
  let lastState: TaskState | undefined;
  const listener = (event: AgentExecutionEvent) => {
    if (event.kind === 'task') {
      lastTask = event.data;
      if (event.data.status?.state !== undefined) {
        lastState = event.data.status.state;
      }
    } else if (event.kind === 'statusUpdate' && event.data.status?.state !== undefined) {
      lastState = event.data.status.state;
    }
  };
  bus.on('event', listener);
  return () => {
    bus.off('event', listener);
    return { task: lastTask, state: lastState };
  };
}

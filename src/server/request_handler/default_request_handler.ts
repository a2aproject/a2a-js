import { v4 as uuidv4 } from 'uuid';

import {
  A2AError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '../../errors/index.js';

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
import { extractErrorMessage } from '../../errors/index.js';

/**
 * Default implementation of the A2A request handler.
 *
 * Multi-tenant deployments: the transport layer extracts the tenant from
 * its protocol-specific source (REST path prefix, JSON-RPC `params.tenant`,
 * gRPC `tenant` field) and propagates it via `ServerCallContext.tenant`.
 * The built-in `InMemoryTaskStore` and `InMemoryPushNotificationStore`
 * scope data by `tenant` to provide isolation.
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
    request: SendMessageRequest,
    context: ServerCallContext
  ): Promise<RequestContext> {
    const incomingMessage = request.message;
    if (!incomingMessage) {
      throw new RequestMalformedError('request.message is required.');
    }
    let task: Task | undefined;
    let referenceTasks: Task[] | undefined;

    if (incomingMessage.taskId) {
      task = await this.taskStore.load(incomingMessage.taskId, context);
      if (!task) {
        throw new TaskNotFoundError(`Task not found: ${incomingMessage.taskId}`);
      }
      if (task.status?.state !== undefined && TERMINAL_STATE_LIST.includes(task.status.state)) {
        // UnsupportedOperationError is what the TCK expects for terminal tasks.
        throw new UnsupportedOperationError(
          `Task ${task.id} is in a terminal state (${task.status!.state}) and cannot be modified.`
        );
      }
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
      task.history = [...(task.history || []), incomingMessage];
      await this.taskStore.save(task, context);
    }
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
        }
      }
    }
    const contextId = incomingMessage.contextId || task?.contextId || uuidv4();

    const agentCard = await this.getAgentCard();
    const agentExtensions = agentCard.capabilities?.extensions ?? [];

    // The client MUST declare support for every required extension.
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
    // exposes. Mutate in place — the transport layer holds a reference
    // to this context and reads `activatedExtensions` off it after
    // dispatch to populate the response `A2A-Extensions` header.
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
    // Rebuild the request with the enriched message so downstream
    // consumers see the resolved task/context IDs on `userMessage`.
    const resolvedRequest: SendMessageRequest = {
      ...request,
      message: messageForContext,
    };
    return new RequestContext(resolvedRequest, taskId, contextId, context, task, referenceTasks);
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
       * Fires (at most once) the first time the queue yields a
       * `statusUpdate` whose state is in
       * {@link AUTH_REQUIRED_STATE_LIST}. The callback receives a deep
       * snapshot of the current Task. The drain loop continues
       * iterating after invocation so the agent can resume publishing
       * on the same bus once the credential is injected out-of-band.
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

        // AUTH_REQUIRED snapshot: hand the blocking caller a copy of
        // the current Task, but DO NOT break out of the loop — the
        // queue keeps yielding past AUTH_REQUIRED so the executor can
        // resume publishing once the credential arrives out-of-band.
        if (
          options?.authRequiredSnapshotResolver &&
          !authRequiredSnapshotSent &&
          event.kind === 'statusUpdate' &&
          event.data.status &&
          AUTH_REQUIRED_STATE_LIST.includes(event.data.status.state)
        ) {
          const currentTask = resultManager.getCurrentTask();
          if (currentTask) {
            // Deep-clone so the continuing drain can't mutate the
            // snapshot the caller has already received.
            options.authRequiredSnapshotResolver(structuredClone(currentTask));
            authRequiredSnapshotSent = true;
            // The caller has been handed a result (the snapshot).
            // Setting `firstResultSent` routes any subsequent drain
            // error to the "first result already sent" branch in
            // `_handleProcessingError`, which persists a FAILED
            // status update via ResultManager instead of re-throwing
            // into the unattended background drain.
            firstResultSent = true;
          }
        }
      }
      // Non-blocking contract guard: if the caller wired a
      // `firstResultResolver` and the executor returned without
      // publishing a Task/Message, surface the protocol violation.
      // Gated on `firstResultResolver` (not `firstResultRejector`) so
      // the blocking caller doesn't trip this on a normal
      // INPUT_REQUIRED / terminal exit.
      if (options?.firstResultResolver && options?.firstResultRejector && !firstResultSent) {
        options.firstResultRejector(
          new RequestMalformedError('Execution finished before a message or task was produced.')
        );
      }
    } catch (error) {
      console.error(`Event processing loop failed for task ${taskId}:`, error);
      // Must be awaited: `_handleProcessingError` re-throws in the blocking
      // (no `firstResultRejector`) case so the caller's `await` catches it.
      // Without `await`, that throw escapes as a floating rejection and the
      // caller (e.g. `cancelTask`'s drain) resolves as if nothing failed.
      await this._handleProcessingError(
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
   * Attaches a `.catch` so a thrown error in the unattended drain is
   * logged instead of surfacing as a Node `unhandledRejection`.
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
   * event bus lifecycle to the executor's settlement. On rejection,
   * publishes a synthetic Task + statusUpdate(FAILED) so the consumer's
   * event loop terminates with a usable final result and any concurrent
   * resubscribers see the failure on the same wire.
   */
  private _runExecutor(
    taskId: string,
    eventBus: ExecutionEventBus,
    requestContext: RequestContext,
    finalMessageForAgent: Message
  ): void {
    // Track the last task state on the bus directly: the consumer loop
    // that drains into `ResultManager` runs in a separate microtask, so
    // by the time `.finally()` runs the ResultManager's view may lag.
    const stateTracker = trackLatestTaskState(eventBus);
    this.agentExecutor
      .execute(requestContext, eventBus)
      .catch((err: unknown) => {
        // Promises can reject with any value, so coerce defensively
        // before reading `.message`.
        const errorMessage = extractErrorMessage(err);
        console.error(`Agent execution failed for message ${finalMessageForAgent.messageId}:`, err);
        // The synthetic Task id MUST be `requestContext.taskId` — the
        // id the bus is registered under and the id we hand back to
        // the client. A fresh uuid would make the returned Task
        // unreachable via `getTask`.
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
        // Close the bus for terminal tasks; keep it alive for
        // INPUT_REQUIRED / AUTH_REQUIRED so follow-up sends and
        // resubscribers can still attach.
        this._settleBus(taskId, eventBus, stateTracker());
      });
  }

  /**
   * Settles the event bus once the executor returns. Terminal states
   * (and the bare-Message stream pattern) close the bus immediately;
   * interrupted states (INPUT_REQUIRED, AUTH_REQUIRED) keep it alive
   * so follow-up sends and resubscribers can still attach.
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
   * Streaming variant of {@link _runExecutor}. If the executor threw
   * before publishing any Task event, synthesizes both the Task and a
   * statusUpdate(FAILED) so the SSE consumer sees a well-formed
   * task-lifecycle stream that terminates in FAILED. If a Task was
   * already published, only the statusUpdate is synthesized to avoid
   * violating the task-lifecycle ordering.
   */
  private _runStreamExecutor(
    taskId: string,
    eventBus: ExecutionEventBus,
    requestContext: RequestContext
  ): void {
    const finalMessageForAgent = requestContext.userMessage;
    const snapshotTracker = trackLatestTaskAndState(eventBus);
    this.agentExecutor
      .execute(requestContext, eventBus)
      .catch((err: unknown) => {
        const errorMessage = extractErrorMessage(err);
        console.error(
          `Agent execution failed for stream message ${finalMessageForAgent.messageId}:`,
          err
        );

        const latestTask = snapshotTracker().task;
        const errorTaskId = latestTask?.id ?? requestContext.taskId;
        const errorContextId = latestTask?.contextId ?? finalMessageForAgent.contextId!;

        // If no Task event has been published yet, synthesize one
        // first so the SSE consumer's stream pattern transitions into
        // TASK_LIFECYCLE before the statusUpdate(FAILED) lands.
        // Otherwise the executor would silently close an empty stream
        // and the client would have no signal that the request failed.
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
    const resultManager = new ResultManager(this.taskStore, context);
    resultManager.setContext(incomingMessage);

    const requestContext = await this._createRequestContext(params, context);
    const taskId = requestContext.taskId;
    const finalMessageForAgent = requestContext.userMessage;

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
    // Attach the queue before kicking off the executor so no events are missed.
    const eventQueue = new ExecutionEventQueue(eventBus);

    // Run the executor in the background. Bus cleanup is tied to the
    // executor's lifecycle, not the consumer's, so a `tasks/resubscribe`
    // arriving after the consumer settles can still find the bus while
    // the executor is still publishing.
    this._runExecutor(taskId, eventBus, requestContext, finalMessageForAgent);

    const historyLengthConfig = params.configuration;

    if (isBlocking) {
      // Blocking mode normally resolves after the full event drain
      // finishes. AUTH_REQUIRED is the exception: the caller is handed
      // a snapshot as soon as the AUTH_REQUIRED status update is
      // observed, and the drain detaches into the background so the
      // executor can keep publishing on the same bus.
      return new Promise<Message | Task>((resolve, reject) => {
        const pending = this._processEvents(taskId, resultManager, eventQueue, context, {
          authRequiredSnapshotResolver: (snapshot) => {
            this._applyHistoryLengthSemantics(snapshot, historyLengthConfig ?? {});
            resolve(snapshot);
            this._continueDraining(taskId, pending);
          },
          // Pre-AUTH_REQUIRED drain errors reject the outer promise so
          // `await sendMessage(...)` throws. Post-AUTH_REQUIRED drain
          // errors fall into `_handleProcessingError`'s "first result
          // already sent" branch (persisting FAILED via ResultManager)
          // and the `reject` call here becomes a no-op because Promise
          // settlement is one-shot.
          firstResultRejector: reject,
        });
        pending
          .then(() => {
            const finalResult = resultManager.getFinalResult();
            if (!finalResult) {
              reject(
                new A2AError(
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
      // Non-blocking mode resolves with the first task/message event.
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
      throw new RequestMalformedError('message.messageId is required for streaming.');
    }

    const resultManager = new ResultManager(this.taskStore, context);
    resultManager.setContext(incomingMessage);

    const requestContext = await this._createRequestContext(params, context);
    const taskId = requestContext.taskId;

    const eventBus = this.eventBusManager.createOrGetByTaskId(taskId);
    const eventQueue = new ExecutionEventQueue(eventBus);

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

    // Run the executor in the background. Bus cleanup is tied to the
    // executor's lifecycle, not the consumer's, so a client that
    // disconnects this stream early can still attach via
    // `tasks/resubscribe` while the executor keeps running.
    this._runStreamExecutor(taskId, eventBus, requestContext);

    let streamPattern = StreamPattern.UNDETERMINED;
    try {
      for await (const event of eventQueue.events()) {
        streamPattern = this._advanceStreamPattern(event, streamPattern);

        await resultManager.processEvent(event);

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
      // Detach THIS consumer's queue; the bus stays alive until the
      // executor settles.
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

    // Cancel is idempotent — a second cancel on a canceled task returns
    // the snapshot. Other terminal states are not cancelable.
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
      // Drain until the task reaches a terminal state.
      await this._processEvents(
        taskId,
        new ResultManager(this.taskStore, context),
        eventQueue,
        context
      );
    } else {
      // Mark the task as cancelled directly. We do not wait for the
      // executor to actually cancel processing.
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
      if (task.status?.message) {
        task.history = [...(task.history || []), task.status.message];
      }

      await this.taskStore.save(task, context);
    }

    const latestTask = await this.taskStore.load(taskId, context);
    if (!latestTask) {
      throw new A2AError(`Task ${params.id} not found after cancellation.`);
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
      throw new A2AError(`Push notification config not found for task ${taskId}.`);
    }

    const config = configs.find((c) => c.id === params.id);

    if (!config) {
      throw new A2AError(
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

    // Attach to the event bus BEFORE loading the task from the store so
    // we don't miss events published between the load and subscription.
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

      // The first event MUST be a Task representing the current state at
      // the time of subscription.
      yield { payload: { $case: 'task', value: task } };

      // No active event bus means no live executor to drain from — but
      // the snapshot above is still a valid response. Closing the stream
      // here (instead of throwing) lets clients reconnect to a
      // long-running task after server restart, executor pause, or an
      // INPUT_REQUIRED bus-sleep window.
      if (!eventQueue) {
        return;
      }

      // Resubscribe only forwards new bus events; the ResultManager is
      // already handled by the original execution flow.
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
          case 'message':
            // Messages are not yielded on resubscribe.
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
   * Maps an {@link AgentExecutionEvent} to a `StreamResponse`. For Task
   * events the full task is loaded from the store to include accumulated
   * history and artifacts.
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
   * Fire-and-forget push notification dispatch. Delivery must not block
   * the stream or response; errors are logged but do not propagate. The
   * sender silently skips stand-alone Messages that carry no task
   * association (no push config can be registered for them).
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
    // Non-blocking, first result not yet sent: reject the caller's promise.
    if (firstResultRejector && !firstResultSent) {
      firstResultRejector(error);
      return;
    }

    // Blocking: re-throw so the caller's await catches it.
    if (!firstResultRejector) {
      throw error;
    }

    // Non-blocking, first result already sent: persist a FAILED status
    // update instead of re-throwing into the unattended background drain.
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
   * Advances the stream pattern state based on the incoming event.
   * Returns the (possibly transitioned) pattern; throws on invalid
   * transitions.
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
   * Applies `historyLength` semantics:
   * - undefined: return all history
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
 * Subscribes a lightweight listener on `bus` that records the most-recent
 * task state published. Returns a thunk to invoke in the executor's
 * `.finally` block to detach the listener and read the last seen state.
 * Used by `_runExecutor` to decide whether to tear down the bus after
 * `execute()` returns.
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
  // Without detaching, long-lived buses kept alive for INPUT_REQUIRED /
  // AUTH_REQUIRED would accumulate a listener per executor turn.
  return () => {
    bus.off('event', listener);
    return lastState;
  };
}

interface LatestTaskSnapshot {
  /** Most-recent `Task` event published, or `undefined`. */
  task: Task | undefined;
  /**
   * Most-recent task state observed on the bus (from a `Task` or
   * `TaskStatusUpdateEvent`, whichever is newer). May be ahead of
   * `task.status.state`.
   */
  state: TaskState | undefined;
}

/**
 * Like {@link trackLatestTaskState} but also records the most-recent
 * `Task` event. Used by `_runStreamExecutor` to decide both whether to
 * settle the bus and whether to synthesize a Task event before the
 * terminal statusUpdate on the error path. Reading state from
 * `ResultManager` here would be unsafe because its consumer loop runs in
 * a separate microtask: an executor that synchronously publishes a Task
 * and then throws would appear to have published nothing.
 *
 * The returned thunk must be invoked exactly once in a `.finally` block
 * so the listener is removed even if the executor threw.
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

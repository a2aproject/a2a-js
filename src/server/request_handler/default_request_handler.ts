import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  RequestMalformedError,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  GenericError,
  ExtendedAgentCardNotConfiguredError,
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
import { TERMINAL_STATE_LIST } from '../utils.js';

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

  constructor(
    agentCard: AgentCard,
    taskStore: TaskStore,
    agentExecutor: AgentExecutor,
    eventBusManager: ExecutionEventBusManager = new DefaultExecutionEventBusManager(),
    pushNotificationStore?: PushNotificationStore,
    pushNotificationSender?: PushNotificationSender,
    extendedAgentCardProvider?: AgentCard | ExtendedAgentCardProvider
  ) {
    this.agentCard = agentCard;
    this.taskStore = taskStore;
    this.agentExecutor = agentExecutor;
    this.eventBusManager = eventBusManager;
    this.extendedAgentCardProvider = extendedAgentCardProvider;

    // If push notifications are supported, use the provided store and sender.
    // Otherwise, use the default in-memory store and sender.
    if (agentCard.capabilities?.pushNotifications) {
      this.pushNotificationStore = pushNotificationStore || new InMemoryPushNotificationStore();
      this.pushNotificationSender =
        pushNotificationSender || new DefaultPushNotificationSender(this.pushNotificationStore);
    }
  }

  async getAgentCard(): Promise<AgentCard> {
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
    if (typeof this.extendedAgentCardProvider === 'function') {
      return this.extendedAgentCardProvider(context);
    }
    if (context.user?.isAuthenticated) {
      return this.extendedAgentCardProvider;
    }
    return this.agentCard;
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

    // Validate requested extensions against agent capabilities
    if (context.requestedExtensions) {
      const agentCard = await this.getAgentCard();
      const exposedExtensions = new Set(
        agentCard.capabilities?.extensions?.map((ext) => ext.uri) || []
      );
      const validExtensions = context.requestedExtensions.filter((extension) =>
        exposedExtensions.has(extension)
      );
      context = new ServerCallContext({
        requestedExtensions: validExtensions,
        user: context.user,
        requestedVersion: context.requestedVersion,
        tenant: context.tenant,
      });
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
      firstResultResolver?: (value: Message | Task | PromiseLike<Message | Task>) => void;
      firstResultRejector?: (reason?: unknown) => void;
    }
  ): Promise<void> {
    let firstResultSent = false;
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
      }
      if (options?.firstResultRejector && !firstResultSent) {
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
      this.eventBusManager.cleanupByTaskId(taskId);
    }
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
    this.agentExecutor.execute(requestContext, eventBus).catch((err) => {
      console.error(`Agent execution failed for message ${finalMessageForAgent.messageId}:`, err);
      // Publish a synthetic error event, which will be handled by the ResultManager
      // and will also settle the firstResultPromise for non-blocking calls.
      const errorTask: Task = {
        id: requestContext.task?.id || uuidv4(), // Use existing task ID or generate new
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
                content: { $case: 'text', value: `Agent execution error: ${err.message}` },
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
      if (finalMessageForAgent) {
        // Add incoming message to history
        if (!errorTask.history?.find((m) => m.messageId === finalMessageForAgent.messageId)) {
          errorTask.history?.push(finalMessageForAgent);
        }
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
      eventBus.finished();
    });

    if (isBlocking) {
      // In blocking mode, wait for the full processing to complete.
      await this._processEvents(taskId, resultManager, eventQueue, context);
      const finalResult = resultManager.getFinalResult();
      if (!finalResult) {
        throw new GenericError(
          'Agent execution finished without a result, and no task context found.'
        );
      }

      return finalResult;
    } else {
      // In non-blocking mode, return a promise that will be settled by fullProcessing.
      return new Promise<Message | Task>((resolve, reject) => {
        this._processEvents(taskId, resultManager, eventQueue, context, {
          firstResultResolver: resolve,
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
    const finalMessageForAgent = requestContext.userMessage;

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

    // Start agent execution (non-blocking)
    this.agentExecutor.execute(requestContext, eventBus).catch((err) => {
      console.error(
        `Agent execution failed for stream message ${finalMessageForAgent.messageId}:`,
        err
      );
      // Publish a synthetic error event if needed
      const errorTaskStatus: TaskStatusUpdateEvent = {
        taskId: requestContext.task?.id || uuidv4(), // Use existing or a placeholder
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
                content: { $case: 'text', value: `Agent execution error: ${err.message}` },
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
    });

    try {
      for await (const event of eventQueue.events()) {
        await resultManager.processEvent(event); // Update store in background
        const streamResponse = await this._mapEventToStreamResponse(event, context);
        await this._sendPushNotificationIfNeeded(context, streamResponse);
        yield streamResponse;
      }
    } finally {
      // Cleanup when the stream is fully consumed or breaks
      this.eventBusManager.cleanupByTaskId(taskId);
    }
  }

  async getTask(params: GetTaskRequest, context: ServerCallContext): Promise<Task> {
    const taskId = params.id;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${params.id}`);
    }
    if (params.historyLength !== undefined && params.historyLength >= 0) {
      if (task.history) {
        task.history = task.history.slice(-params.historyLength);
      }
    } else {
      // Negative or invalid historyLength means no history
      task.history = [];
    }
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

    return this.taskStore.list({ ...params, pageSize }, context);
  }

  async cancelTask(params: CancelTaskRequest, context: ServerCallContext): Promise<Task> {
    const taskId = params.id;
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${params.id}`);
    }

    // Check if task is in a cancelable state
    if (TERMINAL_STATE_LIST.includes(task.status!.state)) {
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

    return params;
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

      if (!eventQueue) {
        throw new UnsupportedOperationError(`Resubscribe: No active event bus for task ${taskId}.`);
      }

      // Per spec 3.1.6: "The operation MUST return a Task object as the first event
      // in the stream, representing the current state of the task at the time of
      // subscription."
      yield { payload: { $case: 'task', value: task } };

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
}

export type ExtendedAgentCardProvider = (context: ServerCallContext) => Promise<AgentCard>;

import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import { A2AError } from '../error.js';

import {
  Message,
  AgentCard,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Role,
  TaskPushNotificationConfig,
  SendMessageRequest,
  GetTaskRequest,
  CancelTaskRequest,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  TaskSubscriptionRequest,
} from '../../index.js';
import { AgentExecutor } from '../agent_execution/agent_executor.js';
import { RequestContext } from '../agent_execution/request_context.js';
import {
  ExecutionEventBusManager,
  DefaultExecutionEventBusManager,
} from '../events/execution_event_bus_manager.js';
import { AgentExecutionEvent } from '../events/execution_event_bus.js';
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
import {
  extractTaskAndPushNotificationConfigId,
  extractTaskId,
} from '../../types/converters/id_decoding.js';

const terminalStates: TaskState[] = [
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELLED,
  TaskState.TASK_STATE_REJECTED,
];

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

  async getAuthenticatedExtendedAgentCard(context?: ServerCallContext): Promise<AgentCard> {
    if (!this.agentCard.supportsAuthenticatedExtendedCard) {
      throw A2AError.unsupportedOperation('Agent does not support authenticated extended card.');
    }
    if (!this.extendedAgentCardProvider) {
      throw A2AError.authenticatedExtendedCardNotConfigured();
    }
    if (typeof this.extendedAgentCardProvider === 'function') {
      return this.extendedAgentCardProvider(context);
    }
    if (context?.user?.isAuthenticated) {
      return this.extendedAgentCardProvider;
    }
    return this.agentCard;
  }

  private async _createRequestContext(
    incomingMessage: Message,
    context?: ServerCallContext
  ): Promise<RequestContext> {
    let task: Task | undefined;
    let referenceTasks: Task[] | undefined;

    // incomingMessage would contain taskId, if a task already exists.
    if (incomingMessage.taskId) {
      task = await this.taskStore.load(incomingMessage.taskId, context);
      if (!task) {
        throw A2AError.taskNotFound(incomingMessage.taskId);
      }
      if (task.status?.state !== undefined && terminalStates.includes(task.status.state)) {
        // Throw an error that conforms to the JSON-RPC Invalid Request error specification.
        throw A2AError.invalidRequest(
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
    if (context?.requestedExtensions) {
      const agentCard = await this.getAgentCard();
      const exposedExtensions = new Set(
        agentCard.capabilities?.extensions?.map((ext) => ext.uri) || []
      );
      const validExtensions = context.requestedExtensions.filter((extension) =>
        exposedExtensions.has(extension)
      );
      context = new ServerCallContext(validExtensions, context.user);
    }

    const messageForContext = {
      ...incomingMessage,
      contextId,
      taskId,
    };
    return new RequestContext(messageForContext, taskId, contextId, task, referenceTasks, context);
  }

  private async _processEvents(
    taskId: string,
    resultManager: ResultManager,
    eventQueue: ExecutionEventQueue,
    context: ServerCallContext | undefined,
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
          await this._sendPushNotificationIfNeeded(event, context);
        } catch (error) {
          console.error(`Error sending push notification: ${error}`);
        }

        if (options?.firstResultResolver && !firstResultSent) {
          let firstResult: Message | Task | undefined;
          if ('messageId' in event) {
            firstResult = event;
          } else if ('artifacts' in event) {
            firstResult = event as Task;
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
          A2AError.internalError('Execution finished before a message or task was produced.')
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
    context?: ServerCallContext
  ): Promise<Message | Task> {
    const incomingMessage = params.request;
    if (!incomingMessage?.messageId) {
      throw A2AError.invalidParams('message.messageId is required.');
    }

    // Default to blocking behavior if 'blocking' is not explicitly false.
    const isBlocking = params.configuration?.blocking !== false;
    // Instantiate ResultManager before creating RequestContext
    const resultManager = new ResultManager(this.taskStore, context);
    resultManager.setContext(incomingMessage); // Set context for ResultManager

    const requestContext = await this._createRequestContext(incomingMessage, context);
    const taskId = requestContext.taskId;

    // Use the (potentially updated) contextId from requestContext
    const finalMessageForAgent = requestContext.userMessage;

    // If push notification config is provided, save it to the store.
    if (params.configuration?.pushNotification && this.agentCard.capabilities?.pushNotifications) {
      await this.pushNotificationStore?.save(taskId, params.configuration.pushNotification);
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
          update: {
            role: Role.ROLE_AGENT,
            messageId: uuidv4(),
            content: [{ part: { $case: 'text', value: `Agent execution error: ${err.message}` } }],
            taskId: requestContext.taskId,
            contextId: finalMessageForAgent.contextId!,
            extensions: [],
            metadata: {},
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
      eventBus.publish(errorTask);
      eventBus.publish({
        taskId: errorTask.id,
        contextId: errorTask.contextId,
        status: errorTask.status,
        final: true,
        metadata: {},
      } as TaskStatusUpdateEvent);
      eventBus.finished();
    });

    if (isBlocking) {
      // In blocking mode, wait for the full processing to complete.
      await this._processEvents(taskId, resultManager, eventQueue, context);
      const finalResult = resultManager.getFinalResult();
      if (!finalResult) {
        throw A2AError.internalError(
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
    context?: ServerCallContext
  ): AsyncGenerator<
    Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
    void,
    undefined
  > {
    const incomingMessage = params.request;
    if (!incomingMessage?.messageId) {
      // For streams, messageId might be set by client, or server can generate if not present.
      // Let's assume client provides it or throw for now.
      throw A2AError.invalidParams('message.messageId is required for streaming.');
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
    if (params.configuration?.pushNotification && this.agentCard.capabilities?.pushNotifications) {
      await this.pushNotificationStore?.save(taskId, params.configuration.pushNotification);
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
          update: {
            role: Role.ROLE_AGENT,
            messageId: uuidv4(),
            content: [{ part: { $case: 'text', value: `Agent execution error: ${err.message}` } }],
            taskId: requestContext.taskId,
            contextId: finalMessageForAgent.contextId!,
            extensions: [],
            metadata: {},
          },
          timestamp: new Date().toISOString(),
        },
        final: true, // This will terminate the stream for the client
        metadata: {},
      };
      eventBus.publish(errorTaskStatus);
    });

    try {
      for await (const event of eventQueue.events()) {
        await resultManager.processEvent(event); // Update store in background
        await this._sendPushNotificationIfNeeded(event, context);
        yield event; // Stream the event to the client
      }
    } finally {
      // Cleanup when the stream is fully consumed or breaks
      this.eventBusManager.cleanupByTaskId(taskId);
    }
  }

  async getTask(params: GetTaskRequest, context?: ServerCallContext): Promise<Task> {
    const taskId = extractTaskId(params.name);
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(params.name);
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

  async cancelTask(params: CancelTaskRequest, context?: ServerCallContext): Promise<Task> {
    const taskId = extractTaskId(params.name);
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(params.name);
    }

    // Check if task is in a cancelable state
    if (terminalStates.includes(task.status!.state)) {
      throw A2AError.taskNotCancelable(params.name);
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
        state: TaskState.TASK_STATE_CANCELLED,
        update: {
          // Optional: Add a system message indicating cancellation
          role: Role.ROLE_AGENT,
          messageId: uuidv4(),
          content: [{ part: { $case: 'text', value: 'Task cancellation requested by user.' } }],
          taskId: task.id,
          contextId: task.contextId,
          extensions: [],
          metadata: {},
        },
        timestamp: new Date().toISOString(),
      };
      // Add cancellation message to history
      if (task.status?.update) {
        task.history = [...(task.history || []), task.status.update];
      }

      await this.taskStore.save(task, context);
    }

    const latestTask = await this.taskStore.load(taskId, context);
    if (!latestTask) {
      throw A2AError.internalError(`Task ${params.name} not found after cancellation.`);
    }
    if (latestTask.status!.state != TaskState.TASK_STATE_CANCELLED) {
      throw A2AError.taskNotCancelable(params.name);
    }
    return latestTask;
  }

  async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(params.name);
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(taskId);
    }

    const pushNotificationConfig = params.pushNotificationConfig;

    if (!pushNotificationConfig) {
      throw A2AError.invalidParams('pushNotificationConfig is required.');
    }

    // Default the config ID to the task ID if not provided for backward compatibility.
    if (!pushNotificationConfig.id) {
      pushNotificationConfig.id = configId;
    }

    await this.pushNotificationStore?.save(taskId, pushNotificationConfig);

    return params;
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const { taskId, configId: legacyConfigId } = extractTaskAndPushNotificationConfigId(
      params.name
    );
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(taskId);
    }

    const configs = (await this.pushNotificationStore?.load(taskId)) || [];
    if (configs.length === 0) {
      throw A2AError.internalError(`Push notification config not found for task ${taskId}.`);
    }

    let configId: string;
    if ('pushNotificationConfigId' in params && params.pushNotificationConfigId) {
      configId = params.pushNotificationConfigId as string;
    } else {
      // For backward compatibility, if no config ID is given, assume it's the task ID.
      configId = legacyConfigId;
    }

    const config = configs.find((c) => c.id === configId);

    if (!config) {
      throw A2AError.internalError(
        `Push notification config with id '${configId}' not found for task ${taskId}.`
      );
    }
    return {
      name: `tasks/${taskId}/pushNotificationConfigs/${configId}`,
      pushNotificationConfig: config,
    };
  }

  async listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigRequest,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig[]> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const taskId = extractTaskId(params.parent);
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(taskId);
    }

    const configs = (await this.pushNotificationStore?.load(taskId)) || [];

    return configs.map((config) => ({
      name: `tasks/${taskId}/pushNotificationConfigs/${config.id}`,
      pushNotificationConfig: config,
    }));
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    context?: ServerCallContext
  ): Promise<void> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(params.name);
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(taskId);
    }

    await this.pushNotificationStore?.delete(taskId, configId);
  }

  async *resubscribe(
    params: TaskSubscriptionRequest,
    context?: ServerCallContext
  ): AsyncGenerator<
    | Task // Initial task state
    | TaskStatusUpdateEvent
    | TaskArtifactUpdateEvent,
    void,
    undefined
  > {
    if (!this.agentCard.capabilities?.streaming) {
      throw A2AError.unsupportedOperation('Streaming (and thus resubscription) is not supported.');
    }

    const taskId = extractTaskId(params.name);
    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(taskId);
    }

    // Yield the current task state first
    yield task;

    // If task is already in a final state, no more events will come.
    if (terminalStates.includes(task.status!.state)) {
      return;
    }

    const eventBus = this.eventBusManager.getByTaskId(taskId);
    if (!eventBus) {
      // No active execution for this task, so no live events.
      console.warn(`Resubscribe: No active event bus for task ${taskId}.`);
      return;
    }

    // Attach a new queue to the existing bus for this resubscription
    const eventQueue = new ExecutionEventQueue(eventBus);
    // Note: The ResultManager part is already handled by the original execution flow.
    // Resubscribe just listens for new events.

    try {
      for await (const event of eventQueue.events()) {
        // We only care about updates related to *this* task.
        // The event bus might be shared if messageId was reused, though
        // ExecutionEventBusManager tries to give one bus per original message.
        if ('status' in event && 'taskId' in event && event.taskId === taskId) {
          yield event as TaskStatusUpdateEvent;
        } else if ('artifact' in event && event.taskId === taskId) {
          yield event as TaskArtifactUpdateEvent;
        } else if ('artifacts' in event && (event as Task).id === taskId) {
          // This implies the task was re-emitted, yield it.
          yield event as Task;
        }
        // We don't yield 'message' events on resubscribe typically,
        // as those signal the end of an interaction for the *original* request.
        // If a 'message' event for the original request terminates the bus, this loop will also end.
      }
    } finally {
      eventQueue.stop();
    }
  }

  private async _sendPushNotificationIfNeeded(
    event: AgentExecutionEvent,
    context: ServerCallContext | undefined
  ): Promise<void> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      return;
    }

    let taskId: string = '';
    if ('artifacts' in event) {
      const task = event as Task;
      taskId = task.id;
    } else {
      taskId = event.taskId;
    }

    if (!taskId) {
      console.error(`Task ID not found for event.`);
      return;
    }

    const task = await this.taskStore.load(taskId, context);
    if (!task) {
      console.error(`Task ${taskId} not found.`);
      return;
    }

    // Send push notification in the background.
    this.pushNotificationSender?.send(task);
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
          update: {
            role: Role.ROLE_AGENT,
            messageId: uuidv4(),
            content: [
              { part: { $case: 'text', value: `Event processing loop failed: ${errorMessage}` } },
            ],
            taskId: currentTask.id,
            contextId: currentTask.contextId,
            extensions: [],
            metadata: {},
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: {},
      };

      try {
        await resultManager.processEvent(statusUpdateFailed);
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

export type ExtendedAgentCardProvider = (context?: ServerCallContext) => Promise<AgentCard>;

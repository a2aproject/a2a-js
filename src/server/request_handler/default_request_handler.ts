import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  Message,
  AgentCard,
  Task,
  MessageSendParams,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskQueryParams,
  TaskIdParams,
  TaskPushNotificationConfig,
  DeleteTaskPushNotificationConfigParams,
  GetTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
} from '../../types.js';
import { AgentExecutor } from '../agent_execution/agent_executor.js';
import { RequestContext } from '../agent_execution/request_context.js';
import { A2AError } from '../error.js';
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

const terminalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected'];

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
    if (agentCard.capabilities.pushNotifications) {
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
      if (terminalStates.includes(task.status.state)) {
        // Throw an error that conforms to the JSON-RPC Invalid Request error specification.
        throw A2AError.invalidRequest(
          `Task ${task.id} is in a terminal state (${task.status.state}) and cannot be modified.`
        );
      }
      // Add incomingMessage to history and save the task.
      task.history = [...(task.history || []), incomingMessage];
      await this.taskStore.save(task, context);
    }
    // Ensure taskId is present
    const taskId = incomingMessage.taskId || uuidv4();

    if (incomingMessage.referenceTaskIds && incomingMessage.referenceTaskIds.length > 0) {
      referenceTasks = [];
      for (const refId of incomingMessage.referenceTaskIds) {
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
        agentCard.capabilities.extensions?.map((ext) => ext.uri) || []
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
          if (event.kind === 'message') {
            firstResult = event;
          } else {
            firstResult = resultManager.getCurrentTask();
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
    params: MessageSendParams,
    context?: ServerCallContext
  ): Promise<Message | Task> {
    const incomingMessage = params.message;
    if (!incomingMessage.messageId) {
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
    if (
      params.configuration?.pushNotificationConfig &&
      this.agentCard.capabilities.pushNotifications
    ) {
      await this.pushNotificationStore?.save(taskId, params.configuration.pushNotificationConfig);
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
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: `Agent execution error: ${err.message}` }],
            taskId: requestContext.task?.id,
            contextId: finalMessageForAgent.contextId!,
          },
          timestamp: new Date().toISOString(),
        },
        history: requestContext.task?.history ? [...requestContext.task.history] : [],
        kind: 'task',
      };
      if (finalMessageForAgent) {
        // Add incoming message to history
        if (!errorTask.history?.find((m) => m.messageId === finalMessageForAgent.messageId)) {
          errorTask.history?.push(finalMessageForAgent);
        }
      }
      eventBus.publish(errorTask);
      eventBus.publish({
        // And publish a final status update
        kind: 'status-update',
        taskId: errorTask.id,
        contextId: errorTask.contextId,
        status: errorTask.status,
        final: true,
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
    params: MessageSendParams,
    context?: ServerCallContext
  ): AsyncGenerator<
    Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
    void,
    undefined
  > {
    const incomingMessage = params.message;
    if (!incomingMessage.messageId) {
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
    if (
      params.configuration?.pushNotificationConfig &&
      this.agentCard.capabilities.pushNotifications
    ) {
      await this.pushNotificationStore?.save(taskId, params.configuration.pushNotificationConfig);
    }

    // Start agent execution (non-blocking)
    this.agentExecutor.execute(requestContext, eventBus).catch((err) => {
      console.error(
        `Agent execution failed for stream message ${finalMessageForAgent.messageId}:`,
        err
      );
      // Publish a synthetic error event if needed
      const errorTaskStatus: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: requestContext.task?.id || uuidv4(), // Use existing or a placeholder
        contextId: finalMessageForAgent.contextId!,
        status: {
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: `Agent execution error: ${err.message}` }],
            taskId: requestContext.task?.id,
            contextId: finalMessageForAgent.contextId!,
          },
          timestamp: new Date().toISOString(),
        },
        final: true, // This will terminate the stream for the client
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

  async getTask(params: TaskQueryParams, context?: ServerCallContext): Promise<Task> {
    const task = await this.taskStore.load(params.id, context);
    if (!task) {
      throw A2AError.taskNotFound(params.id);
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

  async cancelTask(params: TaskIdParams, context?: ServerCallContext): Promise<Task> {
    const task = await this.taskStore.load(params.id, context);
    if (!task) {
      throw A2AError.taskNotFound(params.id);
    }

    // Check if task is in a cancelable state
    const nonCancelableStates = ['completed', 'failed', 'canceled', 'rejected'];
    if (nonCancelableStates.includes(task.status.state)) {
      throw A2AError.taskNotCancelable(params.id);
    }

    const eventBus = this.eventBusManager.getByTaskId(params.id);

    if (eventBus) {
      const eventQueue = new ExecutionEventQueue(eventBus);
      await this.agentExecutor.cancelTask(params.id, eventBus);
      // Consume all the events until the task reaches a terminal state.
      await this._processEvents(
        params.id,
        new ResultManager(this.taskStore, context),
        eventQueue,
        context
      );
    } else {
      // Here we are marking task as cancelled. We are not waiting for the executor to actually cancel processing.
      task.status = {
        state: 'canceled',
        message: {
          // Optional: Add a system message indicating cancellation
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: 'Task cancellation requested by user.' }],
          taskId: task.id,
          contextId: task.contextId,
        },
        timestamp: new Date().toISOString(),
      };
      // Add cancellation message to history
      task.history = [...(task.history || []), task.status.message];

      await this.taskStore.save(task, context);
    }

    const latestTask = await this.taskStore.load(params.id, context);
    if (!latestTask) {
      throw A2AError.internalError(`Task ${params.id} not found after cancellation.`);
    }
    if (latestTask.status.state != 'canceled') {
      throw A2AError.taskNotCancelable(params.id);
    }
    return latestTask;
  }

  async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const task = await this.taskStore.load(params.taskId, context);
    if (!task) {
      throw A2AError.taskNotFound(params.taskId);
    }

    const { taskId, pushNotificationConfig } = params;

    // Default the config ID to the task ID if not provided for backward compatibility.
    if (!pushNotificationConfig.id) {
      pushNotificationConfig.id = taskId;
    }

    await this.pushNotificationStore?.save(taskId, pushNotificationConfig);

    return params;
  }

  async getTaskPushNotificationConfig(
    params: TaskIdParams | GetTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const task = await this.taskStore.load(params.id, context);
    if (!task) {
      throw A2AError.taskNotFound(params.id);
    }

    const configs = (await this.pushNotificationStore?.load(params.id)) || [];
    if (configs.length === 0) {
      throw A2AError.internalError(`Push notification config not found for task ${params.id}.`);
    }

    let configId: string;
    if ('pushNotificationConfigId' in params && params.pushNotificationConfigId) {
      configId = params.pushNotificationConfigId;
    } else {
      // For backward compatibility, if no config ID is given, assume it's the task ID.
      configId = params.id;
    }

    const config = configs.find((c) => c.id === configId);

    if (!config) {
      throw A2AError.internalError(
        `Push notification config with id '${configId}' not found for task ${params.id}.`
      );
    }
    return { taskId: params.id, pushNotificationConfig: config };
  }

  async listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig[]> {
    if (!this.agentCard.capabilities.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const task = await this.taskStore.load(params.id, context);
    if (!task) {
      throw A2AError.taskNotFound(params.id);
    }

    const configs = (await this.pushNotificationStore?.load(params.id)) || [];

    return configs.map((config) => ({
      taskId: params.id,
      pushNotificationConfig: config,
    }));
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<void> {
    if (!this.agentCard.capabilities.pushNotifications) {
      throw A2AError.pushNotificationNotSupported();
    }
    const task = await this.taskStore.load(params.id, context);
    if (!task) {
      throw A2AError.taskNotFound(params.id);
    }

    const { id: taskId, pushNotificationConfigId } = params;

    await this.pushNotificationStore?.delete(taskId, pushNotificationConfigId);
  }

  async *resubscribe(
    params: TaskIdParams,
    context?: ServerCallContext
  ): AsyncGenerator<
    | Task // Initial task state
    | TaskStatusUpdateEvent
    | TaskArtifactUpdateEvent,
    void,
    undefined
  > {
    if (!this.agentCard.capabilities.streaming) {
      throw A2AError.unsupportedOperation('Streaming (and thus resubscription) is not supported.');
    }

    const task = await this.taskStore.load(params.id, context);
    if (!task) {
      throw A2AError.taskNotFound(params.id);
    }

    // Yield the current task state first
    yield task;

    // If task is already in a final state, no more events will come.
    const finalStates = ['completed', 'failed', 'canceled', 'rejected'];
    if (finalStates.includes(task.status.state)) {
      return;
    }

    const eventBus = this.eventBusManager.getByTaskId(params.id);
    if (!eventBus) {
      // No active execution for this task, so no live events.
      console.warn(`Resubscribe: No active event bus for task ${params.id}.`);
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
        if (event.kind === 'status-update' && event.taskId === params.id) {
          yield event as TaskStatusUpdateEvent;
        } else if (event.kind === 'artifact-update' && event.taskId === params.id) {
          yield event as TaskArtifactUpdateEvent;
        } else if (event.kind === 'task' && event.id === params.id) {
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
    if (!this.agentCard.capabilities.pushNotifications) {
      return;
    }

    let taskId: string = '';
    if (event.kind == 'task') {
      const task = event as Task;
      taskId = task.id;
    } else {
      taskId = event.taskId;
    }

    if (!taskId) {
      console.error(`Task ID not found for event ${event.kind}.`);
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
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: `Event processing loop failed: ${errorMessage}` }],
            taskId: currentTask.id,
            contextId: currentTask.contextId,
          },
          timestamp: new Date().toISOString(),
        },
        kind: 'status-update',
        final: true,
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

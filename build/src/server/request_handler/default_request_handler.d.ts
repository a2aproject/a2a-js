import { Message, AgentCard, Task, MessageSendParams, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, TaskQueryParams, TaskIdParams, TaskPushNotificationConfig } from "../../types.js";
import { AgentExecutor } from "../agent_execution/agent_executor.js";
import { ExecutionEventBusManager } from "../events/execution_event_bus_manager.js";
import { TaskStore } from "../store.js";
import { A2ARequestHandler } from "./a2a_request_handler.js";
export declare class DefaultRequestHandler implements A2ARequestHandler {
    private readonly agentCard;
    private readonly taskStore;
    private readonly agentExecutor;
    private readonly eventBusManager;
    private readonly pushNotificationConfigs;
    constructor(agentCard: AgentCard, taskStore: TaskStore, agentExecutor: AgentExecutor, eventBusManager?: ExecutionEventBusManager);
    getAgentCard(): Promise<AgentCard>;
    private _createRequestContext;
    private _processEvents;
    sendMessage(params: MessageSendParams): Promise<Message | Task>;
    sendMessageStream(params: MessageSendParams): AsyncGenerator<Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined>;
    getTask(params: TaskQueryParams): Promise<Task>;
    cancelTask(params: TaskIdParams): Promise<Task>;
    setTaskPushNotificationConfig(params: TaskPushNotificationConfig): Promise<TaskPushNotificationConfig>;
    getTaskPushNotificationConfig(params: TaskIdParams): Promise<TaskPushNotificationConfig>;
    resubscribe(params: TaskIdParams): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined>;
}

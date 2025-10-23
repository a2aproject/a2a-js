import { 
    Message, 
    AgentCard, 
    MessageSendParams, 
    Task, 
    TaskStatusUpdateEvent, 
    TaskArtifactUpdateEvent, 
    TaskQueryParams, 
    TaskIdParams, 
    TaskPushNotificationConfig,
    GetTaskPushNotificationConfigParams,
    ListTaskPushNotificationConfigParams,
    DeleteTaskPushNotificationConfigParams,
} from "../../types.js";
import { A2ARequestHandler } from "./a2a_request_handler.js";
import { AgentExecutor } from "../agent_execution/agent_executor.js";
import { TaskStore } from "../store.js";
import { A2AError } from "../error.js";

export interface RouteContext {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
}

export type AgentCardResolver = (route: RouteContext) => Promise<AgentCard>;
export type TaskStoreResolver = (route: RouteContext) => Promise<TaskStore>;
export type AgentExecutorResolver = (route: RouteContext) => Promise<AgentExecutor>;
export type ExtendedAgentCardResolver = (route: RouteContext) => Promise<AgentCard | undefined>;

export class DynamicAgentRequestHandler implements A2ARequestHandler {
    private readonly agentCardResolver: AgentCardResolver;
    private readonly taskStoreResolver: TaskStoreResolver;
    private readonly agentExecutorResolver: AgentExecutorResolver;
    private readonly extendedAgentCardResolver?: ExtendedAgentCardResolver;

    private currentRouteContext?: RouteContext;

    constructor(
        agentCardResolver: AgentCardResolver,
        taskStoreResolver: TaskStoreResolver,
        agentExecutorResolver: AgentExecutorResolver,
        extendedAgentCardResolver?: ExtendedAgentCardResolver
    ) {
        this.agentCardResolver = agentCardResolver;
        this.taskStoreResolver = taskStoreResolver;
        this.agentExecutorResolver = agentExecutorResolver;
        this.extendedAgentCardResolver = extendedAgentCardResolver;
    }

    setRouteContext(context: RouteContext): void {
        this.currentRouteContext = context;
    }

    private getRouteContext(): RouteContext {
        if (!this.currentRouteContext) {
            throw A2AError.internalError('Route context not set. Call setRouteContext() before using this handler.');
        }
        return this.currentRouteContext;
    }

    private async createDelegateHandler(): Promise<A2ARequestHandler> {
        const route = this.getRouteContext();
        const { DefaultRequestHandler } = await import('./default_request_handler.js');
        
        const agentCard = await this.agentCardResolver(route);
        const taskStore = await this.taskStoreResolver(route);
        const agentExecutor = await this.agentExecutorResolver(route);
        const extendedAgentCard = this.extendedAgentCardResolver 
            ? await this.extendedAgentCardResolver(route)
            : undefined;

        return new DefaultRequestHandler(
            agentCard,
            taskStore,
            agentExecutor,
            undefined, // eventBusManager - use default
            undefined, // pushNotificationStore - use default
            undefined, // pushNotificationSender - use default
            extendedAgentCard
        );
    }

    async getAgentCard(): Promise<AgentCard> {
        const delegate = await this.createDelegateHandler();
        return delegate.getAgentCard();
    }

    async getAuthenticatedExtendedAgentCard(): Promise<AgentCard> {
        const delegate = await this.createDelegateHandler();
        return delegate.getAuthenticatedExtendedAgentCard();
    }

    async sendMessage(params: MessageSendParams): Promise<Message | Task> {
        const delegate = await this.createDelegateHandler();
        return delegate.sendMessage(params);
    }

    async *sendMessageStream(params: MessageSendParams): AsyncGenerator<
        | Message
        | Task
        | TaskStatusUpdateEvent
        | TaskArtifactUpdateEvent,
        void,
        undefined
    > {
        const delegate = await this.createDelegateHandler();
        yield* delegate.sendMessageStream(params);
    }

    async getTask(params: TaskQueryParams): Promise<Task> {
        const delegate = await this.createDelegateHandler();
        return delegate.getTask(params);
    }

    async cancelTask(params: TaskIdParams): Promise<Task> {
        const delegate = await this.createDelegateHandler();
        return delegate.cancelTask(params);
    }

    async setTaskPushNotificationConfig(
        params: TaskPushNotificationConfig
    ): Promise<TaskPushNotificationConfig> {
        const delegate = await this.createDelegateHandler();
        return delegate.setTaskPushNotificationConfig(params);
    }

    async getTaskPushNotificationConfig(
        params: TaskIdParams | GetTaskPushNotificationConfigParams
    ): Promise<TaskPushNotificationConfig> {
        const delegate = await this.createDelegateHandler();
        return delegate.getTaskPushNotificationConfig(params);
    }

    async listTaskPushNotificationConfigs(
        params: ListTaskPushNotificationConfigParams
    ): Promise<TaskPushNotificationConfig[]> {
        const delegate = await this.createDelegateHandler();
        return delegate.listTaskPushNotificationConfigs(params);
    }

    async deleteTaskPushNotificationConfig(
        params: DeleteTaskPushNotificationConfigParams
    ): Promise<void> {
        const delegate = await this.createDelegateHandler();
        return delegate.deleteTaskPushNotificationConfig(params);
    }

    async *resubscribe(params: TaskIdParams): AsyncGenerator<
        | Task
        | TaskStatusUpdateEvent
        | TaskArtifactUpdateEvent,
        void,
        undefined
    > {
        const delegate = await this.createDelegateHandler();
        yield* delegate.resubscribe(params);
    }
}
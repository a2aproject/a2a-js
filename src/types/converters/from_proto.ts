import { A2AError } from '../../server/error.js';
import {
  CancelTaskRequest,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigRequest,
  GetTaskRequest,
  CreateTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  Message,
  Role,
  SendMessageConfiguration,
  PushNotificationConfig,
  AuthenticationInfo,
  SendMessageRequest,
  Part,
  SendMessageResponse,
  Task,
  TaskStatus,
  TaskState,
  Artifact,
  TaskPushNotificationConfig,
  ListTaskPushNotificationConfigResponse,
  AgentCard,
  Security,
  SecurityScheme,
  AgentSkill,
  AgentCardSignature,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  OAuthFlows,
  StreamResponse,
  AgentInterface,
  AgentProvider,
  AgentCapabilities,
  AgentExtension,
} from '../pb/a2a_types.js';
import {
  JsonRpcTaskPushNotificationConfig,
  TaskQueryParams,
  TaskIdParams,
  GetTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigParams,
  MessageSendParams,
  MessageSendConfiguration,
  PushNotificationAuthenticationInfo,
} from '../../json_rpc_types.js';
import { extractTaskId, extractTaskAndPushNotificationConfigId } from './id_decoding.js';

/**
 * Converts proto types to internal types.
 * Since we now use proto types as source of truth, this class is mostly an identity mapper
 * or handles minor structural differences if any legacy support is needed. Planned to be removed completely in the future.
 */
export class FromProto {
  static taskQueryParams(request: GetTaskRequest): TaskQueryParams {
    return {
      id: extractTaskId(request.name),
      historyLength: request.historyLength,
    };
  }

  static taskIdParams(request: CancelTaskRequest): TaskIdParams {
    return {
      id: extractTaskId(request.name),
    };
  }

  static getTaskPushNotificationConfigParams(
    request: GetTaskPushNotificationConfigRequest
  ): GetTaskPushNotificationConfigParams {
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(request.name);
    return {
      id: taskId,
      pushNotificationConfigId: configId,
    };
  }

  static listTaskPushNotificationConfigParams(
    request: ListTaskPushNotificationConfigRequest
  ): ListTaskPushNotificationConfigParams {
    return {
      id: extractTaskId(request.parent),
    };
  }

  static createTaskPushNotificationConfig(
    request: CreateTaskPushNotificationConfigRequest
  ): JsonRpcTaskPushNotificationConfig {
    if (!request.config || !request.config.pushNotificationConfig) {
      throw new Error('Request must include a `config` with `pushNotificationConfig`');
    }
    return {
      taskId: extractTaskId(request.parent),
      pushNotificationConfig: request.config.pushNotificationConfig,
    };
  }

  static deleteTaskPushNotificationConfigParams(
    request: DeleteTaskPushNotificationConfigRequest
  ): DeleteTaskPushNotificationConfigParams {
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(request.name);
    return {
      id: taskId,
      pushNotificationConfigId: configId,
    };
  }

  static message(message: Message): Message {
    return message;
  }

  static role(role: Role): Role {
    return role;
  }

  static messageSendConfiguration(
    configuration: SendMessageConfiguration
  ): MessageSendConfiguration {
    return {
      blocking: configuration.blocking,
      acceptedOutputModes: configuration.acceptedOutputModes,
      pushNotificationConfig: configuration.pushNotification
        ? {
            taskId: '',
            pushNotificationConfig: configuration.pushNotification,
          }
        : undefined,
      historyLength: configuration.historyLength,
    };
  }

  static pushNotificationConfig(config: PushNotificationConfig): PushNotificationConfig {
    return config;
  }

  static pushNotificationAuthenticationInfo(
    authInfo: AuthenticationInfo
  ): PushNotificationAuthenticationInfo {
    return authInfo;
  }

  static part(part: Part): Part {
    return part;
  }

  static messageSendParams(request: SendMessageRequest): MessageSendParams {
    return {
      message: FromProto.message(request.request!),
      configuration: FromProto.messageSendConfiguration(request.configuration!),
      metadata: request.metadata,
    };
  }

  static sendMessageResult(response: SendMessageResponse): Task | Message {
    if (response.payload?.$case === 'task') {
      return response.payload.value;
    } else if (response.payload?.$case === 'msg') {
      return response.payload.value;
    }
    throw A2AError.invalidParams('Invalid SendMessageResponse: missing result');
  }

  static task(task: Task): Task {
    return task;
  }

  static taskStatus(status: TaskStatus): TaskStatus {
    return status;
  }

  static taskState(state: TaskState): TaskState {
    return state;
  }

  static artifact(artifact: Artifact): Artifact {
    return artifact;
  }

  static taskPushNotificationConfig(
    request: TaskPushNotificationConfig
  ): TaskPushNotificationConfig {
    return request;
  }

  static jsonRpcTaskPushNotificationConfig(
    config: TaskPushNotificationConfig
  ): JsonRpcTaskPushNotificationConfig {
    return {
      taskId: extractTaskId(config.name),
      pushNotificationConfig: config.pushNotificationConfig,
    };
  }

  static listTaskPushNotificationConfig(
    request: ListTaskPushNotificationConfigResponse
  ): TaskPushNotificationConfig[] {
    return request.configs;
  }

  static agentCard(agentCard: AgentCard): AgentCard {
    return agentCard;
  }

  static agentCapabilities(capabilities: AgentCapabilities): AgentCapabilities {
    return capabilities;
  }

  static agentExtension(extension: AgentExtension): AgentExtension {
    return extension;
  }

  static agentInterface(intf: AgentInterface): AgentInterface {
    return intf;
  }

  static agentProvider(provider: AgentProvider): AgentProvider {
    return provider;
  }

  static security(security: Security): Security {
    return security;
  }

  static securityScheme(securitySchemes: SecurityScheme): SecurityScheme {
    return securitySchemes;
  }

  static oauthFlows(flows: OAuthFlows): OAuthFlows {
    return flows;
  }

  static skills(skill: AgentSkill): AgentSkill {
    return skill;
  }

  static agentCardSignature(signatures: AgentCardSignature): AgentCardSignature {
    return signatures;
  }

  static taskStatusUpdateEvent(event: TaskStatusUpdateEvent): TaskStatusUpdateEvent {
    return event;
  }

  static taskArtifactUpdateEvent(event: TaskArtifactUpdateEvent): TaskArtifactUpdateEvent {
    return event;
  }

  static messageStreamResult(
    event: StreamResponse
  ): Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent {
    if (event.payload) {
      return event.payload.value;
    }
    throw A2AError.internalError('Invalid event type in StreamResponse');
  }
}

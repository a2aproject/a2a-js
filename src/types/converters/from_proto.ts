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
import { extractTaskId } from './id_decoding.js';

/**
 * Converts proto types to internal types.
 * Since we now use proto types as source of truth, this class is mostly an identity mapper
 * or handles minor structural differences if any legacy support is needed. Planned to be removed completely in the future.
 */
export class FromProto {
  static taskQueryParams(request: GetTaskRequest): GetTaskRequest {
    return request;
  }

  static taskIdParams(request: CancelTaskRequest): CancelTaskRequest {
    return request;
  }

  static getTaskPushNotificationConfigParams(
    request: GetTaskPushNotificationConfigRequest
  ): GetTaskPushNotificationConfigRequest {
    return request;
  }

  static listTaskPushNotificationConfigParams(
    request: ListTaskPushNotificationConfigRequest
  ): ListTaskPushNotificationConfigRequest {
    return request;
  }

  static createTaskPushNotificationConfig(
    request: CreateTaskPushNotificationConfigRequest
  ): TaskPushNotificationConfig {
    if (!request.config || !request.config.pushNotificationConfig) {
      throw new Error('Request must include a `config` with `pushNotificationConfig`');
    }
    return {
      name: `tasks/${extractTaskId(request.parent)}/pushNotificationConfigs/${request.config.pushNotificationConfig.id}`,
      pushNotificationConfig: request.config.pushNotificationConfig,
    };
  }

  static deleteTaskPushNotificationConfigParams(
    request: DeleteTaskPushNotificationConfigRequest
  ): DeleteTaskPushNotificationConfigRequest {
    return request;
  }

  static message(message: Message): Message {
    return message;
  }

  static role(role: Role): Role {
    return role;
  }

  static messageSendConfiguration(
    configuration: SendMessageConfiguration
  ): SendMessageConfiguration {
    return configuration;
  }

  static pushNotificationConfig(config: PushNotificationConfig): PushNotificationConfig {
    return config;
  }

  static pushNotificationAuthenticationInfo(authInfo: AuthenticationInfo): AuthenticationInfo {
    return authInfo;
  }

  static part(part: Part): Part {
    return part;
  }

  static messageSendParams(request: SendMessageRequest): SendMessageRequest {
    return request;
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
  ): TaskPushNotificationConfig {
    return config;
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

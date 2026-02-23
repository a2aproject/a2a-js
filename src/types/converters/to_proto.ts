import { A2AError } from '../../server/error.js';
import {
  AgentCard,
  AgentCardSignature,
  AgentCapabilities,
  AgentExtension,
  AgentInterface,
  AgentProvider,
  Artifact,
  AuthenticationInfo,
  Message,
  OAuthFlows,
  Part,
  PushNotificationConfig,
  Role,
  Security,
  SecurityScheme,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskPushNotificationConfig,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
  ListTaskPushNotificationConfigResponse,
  AgentSkill,
  SendMessageRequest,
  SendMessageConfiguration,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskRequest,
  CancelTaskRequest,
  TaskSubscriptionRequest,
  CreateTaskPushNotificationConfigRequest,
  GetAgentCardRequest,
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
import { generatePushNotificationConfigName, generateTaskName } from './id_decoding.js';

export class ToProto {
  static agentCard(agentCard: AgentCard): AgentCard {
    return agentCard;
  }

  static agentCardSignature(signatures: AgentCardSignature): AgentCardSignature {
    return signatures;
  }

  static agentSkill(skill: AgentSkill): AgentSkill {
    return skill;
  }

  static security(security: Security): Security {
    return security;
  }

  static securityScheme(scheme: SecurityScheme): SecurityScheme {
    return scheme;
  }

  static oauthFlows(flows: OAuthFlows): OAuthFlows {
    return flows;
  }

  static agentInterface(agentInterface: AgentInterface): AgentInterface {
    return agentInterface;
  }

  static agentProvider(agentProvider: AgentProvider): AgentProvider {
    return agentProvider;
  }

  static agentCapabilities(capabilities: AgentCapabilities): AgentCapabilities {
    return capabilities;
  }

  static agentExtension(extension: AgentExtension): AgentExtension {
    return extension;
  }

  static listTaskPushNotificationConfig(
    configs: (JsonRpcTaskPushNotificationConfig | TaskPushNotificationConfig)[]
  ): ListTaskPushNotificationConfigResponse {
    return {
      configs: configs.map((c) => {
        if ('taskId' in c) {
          return {
            name: generatePushNotificationConfigName(c.taskId, c.pushNotificationConfig.id),
            pushNotificationConfig: c.pushNotificationConfig,
          };
        }
        return c;
      }),
      nextPageToken: '',
    };
  }

  static getTaskPushNotificationConfigParams(
    config: GetTaskPushNotificationConfigParams
  ): GetTaskPushNotificationConfigRequest {
    return {
      name: generatePushNotificationConfigName(config.id, config.pushNotificationConfigId ?? ''),
    };
  }

  static listTaskPushNotificationConfigParams(
    config: ListTaskPushNotificationConfigParams
  ): ListTaskPushNotificationConfigRequest {
    return {
      parent: generateTaskName(config.id),
      pageToken: '',
      pageSize: 0,
    };
  }

  static deleteTaskPushNotificationConfigParams(
    config: DeleteTaskPushNotificationConfigParams
  ): DeleteTaskPushNotificationConfigRequest {
    return {
      name: generatePushNotificationConfigName(config.id, config.pushNotificationConfigId),
    };
  }

  static taskPushNotificationConfig(
    config: JsonRpcTaskPushNotificationConfig | TaskPushNotificationConfig
  ): TaskPushNotificationConfig {
    if ('taskId' in config) {
      return {
        name: generatePushNotificationConfigName(config.taskId, config.pushNotificationConfig.id),
        pushNotificationConfig: config.pushNotificationConfig,
      };
    }
    return config;
  }

  static taskPushNotificationConfigCreate(
    config: TaskPushNotificationConfig
  ): CreateTaskPushNotificationConfigRequest {
    const taskId = extractTaskIdFromName(config.name);
    return {
      parent: generateTaskName(taskId),
      config: config,
      configId: config.pushNotificationConfig?.id ?? '',
    };
  }

  static pushNotificationConfig(config: PushNotificationConfig): PushNotificationConfig {
    return config;
  }

  static pushNotificationAuthenticationInfo(
    authInfo: PushNotificationAuthenticationInfo
  ): AuthenticationInfo {
    return {
      schemes: authInfo.schemes,
      credentials: authInfo.credentials ?? '',
    };
  }

  static jsonRpcTaskPushNotificationConfig(
    config: JsonRpcTaskPushNotificationConfig
  ): TaskPushNotificationConfig {
    return {
      name: generatePushNotificationConfigName(
        config.taskId,
        config.pushNotificationConfig?.id ?? ''
      ),
      pushNotificationConfig: config.pushNotificationConfig,
    };
  }

  static messageStreamResult(
    event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent
  ): StreamResponse {
    if ('messageId' in event) {
      return {
        payload: {
          $case: 'msg',
          value: event,
        },
      };
    } else if ('artifacts' in event) {
      return {
        payload: {
          $case: 'task',
          value: event,
        },
      };
    } else if ('status' in event) {
      return {
        payload: {
          $case: 'statusUpdate',
          value: event,
        },
      };
    } else if ('artifact' in event) {
      return {
        payload: {
          $case: 'artifactUpdate',
          value: event,
        },
      };
    }
    throw A2AError.internalError('Invalid event type');
  }

  static taskStatusUpdateEvent(event: TaskStatusUpdateEvent): TaskStatusUpdateEvent {
    return event;
  }

  static taskArtifactUpdateEvent(event: TaskArtifactUpdateEvent): TaskArtifactUpdateEvent {
    return event;
  }

  static messageSendResult(params: Message | Task): SendMessageResponse {
    if ('messageId' in params) {
      return {
        payload: {
          $case: 'msg',
          value: params,
        },
      };
    } else if ('artifacts' in params) {
      return {
        payload: {
          $case: 'task',
          value: params,
        },
      };
    }
  }

  static message(message: Message): Message {
    return message;
  }

  static role(role: Role): Role {
    return role;
  }

  static task(task: Task): Task {
    return task;
  }

  static taskStatus(status: TaskStatus): TaskStatus {
    return status;
  }

  static artifact(artifact: Artifact): Artifact {
    return artifact;
  }

  static taskState(state: TaskState): TaskState {
    return state;
  }

  static part(part: Part): Part {
    return part;
  }

  static messageSendParams(params: MessageSendParams): SendMessageRequest {
    return {
      request: params.message,
      configuration: ToProto.configuration(params.configuration!),
      metadata: params.metadata,
    };
  }

  static configuration(
    configuration: MessageSendConfiguration
  ): SendMessageConfiguration | undefined {
    if (!configuration) {
      return undefined;
    }

    return {
      blocking: configuration.blocking ?? false,
      acceptedOutputModes: configuration.acceptedOutputModes ?? [],
      pushNotification: configuration.pushNotificationConfig?.pushNotificationConfig,
      historyLength: configuration.historyLength ?? 0,
    };
  }

  static taskQueryParams(params: TaskQueryParams): GetTaskRequest {
    return {
      name: generateTaskName(params.id),
      historyLength: params.historyLength ?? 0,
    };
  }

  static cancelTaskRequest(params: TaskIdParams): CancelTaskRequest {
    return {
      name: generateTaskName(params.id),
    };
  }

  static taskIdParams(params: TaskIdParams): TaskSubscriptionRequest {
    return {
      name: generateTaskName(params.id),
    };
  }

  static getAgentCardRequest(): GetAgentCardRequest {
    return {};
  }
}

function extractTaskIdFromName(name: string): string {
  const parts = name.split('/');
  if (parts.length >= 2 && parts[0] === 'tasks') {
    return parts[1];
  }
  return name;
}

import { A2AError } from '../../server/error.js';
import {
  AgentCard,
  AuthenticationInfo,
  Message,
  Part,
  PushNotificationConfig,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskPushNotificationConfig,
  TaskStatusUpdateEvent,
  ListTaskPushNotificationConfigResponse,
  SendMessageRequest,
  SendMessageConfiguration,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  CancelTaskRequest,
  TaskSubscriptionRequest,
  CreateTaskPushNotificationConfigRequest,
  GetAgentCardRequest,
} from '../pb/a2a_types.js';
import { generatePushNotificationConfigName, generateTaskName } from './id_decoding.js';

export class ToProto {
  static agentCard(agentCard: AgentCard): AgentCard {
    return agentCard;
  }

  static listTaskPushNotificationConfig(
    configs: (
      | { taskId: string; pushNotificationConfig: PushNotificationConfig }
      | TaskPushNotificationConfig
    )[]
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

  static getTaskPushNotificationConfigParams(config: {
    id: string;
    pushNotificationConfigId?: string;
  }): GetTaskPushNotificationConfigRequest {
    return {
      name: generatePushNotificationConfigName(config.id, config.pushNotificationConfigId ?? ''),
    };
  }

  static taskPushNotificationConfig(
    config:
      | { taskId: string; pushNotificationConfig: PushNotificationConfig }
      | TaskPushNotificationConfig
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

  static pushNotificationAuthenticationInfo(authInfo: {
    schemes: string[];
    credentials?: string;
  }): AuthenticationInfo {
    return {
      schemes: authInfo.schemes,
      credentials: authInfo.credentials ?? '',
    };
  }

  static jsonRpcTaskPushNotificationConfig(config: {
    taskId: string;
    pushNotificationConfig?: PushNotificationConfig;
  }): TaskPushNotificationConfig {
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

  static task(task: Task): Task {
    return task;
  }

  static part(part: Part): Part {
    return part;
  }

  static messageSendParams(params: {
    message: Message;
    configuration?: {
      blocking?: boolean;
      acceptedOutputModes?: string[];
      pushNotificationConfig?: { pushNotificationConfig: PushNotificationConfig };
      historyLength?: number;
    };
    metadata?: { [k: string]: unknown };
  }): SendMessageRequest {
    return {
      request: params.message,
      configuration: ToProto.configuration(params.configuration!),
      metadata: params.metadata,
    };
  }

  static configuration(
    configuration:
      | {
          blocking?: boolean;
          acceptedOutputModes?: string[];
          pushNotificationConfig?: { pushNotificationConfig: PushNotificationConfig };
          historyLength?: number;
        }
      | undefined
      | null
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

  static taskQueryParams(params: { id: string; historyLength?: number }): GetTaskRequest {
    return {
      name: generateTaskName(params.id),
      historyLength: params.historyLength ?? 0,
    };
  }

  static cancelTaskRequest(params: { id: string }): CancelTaskRequest {
    return {
      name: generateTaskName(params.id),
    };
  }

  static taskIdParams(params: { id: string }): TaskSubscriptionRequest {
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

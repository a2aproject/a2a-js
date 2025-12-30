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
} from '../a2a.js';
import * as types from '../../types.js';
import { extractTaskId, extractTaskAndPushNotificationConfigId } from './id_decoding.js';

/**
 * Converts proto types to internal types.
 */
export class FromProto {
  static taskQueryParams(request: GetTaskRequest): types.TaskQueryParams {
    return {
      id: extractTaskId(request.name),
      historyLength: request.historyLength,
    };
  }

  static taskIdParams(request: CancelTaskRequest): types.TaskIdParams {
    return {
      id: extractTaskId(request.name),
    };
  }

  static getTaskPushNotificationConfigParams(
    request: GetTaskPushNotificationConfigRequest
  ): types.GetTaskPushNotificationConfigParams {
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(request.name);
    return {
      id: taskId,
      pushNotificationConfigId: configId,
    };
  }

  static listTaskPushNotificationConfigParams(
    request: ListTaskPushNotificationConfigRequest
  ): types.ListTaskPushNotificationConfigParams {
    return {
      id: extractTaskId(request.parent),
    };
  }

  static taskPushNotificationConfig(
    request: CreateTaskPushNotificationConfigRequest
  ): types.TaskPushNotificationConfig {
    if (!request.config?.pushNotificationConfig) {
      throw A2AError.invalidParams(
        'Request must include a `config` object with a `pushNotificationConfig`'
      );
    }
    return {
      taskId: extractTaskId(request.parent),
      pushNotificationConfig: FromProto.pushNotificationConfig(
        request.config.pushNotificationConfig
      ),
    };
  }

  static deleteTaskPushNotificationConfigParams(
    request: DeleteTaskPushNotificationConfigRequest
  ): types.DeleteTaskPushNotificationConfigParams {
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(request.name);
    return {
      id: taskId,
      pushNotificationConfigId: configId,
    };
  }

  static message(message: Message): types.Message | undefined {
    if (!message) {
      return undefined;
    }

    return {
      kind: 'message',
      messageId: message.messageId,
      parts: message.content.map((p) => FromProto.part(p)),
      contextId: message.contextId,
      taskId: message.taskId,
      role: FromProto.role(message.role),
      metadata: message.metadata,
      extensions: message.extensions.length > 0 ? message.extensions : undefined,
    };
  }

  static role(role: Role): 'agent' | 'user' {
    switch (role) {
      case Role.ROLE_AGENT:
        return 'agent';
      case Role.ROLE_USER:
        return 'user';
      default:
        throw A2AError.invalidParams(`Invalid role: ${role}`);
    }
  }

  static messageSendConfiguration(
    configuration: SendMessageConfiguration
  ): types.MessageSendConfiguration | undefined {
    if (!configuration) {
      return undefined;
    }

    return {
      blocking: configuration.blocking,
      acceptedOutputModes: configuration.acceptedOutputModes,
      pushNotificationConfig: FromProto.pushNotificationConfig(configuration.pushNotification),
    };
  }

  static pushNotificationConfig(
    config: PushNotificationConfig
  ): types.PushNotificationConfig | undefined {
    if (!config) {
      return undefined;
    }

    return {
      id: config.id,
      url: config.url,
      token: config.token,
      authentication: FromProto.pushNotificationAuthenticationInfo(config.authentication),
    };
  }

  static pushNotificationAuthenticationInfo(
    authInfo: AuthenticationInfo
  ): types.PushNotificationAuthenticationInfo | undefined {
    if (!authInfo) {
      return undefined;
    }

    return {
      schemes: authInfo.schemes,
      credentials: authInfo.credentials,
    };
  }

  static part(part: Part): types.Part {
    if (part.part?.$case === 'text') {
      return {
        kind: 'text',
        text: part.part.value,
      };
    }

    if (part.part?.$case === 'file') {
      const filePart = part.part.value;
      if (filePart.file?.$case === 'fileWithUri') {
        return {
          kind: 'file',
          file: {
            uri: filePart.file.value,
            mimeType: filePart.mimeType,
          },
        };
      } else if (filePart.file?.$case === 'fileWithBytes') {
        return {
          kind: 'file',
          file: {
            bytes: filePart.file.value.toString('base64'),
            mimeType: filePart.mimeType,
          },
        };
      }
      throw A2AError.invalidParams('Invalid file part type');
    }

    if (part.part?.$case === 'data') {
      return {
        kind: 'data',
        data: part.part.value.data,
      };
    }
    throw A2AError.invalidParams('Invalid part type');
  }

  static messageSendParams(request: SendMessageRequest): types.MessageSendParams {
    return {
      message: FromProto.message(request.request),
      configuration: FromProto.messageSendConfiguration(request.configuration),
      metadata: request.metadata,
    };
  }
}

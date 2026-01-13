import { A2AError } from '../../server/error.js';
import * as types from '../../types.js';
import {
  AgentCard,
  AgentCardSignature,
  AgentCapabilities,
  AgentExtension,
  AgentInterface,
  AgentProvider,
  Artifact,
  AuthenticationInfo,
  FilePart as ProtoFilePart,
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
} from '../pb/a2a.js';
import { generatePushNotificationConfigName, generateTaskName } from './id_decoding.js';

export class ToProto {
  static agentCard(agentCard: types.AgentCard): AgentCard {
    return {
      protocolVersion: agentCard.protocolVersion,
      name: agentCard.name,
      description: agentCard.description,
      url: agentCard.url,
      preferredTransport: agentCard.preferredTransport ?? '',
      additionalInterfaces:
        agentCard.additionalInterfaces?.map((i) => ToProto.agentInterface(i)) ?? [],
      provider: ToProto.agentProvider(agentCard.provider),
      version: agentCard.version,
      documentationUrl: agentCard.documentationUrl ?? '',
      capabilities: ToProto.agentCapabilities(agentCard.capabilities),
      securitySchemes: agentCard.securitySchemes
        ? Object.fromEntries(
            Object.entries(agentCard.securitySchemes).map(([key, value]) => [
              key,
              ToProto.securityScheme(value),
            ])
          )
        : {},
      security: agentCard.security?.map((s) => ToProto.security(s)) ?? [],
      defaultInputModes: agentCard.defaultInputModes,
      defaultOutputModes: agentCard.defaultOutputModes,
      skills: agentCard.skills.map((s) => ToProto.agentSkill(s)),
      supportsAuthenticatedExtendedCard: agentCard.supportsAuthenticatedExtendedCard ?? false,
      signatures: agentCard.signatures?.map((s) => ToProto.agentCardSignature(s)) ?? [],
    };
  }

  static agentCardSignature(signatures: types.AgentCardSignature): AgentCardSignature {
    return {
      protected: signatures.protected,
      signature: signatures.signature,
      header: signatures.header,
    };
  }

  static agentSkill(skill: types.AgentSkill): AgentSkill {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description ?? '',
      tags: skill.tags ?? [],
      examples: skill.examples ?? [],
      inputModes: skill.inputModes ?? [],
      outputModes: skill.outputModes ?? [],
      security: skill.security ? skill.security.map((s) => ToProto.security(s)) : [],
    };
  }

  static security(security: { [k: string]: string[] }): Security {
    return {
      schemes: Object.fromEntries(
        Object.entries(security).map(([key, value]) => {
          return [key, { list: value }];
        })
      ),
    };
  }

  static securityScheme(scheme: types.SecurityScheme): SecurityScheme {
    switch (scheme.type) {
      case 'apiKey':
        return {
          scheme: {
            $case: 'apiKeySecurityScheme',
            value: {
              name: scheme.name,
              location: scheme.in,
              description: scheme.description ?? '',
            },
          },
        };
      case 'http':
        return {
          scheme: {
            $case: 'httpAuthSecurityScheme',
            value: {
              description: scheme.description ?? '',
              scheme: scheme.scheme,
              bearerFormat: scheme.bearerFormat ?? '',
            },
          },
        };
      case 'mutualTLS':
        return {
          scheme: {
            $case: 'mtlsSecurityScheme',
            value: {
              description: scheme.description ?? '',
            },
          },
        };
      case 'oauth2':
        return {
          scheme: {
            $case: 'oauth2SecurityScheme',
            value: {
              description: scheme.description ?? '',
              flows: ToProto.oauthFlows(scheme.flows),
              oauth2MetadataUrl: scheme.oauth2MetadataUrl ?? '',
            },
          },
        };
      case 'openIdConnect':
        return {
          scheme: {
            $case: 'openIdConnectSecurityScheme',
            value: {
              description: scheme.description ?? '',
              openIdConnectUrl: scheme.openIdConnectUrl,
            },
          },
        };
      default:
        throw A2AError.internalError(`Unsupported security scheme type`);
    }
  }

  static oauthFlows(flows: types.OAuthFlows): OAuthFlows {
    if (flows.implicit) {
      return {
        flow: {
          $case: 'implicit',
          value: {
            authorizationUrl: flows.implicit.authorizationUrl,
            scopes: flows.implicit.scopes,
            refreshUrl: flows.implicit.refreshUrl,
          },
        },
      };
    } else if (flows.password) {
      return {
        flow: {
          $case: 'password',
          value: {
            tokenUrl: flows.password.tokenUrl,
            scopes: flows.password.scopes,
            refreshUrl: flows.password.refreshUrl,
          },
        },
      };
    } else if (flows.clientCredentials) {
      return {
        flow: {
          $case: 'clientCredentials',
          value: {
            tokenUrl: flows.clientCredentials.tokenUrl,
            scopes: flows.clientCredentials.scopes,
            refreshUrl: flows.clientCredentials.refreshUrl,
          },
        },
      };
    } else if (flows.authorizationCode) {
      return {
        flow: {
          $case: 'authorizationCode',
          value: {
            authorizationUrl: flows.authorizationCode.authorizationUrl,
            tokenUrl: flows.authorizationCode.tokenUrl,
            scopes: flows.authorizationCode.scopes,
            refreshUrl: flows.authorizationCode.refreshUrl,
          },
        },
      };
    } else {
      throw A2AError.internalError(`Unsupported OAuth flows`);
    }
  }

  static agentInterface(agentInterface: types.AgentInterface): AgentInterface {
    return {
      transport: agentInterface.transport,
      url: agentInterface.url,
    };
  }

  static agentProvider(agentProvider: types.AgentProvider): AgentProvider {
    if (!agentProvider) {
      return undefined;
    }
    return {
      url: agentProvider.url,
      organization: agentProvider.organization,
    };
  }

  static agentCapabilities(capabilities: types.AgentCapabilities): AgentCapabilities {
    return {
      streaming: capabilities.streaming ?? false,
      pushNotifications: capabilities.pushNotifications ?? false,
      extensions: capabilities.extensions
        ? capabilities.extensions.map((e) => ToProto.agentExtension(e))
        : [],
    };
  }

  static agentExtension(extension: types.AgentExtension): AgentExtension {
    return {
      uri: extension.uri,
      description: extension.description ?? '',
      required: extension.required ?? false,
      params: extension.params,
    };
  }

  static listTaskPushNotificationConfig(
    config: types.TaskPushNotificationConfig[]
  ): ListTaskPushNotificationConfigResponse {
    return {
      configs: config.map((c) => ToProto.taskPushNotificationConfig(c)),
      nextPageToken: '',
    };
  }

  static getTaskPushNotificationConfigParams(
    config: types.GetTaskPushNotificationConfigParams
  ): GetTaskPushNotificationConfigRequest {
    return {
      name: generatePushNotificationConfigName(config.id, config.pushNotificationConfigId),
    };
  }

  static listTaskPushNotificationConfigParams(
    config: types.ListTaskPushNotificationConfigParams
  ): ListTaskPushNotificationConfigRequest {
    return {
      parent: generateTaskName(config.id),
      pageToken: '',
      pageSize: 0,
    };
  }

  static deleteTaskPushNotificationConfigParams(
    config: types.DeleteTaskPushNotificationConfigParams
  ): DeleteTaskPushNotificationConfigRequest {
    return {
      name: generatePushNotificationConfigName(config.id, config.pushNotificationConfigId),
    };
  }

  static taskPushNotificationConfig(
    config: types.TaskPushNotificationConfig
  ): TaskPushNotificationConfig {
    return {
      name: generatePushNotificationConfigName(
        config.taskId,
        config.pushNotificationConfig.id ?? ''
      ),
      pushNotificationConfig: ToProto.pushNotificationConfig(config.pushNotificationConfig),
    };
  }

  static taskPushNotificationConfigCreate(
    config: types.TaskPushNotificationConfig
  ): CreateTaskPushNotificationConfigRequest {
    return {
      parent: generateTaskName(config.taskId),
      config: ToProto.taskPushNotificationConfig(config),
      configId: config.pushNotificationConfig.id ?? '',
    };
  }

  static pushNotificationConfig(config: types.PushNotificationConfig): PushNotificationConfig {
    if (!config) {
      return undefined;
    }

    return {
      id: config.id ?? '',
      url: config.url,
      token: config.token ?? '',
      authentication: ToProto.pushNotificationAuthenticationInfo(config.authentication),
    };
  }

  static pushNotificationAuthenticationInfo(
    authInfo: types.PushNotificationAuthenticationInfo
  ): AuthenticationInfo | undefined {
    if (!authInfo) {
      return undefined;
    }
    return {
      schemes: authInfo.schemes,
      credentials: authInfo.credentials ?? '',
    };
  }

  static messageStreamResult(
    event: types.Message | types.Task | types.TaskStatusUpdateEvent | types.TaskArtifactUpdateEvent
  ): StreamResponse {
    if (event.kind === 'message') {
      return {
        payload: {
          $case: 'msg',
          value: ToProto.message(event),
        },
      };
    } else if (event.kind === 'task') {
      return {
        payload: {
          $case: 'task',
          value: ToProto.task(event),
        },
      };
    } else if (event.kind === 'status-update') {
      return {
        payload: {
          $case: 'statusUpdate',
          value: ToProto.taskStatusUpdateEvent(event),
        },
      };
    } else if (event.kind === 'artifact-update') {
      return {
        payload: {
          $case: 'artifactUpdate',
          value: ToProto.taskArtifactUpdateEvent(event),
        },
      };
    } else {
      throw A2AError.internalError('Invalid event type');
    }
  }

  static taskStatusUpdateEvent(event: types.TaskStatusUpdateEvent): TaskStatusUpdateEvent {
    return {
      taskId: event.taskId,
      status: ToProto.taskStatus(event.status),
      contextId: event.contextId,
      metadata: event.metadata,
      final: event.final,
    };
  }

  static taskArtifactUpdateEvent(event: types.TaskArtifactUpdateEvent): TaskArtifactUpdateEvent {
    return {
      taskId: event.taskId,
      artifact: ToProto.artifact(event.artifact),
      contextId: event.contextId,
      metadata: event.metadata,
      append: event.append ?? false,
      lastChunk: event.lastChunk ?? false,
    };
  }

  static messageSendResult(params: types.Message | types.Task): SendMessageResponse {
    if (params.kind === 'message') {
      return {
        payload: {
          $case: 'msg',
          value: ToProto.message(params),
        },
      };
    } else if (params.kind === 'task') {
      return {
        payload: {
          $case: 'task',
          value: ToProto.task(params),
        },
      };
    }
  }

  static message(message: types.Message): Message | undefined {
    if (!message) {
      return undefined;
    }

    return {
      messageId: message.messageId,
      content: message.parts.map((p) => ToProto.parts(p)),
      contextId: message.contextId ?? '',
      taskId: message.taskId ?? '',
      role: ToProto.role(message.role),
      metadata: message.metadata,
      extensions: message.extensions ?? [],
    };
  }

  static role(role: string): Role {
    switch (role) {
      case 'agent':
        return Role.ROLE_AGENT;
      case 'user':
        return Role.ROLE_USER;
      default:
        throw A2AError.internalError(`Invalid role`);
    }
  }

  static task(task: types.Task): Task {
    return {
      id: task.id,
      contextId: task.contextId,
      status: ToProto.taskStatus(task.status),
      artifacts: task.artifacts?.map((a) => ToProto.artifact(a)) ?? [],
      history: task.history?.map((m) => ToProto.message(m)) ?? [],
      metadata: task.metadata,
    };
  }

  static taskStatus(status: types.TaskStatus): TaskStatus {
    return {
      state: ToProto.taskState(status.state),
      update: ToProto.message(status.message),
      timestamp: status.timestamp ? new Date(status.timestamp) : undefined,
    };
  }

  static artifact(artifact: types.Artifact): Artifact {
    return {
      artifactId: artifact.artifactId,
      name: artifact.name ?? '',
      description: artifact.description ?? '',
      parts: artifact.parts.map((p) => ToProto.parts(p)),
      metadata: artifact.metadata,
      extensions: artifact.extensions ? artifact.extensions : [],
    };
  }

  static taskState(state: types.TaskState): TaskState {
    switch (state) {
      case 'submitted':
        return TaskState.TASK_STATE_SUBMITTED;
      case 'working':
        return TaskState.TASK_STATE_WORKING;
      case 'input-required':
        return TaskState.TASK_STATE_INPUT_REQUIRED;
      case 'rejected':
        return TaskState.TASK_STATE_REJECTED;
      case 'auth-required':
        return TaskState.TASK_STATE_AUTH_REQUIRED;
      case 'completed':
        return TaskState.TASK_STATE_COMPLETED;
      case 'failed':
        return TaskState.TASK_STATE_FAILED;
      case 'canceled':
        return TaskState.TASK_STATE_CANCELLED;
      case 'unknown':
        return TaskState.TASK_STATE_UNSPECIFIED;
      default:
        return TaskState.UNRECOGNIZED;
    }
  }

  static parts(part: types.Part): Part {
    if (part.kind === 'text') {
      return {
        part: { $case: 'text', value: part.text },
      };
    }

    if (part.kind === 'file') {
      let filePart: ProtoFilePart;
      if ('uri' in part.file) {
        filePart = {
          file: { $case: 'fileWithUri', value: part.file.uri },
          mimeType: part.file.mimeType ?? '',
        };
      } else if ('bytes' in part.file) {
        filePart = {
          file: { $case: 'fileWithBytes', value: Buffer.from(part.file.bytes, 'base64') },
          mimeType: part.file.mimeType ?? '',
        };
      } else {
        throw A2AError.internalError('Invalid file part');
      }
      return {
        part: { $case: 'file', value: filePart },
      };
    }

    if (part.kind === 'data') {
      return {
        part: { $case: 'data', value: { data: part.data } },
      };
    }
    throw A2AError.internalError('Invalid part type');
  }

  static messageSendParams(params: types.MessageSendParams): SendMessageRequest {
    return {
      request: ToProto.message(params.message),
      configuration: ToProto.configuration(params.configuration),
      metadata: params.metadata,
    };
  }

  static configuration(configuration: types.MessageSendConfiguration): SendMessageConfiguration {
    if (!configuration) {
      return undefined;
    }

    return {
      blocking: configuration.blocking ?? false,
      acceptedOutputModes: configuration.acceptedOutputModes ?? [],
      pushNotification: ToProto.pushNotificationConfig(configuration.pushNotificationConfig),
      historyLength: configuration.historyLength ?? 0,
    };
  }

  static taskQueryParams(params: types.TaskQueryParams): GetTaskRequest {
    return {
      name: generateTaskName(params.id),
      historyLength: params.historyLength ?? 0,
    };
  }

  static cancelTaskRequest(params: types.TaskIdParams): CancelTaskRequest {
    return {
      name: generateTaskName(params.id),
    };
  }

  static taskIdParams(params: types.TaskIdParams): TaskSubscriptionRequest {
    return {
      name: generateTaskName(params.id),
    };
  }
}

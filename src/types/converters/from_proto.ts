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

  static createTaskPushNotificationConfig(
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
      extensions: message.extensions,
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

  static sendMessageResult(response: SendMessageResponse): types.Task | types.Message {
    if (response.payload?.$case === 'task') {
      return FromProto.task(response.payload.value);
    } else if (response.payload?.$case === 'msg') {
      return FromProto.message(response.payload.value);
    }
    throw A2AError.invalidParams('Invalid SendMessageResponse: missing result');
  }

  static task(task: Task): types.Task {
    return {
      kind: 'task',
      id: task.id,
      status: FromProto.taskStatus(task.status),
      contextId: task.contextId,
      artifacts: task.artifacts?.map((a) => FromProto.artifact(a)),
      history: task.history?.map((h) => FromProto.message(h)),
      metadata: task.metadata,
    };
  }

  static taskStatus(status: TaskStatus): types.TaskStatus {
    return {
      message: FromProto.message(status.update),
      state: FromProto.taskState(status.state),
      timestamp: status.timestamp?.toISOString(),
    };
  }

  static taskState(state: TaskState): types.TaskState {
    switch (state) {
      case TaskState.TASK_STATE_SUBMITTED:
        return 'submitted';
      case TaskState.TASK_STATE_WORKING:
        return 'working';
      case TaskState.TASK_STATE_INPUT_REQUIRED:
        return 'input-required';
      case TaskState.TASK_STATE_COMPLETED:
        return 'completed';
      case TaskState.TASK_STATE_CANCELLED:
        return 'canceled';
      case TaskState.TASK_STATE_FAILED:
        return 'failed';
      case TaskState.TASK_STATE_REJECTED:
        return 'rejected';
      case TaskState.TASK_STATE_AUTH_REQUIRED:
        return 'auth-required';
      case TaskState.TASK_STATE_UNSPECIFIED:
        return 'unknown';
      default:
        throw A2AError.invalidParams(`Invalid task state: ${state}`);
    }
  }

  static artifact(artifact: Artifact): types.Artifact {
    return {
      artifactId: artifact.artifactId,
      name: artifact.name,
      description: artifact.description,
      parts: artifact.parts.map((p) => FromProto.part(p)),
      metadata: artifact.metadata,
    };
  }

  static taskPushNotificationConfig(
    request: TaskPushNotificationConfig
  ): types.TaskPushNotificationConfig {
    return {
      taskId: extractTaskId(request.name),
      pushNotificationConfig: FromProto.pushNotificationConfig(request.pushNotificationConfig),
    };
  }

  static listTaskPushNotificationConfig(
    request: ListTaskPushNotificationConfigResponse
  ): types.TaskPushNotificationConfig[] {
    return request.configs.map((c) => FromProto.taskPushNotificationConfig(c));
  }

  static agentCard(agentCard: AgentCard): types.AgentCard {
    return {
      additionalInterfaces: agentCard.additionalInterfaces?.map((i) => FromProto.agentInterface(i)),
      capabilities: agentCard.capabilities
        ? FromProto.agentCapabilities(agentCard.capabilities)
        : {},
      defaultInputModes: agentCard.defaultInputModes,
      defaultOutputModes: agentCard.defaultOutputModes,
      description: agentCard.description,
      documentationUrl: agentCard.documentationUrl,
      name: agentCard.name,
      preferredTransport: agentCard.preferredTransport,
      provider: agentCard.provider ? FromProto.agentProvider(agentCard.provider) : undefined,
      protocolVersion: agentCard.protocolVersion,
      security: agentCard.security?.map((s) => FromProto.security(s)),
      securitySchemes: agentCard.securitySchemes
        ? Object.fromEntries(
            Object.entries(agentCard.securitySchemes).map(([key, value]) => [
              key,
              FromProto.securityScheme(value),
            ])
          )
        : {},
      skills: agentCard.skills.map((s) => FromProto.skills(s)),
      signatures: agentCard.signatures?.map((s) => FromProto.agentCardSignature(s)),
      supportsAuthenticatedExtendedCard: agentCard.supportsAuthenticatedExtendedCard,
      url: agentCard.url,
      version: agentCard.version,
    };
  }

  static agentCapabilities(capabilities: AgentCapabilities): types.AgentCapabilities1 {
    return {
      extensions: capabilities.extensions?.map((e) => FromProto.agentExtension(e)),
      pushNotifications: capabilities.pushNotifications,
      streaming: capabilities.streaming,
    };
  }

  static agentExtension(extension: AgentExtension): types.AgentExtension {
    return {
      uri: extension.uri ?? '',
      description: extension.description,
      required: extension.required,
      params: extension.params,
    };
  }

  static agentInterface(intf: AgentInterface): types.AgentInterface {
    return {
      transport: intf.transport ?? '',
      url: intf.url ?? '',
    };
  }

  static agentProvider(provider: AgentProvider): types.AgentProvider {
    return {
      organization: provider.organization ?? '',
      url: provider.url ?? '',
    };
  }

  static security(security: Security): { [k: string]: string[] } {
    return Object.fromEntries(
      Object.entries(security.schemes)?.map(([key, value]) => [key, value.list])
    );
  }

  static securityScheme(securitySchemes: SecurityScheme): types.SecurityScheme {
    switch (securitySchemes.scheme?.$case) {
      case 'apiKeySecurityScheme':
        return {
          type: 'apiKey',
          name: securitySchemes.scheme.value.name,
          in: securitySchemes.scheme.value.location as 'query' | 'header' | 'cookie',
          description: securitySchemes.scheme.value.description,
        };
      case 'httpAuthSecurityScheme':
        return {
          type: 'http',
          scheme: securitySchemes.scheme.value.scheme,
          bearerFormat: securitySchemes.scheme.value.bearerFormat,
          description: securitySchemes.scheme.value.description,
        };
      case 'mtlsSecurityScheme':
        return {
          type: 'mutualTLS',
          description: securitySchemes.scheme.value.description,
        };
      case 'oauth2SecurityScheme':
        return {
          type: 'oauth2',
          description: securitySchemes.scheme.value.description,
          flows: FromProto.oauthFlows(securitySchemes.scheme.value.flows),
          oauth2MetadataUrl: securitySchemes.scheme.value.oauth2MetadataUrl,
        };
      case 'openIdConnectSecurityScheme':
        return {
          type: 'openIdConnect',
          description: securitySchemes.scheme.value.description,
          openIdConnectUrl: securitySchemes.scheme.value.openIdConnectUrl,
        };
      default:
        throw A2AError.internalError(`Unsupported security scheme type`);
    }
  }

  static oauthFlows(flows: OAuthFlows): types.OAuthFlows {
    switch (flows.flow?.$case) {
      case 'implicit':
        return {
          implicit: {
            authorizationUrl: flows.flow.value.authorizationUrl,
            scopes: flows.flow.value.scopes,
            refreshUrl: flows.flow.value.refreshUrl,
          },
        };
      case 'password':
        return {
          password: {
            refreshUrl: flows.flow.value.refreshUrl,
            scopes: flows.flow.value.scopes,
            tokenUrl: flows.flow.value.tokenUrl,
          },
        };
      case 'authorizationCode':
        return {
          authorizationCode: {
            refreshUrl: flows.flow.value.refreshUrl,
            authorizationUrl: flows.flow.value.authorizationUrl,
            scopes: flows.flow.value.scopes,
            tokenUrl: flows.flow.value.tokenUrl,
          },
        };
      case 'clientCredentials':
        return {
          clientCredentials: {
            refreshUrl: flows.flow.value.refreshUrl,
            scopes: flows.flow.value.scopes,
            tokenUrl: flows.flow.value.tokenUrl,
          },
        };
      default:
        throw A2AError.internalError(`Unsupported OAuth flows`);
    }
  }

  static skills(skill: AgentSkill): types.AgentSkill {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      examples: skill.examples,
      inputModes: skill.inputModes,
      outputModes: skill.outputModes,
      security: skill.security?.map((s) => FromProto.security(s)),
    };
  }

  static agentCardSignature(signatures: AgentCardSignature): types.AgentCardSignature {
    return {
      protected: signatures.protected,
      signature: signatures.signature,
      header: signatures.header,
    };
  }

  static taskStatusUpdateEvent(event: TaskStatusUpdateEvent): types.TaskStatusUpdateEvent {
    return {
      kind: 'status-update',
      taskId: event.taskId,
      status: FromProto.taskStatus(event.status),
      contextId: event.contextId,
      metadata: event.metadata,
      final: event.final,
    };
  }

  static taskArtifactUpdateEvent(event: TaskArtifactUpdateEvent): types.TaskArtifactUpdateEvent {
    return {
      kind: 'artifact-update',
      taskId: event.taskId,
      artifact: FromProto.artifact(event.artifact),
      contextId: event.contextId,
      metadata: event.metadata,
      lastChunk: event.lastChunk,
    };
  }

  static messageStreamResult(
    event: StreamResponse
  ): types.Message | types.Task | types.TaskStatusUpdateEvent | types.TaskArtifactUpdateEvent {
    switch (event.payload?.$case) {
      case 'msg': {
        const message = FromProto.message(event.payload.value);
        if (!message) {
          throw A2AError.internalError('Invalid message in StreamResponse');
        }
        return message;
      }
      case 'task':
        return FromProto.task(event.payload.value);
      case 'statusUpdate':
        return FromProto.taskStatusUpdateEvent(event.payload.value);
      case 'artifactUpdate':
        return FromProto.taskArtifactUpdateEvent(event.payload.value);
      default:
        throw A2AError.internalError('Invalid event type in StreamResponse');
    }
  }
}

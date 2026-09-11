import * as pb from "./pb/a2a.js";
import { Role, TaskState } from "./pb/a2a.js";

export type SendMessageConfiguration = pb.SendMessageConfiguration;
export type Task = pb.Task;
export type TaskStatus = pb.TaskStatus;
export type Part = pb.Part;
export type Message = pb.Message;
export type Artifact = pb.Artifact;
export type TaskStatusUpdateEvent = pb.TaskStatusUpdateEvent;
export type TaskArtifactUpdateEvent = pb.TaskArtifactUpdateEvent;
export type AuthenticationInfo = pb.AuthenticationInfo;
export type AgentInterface = pb.AgentInterface;
export type AgentCard = pb.AgentCard;
export type AgentCard_SecuritySchemesEntry = pb.AgentCard_SecuritySchemesEntry;
export type AgentProvider = pb.AgentProvider;
export type AgentCapabilities = pb.AgentCapabilities;
export type AgentExtension = pb.AgentExtension;
export type AgentSkill = pb.AgentSkill;
export type AgentCardSignature = pb.AgentCardSignature;
export type TaskPushNotificationConfig = pb.TaskPushNotificationConfig;
export type StringList = pb.StringList;
export type SecurityRequirement = pb.SecurityRequirement;
export type SecurityRequirement_SchemesEntry = pb.SecurityRequirement_SchemesEntry;
export type SecurityScheme = pb.SecurityScheme;
export type APIKeySecurityScheme = pb.APIKeySecurityScheme;
export type HTTPAuthSecurityScheme = pb.HTTPAuthSecurityScheme;
export type OAuth2SecurityScheme = pb.OAuth2SecurityScheme;
export type OpenIdConnectSecurityScheme = pb.OpenIdConnectSecurityScheme;
export type MutualTlsSecurityScheme = pb.MutualTlsSecurityScheme;
export type OAuthFlows = pb.OAuthFlows;
export type AuthorizationCodeOAuthFlow = pb.AuthorizationCodeOAuthFlow;
export type AuthorizationCodeOAuthFlow_ScopesEntry = pb.AuthorizationCodeOAuthFlow_ScopesEntry;
export type ClientCredentialsOAuthFlow = pb.ClientCredentialsOAuthFlow;
export type ClientCredentialsOAuthFlow_ScopesEntry = pb.ClientCredentialsOAuthFlow_ScopesEntry;
export type ImplicitOAuthFlow = pb.ImplicitOAuthFlow;
export type ImplicitOAuthFlow_ScopesEntry = pb.ImplicitOAuthFlow_ScopesEntry;
export type PasswordOAuthFlow = pb.PasswordOAuthFlow;
export type PasswordOAuthFlow_ScopesEntry = pb.PasswordOAuthFlow_ScopesEntry;
export type DeviceCodeOAuthFlow = pb.DeviceCodeOAuthFlow;
export type DeviceCodeOAuthFlow_ScopesEntry = pb.DeviceCodeOAuthFlow_ScopesEntry;
export type SendMessageRequest = pb.SendMessageRequest;
export type GetTaskRequest = pb.GetTaskRequest;
export type ListTasksRequest = pb.ListTasksRequest;
export type ListTasksResponse = pb.ListTasksResponse;
export type CancelTaskRequest = pb.CancelTaskRequest;
export type GetTaskPushNotificationConfigRequest = pb.GetTaskPushNotificationConfigRequest;
export type DeleteTaskPushNotificationConfigRequest = pb.DeleteTaskPushNotificationConfigRequest;
export type SubscribeToTaskRequest = pb.SubscribeToTaskRequest;
export type ListTaskPushNotificationConfigsRequest = pb.ListTaskPushNotificationConfigsRequest;
export type GetExtendedAgentCardRequest = pb.GetExtendedAgentCardRequest;
export type SendMessageResponse = pb.SendMessageResponse;
export type StreamResponse = pb.StreamResponse;
export type ListTaskPushNotificationConfigsResponse = pb.ListTaskPushNotificationConfigsResponse;

export function taskStateFromJSON(object: any): TaskState {
  switch (object) {
    case 0:
    case "TASK_STATE_UNSPECIFIED":
      return TaskState.TASK_STATE_UNSPECIFIED;
    case 1:
    case "TASK_STATE_SUBMITTED":
      return TaskState.TASK_STATE_SUBMITTED;
    case 2:
    case "TASK_STATE_WORKING":
      return TaskState.TASK_STATE_WORKING;
    case 3:
    case "TASK_STATE_COMPLETED":
      return TaskState.TASK_STATE_COMPLETED;
    case 4:
    case "TASK_STATE_FAILED":
      return TaskState.TASK_STATE_FAILED;
    case 5:
    case "TASK_STATE_CANCELED":
      return TaskState.TASK_STATE_CANCELED;
    case 6:
    case "TASK_STATE_INPUT_REQUIRED":
      return TaskState.TASK_STATE_INPUT_REQUIRED;
    case 7:
    case "TASK_STATE_REJECTED":
      return TaskState.TASK_STATE_REJECTED;
    case 8:
    case "TASK_STATE_AUTH_REQUIRED":
      return TaskState.TASK_STATE_AUTH_REQUIRED;
    case -1:
    case "UNRECOGNIZED":
    default:
      return TaskState.UNRECOGNIZED;
  }
}

export function taskStateToJSON(object: TaskState): string {
  switch (object) {
    case TaskState.TASK_STATE_UNSPECIFIED:
      return "TASK_STATE_UNSPECIFIED";
    case TaskState.TASK_STATE_SUBMITTED:
      return "TASK_STATE_SUBMITTED";
    case TaskState.TASK_STATE_WORKING:
      return "TASK_STATE_WORKING";
    case TaskState.TASK_STATE_COMPLETED:
      return "TASK_STATE_COMPLETED";
    case TaskState.TASK_STATE_FAILED:
      return "TASK_STATE_FAILED";
    case TaskState.TASK_STATE_CANCELED:
      return "TASK_STATE_CANCELED";
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      return "TASK_STATE_INPUT_REQUIRED";
    case TaskState.TASK_STATE_REJECTED:
      return "TASK_STATE_REJECTED";
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return "TASK_STATE_AUTH_REQUIRED";
    case TaskState.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export function roleFromJSON(object: any): Role {
  switch (object) {
    case 0:
    case "ROLE_UNSPECIFIED":
      return Role.ROLE_UNSPECIFIED;
    case 1:
    case "ROLE_USER":
      return Role.ROLE_USER;
    case 2:
    case "ROLE_AGENT":
      return Role.ROLE_AGENT;
    case -1:
    case "UNRECOGNIZED":
    default:
      return Role.UNRECOGNIZED;
  }
}

export function roleToJSON(object: Role): string {
  switch (object) {
    case Role.ROLE_UNSPECIFIED:
      return "ROLE_UNSPECIFIED";
    case Role.ROLE_USER:
      return "ROLE_USER";
    case Role.ROLE_AGENT:
      return "ROLE_AGENT";
    case Role.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export const SendMessageConfiguration: MessageFns<SendMessageConfiguration> = {
  fromJSON(object: any): SendMessageConfiguration {
    return {
      acceptedOutputModes: globalThis.Array.isArray(object?.acceptedOutputModes)
        ? object.acceptedOutputModes.map((e: any) => globalThis.String(e))
        : globalThis.Array.isArray(object?.accepted_output_modes)
        ? object.accepted_output_modes.map((e: any) =>
          globalThis.String(e)
        )
        : [],
      taskPushNotificationConfig: isSet(object.taskPushNotificationConfig)
        ? TaskPushNotificationConfig.fromJSON(object.taskPushNotificationConfig)
        : isSet(object.task_push_notification_config)
        ? TaskPushNotificationConfig.fromJSON(object.task_push_notification_config)
        : undefined,
      historyLength: isSet(object.historyLength)
        ? globalThis.Number(object.historyLength)
        : isSet(object.history_length)
        ? globalThis.Number(object.history_length)
        : undefined,
      returnImmediately: isSet(object.returnImmediately)
        ? globalThis.Boolean(object.returnImmediately)
        : isSet(object.return_immediately)
        ? globalThis.Boolean(object.return_immediately)
        : false,
    };
  },

  toJSON(message: SendMessageConfiguration): unknown {
    const obj: any = {};
    if (message.acceptedOutputModes?.length) {
      obj.acceptedOutputModes = message.acceptedOutputModes;
    }
    if (message.taskPushNotificationConfig !== undefined) {
      obj.taskPushNotificationConfig = TaskPushNotificationConfig.toJSON(message.taskPushNotificationConfig);
    }
    if (message.historyLength !== undefined) {
      obj.historyLength = Math.round(message.historyLength);
    }
    if (message.returnImmediately !== false) {
      obj.returnImmediately = message.returnImmediately;
    }
    return obj;
  },
};

export const Task: MessageFns<Task> = {
  fromJSON(object: any): Task {
    return {
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      contextId: isSet(object.contextId)
        ? globalThis.String(object.contextId)
        : isSet(object.context_id)
        ? globalThis.String(object.context_id)
        : "",
      status: isSet(object.status) ? TaskStatus.fromJSON(object.status) : undefined,
      artifacts: globalThis.Array.isArray(object?.artifacts)
        ? object.artifacts.map((e: any) => Artifact.fromJSON(e))
        : [],
      history: globalThis.Array.isArray(object?.history)
        ? object.history.map((e: any) => Message.fromJSON(e))
        : [],
      metadata: isObject(object.metadata) ? object.metadata : undefined,
    };
  },

  toJSON(message: Task): unknown {
    const obj: any = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== undefined) {
      obj.status = TaskStatus.toJSON(message.status);
    }
    if (message.artifacts?.length) {
      obj.artifacts = message.artifacts.map((e) => Artifact.toJSON(e));
    }
    if (message.history?.length) {
      obj.history = message.history.map((e) => Message.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  },
};

export const TaskStatus: MessageFns<TaskStatus> = {
  fromJSON(object: any): TaskStatus {
    return {
      state: isSet(object.state) ? taskStateFromJSON(object.state) : 0,
      message: isSet(object.message) ? Message.fromJSON(object.message) : undefined,
      timestamp: isSet(object.timestamp) ? globalThis.String(object.timestamp) : undefined,
    };
  },

  toJSON(message: TaskStatus): unknown {
    const obj: any = {};
    if (message.state !== 0) {
      obj.state = taskStateToJSON(message.state);
    }
    if (message.message !== undefined) {
      obj.message = Message.toJSON(message.message);
    }
    if (message.timestamp !== undefined) {
      obj.timestamp = message.timestamp;
    }
    return obj;
  },
};

export const Part: MessageFns<Part> = {
  fromJSON(object: any): Part {
    return {
      content: isSet(object.text)
        ? { $case: "text", value: globalThis.String(object.text) }
        : isSet(object.raw)
        ? { $case: "raw", value: Buffer.from(bytesFromBase64(object.raw)) }
        : isSet(object.url)
        ? { $case: "url", value: globalThis.String(object.url) }
        : isSet(object.data)
        ? { $case: "data", value: object.data }
        : undefined,
      metadata: isObject(object.metadata) ? object.metadata : undefined,
      filename: isSet(object.filename) ? globalThis.String(object.filename) : "",
      mediaType: isSet(object.mediaType)
        ? globalThis.String(object.mediaType)
        : isSet(object.media_type)
        ? globalThis.String(object.media_type)
        : "",
    };
  },

  toJSON(message: Part): unknown {
    const obj: any = {};
    if (message.content?.$case === "text") {
      obj.text = message.content.value;
    } else if (message.content?.$case === "raw") {
      obj.raw = base64FromBytes(message.content.value);
    } else if (message.content?.$case === "url") {
      obj.url = message.content.value;
    } else if (message.content?.$case === "data") {
      obj.data = message.content.value;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.filename !== "") {
      obj.filename = message.filename;
    }
    if (message.mediaType !== "") {
      obj.mediaType = message.mediaType;
    }
    return obj;
  },
};

export const Message: MessageFns<Message> = {
  fromJSON(object: any): Message {
    return {
      messageId: isSet(object.messageId)
        ? globalThis.String(object.messageId)
        : isSet(object.message_id)
        ? globalThis.String(object.message_id)
        : "",
      contextId: isSet(object.contextId)
        ? globalThis.String(object.contextId)
        : isSet(object.context_id)
        ? globalThis.String(object.context_id)
        : "",
      taskId: isSet(object.taskId)
        ? globalThis.String(object.taskId)
        : isSet(object.task_id)
        ? globalThis.String(object.task_id)
        : "",
      role: isSet(object.role) ? roleFromJSON(object.role) : 0,
      parts: globalThis.Array.isArray(object?.parts)
        ? object.parts.map((e: any) => Part.fromJSON(e))
        : [],
      metadata: isObject(object.metadata) ? object.metadata : undefined,
      extensions: globalThis.Array.isArray(object?.extensions)
        ? object.extensions.map((e: any) => globalThis.String(e))
        : [],
      referenceTaskIds: globalThis.Array.isArray(object?.referenceTaskIds)
        ? object.referenceTaskIds.map((e: any) => globalThis.String(e))
        : globalThis.Array.isArray(object?.reference_task_ids)
        ? object.reference_task_ids.map((e: any) => globalThis.String(e))
        : [],
    };
  },

  toJSON(message: Message): unknown {
    const obj: any = {};
    if (message.messageId !== "") {
      obj.messageId = message.messageId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.role !== 0) {
      obj.role = roleToJSON(message.role);
    }
    if (message.parts?.length) {
      obj.parts = message.parts.map((e) => Part.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions;
    }
    if (message.referenceTaskIds?.length) {
      obj.referenceTaskIds = message.referenceTaskIds;
    }
    return obj;
  },
};

export const Artifact: MessageFns<Artifact> = {
  fromJSON(object: any): Artifact {
    return {
      artifactId: isSet(object.artifactId)
        ? globalThis.String(object.artifactId)
        : isSet(object.artifact_id)
        ? globalThis.String(object.artifact_id)
        : "",
      name: isSet(object.name) ? globalThis.String(object.name) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      parts: globalThis.Array.isArray(object?.parts)
        ? object.parts.map((e: any) => Part.fromJSON(e))
        : [],
      metadata: isObject(object.metadata) ? object.metadata : undefined,
      extensions: globalThis.Array.isArray(object?.extensions)
        ? object.extensions.map((e: any) => globalThis.String(e))
        : [],
    };
  },

  toJSON(message: Artifact): unknown {
    const obj: any = {};
    if (message.artifactId !== "") {
      obj.artifactId = message.artifactId;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.parts?.length) {
      obj.parts = message.parts.map((e) => Part.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions;
    }
    return obj;
  },
};

export const TaskStatusUpdateEvent: MessageFns<TaskStatusUpdateEvent> = {
  fromJSON(object: any): TaskStatusUpdateEvent {
    return {
      taskId: isSet(object.taskId)
        ? globalThis.String(object.taskId)
        : isSet(object.task_id)
        ? globalThis.String(object.task_id)
        : "",
      contextId: isSet(object.contextId)
        ? globalThis.String(object.contextId)
        : isSet(object.context_id)
        ? globalThis.String(object.context_id)
        : "",
      status: isSet(object.status) ? TaskStatus.fromJSON(object.status) : undefined,
      metadata: isObject(object.metadata) ? object.metadata : undefined,
    };
  },

  toJSON(message: TaskStatusUpdateEvent): unknown {
    const obj: any = {};
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== undefined) {
      obj.status = TaskStatus.toJSON(message.status);
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  },
};

export const TaskArtifactUpdateEvent: MessageFns<TaskArtifactUpdateEvent> = {
  fromJSON(object: any): TaskArtifactUpdateEvent {
    return {
      taskId: isSet(object.taskId)
        ? globalThis.String(object.taskId)
        : isSet(object.task_id)
        ? globalThis.String(object.task_id)
        : "",
      contextId: isSet(object.contextId)
        ? globalThis.String(object.contextId)
        : isSet(object.context_id)
        ? globalThis.String(object.context_id)
        : "",
      artifact: isSet(object.artifact) ? Artifact.fromJSON(object.artifact) : undefined,
      append: isSet(object.append) ? globalThis.Boolean(object.append) : false,
      lastChunk: isSet(object.lastChunk)
        ? globalThis.Boolean(object.lastChunk)
        : isSet(object.last_chunk)
        ? globalThis.Boolean(object.last_chunk)
        : false,
      metadata: isObject(object.metadata) ? object.metadata : undefined,
    };
  },

  toJSON(message: TaskArtifactUpdateEvent): unknown {
    const obj: any = {};
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.artifact !== undefined) {
      obj.artifact = Artifact.toJSON(message.artifact);
    }
    if (message.append !== false) {
      obj.append = message.append;
    }
    if (message.lastChunk !== false) {
      obj.lastChunk = message.lastChunk;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  },
};

export const AuthenticationInfo: MessageFns<AuthenticationInfo> = {
  fromJSON(object: any): AuthenticationInfo {
    return {
      scheme: isSet(object.scheme) ? globalThis.String(object.scheme) : "",
      credentials: isSet(object.credentials) ? globalThis.String(object.credentials) : "",
    };
  },

  toJSON(message: AuthenticationInfo): unknown {
    const obj: any = {};
    if (message.scheme !== "") {
      obj.scheme = message.scheme;
    }
    if (message.credentials !== "") {
      obj.credentials = message.credentials;
    }
    return obj;
  },
};

export const AgentInterface: MessageFns<AgentInterface> = {
  fromJSON(object: any): AgentInterface {
    return {
      url: isSet(object.url) ? globalThis.String(object.url) : "",
      protocolBinding: isSet(object.protocolBinding)
        ? globalThis.String(object.protocolBinding)
        : isSet(object.protocol_binding)
        ? globalThis.String(object.protocol_binding)
        : "",
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      protocolVersion: isSet(object.protocolVersion)
        ? globalThis.String(object.protocolVersion)
        : isSet(object.protocol_version)
        ? globalThis.String(object.protocol_version)
        : "",
    };
  },

  toJSON(message: AgentInterface): unknown {
    const obj: any = {};
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.protocolBinding !== "") {
      obj.protocolBinding = message.protocolBinding;
    }
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.protocolVersion !== "") {
      obj.protocolVersion = message.protocolVersion;
    }
    return obj;
  },
};

export const AgentCard: MessageFns<AgentCard> = {
  fromJSON(object: any): AgentCard {
    return {
      name: isSet(object.name) ? globalThis.String(object.name) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      supportedInterfaces: globalThis.Array.isArray(object?.supportedInterfaces)
        ? object.supportedInterfaces.map((e: any) => AgentInterface.fromJSON(e))
        : globalThis.Array.isArray(object?.supported_interfaces)
        ? object.supported_interfaces.map((e: any) => AgentInterface.fromJSON(e))
        : [],
      provider: isSet(object.provider) ? AgentProvider.fromJSON(object.provider) : undefined,
      version: isSet(object.version) ? globalThis.String(object.version) : "",
      documentationUrl: isSet(object.documentationUrl)
        ? globalThis.String(object.documentationUrl)
        : isSet(object.documentation_url)
        ? globalThis.String(object.documentation_url)
        : undefined,
      capabilities: isSet(object.capabilities) ? AgentCapabilities.fromJSON(object.capabilities) : undefined,
      securitySchemes: isObject(object.securitySchemes)
        ? (globalThis.Object.entries(object.securitySchemes) as [string, any][]).reduce(
          (acc: { [key: string]: SecurityScheme }, [key, value]: [string, any]) => {
            acc[key] = SecurityScheme.fromJSON(value);
            return acc;
          },
          {},
        )
        : isObject(object.security_schemes)
        ? (globalThis.Object.entries(object.security_schemes) as [string, any][]).reduce(
          (acc: { [key: string]: SecurityScheme }, [key, value]: [string, any]) => {
            acc[key] = SecurityScheme.fromJSON(value);
            return acc;
          },
          {},
        )
        : {},
      securityRequirements: globalThis.Array.isArray(object?.securityRequirements)
        ? object.securityRequirements.map((e: any) => SecurityRequirement.fromJSON(e))
        : globalThis.Array.isArray(object?.security_requirements)
        ? object.security_requirements.map((e: any) => SecurityRequirement.fromJSON(e))
        : [],
      defaultInputModes: globalThis.Array.isArray(object?.defaultInputModes)
        ? object.defaultInputModes.map((e: any) => globalThis.String(e))
        : globalThis.Array.isArray(object?.default_input_modes)
        ? object.default_input_modes.map((e: any) => globalThis.String(e))
        : [],
      defaultOutputModes: globalThis.Array.isArray(object?.defaultOutputModes)
        ? object.defaultOutputModes.map((e: any) => globalThis.String(e))
        : globalThis.Array.isArray(object?.default_output_modes)
        ? object.default_output_modes.map((e: any) => globalThis.String(e))
        : [],
      skills: globalThis.Array.isArray(object?.skills)
        ? object.skills.map((e: any) => AgentSkill.fromJSON(e))
        : [],
      signatures: globalThis.Array.isArray(object?.signatures)
        ? object.signatures.map((e: any) => AgentCardSignature.fromJSON(e))
        : [],
      iconUrl: isSet(object.iconUrl)
        ? globalThis.String(object.iconUrl)
        : isSet(object.icon_url)
        ? globalThis.String(object.icon_url)
        : undefined,
    };
  },

  toJSON(message: AgentCard): unknown {
    const obj: any = {};
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.supportedInterfaces?.length) {
      obj.supportedInterfaces = message.supportedInterfaces.map((e) => AgentInterface.toJSON(e));
    }
    if (message.provider !== undefined) {
      obj.provider = AgentProvider.toJSON(message.provider);
    }
    if (message.version !== "") {
      obj.version = message.version;
    }
    if (message.documentationUrl !== undefined) {
      obj.documentationUrl = message.documentationUrl;
    }
    if (message.capabilities !== undefined) {
      obj.capabilities = AgentCapabilities.toJSON(message.capabilities);
    }
    if (message.securitySchemes) {
      const entries = globalThis.Object.entries(message.securitySchemes) as [string, SecurityScheme][];
      if (entries.length > 0) {
        obj.securitySchemes = {};
        entries.forEach(([k, v]) => {
          obj.securitySchemes[k] = SecurityScheme.toJSON(v);
        });
      }
    }
    if (message.securityRequirements?.length) {
      obj.securityRequirements = message.securityRequirements.map((e) => SecurityRequirement.toJSON(e));
    }
    if (message.defaultInputModes?.length) {
      obj.defaultInputModes = message.defaultInputModes;
    }
    if (message.defaultOutputModes?.length) {
      obj.defaultOutputModes = message.defaultOutputModes;
    }
    if (message.skills?.length) {
      obj.skills = message.skills.map((e) => AgentSkill.toJSON(e));
    }
    if (message.signatures?.length) {
      obj.signatures = message.signatures.map((e) => AgentCardSignature.toJSON(e));
    }
    if (message.iconUrl !== undefined) {
      obj.iconUrl = message.iconUrl;
    }
    return obj;
  },
};

export const AgentCard_SecuritySchemesEntry: MessageFns<AgentCard_SecuritySchemesEntry> = {
  fromJSON(object: any): AgentCard_SecuritySchemesEntry {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? SecurityScheme.fromJSON(object.value) : undefined,
    };
  },

  toJSON(message: AgentCard_SecuritySchemesEntry): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== undefined) {
      obj.value = SecurityScheme.toJSON(message.value);
    }
    return obj;
  },
};

export const AgentProvider: MessageFns<AgentProvider> = {
  fromJSON(object: any): AgentProvider {
    return {
      url: isSet(object.url) ? globalThis.String(object.url) : "",
      organization: isSet(object.organization) ? globalThis.String(object.organization) : "",
    };
  },

  toJSON(message: AgentProvider): unknown {
    const obj: any = {};
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.organization !== "") {
      obj.organization = message.organization;
    }
    return obj;
  },
};

export const AgentCapabilities: MessageFns<AgentCapabilities> = {
  fromJSON(object: any): AgentCapabilities {
    return {
      streaming: isSet(object.streaming) ? globalThis.Boolean(object.streaming) : undefined,
      pushNotifications: isSet(object.pushNotifications)
        ? globalThis.Boolean(object.pushNotifications)
        : isSet(object.push_notifications)
        ? globalThis.Boolean(object.push_notifications)
        : undefined,
      extensions: globalThis.Array.isArray(object?.extensions)
        ? object.extensions.map((e: any) => AgentExtension.fromJSON(e))
        : [],
      extendedAgentCard: isSet(object.extendedAgentCard)
        ? globalThis.Boolean(object.extendedAgentCard)
        : isSet(object.extended_agent_card)
        ? globalThis.Boolean(object.extended_agent_card)
        : undefined,
    };
  },

  toJSON(message: AgentCapabilities): unknown {
    const obj: any = {};
    if (message.streaming !== undefined) {
      obj.streaming = message.streaming;
    }
    if (message.pushNotifications !== undefined) {
      obj.pushNotifications = message.pushNotifications;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions.map((e) => AgentExtension.toJSON(e));
    }
    if (message.extendedAgentCard !== undefined) {
      obj.extendedAgentCard = message.extendedAgentCard;
    }
    return obj;
  },
};

export const AgentExtension: MessageFns<AgentExtension> = {
  fromJSON(object: any): AgentExtension {
    return {
      uri: isSet(object.uri) ? globalThis.String(object.uri) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      required: isSet(object.required) ? globalThis.Boolean(object.required) : false,
      params: isObject(object.params) ? object.params : undefined,
    };
  },

  toJSON(message: AgentExtension): unknown {
    const obj: any = {};
    if (message.uri !== "") {
      obj.uri = message.uri;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.required !== false) {
      obj.required = message.required;
    }
    if (message.params !== undefined) {
      obj.params = message.params;
    }
    return obj;
  },
};

export const AgentSkill: MessageFns<AgentSkill> = {
  fromJSON(object: any): AgentSkill {
    return {
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      name: isSet(object.name) ? globalThis.String(object.name) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      tags: globalThis.Array.isArray(object?.tags) ? object.tags.map((e: any) => globalThis.String(e)) : [],
      examples: globalThis.Array.isArray(object?.examples) ? object.examples.map((e: any) => globalThis.String(e)) : [],
      inputModes: globalThis.Array.isArray(object?.inputModes)
        ? object.inputModes.map((e: any) => globalThis.String(e))
        : globalThis.Array.isArray(object?.input_modes)
        ? object.input_modes.map((e: any) => globalThis.String(e))
        : [],
      outputModes: globalThis.Array.isArray(object?.outputModes)
        ? object.outputModes.map((e: any) => globalThis.String(e))
        : globalThis.Array.isArray(object?.output_modes)
        ? object.output_modes.map((e: any) => globalThis.String(e))
        : [],
      securityRequirements: globalThis.Array.isArray(object?.securityRequirements)
        ? object.securityRequirements.map((e: any) => SecurityRequirement.fromJSON(e))
        : globalThis.Array.isArray(object?.security_requirements)
        ? object.security_requirements.map((e: any) => SecurityRequirement.fromJSON(e))
        : [],
    };
  },

  toJSON(message: AgentSkill): unknown {
    const obj: any = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.tags?.length) {
      obj.tags = message.tags;
    }
    if (message.examples?.length) {
      obj.examples = message.examples;
    }
    if (message.inputModes?.length) {
      obj.inputModes = message.inputModes;
    }
    if (message.outputModes?.length) {
      obj.outputModes = message.outputModes;
    }
    if (message.securityRequirements?.length) {
      obj.securityRequirements = message.securityRequirements.map((e) => SecurityRequirement.toJSON(e));
    }
    return obj;
  },
};

export const AgentCardSignature: MessageFns<AgentCardSignature> = {
  fromJSON(object: any): AgentCardSignature {
    return {
      protected: isSet(object.protected) ? globalThis.String(object.protected) : "",
      signature: isSet(object.signature) ? globalThis.String(object.signature) : "",
      header: isObject(object.header) ? object.header : undefined,
    };
  },

  toJSON(message: AgentCardSignature): unknown {
    const obj: any = {};
    if (message.protected !== "") {
      obj.protected = message.protected;
    }
    if (message.signature !== "") {
      obj.signature = message.signature;
    }
    if (message.header !== undefined) {
      obj.header = message.header;
    }
    return obj;
  },
};

export const TaskPushNotificationConfig: MessageFns<TaskPushNotificationConfig> = {
  fromJSON(object: any): TaskPushNotificationConfig {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      taskId: isSet(object.taskId)
        ? globalThis.String(object.taskId)
        : isSet(object.task_id)
        ? globalThis.String(object.task_id)
        : "",
      url: isSet(object.url) ? globalThis.String(object.url) : "",
      token: isSet(object.token) ? globalThis.String(object.token) : "",
      authentication: isSet(object.authentication) ? AuthenticationInfo.fromJSON(object.authentication) : undefined,
    };
  },

  toJSON(message: TaskPushNotificationConfig): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.token !== "") {
      obj.token = message.token;
    }
    if (message.authentication !== undefined) {
      obj.authentication = AuthenticationInfo.toJSON(message.authentication);
    }
    return obj;
  },
};

export const StringList: MessageFns<StringList> = {
  fromJSON(object: any): StringList {
    return { list: globalThis.Array.isArray(object?.list) ? object.list.map((e: any) => globalThis.String(e)) : [] };
  },

  toJSON(message: StringList): unknown {
    const obj: any = {};
    if (message.list?.length) {
      obj.list = message.list;
    }
    return obj;
  },
};

export const SecurityRequirement: MessageFns<SecurityRequirement> = {
  fromJSON(object: any): SecurityRequirement {
    return {
      schemes: isObject(object.schemes)
        ? (globalThis.Object.entries(object.schemes) as [string, any][]).reduce(
          (acc: { [key: string]: StringList }, [key, value]: [string, any]) => {
            acc[key] = StringList.fromJSON(value);
            return acc;
          },
          {},
        )
        : {},
    };
  },

  toJSON(message: SecurityRequirement): unknown {
    const obj: any = {};
    if (message.schemes) {
      const entries = globalThis.Object.entries(message.schemes) as [string, StringList][];
      if (entries.length > 0) {
        obj.schemes = {};
        entries.forEach(([k, v]) => {
          obj.schemes[k] = StringList.toJSON(v);
        });
      }
    }
    return obj;
  },
};

export const SecurityRequirement_SchemesEntry: MessageFns<SecurityRequirement_SchemesEntry> = {
  fromJSON(object: any): SecurityRequirement_SchemesEntry {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? StringList.fromJSON(object.value) : undefined,
    };
  },

  toJSON(message: SecurityRequirement_SchemesEntry): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== undefined) {
      obj.value = StringList.toJSON(message.value);
    }
    return obj;
  },
};

export const SecurityScheme: MessageFns<SecurityScheme> = {
  fromJSON(object: any): SecurityScheme {
    return {
      scheme: isSet(object.apiKeySecurityScheme)
        ? { $case: "apiKeySecurityScheme", value: APIKeySecurityScheme.fromJSON(object.apiKeySecurityScheme) }
        : isSet(object.api_key_security_scheme)
        ? { $case: "apiKeySecurityScheme", value: APIKeySecurityScheme.fromJSON(object.api_key_security_scheme) }
        : isSet(object.httpAuthSecurityScheme)
        ? { $case: "httpAuthSecurityScheme", value: HTTPAuthSecurityScheme.fromJSON(object.httpAuthSecurityScheme) }
        : isSet(object.http_auth_security_scheme)
        ? { $case: "httpAuthSecurityScheme", value: HTTPAuthSecurityScheme.fromJSON(object.http_auth_security_scheme) }
        : isSet(object.oauth2SecurityScheme)
        ? { $case: "oauth2SecurityScheme", value: OAuth2SecurityScheme.fromJSON(object.oauth2SecurityScheme) }
        : isSet(object.oauth2_security_scheme)
        ? { $case: "oauth2SecurityScheme", value: OAuth2SecurityScheme.fromJSON(object.oauth2_security_scheme) }
        : isSet(object.openIdConnectSecurityScheme)
        ? {
          $case: "openIdConnectSecurityScheme",
          value: OpenIdConnectSecurityScheme.fromJSON(object.openIdConnectSecurityScheme),
        }
        : isSet(object.open_id_connect_security_scheme)
        ? {
          $case: "openIdConnectSecurityScheme",
          value: OpenIdConnectSecurityScheme.fromJSON(object.open_id_connect_security_scheme),
        }
        : isSet(object.mtlsSecurityScheme)
        ? { $case: "mtlsSecurityScheme", value: MutualTlsSecurityScheme.fromJSON(object.mtlsSecurityScheme) }
        : isSet(object.mtls_security_scheme)
        ? { $case: "mtlsSecurityScheme", value: MutualTlsSecurityScheme.fromJSON(object.mtls_security_scheme) }
        : undefined,
    };
  },

  toJSON(message: SecurityScheme): unknown {
    const obj: any = {};
    if (message.scheme?.$case === "apiKeySecurityScheme") {
      obj.apiKeySecurityScheme = APIKeySecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "httpAuthSecurityScheme") {
      obj.httpAuthSecurityScheme = HTTPAuthSecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "oauth2SecurityScheme") {
      obj.oauth2SecurityScheme = OAuth2SecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "openIdConnectSecurityScheme") {
      obj.openIdConnectSecurityScheme = OpenIdConnectSecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "mtlsSecurityScheme") {
      obj.mtlsSecurityScheme = MutualTlsSecurityScheme.toJSON(message.scheme.value);
    }
    return obj;
  },
};

export const APIKeySecurityScheme: MessageFns<APIKeySecurityScheme> = {
  fromJSON(object: any): APIKeySecurityScheme {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      location: isSet(object.location) ? globalThis.String(object.location) : "",
      name: isSet(object.name) ? globalThis.String(object.name) : "",
    };
  },

  toJSON(message: APIKeySecurityScheme): unknown {
    const obj: any = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.location !== "") {
      obj.location = message.location;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    return obj;
  },
};

export const HTTPAuthSecurityScheme: MessageFns<HTTPAuthSecurityScheme> = {
  fromJSON(object: any): HTTPAuthSecurityScheme {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      scheme: isSet(object.scheme) ? globalThis.String(object.scheme) : "",
      bearerFormat: isSet(object.bearerFormat)
        ? globalThis.String(object.bearerFormat)
        : isSet(object.bearer_format)
        ? globalThis.String(object.bearer_format)
        : "",
    };
  },

  toJSON(message: HTTPAuthSecurityScheme): unknown {
    const obj: any = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.scheme !== "") {
      obj.scheme = message.scheme;
    }
    if (message.bearerFormat !== "") {
      obj.bearerFormat = message.bearerFormat;
    }
    return obj;
  },
};

export const OAuth2SecurityScheme: MessageFns<OAuth2SecurityScheme> = {
  fromJSON(object: any): OAuth2SecurityScheme {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      flows: isSet(object.flows) ? OAuthFlows.fromJSON(object.flows) : undefined,
      oauth2MetadataUrl: isSet(object.oauth2MetadataUrl)
        ? globalThis.String(object.oauth2MetadataUrl)
        : isSet(object.oauth2_metadata_url)
        ? globalThis.String(object.oauth2_metadata_url)
        : "",
    };
  },

  toJSON(message: OAuth2SecurityScheme): unknown {
    const obj: any = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.flows !== undefined) {
      obj.flows = OAuthFlows.toJSON(message.flows);
    }
    if (message.oauth2MetadataUrl !== "") {
      obj.oauth2MetadataUrl = message.oauth2MetadataUrl;
    }
    return obj;
  },
};

export const OpenIdConnectSecurityScheme: MessageFns<OpenIdConnectSecurityScheme> = {
  fromJSON(object: any): OpenIdConnectSecurityScheme {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      openIdConnectUrl: isSet(object.openIdConnectUrl)
        ? globalThis.String(object.openIdConnectUrl)
        : isSet(object.open_id_connect_url)
        ? globalThis.String(object.open_id_connect_url)
        : "",
    };
  },

  toJSON(message: OpenIdConnectSecurityScheme): unknown {
    const obj: any = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.openIdConnectUrl !== "") {
      obj.openIdConnectUrl = message.openIdConnectUrl;
    }
    return obj;
  },
};

export const MutualTlsSecurityScheme: MessageFns<MutualTlsSecurityScheme> = {
  fromJSON(object: any): MutualTlsSecurityScheme {
    return { description: isSet(object.description) ? globalThis.String(object.description) : "" };
  },

  toJSON(message: MutualTlsSecurityScheme): unknown {
    const obj: any = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    return obj;
  },
};

export const OAuthFlows: MessageFns<OAuthFlows> = {
  fromJSON(object: any): OAuthFlows {
    return {
      flow: isSet(object.authorizationCode)
        ? { $case: "authorizationCode", value: AuthorizationCodeOAuthFlow.fromJSON(object.authorizationCode) }
        : isSet(object.authorization_code)
        ? { $case: "authorizationCode", value: AuthorizationCodeOAuthFlow.fromJSON(object.authorization_code) }
        : isSet(object.clientCredentials)
        ? { $case: "clientCredentials", value: ClientCredentialsOAuthFlow.fromJSON(object.clientCredentials) }
        : isSet(object.client_credentials)
        ? { $case: "clientCredentials", value: ClientCredentialsOAuthFlow.fromJSON(object.client_credentials) }
        : isSet(object.implicit)
        ? { $case: "implicit", value: ImplicitOAuthFlow.fromJSON(object.implicit) }
        : isSet(object.password)
        ? { $case: "password", value: PasswordOAuthFlow.fromJSON(object.password) }
        : isSet(object.deviceCode)
        ? { $case: "deviceCode", value: DeviceCodeOAuthFlow.fromJSON(object.deviceCode) }
        : isSet(object.device_code)
        ? { $case: "deviceCode", value: DeviceCodeOAuthFlow.fromJSON(object.device_code) }
        : undefined,
    };
  },

  toJSON(message: OAuthFlows): unknown {
    const obj: any = {};
    if (message.flow?.$case === "authorizationCode") {
      obj.authorizationCode = AuthorizationCodeOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "clientCredentials") {
      obj.clientCredentials = ClientCredentialsOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "implicit") {
      obj.implicit = ImplicitOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "password") {
      obj.password = PasswordOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "deviceCode") {
      obj.deviceCode = DeviceCodeOAuthFlow.toJSON(message.flow.value);
    }
    return obj;
  },
};

export const AuthorizationCodeOAuthFlow: MessageFns<AuthorizationCodeOAuthFlow> = {
  fromJSON(object: any): AuthorizationCodeOAuthFlow {
    return {
      authorizationUrl: isSet(object.authorizationUrl)
        ? globalThis.String(object.authorizationUrl)
        : isSet(object.authorization_url)
        ? globalThis.String(object.authorization_url)
        : "",
      tokenUrl: isSet(object.tokenUrl)
        ? globalThis.String(object.tokenUrl)
        : isSet(object.token_url)
        ? globalThis.String(object.token_url)
        : "",
      refreshUrl: isSet(object.refreshUrl)
        ? globalThis.String(object.refreshUrl)
        : isSet(object.refresh_url)
        ? globalThis.String(object.refresh_url)
        : "",
      scopes: isObject(object.scopes)
        ? (globalThis.Object.entries(object.scopes) as [string, any][]).reduce(
          (acc: { [key: string]: string }, [key, value]: [string, any]) => {
            acc[key] = globalThis.String(value);
            return acc;
          },
          {},
        )
        : {},
      pkceRequired: isSet(object.pkceRequired)
        ? globalThis.Boolean(object.pkceRequired)
        : isSet(object.pkce_required)
        ? globalThis.Boolean(object.pkce_required)
        : false,
    };
  },

  toJSON(message: AuthorizationCodeOAuthFlow): unknown {
    const obj: any = {};
    if (message.authorizationUrl !== "") {
      obj.authorizationUrl = message.authorizationUrl;
    }
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes) as [string, string][];
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    if (message.pkceRequired !== false) {
      obj.pkceRequired = message.pkceRequired;
    }
    return obj;
  },
};

export const AuthorizationCodeOAuthFlow_ScopesEntry: MessageFns<AuthorizationCodeOAuthFlow_ScopesEntry> = {
  fromJSON(object: any): AuthorizationCodeOAuthFlow_ScopesEntry {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? globalThis.String(object.value) : "",
    };
  },

  toJSON(message: AuthorizationCodeOAuthFlow_ScopesEntry): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== "") {
      obj.value = message.value;
    }
    return obj;
  },
};

export const ClientCredentialsOAuthFlow: MessageFns<ClientCredentialsOAuthFlow> = {
  fromJSON(object: any): ClientCredentialsOAuthFlow {
    return {
      tokenUrl: isSet(object.tokenUrl)
        ? globalThis.String(object.tokenUrl)
        : isSet(object.token_url)
        ? globalThis.String(object.token_url)
        : "",
      refreshUrl: isSet(object.refreshUrl)
        ? globalThis.String(object.refreshUrl)
        : isSet(object.refresh_url)
        ? globalThis.String(object.refresh_url)
        : "",
      scopes: isObject(object.scopes)
        ? (globalThis.Object.entries(object.scopes) as [string, any][]).reduce(
          (acc: { [key: string]: string }, [key, value]: [string, any]) => {
            acc[key] = globalThis.String(value);
            return acc;
          },
          {},
        )
        : {},
    };
  },

  toJSON(message: ClientCredentialsOAuthFlow): unknown {
    const obj: any = {};
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes) as [string, string][];
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  },
};

export const ClientCredentialsOAuthFlow_ScopesEntry: MessageFns<ClientCredentialsOAuthFlow_ScopesEntry> = {
  fromJSON(object: any): ClientCredentialsOAuthFlow_ScopesEntry {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? globalThis.String(object.value) : "",
    };
  },

  toJSON(message: ClientCredentialsOAuthFlow_ScopesEntry): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== "") {
      obj.value = message.value;
    }
    return obj;
  },
};

export const ImplicitOAuthFlow: MessageFns<ImplicitOAuthFlow> = {
  fromJSON(object: any): ImplicitOAuthFlow {
    return {
      authorizationUrl: isSet(object.authorizationUrl)
        ? globalThis.String(object.authorizationUrl)
        : isSet(object.authorization_url)
        ? globalThis.String(object.authorization_url)
        : "",
      refreshUrl: isSet(object.refreshUrl)
        ? globalThis.String(object.refreshUrl)
        : isSet(object.refresh_url)
        ? globalThis.String(object.refresh_url)
        : "",
      scopes: isObject(object.scopes)
        ? (globalThis.Object.entries(object.scopes) as [string, any][]).reduce(
          (acc: { [key: string]: string }, [key, value]: [string, any]) => {
            acc[key] = globalThis.String(value);
            return acc;
          },
          {},
        )
        : {},
    };
  },

  toJSON(message: ImplicitOAuthFlow): unknown {
    const obj: any = {};
    if (message.authorizationUrl !== "") {
      obj.authorizationUrl = message.authorizationUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes) as [string, string][];
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  },
};

export const ImplicitOAuthFlow_ScopesEntry: MessageFns<ImplicitOAuthFlow_ScopesEntry> = {
  fromJSON(object: any): ImplicitOAuthFlow_ScopesEntry {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? globalThis.String(object.value) : "",
    };
  },

  toJSON(message: ImplicitOAuthFlow_ScopesEntry): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== "") {
      obj.value = message.value;
    }
    return obj;
  },
};

export const PasswordOAuthFlow: MessageFns<PasswordOAuthFlow> = {
  fromJSON(object: any): PasswordOAuthFlow {
    return {
      tokenUrl: isSet(object.tokenUrl)
        ? globalThis.String(object.tokenUrl)
        : isSet(object.token_url)
        ? globalThis.String(object.token_url)
        : "",
      refreshUrl: isSet(object.refreshUrl)
        ? globalThis.String(object.refreshUrl)
        : isSet(object.refresh_url)
        ? globalThis.String(object.refresh_url)
        : "",
      scopes: isObject(object.scopes)
        ? (globalThis.Object.entries(object.scopes) as [string, any][]).reduce(
          (acc: { [key: string]: string }, [key, value]: [string, any]) => {
            acc[key] = globalThis.String(value);
            return acc;
          },
          {},
        )
        : {},
    };
  },

  toJSON(message: PasswordOAuthFlow): unknown {
    const obj: any = {};
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes) as [string, string][];
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  },
};

export const PasswordOAuthFlow_ScopesEntry: MessageFns<PasswordOAuthFlow_ScopesEntry> = {
  fromJSON(object: any): PasswordOAuthFlow_ScopesEntry {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? globalThis.String(object.value) : "",
    };
  },

  toJSON(message: PasswordOAuthFlow_ScopesEntry): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== "") {
      obj.value = message.value;
    }
    return obj;
  },
};

export const DeviceCodeOAuthFlow: MessageFns<DeviceCodeOAuthFlow> = {
  fromJSON(object: any): DeviceCodeOAuthFlow {
    return {
      deviceAuthorizationUrl: isSet(object.deviceAuthorizationUrl)
        ? globalThis.String(object.deviceAuthorizationUrl)
        : isSet(object.device_authorization_url)
        ? globalThis.String(object.device_authorization_url)
        : "",
      tokenUrl: isSet(object.tokenUrl)
        ? globalThis.String(object.tokenUrl)
        : isSet(object.token_url)
        ? globalThis.String(object.token_url)
        : "",
      refreshUrl: isSet(object.refreshUrl)
        ? globalThis.String(object.refreshUrl)
        : isSet(object.refresh_url)
        ? globalThis.String(object.refresh_url)
        : "",
      scopes: isObject(object.scopes)
        ? (globalThis.Object.entries(object.scopes) as [string, any][]).reduce(
          (acc: { [key: string]: string }, [key, value]: [string, any]) => {
            acc[key] = globalThis.String(value);
            return acc;
          },
          {},
        )
        : {},
    };
  },

  toJSON(message: DeviceCodeOAuthFlow): unknown {
    const obj: any = {};
    if (message.deviceAuthorizationUrl !== "") {
      obj.deviceAuthorizationUrl = message.deviceAuthorizationUrl;
    }
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes) as [string, string][];
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  },
};

export const DeviceCodeOAuthFlow_ScopesEntry: MessageFns<DeviceCodeOAuthFlow_ScopesEntry> = {
  fromJSON(object: any): DeviceCodeOAuthFlow_ScopesEntry {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? globalThis.String(object.value) : "",
    };
  },

  toJSON(message: DeviceCodeOAuthFlow_ScopesEntry): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== "") {
      obj.value = message.value;
    }
    return obj;
  },
};

export const SendMessageRequest: MessageFns<SendMessageRequest> = {
  fromJSON(object: any): SendMessageRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      message: isSet(object.message) ? Message.fromJSON(object.message) : undefined,
      configuration: isSet(object.configuration) ? SendMessageConfiguration.fromJSON(object.configuration) : undefined,
      metadata: isObject(object.metadata) ? object.metadata : undefined,
    };
  },

  toJSON(message: SendMessageRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.message !== undefined) {
      obj.message = Message.toJSON(message.message);
    }
    if (message.configuration !== undefined) {
      obj.configuration = SendMessageConfiguration.toJSON(message.configuration);
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  },
};

export const GetTaskRequest: MessageFns<GetTaskRequest> = {
  fromJSON(object: any): GetTaskRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      historyLength: isSet(object.historyLength)
        ? globalThis.Number(object.historyLength)
        : isSet(object.history_length)
        ? globalThis.Number(object.history_length)
        : undefined,
    };
  },

  toJSON(message: GetTaskRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.historyLength !== undefined) {
      obj.historyLength = Math.round(message.historyLength);
    }
    return obj;
  },
};

export const ListTasksRequest: MessageFns<ListTasksRequest> = {
  fromJSON(object: any): ListTasksRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      contextId: isSet(object.contextId)
        ? globalThis.String(object.contextId)
        : isSet(object.context_id)
        ? globalThis.String(object.context_id)
        : "",
      status: isSet(object.status) ? taskStateFromJSON(object.status) : 0,
      pageSize: isSet(object.pageSize)
        ? globalThis.Number(object.pageSize)
        : isSet(object.page_size)
        ? globalThis.Number(object.page_size)
        : undefined,
      pageToken: isSet(object.pageToken)
        ? globalThis.String(object.pageToken)
        : isSet(object.page_token)
        ? globalThis.String(object.page_token)
        : "",
      historyLength: isSet(object.historyLength)
        ? globalThis.Number(object.historyLength)
        : isSet(object.history_length)
        ? globalThis.Number(object.history_length)
        : undefined,
      statusTimestampAfter: isSet(object.statusTimestampAfter)
        ? globalThis.String(object.statusTimestampAfter)
        : isSet(object.status_timestamp_after)
        ? globalThis.String(object.status_timestamp_after)
        : undefined,
      includeArtifacts: isSet(object.includeArtifacts)
        ? globalThis.Boolean(object.includeArtifacts)
        : isSet(object.include_artifacts)
        ? globalThis.Boolean(object.include_artifacts)
        : undefined,
    };
  },

  toJSON(message: ListTasksRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== 0) {
      obj.status = taskStateToJSON(message.status);
    }
    if (message.pageSize !== undefined) {
      obj.pageSize = Math.round(message.pageSize);
    }
    if (message.pageToken !== "") {
      obj.pageToken = message.pageToken;
    }
    if (message.historyLength !== undefined) {
      obj.historyLength = Math.round(message.historyLength);
    }
    if (message.statusTimestampAfter !== undefined) {
      obj.statusTimestampAfter = message.statusTimestampAfter;
    }
    if (message.includeArtifacts !== undefined) {
      obj.includeArtifacts = message.includeArtifacts;
    }
    return obj;
  },
};

export const ListTasksResponse: MessageFns<ListTasksResponse> = {
  fromJSON(object: any): ListTasksResponse {
    return {
      tasks: globalThis.Array.isArray(object?.tasks) ? object.tasks.map((e: any) => Task.fromJSON(e)) : [],
      nextPageToken: isSet(object.nextPageToken)
        ? globalThis.String(object.nextPageToken)
        : isSet(object.next_page_token)
        ? globalThis.String(object.next_page_token)
        : "",
      pageSize: isSet(object.pageSize)
        ? globalThis.Number(object.pageSize)
        : isSet(object.page_size)
        ? globalThis.Number(object.page_size)
        : 0,
      totalSize: isSet(object.totalSize)
        ? globalThis.Number(object.totalSize)
        : isSet(object.total_size)
        ? globalThis.Number(object.total_size)
        : 0,
    };
  },

  toJSON(message: ListTasksResponse): unknown {
    const obj: any = {};
    if (message.tasks?.length) {
      obj.tasks = message.tasks.map((e) => Task.toJSON(e));
    }
    if (message.nextPageToken !== "") {
      obj.nextPageToken = message.nextPageToken;
    }
    if (message.pageSize !== 0) {
      obj.pageSize = Math.round(message.pageSize);
    }
    if (message.totalSize !== 0) {
      obj.totalSize = Math.round(message.totalSize);
    }
    return obj;
  },
};

export const CancelTaskRequest: MessageFns<CancelTaskRequest> = {
  fromJSON(object: any): CancelTaskRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      metadata: isObject(object.metadata) ? object.metadata : undefined,
    };
  },

  toJSON(message: CancelTaskRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  },
};

export const GetTaskPushNotificationConfigRequest: MessageFns<GetTaskPushNotificationConfigRequest> = {
  fromJSON(object: any): GetTaskPushNotificationConfigRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      taskId: isSet(object.taskId)
        ? globalThis.String(object.taskId)
        : isSet(object.task_id)
        ? globalThis.String(object.task_id)
        : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
    };
  },

  toJSON(message: GetTaskPushNotificationConfigRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    return obj;
  },
};

export const DeleteTaskPushNotificationConfigRequest: MessageFns<DeleteTaskPushNotificationConfigRequest> = {
  fromJSON(object: any): DeleteTaskPushNotificationConfigRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      taskId: isSet(object.taskId)
        ? globalThis.String(object.taskId)
        : isSet(object.task_id)
        ? globalThis.String(object.task_id)
        : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
    };
  },

  toJSON(message: DeleteTaskPushNotificationConfigRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    return obj;
  },
};

export const SubscribeToTaskRequest: MessageFns<SubscribeToTaskRequest> = {
  fromJSON(object: any): SubscribeToTaskRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
    };
  },

  toJSON(message: SubscribeToTaskRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    return obj;
  },
};

export const ListTaskPushNotificationConfigsRequest: MessageFns<ListTaskPushNotificationConfigsRequest> = {
  fromJSON(object: any): ListTaskPushNotificationConfigsRequest {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      taskId: isSet(object.taskId)
        ? globalThis.String(object.taskId)
        : isSet(object.task_id)
        ? globalThis.String(object.task_id)
        : "",
      pageSize: isSet(object.pageSize)
        ? globalThis.Number(object.pageSize)
        : isSet(object.page_size)
        ? globalThis.Number(object.page_size)
        : 0,
      pageToken: isSet(object.pageToken)
        ? globalThis.String(object.pageToken)
        : isSet(object.page_token)
        ? globalThis.String(object.page_token)
        : "",
    };
  },

  toJSON(message: ListTaskPushNotificationConfigsRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.pageSize !== 0) {
      obj.pageSize = Math.round(message.pageSize);
    }
    if (message.pageToken !== "") {
      obj.pageToken = message.pageToken;
    }
    return obj;
  },
};

export const GetExtendedAgentCardRequest: MessageFns<GetExtendedAgentCardRequest> = {
  fromJSON(object: any): GetExtendedAgentCardRequest {
    return { tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "" };
  },

  toJSON(message: GetExtendedAgentCardRequest): unknown {
    const obj: any = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    return obj;
  },
};

export const SendMessageResponse: MessageFns<SendMessageResponse> = {
  fromJSON(object: any): SendMessageResponse {
    return {
      payload: isSet(object.task)
        ? { $case: "task", value: Task.fromJSON(object.task) }
        : isSet(object.message)
        ? { $case: "message", value: Message.fromJSON(object.message) }
        : undefined,
    };
  },

  toJSON(message: SendMessageResponse): unknown {
    const obj: any = {};
    if (message.payload?.$case === "task") {
      obj.task = Task.toJSON(message.payload.value);
    } else if (message.payload?.$case === "message") {
      obj.message = Message.toJSON(message.payload.value);
    }
    return obj;
  },
};

export const StreamResponse: MessageFns<StreamResponse> = {
  fromJSON(object: any): StreamResponse {
    return {
      payload: isSet(object.task)
        ? { $case: "task", value: Task.fromJSON(object.task) }
        : isSet(object.message)
        ? { $case: "message", value: Message.fromJSON(object.message) }
        : isSet(object.statusUpdate)
        ? { $case: "statusUpdate", value: TaskStatusUpdateEvent.fromJSON(object.statusUpdate) }
        : isSet(object.status_update)
        ? { $case: "statusUpdate", value: TaskStatusUpdateEvent.fromJSON(object.status_update) }
        : isSet(object.artifactUpdate)
        ? { $case: "artifactUpdate", value: TaskArtifactUpdateEvent.fromJSON(object.artifactUpdate) }
        : isSet(object.artifact_update)
        ? { $case: "artifactUpdate", value: TaskArtifactUpdateEvent.fromJSON(object.artifact_update) }
        : undefined,
    };
  },

  toJSON(message: StreamResponse): unknown {
    const obj: any = {};
    if (message.payload?.$case === "task") {
      obj.task = Task.toJSON(message.payload.value);
    } else if (message.payload?.$case === "message") {
      obj.message = Message.toJSON(message.payload.value);
    } else if (message.payload?.$case === "statusUpdate") {
      obj.statusUpdate = TaskStatusUpdateEvent.toJSON(message.payload.value);
    } else if (message.payload?.$case === "artifactUpdate") {
      obj.artifactUpdate = TaskArtifactUpdateEvent.toJSON(message.payload.value);
    }
    return obj;
  },
};

export const ListTaskPushNotificationConfigsResponse: MessageFns<ListTaskPushNotificationConfigsResponse> = {
  fromJSON(object: any): ListTaskPushNotificationConfigsResponse {
    return {
      configs: globalThis.Array.isArray(object?.configs)
        ? object.configs.map((e: any) => TaskPushNotificationConfig.fromJSON(e))
        : [],
      nextPageToken: isSet(object.nextPageToken)
        ? globalThis.String(object.nextPageToken)
        : isSet(object.next_page_token)
        ? globalThis.String(object.next_page_token)
        : "",
    };
  },

  toJSON(message: ListTaskPushNotificationConfigsResponse): unknown {
    const obj: any = {};
    if (message.configs?.length) {
      obj.configs = message.configs.map((e) => TaskPushNotificationConfig.toJSON(e));
    }
    if (message.nextPageToken !== "") {
      obj.nextPageToken = message.nextPageToken;
    }
    return obj;
  },
};

function bytesFromBase64(b64: string): Uint8Array {
  return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
}

function base64FromBytes(arr: Uint8Array): string {
  return globalThis.Buffer.from(arr).toString("base64");
}

function isObject(value: any): boolean {
  return typeof value === "object" && value !== null;
}

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}

export interface MessageFns<T> {
  fromJSON(object: any): T;
  toJSON(message: T): unknown;
}

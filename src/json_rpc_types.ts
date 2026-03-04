import {
  AgentCard,
  Message,
  SendMessageResponse as ProtoSendMessageResponse,
  StreamResponse as ProtoStreamResponse,
  Task,
  PushNotificationConfig as ProtoPushNotificationConfig,
} from './types/pb/a2a_types.js';

/**
 * A discriminated union representing all possible A2A errors.
 */
export type A2AError =
  | JSONParseError
  | InvalidRequestError
  | MethodNotFoundError
  | InvalidParamsError
  | InternalError
  | TaskNotFoundError
  | TaskNotCancelableError
  | PushNotificationNotSupportedError
  | UnsupportedOperationError
  | ContentTypeNotSupportedError
  | InvalidAgentResponseError
  | AuthenticatedExtendedCardNotConfiguredError;

interface BaseError<T extends number> {
  code: T;
  data?: { [k: string]: unknown };
  message: string;
}

export type JSONParseError = BaseError<-32700>;
export type InvalidRequestError = BaseError<-32600>;
export type MethodNotFoundError = BaseError<-32601>;
export type InvalidParamsError = BaseError<-32602>;
export type InternalError = BaseError<-32603>;
export type TaskNotFoundError = BaseError<-32001>;
export type TaskNotCancelableError = BaseError<-32002>;
export type PushNotificationNotSupportedError = BaseError<-32003>;
export type UnsupportedOperationError = BaseError<-32004>;
export type ContentTypeNotSupportedError = BaseError<-32005>;
export type InvalidAgentResponseError = BaseError<-32006>;
export type AuthenticatedExtendedCardNotConfiguredError = BaseError<-32007>;

/**
 * A discriminated union representing all possible JSON-RPC 2.0 requests supported by the A2A specification.
 */
export type A2ARequest =
  | SendMessageRequest
  | SendStreamingMessageRequest
  | GetTaskRequest
  | CancelTaskRequest
  | SetTaskPushNotificationConfigRequest
  | GetTaskPushNotificationConfigRequest
  | TaskResubscriptionRequest
  | ListTaskPushNotificationConfigRequest
  | DeleteTaskPushNotificationConfigRequest
  | GetAuthenticatedExtendedCardRequest;

interface BaseRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: string;
  params?: { [k: string]: unknown } | JsonRpcTaskPushNotificationConfig;
}

export interface SendMessageRequest extends BaseRequest {
  method: 'message/send';
  params: {
    message: Message;
    configuration?: MessageSendConfiguration; // Will use protobuf's SendMessageConfiguration if needed
    metadata?: { [k: string]: unknown };
  };
}

export interface SendStreamingMessageRequest extends BaseRequest {
  method: 'message/stream';
  params: {
    message: Message;
    configuration?: MessageSendConfiguration;
    metadata?: { [k: string]: unknown };
  };
}

export interface GetTaskRequest extends BaseRequest {
  method: 'tasks/get';
  params: {
    id: string;
    historyLength?: number;
    metadata?: { [k: string]: unknown };
  };
}

export interface CancelTaskRequest extends BaseRequest {
  method: 'tasks/cancel';
  params: {
    id: string;
    metadata?: { [k: string]: unknown };
  };
}

// --- Push Notification Configuration ---

/**
 * Configuration for push notifications.
 */
export interface PushNotificationConfigItem {
  pushNotificationConfig: ProtoPushNotificationConfig;
}

/**
 * Parameters for setting/updating push notification configuration.
 */
export interface JsonRpcTaskPushNotificationConfig {
  taskId: string;
  pushNotificationConfig: ProtoPushNotificationConfig;
}

export interface SetTaskPushNotificationConfigRequest extends BaseRequest {
  method: 'tasks/pushNotificationConfig/set';
  params: JsonRpcTaskPushNotificationConfig;
}

export interface GetTaskPushNotificationConfigRequest extends BaseRequest {
  method: 'tasks/pushNotificationConfig/get';
  params: {
    id: string;
    pushNotificationConfigId?: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface TaskResubscriptionRequest extends BaseRequest {
  method: 'tasks/resubscribe';
  params: {
    id: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface ListTaskPushNotificationConfigRequest extends BaseRequest {
  method: 'tasks/pushNotificationConfig/list';
  params: {
    id: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface DeleteTaskPushNotificationConfigRequest extends BaseRequest {
  method: 'tasks/pushNotificationConfig/delete';
  params: {
    id: string;
    pushNotificationConfigId: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface GetAuthenticatedExtendedCardRequest extends BaseRequest {
  method: 'agent/getAuthenticatedExtendedCard';
}

/**
 * JSON-RPC Error object.
 */
export interface JSONRPCError {
  code: number;
  data?: { [k: string]: unknown };
  message: string;
}

/**
 * JSON-RPC Error response.
 */
export interface JSONRPCErrorResponse {
  error: JSONRPCError | A2AError;
  id: string | number | null;
  jsonrpc: '2.0';
}

/**
 * JSON-RPC Success responses.
 */

interface BaseSuccessResponse<T> {
  id: string | number | null;
  jsonrpc: '2.0';
  result: T;
}

export type SendMessageSuccessResponse = BaseSuccessResponse<ProtoSendMessageResponse>;
export type SendStreamingMessageSuccessResponse = BaseSuccessResponse<ProtoStreamResponse>;
export type GetTaskSuccessResponse = BaseSuccessResponse<Task>;
export type CancelTaskSuccessResponse = BaseSuccessResponse<Task>;
export type SetTaskPushNotificationConfigSuccessResponse =
  BaseSuccessResponse<JsonRpcTaskPushNotificationConfig>;
export type GetTaskPushNotificationConfigSuccessResponse =
  BaseSuccessResponse<JsonRpcTaskPushNotificationConfig>;
export type ListTaskPushNotificationConfigSuccessResponse = BaseSuccessResponse<
  JsonRpcTaskPushNotificationConfig[]
>;
export type DeleteTaskPushNotificationConfigSuccessResponse = BaseSuccessResponse<null>;
export type GetAuthenticatedExtendedCardSuccessResponse = BaseSuccessResponse<AgentCard>;

interface BaseParams {
  id: string;
  metadata?: { [k: string]: unknown };
}

export interface TaskQueryParams extends BaseParams {
  historyLength?: number;
}

export type TaskIdParams = BaseParams;

export interface GetTaskPushNotificationConfigParams extends BaseParams {
  pushNotificationConfigId?: string;
}

export type ListTaskPushNotificationConfigParams = BaseParams;

export interface DeleteTaskPushNotificationConfigParams extends BaseParams {
  pushNotificationConfigId: string;
}

export interface MessageSendParams {
  message: Message;
  configuration?: MessageSendConfiguration;
  metadata?: { [k: string]: unknown };
}

export interface MessageSendConfiguration {
  blocking?: boolean;
  acceptedOutputModes?: string[];
  pushNotificationConfig?: JsonRpcTaskPushNotificationConfig;
  historyLength?: number;
}

export interface PushNotificationAuthenticationInfo {
  schemes: string[];
  credentials?: string;
}

export type SendMessageResponse = SendMessageSuccessResponse | JSONRPCErrorResponse;
export type SendStreamingMessageResponse =
  | SendStreamingMessageSuccessResponse
  | JSONRPCErrorResponse;
export type GetTaskResponse = GetTaskSuccessResponse | JSONRPCErrorResponse;
export type CancelTaskResponse = CancelTaskSuccessResponse | JSONRPCErrorResponse;
export type SetTaskPushNotificationConfigResponse =
  | SetTaskPushNotificationConfigSuccessResponse
  | JSONRPCErrorResponse;
export type GetTaskPushNotificationConfigResponse =
  | GetTaskPushNotificationConfigSuccessResponse
  | JSONRPCErrorResponse;
export type ListTaskPushNotificationConfigResponse =
  | ListTaskPushNotificationConfigSuccessResponse
  | JSONRPCErrorResponse;
export type DeleteTaskPushNotificationConfigResponse =
  | DeleteTaskPushNotificationConfigSuccessResponse
  | JSONRPCErrorResponse;
export type GetAuthenticatedExtendedCardResponse =
  | GetAuthenticatedExtendedCardSuccessResponse
  | JSONRPCErrorResponse;

export type JSONRPCResponse =
  | JSONRPCErrorResponse
  | SendMessageSuccessResponse
  | SendStreamingMessageSuccessResponse
  | GetTaskSuccessResponse
  | CancelTaskSuccessResponse
  | SetTaskPushNotificationConfigSuccessResponse
  | GetTaskPushNotificationConfigSuccessResponse
  | ListTaskPushNotificationConfigSuccessResponse
  | DeleteTaskPushNotificationConfigSuccessResponse
  | GetAuthenticatedExtendedCardSuccessResponse;

export interface JSONRPCMessage {
  id?: string | number | null;
  jsonrpc: '2.0';
}

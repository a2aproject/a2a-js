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

export interface JSONParseError {
  code: -32700;
  data?: { [k: string]: unknown };
  message: string;
}

export interface InvalidRequestError {
  code: -32600;
  data?: { [k: string]: unknown };
  message: string;
}

export interface MethodNotFoundError {
  code: -32601;
  data?: { [k: string]: unknown };
  message: string;
}

export interface InvalidParamsError {
  code: -32602;
  data?: { [k: string]: unknown };
  message: string;
}

export interface InternalError {
  code: -32603;
  data?: { [k: string]: unknown };
  message: string;
}

export interface TaskNotFoundError {
  code: -32001;
  data?: { [k: string]: unknown };
  message: string;
}

export interface TaskNotCancelableError {
  code: -32002;
  data?: { [k: string]: unknown };
  message: string;
}

export interface PushNotificationNotSupportedError {
  code: -32003;
  data?: { [k: string]: unknown };
  message: string;
}

export interface UnsupportedOperationError {
  code: -32004;
  data?: { [k: string]: unknown };
  message: string;
}

export interface ContentTypeNotSupportedError {
  code: -32005;
  data?: { [k: string]: unknown };
  message: string;
}

export interface InvalidAgentResponseError {
  code: -32006;
  data?: { [k: string]: unknown };
  message: string;
}

export interface AuthenticatedExtendedCardNotConfiguredError {
  code: -32007;
  data?: { [k: string]: unknown };
  message: string;
}

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

export interface SendMessageRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'message/send';
  params: {
    message: Message;
    configuration?: MessageSendConfiguration; // Will use protobuf's SendMessageConfiguration if needed
    metadata?: { [k: string]: unknown };
  };
}

export interface SendStreamingMessageRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'message/stream';
  params: {
    message: Message;
    configuration?: MessageSendConfiguration;
    metadata?: { [k: string]: unknown };
  };
}

export interface GetTaskRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'tasks/get';
  params: {
    id: string;
    historyLength?: number;
    metadata?: { [k: string]: unknown };
  };
}

export interface CancelTaskRequest {
  id: string | number;
  jsonrpc: '2.0';
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

export interface SetTaskPushNotificationConfigRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'tasks/pushNotificationConfig/set';
  params: JsonRpcTaskPushNotificationConfig;
}

export interface GetTaskPushNotificationConfigRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'tasks/pushNotificationConfig/get';
  params: {
    id: string;
    pushNotificationConfigId?: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface TaskResubscriptionRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'tasks/resubscribe';
  params: {
    id: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface ListTaskPushNotificationConfigRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'tasks/pushNotificationConfig/list';
  params: {
    id: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface DeleteTaskPushNotificationConfigRequest {
  id: string | number;
  jsonrpc: '2.0';
  method: 'tasks/pushNotificationConfig/delete';
  params: {
    id: string;
    pushNotificationConfigId: string;
    metadata?: { [k: string]: unknown };
  };
}

export interface GetAuthenticatedExtendedCardRequest {
  id: string | number;
  jsonrpc: '2.0';
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

export interface SendMessageSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: ProtoSendMessageResponse;
}

export interface SendStreamingMessageSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: ProtoStreamResponse;
}

export interface GetTaskSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: Task;
}

export interface CancelTaskSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: Task;
}

export interface SetTaskPushNotificationConfigSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: JsonRpcTaskPushNotificationConfig;
}

export interface GetTaskPushNotificationConfigSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: JsonRpcTaskPushNotificationConfig;
}

export interface ListTaskPushNotificationConfigSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: JsonRpcTaskPushNotificationConfig[];
}

export interface DeleteTaskPushNotificationConfigSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: null;
}

export interface GetAuthenticatedExtendedCardSuccessResponse {
  id: string | number | null;
  jsonrpc: '2.0';
  result: AgentCard;
}

export interface TaskQueryParams {
  id: string;
  historyLength?: number;
  metadata?: { [k: string]: unknown };
}

export interface TaskIdParams {
  id: string;
  metadata?: { [k: string]: unknown };
}

export interface GetTaskPushNotificationConfigParams {
  id: string;
  pushNotificationConfigId?: string;
  metadata?: { [k: string]: unknown };
}

export interface ListTaskPushNotificationConfigParams {
  id: string;
  metadata?: { [k: string]: unknown };
}

export interface DeleteTaskPushNotificationConfigParams {
  id: string;
  pushNotificationConfigId: string;
  metadata?: { [k: string]: unknown };
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

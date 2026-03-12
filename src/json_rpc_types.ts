import {
  AgentCard,
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

export interface BaseSuccessResponse<T> {
  id: string | number | null;
  jsonrpc: '2.0';
  result: T;
}

export type SendMessageSuccessResponse = BaseSuccessResponse<ProtoSendMessageResponse>;
export type SendStreamingMessageSuccessResponse = BaseSuccessResponse<ProtoStreamResponse>;
export type GetTaskSuccessResponse = BaseSuccessResponse<Task>;
export type CancelTaskSuccessResponse = BaseSuccessResponse<Task>;
export type SetTaskPushNotificationConfigSuccessResponse =
  BaseSuccessResponse<ProtoPushNotificationConfig>;
export type GetTaskPushNotificationConfigSuccessResponse =
  BaseSuccessResponse<ProtoPushNotificationConfig>;
export type ListTaskPushNotificationConfigSuccessResponse = BaseSuccessResponse<{
  configs: ProtoPushNotificationConfig[];
}>;
export type DeleteTaskPushNotificationConfigSuccessResponse = BaseSuccessResponse<null>;
export type GetAuthenticatedExtendedCardSuccessResponse = BaseSuccessResponse<AgentCard>;

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

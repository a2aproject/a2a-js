import {
  AgentCard,
  SendMessageResponse as ProtoSendMessageResponse,
  StreamResponse as ProtoStreamResponse,
  Task,
  PushNotificationConfig as ProtoPushNotificationConfig,
} from './types/pb/a2a_types.js';

/**
 * JSON-RPC Error object.
 */
interface JSONRPCError {
  code: number;
  data?: { [k: string]: unknown };
  message: string;
}

/**
 * JSON-RPC Error response.
 */
export interface JSONRPCErrorResponse {
  error: JSONRPCError;
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

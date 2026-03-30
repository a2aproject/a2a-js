import {
  SendMessageResponse,
  SendStreamingMessageResponse,
  GetTaskResponse,
  CancelTaskResponse,
  CreateTaskPushNotificationConfigResponse,
  GetTaskPushNotificationConfigResponse,
  ListTaskPushNotificationConfigSuccessResponse,
  DeleteTaskPushNotificationConfigSuccessResponse,
  GetAuthenticatedExtendedCardSuccessResponse,
  JSONRPCErrorResponse,
} from './json_rpc_types.js';

/**
 * Represents any valid JSON-RPC response defined in the A2A protocol.
 */
export type A2AResponse =
  | SendMessageResponse
  | SendStreamingMessageResponse
  | GetTaskResponse
  | CancelTaskResponse
  | CreateTaskPushNotificationConfigResponse
  | GetTaskPushNotificationConfigResponse
  | ListTaskPushNotificationConfigSuccessResponse
  | DeleteTaskPushNotificationConfigSuccessResponse
  | GetAuthenticatedExtendedCardSuccessResponse
  | JSONRPCErrorResponse; // Catch-all for other error responses

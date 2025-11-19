import {
  SendMessageResponse,
  SendStreamingMessageResponse,
  GetTaskResponse,
  CancelTaskResponse,
  SetTaskPushNotificationConfigResponse,
  GetTaskPushNotificationConfigResponse,
  JSONRPCErrorResponse,
  ListTaskPushNotificationConfigSuccessResponse,
  DeleteTaskPushNotificationConfigSuccessResponse,
  GetAuthenticatedExtendedCardSuccessResponse,
} from './types.js';

/**
 * Represents any valid JSON-RPC response defined in the A2A protocol.
 */
export type A2AResponse =
  | SendMessageResponse
  | SendStreamingMessageResponse
  | GetTaskResponse
  | CancelTaskResponse
  | SetTaskPushNotificationConfigResponse
  | GetTaskPushNotificationConfigResponse
  | ListTaskPushNotificationConfigSuccessResponse
  | DeleteTaskPushNotificationConfigSuccessResponse
  | GetAuthenticatedExtendedCardSuccessResponse
  | JSONRPCErrorResponse; // Catch-all for other error responses

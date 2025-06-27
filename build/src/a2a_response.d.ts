import { SendMessageResponse, SendStreamingMessageResponse, GetTaskResponse, CancelTaskResponse, SetTaskPushNotificationConfigResponse, GetTaskPushNotificationConfigResponse, JSONRPCErrorResponse } from "./types.js";
/**
 * Represents any valid JSON-RPC response defined in the A2A protocol.
 */
export type A2AResponse = SendMessageResponse | SendStreamingMessageResponse | GetTaskResponse | CancelTaskResponse | SetTaskPushNotificationConfigResponse | GetTaskPushNotificationConfigResponse | JSONRPCErrorResponse;

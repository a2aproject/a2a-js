/**
 * Exports the common types.
 *
 * Use the client/index.ts file to import the client-only codebase.
 * Use the server/index.ts file to import the server-only codebase.
 */

export * from './types/pb/a2a_types.js';
export { Role } from './types/pb/a2a_types.js';
export {
  type A2AError,
  type A2ARequest,
  type JSONRPCError,
  type JSONRPCErrorResponse,
  type JSONRPCMessage,
  type JSONRPCResponse,
  type SendMessageSuccessResponse,
  type SendStreamingMessageSuccessResponse,
  type GetTaskSuccessResponse,
  type CancelTaskSuccessResponse,
  type SetTaskPushNotificationConfigSuccessResponse,
  type GetTaskPushNotificationConfigSuccessResponse,
  type ListTaskPushNotificationConfigSuccessResponse,
  type DeleteTaskPushNotificationConfigSuccessResponse,
  type GetAuthenticatedExtendedCardSuccessResponse,
  type SendMessageResponse,
  type SendStreamingMessageResponse,
  type GetTaskResponse,
  type CancelTaskResponse,
  type SetTaskPushNotificationConfigResponse,
  type GetTaskPushNotificationConfigResponse,
  type ListTaskPushNotificationConfigResponse,
  type DeleteTaskPushNotificationConfigResponse,
  type GetAuthenticatedExtendedCardResponse,
  type JsonRpcTaskPushNotificationConfig,
  type TaskQueryParams,
  type TaskIdParams,
  type GetTaskPushNotificationConfigParams,
  type ListTaskPushNotificationConfigParams,
  type DeleteTaskPushNotificationConfigParams,
  type MessageSendParams,
  type MessageSendConfiguration,
  type PushNotificationAuthenticationInfo,
} from './json_rpc_types.js';
export type { A2AResponse } from './a2a_response.js';
export { AGENT_CARD_PATH, HTTP_EXTENSION_HEADER } from './constants.js';
export { Extensions, type ExtensionURI } from './extensions.js';

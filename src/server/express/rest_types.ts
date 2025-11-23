/**
 * REST API Types (HTTP+JSON Transport) - snake_case naming
 *
 * These types mirror the internal camelCase types but use snake_case
 * for field names, following REST/HTTP API conventions.
 *
 * NOTE: These types are internal to the HTTP REST handler implementation
 * and should not be exported from the public API.
 */

/**
 * REST API Part type - union of text, file, or data parts (snake_case).
 */
export type RestPart = RestTextPart | RestFilePart | RestDataPart;

/**
 * REST API text part with snake_case field names.
 */
export interface RestTextPart {
  kind: 'text';
  text: string;
}

/**
 * REST API file with base64-encoded bytes (snake_case).
 */
export interface RestFileWithBytes {
  bytes: string;
  mime_type?: string;
  name?: string;
}

/**
 * REST API file with URI reference (snake_case).
 */
export interface RestFileWithUri {
  mime_type?: string;
  name?: string;
  uri: string;
}

/**
 * REST API file part with snake_case field names.
 */
export interface RestFilePart {
  file: RestFileWithBytes | RestFileWithUri;
  kind: 'file';
  metadata?: Record<string, unknown>;
}

/**
 * REST API data part with snake_case field names.
 */
export interface RestDataPart {
  data: Record<string, unknown>;
  kind: 'data';
  metadata?: Record<string, unknown>;
}

/**
 * REST API Message with snake_case field names.
 */
export interface RestMessage {
  context_id?: string;
  extensions?: string[];
  kind: 'message';
  message_id: string;
  metadata?: Record<string, unknown>;
  parts: RestPart[];
  reference_task_ids?: string[];
  role: 'agent' | 'user';
  task_id?: string;
}

/**
 * REST API TaskStatus with snake_case field names.
 */
export interface RestTaskStatus {
  message?: RestMessage;
  state:
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'completed'
    | 'canceled'
    | 'failed'
    | 'rejected'
    | 'auth-required'
    | 'unknown';
  timestamp?: string;
}

/**
 * REST API Artifact with snake_case field names.
 */
export interface RestArtifact {
  artifact_id: string;
  kind: 'artifact';
  metadata?: Record<string, unknown>;
  name?: string;
  parts: RestPart[];
}

/**
 * REST API Task with snake_case field names.
 */
export interface RestTask {
  artifacts?: RestArtifact[];
  context_id: string;
  history?: RestMessage[];
  id: string;
  kind: 'task';
  metadata?: Record<string, unknown>;
  status: RestTaskStatus;
}

/**
 * REST API TaskStatusUpdateEvent with snake_case field names.
 */
export interface RestTaskStatusUpdateEvent {
  context_id: string;
  final: boolean;
  kind: 'status-update';
  metadata?: Record<string, unknown>;
  status: RestTaskStatus;
  task_id: string;
}

/**
 * REST API TaskArtifactUpdateEvent with snake_case field names.
 */
export interface RestTaskArtifactUpdateEvent {
  append?: boolean;
  artifact: RestArtifact;
  context_id: string;
  kind: 'artifact-update';
  metadata?: Record<string, unknown>;
  task_id: string;
}

/**
 * REST API push notification authentication info with snake_case field names.
 */
export interface RestPushNotificationAuthenticationInfo {
  credentials?: string;
  schemes: string[];
}

/**
 * REST API push notification configuration with snake_case field names.
 */
export interface RestPushNotificationConfig {
  authentication?: RestPushNotificationAuthenticationInfo;
  id: string;
  url: string;
}

/**
 * REST API message send configuration with snake_case field names.
 */
export interface RestMessageSendConfiguration {
  accepted_output_modes?: string[];
  blocking?: boolean;
  history_length?: number;
  push_notification_config?: RestPushNotificationConfig;
}

/**
 * REST API message send parameters with snake_case field names.
 */
export interface RestMessageSendParams {
  configuration?: RestMessageSendConfiguration;
  message: RestMessage;
  metadata?: Record<string, unknown>;
}

/**
 * REST API task push notification configuration with snake_case field names.
 */
export interface RestTaskPushNotificationConfig {
  push_notification_config: RestPushNotificationConfig;
  task_id: string;
}

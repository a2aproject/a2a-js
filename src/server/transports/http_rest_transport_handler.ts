/**
 * HTTP+JSON (REST) Transport Handler
 *
 * This module provides conversion functions and utilities for the HTTP+REST transport.
 * It handles the transformation between REST API format (snake_case) and internal
 * TypeScript format (camelCase), along with validation and error mapping.
 */

import { A2AError } from '../error.js';
import {
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  MessageSendParams,
  TaskPushNotificationConfig,
  Part,
  TaskStatus,
  Artifact,
} from '../../types.js';
import {
  RestMessage,
  RestTask,
  RestTaskStatusUpdateEvent,
  RestTaskArtifactUpdateEvent,
  RestMessageSendParams,
  RestTaskPushNotificationConfig,
  RestPart,
  RestTaskStatus,
  RestArtifact,
} from '../express/rest_types.js';

// ============================================================================
// REST ↔ Internal Type Converters (Adapter Layer)
// ============================================================================
//
// These functions convert between REST API types (snake_case) and internal
// TypeScript types (camelCase). This provides a clean boundary between the
// transport layer and business logic.
//
// Naming convention:
// - fromRest*: Converts REST (snake_case) → Internal (camelCase)
// - toRest*: Converts Internal (camelCase) → REST (snake_case)

/**
 * Converts a REST Part (snake_case) to internal Part (camelCase).
 * Handles text, file (bytes or URI), and data parts.
 *
 * @param rp - REST Part with snake_case field names
 * @returns Internal Part with camelCase field names
 */
export function fromRestPart(rp: RestPart): Part {
  if (rp.kind === 'text') return { kind: 'text', text: rp.text };
  if (rp.kind === 'file') {
    const file =
      'bytes' in rp.file
        ? { bytes: rp.file.bytes, mimeType: rp.file.mime_type, name: rp.file.name }
        : { uri: rp.file.uri, mimeType: rp.file.mime_type, name: rp.file.name };
    return { kind: 'file', file, metadata: rp.metadata };
  }
  return { kind: 'data', data: rp.data, metadata: rp.metadata };
}

/**
 * Converts an internal Part (camelCase) to REST Part (snake_case).
 * Handles text, file (bytes or URI), and data parts.
 *
 * @param p - Internal Part with camelCase field names
 * @returns REST Part with snake_case field names
 */
export function toRestPart(p: Part): RestPart {
  if (p.kind === 'text') return { kind: 'text', text: p.text };
  if (p.kind === 'file') {
    const file =
      'bytes' in p.file
        ? { bytes: p.file.bytes, mime_type: p.file.mimeType, name: p.file.name }
        : { uri: p.file.uri, mime_type: p.file.mimeType, name: p.file.name };
    return { kind: 'file', file, metadata: p.metadata };
  }
  return { kind: 'data', data: p.data, metadata: p.metadata };
}

/**
 * Converts a REST Message (snake_case) to internal Message (camelCase).
 * Validates required fields and throws InvalidParams error if missing.
 *
 * @param rm - REST Message with snake_case field names
 * @returns Internal Message with camelCase field names
 * @throws {A2AError} InvalidParams (-32602) if message_id or parts are missing/invalid
 */
export function fromRestMessage(rm: RestMessage): Message {
  if (!rm || !rm.message_id) {
    throw A2AError.invalidParams('message.message_id is required');
  }
  if (!rm.parts || !Array.isArray(rm.parts)) {
    throw A2AError.invalidParams('message.parts must be an array');
  }

  return {
    contextId: rm.context_id,
    extensions: rm.extensions,
    kind: 'message',
    messageId: rm.message_id,
    metadata: rm.metadata,
    parts: rm.parts.map(fromRestPart),
    referenceTaskIds: rm.reference_task_ids,
    role: rm.role,
    taskId: rm.task_id,
  };
}

/**
 * Converts an internal Message (camelCase) to REST Message (snake_case).
 *
 * @param m - Internal Message with camelCase field names
 * @returns REST Message with snake_case field names
 */
export function toRestMessage(m: Message): RestMessage {
  return {
    context_id: m.contextId,
    extensions: m.extensions,
    kind: 'message',
    message_id: m.messageId,
    metadata: m.metadata,
    parts: m.parts.map(toRestPart),
    reference_task_ids: m.referenceTaskIds,
    role: m.role,
    task_id: m.taskId,
  };
}

/**
 * Converts internal TaskStatus (camelCase) to REST TaskStatus (snake_case).
 *
 * @param ts - Internal TaskStatus with camelCase field names
 * @returns REST TaskStatus with snake_case field names
 */
export function toRestTaskStatus(ts: TaskStatus): RestTaskStatus {
  return {
    message: ts.message ? toRestMessage(ts.message) : undefined,
    state: ts.state,
    timestamp: ts.timestamp,
  };
}

/**
 * Converts internal Artifact (camelCase) to REST Artifact (snake_case).
 *
 * @param a - Internal Artifact with camelCase field names
 * @returns REST Artifact with snake_case field names
 */
export function toRestArtifact(a: Artifact): RestArtifact {
  return {
    artifact_id: a.artifactId,
    kind: 'artifact',
    metadata: a.metadata,
    name: a.name,
    parts: a.parts.map(toRestPart),
  };
}

/**
 * Converts internal Task (camelCase) to REST Task (snake_case).
 *
 * @param t - Internal Task with camelCase field names
 * @returns REST Task with snake_case field names
 */
export function toRestTask(t: Task): RestTask {
  return {
    artifacts: t.artifacts?.map(toRestArtifact),
    context_id: t.contextId,
    history: t.history?.map(toRestMessage),
    id: t.id,
    kind: 'task',
    metadata: t.metadata,
    status: toRestTaskStatus(t.status),
  };
}

/**
 * Converts internal TaskStatusUpdateEvent to REST format (snake_case).
 *
 * @param e - Internal TaskStatusUpdateEvent with camelCase field names
 * @returns REST TaskStatusUpdateEvent with snake_case field names
 */
export function toRestTaskStatusUpdateEvent(e: TaskStatusUpdateEvent): RestTaskStatusUpdateEvent {
  return {
    context_id: e.contextId,
    final: e.final,
    kind: 'status-update',
    metadata: e.metadata,
    status: toRestTaskStatus(e.status),
    task_id: e.taskId,
  };
}

/**
 * Converts internal TaskArtifactUpdateEvent to REST format (snake_case).
 *
 * @param e - Internal TaskArtifactUpdateEvent with camelCase field names
 * @returns REST TaskArtifactUpdateEvent with snake_case field names
 */
export function toRestTaskArtifactUpdateEvent(
  e: TaskArtifactUpdateEvent
): RestTaskArtifactUpdateEvent {
  return {
    append: e.append,
    artifact: toRestArtifact(e.artifact),
    context_id: e.contextId,
    kind: 'artifact-update',
    metadata: e.metadata,
    task_id: e.taskId,
  };
}

/**
 * Converts any streaming event to REST format (snake_case).
 * Used for SSE streaming responses.
 *
 * @param event - Internal streaming event (Message, Task, or update event)
 * @returns REST streaming event with snake_case field names
 */
export function toRestStreamEvent(
  event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent
): RestMessage | RestTask | RestTaskStatusUpdateEvent | RestTaskArtifactUpdateEvent {
  if (event.kind === 'message') return toRestMessage(event);
  if (event.kind === 'task') return toRestTask(event);
  if (event.kind === 'status-update') return toRestTaskStatusUpdateEvent(event);
  return toRestTaskArtifactUpdateEvent(event);
}

/**
 * Converts REST MessageSendParams (snake_case) to internal MessageSendParams (camelCase).
 * Includes nested conversion of configuration and push notification settings.
 *
 * @param rp - REST MessageSendParams with snake_case field names
 * @returns Internal MessageSendParams with camelCase field names
 */
export function fromRestMessageSendParams(rp: RestMessageSendParams): MessageSendParams {
  return {
    configuration: rp.configuration
      ? {
          acceptedOutputModes: rp.configuration.accepted_output_modes,
          blocking: rp.configuration.blocking,
          historyLength: rp.configuration.history_length,
          pushNotificationConfig: rp.configuration.push_notification_config
            ? {
                authentication: rp.configuration.push_notification_config.authentication
                  ? {
                      schemes: rp.configuration.push_notification_config.authentication.schemes,
                      credentials:
                        rp.configuration.push_notification_config.authentication.credentials,
                    }
                  : undefined,
                id: rp.configuration.push_notification_config.id,
                url: rp.configuration.push_notification_config.url,
              }
            : undefined,
        }
      : undefined,
    message: fromRestMessage(rp.message),
    metadata: rp.metadata,
  };
}

/**
 * Converts REST TaskPushNotificationConfig (snake_case) to internal (camelCase).
 *
 * @param rc - REST TaskPushNotificationConfig with snake_case field names
 * @returns Internal TaskPushNotificationConfig with camelCase field names
 */
export function fromRestTaskPushNotificationConfig(
  rc: RestTaskPushNotificationConfig
): TaskPushNotificationConfig {
  return {
    pushNotificationConfig: {
      authentication: rc.push_notification_config.authentication
        ? {
            schemes: rc.push_notification_config.authentication.schemes,
            credentials: rc.push_notification_config.authentication.credentials,
          }
        : undefined,
      id: rc.push_notification_config.id,
      url: rc.push_notification_config.url,
    },
    taskId: rc.task_id,
  };
}

/**
 * Converts internal TaskPushNotificationConfig (camelCase) to REST (snake_case).
 *
 * @param c - Internal TaskPushNotificationConfig with camelCase field names
 * @returns REST TaskPushNotificationConfig with snake_case field names
 */
export function toRestTaskPushNotificationConfig(
  c: TaskPushNotificationConfig
): RestTaskPushNotificationConfig {
  return {
    push_notification_config: {
      authentication: c.pushNotificationConfig.authentication
        ? {
            schemes: c.pushNotificationConfig.authentication.schemes,
            credentials: c.pushNotificationConfig.authentication.credentials,
          }
        : undefined,
      id: c.pushNotificationConfig.id,
      url: c.pushNotificationConfig.url,
    },
    task_id: c.taskId,
  };
}

// ============================================================================
// Error Mapping and Validation Utilities
// ============================================================================

/**
 * HTTP status codes used in REST responses.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
} as const;

/**
 * A2A error codes mapped to JSON-RPC and protocol-specific errors.
 */
export const A2A_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  UNAUTHORIZED: -32005,
} as const;

/**
 * Maps A2A error codes to appropriate HTTP status codes.
 *
 * @param errorCode - A2A error code (e.g., -32700, -32600, -32602, etc.)
 * @returns Corresponding HTTP status code
 *
 * @example
 * mapErrorToStatus(-32602) // returns 400 (Bad Request)
 * mapErrorToStatus(-32001) // returns 404 (Not Found)
 */
export function mapErrorToStatus(errorCode: number): number {
  switch (errorCode) {
    case A2A_ERROR_CODE.PARSE_ERROR:
    case A2A_ERROR_CODE.INVALID_REQUEST:
    case A2A_ERROR_CODE.INVALID_PARAMS:
      return HTTP_STATUS.BAD_REQUEST;
    case A2A_ERROR_CODE.METHOD_NOT_FOUND:
    case A2A_ERROR_CODE.TASK_NOT_FOUND:
      return HTTP_STATUS.NOT_FOUND;
    case A2A_ERROR_CODE.TASK_NOT_CANCELABLE:
      return HTTP_STATUS.CONFLICT;
    case A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED:
    case A2A_ERROR_CODE.UNSUPPORTED_OPERATION:
      return HTTP_STATUS.NOT_IMPLEMENTED;
    case A2A_ERROR_CODE.UNAUTHORIZED:
      return HTTP_STATUS.UNAUTHORIZED;
    default:
      return HTTP_STATUS.INTERNAL_SERVER_ERROR;
  }
}

/**
 * Parses and validates historyLength query parameter.
 * Ensures the value is a non-negative integer.
 *
 * @param value - Raw query parameter value
 * @returns Parsed integer value
 * @throws {A2AError} InvalidParams (-32602) if value is missing, invalid, or negative
 */
export function parseHistoryLength(value: unknown): number {
  if (value === undefined || value === null) {
    throw A2AError.invalidParams('historyLength is required');
  }
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) {
    throw A2AError.invalidParams('historyLength must be a valid integer');
  }
  if (parsed < 0) {
    throw A2AError.invalidParams('historyLength must be non-negative');
  }
  return parsed;
}

/**
 * Result of parsing an action from a REST API path.
 */
export interface ParsedAction {
  /** The action name (e.g., 'send', 'stream', 'cancel', 'subscribe') */
  action: string;
  /** Task ID if the action is on a specific task */
  taskId?: string;
}

/**
 * Extracts action information from a request path.
 * Supports both message actions (e.g., /v1/message:send) and
 * task actions (e.g., /v1/tasks/:taskId:cancel).
 *
 * @param path - Request path to parse
 * @param pattern - Regex pattern to match against
 * @param groupIndex - Capture group index for the action (default: 1)
 * @returns Parsed action object containing action name and optionally taskId
 * @throws {A2AError} MethodNotFound (-32601) if path doesn't match pattern
 */
export function extractAction(path: string, pattern: RegExp, groupIndex: number = 1): ParsedAction {
  const match = path.match(pattern);
  if (!match) {
    throw A2AError.methodNotFound('Invalid action path');
  }
  // Check if this is a task action pattern (has two groups: taskId and action)
  const isTaskAction = pattern.source.includes('([^/:]+)') && pattern.source.includes('([a-z]+)');
  return isTaskAction ? { taskId: match[1], action: match[2] } : { action: match[groupIndex] };
}

// ============================================================================
// Server-Sent Events (SSE) Support
// ============================================================================

/**
 * HTTP headers for Server-Sent Events (SSE) streaming responses.
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/**
 * Formats a data event for Server-Sent Events (SSE) protocol.
 *
 * @param event - The event data to send (will be JSON stringified)
 * @param id - Optional event ID (defaults to current timestamp)
 * @returns Formatted SSE event string
 *
 * @example
 * formatSSEEvent({ kind: 'message', text: 'Hello' })
 * // Returns: "id: 1234567890\ndata: {\"kind\":\"message\",\"text\":\"Hello\"}\n\n"
 */
export function formatSSEEvent(event: unknown, id?: string | number): string {
  const eventId = id ?? Date.now();
  return `id: ${eventId}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Formats an error event for Server-Sent Events (SSE) protocol.
 * Error events use the "error" event type to distinguish them from data events.
 *
 * @param error - The error object (in JSON-RPC format)
 * @returns Formatted SSE error event string
 *
 * @example
 * formatSSEErrorEvent({ code: -32603, message: 'Internal error' })
 * // Returns: "event: error\ndata: {\"code\":-32603,\"message\":\"Internal error\"}\n\n"
 */
export function formatSSEErrorEvent(error: unknown): string {
  return `event: error\ndata: ${JSON.stringify(error)}\n\n`;
}

/**
 * Valid action names for REST API endpoints.
 * These correspond to the actions in the A2A REST specification.
 */
export const ACTION = {
  SEND: 'send',
  STREAM: 'stream',
  CANCEL: 'cancel',
  SUBSCRIBE: 'subscribe',
} as const;

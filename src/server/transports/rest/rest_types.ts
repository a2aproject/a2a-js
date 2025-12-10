/**
 * REST API Types (snake_case format)
 *
 * These types mirror the internal types but use snake_case naming
 * to support TCK and clients that send snake_case payloads.
 */

import {
  Part,
  Message,
  MessageSendParams,
  TaskPushNotificationConfig,
  FileWithBytes,
  FileWithUri,
} from '../../../types.js';

// ============================================================================
// REST Types (snake_case format)
// ============================================================================

/**
 * REST file with bytes (snake_case mime_type).
 */
export interface RestFileWithBytes {
  bytes: string;
  mime_type?: string;
  name?: string;
}

/**
 * REST file with URI (snake_case mime_type).
 */
export interface RestFileWithUri {
  uri: string;
  mime_type?: string;
  name?: string;
}

/**
 * REST file union.
 */
export type RestFile = RestFileWithBytes | RestFileWithUri;

/**
 * File input - accepts both camelCase and snake_case.
 */
export type FileInput = FileWithBytes | FileWithUri | RestFileWithBytes | RestFileWithUri;

/**
 * REST Part with snake_case file fields.
 */
export type RestPart =
  | { kind: 'text'; text: string; metadata?: Record<string, unknown> }
  | { kind: 'file'; file: RestFile; metadata?: Record<string, unknown> }
  | { kind: 'data'; data: Record<string, unknown>; metadata?: Record<string, unknown> };

/**
 * REST Message with snake_case fields.
 */
export interface RestMessage {
  kind: 'message';
  role: 'agent' | 'user';
  parts: RestPart[];
  message_id: string;
  context_id?: string;
  task_id?: string;
  reference_task_ids?: string[];
  extensions?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * REST PushNotificationConfig (same as internal, no snake_case fields).
 */
export interface RestPushNotificationConfig {
  id: string;
  url: string;
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
}

/**
 * REST MessageSendConfiguration with snake_case fields.
 */
export interface RestMessageSendConfiguration {
  blocking?: boolean;
  accepted_output_modes?: string[];
  history_length?: number;
  push_notification_config?: RestPushNotificationConfig;
}

/**
 * REST MessageSendParams with snake_case configuration.
 */
export interface RestMessageSendParams {
  message: RestMessage;
  configuration?: RestMessageSendConfiguration;
  metadata?: Record<string, unknown>;
}

/**
 * REST TaskPushNotificationConfig with snake_case fields.
 */
export interface RestTaskPushNotificationConfig {
  task_id: string;
  push_notification_config: RestPushNotificationConfig;
}

// ============================================================================
// Input Types - Accept both camelCase and snake_case
// ============================================================================

export type PartInput = Part | RestPart;
export type MessageInput = Message | RestMessage;
export type MessageSendParamsInput = MessageSendParams | RestMessageSendParams;
export type TaskPushNotificationConfigInput =
  | TaskPushNotificationConfig
  | RestTaskPushNotificationConfig;

// snake_case REST mirrors of the internal types, for TCK and clients
// that send snake_case payloads.

import {
  Part,
  Message,
  MessageSendParams,
  TaskPushNotificationConfig,
  FileWithBytes,
  FileWithUri,
} from './types.js';

export interface RestFileWithBytes {
  bytes: string;
  mime_type?: string;
  name?: string;
}

export interface RestFileWithUri {
  uri: string;
  mime_type?: string;
  name?: string;
}

export type RestFile = RestFileWithBytes | RestFileWithUri;

/** Accepts both camelCase and snake_case file shapes. */
export type FileInput = FileWithBytes | FileWithUri | RestFileWithBytes | RestFileWithUri;

export type RestPart =
  | { kind: 'text'; text: string; metadata?: Record<string, unknown> }
  | { kind: 'file'; file: RestFile; metadata?: Record<string, unknown> }
  | { kind: 'data'; data: Record<string, unknown>; metadata?: Record<string, unknown> };

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

export interface RestPushNotificationConfig {
  id?: string;
  url: string;
  token?: string;
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
}

export interface RestMessageSendConfiguration {
  blocking?: boolean;
  accepted_output_modes?: string[];
  history_length?: number;
  push_notification_config?: RestPushNotificationConfig;
}

export interface RestMessageSendParams {
  message: RestMessage;
  configuration?: RestMessageSendConfiguration;
  metadata?: Record<string, unknown>;
}

export interface RestTaskPushNotificationConfig {
  task_id: string;
  push_notification_config: RestPushNotificationConfig;
}

// Input types accepting both camelCase and snake_case.

export type PartInput = Part | RestPart;
export type MessageInput = Message | RestMessage;
export type MessageSendParamsInput = MessageSendParams | RestMessageSendParams;
export type TaskPushNotificationConfigInput =
  | TaskPushNotificationConfig
  | RestTaskPushNotificationConfig;

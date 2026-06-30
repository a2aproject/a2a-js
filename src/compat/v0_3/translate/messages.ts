// `Message` translator. Key differences: v0.3 adds a `kind: 'message'`
// discriminator, marks `contextId` / `taskId` truly optional (v1.0 uses
// empty strings), uses string-literal `role`, and omits empty arrays
// rather than emitting them.

import { toCompatRole, toCoreRole } from './enums.js';
import { toCompatPart, toCorePart } from './parts.js';
import { A2AError } from '../server/error.js';
import type { Message as V1Message } from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';
import { deepCloneMetadata } from './_clone.js';

function nonEmptyString(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function nonEmptyArray<T>(value: T[]): T[] | undefined {
  return value.length === 0 ? undefined : [...value];
}

export function toCoreMessage(compatMsg: legacy.Message): V1Message {
  if (typeof compatMsg !== 'object' || compatMsg === null) {
    throw A2AError.invalidParams('message must be an object');
  }
  if (typeof compatMsg.messageId !== 'string' || compatMsg.messageId === '') {
    throw A2AError.invalidParams('message.messageId is required');
  }
  if (compatMsg.role !== 'user' && compatMsg.role !== 'agent') {
    throw A2AError.invalidParams('message.role must be "user" or "agent"');
  }
  if (!Array.isArray(compatMsg.parts)) {
    throw A2AError.invalidParams('message.parts must be an array');
  }
  return {
    messageId: compatMsg.messageId,
    contextId: compatMsg.contextId ?? '',
    taskId: compatMsg.taskId ?? '',
    role: toCoreRole(compatMsg.role),
    parts: compatMsg.parts.map(toCorePart),
    metadata: deepCloneMetadata(compatMsg.metadata),
    extensions: compatMsg.extensions ? [...compatMsg.extensions] : [],
    referenceTaskIds: compatMsg.referenceTaskIds ? [...compatMsg.referenceTaskIds] : [],
  };
}

export function toCompatMessage(coreMsg: V1Message): legacy.Message {
  const result: legacy.Message = {
    kind: 'message',
    messageId: coreMsg.messageId,
    role: toCompatRole(coreMsg.role),
    parts: coreMsg.parts.map(toCompatPart),
  };

  const contextId = nonEmptyString(coreMsg.contextId);
  if (contextId !== undefined) result.contextId = contextId;

  const taskId = nonEmptyString(coreMsg.taskId);
  if (taskId !== undefined) result.taskId = taskId;

  const metadata = deepCloneMetadata(coreMsg.metadata);
  if (metadata !== undefined) result.metadata = metadata;

  const extensions = nonEmptyArray(coreMsg.extensions);
  if (extensions !== undefined) result.extensions = extensions;

  const referenceTaskIds = nonEmptyArray(coreMsg.referenceTaskIds);
  if (referenceTaskIds !== undefined) result.referenceTaskIds = referenceTaskIds;

  return result;
}

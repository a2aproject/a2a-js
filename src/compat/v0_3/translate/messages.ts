/**
 * `Message` translator between v1.0 proto and v0.3 JSON.
 *
 * The wire-level differences handled here:
 *
 *  - v0.3 JSON `Message` carries a `kind: 'message'` discriminator that
 *    v1.0 proto lacks (proto discriminates via gRPC oneof wrappers).
 *  - v1.0 proto stores optional IDs (`contextId`, `taskId`) as empty
 *    strings; v0.3 JSON marks them genuinely optional. Translation must
 *    coerce `""` ↔ `undefined`.
 *  - v0.3 `Message.role` is a string literal `'agent' | 'user'`; v1.0
 *    uses the numeric `Role` enum.
 *  - `referenceTaskIds`, `extensions`, and `metadata` follow the
 *    proto3 "always-present array, possibly empty" vs JSON "omit when
 *    absent" idiom.
 */

import { toCompatRole, toCoreRole } from './enums.js';
import { toCompatPart, toCorePart } from './parts.js';
import type { Message as V1Message } from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';
import { deepCloneMetadata } from './_clone.js';

function nonEmptyString(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function nonEmptyArray<T>(value: T[]): T[] | undefined {
  return value.length === 0 ? undefined : [...value];
}

/**
 * Converts a v0.3 JSON `Message` into a v1.0 proto `Message`.
 *
 * Optional string fields collapse `undefined` to `''` (proto3 convention).
 * Optional arrays collapse `undefined` to `[]`. The v0.3 `kind` discriminator
 * is intentionally dropped — v1.0 has no equivalent field.
 */
export function toCoreMessage(compatMsg: legacy.Message): V1Message {
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

/**
 * Converts a v1.0 proto `Message` into a v0.3 JSON `Message`.
 *
 * Empty proto3 strings become `undefined` (JSON-optional). Empty arrays are
 * dropped entirely. The `kind: 'message'` discriminator is added so the
 * result can participate in the `Task | Message | …` tagged-union responses
 * v0.3 JSON-RPC sends back to clients.
 */
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

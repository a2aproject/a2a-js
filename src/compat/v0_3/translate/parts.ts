/**
 * `Part` translators. Shape mismatch:
 *  - v1.0: `content.$case` ∈ `'text' | 'raw' | 'url' | 'data'`, with
 *    `filename` / `mediaType` at the top level.
 *  - v0.3: `kind` ∈ `'text' | 'file' | 'data'`, with the bytes-vs-uri
 *    choice and `name` / `mimeType` nested under `file`.
 *
 * Data parts: v1.0 admits any JSON value but v0.3 admits only objects.
 * Non-object values are wrapped as `{ value: <original> }` with a
 * `data_part_compat` metadata flag so `toCorePart` can losslessly
 * unwrap. Unrepresentable values (`Symbol`, `bigint`, `Buffer`, …)
 * throw.
 */

import { A2AError } from '../server/error.js';
import type * as legacy from '../types/types.js';
import type { Part as V1Part } from '../../../types/pb/a2a.js';
import { deepCloneMetadata } from './_clone.js';

// Metadata key marking the `{ value: ... }` wrapper. Snake_case on the wire.
const DATA_PART_COMPAT_FLAG = 'data_part_compat';

function isPlainObject(value: unknown): value is { [k: string]: unknown } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}

// True for non-object JSON values that v0.3 can't represent directly
// (so we wrap them as `{ value: <original> }`).
function isCompatWrappableDataValue(
  value: unknown
): value is string | number | boolean | null | unknown[] {
  if (value === null) return true;
  if (Array.isArray(value)) return true;
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

export function toCorePart(compatPart: legacy.Part): V1Part {
  if (typeof compatPart !== 'object' || compatPart === null || Array.isArray(compatPart)) {
    throw A2AError.invalidParams('Each part must be an object');
  }
  if (compatPart.kind === 'text') {
    return {
      content: { $case: 'text', value: compatPart.text },
      metadata: deepCloneMetadata(compatPart.metadata),
      filename: '',
      mediaType: '',
    };
  }

  if (compatPart.kind === 'file') {
    const file = compatPart.file;
    const mediaType = file.mimeType ?? '';
    const filename = file.name ?? '';
    const metadata = deepCloneMetadata(compatPart.metadata);

    if ('bytes' in file) {
      return {
        content: { $case: 'raw', value: Buffer.from(file.bytes, 'base64') },
        metadata,
        filename,
        mediaType,
      };
    }
    if ('uri' in file) {
      return {
        content: { $case: 'url', value: file.uri },
        metadata,
        filename,
        mediaType,
      };
    }
    throw A2AError.invalidParams('Invalid file part: missing `bytes` or `uri`');
  }

  if (compatPart.kind === 'data') {
    const metadata = deepCloneMetadata(compatPart.metadata);
    let value: unknown = compatPart.data;
    let outMetadata = metadata;

    // Reverse the `{ value: ... }` wrap. The flag is load-bearing —
    // without it a genuine `{ value: ... }` payload is indistinguishable
    // from a synthesized wrapper. Strip the flag so it doesn't leak into
    // v1.0 metadata, and drop `metadata` entirely if it was the only key.
    if (metadata !== undefined && metadata[DATA_PART_COMPAT_FLAG] === true) {
      if (isPlainObject(compatPart.data) && 'value' in compatPart.data) {
        value = compatPart.data.value;
      }
      delete metadata[DATA_PART_COMPAT_FLAG];
      outMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;
    }

    return {
      content: { $case: 'data', value },
      metadata: outMetadata,
      filename: '',
      mediaType: '',
    };
  }

  throw A2AError.invalidParams(
    `Invalid v0.3 part kind: ${(compatPart as { kind?: string }).kind ?? 'undefined'}`
  );
}

export function toCompatPart(corePart: V1Part): legacy.Part {
  const content = corePart.content;
  const metadata = deepCloneMetadata(corePart.metadata);

  if (!content) {
    throw A2AError.invalidParams('Invalid v1.0 part: missing content');
  }

  if (content.$case === 'text') {
    const result: legacy.TextPart = { kind: 'text', text: content.value };
    if (metadata !== undefined) result.metadata = metadata;
    return result;
  }

  if (content.$case === 'raw' || content.$case === 'url') {
    const mimeType = corePart.mediaType !== '' ? corePart.mediaType : undefined;
    const name = corePart.filename !== '' ? corePart.filename : undefined;

    let file: legacy.FileWithBytes | legacy.FileWithUri;
    if (content.$case === 'raw') {
      const bytesBuffer = Buffer.isBuffer(content.value)
        ? content.value
        : Buffer.from(content.value as Uint8Array);
      const fileWithBytes: legacy.FileWithBytes = { bytes: bytesBuffer.toString('base64') };
      if (mimeType !== undefined) fileWithBytes.mimeType = mimeType;
      if (name !== undefined) fileWithBytes.name = name;
      file = fileWithBytes;
    } else {
      const fileWithUri: legacy.FileWithUri = { uri: content.value };
      if (mimeType !== undefined) fileWithUri.mimeType = mimeType;
      if (name !== undefined) fileWithUri.name = name;
      file = fileWithUri;
    }

    const result: legacy.FilePart = { kind: 'file', file };
    if (metadata !== undefined) result.metadata = metadata;
    return result;
  }

  if (content.$case === 'data') {
    const value: unknown = content.value;

    if (isPlainObject(value)) {
      const result: legacy.DataPart = { kind: 'data', data: value };
      if (metadata !== undefined) result.metadata = metadata;
      return result;
    }

    if (isCompatWrappableDataValue(value)) {
      // Wrap and tag so `toCorePart` can losslessly unwrap.
      const data: { [k: string]: unknown } = { value };
      const outMetadata: { [k: string]: unknown } = metadata ?? {};
      outMetadata[DATA_PART_COMPAT_FLAG] = true;
      const result: legacy.DataPart = { kind: 'data', data, metadata: outMetadata };
      return result;
    }

    throw A2AError.invalidParams(
      'Cannot translate v1 data part to v0.3: value is neither a plain object ' +
        'nor a wrap-eligible primitive / array / null ' +
        '(e.g., Symbol, function, bigint, undefined, Buffer). ' +
        'Primitives, arrays, and null are wrapped as { value: ... } with data_part_compat=true; ' +
        'all other non-plain-object values are rejected.'
    );
  }

  throw A2AError.invalidParams(
    `Invalid v1.0 part content type: ${(content as { $case?: string }).$case ?? 'unknown'}`
  );
}

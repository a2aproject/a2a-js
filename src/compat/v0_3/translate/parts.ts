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

// True iff `data` has the exact single-key `{ value: <wrappable> }` wrapper
// shape emitted for non-object v1 data parts by this SDK and peer SDKs.
function isCompatWrappedData(
  data: unknown
): data is { value: string | number | boolean | null | unknown[] } {
  if (!isPlainObject(data)) return false;
  const keys = Object.keys(data);
  return keys.length === 1 && keys[0] === 'value' && isCompatWrappableDataValue(data.value);
}

// Returns the count of leading `_` characters before `data_part_compat`, or
// `-1` for unrelated metadata keys. Escaping shifts colliding user keys by one
// leading `_` so `data_part_compat: true` never overwrites or drops user data.
function compatFlagPrefixLength(key: string): number {
  if (!key.endsWith(DATA_PART_COMPAT_FLAG)) return -1;
  const prefixLen = key.length - DATA_PART_COMPAT_FLAG.length;
  for (let i = 0; i < prefixLen; i++) {
    if (key.charCodeAt(i) !== 95 /* '_' */) return -1;
  }
  return prefixLen;
}

// True when the least-escaped `_*data_part_compat` key in `metadata` has at
// least `minPrefix` leading underscores and its value is strictly `true`.
function hasLeadingTrueCompatFlag(metadata: { [k: string]: unknown }, minPrefix: number): boolean {
  let smallest = Infinity;
  let smallestValue: unknown;
  for (const key of Object.keys(metadata)) {
    const len = compatFlagPrefixLength(key);
    if (len >= 0 && len < smallest) {
      smallest = len;
      smallestValue = metadata[key];
    }
  }
  return smallest >= minPrefix && smallest !== Infinity && smallestValue === true;
}

function setOwnDataProperty(target: { [k: string]: unknown }, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function shiftCompatFlagKeys(
  metadata: { [k: string]: unknown },
  delta: 1 | -1
): { [k: string]: unknown } {
  const shifted: { [k: string]: unknown } = {};
  for (const key of Object.keys(metadata)) {
    const len = compatFlagPrefixLength(key);
    if (delta === -1 && len === 0) continue;
    const nextKey = len >= 0 ? (delta === 1 ? `_${key}` : key.slice(1)) : key;
    setOwnDataProperty(shifted, nextKey, metadata[key]);
  }
  return shifted;
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

    // Reverse the `{ value: ... }` wrap only when `data` matches the exact
    // single-key wrapper shape so structured objects with extra fields,
    // missing `value`, or nested plain-object values keep their data and
    // metadata intact. Strip the synthetic flag and restore any escaped
    // user `_*data_part_compat` metadata keys.
    if (metadata !== undefined && isCompatWrappedData(compatPart.data)) {
      if (
        Object.prototype.hasOwnProperty.call(metadata, DATA_PART_COMPAT_FLAG) &&
        metadata[DATA_PART_COMPAT_FLAG] === true
      ) {
        value = compatPart.data.value;
        const restored = shiftCompatFlagKeys(metadata, -1);
        outMetadata = Object.keys(restored).length > 0 ? restored : undefined;
      } else if (hasLeadingTrueCompatFlag(metadata, 1)) {
        outMetadata = shiftCompatFlagKeys(metadata, -1);
      }
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
      // Escape `data_part_compat: true` on plain objects that happen to match
      // the wrapper shape so a subsequent `toCorePart` does not falsely unwrap
      // the object into a primitive/array/null.
      const outMetadata =
        metadata !== undefined &&
        isCompatWrappedData(value) &&
        hasLeadingTrueCompatFlag(metadata, 0)
          ? shiftCompatFlagKeys(metadata, 1)
          : metadata;
      const result: legacy.DataPart = { kind: 'data', data: value };
      if (outMetadata !== undefined) result.metadata = outMetadata;
      return result;
    }

    if (isCompatWrappableDataValue(value)) {
      // Wrap and tag so `toCorePart` can losslessly unwrap, escaping any
      // pre-existing user `_*data_part_compat` keys so they survive round-trip.
      const data: { [k: string]: unknown } = { value };
      const outMetadata: { [k: string]: unknown } =
        metadata !== undefined ? shiftCompatFlagKeys(metadata, 1) : {};
      setOwnDataProperty(outMetadata, DATA_PART_COMPAT_FLAG, true);
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

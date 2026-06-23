/**
 * `Part` translators between v1.0 proto and v0.3 JSON.
 *
 * Shape differences:
 *  - v1.0 discriminator: `part.content.$case` ∈ `'text' | 'raw' | 'url' | 'data'`.
 *    v0.3 discriminator: `part.kind` ∈ `'text' | 'file' | 'data'`, with the
 *    bytes-vs-uri choice nested under `part.file`.
 *  - v1.0 carries `filename` / `mediaType` at the top level; v0.3 carries
 *    `name` / `mimeType` on the inner `file`.
 *
 * Data parts: v1.0 `Part.data` admits any JSON value (primitives, arrays,
 * `null`, objects); v0.3 `DataPart.data` admits only objects. Primitive /
 * array / `null` values are wrapped as `{ value: <original> }` and tagged
 * with `metadata.data_part_compat = true`; `toCorePart` reverses the
 * wrap when the flag is present and strips the flag from the result.
 * Values that cannot be JSON-serialized (`Symbol`, `function`, `bigint`,
 * `undefined`, `Buffer`) still throw `A2AError.invalidParams`.
 */

import { A2AError } from '../server/error.js';
import type * as legacy from '../types/types.js';
import type { Part as V1Part } from '../../../types/pb/a2a.js';
import { deepCloneMetadata } from './_clone.js';

/**
 * Metadata key tagging v0.3 `DataPart`s whose `data` field carries the
 * `{ value: <primitive|array|null> }` wrapper synthesized by
 * `toCompatPart`. Snake_case is the on-the-wire form.
 */
const DATA_PART_COMPAT_FLAG = 'data_part_compat';

function isPlainObject(value: unknown): value is { [k: string]: unknown } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}

/**
 * True for JSON values valid in v1.0 `Part.data` but unrepresentable in
 * v0.3 `DataPart.data: { [k]: unknown }` (objects only). These are the
 * values `toCompatPart` wraps as `{ value: <original> }`.
 */
function isCompatWrappableDataValue(
  value: unknown
): value is string | number | boolean | null | unknown[] {
  if (value === null) return true;
  if (Array.isArray(value)) return true;
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

/**
 * Converts a v0.3 JSON `Part` into a v1.0 proto `Part`.
 *
 * - Text → `content.$case: 'text'`.
 * - File: `FileWithBytes` → `'raw'` (base64-decoded into a `Buffer`);
 *   `FileWithUri` → `'url'`. Inner `mimeType` / `name` lift to top-level
 *   `mediaType` / `filename`.
 * - Data: `data` passes through unchanged, except when
 *   `metadata.data_part_compat === true` and `data` has shape
 *   `{ value: <primitive|array|null> }` — then the wrapper is stripped,
 *   `data.value` becomes the v1.0 value, and the flag is removed
 *   (dropping `metadata` entirely if empty).
 */
export function toCorePart(compatPart: legacy.Part): V1Part {
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

    // Reverse the `{ value: <primitive> }` wrap. The flag is the
    // load-bearing signal — without it a genuine `{ value: ... }`
    // payload is indistinguishable from a synthesized wrapper. The
    // flag is stripped so it does not leak into v1.0 metadata.
    if (metadata !== undefined && metadata[DATA_PART_COMPAT_FLAG] === true) {
      if (isPlainObject(compatPart.data) && 'value' in compatPart.data) {
        value = compatPart.data.value;
      }
      delete metadata[DATA_PART_COMPAT_FLAG];
      // Drop the metadata object entirely if the flag was its only key,
      // so a round-trip from a primitive v1 value yields no metadata.
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

/**
 * Converts a v1.0 proto `Part` into a v0.3 JSON `Part`.
 *
 * - `'text'` ↔ `kind: 'text'`.
 * - `'raw'` ↔ `kind: 'file'` + `FileWithBytes` (base64-encoded `Buffer`).
 * - `'url'` ↔ `kind: 'file'` + `FileWithUri`. Top-level `filename` /
 *   `mediaType` push down to inner `name` / `mimeType`.
 * - `'data'`: plain object → used directly. Primitive / array / `null`
 *   → wrapped as `{ value: <original> }` with
 *   `metadata.data_part_compat: true` so `toCorePart` can unwrap.
 *
 * @throws {A2AError} when `content` is missing, has an unknown `$case`,
 * or carries a `data` value that is neither a plain object nor a
 * wrap-eligible primitive / array / null (`Symbol`, `function`,
 * `bigint`, `undefined`, `Buffer`).
 */
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
      // Wrap and tag so `toCorePart` can losslessly unwrap. No
      // defensive clone — matches the plain-object branch above.
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

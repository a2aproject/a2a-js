/**
 * `Part` translators between v1.0 proto and v0.3 JSON.
 *
 * The two formats differ in two structural ways:
 *
 *  - **Outer discriminator.** v1.0 uses `part.content.$case` with the four
 *    cases `'text' | 'raw' | 'url' | 'data'`; v0.3 JSON uses `part.kind`
 *    with the three cases `'text' | 'file' | 'data'` and nests the
 *    file-bytes-vs-uri choice under `part.file` (`FileWithBytes |
 *    FileWithUri`).
 *  - **File metadata.** v1.0 carries `filename` and `mediaType` as
 *    top-level fields on every Part (only meaningful for file parts);
 *    v0.3 puts the equivalents (`name`, `mimeType`) on the inner `file`
 *    object.
 *
 * **Data parts.** v1.0 `Part.data` is a `google.protobuf.Value`, so it can
 * carry primitives, arrays, and `null` in addition to objects. v0.3
 * `DataPart.data` is typed `{ [k: string]: unknown }` — strictly a JSON
 * object. v1.0 data parts whose `value` is a primitive, array, or `null`
 * therefore cannot be represented in v0.3 and throw `A2AError.invalidParams`
 * during `toCompatPart`. (The Python SDK wraps such values as
 * `{ value: <primitive> }` with a private `data_part_compat = true`
 * metadata flag, but that pollutes the v0.3 wire format with an out-of-spec
 * key; we deliberately diverge from Python here.)
 */

import { A2AError } from '../server/error.js';
import type * as legacy from '../types/types.js';
import type { Part as V1Part } from '../../../types/pb/a2a.js';
import { deepCloneMetadata } from './_clone.js';

function isPlainObject(value: unknown): value is { [k: string]: unknown } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}

/**
 * Converts a v0.3 JSON `Part` into a v1.0 proto `Part`.
 *
 * - Text parts map directly onto `content.$case: 'text'`.
 * - File parts split: `FileWithBytes` → `content.$case: 'raw'` (decoding
 *   the base64 payload into a `Buffer`); `FileWithUri` → `content.$case:
 *   'url'`. The optional `mimeType` / `name` are lifted to the top-level
 *   `mediaType` / `filename` fields.
 * - Data parts pass `data` through unchanged (v0.3 schema guarantees
 *   `data` is a plain object, which is always valid for the v1.0
 *   `google.protobuf.Value` target).
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
    return {
      content: { $case: 'data', value: compatPart.data },
      metadata: deepCloneMetadata(compatPart.metadata),
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
 * - `content.$case: 'text'` ↔ `kind: 'text'`.
 * - `content.$case: 'raw'` ↔ `kind: 'file'` with `FileWithBytes` (base64
 *   encoding the `Buffer`); `content.$case: 'url'` ↔ `kind: 'file'` with
 *   `FileWithUri`. `filename` / `mediaType` are pushed down into the
 *   inner file's `name` / `mimeType`.
 * - `content.$case: 'data'`: when the v1.0 value is a plain object it is
 *   used directly. Throws `A2AError.invalidParams` when the value is a
 *   primitive, array, or `null` — those are not representable in v0.3's
 *   `DataPart.data: { [k: string]: unknown }` schema.
 *
 * @throws {A2AError} when `content` is missing, has an unknown `$case`,
 * or carries a non-object `data` value.
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
    if (!isPlainObject(value)) {
      throw A2AError.invalidParams(
        'Cannot translate v1 data part to v0.3: value is not a plain object. ' +
          'v0.3 DataPart.data requires { [k: string]: unknown }; primitives, arrays, and null are not representable.'
      );
    }
    const result: legacy.DataPart = { kind: 'data', data: value };
    if (metadata !== undefined) result.metadata = metadata;
    return result;
  }

  throw A2AError.invalidParams(
    `Invalid v1.0 part content type: ${(content as { $case?: string }).$case ?? 'unknown'}`
  );
}

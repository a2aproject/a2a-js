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
 */

import { A2AError } from '../server/error.js';
import type * as legacy from '../types/types.js';
import type { Part as V1Part } from '../../../types/pb/a2a.js';
import { deepCloneMetadata } from './_clone.js';

const DATA_PART_COMPAT_KEY = 'data_part_compat';

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
 * - Data parts honor the `data_part_compat` flag convention: when this flag
 *   is present on the part's metadata, the original (non-object) value is
 *   unwrapped from `data.value` before being attached to the v1.0 part.
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
    const dataPartCompat = metadata?.[DATA_PART_COMPAT_KEY] === true;
    let strippedMetadata: { [k: string]: unknown } | undefined = metadata;
    if (metadata && DATA_PART_COMPAT_KEY in metadata) {
      const { [DATA_PART_COMPAT_KEY]: _stripped, ...rest } = metadata;
      // Avoid leaking the flag back out as proto metadata.
      void _stripped;
      strippedMetadata = Object.keys(rest).length === 0 ? undefined : rest;
    }

    const value = dataPartCompat ? compatPart.data.value : compatPart.data;
    return {
      content: { $case: 'data', value },
      metadata: strippedMetadata,
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
 * - `content.$case: 'data'`: when the v1.0 value is a plain object it's
 *   used directly; otherwise it's wrapped as `{ value }` and the
 *   `data_part_compat` flag is set on the part's metadata so the inverse
 *   conversion can recover the original value.
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

    // Non-object values are wrapped so the v0.3 `data: { [k]: unknown }`
    // type accepts them; mark this in metadata so `toCorePart` can unwrap.
    const wrappedMetadata: { [k: string]: unknown } = {
      ...(metadata ?? {}),
      [DATA_PART_COMPAT_KEY]: true,
    };
    return {
      kind: 'data',
      data: { value },
      metadata: wrappedMetadata,
    };
  }

  throw A2AError.invalidParams(
    `Invalid v1.0 part content type: ${(content as { $case?: string }).$case ?? 'unknown'}`
  );
}

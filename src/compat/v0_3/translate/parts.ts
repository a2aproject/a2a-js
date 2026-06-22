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
 * object. To round-trip the wider v1.0 set through the narrower v0.3
 * schema, `toCompatPart` wraps primitive / array / `null` values as
 * `{ value: <original> }` and tags the v0.3 part with a
 * `metadata.data_part_compat = true` flag. The key is snake_case to
 * match `a2a-python` (`compat/v0_3/conversions.py:46, :96`) and `a2a-go`
 * (`a2acompat/a2av0/conversions.go:333-336, :385`) byte-for-byte on the
 * wire, so cross-SDK peers recognize the wrapper. `toCorePart` looks for
 * the same flag and unwraps `data.value` back to the original primitive,
 * stripping the flag from the resulting v1.0 metadata.
 *
 * Values that are neither plain objects nor wrap-eligible primitives
 * (`Symbol`, `function`, `bigint`, `undefined`, `Buffer`) still throw
 * `A2AError.invalidParams` from `toCompatPart`: the wrapper itself would
 * not survive serialization.
 */

import { A2AError } from '../server/error.js';
import type * as legacy from '../types/types.js';
import type { Part as V1Part } from '../../../types/pb/a2a.js';
import { deepCloneMetadata } from './_clone.js';

/**
 * Metadata key emitted on v0.3 `DataPart`s whose `data` field carries a
 * `{ value: <primitive|array|null> }` wrapper synthesized by
 * `toCompatPart`. Wire format is snake_case to match `a2a-python` and
 * `a2a-go` byte-for-byte, so peers across SDKs recognize the wrapper.
 */
const DATA_PART_COMPAT_FLAG = 'data_part_compat';

function isPlainObject(value: unknown): value is { [k: string]: unknown } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}

/**
 * True for v1.0 `Part.data` values that are valid `google.protobuf.Value`s
 * but cannot live directly under v0.3 `DataPart.data: { [k]: unknown }`
 * (which only admits JSON objects). These are the values `toCompatPart`
 * wraps as `{ value: <original> }` with the `data_part_compat` flag.
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
 * - Text parts map directly onto `content.$case: 'text'`.
 * - File parts split: `FileWithBytes` → `content.$case: 'raw'` (decoding
 *   the base64 payload into a `Buffer`); `FileWithUri` → `content.$case:
 *   'url'`. The optional `mimeType` / `name` are lifted to the top-level
 *   `mediaType` / `filename` fields.
 * - Data parts pass `data` through unchanged, except when
 *   `metadata.data_part_compat === true` and `data` has the shape
 *   `{ value: <primitive|array|null> }`. In that case the wrapper is
 *   stripped, `data.value` becomes the v1.0 `content.value` directly, and
 *   the flag is removed from the resulting metadata (with `metadata`
 *   itself omitted if no other keys remain). This reverses the wrapping
 *   done by `toCompatPart` and by the cross-SDK equivalents in
 *   `a2a-python` / `a2a-go`.
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

    // Reverse the `{ value: <primitive> }` wrap added by `toCompatPart`
    // (or by `a2a-python` / `a2a-go`) when the source v1 value was a
    // primitive/array/null. The flag is the load-bearing signal —
    // without it we cannot distinguish a genuine `{ value: ... }` object
    // from a synthesized wrapper. Snake_case matches the reference SDKs'
    // on-the-wire format; the flag is stripped so it does not leak into
    // v1.0 metadata.
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
 * - `content.$case: 'text'` ↔ `kind: 'text'`.
 * - `content.$case: 'raw'` ↔ `kind: 'file'` with `FileWithBytes` (base64
 *   encoding the `Buffer`); `content.$case: 'url'` ↔ `kind: 'file'` with
 *   `FileWithUri`. `filename` / `mediaType` are pushed down into the
 *   inner file's `name` / `mimeType`.
 * - `content.$case: 'data'`: when the v1.0 value is a plain object it is
 *   used directly. When the value is a primitive (string, number,
 *   boolean), an array, or `null`, it is wrapped as `{ value: <original> }`
 *   and `metadata.data_part_compat: true` is set on the resulting v0.3
 *   part (snake_case matches the on-the-wire format used by `a2a-python`
 *   and `a2a-go`, so peers in those SDKs recognize the wrapper) so
 *   `toCorePart` — and its cross-SDK equivalents — can unwrap it
 *   losslessly. Throws `A2AError.invalidParams` only when the value is
 *   neither a plain object nor a wrap-eligible primitive — i.e.,
 *   `Symbol`, `function`, `bigint`, `undefined`, or `Buffer` — for which
 *   even the `{ value: ... }` wrapper could not survive JSON
 *   serialization.
 *
 * @throws {A2AError} when `content` is missing, has an unknown `$case`,
 * or carries a `data` value that is neither a plain object nor a
 * wrap-eligible primitive / array / null.
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
      // Wrap the primitive / array / null in `{ value: <original> }` and
      // tag the v0.3 part so `toCorePart` can losslessly unwrap. The
      // wrapped reference is passed through as-is (no defensive clone),
      // matching the plain-object branch above and the metadata-cloning
      // policy already documented for this file.
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

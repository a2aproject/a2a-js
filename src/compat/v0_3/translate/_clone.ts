/**
 * Internal deep-clone helpers used across the v0.3 translation layer.
 *
 * All metadata-like fields on the v1.0 and v0.3 type surfaces are
 * `{ [k: string]: unknown }` bags that originate from JSON-RPC wire
 * payloads or proto3 `Struct` values — strict JSON-shaped values that
 * `structuredClone` handles natively. Deep-cloning is required so the
 * translated payload does not alias nested objects/arrays back into the
 * source, which would otherwise let callers mutate each other's state
 * through shared references.
 *
 * Mirrors the de-facto deep-clone convention in `src/server/store.ts`,
 * which uses `structuredClone` for the same isolation reasons.
 *
 * This module is intentionally not re-exported from `translate/index.ts`
 * — it is implementation detail of the per-entity translators in this
 * directory.
 */

/**
 * Returns a deep, structured clone of a metadata-shaped record, or
 * `undefined` for an `undefined` input.
 *
 * The `undefined` short-circuit means call sites don't pay a
 * `structuredClone` call on the common "no metadata" path, which keeps
 * the translation layer's per-request overhead negligible.
 */
export function deepCloneMetadata(
  metadata: { [k: string]: unknown } | undefined
): { [k: string]: unknown } | undefined {
  return metadata === undefined ? undefined : structuredClone(metadata);
}

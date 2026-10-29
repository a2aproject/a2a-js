// Deep-clone helpers for metadata bags. Cloning prevents callers from
// mutating each other's state through shared references.

/** Deep-clones a metadata record. Short-circuits on `undefined`. */
export function deepCloneMetadata(
  metadata: { [k: string]: unknown } | undefined
): { [k: string]: unknown } | undefined {
  return metadata === undefined ? undefined : structuredClone(metadata);
}

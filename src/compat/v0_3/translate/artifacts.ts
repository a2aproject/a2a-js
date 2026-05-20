/**
 * `Artifact` translator between v1.0 proto and v0.3 JSON.
 *
 * The wire-level differences handled here:
 *
 *  - **Optional fields.** v0.3 omits optional fields (and empty arrays) when
 *    they equal their default values. v1.0 proto3 initializes all optional
 *    fields to empty strings / empty arrays, so we must explicitly prune them
 *    on the v0.3 output side to match expected shapes.
 *  - **Extension layout.** v1.0 `AgentArtifact.extensions` is a `repeated
 *    google.protobuf.Any` — since `google.protobuf.Any` is JSON-mapped to a
 *    `{}` object in many environments, we explicitly copy the repeated
 *    field to a v0.3-style `string[]` to avoid creating an array of empty
 *    objects where `string[]` is expected.
 */

import { toCompatPart, toCorePart } from './parts.js';
import type { Artifact as V1Artifact } from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';
import { deepCloneMetadata } from './_clone.js';

function nonEmptyString(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function nonEmptyArray<T>(value: T[]): T[] | undefined {
  return value.length === 0 ? undefined : [...value];
}

/**
 * Converts a v0.3 JSON `Artifact` into a v1.0 proto `Artifact`.
 *
 * Optional string fields collapse to the proto3 empty-string default;
 * optional arrays collapse to empty arrays.
 */
export function toCoreArtifact(compatArtifact: legacy.Artifact): V1Artifact {
  return {
    artifactId: compatArtifact.artifactId,
    name: compatArtifact.name ?? '',
    description: compatArtifact.description ?? '',
    parts: compatArtifact.parts.map(toCorePart),
    metadata: deepCloneMetadata(compatArtifact.metadata),
    extensions: compatArtifact.extensions ? [...compatArtifact.extensions] : [],
  };
}

/**
 * Converts a v1.0 proto `Artifact` into a v0.3 JSON `Artifact`.
 *
 * Empty proto3 strings and arrays are pruned to keep v0.3 JSON payloads
 * minimal and round-trip-stable.
 */
export function toCompatArtifact(coreArtifact: V1Artifact): legacy.Artifact {
  const result: legacy.Artifact = {
    artifactId: coreArtifact.artifactId,
    parts: coreArtifact.parts.map(toCompatPart),
  };

  const name = nonEmptyString(coreArtifact.name);
  if (name !== undefined) result.name = name;

  const description = nonEmptyString(coreArtifact.description);
  if (description !== undefined) result.description = description;

  const metadata = deepCloneMetadata(coreArtifact.metadata);
  if (metadata !== undefined) result.metadata = metadata;

  const extensions = nonEmptyArray(coreArtifact.extensions);
  if (extensions !== undefined) result.extensions = extensions;

  return result;
}

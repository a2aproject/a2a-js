// `Artifact` translator. v0.3 omits empty / default fields; v1.0 keeps
// them as empty strings / arrays. `extensions` is forced to `string[]`
// because the proto's `Any` would JSON-map to empty objects otherwise.

import { toCompatPart, toCorePart } from './parts.js';
import type { Artifact as V1Artifact } from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';
import { deepCloneMetadata } from './_clone.js';
import { requireArray } from './_validate.js';

function nonEmptyString(value: string | undefined | null): string | undefined {
  return value == null || value === '' ? undefined : value;
}

function nonEmptyArray<T>(value: T[] | undefined | null): T[] | undefined {
  return value == null || value.length === 0 ? undefined : [...value];
}

export function toCoreArtifact(compatArtifact: legacy.Artifact): V1Artifact {
  return {
    artifactId: compatArtifact.artifactId,
    name: compatArtifact.name ?? '',
    description: compatArtifact.description ?? '',
    parts: requireArray(compatArtifact.parts, 'artifact.parts').map(toCorePart),
    metadata: deepCloneMetadata(compatArtifact.metadata),
    extensions: compatArtifact.extensions ? [...compatArtifact.extensions] : [],
  };
}

export function toCompatArtifact(coreArtifact: V1Artifact): legacy.Artifact {
  const result: legacy.Artifact = {
    artifactId: coreArtifact.artifactId,
    parts: requireArray(coreArtifact.parts, 'artifact.parts').map(toCompatPart),
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

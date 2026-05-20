import { describe, expect, it } from 'vitest';
import {
  toCompatArtifact,
  toCoreArtifact,
} from '../../../../src/compat/v0_3/translate/artifacts.js';
import type { Artifact as V1Artifact } from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('artifacts', () => {
  describe('toCoreArtifact', () => {
    it('coerces missing optional fields to proto3 defaults', () => {
      const compat: legacy.Artifact = {
        artifactId: 'art-1',
        parts: [{ kind: 'text', text: 'x' }],
      };
      const core = toCoreArtifact(compat);
      expect(core.artifactId).toBe('art-1');
      expect(core.name).toBe('');
      expect(core.description).toBe('');
      expect(core.metadata).toBeUndefined();
      expect(core.extensions).toEqual([]);
      expect(core.parts).toHaveLength(1);
    });

    it('preserves optional fields', () => {
      const compat: legacy.Artifact = {
        artifactId: 'art-1',
        name: 'name',
        description: 'desc',
        parts: [],
        metadata: { k: 'v' },
        extensions: ['ext-uri'],
      };
      const core = toCoreArtifact(compat);
      expect(core.name).toBe('name');
      expect(core.description).toBe('desc');
      expect(core.metadata).toEqual({ k: 'v' });
      expect(core.extensions).toEqual(['ext-uri']);
    });
  });

  describe('toCompatArtifact', () => {
    it('prunes empty proto3 defaults', () => {
      const core: V1Artifact = {
        artifactId: 'art-1',
        name: '',
        description: '',
        parts: [],
        metadata: undefined,
        extensions: [],
      };
      expect(toCompatArtifact(core)).toEqual({ artifactId: 'art-1', parts: [] });
    });

    it('keeps non-empty optionals', () => {
      const core: V1Artifact = {
        artifactId: 'art-1',
        name: 'name',
        description: 'desc',
        parts: [],
        metadata: { k: 'v' },
        extensions: ['ext'],
      };
      expect(toCompatArtifact(core)).toEqual({
        artifactId: 'art-1',
        parts: [],
        name: 'name',
        description: 'desc',
        metadata: { k: 'v' },
        extensions: ['ext'],
      });
    });
  });

  describe('round-tripping', () => {
    it('round-trips a fully-populated artifact', () => {
      const compat: legacy.Artifact = {
        artifactId: 'art-1',
        name: 'name',
        description: 'desc',
        parts: [{ kind: 'text', text: 'hi' }],
        metadata: { k: 'v' },
        extensions: ['ext'],
      };
      expect(toCompatArtifact(toCoreArtifact(compat))).toEqual(compat);
    });
  });
});

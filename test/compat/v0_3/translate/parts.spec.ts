import { describe, expect, it } from 'vitest';
import { toCompatPart, toCorePart } from '../../../../src/compat/v0_3/translate/parts.js';
import { A2AError } from '../../../../src/compat/v0_3/server/error.js';
import type { Part as V1Part } from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('parts', () => {
  describe('toCorePart', () => {
    it('converts a text part', () => {
      const compat: legacy.Part = { kind: 'text', text: 'hello' };
      const core = toCorePart(compat);
      expect(core).toEqual({
        content: { $case: 'text', value: 'hello' },
        metadata: undefined,
        filename: '',
        mediaType: '',
      });
    });

    it('preserves metadata on a text part', () => {
      const compat: legacy.Part = { kind: 'text', text: 'hi', metadata: { foo: 'bar' } };
      const core = toCorePart(compat);
      expect(core.metadata).toEqual({ foo: 'bar' });
    });

    it('converts a file-with-bytes part, decoding base64', () => {
      const bytes = Buffer.from('payload');
      const compat: legacy.Part = {
        kind: 'file',
        file: { bytes: bytes.toString('base64'), mimeType: 'text/plain', name: 'p.txt' },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'raw', value: bytes });
      expect(core.mediaType).toBe('text/plain');
      expect(core.filename).toBe('p.txt');
    });

    it('converts a file-with-uri part', () => {
      const compat: legacy.Part = {
        kind: 'file',
        file: { uri: 'https://example.com/x', mimeType: 'image/png' },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'url', value: 'https://example.com/x' });
      expect(core.mediaType).toBe('image/png');
      expect(core.filename).toBe('');
    });

    it('throws when the file part has neither bytes nor uri', () => {
      const compat = { kind: 'file', file: {} } as unknown as legacy.Part;
      expect(() => toCorePart(compat)).toThrow(A2AError);
    });

    it('converts a data part (plain object)', () => {
      const compat: legacy.Part = { kind: 'data', data: { x: 1 } };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: { x: 1 } });
    });

    it('unwraps a wrapped primitive data part when data_part_compat=true', () => {
      const compat: legacy.Part = {
        kind: 'data',
        data: { value: 42 },
        metadata: { data_part_compat: true },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: 42 });
      expect(core.metadata).toBeUndefined();
    });

    it('unwraps a wrapped null data part when data_part_compat=true', () => {
      const compat: legacy.Part = {
        kind: 'data',
        data: { value: null },
        metadata: { data_part_compat: true },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: null });
      expect(core.metadata).toBeUndefined();
    });

    it('unwraps a wrapped array data part when data_part_compat=true', () => {
      const compat: legacy.Part = {
        kind: 'data',
        data: { value: [1, 2, 3] },
        metadata: { data_part_compat: true },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: [1, 2, 3] });
      expect(core.metadata).toBeUndefined();
    });

    it('preserves non-flag metadata when unwrapping a wrapped data part', () => {
      const compat: legacy.Part = {
        kind: 'data',
        data: { value: 'hello' },
        metadata: { data_part_compat: true, ext: 'keep-me' },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: 'hello' });
      expect(core.metadata).toEqual({ ext: 'keep-me' });
    });

    it('does not unwrap a {value: ...} object when data_part_compat is absent', () => {
      const compat: legacy.Part = { kind: 'data', data: { value: 42 } };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: { value: 42 } });
    });

    it('does not unwrap when the compat flag is present but not strictly true', () => {
      // Only the literal boolean `true` triggers unwrap; truthy strings,
      // 1, etc. are foreign metadata that must round-trip.
      const compat: legacy.Part = {
        kind: 'data',
        data: { value: 42 },
        metadata: { data_part_compat: 'yes' as unknown as boolean },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: { value: 42 } });
      expect(core.metadata).toEqual({ data_part_compat: 'yes' });
    });

    it('throws for an unknown kind', () => {
      const compat = { kind: 'unknown' } as unknown as legacy.Part;
      expect(() => toCorePart(compat)).toThrow(A2AError);
    });

    it('rejects a non-object entry (typeof [] === "object")', () => {
      expect(() => toCorePart(null as unknown as legacy.Part)).toThrow(/object/);
      expect(() => toCorePart('text' as unknown as legacy.Part)).toThrow(/object/);
      expect(() => toCorePart([] as unknown as legacy.Part)).toThrow(/object/);
    });
  });

  describe('toCompatPart', () => {
    it('converts a text part', () => {
      const core: V1Part = {
        content: { $case: 'text', value: 'hello' },
        metadata: undefined,
        filename: '',
        mediaType: '',
      };
      expect(toCompatPart(core)).toEqual({ kind: 'text', text: 'hello' });
    });

    it('preserves metadata on a text part', () => {
      const core: V1Part = {
        content: { $case: 'text', value: 'x' },
        metadata: { k: 'v' },
        filename: '',
        mediaType: '',
      };
      expect(toCompatPart(core)).toEqual({ kind: 'text', text: 'x', metadata: { k: 'v' } });
    });

    it('converts a raw file part, base64-encoding the buffer', () => {
      const bytes = Buffer.from('payload');
      const core: V1Part = {
        content: { $case: 'raw', value: bytes },
        metadata: undefined,
        filename: 'p.txt',
        mediaType: 'text/plain',
      };
      expect(toCompatPart(core)).toEqual({
        kind: 'file',
        file: { bytes: bytes.toString('base64'), mimeType: 'text/plain', name: 'p.txt' },
      });
    });

    it('omits mimeType / name when the corresponding top-level fields are empty', () => {
      const bytes = Buffer.from('x');
      const core: V1Part = {
        content: { $case: 'raw', value: bytes },
        metadata: undefined,
        filename: '',
        mediaType: '',
      };
      const result = toCompatPart(core) as legacy.FilePart;
      expect(result.file).toEqual({ bytes: bytes.toString('base64') });
    });

    it('converts a url file part', () => {
      const core: V1Part = {
        content: { $case: 'url', value: 'https://example.com/x' },
        metadata: undefined,
        filename: '',
        mediaType: 'image/png',
      };
      expect(toCompatPart(core)).toEqual({
        kind: 'file',
        file: { uri: 'https://example.com/x', mimeType: 'image/png' },
      });
    });

    it('converts a plain-object data part directly', () => {
      const core: V1Part = {
        content: { $case: 'data', value: { x: 1 } },
        metadata: undefined,
        filename: '',
        mediaType: '',
      };
      expect(toCompatPart(core)).toEqual({ kind: 'data', data: { x: 1 } });
    });

    it.each([
      ['string', 'hello'],
      ['number', 42],
      ['boolean true', true],
      ['boolean false', false],
      ['null', null],
      ['array', [1, 2, 3]],
    ])('wraps a non-object data value (%s) with data_part_compat=true', (_label, value) => {
      const core: V1Part = {
        content: { $case: 'data', value },
        metadata: undefined,
        filename: '',
        mediaType: '',
      };
      expect(toCompatPart(core)).toEqual({
        kind: 'data',
        data: { value },
        metadata: { data_part_compat: true },
      });
    });

    it('merges the data_part_compat flag with existing metadata when wrapping', () => {
      const core: V1Part = {
        content: { $case: 'data', value: 42 },
        metadata: { ext: 'keep-me' },
        filename: '',
        mediaType: '',
      };
      expect(toCompatPart(core)).toEqual({
        kind: 'data',
        data: { value: 42 },
        metadata: { ext: 'keep-me', data_part_compat: true },
      });
    });

    it.each([
      ['Symbol', Symbol('s') as unknown],
      ['function', (() => 0) as unknown],
      ['bigint', 1n as unknown],
      ['undefined', undefined as unknown],
      ['Buffer', Buffer.from('x') as unknown],
    ])(
      'throws when v1 data part value is neither a plain object nor a wrap-eligible primitive (%s)',
      (_label, value: unknown) => {
        const core: V1Part = {
          content: { $case: 'data', value },
          metadata: undefined,
          filename: '',
          mediaType: '',
        };
        expect(() => toCompatPart(core)).toThrow(A2AError);
      }
    );

    it('throws when content is missing', () => {
      const core: V1Part = {
        content: undefined,
        metadata: undefined,
        filename: '',
        mediaType: '',
      };
      expect(() => toCompatPart(core)).toThrow(A2AError);
    });
  });

  describe('round-tripping', () => {
    it('round-trips a text part', () => {
      const compat: legacy.Part = { kind: 'text', text: 'hello', metadata: { k: 'v' } };
      expect(toCompatPart(toCorePart(compat))).toEqual(compat);
    });

    it('round-trips a file-with-bytes part', () => {
      const compat: legacy.Part = {
        kind: 'file',
        file: {
          bytes: Buffer.from('payload').toString('base64'),
          mimeType: 'text/plain',
          name: 'p.txt',
        },
      };
      expect(toCompatPart(toCorePart(compat))).toEqual(compat);
    });

    it('round-trips a file-with-uri part', () => {
      const compat: legacy.Part = {
        kind: 'file',
        file: { uri: 'https://example.com/x', mimeType: 'image/png', name: 'x.png' },
      };
      expect(toCompatPart(toCorePart(compat))).toEqual(compat);
    });

    it('round-trips a plain-object data part', () => {
      const compat: legacy.Part = { kind: 'data', data: { x: 1, y: [2, 3] } };
      expect(toCompatPart(toCorePart(compat))).toEqual(compat);
    });

    it.each([
      ['string', 'hello'],
      ['number', 42],
      ['boolean', true],
      ['null', null],
      ['array', [1, 2, 3]],
    ])(
      'round-trips a v1 data part with a non-object value (%s) through the v0.3 wrap-and-flag form',
      (_label, value) => {
        const core: V1Part = {
          content: { $case: 'data', value },
          metadata: undefined,
          filename: '',
          mediaType: '',
        };
        const compat = toCompatPart(core);
        expect(compat).toEqual({
          kind: 'data',
          data: { value },
          metadata: { data_part_compat: true },
        });
        const roundTripped = toCorePart(compat);
        expect(roundTripped.content).toEqual({ $case: 'data', value });
        expect(roundTripped.metadata).toBeUndefined();
      }
    );

    it.each([
      ['string', 'hello'],
      ['number', 42],
      ['boolean', true],
      ['null', null],
      ['array', [1, 2, 3]],
    ])(
      'unwraps an incoming v0.3 payload (%s) tagged with data_part_compat=true',
      (_label, value) => {
        // The v1 layer must see the original primitive / array / null,
        // not a stray `{ value: ... }` object.
        const compat: legacy.Part = {
          kind: 'data',
          data: { value },
          metadata: { data_part_compat: true },
        };
        const core = toCorePart(compat);
        expect(core.content).toEqual({ $case: 'data', value });
        expect(core.metadata).toBeUndefined();
      }
    );
  });

  describe('metadata deep-cloning', () => {
    it('toCorePart deep-clones metadata on data parts', () => {
      const nested = { list: [1, 2] };
      const compat: legacy.Part = {
        kind: 'data',
        data: { x: 1 },
        metadata: { nested },
      };
      const core = toCorePart(compat);
      (core.metadata!.nested as { list: number[] }).list.push(3);
      expect(nested.list).toEqual([1, 2]);
    });
  });
});

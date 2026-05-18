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

    it('unwraps a `data_part_compat`-flagged data part to the original primitive', () => {
      const compat: legacy.Part = {
        kind: 'data',
        data: { value: 42 },
        metadata: { data_part_compat: true, extra: 'preserved' },
      };
      const core = toCorePart(compat);
      expect(core.content).toEqual({ $case: 'data', value: 42 });
      // The compat flag is stripped, other metadata remains.
      expect(core.metadata).toEqual({ extra: 'preserved' });
    });

    it('drops metadata entirely when the only key was the compat flag', () => {
      const compat: legacy.Part = {
        kind: 'data',
        data: { value: 'hi' },
        metadata: { data_part_compat: true },
      };
      const core = toCorePart(compat);
      expect(core.metadata).toBeUndefined();
    });

    it('throws for an unknown kind', () => {
      const compat = { kind: 'unknown' } as unknown as legacy.Part;
      expect(() => toCorePart(compat)).toThrow(A2AError);
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

    it('wraps a non-object data value and sets the compat flag in metadata', () => {
      const core: V1Part = {
        content: { $case: 'data', value: 'hello' },
        metadata: undefined,
        filename: '',
        mediaType: '',
      };
      const compat = toCompatPart(core) as legacy.DataPart;
      expect(compat.kind).toBe('data');
      expect(compat.data).toEqual({ value: 'hello' });
      expect(compat.metadata?.data_part_compat).toBe(true);
    });

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

    it('round-trips a non-object data value via data_part_compat', () => {
      const original: V1Part = {
        content: { $case: 'data', value: 'hello' },
        metadata: undefined,
        filename: '',
        mediaType: '',
      };
      const intermediate = toCompatPart(original);
      const back = toCorePart(intermediate);
      expect(back.content).toEqual({ $case: 'data', value: 'hello' });
      expect(back.metadata).toBeUndefined();
    });
  });
});

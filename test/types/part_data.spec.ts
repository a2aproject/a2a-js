import { describe, it, expect } from 'vitest';
import { Part } from '../../src/types/pb/a2a.js';

describe('Part protobuf codec', () => {
  describe('Part.data oneof handling (google.protobuf.Value)', () => {
    it('keeps data arm and round-trips when value is null', () => {
      const input: Record<string, unknown> = { data: null, mediaType: 'application/json' };
      const parsed = Part.fromJSON(input);

      expect(parsed.content).toEqual({ $case: 'data', value: null });

      const output = Part.toJSON(parsed) as Record<string, unknown>;
      expect(output).toHaveProperty('data', null);
      expect(output).toHaveProperty('mediaType', 'application/json');
    });

    it('round-trips string data value', () => {
      const input: Record<string, unknown> = { data: 'hello world', mediaType: 'text/plain' };
      const parsed = Part.fromJSON(input);

      expect(parsed.content).toEqual({ $case: 'data', value: 'hello world' });

      const output = Part.toJSON(parsed) as Record<string, unknown>;
      expect(output.data).toBe('hello world');
    });

    it('round-trips numeric data value (including 0)', () => {
      const input: Record<string, unknown> = { data: 0, mediaType: 'application/json' };
      const parsed = Part.fromJSON(input);

      expect(parsed.content).toEqual({ $case: 'data', value: 0 });

      const output = Part.toJSON(parsed) as Record<string, unknown>;
      expect(output.data).toBe(0);
    });

    it('round-trips boolean data value (including false)', () => {
      const input: Record<string, unknown> = { data: false, mediaType: 'application/json' };
      const parsed = Part.fromJSON(input);

      expect(parsed.content).toEqual({ $case: 'data', value: false });

      const output = Part.toJSON(parsed) as Record<string, unknown>;
      expect(output.data).toBe(false);
    });

    it('round-trips object struct data value', () => {
      const input: Record<string, unknown> = {
        data: { nested: 'obj', count: 42, active: true },
        mediaType: 'application/json',
      };
      const parsed = Part.fromJSON(input);

      expect(parsed.content).toEqual({
        $case: 'data',
        value: { nested: 'obj', count: 42, active: true },
      });

      const output = Part.toJSON(parsed) as Record<string, unknown>;
      expect(output.data).toEqual({ nested: 'obj', count: 42, active: true });
    });

    it('round-trips array list data value (with null elements)', () => {
      const input: Record<string, unknown> = {
        data: [1, null, 'string', true],
        mediaType: 'application/json',
      };
      const parsed = Part.fromJSON(input);

      expect(parsed.content).toEqual({ $case: 'data', value: [1, null, 'string', true] });

      const output = Part.toJSON(parsed) as Record<string, unknown>;
      expect(output.data).toEqual([1, null, 'string', true]);
    });

    it('leaves content undefined when no content arm is provided', () => {
      const input: Record<string, unknown> = { mediaType: 'application/json' };
      const parsed = Part.fromJSON(input);

      expect(parsed.content).toBeUndefined();

      const output = Part.toJSON(parsed) as Record<string, unknown>;
      expect(output).not.toHaveProperty('data');
      expect(output).not.toHaveProperty('text');
      expect(output).not.toHaveProperty('raw');
      expect(output).not.toHaveProperty('url');
    });

    it('round-trips text and url parts correctly', () => {
      const textPart = Part.fromJSON({ text: 'Hello', mediaType: 'text/plain' });
      expect(textPart.content).toEqual({ $case: 'text', value: 'Hello' });
      expect((Part.toJSON(textPart) as Record<string, unknown>).text).toBe('Hello');

      const urlPart = Part.fromJSON({ url: 'https://example.com', mediaType: 'text/uri-list' });
      expect(urlPart.content).toEqual({ $case: 'url', value: 'https://example.com' });
      expect((Part.toJSON(urlPart) as Record<string, unknown>).url).toBe('https://example.com');
    });
  });
});

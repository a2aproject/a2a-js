import { describe, it, expect } from 'vitest';
import { Part, TaskStatus } from '../src/index.js';

/**
 * proto3 JSON conformance for the generated codecs.
 *
 * These same messages go over the wire to SDKs that generate from the same
 * .proto with a different toolchain, so the JSON has to match. Cases were
 * found by round-tripping a shared corpus through this SDK and a2a-python and
 * diffing the output.
 *
 * `it.fails` marks a case that is known-broken today. When one gets fixed the
 * marker starts failing, so the fix can't land without flipping it.
 */

describe('proto3 JSON conformance', () => {
  describe('enums', () => {
    // Baseline: both spellings of a known value work, so the harness itself is sound.
    it('accepts a known value by name', () => {
      const out = TaskStatus.toJSON(TaskStatus.fromJSON({ state: 'TASK_STATE_WORKING' })) as any;
      expect(out.state).toBe('TASK_STATE_WORKING');
    });

    it('accepts a known value by number', () => {
      const out = TaskStatus.toJSON(TaskStatus.fromJSON({ state: 2 })) as any;
      expect(out.state).toBe('TASK_STATE_WORKING');
    });

    // TaskState currently stops at 8. When the spec adds 9, a 1.0 SDK sitting
    // between two newer peers has to pass it through rather than eat it.
    it.fails('keeps an unknown value as its number', () => {
      const out = TaskStatus.toJSON(TaskStatus.fromJSON({ state: 99 })) as any;
      expect(out.state).toBe(99);
    });
  });

  describe('Timestamp', () => {
    it('leaves an already-normalized timestamp alone', () => {
      const out = TaskStatus.toJSON(
        TaskStatus.fromJSON({ state: 'TASK_STATE_WORKING', timestamp: '2026-01-01T00:00:00Z' })
      ) as any;
      expect(out.timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it.fails('rejects a value that is not a timestamp', () => {
      expect(() =>
        TaskStatus.fromJSON({ state: 'TASK_STATE_WORKING', timestamp: 'not-a-timestamp' })
      ).toThrow();
    });

    // proto3 JSON output is always Z-normalized. a2a-python emits
    // 2026-01-01T00:00:00Z for this input, so the two SDKs currently produce
    // different bytes for the same instant.
    it.fails('normalizes a non-UTC offset to Z', () => {
      const out = TaskStatus.toJSON(
        TaskStatus.fromJSON({ state: 'TASK_STATE_WORKING', timestamp: '2026-01-01T05:30:00+05:30' })
      ) as any;
      expect(out.timestamp).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('Part.content oneof', () => {
    it('round-trips a text part', () => {
      const out = Part.toJSON(Part.fromJSON({ text: 'Café 日本語' })) as any;
      expect(out.text).toBe('Café 日本語');
    });

    it('round-trips a bytes part', () => {
      const out = Part.toJSON(
        Part.fromJSON({ raw: '+/8=', mediaType: 'application/octet-stream' })
      ) as any;
      expect(out.raw).toBe('+/8=');
    });

    // Part.data is a google.protobuf.Value, and null is a Value. Dropping it
    // turns a data part carrying null into a part with no content at all.
    it.fails('keeps the data arm when the value is null', () => {
      const out = Part.toJSON(Part.fromJSON({ data: null, mediaType: 'application/json' })) as any;
      expect(out).toHaveProperty('data', null);
    });

    // More than one member of a oneof is malformed input. Right now whichever
    // arm survives depends on the order of the generated fromJSON body.
    it.fails('rejects more than one content arm', () => {
      expect(() => Part.fromJSON({ text: 'hello', url: 'https://example.com/x' })).toThrow();
    });
  });
});

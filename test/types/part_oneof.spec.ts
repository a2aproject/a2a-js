import { describe, it, expect } from 'vitest';
import { Part } from '../../src/types/pb/a2a.js';

describe('Part.fromJSON oneof validation (Issue #643)', () => {
  it('accepts a valid single text arm', () => {
    const parsed = Part.fromJSON({ text: 'hello' });
    expect(parsed.content).toEqual({ $case: 'text', value: 'hello' });
  });

  it('accepts a valid single url arm', () => {
    const parsed = Part.fromJSON({ url: 'https://example.com/x' });
    expect(parsed.content).toEqual({ $case: 'url', value: 'https://example.com/x' });
  });

  it('accepts a valid single raw arm', () => {
    const parsed = Part.fromJSON({ raw: '+/8=' });
    expect(parsed.content?.$case).toBe('raw');
  });

  it('accepts a valid single data arm', () => {
    const parsed = Part.fromJSON({ data: { key: 'value' } });
    expect(parsed.content).toEqual({ $case: 'data', value: { key: 'value' } });
  });

  it('accepts an empty part with no content arm', () => {
    const parsed = Part.fromJSON({});
    expect(parsed.content).toBeUndefined();
  });

  it('throws an error when both text and url are present', () => {
    expect(() => Part.fromJSON({ text: 'hello', url: 'https://example.com/x' })).toThrow(
      'Message type "lf.a2a.v1.Part" should not have multiple "content" oneof fields: text, url'
    );
  });

  it('throws an error when text, raw, and data are present', () => {
    expect(() => Part.fromJSON({ text: 'hello', raw: '+/8=', data: { foo: 'bar' } })).toThrow(
      'Message type "lf.a2a.v1.Part" should not have multiple "content" oneof fields: text, raw, data'
    );
  });

  it('throws an error when all four content arms are present', () => {
    expect(() =>
      Part.fromJSON({ text: 'hello', raw: '+/8=', url: 'https://example.com', data: 123 })
    ).toThrow(
      'Message type "lf.a2a.v1.Part" should not have multiple "content" oneof fields: text, raw, url, data'
    );
  });
});

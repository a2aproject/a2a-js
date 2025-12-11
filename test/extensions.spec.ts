import { describe, it, expect } from 'vitest';
import { Extensions } from '../src/extensions.js';

describe('ExtensionIds', () => {
  it('should parse comma separated', () => {
    const value = 'http://ext1,  http://ext2,http://ext3';

    const actual = Extensions.parseServiceParameter(value);

    expect(actual).to.deep.equal(['http://ext1', 'http://ext2', 'http://ext3']);
  });

  it('should remove duplicates while parsing', () => {
    const value = 'http://ext1,  http://ext2,http://ext2';

    const actual = Extensions.parseServiceParameter(value);

    expect(actual).to.deep.equal(['http://ext1', 'http://ext2']);
  });

  it('should create from existing', () => {
    const existing = ['http://ext1', 'http://ext2'];
    const additional = 'http://ext3';

    const actual = Extensions.createFrom(existing, additional);

    expect(actual).to.deep.equal(['http://ext1', 'http://ext2', 'http://ext3']);
  });

  it('should create from undefined', () => {
    const additional = 'http://ext1';

    const actual = Extensions.createFrom(undefined, additional);

    expect(actual).to.deep.equal(['http://ext1']);
  });

  it('should not add duplicate to existing', () => {
    const existing = ['http://ext1', 'http://ext2'];
    const additional = 'http://ext2';

    const actual = Extensions.createFrom(existing, additional);

    expect(actual).to.deep.equal(['http://ext1', 'http://ext2']);
  });

  it('should convert to service parameter', () => {
    const ids = ['http://ext1', 'http://ext2'];

    const actual = Extensions.toServiceParameter(ids);

    expect(actual).to.be.eq('http://ext1,http://ext2');
  });
});

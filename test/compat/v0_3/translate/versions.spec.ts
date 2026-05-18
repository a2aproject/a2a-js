import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION_0_3,
  PROTOCOL_VERSION_1_0,
  isLegacyVersion,
} from '../../../../src/compat/v0_3/translate/versions.js';

describe('versions', () => {
  describe('constants', () => {
    it('exposes the v0.3 protocol version string', () => {
      expect(PROTOCOL_VERSION_0_3).toBe('0.3');
    });

    it('exposes the v1.0 protocol version string', () => {
      expect(PROTOCOL_VERSION_1_0).toBe('1.0');
    });
  });

  describe('isLegacyVersion', () => {
    it('returns true for the legacy version itself', () => {
      expect(isLegacyVersion('0.3')).toBe(true);
    });

    it('returns true for 0.3.5 (patch-level legacy)', () => {
      expect(isLegacyVersion('0.3.5')).toBe(true);
    });

    it('returns true for 0.9 (still <1.0)', () => {
      expect(isLegacyVersion('0.9')).toBe(true);
    });

    it('returns false for 1.0', () => {
      expect(isLegacyVersion('1.0')).toBe(false);
    });

    it('returns false for newer 1.x', () => {
      expect(isLegacyVersion('1.0.1')).toBe(false);
      expect(isLegacyVersion('1.5')).toBe(false);
      expect(isLegacyVersion('2.0')).toBe(false);
    });

    it('returns false for pre-0.3 versions', () => {
      expect(isLegacyVersion('0.2')).toBe(false);
      expect(isLegacyVersion('0.0')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isLegacyVersion('')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isLegacyVersion(null)).toBe(false);
      expect(isLegacyVersion(undefined)).toBe(false);
    });

    it('returns false for unparseable strings', () => {
      expect(isLegacyVersion('not-a-version')).toBe(false);
      expect(isLegacyVersion('abc.def')).toBe(false);
      expect(isLegacyVersion('-1.0')).toBe(false);
    });

    it('treats single-component major as M.0', () => {
      // "0" -> 0.0 -> not legacy
      expect(isLegacyVersion('0')).toBe(false);
      // "1" -> 1.0 -> not legacy
      expect(isLegacyVersion('1')).toBe(false);
    });
  });
});

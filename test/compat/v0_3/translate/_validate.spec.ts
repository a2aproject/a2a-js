import { describe, expect, it } from 'vitest';
import { requireArray, requireObject } from '../../../../src/compat/v0_3/translate/_validate.js';
import { A2AError } from '../../../../src/compat/v0_3/server/error.js';
import { JSON_RPC_ERROR_CODE } from '../../../../src/errors/json_rpc.js';

describe('_validate', () => {
  describe('requireArray', () => {
    it('returns the value when it is an array', () => {
      const arr = [1, 2, 3];
      expect(requireArray(arr, 'foo')).toBe(arr);
    });

    it('accepts an empty array', () => {
      const arr: number[] = [];
      expect(requireArray(arr, 'foo')).toBe(arr);
    });

    it.each([undefined, null, 'string', 42, {}, true])(
      'throws A2AError.invalidParams for non-array input (%p)',
      (value) => {
        expect(() => requireArray(value as unknown as unknown[], 'foo.bar')).toThrowError(A2AError);
        expect(() => requireArray(value as unknown as unknown[], 'foo.bar')).toThrow(
          /foo\.bar is required and must be an array/
        );
      }
    );

    it('carries the JSON-RPC invalid-params code', () => {
      try {
        requireArray(undefined, 'x');
        expect.fail('requireArray should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(A2AError);
        expect(JSON_RPC_ERROR_CODE[(err as Error).name]).toBe(-32602);
      }
    });
  });

  describe('requireObject', () => {
    it('returns the value when it is a plain object', () => {
      const obj = { a: 1 };
      expect(requireObject(obj, 'foo')).toBe(obj);
    });

    it.each([undefined, null])('throws for %p', (value) => {
      expect(() => requireObject(value, 'foo.bar')).toThrowError(A2AError);
      expect(() => requireObject(value, 'foo.bar')).toThrow(/foo\.bar is required/);
    });

    it('throws for a non-object primitive', () => {
      expect(() => requireObject('str' as unknown as object, 'foo')).toThrowError(A2AError);
    });

    it('carries the JSON-RPC invalid-params code', () => {
      try {
        requireObject(undefined, 'x');
        expect.fail('requireObject should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(A2AError);
        expect(JSON_RPC_ERROR_CODE[(err as Error).name]).toBe(-32602);
      }
    });
  });
});

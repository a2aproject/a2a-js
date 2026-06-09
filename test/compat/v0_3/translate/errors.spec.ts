/**
 * Tests for `src/compat/v0_3/translate/errors.ts`.
 *
 * Verifies the v1.0 → v0.3 error demotion contract from issue
 * a2aproject/a2a-js#488:
 *
 *   - `LegacyA2AError` passes through verbatim (code, message, data).
 *   - Every v1.0 SDK error class maps to its numeric code via
 *     `A2A_ERROR_CLASS_TO_CODE`.
 *   - The enriched `details[]` array and `ErrorInfo` payload are
 *     never emitted on v0.3 responses.
 *   - REST bodies have NO outer `{ error: … }` wrapper and NO `status`
 *     field — bare `{ code, message, data? }` only.
 *   - Unknown errors fall back to `INTERNAL_ERROR` (`-32603`).
 *   - The new v1.0-only codes (`-32005`, `-32006`, `-32008`, `-32009`)
 *     pass through with their numeric code unchanged.
 */

import { describe, expect, it } from 'vitest';
import {
  type LegacyRestErrorBody,
  toCompatJsonRpcError,
  toCompatRestErrorBody,
} from '../../../../src/compat/v0_3/translate/errors.js';
import { A2AError as LegacyA2AError } from '../../../../src/compat/v0_3/server/error.js';
import {
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  GenericError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from '../../../../src/errors.js';

const v1ToLegacyCodeCases: ReadonlyArray<readonly [() => Error, number]> = [
  [() => new TaskNotFoundError('a'), -32001],
  [() => new TaskNotCancelableError('a'), -32002],
  [() => new PushNotificationNotSupportedError('a'), -32003],
  [() => new UnsupportedOperationError('a'), -32004],
  // v1.0-only codes (no v0.3 spec equivalent): per issue #488 the
  // numeric code passes through unchanged.
  [() => new ContentTypeNotSupportedError('a'), -32005],
  [() => new InvalidAgentResponseError('a'), -32006],
  [() => new ExtendedAgentCardNotConfiguredError('a'), -32007],
  [() => new ExtensionSupportRequiredError('a'), -32008],
  [() => new VersionNotSupportedError('a'), -32009],
  // SDK-internal classes (not part of the spec but raised by the SDK
  // when validating requests / wrapping arbitrary throws).
  [() => new RequestMalformedError('a'), -32602],
  [() => new GenericError('a'), -32603],
];

describe('compat/v0_3/translate/errors - toCompatJsonRpcError', () => {
  it('passes through LegacyA2AError unchanged', () => {
    const err = LegacyA2AError.taskNotFound('t-1');
    const out = toCompatJsonRpcError(err);
    expect(out.code).toBe(-32001);
    expect(out.message).toContain('t-1');
  });

  it('preserves the data field from a LegacyA2AError', () => {
    const err = LegacyA2AError.invalidParams('boom', { hint: 'check x' });
    const out = toCompatJsonRpcError(err);
    expect(out.code).toBe(-32602);
    expect(out.message).toBe('boom');
    expect(out.data).toEqual({ hint: 'check x' });
  });

  v1ToLegacyCodeCases.forEach(([factory, expectedCode]) => {
    const sample = factory();
    it(`maps ${sample.name} to code ${expectedCode}`, () => {
      const out = toCompatJsonRpcError(factory());
      expect(out.code).toBe(expectedCode);
      expect(out.message).toBe('a');
    });
  });

  it('omits the data field on v1 SDK errors (v0.3 shape compatibility)', () => {
    const out = toCompatJsonRpcError(new TaskNotFoundError('t'));
    expect(out).not.toHaveProperty('data');
    expect(Object.keys(out).sort()).toEqual(['code', 'message']);
  });

  it('never emits a details[] array or @type/reason/domain fields', () => {
    const out = toCompatJsonRpcError(new TaskNotFoundError('t')) as unknown as Record<
      string,
      unknown
    >;
    expect(out).not.toHaveProperty('details');
    expect(out).not.toHaveProperty('@type');
    expect(out).not.toHaveProperty('reason');
    expect(out).not.toHaveProperty('domain');
  });

  it('falls back to INTERNAL_ERROR for unknown Error subclasses', () => {
    const out = toCompatJsonRpcError(new Error('boom'));
    expect(out.code).toBe(-32603);
    expect(out.message).toBe('boom');
    expect(out).not.toHaveProperty('data');
  });

  it('falls back to INTERNAL_ERROR with a generic message for non-Error throws', () => {
    const out = toCompatJsonRpcError('string-thrown');
    expect(out.code).toBe(-32603);
    expect(out.message).toBe('An unexpected error occurred.');
  });

  it('falls back to INTERNAL_ERROR with a generic message for null/undefined throws', () => {
    expect(toCompatJsonRpcError(null).code).toBe(-32603);
    expect(toCompatJsonRpcError(undefined).code).toBe(-32603);
    expect(toCompatJsonRpcError(null).message).toBe('An unexpected error occurred.');
  });
});

describe('compat/v0_3/translate/errors - toCompatRestErrorBody', () => {
  it('passes through LegacyA2AError unchanged', () => {
    const err = LegacyA2AError.taskNotFound('t-1');
    const out = toCompatRestErrorBody(err);
    expect(out.code).toBe(-32001);
    expect(out.message).toContain('t-1');
  });

  it('preserves the data field from a LegacyA2AError', () => {
    const err = LegacyA2AError.invalidParams('boom', { hint: 'check x' });
    const out = toCompatRestErrorBody(err);
    expect(out.code).toBe(-32602);
    expect(out.data).toEqual({ hint: 'check x' });
  });

  v1ToLegacyCodeCases.forEach(([factory, expectedCode]) => {
    const sample = factory();
    it(`maps ${sample.name} to code ${expectedCode}`, () => {
      const out = toCompatRestErrorBody(factory());
      expect(out.code).toBe(expectedCode);
      expect(out.message).toBe('a');
    });
  });

  it('produces a bare body without an outer error wrapper or details array', () => {
    const out: LegacyRestErrorBody = toCompatRestErrorBody(new TaskNotFoundError('t'));
    const opaque = out as unknown as Record<string, unknown>;
    expect(opaque).not.toHaveProperty('error');
    expect(opaque).not.toHaveProperty('details');
    expect(opaque).not.toHaveProperty('status');
    expect(opaque).not.toHaveProperty('@type');
    expect(Object.keys(out).sort()).toEqual(['code', 'message']);
  });

  it('omits the data field on v1 SDK errors (v0.3 shape compatibility)', () => {
    const out = toCompatRestErrorBody(new TaskNotFoundError('t'));
    expect(out).not.toHaveProperty('data');
  });

  it('falls back to INTERNAL_ERROR for unknown Error subclasses', () => {
    const out = toCompatRestErrorBody(new Error('boom'));
    expect(out.code).toBe(-32603);
    expect(out.message).toBe('boom');
  });

  it('falls back to INTERNAL_ERROR with a generic message for non-Error throws', () => {
    const out = toCompatRestErrorBody({ random: 'object' });
    expect(out.code).toBe(-32603);
    expect(out.message).toBe('An unexpected error occurred.');
  });
});

describe('compat/v0_3/translate/errors - cross-transport consistency', () => {
  it('emits the same code and message for every error across both transports', () => {
    const samples: unknown[] = [
      LegacyA2AError.taskNotFound('t-1'),
      LegacyA2AError.invalidParams('boom', { hint: 'check x' }),
      new TaskNotFoundError('a'),
      new TaskNotCancelableError('a'),
      new PushNotificationNotSupportedError('a'),
      new UnsupportedOperationError('a'),
      new ContentTypeNotSupportedError('a'),
      new InvalidAgentResponseError('a'),
      new ExtendedAgentCardNotConfiguredError('a'),
      new ExtensionSupportRequiredError('a'),
      new VersionNotSupportedError('a'),
      new RequestMalformedError('a'),
      new GenericError('a'),
      new Error('boom'),
      'string-thrown',
      undefined,
    ];

    for (const sample of samples) {
      const jsonRpc = toCompatJsonRpcError(sample);
      const rest = toCompatRestErrorBody(sample);
      expect(rest.code).toBe(jsonRpc.code);
      expect(rest.message).toBe(jsonRpc.message);
      expect(rest.data).toEqual(jsonRpc.data);
    }
  });
});

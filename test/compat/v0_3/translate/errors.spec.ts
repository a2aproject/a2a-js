import { describe, expect, it } from 'vitest';
import { toCompatErrorBody } from '../../../../src/compat/v0_3/translate/errors.js';
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
  // v1.0-only codes (no v0.3 spec equivalent): the numeric code
  // passes through unchanged.
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

describe('compat/v0_3/translate/errors - toCompatErrorBody', () => {
  it('passes through LegacyA2AError unchanged', () => {
    const err = LegacyA2AError.taskNotFound('t-1');
    const out = toCompatErrorBody(err);
    expect(out.code).toBe(-32001);
    expect(out.message).toContain('t-1');
  });

  it('preserves the data field from a LegacyA2AError', () => {
    const err = LegacyA2AError.invalidParams('boom', { hint: 'check x' });
    const out = toCompatErrorBody(err);
    expect(out.code).toBe(-32602);
    expect(out.message).toBe('boom');
    expect(out.data).toEqual({ hint: 'check x' });
  });

  v1ToLegacyCodeCases.forEach(([factory, expectedCode]) => {
    const sample = factory();
    it(`maps ${sample.name} to code ${expectedCode}`, () => {
      const out = toCompatErrorBody(factory());
      expect(out.code).toBe(expectedCode);
      expect(out.message).toBe('a');
    });
  });

  it('omits the data field on v1 SDK errors (v0.3 shape compatibility)', () => {
    const out = toCompatErrorBody(new TaskNotFoundError('t'));
    expect(out).not.toHaveProperty('data');
  });

  it('produces a bare body without an outer error wrapper or details array', () => {
    const out = toCompatErrorBody(new TaskNotFoundError('t'));
    const opaque = out as unknown as Record<string, unknown>;
    expect(opaque).not.toHaveProperty('error');
    expect(opaque).not.toHaveProperty('details');
    expect(opaque).not.toHaveProperty('status');
    expect(opaque).not.toHaveProperty('@type');
    expect(opaque).not.toHaveProperty('reason');
    expect(opaque).not.toHaveProperty('domain');
    expect(Object.keys(out).sort()).toEqual(['code', 'message']);
  });

  it('falls back to INTERNAL_ERROR for unknown Error subclasses', () => {
    const out = toCompatErrorBody(new Error('boom'));
    expect(out.code).toBe(-32603);
    expect(out.message).toBe('boom');
    expect(out).not.toHaveProperty('data');
  });

  it('falls back to INTERNAL_ERROR with a generic message for non-Error throws', () => {
    const fromString = toCompatErrorBody('string-thrown');
    expect(fromString.code).toBe(-32603);
    expect(fromString.message).toBe('An unexpected error occurred.');

    const fromObject = toCompatErrorBody({ random: 'object' });
    expect(fromObject.code).toBe(-32603);
    expect(fromObject.message).toBe('An unexpected error occurred.');
  });

  it('falls back to INTERNAL_ERROR with a generic message for null/undefined throws', () => {
    expect(toCompatErrorBody(null).code).toBe(-32603);
    expect(toCompatErrorBody(undefined).code).toBe(-32603);
    expect(toCompatErrorBody(null).message).toBe('An unexpected error occurred.');
  });
});

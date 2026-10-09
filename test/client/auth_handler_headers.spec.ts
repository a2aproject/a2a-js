import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatingFetchWithRetry } from '../../src/client/auth-handler.js';

const headerForms: { name: string; make: (values: Record<string, string>) => HeadersInit }[] = [
  { name: 'plain object', make: (values) => ({ ...values }) },
  { name: 'Headers', make: (values) => new Headers(values) },
  { name: 'tuple array', make: (values) => Object.entries(values) },
];

describe('authenticating fetch HeadersInit support', () => {
  describe.each([401, 403])('retry after HTTP %i', (status) => {
    it.each(headerForms)('preserves $name headers and request body', async ({ make }) => {
      const callerHeaders = make({
        'A2A-Version': '1.0',
        'Content-Type': 'application/json',
        'X-Custom': 'retained',
      });
      const originalHeaders = Array.from(new Headers(callerHeaders));
      const initialHeaders = Object.freeze({ Authorization: 'Bearer initial' });
      const updatedHeaders = Object.freeze({ Authorization: 'Bearer refreshed' });
      const onSuccessfulRetry = vi.fn(async () => {});
      const requests: Request[] = [];
      const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(null, { status: requests.length === 1 ? status : 200 });
      });
      const authenticatedFetch = createAuthenticatingFetchWithRetry(fetchImpl, {
        headers: async () => initialHeaders,
        shouldRetryWithHeaders: async (init) => {
          expect(new Headers(init.headers).get('A2A-Version')).toBe('1.0');
          return updatedHeaders;
        },
        onSuccessfulRetry,
      });

      const response = await authenticatedFetch('https://example.com/agent', {
        method: 'POST',
        headers: callerHeaders,
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(response.status).toBe(200);
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.headers.get('A2A-Version')).toBe('1.0');
        expect(request.headers.get('Content-Type')).toBe('application/json');
        expect(request.headers.get('X-Custom')).toBe('retained');
        expect(request.method).toBe('POST');
        expect(await request.json()).toEqual({ message: 'hello' });
      }
      expect(requests[0].headers.get('Authorization')).toBe('Bearer initial');
      expect(requests[1].headers.get('Authorization')).toBe('Bearer refreshed');
      expect(Array.from(new Headers(callerHeaders))).toEqual(originalHeaders);
      expect(onSuccessfulRetry).toHaveBeenCalledExactlyOnceWith(updatedHeaders);
    });
  });

  it.each(headerForms)(
    'preserves caller precedence for $name regardless of casing',
    async ({ make }) => {
      const callerHeaders = make({ authorization: 'Bearer caller', 'X-Custom': 'caller' });
      const originalHeaders = Array.from(new Headers(callerHeaders));
      const requests: Request[] = [];
      const initialHeaders = Object.freeze({
        Authorization: 'Bearer initial',
        'x-custom': 'initial',
      });
      const updatedHeaders = Object.freeze({
        AUTHORIZATION: 'Bearer refreshed',
        'X-CUSTOM': 'refreshed',
      });
      const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(null, { status: requests.length === 1 ? 401 : 200 });
      });
      const authenticatedFetch = createAuthenticatingFetchWithRetry(fetchImpl, {
        headers: async () => initialHeaders,
        shouldRetryWithHeaders: async () => updatedHeaders,
      });

      await authenticatedFetch('https://example.com/agent', { headers: callerHeaders });

      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(Object.fromEntries(request.headers)).toEqual({
          authorization: 'Bearer caller',
          'x-custom': 'caller',
        });
      }
      expect(Array.from(new Headers(callerHeaders))).toEqual(originalHeaders);
    }
  );
});

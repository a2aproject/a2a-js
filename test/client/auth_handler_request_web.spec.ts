import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatingFetchWithRetry } from '../../src/client/auth-handler.js';

describe('authenticating fetch with Web API Request bodies', () => {
  it.each([401, 403])('replays a consumed Request body after HTTP %i', async (status) => {
    const received: { body: string; authorization: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      received.push({
        body: await request.text(),
        authorization: request.headers.get('Authorization'),
      });
      return new Response(null, { status: received.length === 1 ? status : 200 });
    };
    const onSuccessfulRetry = vi.fn(async () => {});
    const authenticatedFetch = createAuthenticatingFetchWithRetry(fetchImpl, {
      headers: async () => ({ Authorization: 'Bearer initial' }),
      shouldRetryWithHeaders: async () => ({ Authorization: 'Bearer refreshed' }),
      onSuccessfulRetry,
    });
    const request = new Request('https://agent.example/message', {
      method: 'POST',
      body: 'request body',
    });

    const response = await authenticatedFetch(request);

    expect(response.status).toBe(200);
    expect(request.bodyUsed).toBe(true);
    expect(received).toEqual([
      { body: 'request body', authorization: 'Bearer initial' },
      { body: 'request body', authorization: 'Bearer refreshed' },
    ]);
    expect(onSuccessfulRetry).toHaveBeenCalledExactlyOnceWith({
      Authorization: 'Bearer refreshed',
    });
  });
});

import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatingFetchWithRetry } from '../../src/client/auth-handler.js';

describe('authenticating fetch Request body retries', () => {
  let server: Server;
  let url: string;
  let responseStatuses: number[];
  let received: { body: string; authorization?: string; contentType?: string; method?: string }[];

  beforeEach(async () => {
    received = [];
    responseStatuses = [401, 200];
    server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      received.push({
        body,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        method: req.method,
      });
      res.writeHead(responseStatuses[received.length - 1] ?? 500);
      res.end('response');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it.each([401, 403])(
    'replays a POST Request body after HTTP %i using native fetch',
    async (status) => {
      responseStatuses = [status, 200];
      const onSuccessfulRetry = vi.fn(async () => {});
      const authenticatedFetch = createAuthenticatingFetchWithRetry(fetch, {
        headers: async () => ({ Authorization: 'Bearer initial' }),
        shouldRetryWithHeaders: async (_init, response) =>
          response.status === status ? { Authorization: 'Bearer refreshed' } : undefined,
        onSuccessfulRetry,
      });
      const body = JSON.stringify({ message: 'hello' });
      const response = await authenticatedFetch(new Request(url, { method: 'POST', body }), {
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('response');
      expect(received).toEqual([
        { body, authorization: 'Bearer initial', contentType: 'application/json', method: 'POST' },
        {
          body,
          authorization: 'Bearer refreshed',
          contentType: 'application/json',
          method: 'POST',
        },
      ]);
      expect(onSuccessfulRetry).toHaveBeenCalledExactlyOnceWith({
        Authorization: 'Bearer refreshed',
      });
    }
  );

  it.each(['Request', 'RequestInit'])(
    'honors the abort signal from %s before retrying',
    async (source) => {
      const controller = new AbortController();
      const onSuccessfulRetry = vi.fn(async () => {});
      const authenticatedFetch = createAuthenticatingFetchWithRetry(fetch, {
        headers: async () => ({ Authorization: 'Bearer initial' }),
        shouldRetryWithHeaders: async () => {
          controller.abort();
          return { Authorization: 'Bearer refreshed' };
        },
        onSuccessfulRetry,
      });
      const request = new Request(url, {
        method: 'POST',
        body: 'payload',
        ...(source === 'Request' ? { signal: controller.signal } : {}),
      });

      await expect(
        authenticatedFetch(
          request,
          source === 'RequestInit' ? { signal: controller.signal } : undefined
        )
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(received).toHaveLength(1);
      expect(onSuccessfulRetry).not.toHaveBeenCalled();
    }
  );

  it.each(['string', 'URL'])(
    'still retries %s inputs with a body supplied through RequestInit',
    async (type) => {
      const authenticatedFetch = createAuthenticatingFetchWithRetry(fetch, {
        headers: async () => ({ Authorization: 'Bearer initial' }),
        shouldRetryWithHeaders: async () => ({ Authorization: 'Bearer refreshed' }),
      });
      const response = await authenticatedFetch(type === 'URL' ? new URL(url) : url, {
        method: 'POST',
        body: 'payload',
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(received.map(({ body }) => body)).toEqual(['payload', 'payload']);
    }
  );

  it('preserves RequestInit body and method overrides on both attempts', async () => {
    const authenticatedFetch = createAuthenticatingFetchWithRetry(fetch, {
      headers: async () => ({ Authorization: 'Bearer initial' }),
      shouldRetryWithHeaders: async () => ({ Authorization: 'Bearer refreshed' }),
    });
    const response = await authenticatedFetch(
      new Request(url, { method: 'POST', body: 'original' }),
      {
        method: 'PUT',
        body: 'override',
      }
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(received.map(({ body, method }) => ({ body, method }))).toEqual([
      { body: 'override', method: 'PUT' },
      { body: 'override', method: 'PUT' },
    ]);
  });

  it('returns a failed retry without a third attempt or a success notification', async () => {
    responseStatuses = [401, 401];
    const onSuccessfulRetry = vi.fn(async () => {});
    const authenticatedFetch = createAuthenticatingFetchWithRetry(fetch, {
      headers: async () => ({ Authorization: 'Bearer initial' }),
      shouldRetryWithHeaders: async () => ({ Authorization: 'Bearer refreshed' }),
      onSuccessfulRetry,
    });

    const response = await authenticatedFetch(
      new Request(url, { method: 'POST', body: 'payload' })
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('response');
    expect(received.map(({ body }) => body)).toEqual(['payload', 'payload']);
    expect(onSuccessfulRetry).not.toHaveBeenCalled();
  });

  it.each([200, 401])(
    'returns HTTP %i without retrying when the handler declines',
    async (status) => {
      responseStatuses = [status];
      const onSuccessfulRetry = vi.fn(async () => {});
      const authenticatedFetch = createAuthenticatingFetchWithRetry(fetch, {
        headers: async () => ({ Authorization: 'Bearer initial' }),
        shouldRetryWithHeaders: async () => undefined,
        onSuccessfulRetry,
      });
      const request = new Request(url, { method: 'POST', body: 'original body' });

      const response = await authenticatedFetch(request);

      expect(response.status).toBe(status);
      expect(await response.text()).toBe('response');
      expect(received.map(({ body }) => body)).toEqual(['original body']);
      expect(request.bodyUsed).toBe(true);
      expect(onSuccessfulRetry).not.toHaveBeenCalled();
    }
  );
});

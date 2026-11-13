import { describe, expect, it, vi } from 'vitest';
import { RestTransport } from '../../../src/client/transports/rest_transport.js';
import { LegacyRestTransport } from '../../../src/compat/v0_3/client/transports/rest_transport.js';

describe.each([
  ['v1', RestTransport, ''],
  ['v0.3', LegacyRestTransport, '/v1'],
] as const)('REST endpoint URL (%s)', (_version, Transport, prefix) => {
  it('keeps endpoint queries separate from paths and operation queries', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'task',
          contextId: 'context',
          status: { state: 'TASK_STATE_COMPLETED' },
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    const transport = new Transport({
      endpoint: 'https://example.com/agent///?key=a%2Fb&tag=one&tag=two&historyLength=99#ignored',
      fetchImpl,
    });
    await transport.getTask({ id: 'task/a', tenant: '', historyLength: 2 });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/agent${prefix}/tasks/task%2Fa`);
    expect([...url.searchParams]).toEqual([
      ['key', 'a/b'],
      ['tag', 'one'],
      ['tag', 'two'],
      ['historyLength', '2'],
    ]);
    expect(url.hash).toBe('');
  });

  it('preserves endpoint queries for streaming requests', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { headers: { 'Content-Type': 'text/event-stream' } }));
    const transport = new Transport({
      endpoint: 'https://example.com/agent/?key=token/',
      fetchImpl,
    });
    const events = [];
    for await (const event of transport.resubscribeTask({ id: 'task', tenant: '' })) {
      events.push(event);
    }
    expect(events).toEqual([]);
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/agent${prefix}/tasks/task:subscribe`);
    expect(url.searchParams.get('key')).toBe('token/');
  });
});

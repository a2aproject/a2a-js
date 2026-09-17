import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { DefaultAgentCardResolver } from '../../src/client/card-resolver.js';
import { AgentCard } from '../../src/index.js';

describe('DefaultAgentCardResolver', () => {
  let mockFetch: Mock;

  const testAgentCard: AgentCard = {
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    version: '1.0.0',
    supportedInterfaces: [
      {
        url: 'http://localhost:8080',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0.0',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    documentationUrl: 'http://test-agent.com/docs',
    securityRequirements: [],
    securitySchemes: {},
    signatures: [],
    provider: { url: '', organization: '' },
  };

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('should fetch the agent card', async () => {
    const resolver = new DefaultAgentCardResolver({ fetchImpl: mockFetch });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(testAgentCard), {
        status: 200,
      })
    );

    const actual = await resolver.resolve('https://example.com');

    expect(actual).to.deep.equal(testAgentCard);
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        href: 'https://example.com/.well-known/agent-card.json',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'A2A-Version': '1.0' }),
      })
    );
  });

  it('sends A2A-Version: 1.0 header by default (per §3.6.1)', async () => {
    const resolver = new DefaultAgentCardResolver({ fetchImpl: mockFetch });
    mockFetch.mockResolvedValue(new Response(JSON.stringify(testAgentCard), { status: 200 }));

    await resolver.resolve('https://example.com');

    expect(mockFetch).toHaveBeenCalledOnce();
    const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.['A2A-Version']).toBe('1.0');
  });

  it('sends A2A-Version: 1.0 when legacyCompat.enabled is false', async () => {
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: mockFetch,
      legacyCompat: { enabled: false },
    });
    mockFetch.mockResolvedValue(new Response(JSON.stringify(testAgentCard), { status: 200 }));

    await resolver.resolve('https://example.com');

    const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.['A2A-Version']).toBe('1.0');
  });

  it('sends A2A-Version: 1.0 even when legacyCompat.enabled is true (avoids downgrade dance)', async () => {
    // The discovery header is the SDK's native version regardless of
    // legacyCompat: v0.3 detection is response-shape based (see
    // `no downgrade dance` matrix tests below).
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: mockFetch,
      legacyCompat: { enabled: true },
    });
    mockFetch.mockResolvedValue(new Response(JSON.stringify(testAgentCard), { status: 200 }));

    await resolver.resolve('https://example.com');

    const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.['A2A-Version']).toBe('1.0');
  });

  const pathTests = [
    {
      baseUrl: 'https://example.com',
      path: 'a2a/catalog/my-agent-card.json',
      expected: 'https://example.com/a2a/catalog/my-agent-card.json',
    },
    {
      baseUrl: 'https://example.com',
      path: undefined,
      expected: 'https://example.com/.well-known/agent-card.json',
    },
    {
      baseUrl: 'https://example.com/.well-known/agent-card.json',
      path: '',
      expected: 'https://example.com/.well-known/agent-card.json',
    },
  ];

  pathTests.forEach((test) => {
    it(`should use custom path "${test.path}" from config`, async () => {
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: mockFetch,
        path: test.path,
      });
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(testAgentCard), {
          status: 200,
        })
      );

      const actual = await resolver.resolve(test.baseUrl);

      expect(actual).to.deep.equal(testAgentCard);
      expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ href: test.expected }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'A2A-Version': '1.0' }),
        })
      );
    });

    it(`should use custom path "${test.path}" from parameter`, async () => {
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: mockFetch,
      });
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(testAgentCard), {
          status: 200,
        })
      );

      const actual = await resolver.resolve(test.baseUrl, test.path);

      expect(actual).to.deep.equal(testAgentCard);
      expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ href: test.expected }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'A2A-Version': '1.0' }),
        })
      );
    });
  });

  it('should use custom fetch impl', async () => {
    const myFetch = () => {
      return new Promise<Response>((resolve) => {
        resolve(
          new Response(JSON.stringify(testAgentCard), {
            status: 200,
          })
        );
      });
    };
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: myFetch,
      path: 'a2a/catalog/my-agent-card.json',
    });

    const actual = await resolver.resolve('https://example.com');

    expect(actual).to.deep.equal(testAgentCard);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should throw on non-OK response', async () => {
    const resolver = new DefaultAgentCardResolver({ fetchImpl: mockFetch });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(testAgentCard), {
        status: 404,
      })
    );

    try {
      await resolver.resolve('https://example.com');
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).to.include('Failed to fetch Agent Card from https://example.com');
    }
  });

  // Matrix: v1.0+legacyCompat client against the three server flavors.
  // Confirms that the *response shape* (not the request header value)
  // determines which protocol version is used downstream. Together
  // these tests guarantee:
  //   - v1.0 servers (with or without legacyCompat) → v1.0 transport
  //     (no downgrade dance).
  //   - Pure v0.3 legacy servers → v0.3 transport (auto-detected).
  describe('v1.0+legacyCompat client: no downgrade dance matrix', () => {
    // v1.0 card shape: response from either a plain v1.0 server OR a
    // v1.0+legacyCompat server whose legacy router short-circuits on
    // A2A-Version: 1.0 via next('router').
    const v1ServerCard: AgentCard = {
      ...testAgentCard,
      supportedInterfaces: [
        {
          url: 'https://example.com/v1',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '1.0',
        },
      ],
    };

    // v0.3 card shape: response from a pure v0.3 legacy server. The
    // v0.3 spec predates the A2A-Version header so such a server
    // ignores it and returns its v0.3 card regardless.
    const v03ServerCard = {
      name: 'Legacy Agent',
      description: 'A v0.3 server that predates A2A-Version',
      version: '0.3.0',
      url: 'https://example.com/legacy',
      preferredTransport: 'JSONRPC',
      protocolVersion: '0.3',
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [{ id: 's1', name: 'Skill', description: 'desc', tags: [] as string[] }],
    };

    it('v1.0 server → v1.0 transport (passes card through unchanged)', async () => {
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: mockFetch,
        legacyCompat: { enabled: true },
      });
      mockFetch.mockResolvedValue(new Response(JSON.stringify(v1ServerCard), { status: 200 }));

      const card = await resolver.resolve('https://example.com');

      expect(card.supportedInterfaces).to.have.length(1);
      expect(card.supportedInterfaces[0]!.protocolVersion).to.equal('1.0');
    });

    it('v1.0+legacyCompat server → v1.0 transport (same v1.0 card; legacy router short-circuits on A2A-Version: 1.0)', async () => {
      // A v1.0+legacyCompat server seeing A2A-Version: 1.0 returns
      // its native v1.0 card (its legacy agent-card router does
      // next('router') for non-legacy versions). Same wire shape as
      // the plain v1.0 server above.
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: mockFetch,
        legacyCompat: { enabled: true },
      });
      mockFetch.mockResolvedValue(new Response(JSON.stringify(v1ServerCard), { status: 200 }));

      const card = await resolver.resolve('https://example.com');

      expect(card.supportedInterfaces).to.have.length(1);
      expect(card.supportedInterfaces[0]!.protocolVersion).to.equal('1.0');
    });

    it('pure v0.3 server → v0.3 transport (response-shape detection + translation)', async () => {
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: mockFetch,
        legacyCompat: { enabled: true },
      });
      mockFetch.mockResolvedValue(new Response(JSON.stringify(v03ServerCard), { status: 200 }));

      const card = await resolver.resolve('https://example.com');

      // Detected v0.3 shape via isLegacyAgentCard; translated to v1.0
      // internal shape with '0.3' stamped on every interface.
      expect(card.supportedInterfaces).to.have.length(1);
      expect(card.supportedInterfaces[0]!.protocolVersion).to.equal('0.3');
      expect(card.supportedInterfaces[0]!.url).to.equal('https://example.com/legacy');
    });

    it('hybrid card (v0.3 surface + embedded v1.0 supportedInterfaces) → v1.0 transport', async () => {
      // A v1.0+legacyCompat server can answer a header-less card fetch
      // (which would normally be routed to the legacy v0.3 handler)
      // with a "superset" card whose JSON document carries BOTH v0.3
      // top-level fields AND the source v1.0 `supportedInterfaces[]`.
      // The resolver MUST treat the v1.0 shape as authoritative and
      // pass the v1.0 card through unchanged — otherwise it would
      // downgrade every interface to `protocolVersion: '0.3'` and
      // route requests through the compat path for transports the
      // peer may not have v0.3 compat for.
      const hybridCard = {
        ...v03ServerCard,
        url: 'https://example.com/v1',
        preferredTransport: 'JSONRPC',
        additionalInterfaces: [{ url: 'https://example.com/grpc', transport: 'GRPC' }],
        supportedInterfaces: [
          {
            url: 'https://example.com/v1',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
          {
            url: 'https://example.com/grpc',
            protocolBinding: 'GRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
        ],
      };

      const resolver = new DefaultAgentCardResolver({
        fetchImpl: mockFetch,
        legacyCompat: { enabled: true },
      });
      mockFetch.mockResolvedValue(new Response(JSON.stringify(hybridCard), { status: 200 }));

      const card = await resolver.resolve('https://example.com');

      expect(card.supportedInterfaces).to.have.length(2);
      expect(card.supportedInterfaces[0]!.protocolVersion).to.equal('1.0');
      expect(card.supportedInterfaces[0]!.url).to.equal('https://example.com/v1');
      expect(card.supportedInterfaces[1]!.protocolVersion).to.equal('1.0');
      expect(card.supportedInterfaces[1]!.protocolBinding).to.equal('GRPC');
    });
  });
});

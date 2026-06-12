import { describe, expect, it, vi, type Mock } from 'vitest';
import { DefaultAgentCardResolver } from '../../../../src/client/card-resolver.js';
import {
  isLegacyAgentCard,
  parseLegacyAgentCard,
} from '../../../../src/compat/v0_3/client/card-resolver.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

function minimalLegacyCard(): legacy.AgentCard {
  return {
    name: 'Agent',
    description: 'desc',
    version: '1.2.3',
    url: 'https://api.example/a2a',
    preferredTransport: 'JSONRPC',
    protocolVersion: '0.3',
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 's1', name: 'Skill', description: 'desc', tags: [] }],
  };
}

function modernCardJson(): Record<string, unknown> {
  // A v1.0 proto-shaped agent card JSON payload, the same shape used by
  // the existing `DefaultAgentCardResolver.isProtoAgentCard` heuristic
  // for non-legacy payloads.
  return {
    name: 'Modern',
    description: 'desc',
    version: '1.0.0',
    supportedInterfaces: [
      {
        url: 'https://api.example/v1',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    securityRequirements: [],
    securitySchemes: {},
    signatures: [],
    provider: { url: '', organization: '' },
  };
}

describe('isLegacyAgentCard', () => {
  it('returns true for a minimal v0.3 card with `url` and no `supportedInterfaces`', () => {
    expect(isLegacyAgentCard(minimalLegacyCard())).toBe(true);
  });

  it('returns true for a card with `preferredTransport`', () => {
    expect(isLegacyAgentCard({ preferredTransport: 'JSONRPC' })).toBe(true);
  });

  it('returns true for a card with `additionalInterfaces`', () => {
    expect(
      isLegacyAgentCard({
        additionalInterfaces: [{ url: 'https://x', transport: 'GRPC' }],
      })
    ).toBe(true);
  });

  it('returns true for a card with `supportsAuthenticatedExtendedCard`', () => {
    expect(isLegacyAgentCard({ supportsAuthenticatedExtendedCard: true })).toBe(true);
  });

  it('returns true for a card with a legacy-range `protocolVersion`', () => {
    expect(isLegacyAgentCard({ protocolVersion: '0.3' })).toBe(true);
    expect(isLegacyAgentCard({ protocolVersion: '0.3.5' })).toBe(true);
    expect(isLegacyAgentCard({ protocolVersion: '0.9' })).toBe(true);
  });

  it('returns false for a modern v1.0 proto-shaped card', () => {
    expect(isLegacyAgentCard(modernCardJson())).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isLegacyAgentCard(null)).toBe(false);
    expect(isLegacyAgentCard(undefined)).toBe(false);
    expect(isLegacyAgentCard('string')).toBe(false);
    expect(isLegacyAgentCard(42)).toBe(false);
    expect(isLegacyAgentCard([])).toBe(false);
  });

  it('returns false for a `protocolVersion: "1.0"` (non-legacy)', () => {
    expect(isLegacyAgentCard({ protocolVersion: '1.0' })).toBe(false);
  });

  it('returns false for a card that has both `url` and `supportedInterfaces`', () => {
    // A bare `url` alone isn't enough to classify as legacy when the
    // modern `supportedInterfaces` array is also present.
    expect(
      isLegacyAgentCard({
        url: 'https://api.example/a2a',
        supportedInterfaces: [
          {
            url: 'https://api.example/v1',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
        ],
      })
    ).toBe(false);
  });

  it('returns false for a hybrid card (v0.3 fields + non-empty v1.0 supportedInterfaces)', () => {
    // The legacy router can emit a "superset" card via
    // `toCompatAgentCard({ embedV1Interfaces: true })`: it carries
    // BOTH a v0.3 top-level surface AND the original v1.0
    // `supportedInterfaces[]`. When both shapes coexist, the v1.0
    // shape MUST be authoritative — otherwise the resolver would
    // route through `parseLegacyAgentCard` and downgrade every
    // interface to `protocolVersion: '0.3'`, losing the native v1.0
    // stamps that downstream factories rely on.
    expect(
      isLegacyAgentCard({
        name: 'Hybrid',
        url: 'https://api.example/v1',
        preferredTransport: 'JSONRPC',
        protocolVersion: '0.3',
        additionalInterfaces: [{ url: 'https://api.example/grpc', transport: 'GRPC' }],
        supportedInterfaces: [
          {
            url: 'https://api.example/v1',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
          {
            url: 'https://api.example/grpc',
            protocolBinding: 'GRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
        ],
      })
    ).toBe(false);
  });

  it('returns true for a card with an EMPTY `supportedInterfaces` and legacy fields', () => {
    // An empty `supportedInterfaces` array is not a valid v1.0
    // representation; legacy detection should fall through to the
    // v0.3 indicators (here: `preferredTransport`).
    expect(
      isLegacyAgentCard({
        preferredTransport: 'JSONRPC',
        supportedInterfaces: [],
      })
    ).toBe(true);
  });
});

describe('parseLegacyAgentCard', () => {
  it('translates a v0.3 card to a v1.0 proto card', () => {
    const v1 = parseLegacyAgentCard(minimalLegacyCard());
    expect(v1.supportedInterfaces).toHaveLength(1);
    expect(v1.supportedInterfaces[0]!.url).toBe('https://api.example/a2a');
    expect(v1.supportedInterfaces[0]!.protocolBinding).toBe('JSONRPC');
    expect(v1.supportedInterfaces[0]!.protocolVersion).toBe('0.3');
  });

  it('stamps `protocolVersion: "0.3"` on every synthesized interface (primary + additional)', () => {
    const compatCard: legacy.AgentCard = {
      ...minimalLegacyCard(),
      additionalInterfaces: [
        { url: 'https://api.example/grpc', transport: 'GRPC' },
        { url: 'https://api.example/rest', transport: 'HTTP+JSON' },
      ],
    };
    const v1 = parseLegacyAgentCard(compatCard);
    expect(v1.supportedInterfaces).toHaveLength(3);
    for (const intf of v1.supportedInterfaces) {
      expect(intf.protocolVersion).toBe('0.3');
    }
    expect(v1.supportedInterfaces.map((i) => i.protocolBinding)).toEqual([
      'JSONRPC',
      'GRPC',
      'HTTP+JSON',
    ]);
  });
});

describe('DefaultAgentCardResolver with legacyCompat', () => {
  function makeMockFetch(responseBody: unknown): Mock<typeof fetch> {
    const fn = vi.fn();
    fn.mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    return fn as unknown as Mock<typeof fetch>;
  }

  it('translates a v0.3 card to v1.0 shape when legacyCompat is enabled', async () => {
    const mockFetch = makeMockFetch(minimalLegacyCard());
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: mockFetch,
      legacyCompat: { enabled: true },
    });

    const card = await resolver.resolve('https://example.com');

    expect(card.supportedInterfaces).toHaveLength(1);
    expect(card.supportedInterfaces[0]!.protocolVersion).toBe('0.3');
    expect(card.supportedInterfaces[0]!.protocolBinding).toBe('JSONRPC');
    expect(card.supportedInterfaces[0]!.url).toBe('https://api.example/a2a');
  });

  it('translates a v0.3 card with additional interfaces and stamps every interface', async () => {
    const mockFetch = makeMockFetch({
      ...minimalLegacyCard(),
      additionalInterfaces: [{ url: 'https://api.example/grpc', transport: 'GRPC' }],
    });
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: mockFetch,
      legacyCompat: { enabled: true },
    });

    const card = await resolver.resolve('https://example.com');

    expect(card.supportedInterfaces).toHaveLength(2);
    expect(card.supportedInterfaces.every((i) => i.protocolVersion === '0.3')).toBe(true);
  });

  it('leaves a modern v1.0 card unchanged when legacyCompat is enabled', async () => {
    const mockFetch = makeMockFetch(modernCardJson());
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: mockFetch,
      legacyCompat: { enabled: true },
    });

    const card = await resolver.resolve('https://example.com');

    expect(card.supportedInterfaces).toHaveLength(1);
    expect(card.supportedInterfaces[0]!.protocolVersion).toBe('1.0');
    expect(card.supportedInterfaces[0]!.protocolBinding).toBe('JSONRPC');
  });

  it('does NOT translate a v0.3 card when legacyCompat is omitted', async () => {
    const mockFetch = makeMockFetch(minimalLegacyCard());
    const resolver = new DefaultAgentCardResolver({ fetchImpl: mockFetch });

    const card = await resolver.resolve('https://example.com');

    // The existing normalization path doesn't run the v0.3 translator,
    // so `supportedInterfaces` is NOT synthesized.
    expect(card.supportedInterfaces).toBeUndefined();
  });

  it('does NOT translate a v0.3 card when legacyCompat.enabled is false', async () => {
    const mockFetch = makeMockFetch(minimalLegacyCard());
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: mockFetch,
      legacyCompat: { enabled: false },
    });

    const card = await resolver.resolve('https://example.com');

    expect(card.supportedInterfaces).toBeUndefined();
  });

  it('sends A2A-Version: 1.0 on discovery even when legacyCompat.enabled is true', async () => {
    const mockFetch = makeMockFetch(minimalLegacyCard());
    const resolver = new DefaultAgentCardResolver({
      fetchImpl: mockFetch,
      legacyCompat: { enabled: true },
    });

    await resolver.resolve('https://example.com');

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.['A2A-Version']).toBe('1.0');
  });
});

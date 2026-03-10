import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { DefaultAgentCardResolver } from '../../src/client/card-resolver.js';
import { AgentCard } from '../../src/types.js';
import { AgentCard as PBAgentCard } from '../../src/types/pb/a2a_types.js';

describe('DefaultAgentCardResolver', () => {
  let mockFetch: Mock;

  const testAgentCard: AgentCard = {
    protocolVersion: '0.3.0',
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    url: 'http://localhost:8080',
    preferredTransport: 'JSONRPC',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
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
      })
    );
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
        expect.objectContaining({ href: test.expected })
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
        expect.objectContaining({ href: test.expected })
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

  const expectedAgentCard: AgentCard = {
    protocolVersion: '0.3.0',
    name: 'Unified Agent',
    description: '',
    documentationUrl: undefined,
    version: '1.0.0',
    capabilities: {},
    additionalInterfaces: [],
    provider: undefined,
    defaultInputModes: [],
    defaultOutputModes: [],
    supportsAuthenticatedExtendedCard: false,
    signatures: [],
    url: 'https://unified-agent.example.com/a2a/v1',
    preferredTransport: 'GRPC',
    securitySchemes: {
      google: {
        type: 'openIdConnect',
        openIdConnectUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      },
    },
    security: [{ google: ['openid', 'profile', 'email'] }],
    skills: [],
  };

  const JsonSchemaAgentCard: AgentCard = {
    // A JSON Schema shape is essentially identical to the internal format
    ...expectedAgentCard,
  };

  const ProtoAgentCard: PBAgentCard = {
    protocolVersion: '0.3.0',
    name: 'Unified Agent',
    description: '',
    documentationUrl: '',
    version: '1.0.0',
    capabilities: undefined,
    additionalInterfaces: [],
    provider: undefined,
    defaultInputModes: [],
    defaultOutputModes: [],
    supportsAuthenticatedExtendedCard: false,
    signatures: [],
    url: 'https://unified-agent.example.com/a2a/v1',
    preferredTransport: 'GRPC',
    securitySchemes: {
      google: {
        scheme: {
          $case: 'openIdConnectSecurityScheme',
          value: {
            description: '',
            openIdConnectUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          },
        },
      },
    },
    security: [
      {
        schemes: {
          google: { list: ['openid', 'profile', 'email'] },
        },
      },
    ],
    skills: [],
  };

  const expectedAgentCardWithSkill: AgentCard = {
    ...expectedAgentCard,
    security: [],
    securitySchemes: {},
    skills: [
      {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A skill for testing',
        tags: [],
        examples: [],
        inputModes: [],
        outputModes: [],
        security: [{ google: ['openid'] }],
      },
    ],
  };

  const ProtoAgentCardWithSkill: PBAgentCard = {
    ...ProtoAgentCard,
    security: [],
    securitySchemes: {},
    skills: [
      {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A skill for testing',
        tags: [],
        examples: [],
        inputModes: [],
        outputModes: [],
        security: [
          {
            schemes: {
              google: { list: ['openid'] },
            },
          },
        ],
      },
    ],
  };

  it.each([
    ['JSON schema', JsonSchemaAgentCard, expectedAgentCard],
    ['protobuf', PBAgentCard.toJSON(ProtoAgentCard), expectedAgentCard],
    [
      'protobuf (skills only)',
      PBAgentCard.toJSON(ProtoAgentCardWithSkill),
      expectedAgentCardWithSkill,
    ],
  ])('should parse and normalize %s agent card correctly', async (_, payload, expectedResult) => {
    const resolver = new DefaultAgentCardResolver({ fetchImpl: mockFetch });
    mockFetch.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const actual = await resolver.resolve('https://example.com');

    // Both should normalize to the exact same internal AgentCard format
    // Strip undefined properties before comparison using JSON
    const expected = JSON.parse(JSON.stringify(expectedResult));
    const actualClean = JSON.parse(JSON.stringify(actual));

    expect(actualClean).to.deep.equal(expected);
  });
});

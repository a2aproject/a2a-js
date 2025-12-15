import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { DefaultAgentCardResolver } from '../../src/client/card-resolver.js';
import { AgentCard } from '../../src/types.js';

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
});

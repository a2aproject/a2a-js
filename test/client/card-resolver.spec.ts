import { describe, it, beforeEach, expect } from 'vitest';
import { DefaultAgentCardResolver } from '../../src/client/card-resolver.js';
import sinon from 'sinon';
import { AgentCard } from '../../src/types.js';

describe('DefaultAgentCardResolver', () => {
  let mockFetch: sinon.SinonStub;

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
    mockFetch = sinon.stub();
  });

  it('should fetch the agent card', async () => {
    const resolver = new DefaultAgentCardResolver({ fetchImpl: mockFetch });
    mockFetch.resolves(
      new Response(JSON.stringify(testAgentCard), {
        status: 200,
      })
    );

    const actual = await resolver.resolve('https://example.com');

    expect(actual).to.deep.equal(testAgentCard);
    expect(
      mockFetch.calledOnceWith(
        sinon.match.has('href', 'https://example.com/.well-known/agent-card.json')
      )
    ).to.be.true;
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
      mockFetch.resolves(
        new Response(JSON.stringify(testAgentCard), {
          status: 200,
        })
      );

      const actual = await resolver.resolve(test.baseUrl);

      expect(actual).to.deep.equal(testAgentCard);
      expect(mockFetch.calledOnceWithExactly(sinon.match.has('href', test.expected))).to.be.true;
    });

    it(`should use custom path "${test.path}" from parameter`, async () => {
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: mockFetch,
      });
      mockFetch.resolves(
        new Response(JSON.stringify(testAgentCard), {
          status: 200,
        })
      );

      const actual = await resolver.resolve(test.baseUrl, test.path);

      expect(actual).to.deep.equal(testAgentCard);
      expect(mockFetch.calledOnceWith(sinon.match.has('href', test.expected))).to.be.true;
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
    expect(mockFetch.notCalled).to.be.true;
  });

  it('should throw on non-OK response', async () => {
    const resolver = new DefaultAgentCardResolver({ fetchImpl: mockFetch });
    mockFetch.resolves(
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

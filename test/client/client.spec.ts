import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { A2AClient } from '../../src/client/client.js';
import { MessageSendParams, TextPart, SendMessageResponse, SendMessageSuccessResponse } from '../../src/types.js';
import { AGENT_CARD_PATH } from '../../src/constants.js';
import { extractRequestId, createResponse, createAgentCardResponse, createMockAgentCard, createMockFetch } from './util.js';

// Helper function to check if response is a success response
function isSuccessResponse(response: SendMessageResponse): response is SendMessageSuccessResponse {
  return 'result' in response;
}

describe('A2AClient Basic Tests', () => {
  let client: A2AClient;
  let mockFetch: sinon.SinonStub;
  let originalConsoleError: typeof console.error;
  const agentCardUrl = `https://test-agent.example.com/${AGENT_CARD_PATH}`;

  beforeEach(() => {
    // Suppress console.error during tests to avoid noise
    originalConsoleError = console.error;
    console.error = () => {};

    // Create a fresh mock fetch for each test
    mockFetch = createMockFetch();
    client = new A2AClient(agentCardUrl, {
      fetchImpl: mockFetch
    });
  });

  afterEach(() => {
    // Restore console.error
    console.error = originalConsoleError;
    sinon.restore();
  });

  describe('Client Initialization', () => {
    it('should initialize client with default options', () => {
      // Use a mock fetch to avoid real HTTP requests during testing
      const mockFetchForDefault = createMockFetch();
      const basicClient = new A2AClient(agentCardUrl, {
        fetchImpl: mockFetchForDefault
      });
      expect(basicClient).to.be.instanceOf(A2AClient);
    });

    it('should initialize client with custom fetch implementation', () => {
      const customFetch = sinon.stub();
      const clientWithCustomFetch = new A2AClient(agentCardUrl, {
        fetchImpl: customFetch
      });
      expect(clientWithCustomFetch).to.be.instanceOf(A2AClient);
    });

    it('should fetch agent card during initialization', async () => {
      // Wait for agent card to be fetched
      await client.getAgentCard();

      expect(mockFetch.callCount).to.be.greaterThan(0);
      const agentCardCall = mockFetch.getCalls().find(call =>
        call.args[0].includes(AGENT_CARD_PATH)
      );
      expect(agentCardCall).to.exist;
    });
  });

  describe('Agent Card Handling', () => {
    it('should fetch and parse agent card correctly', async () => {
      const agentCard = await client.getAgentCard();

      expect(agentCard).to.have.property('name', 'Test Agent');
      expect(agentCard).to.have.property('description', 'A test agent for basic client testing');
      expect(agentCard).to.have.property('url', 'https://test-agent.example.com/api');
      expect(agentCard).to.have.property('capabilities');
      expect(agentCard.capabilities).to.have.property('streaming', true);
      expect(agentCard.capabilities).to.have.property('pushNotifications', true);
    });

    it('should cache agent card for subsequent requests', async () => {
      // First call
      await client.getAgentCard();

      // Second call - should not fetch agent card again
      await client.getAgentCard();

      const agentCardCalls = mockFetch.getCalls().filter(call =>
        call.args[0].includes(AGENT_CARD_PATH)
      );

      expect(agentCardCalls).to.have.length(1);
    });

    it('should handle agent card fetch errors', async () => {
      const errorFetch = sinon.stub().callsFake(async (url: string) => {
        if (url.includes(AGENT_CARD_PATH)) {
          return new Response('Not found', { status: 404 });
        }
        return new Response('Not found', { status: 404 });
      });

      // Create client after setting up the mock to avoid console.error during construction
      const errorClient = new A2AClient(agentCardUrl, {
        fetchImpl: errorFetch
      });

      try {
        await errorClient.getAgentCard();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Failed to fetch Agent Card');
      }
    });
  });

  describe('Message Sending', () => {
    it('should send message successfully', async () => {
      const messageParams: MessageSendParams = {
        message: {
          kind: 'message',
          messageId: 'test-msg-1',
          role: 'user',
          parts: [{
            kind: 'text',
            text: 'Hello, agent!'
          } as TextPart]
        }
      };

      const result = await client.sendMessage(messageParams);

      // Verify fetch was called
      expect(mockFetch.callCount).to.be.greaterThan(0);

      // Verify RPC call was made
      const rpcCall = mockFetch.getCalls().find(call =>
        call.args[0].includes('/api')
      );
      expect(rpcCall).to.exist;
      expect(rpcCall.args[1]).to.deep.include({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      expect(rpcCall.args[1].body).to.include('"method":"message/send"');

      // Verify the result
      expect(isSuccessResponse(result)).to.be.true;
      if (isSuccessResponse(result)) {
        expect(result.result).to.have.property('kind', 'message');
        expect(result.result).to.have.property('messageId', 'msg-123');
      }
    });

    it('should handle message sending errors', async () => {
      const errorFetch = sinon.stub().callsFake(async (url: string, options?: RequestInit) => {
        if (url.includes(AGENT_CARD_PATH)) {
          const mockAgentCard = createMockAgentCard({
            description: 'A test agent for error testing'
          });
          return createAgentCardResponse(mockAgentCard);
        }

        if (url.includes('/api')) {
          // Extract request ID from the request body
          const requestId = extractRequestId(options);

          return createResponse(requestId, undefined, {
            code: -32603,
            message: 'Internal error'
          }, 500);
        }

        return new Response('Not found', { status: 404 });
      });

      const errorClient = new A2AClient(agentCardUrl, {
        fetchImpl: errorFetch
      });

      const messageParams: MessageSendParams = {
        message: {
          kind: 'message',
          messageId: 'test-msg-error',
          role: 'user',
          parts: [{
            kind: 'text',
            text: 'This should fail'
          } as TextPart]
        }
      };

      try {
        await errorClient.sendMessage(messageParams);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const networkErrorFetch = sinon.stub().rejects(new Error('Network error'));

      const networkErrorClient = new A2AClient(agentCardUrl, {
        fetchImpl: networkErrorFetch
      });

      try {
        await networkErrorClient.getAgentCard();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Network error');
      }
    });

    it('should handle malformed JSON responses', async () => {
      const malformedFetch = sinon.stub().callsFake(async (url: string) => {
        if (url.includes(AGENT_CARD_PATH)) {
          return new Response('Invalid JSON', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('Not found', { status: 404 });
      });

      const malformedClient = new A2AClient(agentCardUrl, {
        fetchImpl: malformedFetch
      });

      try {
        await malformedClient.getAgentCard();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
      }
    });

    it('should handle missing agent card URL', async () => {
      const missingUrlFetch = sinon.stub().callsFake(async (url: string) => {
        if (url.includes(AGENT_CARD_PATH)) {
          const invalidAgentCard = {
            name: 'Test Agent',
            description: 'A test agent without URL',
            protocolVersion: '1.0.0',
            version: '1.0.0',
            // Missing url field
            defaultInputModes: ['text'],
            defaultOutputModes: ['text'],
            capabilities: {
              streaming: true,
              pushNotifications: true
            },
            skills: []
          };
          return createAgentCardResponse(invalidAgentCard);
        }
        return new Response('Not found', { status: 404 });
      });

      const missingUrlClient = new A2AClient(agentCardUrl, {
        fetchImpl: missingUrlFetch
      });

      try {
        await missingUrlClient.getAgentCard();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include("does not contain a valid 'url'");
      }
    });
  });
});

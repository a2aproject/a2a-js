import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { A2AClient } from '../../src/client/client.js';
import {
  MessageSendParams,
  TextPart,
  SendMessageResponse,
  SendMessageSuccessResponse,
  ListTaskPushNotificationConfigResponse,
  ListTaskPushNotificationConfigSuccessResponse,
  DeleteTaskPushNotificationConfigResponse,
  DeleteTaskPushNotificationConfigSuccessResponse,
  JSONRPCErrorResponse,
  JSONRPCResponse,
} from '../../src/types.js';
import { AGENT_CARD_PATH } from '../../src/constants.js';
import { extractRequestId, createResponse, createAgentCardResponse, createMockAgentCard, createMockFetch } from './util.js';

// Helper functions to check if responses are success responses
function isSuccessResponse(response: SendMessageResponse): response is SendMessageSuccessResponse {
  return 'result' in response;
}

function isListConfigSuccessResponse(response: ListTaskPushNotificationConfigResponse): response is ListTaskPushNotificationConfigSuccessResponse {
  return 'result' in response;
}

function isDeleteConfigSuccessResponse(response: DeleteTaskPushNotificationConfigResponse): response is DeleteTaskPushNotificationConfigSuccessResponse {
  return 'result' in response;
}

function isErrorResponse(response: any): response is JSONRPCErrorResponse {
  return 'error' in response;
}

describe('A2AClient Basic Tests', () => {
  let client: A2AClient;
  let mockFetch: sinon.SinonStub;
  let originalConsoleError: typeof console.error;
  const agentCardUrl = `https://test-agent.example.com/${AGENT_CARD_PATH}`;
  const agentBaseUrl = 'https://test-agent.example.com';

  beforeEach(async () => {
    // Suppress console.error during tests to avoid noise
    originalConsoleError = console.error;
    console.error = () => {};

    // Create a fresh mock fetch for each test
    mockFetch = createMockFetch();
    client = await A2AClient.fromCardUrl(agentCardUrl, {
      fetchImpl: mockFetch
    });
  });

  afterEach(() => {
    // Restore console.error
    console.error = originalConsoleError;
    sinon.restore();
  });

  describe('Client Initialization', () => {
    it('should initialize client with default options', async () => {
      // Use a mock fetch to avoid real HTTP requests during testing
      const mockFetchForDefault = createMockFetch();
      const basicClient = await A2AClient.fromCardUrl(agentCardUrl, {
        fetchImpl: mockFetchForDefault
      });
      expect(basicClient).to.be.instanceOf(A2AClient);
    });

    it('should initialize client with custom fetch implementation', async () => {
      const customFetch = sinon.stub().resolves(new Response(JSON.stringify(createMockAgentCard()), { status: 200 }));
      const clientWithCustomFetch = await A2AClient.fromCardUrl(agentCardUrl, {
        fetchImpl: customFetch
      });
      expect(clientWithCustomFetch).to.be.instanceOf(A2AClient);
    });

    it('should throw an error if no fetch implementation is available', async () => {
      const originalFetch = global.fetch;
      const expectedErrorMsg =
        'A `fetch` implementation was not provided and is not available in the global scope. ' +
        'Please provide a `fetchImpl` in the A2AClientOptions. ' +
        'For earlier Node.js versions (pre-v18), you can use a library like `node-fetch`.';

      let caughtError: Error | undefined;
      try {
        // Arrange: Ensure no global fetch is defined for this test
        global.fetch = undefined;

        // Act: Instantiate the client without providing a custom fetch implementation.
        // The constructor kicks off an async operation that will fail.
        const clientWithoutFetch = new A2AClient('https://test-agent.example.com');
        // Assert: Check that any method relying on the agent card fetch rejects with the expected error.
        await clientWithoutFetch.getAgentCard();
        expect.fail('Expected an error to be thrown but it was not.');
      } catch (error) {
        caughtError = error as Error;
      } finally {
        // Cleanup to not affect other tests
        global.fetch = originalFetch;
      }
      expect(caughtError).to.be.instanceOf(Error);
      expect(caughtError?.message).to.equal(expectedErrorMsg);
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

  describe('Backward Compatibility', () => {
    it('should construct with a URL and log a warning', async () => {
      const consoleWarnSpy = sinon.spy(console, 'warn');
      const backwardCompatibleClient = new A2AClient(agentBaseUrl, {
        fetchImpl: mockFetch
      });

      expect(consoleWarnSpy.calledOnce).to.be.true;
      expect(consoleWarnSpy.calledWith("Warning: Constructing A2AClient with a URL is deprecated. Please use A2AClient.fromCardUrl() instead.")).to.be.true;

      const agentCard = await backwardCompatibleClient.getAgentCard();
      expect(agentCard).to.have.property('name', 'Test Agent');

      consoleWarnSpy.restore();
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
      try {
        await A2AClient.fromCardUrl(agentCardUrl, {
          fetchImpl: errorFetch
        });
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

      const errorClient = await A2AClient.fromCardUrl(agentCardUrl, {
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

      try {
        await A2AClient.fromCardUrl(agentCardUrl, {
          fetchImpl: networkErrorFetch
        });
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

      try {
        await A2AClient.fromCardUrl(agentCardUrl, {
          fetchImpl: malformedFetch
        });
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

      try {
        await A2AClient.fromCardUrl(agentCardUrl, {
          fetchImpl: missingUrlFetch
        });
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include("does not contain a valid 'url'");
      }
    });
  });

  describe('Static Methods', () => {
    it('should create a client from an agent card using the constructor', async () => {
      const mockAgentCard = createMockAgentCard({
        name: 'Static Agent',
        description: 'An agent created from a static method',
        url: 'https://static-agent.example.com/api'
      });
      const mockFetchForStatic = createMockFetch();

      const clientFromCard = new A2AClient(mockAgentCard, {
        fetchImpl: mockFetchForStatic
      });

      expect(clientFromCard).to.be.instanceOf(A2AClient);

      // Getting the card should return the provided card without a fetch call
      const agentCard = await clientFromCard.getAgentCard();
      expect(agentCard).to.deep.equal(mockAgentCard);
      expect(mockFetchForStatic.called).to.be.false;

      // Test sending a message to ensure serviceEndpointUrl is set
      const messageParams: MessageSendParams = {
        message: {
          kind: 'message',
          messageId: 'test-msg-static',
          role: 'user',
          parts: [{
            kind: 'text',
            text: 'Hello, static agent!'
          } as TextPart]
        }
      };

      const result = await clientFromCard.sendMessage(messageParams);

      // Verify fetch was called for the RPC request
      expect(mockFetchForStatic.calledOnce).to.be.true;
      const rpcCall = mockFetchForStatic.getCall(0);
      expect(rpcCall.args[0]).to.equal('https://static-agent.example.com/api');
      expect(isSuccessResponse(result)).to.be.true;
    });

    it('should throw an error if agent card is missing url in constructor', () => {
        const mockAgentCard = {
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
        expect(() => new A2AClient(mockAgentCard as any)).to.throw("Provided Agent Card does not contain a valid 'url' for the service endpoint.");
    });
  });
});

describe('Extension Methods', () => {
  let mockFetch: sinon.SinonStub;
  let originalConsoleError: typeof console.error;
  const agentCardUrl = `https://test-agent.example.com/${AGENT_CARD_PATH}`;

  beforeEach(async () => {
    // Suppress console.error during tests to avoid noise
    originalConsoleError = console.error;
    console.error = () => {};

    // Create a fresh mock fetch for each test
    mockFetch = createMockFetch();
    await A2AClient.fromCardUrl(agentCardUrl, {
      fetchImpl: mockFetch
    });
  });

  afterEach(() => {
    // Restore console.error
    console.error = originalConsoleError;
    sinon.restore();
  });

  describe('callExtensionMethod', () => {
    it('should call a custom extension method successfully', async () => {
      // Define a custom extension method name
      const extensionMethod = 'custom/extension/method';
      
      // Define custom params for the extension method
      interface CustomExtensionParams {
        query: string;
        limit: number;
      }
      
      // Set up custom params for the test
      const customParams: CustomExtensionParams = {
        query: 'test query',
        limit: 5
      };
      
      // Create expected response data
      const expectedResult = {
        items: [
          { id: '1', name: 'Item 1' },
          { id: '2', name: 'Item 2' },
          { id: '3', name: 'Item 3' }
        ],
        totalCount: 3
      };
      
      // Setup custom fetch mock for this specific test
      const customFetch = sinon.stub().callsFake(async (url: string, options?: RequestInit) => {
        if (url.includes(AGENT_CARD_PATH)) {
          return createAgentCardResponse(createMockAgentCard());
        }
        
        if (url.includes('/api')) {
          const requestId = extractRequestId(options);
          const requestBody = JSON.parse(options?.body as string);
          
          // Verify the request was made correctly
          expect(requestBody.method).to.equal(extensionMethod);
          expect(requestBody.params).to.deep.equal(customParams);
          
          // Return the expected result
          return createResponse(requestId, expectedResult);
        }
        
        return new Response('Not found', { status: 404 });
      });
      
      // Create a client with our custom fetch
      const extensionClient = new A2AClient('https://test-agent.example.com', {
        fetchImpl: customFetch
      });
      
      // Call the extension method
      const response = await extensionClient.callExtensionMethod<
        CustomExtensionParams,
        JSONRPCResponse
      >(extensionMethod, customParams);
      
      expect(response).to.have.property('result');
      
      // Check if we got a success response
      if ('result' in response) {
        const expectedResponseResult = {
          items: [
            { id: '1', name: 'Item 1' },
            { id: '2', name: 'Item 2' },
            { id: '3', name: 'Item 3' }
          ],
          totalCount: 3
        };
        
        expect(response.result).to.deep.equal(expectedResponseResult);
      } else {
        expect.fail('Expected success response but got error response');
      }
    });
    
    it('should handle errors from extension methods', async () => {
      // Define a custom extension method name
      const extensionMethod = 'custom/failing/method';
      
      // Define custom params for the extension method
      const customParams = {
        invalid: true
      };
      
      // Setup custom fetch mock for this specific test
      const errorFetch = sinon.stub().callsFake(async (url: string, options?: RequestInit) => {
        if (url.includes(AGENT_CARD_PATH)) {
          return createAgentCardResponse(createMockAgentCard());
        }
        
        if (url.includes('/api')) {
          const requestId = extractRequestId(options);
          
          // Return an error response
          return createResponse(requestId, undefined, {
            code: -32603,
            message: 'Extension method error: Invalid parameters'
          }, 500);
        }
        
        return new Response('Not found', { status: 404 });
      });
      
      // Create a client with our error fetch
      const errorClient = new A2AClient('https://test-agent.example.com', {
        fetchImpl: errorFetch
      });
      
      // Define the error we expect to get from the server
      const expectedError = {
        code: -32603,
        message: 'Extension method error: Invalid parameters'
      };
      
      const response = await errorClient.callExtensionMethod(extensionMethod, customParams);
      
      // Check that we got a JSON-RPC error response
      expect(isErrorResponse(response)).to.be.true;
      if (isErrorResponse(response)) {
        // Verify the error details match what we expect
        expect(response.error.code).to.equal(expectedError.code);
        expect(response.error.message).to.equal(expectedError.message);
      } else {
        expect.fail('Expected JSON-RPC error response but got success response');
      }
    });
  });
});

describe('Push Notification Config Operations', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    // Suppress console.error during tests to avoid noise
    originalConsoleError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    // Restore console.error
    console.error = originalConsoleError;
    sinon.restore();
  });

  describe('listTaskPushNotificationConfig', () => {
    it('should list push notification configurations successfully', async () => {
      // Define mock params
      const params = {
        id: 'test-task-123'
      };

      // Define mock response data for the push notification configs
      const mockConfigsData = [
        {
          id: 'config-1',
          url: 'https://notify1.example.com/webhook',
          token: 'token-1'
        },
        {
          id: 'config-2',
          url: 'https://notify2.example.com/webhook',
          token: 'token-2'
        }
      ];

      // Setup custom mock fetch for this specific test
      const customFetch = sinon.stub().callsFake(async (url: string, options?: RequestInit) => {
        if (url.includes(AGENT_CARD_PATH)) {
          const mockAgentCard = createMockAgentCard({
            capabilities: { pushNotifications: true }
          });
          return createAgentCardResponse(mockAgentCard);
        }
        
        if (url.includes('/api')) {
          const requestId = extractRequestId(options);
          
          // Check if the request is for the list operation
          const body = JSON.parse(options?.body as string);
          if (body.method === 'tasks/pushNotificationConfig/list') {
            // Verify the params were sent correctly
            expect(body.params).to.deep.equal(params);
            
            // Return a successful response with mock configs
            // The result is an array of TaskPushNotificationConfig objects
            const configs = mockConfigsData.map(config => ({
              taskId: params.id,
              pushNotificationConfig: config
            }));
            return createResponse(requestId, configs);
          }
        }
        
        return new Response('Not found', { status: 404 });
      });

      // Use the custom fetch implementation for this test
      const testClient = new A2AClient('https://test-agent.example.com', {
        fetchImpl: customFetch
      });

      // Call the method and verify the result
      const result = await testClient.listTaskPushNotificationConfig(params);
      
      // Verify the result is a success response
      expect(isListConfigSuccessResponse(result)).to.be.true;
      if (isListConfigSuccessResponse(result)) {
        // Define expected result structure
        const expectedConfigs = [
          {
            taskId: params.id,
            pushNotificationConfig: {
              id: 'config-1',
              url: 'https://notify1.example.com/webhook',
              token: 'token-1'
            }
          },
          {
            taskId: params.id,
            pushNotificationConfig: {
              id: 'config-2',
              url: 'https://notify2.example.com/webhook',
              token: 'token-2'
            }
          }
        ];
        
        // Use deep.equal for more readable assertion
        expect(result.result).to.deep.equal(expectedConfigs);
      }
    });
  });

  describe('deleteTaskPushNotificationConfig', () => {
    it('should delete push notification configuration successfully', async () => {
      // Define mock params
      const params = {
        id: 'test-task-123',
        pushNotificationConfigId: 'config-to-delete'
      };

      // Setup custom mock fetch for this specific test
      const customFetch = sinon.stub().callsFake(async (url: string, options?: RequestInit) => {
        if (url.includes(AGENT_CARD_PATH)) {
          const mockAgentCard = createMockAgentCard({
            capabilities: { pushNotifications: true }
          });
          return createAgentCardResponse(mockAgentCard);
        }
        
        if (url.includes('/api')) {
          const requestId = extractRequestId(options);
          
          // Check if the request is for the delete operation
          const body = JSON.parse(options?.body as string);
          if (body.method === 'tasks/pushNotificationConfig/delete') {
            // Verify the params were sent correctly
            expect(body.params).to.deep.equal(params);
            
            // Return a successful response,
            // 'result' should just be 'null' according to the spec:
            // https://a2a-protocol.org/latest/specification/#79-taskspushnotificationconfigdelete
            return createResponse(requestId, null);
          }
        }
        
        return new Response('Not found', { status: 404 });
      });

      // Use the custom fetch implementation for this test
      const testClient = new A2AClient('https://test-agent.example.com', {
        fetchImpl: customFetch
      });

      // Call the method and verify the result
      const result = await testClient.deleteTaskPushNotificationConfig(params);
      
      // Verify the result is a success response
      expect(isDeleteConfigSuccessResponse(result)).to.be.true;
      if (isDeleteConfigSuccessResponse(result)) {
        expect(result.result).to.be.null;
      }
    });
  });
});

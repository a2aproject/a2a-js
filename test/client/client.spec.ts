import 'mocha';
import { assert, expect } from 'chai';
import sinon, { SinonStub } from 'sinon';

// Import directly from client.ts instead of index.js to avoid build issues
import { A2AClient, HttpClient, DefaultHttpClient } from '../../src/client/client.js';
import { AgentCard, MessageSendParams, SendMessageResponse } from '../../src/index.js';

describe('A2AClient with HttpClient', () => {
  let mockResponse: Response;
  let mockAgentCard: AgentCard;
  
  beforeEach(() => {
    // Create a mock agent card
    mockAgentCard = {
      name: 'Test Agent',
      description: 'An agent for testing purposes',
      url: 'http://localhost:8080/rpc',
      version: '1.0.0',
      protocolVersion: '0.3.0',
      capabilities: {
        streaming: true,
        pushNotifications: true,
      },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [
        {
          id: 'test-skill',
          name: 'Test Skill',
          description: 'A skill for testing',
          tags: ['test'],
        },
      ],
    };
    
    // Create a mock response
    mockResponse = new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          kind: 'message',
          messageId: 'response-1',
          role: 'agent',
          parts: [{ kind: 'text', text: 'Hello from the agent!' }],
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  });
  
  afterEach(() => {
    sinon.restore();
  });
  
  it('should use the default HttpClient when none is provided', async () => {
    // Stub the global fetch function
    const fetchStub = sinon.stub(global, 'fetch').resolves(
      new Response(
        JSON.stringify(mockAgentCard),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
    
    const client = new A2AClient('http://localhost:8080');
    
    // Wait for the agent card to be fetched
    await client.getAgentCard();
    
    // Verify that fetch was called with the expected URL
    assert.isTrue(fetchStub.calledOnce);
    assert.equal(fetchStub.firstCall.args[0], 'http://localhost:8080/.well-known/agent-card.json');
  });
  
  it('should use the provided custom HttpClient', async () => {
    // Create a mock HttpClient
    const mockHttpClient: HttpClient = {
      sendRequest: sinon.stub().resolves(
        new Response(
          JSON.stringify(mockAgentCard),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )
      ),
    };
    
    const client = new A2AClient('http://localhost:8080', { httpClient: mockHttpClient } );
    
    // Wait for the agent card to be fetched
    await client.getAgentCard();
    
    // Verify that the custom HttpClient was used
    assert.isTrue((mockHttpClient.sendRequest as SinonStub).calledOnce);
    assert.equal((mockHttpClient.sendRequest as SinonStub).firstCall.args[0], 'http://localhost:8080/.well-known/agent-card.json');
  });
  
  it('should use the custom HttpClient for all HTTP requests', async () => {
    // Create a mock HttpClient
    const mockHttpClient: HttpClient = {
      sendRequest: sinon.stub().resolves(mockResponse),
    };
    
    // First response is for the agent card fetch
    (mockHttpClient.sendRequest as SinonStub).onFirstCall().resolves(
      new Response(
        JSON.stringify(mockAgentCard),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
    
    const client = new A2AClient('http://localhost:8080', { httpClient: mockHttpClient });
    
    // Wait for the agent card to be fetched
    await client.getAgentCard();
    
    // Send a message
    const params: MessageSendParams = {
      message: {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello!' }],
        kind: 'message',
      },
    };
    
    await client.sendMessage(params);
    
    // Verify that the custom HttpClient was used for both requests
    assert.isTrue((mockHttpClient.sendRequest as SinonStub).calledTwice);
    assert.equal((mockHttpClient.sendRequest as SinonStub).firstCall.args[0], 'http://localhost:8080/.well-known/agent-card.json');
    assert.equal((mockHttpClient.sendRequest as SinonStub).secondCall.args[0], 'http://localhost:8080/rpc');
  });
  
  it('should allow adding custom headers via a custom HttpClient', async () => {
    // Create a custom HttpClient that adds an authorization header
    class AuthHttpClient implements HttpClient {
      private authToken: string;
      
      constructor(authToken: string) {
        this.authToken = authToken;
      }
      
      async sendRequest(url: string, options?: RequestInit): Promise<Response> {
        // Add authorization header to all requests
        const headers = {
          ...options.headers,
          'Authorization': `Bearer ${this.authToken}`
        };
        
        // Create a new options object with the updated headers
        const updatedOptions = {
          ...options,
          headers
        };
        
        // For testing, just return a mock response
        if (url.includes('agent-card')) {
          return new Response(
            JSON.stringify(mockAgentCard),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );
        }
        
        // Store the options for inspection in tests
        (this.sendRequest as any).lastOptions = updatedOptions;
        
        return mockResponse;
      }
    }
    
    // Create a spy to inspect the headers
    const sendRequestSpy = sinon.spy(AuthHttpClient.prototype, 'sendRequest');
    
    const customAuthClient = new AuthHttpClient('test-token');
    const client = new A2AClient('http://localhost:8080', { httpClient: customAuthClient });
    
    // Wait for the agent card to be fetched
    await client.getAgentCard();
    
    // Send a message
    const params: MessageSendParams = {
      message: {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello!' }],
        kind: 'message',
      },
    };
    
    await client.sendMessage(params);
    
    // Verify that the authorization header was added to both requests
    assert.isTrue(sendRequestSpy.calledTwice);
    
    // Access the last options directly from the spy
    const injectedAuthClient = client['httpClient'] as AuthHttpClient;
    const lastOptions = (injectedAuthClient.sendRequest as any).lastOptions;
    
    // Verify the Authorization header was added
    assert.equal(lastOptions.headers['Authorization'], 'Bearer test-token');
  });
  
  it('should handle streaming requests with a custom HttpClient', async () => {
    // Create a mock HttpClient for streaming
    const mockHttpClient: HttpClient = {
      sendRequest: sinon.stub(),
    };
    
    // First response is for the agent card fetch
    (mockHttpClient.sendRequest as SinonStub).onFirstCall().resolves(
      new Response(
        JSON.stringify({
          ...mockAgentCard,
          capabilities: {
            ...mockAgentCard.capabilities,
            streaming: true,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
    
    // Second response is for the streaming request
    const mockReadable = new ReadableStream({
      start(controller) {
        // Send SSE events
        const encoder = new TextEncoder();
        
        // Task event
        controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task","id":"task-1","contextId":"ctx-1","status":{"state":"submitted"}}}\n\n'));
        
        // Status update event
        controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-1","contextId":"ctx-1","status":{"state":"working"},"final":false}}\n\n'));
        
        // Final status update event
        controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-1","contextId":"ctx-1","status":{"state":"completed"},"final":true}}\n\n'));
        
        controller.close();
      }
    });
    
    (mockHttpClient.sendRequest as SinonStub).onSecondCall().resolves(
      new Response(mockReadable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      })
    );
    
    const client = new A2AClient('http://localhost:8080', { httpClient: mockHttpClient });
    
    // Wait for the agent card to be fetched
    await client.getAgentCard();
    
    // Send a streaming message
    const params: MessageSendParams = {
      message: {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello!' }],
        kind: 'message',
      },
    };
    
    const events = [];
    for await (const event of client.sendMessageStream(params)) {
      events.push(event);
    }
    
    // Verify that the custom HttpClient was used for both requests
    assert.isTrue((mockHttpClient.sendRequest as SinonStub).calledTwice);
    
    // Verify that we received the expected events
    assert.equal(events.length, 3);
    assert.equal(events[0].kind, 'task');
    assert.equal(events[1].kind, 'status-update');
    assert.equal(events[2].kind, 'status-update');
    assert.isTrue(events[2].final);
  });
  
  it('DefaultHttpClient should use fetch API', async () => {
    // Stub the global fetch function
    const fetchStub = sinon.stub(global, 'fetch').resolves(mockResponse);
    
    const defaultClient = new DefaultHttpClient();
    
    await defaultClient.sendRequest('http://example.com', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    
    // Verify that fetch was called with the expected arguments
    assert.isTrue(fetchStub.calledOnce);
    assert.equal(fetchStub.firstCall.args[0], 'http://example.com');
    assert.deepEqual(fetchStub.firstCall.args[1], {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
  });
});
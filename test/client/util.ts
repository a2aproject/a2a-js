/**
 * Utility functions for A2A client tests
 */

import sinon from 'sinon';
import { AGENT_CARD_PATH } from '../../src/constants.js';

/**
 * Extracts the request ID from a RequestInit options object.
 * Parses the JSON body and returns the 'id' field, or 1 as default.
 *
 * @param options - The RequestInit options object containing the request body
 * @returns The request ID as a number, defaults to 1 if not found or parsing fails
 */
export function extractRequestId(options?: RequestInit): number {
  if (!options?.body) {
    return 1;
  }

  try {
    const requestBody = JSON.parse(options.body as string);
    return requestBody.id || 1;
  } catch {
    // If parsing fails, use default ID
    return 1;
  }
}

/**
 * Factory function to create fresh Response objects for agent card endpoints.
 * Agent cards are returned as raw JSON, not JSON-RPC responses.
 *
 * @param data - The agent card data to include in the response
 * @param status - HTTP status code (defaults to 200)
 * @param headers - Additional headers to include in the response
 * @returns A fresh Response object with the specified data
 */
export function createAgentCardResponse(
  data: any,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const responseHeaders = { ...defaultHeaders, ...headers };

  // Create a fresh body each time to avoid "Body is unusable" errors
  const body = JSON.stringify(data);

  return new Response(body, {
    status,
    headers: responseHeaders,
  });
}

/**
 * Factory function to create fresh Response objects that can be read multiple times.
 * Creates a proper JSON-RPC 2.0 response structure.
 *
 * @param id - The response ID (used for JSON-RPC responses)
 * @param result - The result data to include in the response (for success responses)
 * @param error - Optional error object for error responses (mutually exclusive with result)
 * @param status - HTTP status code (defaults to 200 for success, 500 for errors)
 * @param headers - Additional headers to include in the response
 * @returns A fresh Response object with the specified data
 */
export function createResponse(
  id: number,
  result?: any,
  error?: { code: number; message: string; data?: any },
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const responseHeaders = { ...defaultHeaders, ...headers };

  // Construct the JSON-RPC response structure
  const jsonRpcResponse: any = {
    jsonrpc: '2.0',
    id: id,
  };

  // Add either result or error (mutually exclusive)
  if (error) {
    jsonRpcResponse.error = error;
    // Use provided status or default to 500 for errors
    status = status !== 200 ? status : 500;
  } else {
    jsonRpcResponse.result = result;
  }

  return new Response(JSON.stringify(jsonRpcResponse), {
    status,
    headers: responseHeaders,
  });
}

/**
 * Factory function to create mock agent cards for testing.
 *
 * @param options - Configuration options for the mock agent card
 * @param options.name - Agent name (defaults to 'Test Agent')
 * @param options.description - Agent description (defaults to 'A test agent for testing')
 * @param options.url - Service endpoint URL (defaults to 'https://test-agent.example.com/api')
 * @param options.protocolVersion - Protocol version (defaults to '1.0.0')
 * @param options.version - Agent version (defaults to '1.0.0')
 * @param options.defaultInputModes - Default input modes (defaults to ['text'])
 * @param options.defaultOutputModes - Default output modes (defaults to ['text'])
 * @param options.capabilities - Agent capabilities (defaults to { streaming: true, pushNotifications: true })
 * @param options.skills - Agent skills (defaults to [])
 * @returns A mock AgentCard object
 */
export function createMockAgentCard(
  options: {
    name?: string;
    description?: string;
    url?: string;
    protocolVersion?: string;
    version?: string;
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    capabilities?: {
      streaming?: boolean;
      pushNotifications?: boolean;
    };
    skills?: any[];
  } = {}
): any {
  return {
    name: options.name ?? 'Test Agent',
    description: options.description ?? 'A test agent for testing',
    protocolVersion: options.protocolVersion ?? '1.0.0',
    version: options.version ?? '1.0.0',
    url: options.url ?? 'https://test-agent.example.com/api',
    defaultInputModes: options.defaultInputModes ?? ['text'],
    defaultOutputModes: options.defaultOutputModes ?? ['text'],
    capabilities: {
      streaming: options.capabilities?.streaming ?? true,
      pushNotifications: options.capabilities?.pushNotifications ?? true,
      ...options.capabilities,
    },
    skills: options.skills ?? [],
  };
}

/**
 * Factory function to create common message parameters for testing.
 * Creates a MessageSendParams object with a text message that can be used
 * across multiple test scenarios.
 *
 * @param options - Configuration options for the message parameters
 * @param options.messageId - Message ID (defaults to 'test-msg')
 * @param options.text - Message text content (defaults to 'Hello, agent!')
 * @param options.role - Message role (defaults to 'user')
 * @returns A MessageSendParams object with the specified configuration
 */
export function createMessageParams(
  options: {
    messageId?: string;
    text?: string;
    role?: 'user' | 'assistant';
  } = {}
): any {
  const messageId = options.messageId ?? 'test-msg';
  const text = options.text ?? 'Hello, agent!';
  const role = options.role ?? 'user';

  return {
    message: {
      kind: 'message',
      messageId: messageId,
      role: role,
      parts: [
        {
          kind: 'text',
          text: text,
        },
      ],
    },
  };
}

/**
 * Factory function to create common mock message objects for testing.
 * Creates a Message object with text content that can be used
 * across multiple test scenarios.
 *
 * @param options - Configuration options for the mock message
 * @param options.messageId - Message ID (defaults to 'msg-123')
 * @param options.text - Message text content (defaults to 'Hello, agent!')
 * @param options.role - Message role (defaults to 'user')
 * @returns A Message object with the specified configuration
 */
export function createMockMessage(
  options: {
    messageId?: string;
    text?: string;
    role?: 'user' | 'assistant';
  } = {}
): any {
  const messageId = options.messageId ?? 'msg-123';
  const text = options.text ?? 'Hello, agent!';
  const role = options.role ?? 'user';

  return {
    kind: 'message',
    messageId: messageId,
    role: role,
    parts: [
      {
        kind: 'text',
        text: text,
      },
    ],
  };
}

/**
 * Configuration options for creating mock fetch functions
 */
export interface MockFetchConfig {
  /** Whether the mock should require authentication */
  requiresAuth?: boolean;
  /** Custom agent card description */
  agentDescription?: string;
  /** Custom message configuration */
  messageConfig?: {
    messageId?: string;
    text?: string;
  };
  /** Custom error configuration for auth failures */
  authErrorConfig?: {
    code?: number;
    message?: string;
    challenge?: string;
  };
  /** Whether to capture auth headers for testing */
  captureAuthHeaders?: boolean;
  /** Behavior mode for the mock fetch */
  behavior?: 'standard' | 'authRetry' | 'alwaysFail';
}

/**
 * Creates a mock fetch function with configurable behavior.
 * This is the single function that replaces all previous mock fetch utilities.
 *
 * @param config - Configuration options for the mock fetch behavior
 * @returns A sinon stub that can be used as a mock fetch implementation, with capturedAuthHeaders attached as a property
 */
export function createMockFetch(
  config: MockFetchConfig = {}
): sinon.SinonStub & { capturedAuthHeaders: string[] } {
  const {
    requiresAuth = false, // Default to no auth required for basic testing
    agentDescription = 'A test agent for basic client testing',
    messageConfig = {
      messageId: 'msg-123',
      text: 'Hello, agent!',
    },
    authErrorConfig = {
      code: -32001,
      message: 'Authentication required',
      challenge: 'challenge123',
    },
    captureAuthHeaders = false,
    behavior = 'standard',
  } = config;

  let callCount = 0;
  const capturedAuthHeaders: string[] = [];

  const mockFetch = sinon.stub().callsFake(async (url: string, options?: RequestInit) => {
    // Handle agent card requests
    if (url.includes(AGENT_CARD_PATH)) {
      const mockAgentCard = createMockAgentCard({
        description: agentDescription,
      });
      return createAgentCardResponse(mockAgentCard);
    }

    // Handle API requests
    if (url.includes('/api')) {
      const headers = new Headers(options?.headers);
      const authHeader = headers.get('Authorization');

      // Capture auth headers if requested
      if (captureAuthHeaders) {
        capturedAuthHeaders.push(authHeader || '');
      }

      const requestId = extractRequestId(options);

      // Determine response based on behavior
      switch (behavior) {
        case 'alwaysFail':
          // Always return 401 for API calls
          return createResponse(
            requestId,
            undefined,
            {
              code: authErrorConfig.code!,
              message: authErrorConfig.message!,
            },
            401,
            { 'WWW-Authenticate': `Bearer ${authErrorConfig.challenge}` }
          );

        case 'authRetry':
          // First call: return 401 to trigger auth flow
          if (callCount === 0) {
            callCount++;
            return createResponse(
              requestId,
              undefined,
              {
                code: authErrorConfig.code!,
                message: authErrorConfig.message!,
              },
              401,
              { 'WWW-Authenticate': `Bearer ${authErrorConfig.challenge}` }
            );
          }
          // Subsequent calls: return success
          break;

        case 'standard':
        default:
          // If authentication is required and no valid header is present
          if (requiresAuth && !authHeader) {
            return createResponse(
              requestId,
              undefined,
              {
                code: authErrorConfig.code!,
                message: authErrorConfig.message!,
              },
              401,
              { 'WWW-Authenticate': `Bearer ${authErrorConfig.challenge}` }
            );
          }
          break;
      }

      // Return success response
      const mockMessage = createMockMessage({
        messageId: messageConfig.messageId || 'msg-123',
        text: messageConfig.text || 'Hello, agent!',
      });

      return createResponse(requestId, mockMessage);
    }

    // Default: return 404 for unknown endpoints
    return new Response('Not found', { status: 404 });
  });

  // Attach the capturedAuthHeaders as a property to the mock fetch function
  (mockFetch as any).capturedAuthHeaders = capturedAuthHeaders;

  return mockFetch as sinon.SinonStub & { capturedAuthHeaders: string[] };
}

/**
 * Creates a REST response (plain JSON, not JSON-RPC wrapped).
 * Used for testing REST transport which doesn't use JSON-RPC envelope.
 *
 * @param data - The data to include in the response
 * @param status - HTTP status code (defaults to 200)
 * @param headers - Additional headers to include
 * @returns A Response object with JSON content
 */
export function createRestResponse(
  data: unknown,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const responseHeaders = { ...defaultHeaders, ...headers };
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

/**
 * Creates a REST error response with A2A error format.
 *
 * @param code - A2A error code (e.g., -32001 for TaskNotFound)
 * @param message - Error message
 * @param status - HTTP status code (defaults to 400)
 * @param data - Optional additional error data
 * @returns A Response object with error JSON content
 */
export function createRestErrorResponse(
  code: number,
  message: string,
  status: number = 400,
  data?: Record<string, unknown>
): Response {
  const errorBody = { code, message, ...(data && { data }) };
  return new Response(JSON.stringify(errorBody), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Creates a mock task response for testing.
 *
 * @param id - Task ID (defaults to 'task-123')
 * @param status - Task status state (defaults to 'completed')
 * @returns A mock Task object
 */
export function createMockTask(id: string = 'task-123', status: string = 'completed'): any {
  return {
    id,
    contextId: 'context-123',
    status: { state: status },
    kind: 'task',
  };
}

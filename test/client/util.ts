/**
 * Utility functions for A2A client tests
 */

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
  } catch (e) {
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
  
  // Create a ReadableStream to ensure the body can be read multiple times
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  
  return new Response(stream, {
    status,
    headers: responseHeaders
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
    jsonrpc: "2.0",
    id: id
  };
  
  // Add either result or error (mutually exclusive)
  if (error) {
    jsonRpcResponse.error = error;
    // Use provided status or default to 500 for errors
    status = status !== 200 ? status : 500;
  } else {
    jsonRpcResponse.result = result;
  }
  
  // Create a fresh body each time to avoid "Body is unusable" errors
  const body = JSON.stringify(jsonRpcResponse);
  
  // Create a ReadableStream to ensure the body can be read multiple times
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  
  return new Response(stream, {
    status,
    headers: responseHeaders
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
export function createMockAgentCard(options: {
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
} = {}): any {
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
      ...options.capabilities
    },
    skills: options.skills ?? []
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
export function createMessageParams(options: {
  messageId?: string;
  text?: string;
  role?: 'user' | 'assistant';
} = {}): any {
  const messageId = options.messageId ?? 'test-msg';
  const text = options.text ?? 'Hello, agent!';
  const role = options.role ?? 'user';
  
  return {
    message: {
      kind: 'message',
      messageId: messageId,
      role: role,
      parts: [{
        kind: 'text',
        text: text
      }]
    }
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
export function createMockMessage(options: {
  messageId?: string;
  text?: string;
  role?: 'user' | 'assistant';
} = {}): any {
  const messageId = options.messageId ?? 'msg-123';
  const text = options.text ?? 'Hello, agent!';
  const role = options.role ?? 'user';
  
  return {
    kind: 'message',
    messageId: messageId,
    role: role,
    parts: [{
      kind: 'text',
      text: text
    }]
  };
}

import { vi, Mock } from 'vitest';
import { AGENT_CARD_PATH, JSON_CONTENT_TYPE } from '../../src/constants.js';
import { Role, SendMessageResponse, Task, TaskState } from '../../src/types/pb/a2a.js';
import { SendMessageResult } from '../../src/index.js';
import {
  A2A_ERROR_CODE_TO_CLASS,
  A2A_ERROR_DOMAIN,
  A2A_ERROR_GRPC_STATUS,
  A2A_ERROR_REASON,
  ERROR_INFO_TYPE,
} from '../../src/errors.js';

export function extractRequestId(options?: RequestInit): number {
  if (!options?.body) {
    return 1;
  }

  try {
    const requestBody = JSON.parse(options.body as string);
    return requestBody.id || 1;
  } catch {
    return 1;
  }
}

export function createAgentCardResponse(
  data: any,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  const defaultHeaders = { 'Content-Type': JSON_CONTENT_TYPE };
  const responseHeaders = { ...defaultHeaders, ...headers };

  // Create a fresh body each time to avoid "Body is unusable" errors
  const body = JSON.stringify(data);

  return new Response(body, {
    status,
    headers: responseHeaders,
  });
}

export function createResponse(
  id: number,
  result?: any,
  error?: { code: number; message: string; data?: any },
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  const defaultHeaders = { 'Content-Type': JSON_CONTENT_TYPE };
  const responseHeaders = { ...defaultHeaders, ...headers };

  const jsonRpcResponse: any = {
    jsonrpc: '2.0',
    id: id,
  };

  if (error) {
    jsonRpcResponse.error = error;
    status = status !== 200 ? status : 500;
  } else {
    jsonRpcResponse.result = result;
  }

  return new Response(JSON.stringify(jsonRpcResponse), {
    status,
    headers: responseHeaders,
  });
}

export function createMockAgentCard(
  options: {
    name?: string;
    description?: string;
    version?: string;
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    capabilities?: {
      streaming?: boolean;
      pushNotifications?: boolean;
    };
    skills?: any[];
    supportedInterfaces?: {
      url: string;
      protocolBinding: string;
      tenant: string;
      protocolVersion: string;
    }[];
  } = {}
): any {
  return {
    name: options.name ?? 'Test Agent',
    description: options.description ?? 'A test agent for testing',
    version: options.version ?? '1.0.0',
    supportedInterfaces: options.supportedInterfaces ?? [
      {
        url: 'https://test-agent.example.com/api',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0.0',
      },
    ],
    capabilities: {
      streaming: options.capabilities?.streaming ?? true,
      pushNotifications: options.capabilities?.pushNotifications ?? true,
      extensions: [],
      ...options.capabilities,
    },
    skills: options.skills ?? [],
    securityRequirements: [],
    signatures: [],
    provider: { url: '', organization: '' },
    securitySchemes: {},
  };
}

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
    request: {
      messageId: messageId,
      role: role === 'user' ? Role.ROLE_USER : Role.ROLE_AGENT,
      parts: [
        {
          content: {
            $case: 'text',
            value: text,
          },
          filename: '',
          mediaType: 'text/plain',
          metadata: {},
        },
      ],
      contextId: 'context-123',
      taskId: 'task-123',
      metadata: {},
      extensions: [],
    },
    configuration: undefined,
    metadata: undefined,
  };
}

export function createMockProtoMessage(
  options: {
    messageId?: string;
    text?: string;
    role?: Role.ROLE_USER | Role.ROLE_AGENT;
  } = {}
): any {
  const messageId = options.messageId ?? 'msg-123';
  const text = options.text ?? 'Hello, agent!';
  const role = options.role ?? Role.ROLE_USER;

  const obj: SendMessageResponse = {
    payload: {
      $case: 'message',
      value: {
        messageId: messageId,
        contextId: 'context-123',
        taskId: 'task-123',
        role: role,
        parts: [
          {
            content: {
              $case: 'text',
              value: text,
            },
            filename: '',
            mediaType: 'text/plain',
            metadata: {},
          },
        ],
        metadata: {},
        extensions: [],
        referenceTaskIds: [],
      },
    },
  };

  return SendMessageResponse.toJSON(obj);
}

export function createMockMessage(
  options: {
    messageId?: string;
    text?: string;
    role?: Role;
  } = {}
): SendMessageResult {
  const messageId = options.messageId ?? 'msg-123';
  const text = options.text ?? 'Hello, agent!';
  const role = options.role ?? Role.ROLE_USER;

  return {
    messageId: messageId,
    contextId: 'context-123',
    taskId: 'task-123',
    role: role,
    parts: [
      {
        content: {
          $case: 'text',
          value: text,
        },
        filename: '',
        mediaType: 'text/plain',
        metadata: {},
      },
    ],
    metadata: {},
    extensions: [],
    referenceTaskIds: [],
  };
}

export interface MockFetchConfig {
  requiresAuth?: boolean;
  agentDescription?: string;
  messageConfig?: {
    messageId?: string;
    text?: string;
  };
  authErrorConfig?: {
    code?: number;
    message?: string;
    challenge?: string;
  };
  captureAuthHeaders?: boolean;
  behavior?: 'standard' | 'authRetry' | 'alwaysFail';
}

export function createMockFetch(
  config: MockFetchConfig = {}
): Mock & { capturedAuthHeaders: string[] } {
  const {
    requiresAuth = false,
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

  const mockFetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes(AGENT_CARD_PATH)) {
      const mockAgentCard = createMockAgentCard({
        description: agentDescription,
      });
      return createAgentCardResponse(mockAgentCard);
    }

    if (url.includes('/api')) {
      const headers = new Headers(options?.headers);
      const authHeader = headers.get('Authorization');

      if (captureAuthHeaders) {
        capturedAuthHeaders.push(authHeader || '');
      }

      const requestId = extractRequestId(options);

      switch (behavior) {
        case 'alwaysFail':
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
          break;

        case 'standard':
        default:
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

      const mockMessage = createMockMessage({
        messageId: messageConfig.messageId || 'msg-123',
        text: messageConfig.text || 'Hello, agent!',
      });

      const requestBody = JSON.parse((options?.body as string) || '{}');
      const wrappedResult =
        requestBody.method === 'SendMessage' ? { message: mockMessage } : mockMessage;

      return createResponse(requestId, wrappedResult);
    }

    return new Response('Not found', { status: 404 });
  });

  (mockFetch as any).capturedAuthHeaders = capturedAuthHeaders;

  return mockFetch as Mock & { capturedAuthHeaders: string[] };
}

export function createRestResponse(
  data: unknown,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  const defaultHeaders = { 'Content-Type': JSON_CONTENT_TYPE };
  const responseHeaders = { ...defaultHeaders, ...headers };
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

// Resolves a JSON-RPC error code to (reason, grpcStatusName) by chaining
// through the canonical mappings: code → className → (reason, grpcStatus).
function resolveErrorCode(code: number): { reason: string; grpcStatus: string } | undefined {
  const className = A2A_ERROR_CODE_TO_CLASS[code];
  if (!className) return undefined;
  const reason = A2A_ERROR_REASON[className];
  const grpcStatus = A2A_ERROR_GRPC_STATUS[className];
  if (!reason || !grpcStatus) return undefined;
  return { reason, grpcStatus };
}

// Creates a REST error response in the google.rpc.Status JSON format.
export function createRestErrorResponse(
  code: number,
  message: string,
  status: number = 400
): Response {
  const mapping = resolveErrorCode(code);
  const grpcStatus = mapping?.grpcStatus ?? 'UNKNOWN';
  const details = mapping
    ? [{ '@type': ERROR_INFO_TYPE, reason: mapping.reason, domain: A2A_ERROR_DOMAIN }]
    : [];

  const errorBody = {
    error: {
      code: status,
      status: grpcStatus,
      message,
      details,
    },
  };
  return new Response(JSON.stringify(errorBody), {
    status,
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
  });
}

export function createMockTask(
  id: string = 'task-123',
  status: TaskState = TaskState.TASK_STATE_COMPLETED
): any {
  return {
    id,
    contextId: 'context-123',
    status: {
      state: status,
      timestamp: '2023-01-01T00:00:00.000Z',
      message: undefined,
    },
    artifacts: [],
    history: [],
    metadata: {},
  };
}

export function createMockProtoTask(
  id: string = 'task-123',
  status: TaskState = TaskState.TASK_STATE_COMPLETED
): any {
  const obj: Task = {
    id: id,
    contextId: 'context-123',
    status: {
      state: status,
      timestamp: '2023-01-01T00:00:00.000Z',
      message: undefined,
    },
    artifacts: [],
    history: [],
    metadata: {},
  };

  return Task.toJSON(obj);
}

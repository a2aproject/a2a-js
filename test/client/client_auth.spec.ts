import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';
import { JsonRpcTransport } from '../../src/client/transports/json_rpc_transport.js';
import {
  AuthenticationHandler,
  HttpHeaders,
  createAuthenticatingFetchWithRetry,
} from '../../src/client/auth-handler.js';
import { createMessageParams, createMockFetch } from './util.js';

class ChallengeManager {
  private challengeStore: Set<string> = new Set();

  createChallenge(): string {
    const challenge = Math.random().toString(36).substring(2, 18);
    this.challengeStore.add(challenge);
    return challenge;
  }

  static signChallenge(challenge: string): string {
    return challenge + '.' + challenge.split('.').reverse().join('');
  }

  verifyToken(token: string): boolean {
    const [challenge, signature] = token.split('.');
    if (!this.challengeStore.has(challenge)) return false;

    return signature === challenge.split('.').reverse().join('');
  }

  clearStore(): void {
    this.challengeStore.clear();
  }
}

const challengeManager = new ChallengeManager();

class MockAuthHandler implements AuthenticationHandler {
  private authorization: string | null = null;

  async headers(): Promise<HttpHeaders> {
    return this.authorization ? { Authorization: this.authorization } : {};
  }

  async shouldRetryWithHeaders(req: RequestInit, res: Response): Promise<HttpHeaders | undefined> {
    if (res.status !== 401 && res.status !== 403) return undefined;

    const [scheme, challenge] = res.headers.get('WWW-Authenticate')?.split(/\s+/) || [];
    if (scheme !== 'Bearer') return undefined;

    const token = ChallengeManager.signChallenge(challenge);

    return { Authorization: `Bearer ${token}` };
  }

  async onSuccessfulRetry(headers: HttpHeaders): Promise<void> {
    const auth = headers['Authorization'];
    if (auth) this.authorization = auth;
  }
}

describe('JsonRpcTransport Authentication Tests', () => {
  let client: JsonRpcTransport;
  let authHandler: MockAuthHandler;
  let mockFetch: Mock & { capturedAuthHeaders: string[] };
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    // Suppress console.error during tests to avoid noise
    originalConsoleError = console.error;
    console.error = () => {};

    mockFetch = createMockFetch({
      requiresAuth: true,
      agentDescription: 'A test agent for authentication testing',
      authErrorConfig: {
        code: -32001,
        message: 'Authentication required',
        challenge: challengeManager.createChallenge(),
      },
    });

    authHandler = new MockAuthHandler();
    const authHandlingFetch = createAuthenticatingFetchWithRetry(mockFetch, authHandler);
    client = new JsonRpcTransport({
      endpoint: 'https://test-agent.example.com/api',
      fetchImpl: authHandlingFetch,
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.restoreAllMocks();
  });

  describe('Authentication Flow', () => {
    it('should handle authentication flow correctly', async () => {
      const messageParams = createMessageParams({
        messageId: 'test-msg-1',
        text: 'Hello, agent!',
      });

      const result = await client.sendMessage(messageParams.request);

      expect(mockFetch.mock.calls.length).to.equal(2);

      // First call: RPC request without auth header
      expect(mockFetch.mock.calls[0][0]).to.equal('https://test-agent.example.com/api');
      expect(mockFetch.mock.calls[0][1]).to.deep.include({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      expect(mockFetch.mock.calls[0][1].body).to.include('"method":"SendMessage"');

      // Second call: RPC request with auth header
      expect(mockFetch.mock.calls[1][0]).to.equal('https://test-agent.example.com/api');
      expect(mockFetch.mock.calls[1][1]).to.deep.include({
        method: 'POST',
      });
      expect(mockFetch.mock.calls[1][1].headers).to.have.property(
        'Content-Type',
        'application/json'
      );
      expect(mockFetch.mock.calls[1][1].headers).to.have.property('Accept', 'application/json');
      expect(mockFetch.mock.calls[1][1].headers).to.have.property('Authorization');

      expect(mockFetch.mock.calls[1][1].headers['Authorization']).to.match(/^Bearer .+$/);
      expect(mockFetch.mock.calls[1][1].body).to.include('"method":"SendMessage"');

      expect(result).to.exist;
      expect(result).to.have.property('messageId', 'msg-123');
    });

    it('should reuse authentication token for subsequent requests', async () => {
      const messageParams = createMessageParams({
        messageId: 'test-msg-2',
        text: 'Second message',
      });

      // First request triggers auth flow
      await client.sendMessage(messageParams.request);

      const firstRequestAuthCall = mockFetch.mock.calls.find(
        (args) => (args[0] as string).includes('/api') && args[1].headers?.['Authorization']
      );
      const firstRequestToken = firstRequestAuthCall?.[1]?.headers?.['Authorization'];

      const result2 = await client.sendMessage(messageParams.request);

      // 3 calls total: 2 for first request + 1 for second (token cached).
      expect(mockFetch.mock.calls.length).to.equal(3);

      const secondRequestCalls = mockFetch.mock.calls.slice(2);

      expect(secondRequestCalls[0][0]).to.equal('https://test-agent.example.com/api');
      expect(secondRequestCalls[0][1].headers).to.have.property('Authorization');
      expect(secondRequestCalls[0][1].headers['Authorization']).to.equal(firstRequestToken);

      expect(result2).to.exist;
    });
  });

  describe('Authentication Handler Integration', () => {
    it('should call auth handler methods correctly', async () => {
      const authHandlerSpy = {
        headers: vi.spyOn(authHandler, 'headers'),
        shouldRetryWithHeaders: vi.spyOn(authHandler, 'shouldRetryWithHeaders'),
        onSuccess: vi.spyOn(authHandler, 'onSuccessfulRetry'),
      };

      const messageParams = createMessageParams({
        messageId: 'test-msg-4',
        text: 'Test auth handler',
      });

      await client.sendMessage(messageParams.request);

      expect(authHandlerSpy.headers).toHaveBeenCalled();
      expect(authHandlerSpy.shouldRetryWithHeaders).toHaveBeenCalled();
      expect(authHandlerSpy.onSuccess).toHaveBeenCalled();
    });

    it('should handle auth handler returning undefined for retry', async () => {
      const noRetryHandler = new MockAuthHandler();
      noRetryHandler.shouldRetryWithHeaders = vi.fn().mockResolvedValue(undefined);

      const clientNoRetry = new JsonRpcTransport({
        endpoint: 'https://test-agent.example.com/api',
        fetchImpl: mockFetch,
      });

      const messageParams = createMessageParams({
        messageId: 'test-msg-5',
        text: 'No retry test',
      });

      try {
        await clientNoRetry.sendMessage(messageParams.request);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
      }
    });

    it('should retry with new auth headers', async () => {
      const authRetryTestFetch = createMockFetch({
        agentDescription: 'A test agent for authentication testing',
        messageConfig: {
          messageId: 'msg-auth-retry',
          text: 'Test auth retry',
        },
        captureAuthHeaders: true,
        behavior: 'authRetry',
      });
      const { capturedAuthHeaders } = authRetryTestFetch;

      const authHandlingFetch = createAuthenticatingFetchWithRetry(authRetryTestFetch, authHandler);
      const clientAuthTest = new JsonRpcTransport({
        endpoint: 'https://test-agent.example.com/api',
        fetchImpl: authHandlingFetch,
      });

      const messageParams = createMessageParams({
        messageId: 'test-msg-auth-retry',
        text: 'Test auth retry',
      });

      const result = await clientAuthTest.sendMessage(messageParams.request);

      expect(capturedAuthHeaders).to.have.length(2);
      expect(capturedAuthHeaders[0]).to.equal('');
      expect(capturedAuthHeaders[1]).to.be.a('string').and.not.be.empty;

      expect(result).to.exist;
    });

    it('should continue without authentication when server does not return 401', async () => {
      const noAuthRequiredFetch = createMockFetch({
        requiresAuth: false,
        agentDescription: 'A test agent that does not require authentication',
        messageConfig: {
          messageId: 'msg-no-auth-required',
          text: 'Test without authentication',
        },
        captureAuthHeaders: true,
      });
      const { capturedAuthHeaders } = noAuthRequiredFetch;

      const clientNoAuth = new JsonRpcTransport({
        endpoint: 'https://test-agent.example.com/api',
        fetchImpl: noAuthRequiredFetch,
      });

      const messageParams = createMessageParams({
        messageId: 'test-msg-no-auth',
        text: 'Test without authentication',
      });

      const result = await clientNoAuth.sendMessage(messageParams.request);

      expect(capturedAuthHeaders).to.have.length(1);
      expect(capturedAuthHeaders[0]).to.equal('');

      expect(result).to.exist;
      if ('messageId' in result) {
        expect(result.messageId).to.equal('msg-no-auth-required');
      }
    });

    it('Client pipes server errors when no auth handler is specified', async () => {
      const fetchWithApiError = createMockFetch({
        agentDescription: 'A test agent that requires authentication',
        behavior: 'alwaysFail',
      });

      const clientNoAuthHandler = new JsonRpcTransport({
        endpoint: 'https://test-agent.example.com/api',
        fetchImpl: fetchWithApiError,
      });

      const messageParams = createMessageParams({
        messageId: 'test-msg-no-auth-handler',
        text: 'Test without auth handler',
      });

      // Error code -32001 maps to TaskNotFoundError via JsonRpcTransport.
      try {
        await clientNoAuthHandler.sendMessage(messageParams.request);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).name).to.equal('TaskNotFoundError');
      }

      expect(fetchWithApiError.mock.calls.length).to.equal(1);
    });
  });
});

describe('AuthHandlingFetch Tests', () => {
  let mockFetch: Mock & { capturedAuthHeaders: string[] };
  let authHandler: MockAuthHandler;
  let authHandlingFetch: ReturnType<typeof createAuthenticatingFetchWithRetry>;

  beforeEach(() => {
    mockFetch = createMockFetch({
      requiresAuth: true,
      agentDescription: 'A test agent for authentication testing',
      authErrorConfig: {
        code: -32001,
        message: 'Authentication required',
        challenge: challengeManager.createChallenge(),
      },
    });
    authHandler = new MockAuthHandler();
    authHandlingFetch = createAuthenticatingFetchWithRetry(mockFetch, authHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor and Function Call', () => {
    it('should create a callable instance', () => {
      expect(typeof authHandlingFetch).to.equal('function');
    });

    it('should support direct function calls', async () => {
      const response = await authHandlingFetch('https://test.example.com/api');
      expect(response).to.be.instanceOf(Response);
    });
  });

  describe('Header Merging', () => {
    it('should merge auth headers with provided headers when auth headers exist', async () => {
      const authHandlerWithHeaders = new MockAuthHandler();

      await authHandlerWithHeaders.onSuccessfulRetry({
        Authorization: 'Bearer test-token-123',
      });

      const authHandlingFetchWithHeaders = createAuthenticatingFetchWithRetry(
        mockFetch,
        authHandlerWithHeaders
      );

      await authHandlingFetchWithHeaders('https://test.example.com/api', {
        headers: {
          'Content-Type': 'application/json',
          'Custom-Header': 'custom-value',
        },
      });

      const fetchCallArgs = mockFetch.mock.calls[0];
      const headers = fetchCallArgs[1]?.headers as Record<string, string>;

      expect(headers).to.include({
        'Content-Type': 'application/json',
        'Custom-Header': 'custom-value',
        Authorization: 'Bearer test-token-123',
      });

      const storedHeaders = await authHandlerWithHeaders.headers();
      expect(storedHeaders['Authorization']).to.equal('Bearer test-token-123');
    });

    it('should handle empty headers gracefully', async () => {
      const emptyAuthHandler = new MockAuthHandler();
      const emptyAuthFetch = createAuthenticatingFetchWithRetry(mockFetch, emptyAuthHandler);

      await emptyAuthFetch('https://test.example.com/api');

      const fetchCallArgs = mockFetch.mock.calls[0];
      expect(fetchCallArgs[1]).to.exist;
    });
  });

  describe('Success Callback', () => {
    it('should call onSuccessfulRetry when retry succeeds', async () => {
      const successAuthHandler = new MockAuthHandler();
      const onSuccessSpy = vi.spyOn(successAuthHandler, 'onSuccessfulRetry');

      const successMockFetch = createMockFetch({
        messageConfig: {
          messageId: 'msg-success',
          text: 'Success after retry',
        },
        behavior: 'authRetry',
      });

      const successAuthFetch = createAuthenticatingFetchWithRetry(
        successMockFetch,
        successAuthHandler
      );

      await successAuthFetch('https://test.example.com/api');

      expect(onSuccessSpy).toHaveBeenCalled();
      expect(onSuccessSpy.mock.calls[0][0]).to.deep.include({
        Authorization: 'Bearer challenge123.challenge123',
      });
    });

    it('should not call onSuccessfulRetry when retry fails', async () => {
      const failAuthHandler = new MockAuthHandler();
      const onSuccessSpy = vi.spyOn(failAuthHandler, 'onSuccessfulRetry');

      createAuthenticatingFetchWithRetry(mockFetch, failAuthHandler);

      const failMockFetch = createMockFetch({
        behavior: 'alwaysFail',
      });

      const failAuthFetch = createAuthenticatingFetchWithRetry(failMockFetch, failAuthHandler);

      const response = await failAuthFetch('https://test.example.com/api');

      expect(onSuccessSpy).not.toHaveBeenCalled();
      expect(response.status).to.equal(401);
    });
  });

  describe('Error Handling', () => {
    it('should propagate fetch errors', async () => {
      const errorFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const errorAuthFetch = createAuthenticatingFetchWithRetry(errorFetch, authHandler);

      try {
        await errorAuthFetch('https://test.example.com/api');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Network error');
      }
    });

    it('should handle auth handler errors gracefully', async () => {
      const errorAuthHandler = new MockAuthHandler();
      const shouldRetrySpy = vi.spyOn(errorAuthHandler, 'shouldRetryWithHeaders');
      shouldRetrySpy.mockRejectedValue(new Error('Auth handler error'));

      const errorAuthFetch = createAuthenticatingFetchWithRetry(mockFetch, errorAuthHandler);

      try {
        await errorAuthFetch('https://test.example.com/api');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Auth handler error');
      }
    });
  });
});

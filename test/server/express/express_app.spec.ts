import {
  describe,
  it,
  beforeEach,
  afterEach,
  assert,
  expect,
  vi,
  Mock,
  MockInstance,
} from 'vitest';
import express, {
  Express,
  NextFunction,
  Request,
  Response,
  RequestHandler,
  ErrorRequestHandler,
} from 'express';
import request from 'supertest';

import {
  jsonErrorHandler,
  jsonRpcHandler,
  type JsonRpcHandlerOptions,
} from '../../../src/server/express/json_rpc_handler.js';
import { agentCardHandler } from '../../../src/server/express/agent_card_handler.js';
import { UserBuilder } from '../../../src/server/express/common.js';
import { A2ARequestHandler } from '../../../src/server/request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { LegacyJsonRpcTransportHandler } from '../../../src/compat/v0_3/index.js';
import { AgentCard } from '../../../src/index.js';
import { JSONRPCErrorResponse } from '../../../src/core.js';
import { AGENT_CARD_PATH, HTTP_EXTENSION_HEADER } from '../../../src/constants.js';
import { A2A_ERROR_CODE, GenericError, RequestMalformedError } from '../../../src/errors.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { User, UnauthenticatedUser } from '../../../src/server/authentication/user.js';

describe('A2AExpressApp', () => {
  let mockRequestHandler: A2ARequestHandler;
  let expressApp: Express;
  let handleStub: MockInstance;

  const setupA2ARoutes = (
    expressApp: Express,
    requestHandler: A2ARequestHandler,
    userBuilder: UserBuilder = UserBuilder.noAuthentication,
    baseUrl: string = '',
    middlewares: Array<RequestHandler | ErrorRequestHandler> = [],
    agentCardPath: string = AGENT_CARD_PATH,
    jsonRpcOptions: Partial<Omit<JsonRpcHandlerOptions, 'requestHandler' | 'userBuilder'>> = {}
  ): Express => {
    const router = express.Router();
    router.use(express.json(), jsonErrorHandler);
    if (middlewares.length > 0) {
      router.use(middlewares);
    }
    router.use(jsonRpcHandler({ requestHandler, userBuilder, ...jsonRpcOptions }));
    router.use(`/${agentCardPath}`, agentCardHandler({ agentCardProvider: requestHandler }));
    expressApp.use(baseUrl, router);
    return expressApp;
  };

  /**
   * Convenience wrapper around {@link setupA2ARoutes} that enables the
   * v0.3 compatibility layer. Used by the `legacy v0.3 JSON-RPC
   * dispatch` test block to opt the handler into v0.3 method routing.
   */
  const setupA2ARoutesWithLegacyCompat = (
    expressApp: Express,
    requestHandler: A2ARequestHandler
  ): Express =>
    setupA2ARoutes(expressApp, requestHandler, undefined, undefined, undefined, undefined, {
      legacyCompat: { enabled: true },
    });

  // Helper function to create JSON-RPC request bodies
  const createRpcRequest = (id: string | null, method = 'SendMessage', params: object = {}) => ({
    jsonrpc: '2.0',
    method,
    id,
    params,
  });

  const testAgentCard: AgentCard = {
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    securityRequirements: [],
    securitySchemes: {},
    provider: { url: '', organization: '' },
    signatures: [],
    supportedInterfaces: [
      {
        url: 'http://localhost:8080/jsonrpc',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    documentationUrl: 'http://test-agent.com/docs',
  };

  beforeEach(() => {
    mockRequestHandler = {
      getAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      getAuthenticatedExtendedAgentCard: vi.fn(),
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      createTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
      listTasks: vi.fn(),
    };

    expressApp = express();

    handleStub = vi.spyOn(JsonRpcTransportHandler.prototype, 'handle');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('agent card endpoint', () => {
    beforeEach(() => {
      setupA2ARoutes(expressApp, mockRequestHandler);
    });

    it('should return agent card on GET /.well-known/agent-card.json', async () => {
      const response = await request(expressApp).get(`/${AGENT_CARD_PATH}`).expect(200);

      assert.deepEqual(response.body, testAgentCard);
      expect(mockRequestHandler.getAgentCard as Mock).toHaveBeenCalledTimes(1);
    });

    it('should return agent card on custom path when agentCardPath is provided', async () => {
      const customPath = 'custom/agent-card.json';
      const customExpressApp = express();
      setupA2ARoutes(customExpressApp, mockRequestHandler, undefined, '', undefined, customPath);

      const response = await request(customExpressApp).get(`/${customPath}`).expect(200);

      assert.deepEqual(response.body, testAgentCard);
    });

    it('should handle errors when getting agent card', async () => {
      const errorMessage = 'Failed to get agent card';
      (mockRequestHandler.getAgentCard as Mock).mockRejectedValue(new Error(errorMessage));

      const response = await request(expressApp).get(`/${AGENT_CARD_PATH}`).expect(500);

      assert.deepEqual(response.body, {
        error: 'Failed to retrieve agent card',
      });
    });
  });

  describe('JSON-RPC endpoint', () => {
    beforeEach(() => {
      setupA2ARoutes(expressApp, mockRequestHandler);
    });

    it('should handle single JSON-RPC response', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };

      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      assert.deepEqual(response.body, mockResponse);
      expect(handleStub).toHaveBeenCalledExactlyOnceWith(requestBody, expect.anything());
    });

    it('should handle streaming JSON-RPC response', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
          yield { jsonrpc: '2.0', id: 'stream-2', result: { step: 2 } };
        },
      };

      handleStub.mockResolvedValue(mockStreamResponse);

      const requestBody = createRpcRequest('stream-test', 'SendStreamingMessage');

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      assert.include(response.headers['content-type'], 'text/event-stream');
      assert.equal(response.headers['cache-control'], 'no-cache');
      assert.equal(response.headers['connection'], 'keep-alive');

      const responseText = response.text;
      assert.include(responseText, 'data: {"jsonrpc":"2.0","id":"stream-1","result":{"step":1}}');
      assert.include(responseText, 'data: {"jsonrpc":"2.0","id":"stream-2","result":{"step":2}}');
    });

    it('should handle streaming error', async () => {
      const mockErrorStream = {
        async *[Symbol.asyncIterator]() {
          yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
          throw new RequestMalformedError('Streaming error');
        },
      };

      handleStub.mockResolvedValue(mockErrorStream);

      const requestBody = createRpcRequest('stream-error-test', 'SendStreamingMessage');

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      const responseText = response.text;
      assert.include(responseText, 'event: error');
      assert.include(responseText, 'Streaming error');
    });

    it('should handle immediate streaming error', async () => {
      const mockImmediateErrorStream = {
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw new RequestMalformedError('Immediate streaming error');
        },
      };

      handleStub.mockResolvedValue(mockImmediateErrorStream);

      const requestBody = createRpcRequest('immediate-stream-error-test', 'SendStreamingMessage');

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      // Assert SSE headers and error event content
      assert.include(response.headers['content-type'], 'text/event-stream');
      assert.equal(response.headers['cache-control'], 'no-cache');
      assert.equal(response.headers['connection'], 'keep-alive');

      const responseText = response.text;
      assert.include(responseText, 'event: error');
      assert.include(responseText, 'Immediate streaming error');
    });

    it('should handle general processing error', async () => {
      const error = new GenericError('Processing error');
      handleStub.mockRejectedValue(error);

      const requestBody = createRpcRequest('error-test');

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(500);

      const expectedErrorResponse = {
        jsonrpc: '2.0',
        id: 'error-test',
        error: {
          code: -32603,
          message: 'Processing error',
          data: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'INTERNAL_ERROR',
              domain: 'a2a-protocol.org',
            },
          ],
        },
      };

      assert.deepEqual(response.body, expectedErrorResponse);
    });

    it('should handle non-A2AError with fallback error handling', async () => {
      const genericError = new Error('Generic error');
      handleStub.mockRejectedValue(genericError);

      const requestBody = createRpcRequest('generic-error-test');

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(500);

      assert.equal(response.body.jsonrpc, '2.0');
      assert.equal(response.body.id, 'generic-error-test');
      assert.equal(response.body.error.message, 'Generic error');
    });

    it('should handle request without id', async () => {
      const error = new RequestMalformedError('No ID error');
      handleStub.mockRejectedValue(error);

      const requestBody = createRpcRequest(null);

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(500);

      assert.equal(response.body.id, null);
    });

    it('should handle extensions headers in request', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'test-extension-uri, another-extension';

      await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .set(HTTP_EXTENSION_HEADER, uriExtensionsValues)
        .set('Not-Relevant-Header', 'unused-value')
        .send(requestBody)
        .expect(200);

      expect(handleStub).toHaveBeenCalledTimes(1);
      const serverCallContext = handleStub.mock.calls[0][1];
      expect(serverCallContext).to.be.an.instanceOf(ServerCallContext);
      expect(serverCallContext.requestedExtensions).to.deep.equal([
        'test-extension-uri',
        'another-extension',
      ]);
    });

    it('should handle extensions headers in response', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };

      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'activated-extension, non-activated-extension';

      handleStub.mockImplementation(
        async (requestBody: any, serverCallContext: ServerCallContext) => {
          const firstRequestedExtension = serverCallContext.requestedExtensions
            ?.values()
            .next().value;
          serverCallContext.addActivatedExtension(firstRequestedExtension);
          return mockResponse;
        }
      );
      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .set(HTTP_EXTENSION_HEADER, uriExtensionsValues)
        .set('Not-Relevant-Header', 'unused-value')
        .send(requestBody)
        .expect(200);

      expect(response.get(HTTP_EXTENSION_HEADER)).to.equal('activated-extension');
    });
  });

  describe('middleware integration', () => {
    it('should apply custom middlewares to routes', async () => {
      const middlewareCalled = vi.fn();
      const testMiddleware = (_req: Request, _res: Response, next: NextFunction) => {
        middlewareCalled();
        next();
      };

      const middlewareApp = express();
      setupA2ARoutes(middlewareApp, mockRequestHandler, undefined, '', [testMiddleware]);

      await request(middlewareApp).get(`/${AGENT_CARD_PATH}`).expect(200);

      expect(middlewareCalled).toHaveBeenCalledTimes(1);
    });

    it('should handle middleware errors', async () => {
      const errorMiddleware = (_req: Request, _res: Response, next: NextFunction) => {
        next(new Error('Middleware error'));
      };

      const middlewareApp = express();
      setupA2ARoutes(middlewareApp, mockRequestHandler, undefined, '', [errorMiddleware]);

      await request(middlewareApp).get(`/${AGENT_CARD_PATH}`).expect(500);
    });

    it('should handle no authentication middlewares', async () => {
      const middlewareApp = express();
      setupA2ARoutes(middlewareApp, mockRequestHandler);

      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      expect(handleStub).toHaveBeenCalledTimes(1);
      const serverCallContext = handleStub.mock.calls[0][1];
      expect(serverCallContext).to.be.an.instanceOf(ServerCallContext);
      expect(serverCallContext.user).to.be.an.instanceOf(UnauthenticatedUser);
      expect(serverCallContext.user.isAuthenticated).to.be.false;
    });

    it('should handle successful authentication middlewares with class', async () => {
      class CustomUser {
        get isAuthenticated(): boolean {
          return true;
        }
        get userName(): string {
          return 'authenticated-user';
        }
      }

      const authenticationMiddleware = (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = new CustomUser();
        next();
      };

      const userExtractor = (req: Request): Promise<User> => {
        const user = (req as any).user;
        return Promise.resolve(user as User);
      };

      const middlewareApp = express();
      setupA2ARoutes(middlewareApp, mockRequestHandler, userExtractor, '', [
        authenticationMiddleware,
      ]);

      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      expect(handleStub).toHaveBeenCalledTimes(1);
      const serverCallContext = handleStub.mock.calls[0][1];
      expect(serverCallContext).to.be.an.instanceOf(ServerCallContext);
      expect(serverCallContext.user.isAuthenticated).to.be.true;
      expect(serverCallContext.user.userName).to.equal('authenticated-user');
    });

    it('should handle successful authentication middlewares with plain object', async () => {
      const authenticationMiddleware = (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = {
          id: 123,
          email: 'test_email',
        };
        next();
      };

      const userExtractor = (req: Request): Promise<User> => {
        class CustomUser implements User {
          constructor(private user: any) {}
          get isAuthenticated(): boolean {
            return true;
          }
          get userName(): string {
            return this.user.email;
          }
          public getId(): number {
            return this.user.id;
          }
        }

        const user = (req as any).user;
        const convertedUser = new CustomUser(user);
        return Promise.resolve(convertedUser as User);
      };

      const middlewareApp = express();
      setupA2ARoutes(middlewareApp, mockRequestHandler, userExtractor, '', [
        authenticationMiddleware,
      ]);

      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      expect(handleStub).toHaveBeenCalledTimes(1);
      const serverCallContext = handleStub.mock.calls[0][1];
      expect(serverCallContext).to.be.an.instanceOf(ServerCallContext);
      expect(serverCallContext.user.isAuthenticated).to.be.true;
      expect(serverCallContext.user.userName).to.equal('test_email');
      expect(serverCallContext.user.getId()).to.equal(123);
    });

    it('should handle successful authentication middlewares without custom user extractor', async () => {
      class CustomUser {
        get isAuthenticated(): boolean {
          return true;
        }
        get userName(): string {
          return 'authenticated-user';
        }
      }

      const authenticationMiddleware = (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = new CustomUser();
        next();
      };

      const middlewareApp = express();
      setupA2ARoutes(middlewareApp, mockRequestHandler, undefined, '', [authenticationMiddleware]);

      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' } as any,
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(requestBody)
        .expect(200);

      expect(handleStub).toHaveBeenCalledTimes(1);
      const serverCallContext = handleStub.mock.calls[0][1];
      expect(serverCallContext).to.be.an.instanceOf(ServerCallContext);
      expect(serverCallContext.user.isAuthenticated).to.be.false;
      expect(serverCallContext.user.userName).to.equal('');
    });
  });

  describe('route configuration', () => {
    it('should mount routes at baseUrl', async () => {
      const baseUrl = '/api/v1';
      const basedApp = express();
      setupA2ARoutes(basedApp, mockRequestHandler, undefined, baseUrl);

      await request(basedApp).get(`${baseUrl}/${AGENT_CARD_PATH}`).expect(200);
    });

    it('should handle empty baseUrl', async () => {
      const emptyBaseApp = express();
      setupA2ARoutes(emptyBaseApp, mockRequestHandler);

      await request(emptyBaseApp).get(`/${AGENT_CARD_PATH}`).expect(200);
    });

    it('should include express.json() middleware by default', async () => {
      const jsonApp = express();
      setupA2ARoutes(jsonApp, mockRequestHandler);

      const requestBody = createRpcRequest('test-id', 'SendMessage', {
        test: 'data',
      });

      await request(jsonApp).post('/').set('A2A-Version', '1.0').send(requestBody).expect(200);

      expect(handleStub).toHaveBeenCalledExactlyOnceWith(requestBody, expect.anything());
    });

    it('should handle malformed json request', async () => {
      const jsonApp = express();
      setupA2ARoutes(jsonApp, mockRequestHandler);

      const requestBody = '{"jsonrpc": "2.0", "method": "message/send", "id": "1"'; // Missing closing brace
      const response = await request(jsonApp)
        .post('/')
        .set('Content-Type', 'application/json') // Set header to trigger json parser
        .send(requestBody)
        .expect(400);

      const expectedErrorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: A2A_ERROR_CODE.INVALID_PARAMS,
          message: 'Invalid JSON payload.',
          data: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'INVALID_PARAMS',
              domain: 'a2a-protocol.org',
            },
          ],
        },
      };
      assert.deepEqual(response.body, expectedErrorResponse);
    });
  });

  describe('A2A-Version header validation', () => {
    beforeEach(() => {
      setupA2ARoutes(expressApp, mockRequestHandler);
    });

    it('should reject header-less requests against a v1.0-only card when legacyCompat is omitted', async () => {
      // Without legacyCompat, the v1.0-only `testAgentCard` rejects
      // the §3.6.2 default-to-'0.3' because '0.3' is not declared in
      // `supportedInterfaces`. This is the strict-mode behavior; the
      // implicit-v0.3 acceptance is gated on opting into the compat
      // layer (see the `legacy v0.3 JSON-RPC dispatch` block).
      const response = await request(expressApp)
        .post('/')
        .send(createRpcRequest('1', 'GetTask', { id: 'test-task' }))
        .expect(500);

      assert.equal(response.body.jsonrpc, '2.0');
      assert.property(response.body, 'error');
      assert.equal(response.body.error.code, A2A_ERROR_CODE.VERSION_NOT_SUPPORTED);
    });

    it('should accept requests with a supported A2A-Version header', async () => {
      handleStub.mockResolvedValue({ jsonrpc: '2.0', id: '1', result: {} });

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(createRpcRequest('1', 'GetTask', { id: 'test-task' }))
        .expect(200);

      assert.equal(response.body.jsonrpc, '2.0');
    });

    it('should reject requests with an unsupported A2A-Version header', async () => {
      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '9.9')
        .send(createRpcRequest('1', 'GetTask', { id: 'test-task' }))
        .expect(500);

      assert.equal(response.body.jsonrpc, '2.0');
      assert.property(response.body, 'error');
      assert.equal(response.body.error.code, A2A_ERROR_CODE.VERSION_NOT_SUPPORTED);
      assert.include(response.body.error.message, '9.9');
    });
  });

  describe('legacy v0.3 JSON-RPC dispatch', () => {
    let legacyHandleStub: MockInstance;

    // An agent card that advertises both v1.0 and v0.3 JSONRPC interfaces,
    // so version validation accepts both.
    const dualVersionAgentCard: AgentCard = {
      ...testAgentCard,
      supportedInterfaces: [
        {
          url: 'http://localhost:8080/jsonrpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '1.0',
        },
        {
          url: 'http://localhost:8080/jsonrpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '0.3',
        },
      ],
    };

    beforeEach(() => {
      legacyHandleStub = vi.spyOn(LegacyJsonRpcTransportHandler.prototype, 'handle');
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(dualVersionAgentCard);
      setupA2ARoutesWithLegacyCompat(expressApp, mockRequestHandler);
    });

    it('routes a v0.3 method to the legacy handler', async () => {
      legacyHandleStub.mockResolvedValue({
        jsonrpc: '2.0',
        id: 'req-1',
        result: { kind: 'task' },
      });

      await request(expressApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .send(createRpcRequest('req-1', 'message/send'))
        .expect(200);

      expect(legacyHandleStub).toHaveBeenCalledTimes(1);
      expect(handleStub).not.toHaveBeenCalled();
    });

    it('routes a v1.0 method to the v1 handler', async () => {
      handleStub.mockResolvedValue({
        jsonrpc: '2.0',
        id: 'req-2',
        result: { task: { id: 't' } },
      });

      await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(createRpcRequest('req-2', 'SendMessage'))
        .expect(200);

      expect(handleStub).toHaveBeenCalledTimes(1);
      expect(legacyHandleStub).not.toHaveBeenCalled();
    });

    it('accepts header-less legacy requests when the card advertises v0.3', async () => {
      legacyHandleStub.mockResolvedValue({
        jsonrpc: '2.0',
        id: 'req-3',
        result: { kind: 'task' },
      });

      // No A2A-Version header → requestedVersion defaults to '0.3' per §3.6.2.
      // Card declares v0.3 so validateVersion passes.
      await request(expressApp)
        .post('/')
        .send(createRpcRequest('req-3', 'message/send'))
        .expect(200);

      expect(legacyHandleStub).toHaveBeenCalledTimes(1);
    });

    it('accepts header-less legacy requests against a v1.0-only card when legacyCompat is enabled', async () => {
      // testAgentCard only declares the v1.0 interface. With
      // legacyCompat enabled, the validator implicitly accepts the
      // §3.6.2 default-to-'0.3' for any binding the card already
      // exposes — so a header-less v0.3-shaped request still routes
      // to the legacy handler without forcing operators to duplicate
      // every v1.0 entry with a v0.3 stub.
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(testAgentCard);
      legacyHandleStub.mockResolvedValue({
        jsonrpc: '2.0',
        id: 'req-4',
        result: { kind: 'task' },
      });

      await request(expressApp)
        .post('/')
        .send(createRpcRequest('req-4', 'message/send'))
        .expect(200);

      expect(legacyHandleStub).toHaveBeenCalledTimes(1);
      expect(handleStub).not.toHaveBeenCalled();
    });

    it('accepts explicit A2A-Version: 0.3 against a v1.0-only card when legacyCompat is enabled', async () => {
      // Same as above but with the header explicitly set rather than
      // relying on the §3.6.2 missing-header default.
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(testAgentCard);
      legacyHandleStub.mockResolvedValue({
        jsonrpc: '2.0',
        id: 'req-explicit-03',
        result: { kind: 'task' },
      });

      await request(expressApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .send(createRpcRequest('req-explicit-03', 'message/send'))
        .expect(200);

      expect(legacyHandleStub).toHaveBeenCalledTimes(1);
      expect(handleStub).not.toHaveBeenCalled();
    });

    it('streams SSE responses on the legacy path', async () => {
      const legacyStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            jsonrpc: '2.0',
            id: 'stream-1',
            result: { kind: 'task', id: 't-1', contextId: 'ctx', status: { state: 'working' } },
          };
        },
      };
      legacyHandleStub.mockResolvedValue(legacyStream);

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .send(createRpcRequest('stream-legacy', 'message/stream'))
        .expect(200);

      assert.include(response.headers['content-type'], 'text/event-stream');
      assert.include(response.text, '"kind":"task"');
      expect(legacyHandleStub).toHaveBeenCalledTimes(1);
    });

    it('uses the legacy error mapper (omits data field) on legacy-path errors', async () => {
      legacyHandleStub.mockRejectedValue(new GenericError('legacy boom'));

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .send(createRpcRequest('err-1', 'message/send'))
        .expect(500);

      expect(response.body.error.code).to.equal(A2A_ERROR_CODE.INTERNAL_ERROR);
      expect(response.body.error.message).to.equal('legacy boom');
      // v0.3 JSONRPCError.data is `Record<string,unknown>` not the v1.0
      // ErrorDetail[] array. The legacy mapper omits the field entirely.
      expect(response.body.error).to.not.have.property('data');
    });

    it('returns method-not-found for v0.3 methods when legacyCompat is omitted', async () => {
      // Build a fresh app WITHOUT the compat opt-in. The v0.3 method
      // name is unknown to the v1.0 dispatcher, which returns -32601.
      const optOutApp = express();
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(dualVersionAgentCard);
      setupA2ARoutes(optOutApp, mockRequestHandler);

      const response = await request(optOutApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .send(createRpcRequest('req-no-compat', 'message/send'))
        .expect(200);

      // JSON-RPC convention: HTTP 200 carries the JSON-RPC error body.
      expect(response.body.error.code).to.equal(A2A_ERROR_CODE.METHOD_NOT_FOUND);
      // Legacy code path is never instantiated nor invoked.
      expect(legacyHandleStub).not.toHaveBeenCalled();
    });

    it('returns method-not-found for v0.3 methods when legacyCompat.enabled is false', async () => {
      const optOutApp = express();
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(dualVersionAgentCard);
      setupA2ARoutes(optOutApp, mockRequestHandler, undefined, undefined, undefined, undefined, {
        legacyCompat: { enabled: false },
      });

      const response = await request(optOutApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .send(createRpcRequest('req-disabled', 'message/send'))
        .expect(200);

      expect(response.body.error.code).to.equal(A2A_ERROR_CODE.METHOD_NOT_FOUND);
      expect(legacyHandleStub).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Extension-header tolerance on the legacy JSON-RPC path
    // ========================================================================

    it('accepts X-A2A-Extensions on the legacy JSON-RPC path', async () => {
      legacyHandleStub.mockImplementation(async (_body, context) => {
        context.addActivatedExtension('ext-legacy');
        return { jsonrpc: '2.0', id: 'ext-1', result: { kind: 'task' } };
      });

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .set('X-A2A-Extensions', 'ext-legacy')
        .send(createRpcRequest('ext-1', 'message/send'))
        .expect(200);

      // Legacy response carries the v0.3 spelling.
      assert.equal(response.headers['x-a2a-extensions'], 'ext-legacy');
      assert.notProperty(response.headers, 'a2a-extensions');
    });

    it('accepts A2A-Extensions as fallback on the legacy JSON-RPC path', async () => {
      legacyHandleStub.mockImplementation(async (_body, context) => {
        context.addActivatedExtension('ext-modern');
        return { jsonrpc: '2.0', id: 'ext-2', result: { kind: 'task' } };
      });

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .set('A2A-Extensions', 'ext-modern')
        .send(createRpcRequest('ext-2', 'message/send'))
        .expect(200);

      // Legacy response always uses the X- spelling regardless of input.
      assert.equal(response.headers['x-a2a-extensions'], 'ext-modern');
    });

    it('prefers X-A2A-Extensions when both spellings are present on the legacy path', async () => {
      legacyHandleStub.mockImplementation(async (_body, context) => {
        for (const ext of context.requestedExtensions ?? []) {
          context.addActivatedExtension(ext);
        }
        return { jsonrpc: '2.0', id: 'ext-3', result: { kind: 'task' } };
      });

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '0.3')
        .set('X-A2A-Extensions', 'legacy-ext')
        .set('A2A-Extensions', 'modern-ext')
        .send(createRpcRequest('ext-3', 'message/send'))
        .expect(200);

      // Legacy spelling wins on input; legacy spelling on output.
      assert.equal(response.headers['x-a2a-extensions'], 'legacy-ext');
    });

    it('v1.0 JSON-RPC path writes A2A-Extensions (not X-) on responses', async () => {
      handleStub.mockImplementation(async (_body, context) => {
        context.addActivatedExtension('ext-v1');
        return { jsonrpc: '2.0', id: 'ext-4', result: { task: { id: 't' } } };
      });

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .set('A2A-Extensions', 'ext-v1')
        .send(createRpcRequest('ext-4', 'SendMessage'))
        .expect(200);

      assert.equal(response.headers['a2a-extensions'], 'ext-v1');
      assert.notProperty(response.headers, 'x-a2a-extensions');
    });

    it('v1.0 JSON-RPC path does NOT read X-A2A-Extensions (stays strict)', async () => {
      // Non-regression: matches the REST handler's behaviour where the
      // v1.0 layer ignores the legacy header spelling.
      handleStub.mockImplementation(async (_body, context) => {
        for (const ext of context.requestedExtensions ?? []) {
          context.addActivatedExtension(ext);
        }
        return { jsonrpc: '2.0', id: 'ext-5', result: { task: { id: 't' } } };
      });

      const response = await request(expressApp)
        .post('/')
        .set('A2A-Version', '1.0')
        .set('X-A2A-Extensions', 'ignored-by-v1')
        .send(createRpcRequest('ext-5', 'SendMessage'))
        .expect(200);

      // No extensions activated; no header in response.
      assert.notProperty(response.headers, 'a2a-extensions');
      assert.notProperty(response.headers, 'x-a2a-extensions');
    });
  });
});

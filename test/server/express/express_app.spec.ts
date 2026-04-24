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

import { jsonErrorHandler, jsonRpcHandler } from '../../../src/server/express/json_rpc_handler.js';
import { agentCardHandler } from '../../../src/server/express/agent_card_handler.js';
import { UserBuilder } from '../../../src/server/express/common.js';
import { A2ARequestHandler } from '../../../src/server/request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
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
    agentCardPath: string = AGENT_CARD_PATH
  ): Express => {
    const router = express.Router();
    router.use(express.json(), jsonErrorHandler);
    if (middlewares.length > 0) {
      router.use(middlewares);
    }
    router.use(jsonRpcHandler({ requestHandler, userBuilder }));
    router.use(`/${agentCardPath}`, agentCardHandler({ agentCardProvider: requestHandler }));
    expressApp.use(baseUrl, router);
    return expressApp;
  };

  // Helper function to create JSON-RPC request bodies
  const createRpcRequest = (id: string | null, method = 'message/send', params: object = {}) => ({
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

      const requestBody = createRpcRequest('stream-test', 'message/stream');

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

      const requestBody = createRpcRequest('stream-error-test', 'message/stream');

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

      const requestBody = createRpcRequest('immediate-stream-error-test', 'message/stream');

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

      const requestBody = createRpcRequest('test-id', 'message/send', {
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
        },
      };
      assert.deepEqual(response.body, expectedErrorResponse);
    });
  });

  describe('A2A-Version header validation', () => {
    beforeEach(() => {
      setupA2ARoutes(expressApp, mockRequestHandler);
    });

    it('should accept requests without A2A-Version header (defaults to 0.3)', async () => {
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
});

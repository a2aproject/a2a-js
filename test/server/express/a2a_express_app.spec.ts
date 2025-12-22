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
import express, { Express, NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { A2AExpressApp } from '../../../src/server/express/a2a_express_app.js';
import { A2ARequestHandler } from '../../../src/server/request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { AgentCard, JSONRPCSuccessResponse, JSONRPCErrorResponse } from '../../../src/index.js';
import { AGENT_CARD_PATH, HTTP_EXTENSION_HEADER } from '../../../src/constants.js';
import { A2AError } from '../../../src/server/error.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { User, UnauthenticatedUser } from '../../../src/server/authentication/user.js';

describe('A2AExpressApp', () => {
  let mockRequestHandler: A2ARequestHandler;
  let app: A2AExpressApp;
  let expressApp: Express;
  let handleStub: MockInstance;

  // Helper function to create JSON-RPC request bodies
  const createRpcRequest = (id: string | null, method = 'message/send', params: object = {}) => ({
    jsonrpc: '2.0',
    method,
    id,
    params,
  });

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
    mockRequestHandler = {
      getAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      getAuthenticatedExtendedAgentCard: vi.fn(),
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      setTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
    };

    app = new A2AExpressApp(mockRequestHandler);
    expressApp = express();

    handleStub = vi.spyOn(JsonRpcTransportHandler.prototype, 'handle');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with requestHandler and jsonRpcTransportHandler', () => {
      const newApp = new A2AExpressApp(mockRequestHandler);
      assert.instanceOf(newApp, A2AExpressApp);
      assert.equal((newApp as any).requestHandler, mockRequestHandler);
    });
  });

  describe('setupRoutes', () => {
    it('should setup routes with default parameters', () => {
      const setupApp = app.setupRoutes(expressApp);
      assert.equal(setupApp, expressApp);
    });
  });

  describe('agent card endpoint', () => {
    beforeEach(() => {
      app.setupRoutes(expressApp);
    });

    it('should return agent card on GET /.well-known/agent-card.json', async () => {
      const response = await request(expressApp).get(`/${AGENT_CARD_PATH}`).expect(200);

      assert.deepEqual(response.body, testAgentCard);
      expect(mockRequestHandler.getAgentCard as Mock).toHaveBeenCalledTimes(1);
    });

    it('should return agent card on custom path when agentCardPath is provided', async () => {
      const customPath = 'custom/agent-card.json';
      const customExpressApp = express();
      app.setupRoutes(customExpressApp, '', undefined, customPath);

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
      app.setupRoutes(expressApp);
    });

    it('should handle single JSON-RPC response', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };

      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');

      const response = await request(expressApp).post('/').send(requestBody).expect(200);

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

      const response = await request(expressApp).post('/').send(requestBody).expect(200);

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
          throw new A2AError(-32603, 'Streaming error');
        },
      };

      handleStub.mockResolvedValue(mockErrorStream);

      const requestBody = createRpcRequest('stream-error-test', 'message/stream');

      const response = await request(expressApp).post('/').send(requestBody).expect(200);

      const responseText = response.text;
      assert.include(responseText, 'event: error');
      assert.include(responseText, 'Streaming error');
    });

    it('should handle immediate streaming error', async () => {
      const mockImmediateErrorStream = {
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw new A2AError(-32603, 'Immediate streaming error');
        },
      };

      handleStub.mockResolvedValue(mockImmediateErrorStream);

      const requestBody = createRpcRequest('immediate-stream-error-test', 'message/stream');

      const response = await request(expressApp).post('/').send(requestBody).expect(200);

      // Assert SSE headers and error event content
      assert.include(response.headers['content-type'], 'text/event-stream');
      assert.equal(response.headers['cache-control'], 'no-cache');
      assert.equal(response.headers['connection'], 'keep-alive');

      const responseText = response.text;
      assert.include(responseText, 'event: error');
      assert.include(responseText, 'Immediate streaming error');
    });

    it('should handle general processing error', async () => {
      const error = new A2AError(-32603, 'Processing error');
      handleStub.mockRejectedValue(error);

      const requestBody = createRpcRequest('error-test');

      const response = await request(expressApp).post('/').send(requestBody).expect(500);

      const expectedErrorResponse: JSONRPCErrorResponse = {
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

      const response = await request(expressApp).post('/').send(requestBody).expect(500);

      assert.equal(response.body.jsonrpc, '2.0');
      assert.equal(response.body.id, 'generic-error-test');
      assert.equal(response.body.error.message, 'General processing error.');
    });

    it('should handle request without id', async () => {
      const error = new A2AError(-32600, 'No ID error');
      handleStub.mockRejectedValue(error);

      const requestBody = createRpcRequest(null);

      const response = await request(expressApp).post('/').send(requestBody).expect(500);

      assert.equal(response.body.id, null);
    });

    it('should handle extensions headers in request', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'test-extension-uri, another-extension';

      await request(expressApp)
        .post('/')
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
      const mockResponse: JSONRPCSuccessResponse = {
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
      app.setupRoutes(middlewareApp, '', [testMiddleware]);

      await request(middlewareApp).get(`/${AGENT_CARD_PATH}`).expect(200);

      expect(middlewareCalled).toHaveBeenCalledTimes(1);
    });

    it('should handle middleware errors', async () => {
      const errorMiddleware = (_req: Request, _res: Response, next: NextFunction) => {
        next(new Error('Middleware error'));
      };

      const middlewareApp = express();
      app.setupRoutes(middlewareApp, '', [errorMiddleware]);

      await request(middlewareApp).get(`/${AGENT_CARD_PATH}`).expect(500);
    });

    it('should handle no authentication middlewares', async () => {
      app = new A2AExpressApp(mockRequestHandler);
      const middlewareApp = express();
      app.setupRoutes(middlewareApp);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp).post('/').send(requestBody).expect(200);

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

      app = new A2AExpressApp(mockRequestHandler, userExtractor);
      const middlewareApp = express();
      app.setupRoutes(middlewareApp, '', [authenticationMiddleware]);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp).post('/').send(requestBody).expect(200);

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

      app = new A2AExpressApp(mockRequestHandler, userExtractor);
      const middlewareApp = express();
      app.setupRoutes(middlewareApp, '', [authenticationMiddleware]);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp).post('/').send(requestBody).expect(200);

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

      app = new A2AExpressApp(mockRequestHandler);
      const middlewareApp = express();
      app.setupRoutes(middlewareApp, '', [authenticationMiddleware]);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.mockResolvedValue(mockResponse);

      const requestBody = createRpcRequest('test-id');
      await request(middlewareApp).post('/').send(requestBody).expect(200);

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
      app.setupRoutes(basedApp, baseUrl);

      await request(basedApp).get(`${baseUrl}/${AGENT_CARD_PATH}`).expect(200);
    });

    it('should handle empty baseUrl', async () => {
      const emptyBaseApp = express();
      app.setupRoutes(emptyBaseApp, '');

      await request(emptyBaseApp).get(`/${AGENT_CARD_PATH}`).expect(200);
    });

    it('should include express.json() middleware by default', async () => {
      const jsonApp = express();
      app.setupRoutes(jsonApp);

      const requestBody = createRpcRequest('test-id', 'message/send', {
        test: 'data',
      });

      await request(jsonApp).post('/').send(requestBody).expect(200);

      expect(handleStub).toHaveBeenCalledExactlyOnceWith(requestBody, expect.anything());
    });

    it('should handle malformed json request', async () => {
      const jsonApp = express();
      app.setupRoutes(jsonApp);

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
          code: -32700,
          message: 'Invalid JSON payload.',
        },
      };
      assert.deepEqual(response.body, expectedErrorResponse);
    });
  });
});

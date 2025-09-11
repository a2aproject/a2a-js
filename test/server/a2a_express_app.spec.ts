import 'mocha';
import { assert, expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';

import { A2AExpressApp } from '../../src/server/express/a2a_express_app.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../../src/server/transports/jsonrpc_transport_handler.js';
import { AgentCard, JSONRPCSuccessResponse, JSONRPCErrorResponse } from '../../src/index.js';
import { AGENT_CARD_PATH } from '../../src/constants.js';
import { A2AError } from '../../src/server/error.js';

describe('A2AExpressApp', () => {
    let mockRequestHandler: A2ARequestHandler;
    let mockJsonRpcTransportHandler: JsonRpcTransportHandler;
    let app: A2AExpressApp;
    let expressApp: Express;

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
            getAgentCard: sinon.stub().resolves(testAgentCard),
            getAuthenticatedExtendedAgentCard: sinon.stub(),
            sendMessage: sinon.stub(),
            sendMessageStream: sinon.stub(),
            getTask: sinon.stub(),
            cancelTask: sinon.stub(),
            setTaskPushNotificationConfig: sinon.stub(),
            getTaskPushNotificationConfig: sinon.stub(),
            listTaskPushNotificationConfigs: sinon.stub(),
            deleteTaskPushNotificationConfig: sinon.stub(),
            resubscribe: sinon.stub(),
        };
        
        app = new A2AExpressApp(mockRequestHandler);
        expressApp = express();
        
        // Mock the JsonRpcTransportHandler - accessing private property for testing
        // Note: This is a necessary testing approach given current A2AExpressApp design
        mockJsonRpcTransportHandler = sinon.createStubInstance(JsonRpcTransportHandler);
        (app as any).jsonRpcTransportHandler = mockJsonRpcTransportHandler;
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('constructor', () => {
        it('should create an instance with requestHandler and jsonRpcTransportHandler', () => {
            const newApp = new A2AExpressApp(mockRequestHandler);
            assert.instanceOf(newApp, A2AExpressApp);
            assert.equal((newApp as any).requestHandler, mockRequestHandler);
            assert.instanceOf((newApp as any).jsonRpcTransportHandler, JsonRpcTransportHandler);
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
            const response = await request(expressApp)
                .get(`/${AGENT_CARD_PATH}`)
                .expect(200);

            assert.deepEqual(response.body, testAgentCard);
            assert.isTrue((mockRequestHandler.getAgentCard as SinonStub).calledOnce);
        });

        it('should return agent card on custom path when agentCardPath is provided', async () => {
            const customPath = 'custom/agent-card.json';
            const customExpressApp = express();
            app.setupRoutes(customExpressApp, '', undefined, customPath);

            const response = await request(customExpressApp)
                .get(`/${customPath}`)
                .expect(200);

            assert.deepEqual(response.body, testAgentCard);
        });

        it('should handle errors when getting agent card', async () => {
            const errorMessage = 'Failed to get agent card';
            (mockRequestHandler.getAgentCard as SinonStub).rejects(new Error(errorMessage));

            const response = await request(expressApp)
                .get(`/${AGENT_CARD_PATH}`)
                .expect(500);

            assert.deepEqual(response.body, { error: 'Failed to retrieve agent card' });
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
                result: { message: 'success' }
            };

            (mockJsonRpcTransportHandler.handle as SinonStub).resolves(mockResponse);

            const requestBody = createRpcRequest('test-id');

            const response = await request(expressApp)
                .post('/')
                .send(requestBody)
                .expect(200);

            assert.deepEqual(response.body, mockResponse);
            assert.isTrue((mockJsonRpcTransportHandler.handle as SinonStub).calledOnceWith(requestBody));
        });

        it('should handle streaming JSON-RPC response', async () => {
            const mockStreamResponse = {
                async *[Symbol.asyncIterator]() {
                    yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
                    yield { jsonrpc: '2.0', id: 'stream-2', result: { step: 2 } };
                }
            };

            (mockJsonRpcTransportHandler.handle as SinonStub).resolves(mockStreamResponse);

            const requestBody = createRpcRequest('stream-test', 'message/stream');

            const response = await request(expressApp)
                .post('/')
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
                    throw new A2AError(-32603, 'Streaming error');
                }
            };

            (mockJsonRpcTransportHandler.handle as SinonStub).resolves(mockErrorStream);

            const requestBody = createRpcRequest('stream-error-test', 'message/stream');

            const response = await request(expressApp)
                .post('/')
                .send(requestBody)
                .expect(200);

            const responseText = response.text;
            assert.include(responseText, 'event: error');
            assert.include(responseText, 'Streaming error');
        });

        it('should handle immediate streaming error', async () => {
            const mockImmediateErrorStream = {
                async *[Symbol.asyncIterator]() {
                    throw new A2AError(-32603, 'Immediate streaming error');
                }
            };

            (mockJsonRpcTransportHandler.handle as SinonStub).resolves(mockImmediateErrorStream);

            const requestBody = createRpcRequest('immediate-stream-error-test', 'message/stream');

            const response = await request(expressApp)
                .post('/')
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
            const error = new A2AError(-32603, 'Processing error');
            (mockJsonRpcTransportHandler.handle as SinonStub).rejects(error);

            const requestBody = createRpcRequest('error-test');

            const response = await request(expressApp)
                .post('/')
                .send(requestBody)
                .expect(500);

            const expectedErrorResponse: JSONRPCErrorResponse = {
                jsonrpc: '2.0',
                id: 'error-test',
                error: {
                    code: -32603,
                    message: 'Processing error'
                }
            };

            assert.deepEqual(response.body, expectedErrorResponse);
        });

        it('should handle non-A2AError with fallback error handling', async () => {
            const genericError = new Error('Generic error');
            (mockJsonRpcTransportHandler.handle as SinonStub).rejects(genericError);

            const requestBody = createRpcRequest('generic-error-test');

            const response = await request(expressApp)
                .post('/')
                .send(requestBody)
                .expect(500);

            assert.equal(response.body.jsonrpc, '2.0');
            assert.equal(response.body.id, 'generic-error-test');
            assert.equal(response.body.error.message, 'General processing error.');
        });

        it('should handle request without id', async () => {
            const error = new A2AError(-32600, 'No ID error');
            (mockJsonRpcTransportHandler.handle as SinonStub).rejects(error);

            const requestBody = createRpcRequest(null);

            const response = await request(expressApp)
                .post('/')
                .send(requestBody)
                .expect(500);

            assert.equal(response.body.id, null);
        });
    });

    describe('middleware integration', () => {
        it('should apply custom middlewares to routes', async () => {
            const middlewareCalled = sinon.spy();
            const testMiddleware = (_req: Request, _res: Response, next: Function) => {
                middlewareCalled();
                next();
            };

            const middlewareApp = express();
            app.setupRoutes(middlewareApp, '', [testMiddleware]);

            await request(middlewareApp)
                .get(`/${AGENT_CARD_PATH}`)
                .expect(200);

            assert.isTrue(middlewareCalled.calledOnce);
        });

        it('should handle middleware errors', async () => {
            const errorMiddleware = (_req: Request, _res: Response, next: Function) => {
                next(new Error('Middleware error'));
            };

            const middlewareApp = express();
            app.setupRoutes(middlewareApp, '', [errorMiddleware]);

            await request(middlewareApp)
                .get(`/${AGENT_CARD_PATH}`)
                .expect(500);
        });
    });

    describe('route configuration', () => {
        it('should mount routes at baseUrl', async () => {
            const baseUrl = '/api/v1';
            const basedApp = express();
            app.setupRoutes(basedApp, baseUrl);

            await request(basedApp)
                .get(`${baseUrl}/${AGENT_CARD_PATH}`)
                .expect(200);
        });

        it('should handle empty baseUrl', async () => {
            const emptyBaseApp = express();
            app.setupRoutes(emptyBaseApp, '');

            await request(emptyBaseApp)
                .get(`/${AGENT_CARD_PATH}`)
                .expect(200);
        });

        it('should include express.json() middleware by default', async () => {
            const jsonApp = express();
            app.setupRoutes(jsonApp);

            const requestBody = { test: 'data' };
            (mockJsonRpcTransportHandler.handle as SinonStub).resolves({ 
                jsonrpc: '2.0', 
                id: 'json-test', 
                result: requestBody 
            });

            await request(jsonApp)
                .post('/')
                .send(requestBody)
                .expect(200);

            assert.isTrue((mockJsonRpcTransportHandler.handle as SinonStub).calledOnce);
        });
    });
});
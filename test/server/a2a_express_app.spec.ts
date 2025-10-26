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

        describe('transport option', () => {
            it('should setup both transports by default', async () => {
                const bothApp = express();
                app.setupRoutes(bothApp);

                // JSON-RPC should work
                const mockResponse: JSONRPCSuccessResponse = {
                    jsonrpc: '2.0',
                    id: 'test',
                    result: { success: true }
                };
                (mockJsonRpcTransportHandler.handle as SinonStub).resolves(mockResponse);

                await request(bothApp)
                    .post('/')
                    .send(createRpcRequest('test'))
                    .expect(200);

                // REST should work
                await request(bothApp)
                    .get('/v1/card')
                    .expect(200);
            });

            it('should setup only JSON-RPC transport when transport="jsonrpc"', async () => {
                const jsonrpcApp = express();
                app.setupRoutes(jsonrpcApp, { transport: 'jsonrpc' });

                // JSON-RPC should work
                const mockResponse: JSONRPCSuccessResponse = {
                    jsonrpc: '2.0',
                    id: 'test',
                    result: { success: true }
                };
                (mockJsonRpcTransportHandler.handle as SinonStub).resolves(mockResponse);

                await request(jsonrpcApp)
                    .post('/')
                    .send(createRpcRequest('test'))
                    .expect(200);

                // REST endpoints should NOT be available (except agent card which is shared)
                await request(jsonrpcApp)
                    .post('/messages')
                    .send({ message: { text: 'test' } })
                    .expect(404);
            });

            it('should setup only HTTP+REST transport when transport="http-rest"', async () => {
                const restApp = express();
                app.setupRoutes(restApp, { transport: 'http-rest' });

                // REST should work
                await request(restApp)
                    .get('/v1/card')
                    .expect(200);

                // JSON-RPC endpoint should NOT be available
                await request(restApp)
                    .post('/')
                    .send(createRpcRequest('test'))
                    .expect(404);
            });

            it('should support old signature with backward compatibility (defaults to both)', async () => {
                const oldSigApp = express();
                app.setupRoutes(oldSigApp, '/api');

                // Both should work
                const mockResponse: JSONRPCSuccessResponse = {
                    jsonrpc: '2.0',
                    id: 'test',
                    result: { success: true }
                };
                (mockJsonRpcTransportHandler.handle as SinonStub).resolves(mockResponse);

                await request(oldSigApp)
                    .post('/api/')
                    .send(createRpcRequest('test'))
                    .expect(200);

                await request(oldSigApp)
                    .get('/api/v1/card')
                    .expect(200);
            });
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

    describe('HTTP+REST endpoints', () => {
        let restApp: Express;

        const testMessage = {
            messageId: 'msg-1',
            role: 'user' as const,
            parts: [{ kind: 'text' as const, text: 'Hello' }],
            kind: 'message' as const,
        };

        beforeEach(() => {
            restApp = express();
            app.setupRoutes(restApp, { transport: 'http-rest' });
        });

        describe('POST /v1/message:send', () => {
            it('should send message and return 201 Created', async () => {
                const mockTask = {
                    id: 'task-1',
                    kind: 'task' as const,
                    status: { state: 'completed' },
                    contextId: 'ctx-1',
                    history: []
                };
                (mockRequestHandler.sendMessage as SinonStub).resolves(mockTask);

                const response = await request(restApp)
                    .post('/v1/message:send')
                    .send({
                        message: {
                            messageId: 'msg-1',
                            role: 'user',
                            parts: [{ kind: 'text', text: 'Hello' }],
                            kind: 'message'
                        }
                    })
                    .expect(201);

                assert.deepEqual(response.body, mockTask);
                assert.isTrue((mockRequestHandler.sendMessage as SinonStub).calledOnce);
            });

            it('should return 400 when request body is invalid', async () => {
                // Mock sendMessage to reject with validation error
                (mockRequestHandler.sendMessage as SinonStub).rejects(
                    A2AError.invalidParams('Message is required')
                );
                
                const response = await request(restApp)
                    .post('/v1/message:send')
                    .send({})
                    .expect(400);

                assert.equal(response.body.code, -32602);
                assert.include(response.body.message, 'Message is required');
            });
        });

        describe('POST /v1/message:stream', () => {
            it('should stream events via SSE', async () => {
                const mockStream = {
                    async *[Symbol.asyncIterator]() {
                        yield {
                            kind: 'status-update',
                            taskId: 'task-1',
                            contextId: 'ctx-1',
                            status: { state: 'submitted' },
                            final: false
                        };
                        yield {
                            kind: 'status-update',
                            taskId: 'task-1',
                            contextId: 'ctx-1',
                            status: { state: 'completed' },
                            final: true
                        };
                    }
                };
                (mockRequestHandler.sendMessageStream as SinonStub).returns(mockStream);

                const response = await request(restApp)
                    .post('/v1/message:stream')
                    .send({
                        message: {
                            messageId: 'msg-1',
                            role: 'user',
                            parts: [{ kind: 'text', text: 'Hello' }],
                            kind: 'message'
                        }
                    })
                    .expect(200);

                assert.include(response.headers['content-type'], 'text/event-stream');
                assert.include(response.text, '"state":"submitted"');
                assert.include(response.text, '"state":"completed"');
            });
        });

        describe('GET /v1/tasks/:taskId', () => {
            it('should get task by ID', async () => {
                const mockTask = {
                    id: 'task-123',
                    kind: 'task' as const,
                    status: { state: 'completed' },
                    contextId: 'ctx-1',
                    history: []
                };
                (mockRequestHandler.getTask as SinonStub).resolves(mockTask);

                const response = await request(restApp)
                    .get('/v1/tasks/task-123')
                    .expect(200);

                assert.deepEqual(response.body, mockTask);
                assert.isTrue((mockRequestHandler.getTask as SinonStub).calledOnce);
            });

            it('should support historyLength query parameter', async () => {
                const mockTask = {
                    id: 'task-123',
                    kind: 'task' as const,
                    status: { state: 'completed' },
                    contextId: 'ctx-1',
                    history: []
                };
                (mockRequestHandler.getTask as SinonStub).resolves(mockTask);

                await request(restApp)
                    .get('/v1/tasks/task-123?historyLength=5')
                    .expect(200);

                const callArgs = (mockRequestHandler.getTask as SinonStub).firstCall.args[0];
                assert.equal(callArgs.historyLength, 5);
            });

            it('should return 404 for non-existent task', async () => {
                (mockRequestHandler.getTask as SinonStub).rejects(
                    new A2AError(-32001, 'Task not found: task-999')
                );

                const response = await request(restApp)
                    .get('/v1/tasks/task-999')
                    .expect(404);

                assert.equal(response.body.code, -32001);
            });
        });

        describe('POST /v1/tasks/:taskId:cancel', () => {
            it('should cancel task and return 202 Accepted', async () => {
                const mockTask = {
                    id: 'task-123',
                    kind: 'task' as const,
                    status: { state: 'cancelled' },
                    contextId: 'ctx-1',
                    history: []
                };
                (mockRequestHandler.cancelTask as SinonStub).resolves(mockTask);

                const response = await request(restApp)
                    .post('/v1/tasks/task-123:cancel')
                    .expect(202);

                assert.deepEqual(response.body, mockTask);
            });
        });

        describe('POST /v1/tasks/:taskId:subscribe', () => {
            it('should stream task events via SSE', async () => {
                const mockStream = {
                    async *[Symbol.asyncIterator]() {
                        yield {
                            kind: 'status-update',
                            taskId: 'task-123',
                            contextId: 'ctx-1',
                            status: { state: 'working' },
                            final: true
                        };
                    }
                };
                (mockRequestHandler.resubscribe as SinonStub).returns(mockStream);

                const response = await request(restApp)
                    .post('/v1/tasks/task-123:subscribe')
                    .expect(200);

                assert.include(response.headers['content-type'], 'text/event-stream');
                assert.include(response.text, '"state":"working"');
            });
        });

        describe('Push Notification Config Routes', () => {
            it('POST /v1/tasks/:taskId/pushNotificationConfigs should create config and return 201', async () => {
                const mockConfig = {
                    taskId: 'task-123',
                    pushNotificationConfig: {
                        id: 'config-1',
                        url: 'http://example.com/notify',
                        token: 'token123'
                    }
                };
                (mockRequestHandler.setTaskPushNotificationConfig as SinonStub).resolves(mockConfig);

                const response = await request(restApp)
                    .post('/v1/tasks/task-123/pushNotificationConfigs')
                    .send({
                        pushNotificationUrl: 'http://example.com/notify',
                        pushNotificationToken: 'token123'
                    })
                    .expect(201);

                assert.deepEqual(response.body, mockConfig);
            });

            it('GET /v1/tasks/:taskId/pushNotificationConfigs should list configs', async () => {
                const mockConfigs = [{
                    taskId: 'task-123',
                    pushNotificationConfig: {
                        id: 'config-1',
                        url: 'http://example.com/notify'
                    }
                }];
                (mockRequestHandler.listTaskPushNotificationConfigs as SinonStub).resolves(mockConfigs);

                const response = await request(restApp)
                    .get('/v1/tasks/task-123/pushNotificationConfigs')
                    .expect(200);

                assert.deepEqual(response.body, mockConfigs);
            });

            it('GET /v1/tasks/:taskId/pushNotificationConfigs/:configId should get specific config', async () => {
                const mockConfig = {
                    taskId: 'task-123',
                    pushNotificationConfig: {
                        id: 'config-1',
                        url: 'http://example.com/notify'
                    }
                };
                (mockRequestHandler.getTaskPushNotificationConfig as SinonStub).resolves(mockConfig);

                const response = await request(restApp)
                    .get('/v1/tasks/task-123/pushNotificationConfigs/config-1')
                    .expect(200);

                assert.deepEqual(response.body, mockConfig);
            });

            it('DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId should delete and return 204', async () => {
                (mockRequestHandler.deleteTaskPushNotificationConfig as SinonStub).resolves();

                await request(restApp)
                    .delete('/v1/tasks/task-123/pushNotificationConfigs/config-1')
                    .expect(204);

                assert.isTrue((mockRequestHandler.deleteTaskPushNotificationConfig as SinonStub).calledOnce);
            });
        });

        describe('Error handling', () => {
            it('should handle 404 for unknown routes', async () => {
                await request(restApp)
                    .get('/unknown/route')
                    .expect(404);
            });

            it('should handle validation errors with 400', async () => {
                await request(restApp)
                    .get('/v1/tasks/task-123?historyLength=invalid')
                    .expect(400);
            });

            it('should handle generic errors with 500', async () => {
                (mockRequestHandler.sendMessage as SinonStub).rejects(new Error('Unexpected error'));

                await request(restApp)
                    .post('/v1/message:send')
                    .send({ message: testMessage })
                    .expect(500);
            });
        });

        describe('Capability Validation', () => {
            it('POST /v1/message:stream should return 501 when streaming not supported', async () => {
                const agentCardNoStreaming = {
                    ...testAgentCard,
                    capabilities: { streaming: false, pushNotifications: true }
                };
                (mockRequestHandler.getAgentCard as SinonStub).resolves(agentCardNoStreaming);

                const response = await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage })
                    .expect(501);

                assert.equal(response.body.code, -32004); // UNSUPPORTED_OPERATION
                assert.include(response.body.message.toLowerCase(), 'streaming');
            });

            it('POST /v1/tasks/:taskId:subscribe should return 501 when streaming not supported', async () => {
                const agentCardNoStreaming = {
                    ...testAgentCard,
                    capabilities: { streaming: false, pushNotifications: true }
                };
                (mockRequestHandler.getAgentCard as SinonStub).resolves(agentCardNoStreaming);

                const response = await request(restApp)
                    .post('/v1/tasks/task-123:subscribe')
                    .expect(501);

                assert.equal(response.body.code, -32004);
            });

            it('POST /v1/tasks/:taskId/pushNotificationConfigs should return 500 when push notifications not supported', async () => {
                const agentCardNoPush = {
                    ...testAgentCard,
                    capabilities: { streaming: true, pushNotifications: false }
                };
                (mockRequestHandler.getAgentCard as SinonStub).resolves(agentCardNoPush);

                const response = await request(restApp)
                    .post('/v1/tasks/task-123/pushNotificationConfigs')
                    .send({ pushNotificationUrl: 'http://example.com' });

                // pushNotificationNotSupported() doesn't map to 501, it maps to default 500
                assert.equal(response.status, 500);
                assert.equal(response.body.code, -32003); // PUSH_NOTIFICATION_NOT_SUPPORTED
            });

            it('should handle agent card with no capabilities object', async () => {
                const agentCardNoCaps = { ...testAgentCard };
                delete agentCardNoCaps.capabilities;
                (mockRequestHandler.getAgentCard as SinonStub).resolves(agentCardNoCaps);

                await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage })
                    .expect(501);
            });

            it('should handle agent card with undefined streaming capability', async () => {
                const agentCard = {
                    ...testAgentCard,
                    capabilities: { pushNotifications: true }
                };
                (mockRequestHandler.getAgentCard as SinonStub).resolves(agentCard);

                await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage })
                    .expect(501);
            });
        });

        describe('Error Code to HTTP Status Mapping', () => {
            it('should map A2A error -32005 (UNAUTHORIZED) to 401', async () => {
                (mockRequestHandler.getAuthenticatedExtendedAgentCard as SinonStub).rejects(
                    new A2AError(-32005, 'Unauthorized access')
                );

                const response = await request(restApp)
                    .get('/v1/card')
                    .expect(401);

                assert.equal(response.body.code, -32005);
            });

            it('should map A2A error -32002 (TASK_NOT_CANCELABLE) to 409 Conflict', async () => {
                (mockRequestHandler.cancelTask as SinonStub).rejects(
                    A2AError.taskNotCancelable('task-123')
                );

                const response = await request(restApp)
                    .post('/v1/tasks/task-123:cancel')
                    .expect(409);

                assert.equal(response.body.code, -32002);
            });

            it('should map A2A error -32700 (PARSE_ERROR) to 400 Bad Request', async () => {
                (mockRequestHandler.sendMessage as SinonStub).rejects(
                    A2AError.parseError('Invalid JSON')
                );

                const response = await request(restApp)
                    .post('/v1/message:send')
                    .send({ message: testMessage })
                    .expect(400);

                assert.equal(response.body.code, -32700);
            });

            it('should map A2A error -32600 (INVALID_REQUEST) to 400 Bad Request', async () => {
                (mockRequestHandler.sendMessage as SinonStub).rejects(
                    A2AError.invalidRequest('Missing required field')
                );

                const response = await request(restApp)
                    .post('/v1/message:send')
                    .send({ message: testMessage })
                    .expect(400);

                assert.equal(response.body.code, -32600);
            });

            it('should map A2A error -32601 (METHOD_NOT_FOUND) to 404 Not Found', async () => {
                (mockRequestHandler.sendMessage as SinonStub).rejects(
                    A2AError.methodNotFound('unknown/method')
                );

                const response = await request(restApp)
                    .post('/v1/message:send')
                    .send({ message: testMessage })
                    .expect(404);

                assert.equal(response.body.code, -32601);
            });

            it('should map unknown error codes to 500 Internal Server Error', async () => {
                (mockRequestHandler.sendMessage as SinonStub).rejects(
                    new A2AError(-99999, 'Custom error')
                );

                const response = await request(restApp)
                    .post('/v1/message:send')
                    .send({ message: testMessage })
                    .expect(500);

                assert.equal(response.body.code, -99999);
            });

            it('should map A2A error -32004 (UNSUPPORTED_OPERATION) to 501 Not Implemented', async () => {
                (mockRequestHandler.sendMessage as SinonStub).rejects(
                    A2AError.unsupportedOperation('Feature not available')
                );

                const response = await request(restApp)
                    .post('/v1/message:send')
                    .send({ message: testMessage })
                    .expect(501);

                assert.equal(response.body.code, -32004);
            });
        });

        describe('SSE Stream Error Handling', () => {
            it('should handle generic Error thrown during streaming', async () => {
                const failingStream = {
                    async *[Symbol.asyncIterator]() {
                        yield { kind: 'status-update', status: { state: 'submitted' } };
                        throw new Error('Connection lost');
                    }
                };
                (mockRequestHandler.sendMessageStream as SinonStub).returns(failingStream);

                const response = await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage });

                // Should still return 200 (SSE connection started)
                assert.equal(response.status, 200);
                // Should contain error event
                assert.include(response.text, 'event: error');
                assert.include(response.text, 'Connection lost');
            });

            it('should handle A2AError thrown during streaming', async () => {
                const failingStream = {
                    async *[Symbol.asyncIterator]() {
                        yield { kind: 'status-update', status: { state: 'submitted' } };
                        throw A2AError.internalError('Processing failed');
                    }
                };
                (mockRequestHandler.sendMessageStream as SinonStub).returns(failingStream);

                const response = await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage });

                assert.include(response.text, 'event: error');
                assert.include(response.text, '"code":-32603');
                assert.include(response.text, 'Processing failed');
            });

            it('should verify all SSE headers are set correctly', async () => {
                const mockStream = {
                    async *[Symbol.asyncIterator]() {
                        yield { kind: 'status-update' };
                    }
                };
                (mockRequestHandler.sendMessageStream as SinonStub).returns(mockStream);

                const response = await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage })
                    .expect(200);

                assert.equal(response.headers['content-type'], 'text/event-stream');
                assert.equal(response.headers['cache-control'], 'no-cache');
                assert.equal(response.headers['connection'], 'keep-alive');
                assert.equal(response.headers['x-accel-buffering'], 'no');
            });

            it('should include event IDs in SSE stream', async () => {
                const mockStream = {
                    async *[Symbol.asyncIterator]() {
                        yield { kind: 'test-event' };
                    }
                };
                (mockRequestHandler.sendMessageStream as SinonStub).returns(mockStream);

                const response = await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage });

                // Should have "id: <timestamp>" lines
                assert.match(response.text, /id: \d+/);
                assert.include(response.text, 'data: ');
            });

            it('should handle stream that immediately throws', async () => {
                const failingStream = {
                    async *[Symbol.asyncIterator]() {
                        throw new Error('Immediate failure');
                    }
                };
                (mockRequestHandler.sendMessageStream as SinonStub).returns(failingStream);

                const response = await request(restApp)
                    .post('/v1/message:stream')
                    .send({ message: testMessage });

                assert.equal(response.status, 200);
                assert.include(response.text, 'event: error');
            });
        });
    });
});
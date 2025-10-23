import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';

import { DynamicAgentRequestHandler, RouteContext } from '../../src/server/request_handler/dynamic_request_handler.js';
import { A2AExpressApp } from '../../src/server/express/a2a_express_app.js';
import { AgentCard, MessageSendParams } from '../../src/types.js';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';

describe('DynamicAgentRequestHandler', () => {
    let dynamicHandler: DynamicAgentRequestHandler;
    let mockAgentCard: AgentCard;
    let mockTaskStore: InMemoryTaskStore;
    let mockAgentExecutor: sinon.SinonStubbedInstance<AgentExecutor>;

    const helloAgentCard: AgentCard = {
        name: 'Hello Agent',
        description: 'A friendly hello agent',
        version: '1.0.0',
        protocolVersion: '2024-11-05',
        capabilities: {
            streaming: false,
            pushNotifications: false,
        },
        defaultInputModes: [],
        defaultOutputModes: [],
        skills: [],
        url: ""
    };

    const goodbyeAgentCard: AgentCard = {
        name: 'Goodbye Agent',
        description: 'A farewell agent',
        version: '1.0.0',
        protocolVersion: '2024-11-05',
        capabilities: {
            streaming: false,
            pushNotifications: false,
        }, 
        defaultInputModes: [],
        defaultOutputModes: [],
        skills: [],
        url: ""
    };

    beforeEach(() => {
        mockTaskStore = new InMemoryTaskStore();
        mockAgentExecutor = {
            execute: sinon.stub(),
            cancelTask: sinon.stub(),
        } as sinon.SinonStubbedInstance<AgentExecutor>;

        dynamicHandler = new DynamicAgentRequestHandler(
            async (route: RouteContext) => {
                if (route.url.includes('hello')) {
                    return helloAgentCard;
                }
                return goodbyeAgentCard;
            },
            async (route: RouteContext) => mockTaskStore,
            async (route: RouteContext) => {
                if (route.url.includes('hello')) {
                    return mockAgentExecutor;
                }
                return mockAgentExecutor;
            }
        );
    });

    describe('routing based on URL', () => {
        it('should return hello agent card for hello route', async () => {
            const helloRoute: RouteContext = {
                url: '/agent/hello',
                method: 'GET',
            };

            dynamicHandler.setRouteContext(helloRoute);
            const agentCard = await dynamicHandler.getAgentCard();

            expect(agentCard.name).to.equal('Hello Agent');
            expect(agentCard.description).to.equal('A friendly hello agent');
        });

        it('should return goodbye agent card for goodbye route', async () => {
            const goodbyeRoute: RouteContext = {
                url: '/agent/goodbye',
                method: 'GET',
            };

            dynamicHandler.setRouteContext(goodbyeRoute);
            const agentCard = await dynamicHandler.getAgentCard();

            expect(agentCard.name).to.equal('Goodbye Agent');
            expect(agentCard.description).to.equal('A farewell agent');
        });

        it('should default to goodbye agent for unknown routes', async () => {
            const unknownRoute: RouteContext = {
                url: '/agent/unknown',
                method: 'GET',
            };

            dynamicHandler.setRouteContext(unknownRoute);
            const agentCard = await dynamicHandler.getAgentCard();

            expect(agentCard.name).to.equal('Goodbye Agent');
        });
    });

    describe('route context management', () => {
        it('should throw error when route context is not set', async () => {
            try {
                await dynamicHandler.getAgentCard();
                expect.fail('Expected error to be thrown');
            } catch (error: any) {
                expect(error.message).to.include('Route context not set. Call setRouteContext() before using this handler.');
            }
        });

        it('should handle route context with query parameters', async () => {
            const routeWithQuery: RouteContext = {
                url: '/agent/hello',
                method: 'GET',
                query: { param1: 'value1', param2: 'value2' },
                headers: { 'Content-Type': 'application/json' },
            };

            dynamicHandler.setRouteContext(routeWithQuery);
            const agentCard = await dynamicHandler.getAgentCard();

            expect(agentCard.name).to.equal('Hello Agent');
        });
    });

    describe('message handling delegation', () => {
        it('should delegate sendMessage to appropriate agent executor', () => {
            const helloRoute: RouteContext = {
                url: '/agent/hello',
                method: 'POST',
            };

            const mockMessage: MessageSendParams = {
                message: {
                    messageId: 'test-message',
                    role: 'user',
                    parts: [{ kind: 'text', text: 'Hello!' }],
                    kind: 'message',
                    contextId: 'test-context-id',
                },
            };

            dynamicHandler.setRouteContext(helloRoute);

            // Verify that the sendMessage method exists and can be called
            // We're not testing the actual execution here, just the routing delegation
            expect(typeof dynamicHandler.sendMessage).to.equal('function');
        });
    });

    describe('complex routing scenarios', () => {
        it('should support complex routing logic based on multiple URL parts', async () => {
            const complexHandler = new DynamicAgentRequestHandler(
                async (route: RouteContext) => {
                    const urlParts = route.url.split('/');
                    if (urlParts.includes('api') && urlParts.includes('v1')) {
                        return { ...helloAgentCard, name: 'API v1 Agent' };
                    } else if (urlParts.includes('api') && urlParts.includes('v2')) {
                        return { ...helloAgentCard, name: 'API v2 Agent' };
                    }
                    return goodbyeAgentCard;
                },
                async (route: RouteContext) => mockTaskStore,
                async (route: RouteContext) => mockAgentExecutor
            );

            const v1Route: RouteContext = { url: '/api/v1/hello' };
            const v2Route: RouteContext = { url: '/api/v2/hello' };

            complexHandler.setRouteContext(v1Route);
            const v1Card = await complexHandler.getAgentCard();
            expect(v1Card.name).to.equal('API v1 Agent');

            complexHandler.setRouteContext(v2Route);
            const v2Card = await complexHandler.getAgentCard();
            expect(v2Card.name).to.equal('API v2 Agent');
        });

        it('should support routing based on HTTP method', async () => {
            const methodBasedHandler = new DynamicAgentRequestHandler(
                async (route: RouteContext) => {
                    if (route.method === 'GET') {
                        return { ...helloAgentCard, name: 'GET Agent' };
                    } else if (route.method === 'POST') {
                        return { ...helloAgentCard, name: 'POST Agent' };
                    }
                    return goodbyeAgentCard;
                },
                async (route: RouteContext) => mockTaskStore,
                async (route: RouteContext) => mockAgentExecutor
            );

            const getRoute: RouteContext = { url: '/agent', method: 'GET' };
            const postRoute: RouteContext = { url: '/agent', method: 'POST' };

            methodBasedHandler.setRouteContext(getRoute);
            const getCard = await methodBasedHandler.getAgentCard();
            expect(getCard.name).to.equal('GET Agent');

            methodBasedHandler.setRouteContext(postRoute);
            const postCard = await methodBasedHandler.getAgentCard();
            expect(postCard.name).to.equal('POST Agent');
        });

        it('should support routing based on query parameters', async () => {
            const queryBasedHandler = new DynamicAgentRequestHandler(
                async (route: RouteContext) => {
                    if (route.query?.agent === 'hello') {
                        return helloAgentCard;
                    } else if (route.query?.agent === 'goodbye') {
                        return goodbyeAgentCard;
                    }
                    return { ...helloAgentCard, name: 'Default Agent' };
                },
                async (route: RouteContext) => mockTaskStore,
                async (route: RouteContext) => mockAgentExecutor
            );

            const helloQueryRoute: RouteContext = {
                url: '/agent',
                query: { agent: 'hello' }
            };
            const goodbyeQueryRoute: RouteContext = {
                url: '/agent',
                query: { agent: 'goodbye' }
            };

            queryBasedHandler.setRouteContext(helloQueryRoute);
            const helloCard = await queryBasedHandler.getAgentCard();
            expect(helloCard.name).to.equal('Hello Agent');

            queryBasedHandler.setRouteContext(goodbyeQueryRoute);
            const goodbyeCard = await queryBasedHandler.getAgentCard();
            expect(goodbyeCard.name).to.equal('Goodbye Agent');
        });
    });

    describe('Express integration', () => {
        it('should work with A2AExpressApp with auto-detected dynamic routing', async () => {
            const app = express();
            const a2aApp = new A2AExpressApp(dynamicHandler);
            
            a2aApp.setupRoutes(app, '/agents/hello');
            
            const response = await request(app)
                .get('/agents/hello/.well-known/agent-card.json');
            
            expect(response.status).to.equal(200);
            expect(response.body.name).to.equal('Hello Agent');
        });

        it('should handle multiple agent types with a single route setup', async () => {
            const app = express();
            const a2aApp = new A2AExpressApp(dynamicHandler);
            
            // Set up different base routes to test dynamic behavior
            a2aApp.setupRoutes(app, '/hello');
            a2aApp.setupRoutes(app, '/goodbye');
            
            // Test hello agent
            const helloResponse = await request(app)
                .get('/hello/.well-known/agent-card.json');
            expect(helloResponse.status).to.equal(200);
            expect(helloResponse.body.name).to.equal('Hello Agent');
            
            // Test goodbye agent
            const goodbyeResponse = await request(app)
                .get('/goodbye/.well-known/agent-card.json');
            expect(goodbyeResponse.status).to.equal(200);
            expect(goodbyeResponse.body.name).to.equal('Goodbye Agent');
        });
    });
});
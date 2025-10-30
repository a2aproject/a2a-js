import 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';

import { JsonRpcTransportHandler } from '../../src/server/transports/jsonrpc_transport_handler.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { JSONRPCErrorResponse } from '../../src/index.js';

describe('JsonRpcTransportHandler', () => {
    let mockRequestHandler: A2ARequestHandler;
    let transportHandler: JsonRpcTransportHandler;

    beforeEach(() => {
        mockRequestHandler = {
            getAgentCard: sinon.stub(),
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
        transportHandler = new JsonRpcTransportHandler(mockRequestHandler);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('Check JSON-RPC request format', () => {
        it('should return a parse error for an invalid JSON string', async () => {
            const invalidJson = '{ "jsonrpc": "2.0", "method": "foo", "id": 1, }'; // trailing comma
            const response = await transportHandler.handle(invalidJson) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32700); // Parse error
        });

        it('should return a parse error for a non-string/non-object request body', async () => {
            const response = await transportHandler.handle(123) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32700); // Parse error
            expect(response.error.message).to.equal('Invalid request body type.');
        });

        it('should return an invalid request error for missing jsonrpc property', async () => {
            const request = { method: 'foo', id: 1 };
            const response = await transportHandler.handle(request) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32600); // Invalid Request
            expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
            expect(response.id).to.equal(1);
        });

        it('should return an invalid request error for incorrect jsonrpc version', async () => {
            const request = { jsonrpc: '1.0', method: 'foo', id: 1 };
            const response = await transportHandler.handle(request) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32600); // Invalid Request
            expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
            expect(response.id).to.equal(1);
        });

        it('should return an invalid request error for missing method property', async () => {
            const request = { jsonrpc: '2.0', id: 1 };
            const response = await transportHandler.handle(request) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32600); // Invalid Request
            expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
            expect(response.id).to.equal(1);
        });

        it('should return an invalid request error for non-string method property', async () => {
            const request = { jsonrpc: '2.0', method: 123, id: 1 };
            const response = await transportHandler.handle(request) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32600); // Invalid Request
            expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
            expect(response.id).to.equal(1);
        });

        it('should return an invalid request error for invalid id type (object)', async () => {
            const request = { jsonrpc: '2.0', method: 'foo', id: {} };
            const response = await transportHandler.handle(request) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32600); // Invalid Request
            expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
            expect(response.id).to.deep.equal({});
        });

        it('should return an invalid request error for invalid id type (float)', async () => {
            const request = { jsonrpc: '2.0', method: 'foo', id: 1.23 };
            const response = await transportHandler.handle(request) as JSONRPCErrorResponse;
            expect(response.error.code).to.equal(-32600); // Invalid Request
            expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
            expect(response.id).to.equal(1.23);
        });

        it('should handle valid request with string id', async () => {
            const request = { jsonrpc: '2.0', method: 'message/send', id: 'abc-123', params: {} };
            const response = await transportHandler.handle(request);
            expect(response).to.have.property('result');
        });

        it('should handle valid request with integer id', async () => {
            const request = { jsonrpc: '2.0', method: 'message/send', id: 456, params: {} };
            const response = await transportHandler.handle(request);
            expect(response).to.have.property('result');
        });

        it('should handle valid request with null id', async () => {
            const request = { jsonrpc: '2.0', method: 'message/send', id: null, params: {} };
            (mockRequestHandler.getAuthenticatedExtendedAgentCard as sinon.SinonStub).resolves({ card: 'data' });
            const response = await transportHandler.handle(request);
            expect(response).to.have.property('result');
        });

        const invalidParamsCases = [
            { name: 'null', params: null },
            { name: 'undefined', params: undefined },
            { name: 'a string', params: 'invalid' },
            { name: 'an array', params: [1, 2, 3] },
            { name: 'an object with an empty string key', params: { '': 'invalid' } },
        ];

        invalidParamsCases.forEach(({ name, params }) => {
            it(`should return an invalid params error if params are ${name}`, async () => {
                const request = { jsonrpc: '2.0', method: 'message/send', id: 1, params };
                const response = await transportHandler.handle(request) as JSONRPCErrorResponse;
                expect(response.error.code).to.equal(-32602); // Invalid Params
                expect(response.error.message).to.equal("Invalid method parameters.");
                expect(response.id).to.equal(1);
            });
        });

        it('should handle valid request with params as dict', async () => {
            const request = { jsonrpc: '2.0', method: 'message/send', id: 456, params: {"this": "is a dict"} };
            const response = await transportHandler.handle(request);
            expect(response).to.have.property('result');
        });
    });
});

import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';

import { JsonRpcTransportHandler } from '../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { JSONRPCErrorResponse } from '../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import {
  RequestMalformedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  AuthenticatedExtendedCardNotConfiguredError,
  A2A_ERROR_CODE,
  GenericError,
} from '../../src/errors.js';

describe('JsonRpcTransportHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let transportHandler: JsonRpcTransportHandler;

  beforeEach(() => {
    mockRequestHandler = {
      getAgentCard: vi.fn(),
      getAuthenticatedExtendedAgentCard: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'default-id' }),
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
    transportHandler = new JsonRpcTransportHandler(mockRequestHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Check JSON-RPC request format', () => {
    it('should return an invalid params error for an invalid JSON string', async () => {
      const invalidJson = '{ "jsonrpc": "2.0", "method": "foo", "id": 1, }'; // trailing comma
      const response = (await transportHandler.handle(invalidJson)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
    });

    it('should return an invalid params error for a non-string/non-object request body', async () => {
      const response = (await transportHandler.handle(123)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid request body type.');
    });

    it('should return an invalid params error for missing jsonrpc property', async () => {
      const request = { method: 'foo', id: 1 };
      const response = (await transportHandler.handle(request)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for incorrect jsonrpc version', async () => {
      const request = { jsonrpc: '1.0', method: 'foo', id: 1 };
      const response = (await transportHandler.handle(request)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for missing method property', async () => {
      const request = { jsonrpc: '2.0', id: 1 };
      const response = (await transportHandler.handle(request)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for non-string method property', async () => {
      const request = { jsonrpc: '2.0', method: 123, id: 1 };
      const response = (await transportHandler.handle(request)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for invalid id type (object)', async () => {
      const request = { jsonrpc: '2.0', method: 'foo', id: {} };
      const response = (await transportHandler.handle(request)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.deep.equal({});
    });

    it('should return an invalid params error for invalid id type (float)', async () => {
      const request = { jsonrpc: '2.0', method: 'foo', id: 1.23 };
      const response = (await transportHandler.handle(request)) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1.23);
    });

    it('should handle valid request with string id', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 'abc-123',
        params: {},
      };
      const response = await transportHandler.handle(request);
      expect(response).to.have.property('result');
    });

    it('should handle valid request with integer id', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 456,
        params: {},
      };
      const response = await transportHandler.handle(request);
      expect(response).to.have.property('result');
    });

    it('should handle valid request with null id', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'message/send',
        id: null,
        params: {},
      } as any;
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockResolvedValue({
        card: 'data',
      });
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
        const request = {
          jsonrpc: '2.0',
          method: 'message/send',
          id: 1,
          params,
        };
        const response = (await transportHandler.handle(request)) as JSONRPCErrorResponse;
        expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
        expect(response.error.message).to.equal('Invalid method parameters.');
        expect(response.id).to.equal(1);
      });
    });

    it('should handle valid request with params as dict', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 456,
        params: { this: 'is a dict' },
      };
      const response = await transportHandler.handle(request);
      expect(response).to.have.property('result');
    });
  });

  describe('Error mapping', () => {
    it('should map RequestMalformedError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new RequestMalformedError('Error message')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(mappedError.message).to.equal('Error message');
    });

    it('should map TaskNotFoundError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new TaskNotFoundError('Task Not Found')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.TASK_NOT_FOUND);
      expect(mappedError.message).to.equal('Task Not Found');
    });

    it('should map TaskNotCancelableError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new TaskNotCancelableError('Task Not Cancelable')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.TASK_NOT_CANCELABLE);
      expect(mappedError.message).to.equal('Task Not Cancelable');
    });

    it('should map PushNotificationNotSupportedError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new PushNotificationNotSupportedError('Push Notification Not Supported')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED);
      expect(mappedError.message).to.equal('Push Notification Not Supported');
    });

    it('should map UnsupportedOperationError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new UnsupportedOperationError('Unsupported Operation')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.UNSUPPORTED_OPERATION);
      expect(mappedError.message).to.equal('Unsupported Operation');
    });

    it('should map ContentTypeNotSupportedError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new ContentTypeNotSupportedError('Content Type Not Supported')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED);
      expect(mappedError.message).to.equal('Content Type Not Supported');
    });

    it('should map InvalidAgentResponseError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new InvalidAgentResponseError('Invalid Agent Response')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.INVALID_AGENT_RESPONSE);
      expect(mappedError.message).to.equal('Invalid Agent Response');
    });

    it('should map AuthenticatedExtendedCardNotConfiguredError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new AuthenticatedExtendedCardNotConfiguredError(
          'Authenticated Extended Card Not Configured'
        )
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED);
      expect(mappedError.message).to.equal('Authenticated Extended Card Not Configured');
    });

    it('should map RequestMalformedError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new RequestMalformedError('Request Malformed')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(mappedError.message).to.equal('Request Malformed');
    });

    it('should map GenericError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new GenericError('Generic Error')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.INTERNAL_ERROR);
      expect(mappedError.message).to.equal('Generic Error');
    });
  });
});

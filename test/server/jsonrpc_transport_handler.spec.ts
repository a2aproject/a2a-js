import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';

import { JsonRpcTransportHandler } from '../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { JSONRPCErrorResponse } from '../../src/core.js';
import { ServerCallContext } from '../../src/server/context.js';
import {
  RequestMalformedError,
  TaskNotFoundError,
  A2A_ERROR_CODE,
  A2AError,
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  UnsupportedOperationError,
} from '../../src/errors/index.js';

describe('JsonRpcTransportHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let transportHandler: JsonRpcTransportHandler;
  let defaultContext: ServerCallContext;

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
    defaultContext = new ServerCallContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Check JSON-RPC request format', () => {
    it('should return an invalid params error for an invalid JSON string', async () => {
      const invalidJson = '{ "jsonrpc": "2.0", "method": "foo", "id": 1, }'; // trailing comma
      const response = (await transportHandler.handle(
        invalidJson,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
    });

    it('should return an invalid params error for a non-string/non-object request body', async () => {
      const response = (await transportHandler.handle(
        123 as any,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid request body type.');
    });

    it('should return an invalid params error for missing jsonrpc property', async () => {
      const request = { method: 'foo', id: 1 };
      const response = (await transportHandler.handle(
        request,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for incorrect jsonrpc version', async () => {
      const request = { jsonrpc: '1.0', method: 'foo', id: 1 };
      const response = (await transportHandler.handle(
        request,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for missing method property', async () => {
      const request = { jsonrpc: '2.0', id: 1 };
      const response = (await transportHandler.handle(
        request,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for non-string method property', async () => {
      const request = { jsonrpc: '2.0', method: 123, id: 1 };
      const response = (await transportHandler.handle(
        request,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1);
    });

    it('should return an invalid params error for invalid id type (object)', async () => {
      const request = { jsonrpc: '2.0', method: 'foo', id: {} };
      const response = (await transportHandler.handle(
        request,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.deep.equal({});
    });

    it('should return an invalid params error for invalid id type (float)', async () => {
      const request = { jsonrpc: '2.0', method: 'foo', id: 1.23 };
      const response = (await transportHandler.handle(
        request,
        defaultContext
      )) as JSONRPCErrorResponse;
      expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(response.error.message).to.equal('Invalid JSON-RPC Request.');
      expect(response.id).to.equal(1.23);
    });

    it('should handle valid request with string id', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: 'abc-123',
        params: {},
      };
      const response = await transportHandler.handle(request, defaultContext);
      expect(response).to.have.property('result');
    });

    it('should handle valid request with integer id', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: 456,
        params: {},
      };
      const response = await transportHandler.handle(request, defaultContext);
      expect(response).to.have.property('result');
    });

    it('should handle valid request with null id', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: null,
        params: {},
      } as any;
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockResolvedValue({
        card: 'data',
      });
      const response = await transportHandler.handle(request, defaultContext);
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
          method: 'SendMessage',
          id: 1,
          params,
        };
        const response = (await transportHandler.handle(
          request,
          defaultContext
        )) as JSONRPCErrorResponse;
        expect(response.error.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
        expect(response.error.message).to.equal('Invalid method parameters.');
        expect(response.id).to.equal(1);
      });
    });

    it('should handle valid request with params as dict', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: 456,
        params: { this: 'is a dict' },
      };
      const response = await transportHandler.handle(request, defaultContext);
      expect(response).to.have.property('result');
    });
  });

  describe('Method handling', () => {
    it('should pass tenant from params to getAuthenticatedExtendedAgentCard', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'GetExtendedAgentCard',
        id: 1,
        params: { tenant: 'test-tenant' },
      };
      await transportHandler.handle(request, defaultContext);

      expect(mockRequestHandler.getAuthenticatedExtendedAgentCard).toHaveBeenCalledWith(
        expect.objectContaining({ tenant: 'test-tenant' }),
        expect.anything()
      );
    });
  });

  describe('ListTasks serialization (§3.1.4)', () => {
    const listTasks = async (params: Record<string, unknown>) => {
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 'ListTasks', id: 1, params },
        defaultContext
      )) as { result: Record<string, unknown> };
      return response.result;
    };

    const taskWithArtifacts = (artifacts: unknown[]): Record<string, unknown> => ({
      id: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'TASK_STATE_COMPLETED' },
      artifacts,
      history: [],
      metadata: undefined,
    });

    it('emits the required pagination fields for an empty page', async () => {
      // Default ProtoJSON elides all four at their default values, but
      // §3.1.4 requires `nextPageToken` to always be present (empty string
      // on the final page), and the reference SDKs emit the other three too.
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({
        tasks: [],
        nextPageToken: '',
        pageSize: 20,
        totalSize: 0,
      });

      expect(await listTasks({ pageSize: 20 })).toEqual({
        tasks: [],
        nextPageToken: '',
        pageSize: 20,
        totalSize: 0,
      });
    });

    it('preserves populated pagination values', async () => {
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({
        tasks: [taskWithArtifacts([])],
        nextPageToken: 'cursor-2',
        pageSize: 10,
        totalSize: 5,
      });

      const result = await listTasks({ pageSize: 10 });

      expect(result.nextPageToken).toBe('cursor-2');
      expect(result.pageSize).toBe(10);
      expect(result.totalSize).toBe(5);
      expect(result.tasks).toHaveLength(1);
    });

    it('omits artifacts entirely when includeArtifacts is false', async () => {
      // §3.1.4: the artifacts field MUST be omitted entirely, and "should not
      // be present as an empty array or null value". Guards against the
      // always-emit behaviour above ever being applied recursively.
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({
        tasks: [taskWithArtifacts([])],
        nextPageToken: '',
        pageSize: 20,
        totalSize: 1,
      });

      const result = await listTasks({ pageSize: 20, includeArtifacts: false });

      expect((result.tasks as unknown[])[0]).not.toHaveProperty('artifacts');
    });

    it('omits artifacts when includeArtifacts is not supplied', async () => {
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({
        tasks: [taskWithArtifacts([])],
        nextPageToken: '',
        pageSize: 20,
        totalSize: 1,
      });

      const result = await listTasks({ pageSize: 20 });

      expect((result.tasks as unknown[])[0]).not.toHaveProperty('artifacts');
    });

    it('emits an empty artifacts array when includeArtifacts is true', async () => {
      // §3.1.4: when requested, artifacts "should be included with its actual
      // content (which may be an empty array if the task has no artifacts)".
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({
        tasks: [taskWithArtifacts([])],
        nextPageToken: '',
        pageSize: 20,
        totalSize: 1,
      });

      const result = await listTasks({ pageSize: 20, includeArtifacts: true });

      expect((result.tasks as unknown[])[0]).toHaveProperty('artifacts', []);
    });

    it('keeps populated artifacts when includeArtifacts is true', async () => {
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({
        tasks: [taskWithArtifacts([{ artifactId: 'a-1', parts: [], name: 'report' }])],
        nextPageToken: '',
        pageSize: 20,
        totalSize: 1,
      });

      const result = await listTasks({ pageSize: 20, includeArtifacts: true });

      const artifacts = (result.tasks as Record<string, unknown>[])[0].artifacts as unknown[];
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({ artifactId: 'a-1' });
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

    it('should map ExtendedAgentCardNotConfiguredError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new ExtendedAgentCardNotConfiguredError('Extended Agent Card Not Configured')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED);
      expect(mappedError.message).to.equal('Extended Agent Card Not Configured');
    });

    it('should map RequestMalformedError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        new RequestMalformedError('Request Malformed')
      );
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(mappedError.message).to.equal('Request Malformed');
    });

    it('should map A2AError to code and message', async () => {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(new A2AError('Generic Error'));
      expect(mappedError.code).to.equal(A2A_ERROR_CODE.INTERNAL_ERROR);
      expect(mappedError.message).to.equal('Generic Error');
    });
  });
});

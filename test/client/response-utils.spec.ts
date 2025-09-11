import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  FilterSuccessResponse,
  A2AClientError,
  parseSuccessResponse,
  isErrorResponse,
  isSuccessResponse,
  parseStreamingResponse
} from '../../src/client/response-utils.js';
import {
  isTask,
  isMessage,
  withResultType
} from '../../src/client/type-guards.js';
import {
  JSONRPCErrorResponse,
  SendMessageSuccessResponse,
  SendMessageResponse,
  GetTaskSuccessResponse,
  GetTaskResponse,
  JSONRPCResponse,
  CancelTaskSuccessResponse,
  CancelTaskResponse
} from '../../src/types.js';

describe('Response Utils - Type Safety and Error Handling', () => {
  
  describe('FilterSuccessResponse Type Utility', () => {
    it('should filter out error responses at the type level', () => {
      // This test validates type-level filtering - compilation success indicates correct typing
      type TestResponse = SendMessageResponse;
      type FilteredResponse = FilterSuccessResponse<TestResponse>;

      // If this compiles, FilterSuccessResponse correctly excludes JSONRPCErrorResponse
      const successResponse: FilteredResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          id: 'task-123',
          contextId: 'ctx-123',
          kind: 'task' as const,
          status: {
            state: 'submitted'
          },
          history: []
        }
      };

      expect(successResponse).to.have.property('result');
      expect(successResponse).to.not.have.property('error');
    });
  });

  describe('parseSuccessResponse', () => {
    it('should return success response unchanged', () => {
      const successResponse: SendMessageSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          id: 'task-123',
          contextId: 'ctx-123',
          kind: 'task' as const,
          status: {
            state: 'submitted'
          },
          history: []
        }
      };

      const parsed = parseSuccessResponse(successResponse);
      expect(parsed).to.deep.equal(successResponse);
      expect(parsed).to.have.property('result');
    });

    it('should throw A2AClientError for error responses', () => {
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: { details: 'Test error' }
        }
      };

      expect(() => parseSuccessResponse(errorResponse)).to.throw(A2AClientError);

      try {
        parseSuccessResponse(errorResponse);
        expect.fail('Should have thrown A2AClientError');
      } catch (error) {
        expect(error).to.be.instanceOf(A2AClientError);
        expect((error as A2AClientError).rpcError.code).to.equal(-32600);
        expect((error as A2AClientError).rpcError.message).to.equal('Invalid Request');
        expect((error as A2AClientError).requestId).to.equal(1);
      }
    });

    it('should work with different response types', () => {
      const getTaskResponse: GetTaskSuccessResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          id: 'task-456',
          contextId: 'ctx-456',
          kind: 'task' as const,
          status: {
            state: 'completed'
          },
          history: []
        }
      };

      const parsed = parseSuccessResponse(getTaskResponse);
      expect(parsed.result.id).to.equal('task-456');
      expect(parsed.result.status.state).to.equal('completed');
    });
  });

  describe('A2AClientError', () => {
    it('should create error with RPC error details', () => {
      const rpcError = {
        code: -32601,
        message: 'Method not found'
      };

      const clientError = new A2AClientError(rpcError, 'request-123');

      expect(clientError.name).to.equal('A2AClientError');
      expect(clientError.message).to.include('Method not found');
      expect(clientError.message).to.include('-32601');
      expect(clientError.rpcError).to.deep.equal(rpcError);
      expect(clientError.requestId).to.equal('request-123');
    });

    it('should handle null request ID', () => {
      const rpcError = {
        code: -32700,
        message: 'Parse error'
      };

      const clientError = new A2AClientError(rpcError, null);
      expect(clientError.requestId).to.be.null;
    });
  });

  describe('Type Guards', () => {
    it('isErrorResponse should correctly identify error responses', () => {
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' }
      };

      const successResponse: SendMessageSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { id: 'task-123', contextId: 'ctx-123', kind: 'task' as const, status: { state: 'submitted' }, history: [] }
      };

      expect(isErrorResponse(errorResponse)).to.be.true;
      expect(isErrorResponse(successResponse)).to.be.false;
    });

    it('isSuccessResponse should correctly identify success responses', () => {
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' }
      };

      const successResponse: CancelTaskSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { id: 'task-789', contextId: 'ctx-789', kind: 'task' as const, status: { state: 'canceled' }, history: [] }
      };

      expect(isSuccessResponse(errorResponse)).to.be.false;
      expect(isSuccessResponse(successResponse)).to.be.true;
    });
  });

  describe('parseStreamingResponse', () => {
    it('should yield only result data from successful streaming responses', async () => {
      async function* mockStream(): AsyncGenerator<JSONRPCResponse> {
        yield {
          jsonrpc: '2.0',
          id: 1,
          result: { type: 'message', content: 'Hello' }
        } as any;

        yield {
          jsonrpc: '2.0',
          id: 1,
          result: { type: 'status', status: 'processing' }
        } as any;
      }

      const results: any[] = [];
      for await (const result of parseStreamingResponse(mockStream())) {
        results.push(result);
      }

      expect(results).to.have.length(2);
      expect(results[0]).to.deep.equal({ type: 'message', content: 'Hello' });
      expect(results[1]).to.deep.equal({ type: 'status', status: 'processing' });
    });

    it('should throw A2AClientError for error responses in stream', async () => {
      async function* mockStreamWithError(): AsyncGenerator<JSONRPCResponse> {
        yield {
          jsonrpc: '2.0',
          id: 1,
          result: { type: 'message', content: 'Hello' }
        } as any;

        yield {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32603, message: 'Internal error' }
        };
      }

      const results: any[] = [];

      try {
        for await (const result of parseStreamingResponse(mockStreamWithError())) {
          results.push(result);
        }
        expect.fail('Should have thrown A2AClientError');
      } catch (error) {
        expect(error).to.be.instanceOf(A2AClientError);
        expect(results).to.have.length(1); // Only the first successful result should be processed
        expect(results[0]).to.deep.equal({ type: 'message', content: 'Hello' });
      }
    });
  });

  describe('Integration with A2AClient methods', () => {
    it('should provide type-safe error handling for client methods', () => {

      // This test demonstrates the improved developer experience
      const successResponse: SendMessageSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { id: 'task-123', contextId: 'ctx-123', kind: 'task' as const, status: { state: 'submitted' }, history: [] }
      };

      // Developers can access .result directly
      // without manual error checking, knowing that errors are thrown as exceptions
      expect(successResponse.result).to.exist;

      // For union types, use improved type guards instead of manual property checking
      if (isTask(successResponse.result)) {
        expect(successResponse.result.id).to.equal('task-123');
      }
    });

    it('should demonstrate improved type guards for union types', () => {

      const taskResult = { id: 'task-123', contextId: 'ctx-123', kind: 'task' as const, status: { state: 'submitted' as const }, history: [] };
      const messageResult = { 
        messageId: 'msg-123', 
        kind: 'message' as const, 
        parts: [], 
        role: 'agent' as const 
      };

      // Improved type guards - cleaner than manual property checking
      if (isTask(taskResult)) {
        // TypeScript automatically knows this is a Task
        expect(taskResult.id).to.equal('task-123');
        expect(taskResult.status.state).to.equal('submitted');
      }

      if (isMessage(messageResult)) {
        // TypeScript automatically knows this is a Message
        expect(messageResult.messageId).to.equal('msg-123');
      }

      // Pattern-based processing eliminates boilerplate
      const taskResult2 = withResultType(taskResult, {
        task: (task) => {
          return `Processing task: ${task.id}`;
        },
        fallback: () => 'Unknown result type'
      });

      const messageResult2 = withResultType(messageResult, {
        message: (message) => {
          return `Processing message: ${message.messageId}`;
        },
        fallback: () => 'Unknown result type'
      });

      expect(taskResult2).to.equal('Processing task: task-123');
      expect(messageResult2).to.equal('Processing message: msg-123');
    });
  });
});
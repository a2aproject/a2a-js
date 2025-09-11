import {
  JSONRPCResponse,
  JSONRPCErrorResponse,
  JSONRPCError,
  A2AError
} from '../types.js';

/**
 * Type utility to filter out error responses from JSON-RPC response unions.
 * Similar to Hono's FilterClientResponseByStatusCode for excluding error responses.
 */
export type FilterSuccessResponse<T> = T extends JSONRPCErrorResponse ? never : T;

/**
 * Union type of all successful A2A JSON-RPC responses (excludes error responses)
 */
export type A2ASuccessResponse = FilterSuccessResponse<JSONRPCResponse>;

/**
 * Extracts the result type from a successful JSON-RPC response
 */
export type ExtractResult<T extends A2ASuccessResponse> = T['result'];

/**
 * Custom error class for A2A client RPC errors.
 * Provides detailed error information from JSON-RPC error responses.
 */
export class A2AClientError extends Error {
  constructor(
    public readonly rpcError: JSONRPCError | A2AError,
    public readonly requestId: string | number | null
  ) {
    super(`A2A RPC Error (${rpcError.code}): ${rpcError.message}`);
    this.name = 'A2AClientError';
  }
}

/**
 * Type-safe response parser that excludes error responses at the type level.
 * Throws A2AClientError for error responses, returns success response otherwise.
 *
 * @param response The JSON-RPC response to parse
 * @returns The success response, with error responses filtered out at type level
 * @throws A2AClientError if the response contains an error
 */
export function parseSuccessResponse<T extends JSONRPCResponse>(
  response: T
): FilterSuccessResponse<T> {
  if ('error' in response) {
    throw new A2AClientError(response.error, response.id);
  }
  return response as FilterSuccessResponse<T>;
}

/**
 * Type guard to check if a response is an error response
 */
export function isErrorResponse(response: JSONRPCResponse): response is JSONRPCErrorResponse {
  return 'error' in response;
}

/**
 * Type guard to check if a response is a success response
 */
export function isSuccessResponse(response: JSONRPCResponse): response is A2ASuccessResponse {
  return !isErrorResponse(response);
}

/**
 * Handles JSON-RPC response by either returning the success response or throwing an error.
 * This provides a uniform way to handle responses across all client methods.
 */
export function handleRpcResponse<T extends JSONRPCResponse>(
  response: T
): FilterSuccessResponse<T> {
  return parseSuccessResponse(response);
}

/**
 * Type-safe streaming response parser that filters out error responses.
 * Processes an async generator of JSON-RPC responses and yields only the result data.
 *
 * @param stream AsyncGenerator of JSON-RPC responses from SSE
 * @returns AsyncGenerator yielding only the result data from successful responses
 * @throws A2AClientError for any error responses in the stream
 */
export async function* parseStreamingResponse<T extends JSONRPCResponse>(
  stream: AsyncGenerator<T, void, undefined>
): AsyncGenerator<ExtractResult<FilterSuccessResponse<T>>, void, undefined> {
  for await (const response of stream) {
    const successResponse = parseSuccessResponse(response);
    yield successResponse.result;
  }
}

/**
 * Type-safe streaming helper for A2A event data.
 * Specifically designed for A2A streaming responses (Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent).
 */
export async function* parseA2AStreamingResponse(
  stream: AsyncGenerator<JSONRPCResponse, void, undefined>
): AsyncGenerator<A2ASuccessResponse['result'], void, undefined> {
  yield* parseStreamingResponse(stream);
}


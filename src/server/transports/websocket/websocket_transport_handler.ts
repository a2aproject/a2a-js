import { A2A_PROTOCOL_VERSION } from '../../../constants.js';
import type { JSONRPCError } from '../../../core.js';
import { A2A_ERROR_CODE, toJsonRpcError } from '../../../errors/index.js';
import {
  defaultServerCallContextBuilder,
  RequestHeaders,
  ServerCallContext,
  ServerCallContextBuilder,
} from '../../context.js';
import type { User } from '../../authentication/user.js';
import { A2ARequestHandler } from '../../request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler, JSONRPCResponse } from '../jsonrpc/jsonrpc_transport_handler.js';
import {
  DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES,
  WEBSOCKET_CLOSE_CODE,
  WEBSOCKET_JSONRPC_VERSION,
  WebSocketRequestEnvelope,
  WebSocketRequestId,
  WebSocketResponseEnvelope,
  WebSocketServiceParameters,
  isStreamingWebSocketMethod,
  isWebSocketRequestId,
  mergeServiceParameters,
  requestIdKey,
} from '../../../transports/websocket/protocol.js';

/** Normalized socket surface used by the framework-neutral server handler. */
export interface WebSocketConnection {
  readonly readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: unknown, isBinary?: boolean) => void): () => void;
  onClose(listener: (code?: number, reason?: string) => void): () => void;
  onError?(listener: (error: unknown) => void): () => void;
  ping?(): void;
  onPong?(listener: () => void): () => void;
}

interface WebSocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export interface WebSocketHandshakeContext {
  /** HTTP Upgrade headers, supplied by the host server before accepting. */
  headers?: RequestHeaders;
  /** Identity established by the host's handshake authenticator. */
  user?: User;
  /** Connection-scoped service parameters from handshake headers/auth context. */
  serviceParameters?: WebSocketServiceParameters;
  /** Authenticator-owned parameters that requests must not override. */
  authenticatedServiceParameters?: WebSocketServiceParameters;
}

/** Minimal EventTarget-style or Node `ws` socket accepted by the adapter. */
export type WebSocketSocketLike =
  | WebSocketConnection
  | {
      readonly readyState?: number;
      send(data: string): void;
      close(code?: number, reason?: string): void;
      addEventListener?(type: string, listener: (event: WebSocketEvent) => void): void;
      removeEventListener?(type: string, listener: (event: WebSocketEvent) => void): void;
      on?(event: string, listener: (...args: unknown[]) => void): void;
      off?(event: string, listener: (...args: unknown[]) => void): void;
      removeListener?(event: string, listener: (...args: unknown[]) => void): void;
      ping?(): void;
    };

/**
 * Adapts browser/Bun EventTarget sockets and Node `ws` sockets to the server
 * handler. The adapter does not perform the HTTP Upgrade or authentication.
 */
export function adaptWebSocketConnection(socket: WebSocketSocketLike): WebSocketConnection {
  if ('onMessage' in socket) return socket;
  const eventTarget = socket as {
    addEventListener?: (type: string, listener: (event: WebSocketEvent) => void) => void;
    removeEventListener?: (type: string, listener: (event: WebSocketEvent) => void) => void;
  };
  if (eventTarget.addEventListener) {
    const add = eventTarget.addEventListener.bind(socket);
    const remove = eventTarget.removeEventListener?.bind(socket);
    return {
      readyState: socket.readyState,
      send: socket.send.bind(socket),
      close: socket.close.bind(socket),
      onMessage(listener) {
        const callback = (event: WebSocketEvent) =>
          listener(event.data, typeof event.data !== 'string');
        add('message', callback);
        return () => remove?.('message', callback);
      },
      onClose(listener) {
        const callback = (event: WebSocketEvent) => listener(event.code, event.reason);
        add('close', callback);
        return () => remove?.('close', callback);
      },
      onError(listener) {
        const callback = (event: unknown) => listener(event);
        add('error', callback);
        return () => remove?.('error', callback);
      },
      ping: socket.ping?.bind(socket),
    };
  }

  const nodeSocket = socket as {
    on?: (event: string, listener: (...args: unknown[]) => void) => void;
    off?: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  };
  if (!nodeSocket.on)
    throw new Error('WebSocket socket must implement EventTarget or Node event methods');
  const remove = nodeSocket.off?.bind(socket) ?? nodeSocket.removeListener?.bind(socket);
  const register = (event: string, listener: (...args: unknown[]) => void) => {
    nodeSocket.on!(event, listener);
    return () => remove?.(event, listener);
  };
  return {
    readyState: socket.readyState,
    send: socket.send.bind(socket),
    close: socket.close.bind(socket),
    onMessage(listener) {
      return register('message', (data: unknown, isBinary?: unknown) => {
        if (isBinary === true) {
          listener(data, true);
          return;
        }
        if (typeof data === 'string') {
          listener(data, false);
          return;
        }
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          listener(new TextDecoder().decode(data as ArrayBufferView), false);
          return;
        }
        listener(data, true);
      });
    },
    onClose(listener) {
      return register('close', (...args: unknown[]) => {
        const [code, reason] = args;
        listener(
          typeof code === 'number' ? code : undefined,
          typeof reason === 'string' ? reason : reason?.toString()
        );
      });
    },
    onError(listener) {
      return register('error', listener);
    },
    ping: socket.ping?.bind(socket),
  };
}

export interface WebSocketServerOptions {
  handshake?: WebSocketHandshakeContext;
  contextBuilder?: ServerCallContextBuilder;
  maxMessageBytes?: number;
  maxConcurrentStreams?: number;
  /** Optional server keep-alive. Requires a socket adapter with ping(). */
  pingIntervalMs?: number;
  idleTimeoutMs?: number;
}

interface ActiveStream {
  iterator: AsyncGenerator<JSONRPCResponse, void, undefined>;
  cancelled: boolean;
}

interface SessionState {
  closed: boolean;
  lastActivity: number;
  activeStreams: Map<string, ActiveStream>;
}

/**
 * Serves the A2A WebSocket binding on one already-upgraded connection.
 *
 * The HTTP Upgrade, `Sec-WebSocket-Protocol` negotiation, Origin validation,
 * and handshake authentication intentionally remain with the host runtime.
 * This class starts after a host has accepted an upgrade with `a2a.v1` and
 * gives every request to the normal A2A request handler.
 */
export class WebSocketTransportHandler {
  private readonly jsonRpcHandler: JsonRpcTransportHandler;
  private readonly options: WebSocketServerOptions;

  constructor(requestHandler: A2ARequestHandler, options: WebSocketServerOptions = {}) {
    this.jsonRpcHandler = new JsonRpcTransportHandler(requestHandler);
    this.options = options;
  }

  /**
   * Attaches the handler and returns a cleanup function. The returned session
   * remains active until the peer closes or the cleanup function is called.
   */
  handleConnection(connection: WebSocketConnection): () => void {
    const connectionParameters = normalizeServiceParameters({
      ...headersToServiceParameters(this.options.handshake?.headers),
      ...this.options.handshake?.serviceParameters,
      ...this.options.handshake?.authenticatedServiceParameters,
    });
    const authenticatedParameters = normalizeServiceParameters(
      this.options.handshake?.authenticatedServiceParameters ?? {}
    );
    const state: SessionState = {
      closed: false,
      lastActivity: Date.now(),
      activeStreams: new Map(),
    };
    const messageCleanup = connection.onMessage((data, isBinary) => {
      void this.handleMessage(
        connection,
        state,
        connectionParameters,
        authenticatedParameters,
        data,
        isBinary
      );
    });
    const closeCleanup = connection.onClose((code, reason) => {
      state.closed = true;
      for (const stream of state.activeStreams.values()) {
        stream.cancelled = true;
        void stream.iterator.return();
      }
      state.activeStreams.clear();
      void code;
      void reason;
    });
    const errorCleanup = connection.onError?.(() => {
      state.closed = true;
    });
    const livenessCleanup = this.startLiveness(connection, state);

    return () => {
      if (state.closed) return;
      state.closed = true;
      messageCleanup();
      closeCleanup();
      errorCleanup?.();
      livenessCleanup?.();
      for (const stream of state.activeStreams.values()) {
        stream.cancelled = true;
        void stream.iterator.return();
      }
      state.activeStreams.clear();
    };
  }

  private async handleMessage(
    connection: WebSocketConnection,
    state: SessionState,
    connectionParameters: WebSocketServiceParameters,
    authenticatedParameters: WebSocketServiceParameters,
    data: unknown,
    isBinary?: boolean
  ): Promise<void> {
    if (state.closed) return;
    state.lastActivity = Date.now();
    if (isBinary || typeof data !== 'string') {
      connection.close(WEBSOCKET_CLOSE_CODE.UNSUPPORTED_DATA, 'binary frames are not supported');
      return;
    }
    if (
      new TextEncoder().encode(data).byteLength >
      (this.options.maxMessageBytes ?? DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES)
    ) {
      connection.close(WEBSOCKET_CLOSE_CODE.MESSAGE_TOO_BIG, 'message too big');
      return;
    }

    let envelope: Partial<WebSocketRequestEnvelope> & { jsonrpc?: unknown };
    try {
      envelope = JSON.parse(data) as Partial<WebSocketRequestEnvelope> & { jsonrpc?: unknown };
    } catch (error) {
      this.sendError(connection, null, {
        code: A2A_ERROR_CODE.PARSE_ERROR,
        message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      connection.close(WEBSOCKET_CLOSE_CODE.PROTOCOL_ERROR, 'JSON parse error');
      return;
    }

    if (envelope.jsonrpc !== WEBSOCKET_JSONRPC_VERSION) {
      this.sendError(connection, this.validIdOrNull(envelope.id), {
        code: A2A_ERROR_CODE.INVALID_REQUEST,
        message: 'jsonrpc must be exactly "2.0"',
      });
      return;
    }
    if (!isWebSocketRequestId(envelope.id)) {
      this.sendError(connection, null, {
        code: A2A_ERROR_CODE.INVALID_REQUEST,
        message: 'request id must be a non-empty string or integer',
      });
      return;
    }
    const id = envelope.id;
    if (envelope.cancelStream === true) {
      this.cancelStream(connection, state, id);
      return;
    }
    if (typeof envelope.method !== 'string' || envelope.method.length === 0) {
      this.sendError(connection, id, {
        code: A2A_ERROR_CODE.INVALID_REQUEST,
        message: 'method is required',
      });
      return;
    }
    if (envelope.method === 'Authenticate') {
      this.sendError(connection, id, {
        code: A2A_ERROR_CODE.UNSUPPORTED_OPERATION,
        message: 'in-band token refresh is not supported by this handler',
      });
      return;
    }

    const requestParameters = mergeServiceParameters(connectionParameters, envelope.serviceParams);
    for (const key of Object.keys(authenticatedParameters)) {
      requestParameters[key] = connectionParameters[key];
    }
    const context = this.createContext(requestParameters);
    let result: JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>;
    try {
      result = await this.jsonRpcHandler.handle(envelope as Record<string, unknown>, context);
    } catch (error) {
      this.sendError(connection, id, toJsonRpcError(error));
      return;
    }

    if (isAsyncGenerator(result)) {
      if (!isStreamingWebSocketMethod(envelope.method)) {
        this.sendError(connection, id, {
          code: A2A_ERROR_CODE.INTERNAL_ERROR,
          message: 'Unary method returned a stream',
        });
        return;
      }
      const key = requestIdKey(id);
      if (state.activeStreams.size >= (this.options.maxConcurrentStreams ?? Infinity)) {
        this.sendError(connection, id, {
          code: -32000,
          message: 'Too many concurrent streams',
        });
        return;
      }
      const active: ActiveStream = { iterator: result, cancelled: false };
      state.activeStreams.set(key, active);
      void this.runStream(connection, state, id, key, active);
      return;
    }
    this.sendResponse(connection, id, result);
  }

  private async runStream(
    connection: WebSocketConnection,
    state: SessionState,
    id: WebSocketRequestId,
    key: string,
    active: ActiveStream
  ): Promise<void> {
    try {
      for await (const response of active.iterator) {
        if (active.cancelled || state.closed) return;
        this.sendResponse(connection, id, response);
      }
      if (!active.cancelled && !state.closed) {
        this.send(connection, { jsonrpc: WEBSOCKET_JSONRPC_VERSION, id, streamEnd: true });
      }
    } catch (error) {
      if (!active.cancelled && !state.closed) this.sendError(connection, id, toJsonRpcError(error));
    } finally {
      state.activeStreams.delete(key);
    }
  }

  private cancelStream(
    connection: WebSocketConnection,
    state: SessionState,
    id: WebSocketRequestId
  ): void {
    const key = requestIdKey(id);
    const active = state.activeStreams.get(key);
    if (!active) return;
    active.cancelled = true;
    state.activeStreams.delete(key);
    void active.iterator.return();
    if (!state.closed)
      this.send(connection, { jsonrpc: WEBSOCKET_JSONRPC_VERSION, id, streamEnd: true });
  }

  private createContext(parameters: WebSocketServiceParameters): ServerCallContext {
    const headers: RequestHeaders = { ...parameters };
    const builder = this.options.contextBuilder ?? defaultServerCallContextBuilder;
    return builder({
      extensions: undefined,
      user: this.options.handshake?.user,
      headers,
      requestedVersion: parameters['a2a-version'] ?? A2A_PROTOCOL_VERSION,
      tenant: undefined,
    });
  }

  private sendResponse(
    connection: WebSocketConnection,
    id: WebSocketRequestId,
    response: JSONRPCResponse
  ): void {
    if (response.error) {
      this.sendError(connection, id, response.error);
      return;
    }
    this.send(connection, {
      jsonrpc: WEBSOCKET_JSONRPC_VERSION,
      id,
      // The WebSocket binding uses an empty object for the delete operation.
      result: response.result === null ? {} : response.result,
    });
  }

  private sendError(
    connection: WebSocketConnection,
    id: WebSocketRequestId | null,
    error: unknown
  ): void {
    const rpcError = isRpcError(error) ? error : toJsonRpcError(error);
    this.send(connection, { jsonrpc: WEBSOCKET_JSONRPC_VERSION, id, error: rpcError });
  }

  private send(connection: WebSocketConnection, envelope: WebSocketResponseEnvelope): void {
    try {
      connection.send(JSON.stringify(envelope));
    } catch {
      connection.close(WEBSOCKET_CLOSE_CODE.INTERNAL_ERROR, 'failed to send response');
    }
  }

  private validIdOrNull(value: unknown): WebSocketRequestId | null {
    return isWebSocketRequestId(value) ? value : null;
  }

  private startLiveness(
    connection: WebSocketConnection,
    state: SessionState
  ): (() => void) | undefined {
    const interval = this.options.pingIntervalMs;
    if (!interval && !this.options.idleTimeoutMs) return undefined;
    const timer = setInterval(
      () => {
        if (state.closed) return;
        if (
          this.options.idleTimeoutMs &&
          Date.now() - state.lastActivity >= this.options.idleTimeoutMs
        ) {
          connection.close(WEBSOCKET_CLOSE_CODE.GOING_AWAY, 'idle timeout');
          state.closed = true;
          return;
        }
        if (interval && connection.ping) connection.ping();
      },
      interval ?? Math.min(this.options.idleTimeoutMs!, 30_000)
    );
    return () => clearInterval(timer);
  }
}

export function isAsyncGenerator(
  value: JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>
): value is AsyncGenerator<JSONRPCResponse, void, undefined> {
  return typeof (value as AsyncGenerator).next === 'function';
}

function isRpcError(value: unknown): value is JSONRPCError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'number' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

function headersToServiceParameters(headers?: RequestHeaders): WebSocketServiceParameters {
  const parameters: WebSocketServiceParameters = {};
  const internalHeaders = new Set([
    'host',
    'connection',
    'upgrade',
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-protocol',
    'sec-websocket-extensions',
    'content-length',
    'transfer-encoding',
  ]);
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (internalHeaders.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    parameters[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return parameters;
}

function normalizeServiceParameters(
  parameters: WebSocketServiceParameters
): WebSocketServiceParameters {
  const result: WebSocketServiceParameters = {};
  for (const [key, value] of Object.entries(parameters)) result[key.toLowerCase()] = String(value);
  return result;
}

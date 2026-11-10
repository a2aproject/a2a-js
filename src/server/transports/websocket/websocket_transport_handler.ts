import type { JSONRPCError } from '../../../core.js';
import { A2A_ERROR_CODE, toJsonRpcError } from '../../../errors/index.js';
import { Extensions } from '../../../extensions.js';
import { validateVersion } from '../../version.js';
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
  WEBSOCKET_BINDING_ERROR,
  WEBSOCKET_CLOSE_CODE,
  WEBSOCKET_CONTROL_METHOD,
  WEBSOCKET_DEFAULT_A2A_VERSION,
  WEBSOCKET_JSONRPC_VERSION,
  WebSocketRequestEnvelope,
  WebSocketRequestId,
  WebSocketResponseEnvelope,
  WebSocketServiceParameters,
  findDuplicateServiceParameter,
  isStreamingWebSocketMethod,
  isWebSocketControlMethod,
  isWebSocketRequestId,
  mergeServiceParameters,
  requestIdKey,
  serviceParametersFromQuery,
  webSocketBindingError,
  WEBSOCKET_PROTOCOL_NAME,
} from '../../../transports/websocket/protocol.js';

/** Recommended keep-alive interval. */
export const DEFAULT_WEBSOCKET_PING_INTERVAL_MS = 30_000;
/** Recommended time to wait for a pong before closing. */
export const DEFAULT_WEBSOCKET_PONG_TIMEOUT_MS = 10_000;
/** Recommended idle timeout. */
export const DEFAULT_WEBSOCKET_IDLE_TIMEOUT_MS = 5 * 60_000;
/** Malformed messages tolerated before the connection is closed with 4000. */
const MAX_MALFORMED_MESSAGES = 10;
const VERSION_KEY = 'a2a-version';

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
  /**
   * HTTP Upgrade request URL. Its `A2A-` query parameters are connection-scoped
   * service parameters for clients that cannot set headers; a header with the
   * same name wins.
   */
  url?: string;
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
          let text: string;
          try {
            text = UTF8_DECODER.decode(data as ArrayBufferView);
          } catch {
            socket.close(WEBSOCKET_CLOSE_CODE.INVALID_PAYLOAD, 'invalid UTF-8');
            return;
          }
          listener(text, false);
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
    onPong(listener) {
      return register('pong', () => listener());
    },
  };
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface WebSocketServerOptions {
  handshake?: WebSocketHandshakeContext;
  contextBuilder?: ServerCallContextBuilder;
  maxMessageBytes?: number;
  maxConcurrentStreams?: number;
  /**
   * Keep-alive ping interval; `0` disables pings. Defaults to
   * {@link DEFAULT_WEBSOCKET_PING_INTERVAL_MS}. Requires a socket with ping().
   */
  pingIntervalMs?: number;
  /**
   * Close with 1001 when no pong arrives within this time; `0` disables.
   * Defaults to {@link DEFAULT_WEBSOCKET_PONG_TIMEOUT_MS}. Requires onPong().
   */
  pongTimeoutMs?: number;
  /**
   * Close with 1001 after this long without a message in either direction;
   * `0` disables. Defaults to {@link DEFAULT_WEBSOCKET_IDLE_TIMEOUT_MS}.
   */
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
  malformedMessages: number;
  /** Resolves to whether the connection's `A2A-Version` is supported. */
  versionSupported: Promise<boolean>;
}

/**
 * Serves the A2A WebSocket binding on one already-upgraded connection.
 *
 * The HTTP Upgrade, `Sec-WebSocket-Protocol` negotiation, Origin validation,
 * and handshake authentication intentionally remain with the host runtime.
 * Hosts SHOULD also reject an unsupported `A2A-Version` with HTTP 400 before
 * upgrading; otherwise this handler closes the connection with 4002. This
 * class starts after a host has accepted an upgrade with `a2a.v1` and gives
 * every request to the normal A2A request handler.
 *
 * In-band credential refresh is not supported: `ws/Authenticate` is answered
 * with `-32601`.
 */
export class WebSocketTransportHandler {
  private readonly requestHandler: A2ARequestHandler;
  private readonly jsonRpcHandler: JsonRpcTransportHandler;
  private readonly options: WebSocketServerOptions;

  constructor(requestHandler: A2ARequestHandler, options: WebSocketServerOptions = {}) {
    this.requestHandler = requestHandler;
    this.jsonRpcHandler = new JsonRpcTransportHandler(requestHandler);
    this.options = options;
  }

  /**
   * Attaches the handler and returns a cleanup function. The returned session
   * remains active until the peer closes or the cleanup function is called.
   */
  handleConnection(connection: WebSocketConnection): () => void {
    const connectionParameters = normalizeServiceParameters({
      ...serviceParametersFromQuery(this.options.handshake?.url),
      ...headersToServiceParameters(this.options.handshake?.headers),
      ...this.options.handshake?.serviceParameters,
      ...this.options.handshake?.authenticatedServiceParameters,
    });
    connectionParameters[VERSION_KEY] ??= WEBSOCKET_DEFAULT_A2A_VERSION;
    const authenticatedParameters = normalizeServiceParameters(
      this.options.handshake?.authenticatedServiceParameters ?? {}
    );
    const state: SessionState = {
      closed: false,
      lastActivity: Date.now(),
      activeStreams: new Map(),
      malformedMessages: 0,
      versionSupported: this.isVersionSupported(connectionParameters[VERSION_KEY]),
    };
    void state.versionSupported.then(
      (supported) => {
        if (supported || state.closed) return;
        connection.close(WEBSOCKET_CLOSE_CODE.VERSION_NOT_SUPPORTED, 'A2A version not supported');
        dispose();
      },
      () => {
        if (state.closed) return;
        connection.close(WEBSOCKET_CLOSE_CODE.INTERNAL_ERROR, 'agent card unavailable');
        dispose();
      }
    );
    // Kept separate from state.closed so that teardown always runs exactly once,
    // whichever path (peer close, error, idle timeout, host cleanup) gets here first.
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
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
    const closeCleanup = connection.onClose(dispose);
    const errorCleanup = connection.onError?.(dispose);
    const livenessCleanup = this.startLiveness(connection, state, dispose);

    return dispose;
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      // Each message is framed separately, so one malformed message does not
      // affect other requests and the connection stays open.
      this.sendError(connection, null, {
        code: A2A_ERROR_CODE.PARSE_ERROR,
        message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      state.malformedMessages++;
      if (state.malformedMessages >= MAX_MALFORMED_MESSAGES) {
        connection.close(WEBSOCKET_CLOSE_CODE.A2A_PROTOCOL_ERROR, 'too many malformed messages');
      }
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.sendError(connection, null, {
        code: A2A_ERROR_CODE.INVALID_REQUEST,
        message: 'message must be a JSON-RPC object',
      });
      return;
    }
    const envelope = parsed as Partial<WebSocketRequestEnvelope> & { jsonrpc?: unknown };

    // Notifications are never answered; unknown or malformed ones are ignored.
    if (!('id' in envelope)) {
      if (
        envelope.jsonrpc === WEBSOCKET_JSONRPC_VERSION &&
        envelope.method === WEBSOCKET_CONTROL_METHOD.CANCEL_STREAM
      ) {
        const streamId = (envelope.params as { id?: unknown } | undefined)?.id;
        if (isWebSocketRequestId(streamId)) this.cancelStream(connection, state, streamId);
      }
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
    if (typeof envelope.method !== 'string' || envelope.method.length === 0) {
      this.sendError(connection, id, {
        code: A2A_ERROR_CODE.INVALID_REQUEST,
        message: 'method is required',
      });
      return;
    }
    if (isWebSocketControlMethod(envelope.method)) {
      this.sendError(connection, id, {
        code: A2A_ERROR_CODE.METHOD_NOT_FOUND,
        message: `Method not found: ${envelope.method}`,
      });
      return;
    }
    if (!(await state.versionSupported.catch(() => false)) || state.closed) return;

    const duplicate = findDuplicateServiceParameter(envelope.serviceParams);
    if (duplicate !== undefined) {
      this.sendError(connection, id, {
        code: A2A_ERROR_CODE.INVALID_REQUEST,
        message: `serviceParams contains '${duplicate}' more than once`,
      });
      return;
    }
    const requestParameters = mergeServiceParameters(connectionParameters, envelope.serviceParams);
    if (requestParameters[VERSION_KEY] !== connectionParameters[VERSION_KEY]) {
      this.sendError(connection, id, {
        code: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED,
        message: `A2A-Version is fixed for the connection at '${connectionParameters[VERSION_KEY]}'`,
      });
      return;
    }
    for (const key of Object.keys(authenticatedParameters)) {
      requestParameters[key] = connectionParameters[key];
    }
    let result: JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>;
    try {
      const context = this.createContext(requestParameters);
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
        void result.return();
        this.sendError(
          connection,
          id,
          webSocketBindingError(
            WEBSOCKET_BINDING_ERROR.TOO_MANY_IN_FLIGHT,
            'Too many concurrent streams'
          )
        );
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
      if (!active.cancelled && !state.closed) this.sendStreamEnd(connection, id);
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
    if (!state.closed) this.sendStreamEnd(connection, id);
  }

  private sendStreamEnd(connection: WebSocketConnection, id: WebSocketRequestId): void {
    this.send(connection, {
      jsonrpc: WEBSOCKET_JSONRPC_VERSION,
      method: WEBSOCKET_CONTROL_METHOD.STREAM_END,
      params: { id },
    });
  }

  /** Rejects if the agent card cannot be loaded. */
  private async isVersionSupported(version: string): Promise<boolean> {
    const agentCard = await this.requestHandler.getAgentCard();
    try {
      validateVersion(version, agentCard, WEBSOCKET_PROTOCOL_NAME);
      return true;
    } catch {
      return false;
    }
  }

  private createContext(parameters: WebSocketServiceParameters): ServerCallContext {
    const headers: RequestHeaders = { ...parameters };
    const builder = this.options.contextBuilder ?? defaultServerCallContextBuilder;
    return builder({
      extensions: Extensions.parseServiceParameter(parameters['a2a-extensions']),
      user: this.options.handshake?.user,
      headers,
      requestedVersion: parameters[VERSION_KEY],
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
    state: SessionState,
    onTimeout: () => void
  ): (() => void) | undefined {
    const pingInterval = connection.ping
      ? (this.options.pingIntervalMs ?? DEFAULT_WEBSOCKET_PING_INTERVAL_MS)
      : 0;
    const pongTimeout = connection.onPong
      ? (this.options.pongTimeoutMs ?? DEFAULT_WEBSOCKET_PONG_TIMEOUT_MS)
      : 0;
    const idleTimeout = this.options.idleTimeoutMs ?? DEFAULT_WEBSOCKET_IDLE_TIMEOUT_MS;
    if (!pingInterval && !idleTimeout) return undefined;

    let awaitingPongSince: number | undefined;
    const pongCleanup =
      pingInterval && pongTimeout
        ? connection.onPong!(() => {
            awaitingPongSince = undefined;
          })
        : undefined;
    const close = (reason: string) => {
      connection.close(WEBSOCKET_CLOSE_CODE.GOING_AWAY, reason);
      onTimeout();
    };
    const tick = Math.min(...[pingInterval, idleTimeout, pongTimeout].filter((ms) => ms > 0));
    let lastPing = Date.now();
    const timer = setInterval(() => {
      if (state.closed) return;
      const now = Date.now();
      if (idleTimeout && now - state.lastActivity >= idleTimeout) {
        close('idle timeout');
        return;
      }
      if (awaitingPongSince !== undefined && now - awaitingPongSince >= pongTimeout) {
        close('pong timeout');
        return;
      }
      if (pingInterval && now - lastPing >= pingInterval) {
        lastPing = now;
        connection.ping!();
        if (pongTimeout && awaitingPongSince === undefined) awaitingPongSince = now;
      }
    }, tick);
    (timer as { unref?: () => void }).unref?.();
    return () => {
      clearInterval(timer);
      pongCleanup?.();
    };
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

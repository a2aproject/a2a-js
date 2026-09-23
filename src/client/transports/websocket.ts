import { fromJsonRpcErrorResponse } from '../../errors/index.js';
import {
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  ListTasksRequest,
  ListTasksResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from '../../types/index.js';
import { SendMessageResult } from '../../index.js';
import { TransportProtocolName } from '../../core.js';
import { A2A_PROTOCOL_VERSION } from '../../constants.js';
import { RequestOptions } from '../multitransport-client.js';
import { Transport, TransportFactory } from './transport.js';
import { AsyncQueue } from '../../transports/websocket/async_queue.js';
import {
  DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES,
  REAUTHENTICATION_REQUIRED_CONTROL,
  WEBSOCKET_CLOSE_CODE,
  WEBSOCKET_JSONRPC_VERSION,
  WEBSOCKET_METHOD,
  WEBSOCKET_PROTOCOL_NAME,
  WEBSOCKET_SUBPROTOCOL,
  WebSocketRequestEnvelope,
  WebSocketRequestId,
  WebSocketResponseEnvelope,
  WebSocketServiceParameters,
  isWebSocketRequestId,
  mergeServiceParameters,
  requestIdKey,
} from '../../transports/websocket/protocol.js';

export interface A2AWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: WebSocketEvent) => void): void;
  removeEventListener?(type: string, listener: (event: WebSocketEvent) => void): void;
}

export interface WebSocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export interface WebSocketFactoryOptions {
  /** Headers are supported by Node adapters, but ignored by browser WebSocket. */
  headers?: Record<string, string>;
}

export type WebSocketFactory = (
  endpoint: string,
  protocols: string[],
  options: WebSocketFactoryOptions
) => A2AWebSocket;

export interface WebSocketCredential {
  scheme: string;
  credentials: string;
}

export interface WebSocketReauthenticationRequired {
  reason?: string;
  retryAfterMs?: number;
}

export interface WebSocketTransportOptions {
  endpoint: string;
  /** Native browser WebSocket is used when omitted. */
  webSocketFactory?: WebSocketFactory;
  /** Connection-scoped service parameters sent as handshake headers by adapters. */
  headers?: Record<string, string>;
  /** Default per-request service parameters. */
  serviceParameters?: WebSocketServiceParameters;
  maxMessageBytes?: number;
  connectTimeoutMs?: number;
  onReauthenticationRequired?: (request: WebSocketReauthenticationRequired) => void | Promise<void>;
  credentialProvider?: () => Promise<WebSocketCredential>;
}

interface PendingUnary {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abortCleanup?: () => void;
}

interface PendingStream {
  queue: AsyncQueue<unknown>;
  abortCleanup?: () => void;
}

const OPEN = 1;

/**
 * A browser-compatible A2A WebSocket client transport.
 *
 * One socket is shared by all calls. JSON-RPC ids route unary responses and
 * stream chunks to their callers; `streamEnd` and `cancelStream` are binding
 * extensions needed because the socket remains open after a stream completes.
 */
export class WebSocketTransport implements Transport {
  private readonly endpoint: string;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly headers?: Record<string, string>;
  private readonly defaultServiceParameters: WebSocketServiceParameters;
  private readonly maxMessageBytes: number;
  private readonly connectTimeoutMs: number;
  private readonly onReauthenticationRequired?: WebSocketTransportOptions['onReauthenticationRequired'];
  private readonly credentialProvider?: WebSocketTransportOptions['credentialProvider'];
  private socket?: A2AWebSocket;
  private connectPromise?: Promise<void>;
  private nextRequestId = 1;
  private readonly unary = new Map<string, PendingUnary>();
  private readonly streams = new Map<string, PendingStream>();
  private closedError?: Error;

  constructor(options: WebSocketTransportOptions) {
    this.endpoint = options.endpoint;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.headers = options.headers;
    this.defaultServiceParameters = options.serviceParameters ?? {};
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.onReauthenticationRequired = options.onReauthenticationRequired;
    this.credentialProvider = options.credentialProvider;
  }

  get protocolName(): string {
    return WEBSOCKET_PROTOCOL_NAME as TransportProtocolName;
  }

  get protocolVersion(): string {
    return A2A_PROTOCOL_VERSION;
  }

  /** Opens the socket explicitly. Calls also connect lazily on first use. */
  async connect(): Promise<void> {
    if (this.socket?.readyState === OPEN) return;
    if (this.closedError) throw this.closedError;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = this.webSocketFactory(this.endpoint, [WEBSOCKET_SUBPROTOCOL], {
        headers: this.headers,
      });
      this.socket = socket;

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback();
      };

      socket.addEventListener('open', () => settle(resolve));
      socket.addEventListener('message', (event) => {
        void this.handleMessage(event.data);
      });
      socket.addEventListener('error', (_event) => {
        const error = new Error('WebSocket connection failed');
        settle(() => reject(error));
        if (settled) this.failConnection(error);
      });
      socket.addEventListener('close', (event) => {
        const error = closeError(event.code, event.reason);
        settle(() => reject(error));
        this.failConnection(error);
      });

      const timer = setTimeout(() => {
        const error = new Error(`WebSocket connection timed out after ${this.connectTimeoutMs}ms`);
        try {
          socket.close(WEBSOCKET_CLOSE_CODE.GOING_AWAY, 'connection timeout');
        } catch {
          // The socket may already have closed between the timeout and close().
        }
        settle(() => reject(error));
        this.failConnection(error);
      }, this.connectTimeoutMs);
    }).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  /** Close this transport and reject all calls currently waiting on the socket. */
  close(code = WEBSOCKET_CLOSE_CODE.NORMAL_CLOSURE, reason = 'client closing'): void {
    const error = new Error(`WebSocket connection closed (${code}): ${reason}`);
    this.closedError = error;
    try {
      this.socket?.close(code, reason);
    } finally {
      this.failConnection(error);
    }
  }

  /** Reconnect after a transient close using exponential backoff with jitter. */
  async connectWithRetry(
    options: { maxAttempts?: number; initialDelayMs?: number; maxDelayMs?: number } = {}
  ) {
    const maxAttempts = options.maxAttempts ?? 5;
    const initialDelayMs = options.initialDelayMs ?? 1_000;
    const maxDelayMs = options.maxDelayMs ?? 30_000;
    this.closedError = undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.connect();
        return;
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) break;
        const base = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
        const delay = Math.floor(base * (0.5 + Math.random()));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async getExtendedAgentCard(params: GetExtendedAgentCardRequest, options?: RequestOptions) {
    const response = await this.call(
      WEBSOCKET_METHOD.GET_EXTENDED_AGENT_CARD,
      GetExtendedAgentCardRequest.toJSON(params),
      options
    );
    return AgentCard.fromJSON(response);
  }

  async sendMessage(
    params: SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const response = SendMessageResponse.fromJSON(
      await this.call(WEBSOCKET_METHOD.SEND_MESSAGE, SendMessageRequest.toJSON(params), options)
    );
    if (!response.payload) throw new Error('Invalid response: missing payload');
    return response.payload.value;
  }

  sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse> {
    return this.stream(
      WEBSOCKET_METHOD.SEND_STREAMING_MESSAGE,
      SendMessageRequest.toJSON(params),
      options
    );
  }

  async createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ) {
    return TaskPushNotificationConfig.fromJSON(
      await this.call(
        WEBSOCKET_METHOD.CREATE_PUSH_CONFIG,
        TaskPushNotificationConfig.toJSON(params),
        options
      )
    );
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ) {
    return TaskPushNotificationConfig.fromJSON(
      await this.call(
        WEBSOCKET_METHOD.GET_PUSH_CONFIG,
        GetTaskPushNotificationConfigRequest.toJSON(params),
        options
      )
    );
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ) {
    return ListTaskPushNotificationConfigsResponse.fromJSON(
      await this.call(
        WEBSOCKET_METHOD.LIST_PUSH_CONFIGS,
        ListTaskPushNotificationConfigsRequest.toJSON(params),
        options
      )
    );
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    await this.call(
      WEBSOCKET_METHOD.DELETE_PUSH_CONFIG,
      DeleteTaskPushNotificationConfigRequest.toJSON(params),
      options
    );
  }

  async getTask(params: GetTaskRequest, options?: RequestOptions) {
    return Task.fromJSON(
      await this.call(WEBSOCKET_METHOD.GET_TASK, GetTaskRequest.toJSON(params), options)
    );
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions) {
    return Task.fromJSON(
      await this.call(WEBSOCKET_METHOD.CANCEL_TASK, CancelTaskRequest.toJSON(params), options)
    );
  }

  async listTasks(params: ListTasksRequest, options?: RequestOptions) {
    return ListTasksResponse.fromJSON(
      await this.call(WEBSOCKET_METHOD.LIST_TASKS, ListTasksRequest.toJSON(params), options)
    );
  }

  resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse> {
    return this.stream(
      WEBSOCKET_METHOD.SUBSCRIBE_TO_TASK,
      SubscribeToTaskRequest.toJSON(params),
      options
    );
  }

  /** Optional binding-specific in-band credential refresh. */
  async authenticate(credential: WebSocketCredential, options?: RequestOptions): Promise<void> {
    await this.call(WEBSOCKET_METHOD.AUTHENTICATE, credential, options);
  }

  async destroy(): Promise<void> {
    this.close();
  }

  private async call(method: string, params: unknown, options?: RequestOptions): Promise<unknown> {
    await this.connect();
    const id = this.allocateRequestId();
    const key = requestIdKey(id);
    const result = new Promise<unknown>((resolve, reject) => {
      const pending: PendingUnary = { resolve, reject };
      this.unary.set(key, pending);
      pending.abortCleanup = addAbortHandler(options?.signal, () => {
        this.unary.delete(key);
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });
    try {
      if (this.unary.has(key)) {
        this.sendEnvelope({
          jsonrpc: WEBSOCKET_JSONRPC_VERSION,
          id,
          method,
          params,
          serviceParams: this.serviceParameters(options),
        });
      }
    } catch (error) {
      this.rejectUnary(key, error);
    }
    return result;
  }

  private stream(
    method: string,
    params: unknown,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse> {
    let id: WebSocketRequestId | undefined;
    let key: string | undefined;
    let pending: PendingStream | undefined;
    let started: Promise<void> | undefined;
    const cancel = (requestId: WebSocketRequestId) => this.sendCancel(requestId);

    const start = async () => {
      if (started) return started;
      started = (async () => {
        await this.connect();
        id = this.allocateRequestId();
        key = requestIdKey(id);
        pending = { queue: new AsyncQueue<unknown>() };
        this.streams.set(key, pending);
        pending.abortCleanup = addAbortHandler(options?.signal, () => {
          this.sendCancel(id!);
          pending?.queue.end(new DOMException('The operation was aborted', 'AbortError'));
        });
        if (!pending.queue.isEnded) {
          this.sendEnvelope({
            jsonrpc: WEBSOCKET_JSONRPC_VERSION,
            id,
            method,
            params,
            serviceParams: this.serviceParameters(options),
          });
        }
      })();
      return started;
    };

    const cleanup = () => {
      pending?.abortCleanup?.();
      if (key && pending && this.streams.get(key) === pending) this.streams.delete(key);
    };

    const iterator: AsyncGenerator<StreamResponse> = {
      async next() {
        await start();
        const item = await pending!.queue.next();
        if (item.done) {
          cleanup();
          return { value: undefined as never, done: true };
        }
        return { value: StreamResponse.fromJSON(item.value), done: false };
      },
      async return() {
        if (started) {
          await start();
          if (id !== undefined && pending && !pending.queue.isEnded) {
            cancel(id);
            pending.queue.end();
          }
          cleanup();
        }
        return { value: undefined as never, done: true };
      },
      async throw(error?: unknown) {
        if (started) {
          await start();
          if (id !== undefined && pending && !pending.queue.isEnded) {
            cancel(id);
            pending.queue.end(error);
          }
          cleanup();
        }
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    } as unknown as AsyncGenerator<StreamResponse>;
    return iterator;
  }

  private async handleMessage(data: unknown): Promise<void> {
    if (typeof data !== 'string') {
      this.socket?.close(WEBSOCKET_CLOSE_CODE.UNSUPPORTED_DATA, 'binary frames are not supported');
      this.failConnection(new Error('Received a binary WebSocket frame; text frames are required'));
      return;
    }
    if (new TextEncoder().encode(data).byteLength > this.maxMessageBytes) {
      this.socket?.close(WEBSOCKET_CLOSE_CODE.MESSAGE_TOO_BIG, 'message too big');
      this.failConnection(new Error('WebSocket message exceeded the configured maximum size'));
      return;
    }

    let envelope: WebSocketResponseEnvelope;
    try {
      envelope = JSON.parse(data) as WebSocketResponseEnvelope;
    } catch (error) {
      this.socket?.close(WEBSOCKET_CLOSE_CODE.PROTOCOL_ERROR, 'invalid JSON');
      this.failConnection(new Error('Invalid JSON in WebSocket response', { cause: error }));
      return;
    }
    if (envelope.jsonrpc !== WEBSOCKET_JSONRPC_VERSION) return;

    if (envelope.control === REAUTHENTICATION_REQUIRED_CONTROL) {
      await this.handleReauthenticationRequired(envelope);
      return;
    }
    if (!isWebSocketRequestId(envelope.id)) return;
    const key = requestIdKey(envelope.id);
    if (envelope.error) {
      const error = fromJsonRpcErrorResponse({
        jsonrpc: '2.0',
        id: envelope.id,
        error: envelope.error,
      });
      const unary = this.unary.get(key);
      if (unary) {
        this.rejectUnary(key, error);
        return;
      }
      this.streams.get(key)?.queue.end(error);
      return;
    }
    if (envelope.streamEnd) {
      const stream = this.streams.get(key);
      if (stream) {
        stream.abortCleanup?.();
        stream.queue.end();
        this.streams.delete(key);
      }
      return;
    }
    if (!('result' in envelope)) return;

    const unary = this.unary.get(key);
    if (unary) {
      this.unary.delete(key);
      unary.abortCleanup?.();
      unary.resolve(envelope.result);
      return;
    }
    this.streams.get(key)?.queue.push(envelope.result);
  }

  private async handleReauthenticationRequired(envelope: WebSocketResponseEnvelope): Promise<void> {
    const request = { reason: envelope.reason, retryAfterMs: envelope.retryAfterMs };
    await this.onReauthenticationRequired?.(request);
    if (this.credentialProvider) {
      try {
        await this.authenticate(await this.credentialProvider());
      } catch {
        // The server will close with 4001 if refresh fails; callers can use the
        // close event or reconnect explicitly with fresh credentials.
      }
    }
  }

  private sendCancel(id: WebSocketRequestId): void {
    if (this.socket?.readyState !== OPEN) return;
    this.sendEnvelope({ jsonrpc: WEBSOCKET_JSONRPC_VERSION, id, cancelStream: true });
  }

  private sendEnvelope(envelope: WebSocketRequestEnvelope): void {
    if (this.socket?.readyState !== OPEN) throw new Error('WebSocket is not open');
    this.socket.send(JSON.stringify(envelope));
  }

  private serviceParameters(options?: RequestOptions): WebSocketServiceParameters | undefined {
    const merged = mergeServiceParameters(
      this.defaultServiceParameters,
      options?.serviceParameters
    );
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private allocateRequestId(): WebSocketRequestId {
    return this.nextRequestId++;
  }

  private rejectUnary(key: string, error: unknown): void {
    const pending = this.unary.get(key);
    if (!pending) return;
    this.unary.delete(key);
    pending.abortCleanup?.();
    pending.reject(error);
  }

  private failConnection(error: Error): void {
    if (this.socket?.readyState === OPEN) return;
    for (const [key, pending] of this.unary) {
      pending.abortCleanup?.();
      pending.reject(error);
      this.unary.delete(key);
    }
    for (const [key, pending] of this.streams) {
      pending.abortCleanup?.();
      pending.queue.end(error);
      this.streams.delete(key);
    }
  }
}

export class WebSocketTransportFactory implements TransportFactory {
  get protocolName(): string {
    return WEBSOCKET_PROTOCOL_NAME;
  }

  constructor(private readonly options?: Omit<WebSocketTransportOptions, 'endpoint'>) {}

  async create(url: string, _agentCard: AgentCard): Promise<Transport> {
    return new WebSocketTransport({ ...this.options, endpoint: url });
  }
}

function defaultWebSocketFactory(
  endpoint: string,
  protocols: string[],
  _options: WebSocketFactoryOptions
): A2AWebSocket {
  const constructor = (
    globalThis as { WebSocket?: new (url: string, protocols?: string | string[]) => A2AWebSocket }
  ).WebSocket;
  if (!constructor) {
    throw new Error(
      'A WebSocket implementation is not available. Provide webSocketFactory in WebSocketTransportOptions.'
    );
  }
  return new constructor(endpoint, protocols);
}

function addAbortHandler(
  signal: AbortSignal | undefined,
  callback: () => void
): (() => void) | undefined {
  if (!signal) return undefined;
  if (signal.aborted) callback();
  signal.addEventListener('abort', callback, { once: true });
  return () => signal.removeEventListener('abort', callback);
}

function closeError(code?: number, reason?: string): Error {
  if (code === WEBSOCKET_CLOSE_CODE.AUTHENTICATION_REQUIRED) {
    return new Error('WebSocket authentication required; reconnect with fresh credentials');
  }
  if (code === WEBSOCKET_CLOSE_CODE.MESSAGE_TOO_BIG) {
    return new Error('WebSocket message exceeded the peer maximum size');
  }
  return new Error(
    `WebSocket connection closed${code === undefined ? '' : ` (${code})`}${reason ? `: ${reason}` : ''}`
  );
}

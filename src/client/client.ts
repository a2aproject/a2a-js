import {
  AgentCard,
  JSONRPCResponse,
  MessageSendParams,
  SendMessageResponse,
  TaskQueryParams,
  GetTaskResponse,
  TaskIdParams,
  CancelTaskResponse,
  TaskPushNotificationConfig, // Renamed from PushNotificationConfigParams for direct schema alignment
  SetTaskPushNotificationConfigResponse,
  GetTaskPushNotificationConfigResponse,
  ListTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigResponse,
  DeleteTaskPushNotificationConfigResponse,
  DeleteTaskPushNotificationConfigParams,
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
  A2ARequest,
  JSONRPCErrorResponse,
} from '../types.js'; // Assuming schema.ts is in the same directory or appropriately pathed
import { AGENT_CARD_PATH } from '../constants.js';
import { JsonRpcTransport } from './transports/json_rpc_transport.js';
import { RequestOptions } from './multitransport-client.js';

export type A2AStreamEventData = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export type SendMessageResult = Message | Task;

export interface A2AClientOptions {
  agentCardPath?: string;
  fetchImpl?: typeof fetch;
}

/**
 * A2AClient is a TypeScript HTTP client for interacting with A2A-compliant agents.
 * Only JSON-RPC transport is supported.
 * @deprecated Use {@link ClientFactory}
 */
export class A2AClient {
  private static emptyOptions?: RequestOptions = undefined;

  private readonly agentCardPromise: Promise<AgentCard>;
  private readonly customFetchImpl?: typeof fetch;
  private serviceEndpointUrl?: string; // To be populated from AgentCard after fetchin

  // A2AClient is built around JSON-RPC types, so it will only support JSON-RPC transport, new client with transport agnostic interface is going to be created for multi-transport.
  // New transport abstraction isn't going to expose individual transport specific fields, so to keep returning JSON-RPC IDs here for compatibility,
  // keep counter here and pass it to JsonRpcTransport via an optional idOverride parameter (which is not visible via transport-agnostic A2ATransport interface).
  private transport?: JsonRpcTransport;
  private requestIdCounter: number = 1;

  /**
   * Constructs an A2AClient instance from an AgentCard.
   * @param agentCard The AgentCard object.
   * @param options Optional. The options for the A2AClient including the fetch/auth implementation.
   */
  constructor(agentCard: AgentCard | string, options?: A2AClientOptions) {
    this.customFetchImpl = options?.fetchImpl;
    if (typeof agentCard === 'string') {
      console.warn(
        'Warning: Constructing A2AClient with a URL is deprecated. Please use A2AClient.fromCardUrl() instead.'
      );
      this.agentCardPromise = this._fetchAndCacheAgentCard(agentCard, options?.agentCardPath);
    } else {
      if (!agentCard.url) {
        throw new Error(
          "Provided Agent Card does not contain a valid 'url' for the service endpoint."
        );
      }
      this.serviceEndpointUrl = agentCard.url;
      this.agentCardPromise = Promise.resolve(agentCard);
    }
  }

  /**
   * Dynamically resolves the fetch implementation to use for requests.
   * Prefers a custom implementation if provided, otherwise falls back to the global fetch.
   * @returns The fetch implementation.
   * @param args Arguments to pass to the fetch implementation.
   * @throws If no fetch implementation is available.
   */
  private _fetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    if (this.customFetchImpl) {
      return this.customFetchImpl(...args);
    }
    if (typeof fetch === 'function') {
      return fetch(...args);
    }
    throw new Error(
      'A `fetch` implementation was not provided and is not available in the global scope. ' +
        'Please provide a `fetchImpl` in the A2AClientOptions. ' +
        'For earlier Node.js versions (pre-v18), you can use a library like `node-fetch`.'
    );
  }

  /**
   * Creates an A2AClient instance by fetching the AgentCard from a URL then constructing the A2AClient.
   * @param agentCardUrl The URL of the agent card.
   * @param options Optional. The options for the A2AClient including the fetch/auth implementation.
   * @returns A Promise that resolves to a new A2AClient instance.
   */
  public static async fromCardUrl(
    agentCardUrl: string,
    options?: A2AClientOptions
  ): Promise<A2AClient> {
    const fetchImpl = options?.fetchImpl;
    const requestInit = {
      headers: { Accept: 'application/json' },
    };

    let response: Response;
    if (fetchImpl) {
      response = await fetchImpl(agentCardUrl, requestInit);
    } else if (typeof fetch === 'function') {
      // Use the global fetch implementation if no custom one is provided.
      response = await fetch(agentCardUrl, requestInit);
    } else {
      throw new Error(
        'A `fetch` implementation was not provided and is not available in the global scope. ' +
          'Please provide a `fetchImpl` in the A2AClientOptions. ' +
          'For earlier Node.js versions (pre-v18), you can use a library like `node-fetch`.'
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Agent Card from ${agentCardUrl}: ${response.status} ${response.statusText}`
      );
    }

    let agentCard: AgentCard;
    try {
      agentCard = await response.json();
    } catch (error) {
      console.error('Failed to parse Agent Card JSON:', error);
      throw new Error(
        `Failed to parse Agent Card JSON from ${agentCardUrl}. Original error: ${(error as Error).message}`
      );
    }

    return new A2AClient(agentCard, options);
  }

  /**
   * Sends a message to the agent.
   * The behavior (blocking/non-blocking) and push notification configuration
   * are specified within the `params.configuration` object.
   * Optionally, `params.message.contextId` or `params.message.taskId` can be provided.
   * @param params The parameters for sending the message, including the message content and configuration.
   * @returns A Promise resolving to SendMessageResponse, which can be a Message, Task, or an error.
   */
  public async sendMessage(params: MessageSendParams): Promise<SendMessageResponse> {
    return await this.invokeJsonRpc<MessageSendParams, SendMessageResponse>(
      (t, p, id) => t.sendMessage(p, A2AClient.emptyOptions, id),
      params
    );
  }

  /**
   * Sends a message to the agent and streams back responses using Server-Sent Events (SSE).
   * Push notification configuration can be specified in `params.configuration`.
   * Optionally, `params.message.contextId` or `params.message.taskId` can be provided.
   * Requires the agent to support streaming (`capabilities.streaming: true` in AgentCard).
   * @param params The parameters for sending the message.
   * @returns An AsyncGenerator yielding A2AStreamEventData (Message, Task, TaskStatusUpdateEvent, or TaskArtifactUpdateEvent).
   * The generator throws an error if streaming is not supported or if an HTTP/SSE error occurs.
   */
  public async *sendMessageStream(
    params: MessageSendParams
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const agentCard = await this.agentCardPromise; // Ensure agent card is fetched
    if (!agentCard.capabilities?.streaming) {
      throw new Error(
        'Agent does not support streaming (AgentCard.capabilities.streaming is not true).'
      );
    }

    const transport = await this._getOrCreateTransport();
    yield* transport.sendMessageStream(params);
  }

  /**
   * Sets or updates the push notification configuration for a given task.
   * Requires the agent to support push notifications (`capabilities.pushNotifications: true` in AgentCard).
   * @param params Parameters containing the taskId and the TaskPushNotificationConfig.
   * @returns A Promise resolving to SetTaskPushNotificationConfigResponse.
   */
  public async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig
  ): Promise<SetTaskPushNotificationConfigResponse> {
    const agentCard = await this.agentCardPromise;
    if (!agentCard.capabilities?.pushNotifications) {
      throw new Error(
        'Agent does not support push notifications (AgentCard.capabilities.pushNotifications is not true).'
      );
    }
    return await this.invokeJsonRpc<
      TaskPushNotificationConfig,
      SetTaskPushNotificationConfigResponse
    >((t, p, id) => t.setTaskPushNotificationConfig(p, A2AClient.emptyOptions, id), params);
  }

  /**
   * Gets the push notification configuration for a given task.
   * @param params Parameters containing the taskId.
   * @returns A Promise resolving to GetTaskPushNotificationConfigResponse.
   */
  public async getTaskPushNotificationConfig(
    params: TaskIdParams
  ): Promise<GetTaskPushNotificationConfigResponse> {
    return await this.invokeJsonRpc<TaskIdParams, GetTaskPushNotificationConfigResponse>(
      (t, p, id) => t.getTaskPushNotificationConfig(p, A2AClient.emptyOptions, id),
      params
    );
  }

  /**
   * Lists the push notification configurations for a given task.
   * @param params Parameters containing the taskId.
   * @returns A Promise resolving to ListTaskPushNotificationConfigResponse.
   */
  public async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams
  ): Promise<ListTaskPushNotificationConfigResponse> {
    return await this.invokeJsonRpc<
      ListTaskPushNotificationConfigParams,
      ListTaskPushNotificationConfigResponse
    >((t, p, id) => t.listTaskPushNotificationConfig(p, A2AClient.emptyOptions, id), params);
  }

  /**
   * Deletes the push notification configuration for a given task.
   * @param params Parameters containing the taskId and push notification configuration ID.
   * @returns A Promise resolving to DeleteTaskPushNotificationConfigResponse.
   */
  public async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams
  ): Promise<DeleteTaskPushNotificationConfigResponse> {
    return await this.invokeJsonRpc<
      DeleteTaskPushNotificationConfigParams,
      DeleteTaskPushNotificationConfigResponse
    >((t, p, id) => t.deleteTaskPushNotificationConfig(p, A2AClient.emptyOptions, id), params);
  }

  /**
   * Retrieves a task by its ID.
   * @param params Parameters containing the taskId and optional historyLength.
   * @returns A Promise resolving to GetTaskResponse, which contains the Task object or an error.
   */
  public async getTask(params: TaskQueryParams): Promise<GetTaskResponse> {
    return await this.invokeJsonRpc<TaskQueryParams, GetTaskResponse>(
      (t, p, id) => t.getTask(p, A2AClient.emptyOptions, id),
      params
    );
  }

  /**
   * Cancels a task by its ID.
   * @param params Parameters containing the taskId.
   * @returns A Promise resolving to CancelTaskResponse, which contains the updated Task object or an error.
   */
  public async cancelTask(params: TaskIdParams): Promise<CancelTaskResponse> {
    return await this.invokeJsonRpc<TaskIdParams, CancelTaskResponse>(
      (t, p, id) => t.cancelTask(p, A2AClient.emptyOptions, id),
      params
    );
  }

  /**
   * @template TExtensionParams The type of parameters for the custom extension method.
   * @template TExtensionResponse The type of response expected from the custom extension method.
   * This should extend JSONRPCResponse. This ensures the extension response is still a valid A2A response.
   * @param method Custom JSON-RPC method defined in the AgentCard's extensions.
   * @param params Extension paramters defined in the AgentCard's extensions.
   * @returns A Promise that resolves to the RPC response.
   */
  public async callExtensionMethod<TExtensionParams, TExtensionResponse extends JSONRPCResponse>(
    method: string,
    params: TExtensionParams
  ) {
    const transport = await this._getOrCreateTransport();
    try {
      return await transport.callExtensionMethod<TExtensionParams, TExtensionResponse>(
        method,
        params,
        this.requestIdCounter++
      );
    } catch (e) {
      // For compatibility, return JSON-RPC errors as errors instead of throwing transport-agnostic errors
      // produced by JsonRpcTransport.
      const errorResponse = extractJSONRPCError(e);
      if (errorResponse) {
        return errorResponse as TExtensionResponse;
      }
      throw e;
    }
  }

  /**
   * Resubscribes to a task's event stream using Server-Sent Events (SSE).
   * This is used if a previous SSE connection for an active task was broken.
   * Requires the agent to support streaming (`capabilities.streaming: true` in AgentCard).
   * @param params Parameters containing the taskId.
   * @returns An AsyncGenerator yielding A2AStreamEventData (Message, Task, TaskStatusUpdateEvent, or TaskArtifactUpdateEvent).
   */
  public async *resubscribeTask(
    params: TaskIdParams
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const agentCard = await this.agentCardPromise;
    if (!agentCard.capabilities?.streaming) {
      throw new Error('Agent does not support streaming (required for tasks/resubscribe).');
    }

    const transport = await this._getOrCreateTransport();
    yield* transport.resubscribeTask(params);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Functions used to support old A2AClient Constructor to be deprecated soon
  // TODOs:
  // * remove `agentCardPromise`, and just use agentCard initialized
  // * _getServiceEndpoint can be made synchronous or deleted and accessed via
  //   agentCard.url
  // * getAgentCard changed to this.agentCard
  // * delete resolveAgentCardUrl(), _fetchAndCacheAgentCard(),
  //   agentCardPath from A2AClientOptions
  // * delete _getOrCreateTransport
  ////////////////////////////////////////////////////////////////////////////////

  private async _getOrCreateTransport(): Promise<JsonRpcTransport> {
    if (this.transport) {
      return this.transport;
    }

    const endpoint = await this._getServiceEndpoint();
    this.transport = new JsonRpcTransport({ fetchImpl: this.customFetchImpl, endpoint: endpoint });
    return this.transport;
  }

  /**
   * Fetches the Agent Card from the agent's well-known URI and caches its service endpoint URL.
   * This method is called by the constructor.
   * @param agentBaseUrl The base URL of the A2A agent (e.g., https://agent.example.com)
   * @param agentCardPath path to the agent card, defaults to .well-known/agent-card.json
   * @returns A Promise that resolves to the AgentCard.
   */
  private async _fetchAndCacheAgentCard(
    agentBaseUrl: string,
    agentCardPath?: string
  ): Promise<AgentCard> {
    try {
      const agentCardUrl = this.resolveAgentCardUrl(agentBaseUrl, agentCardPath);
      const response = await this._fetch(agentCardUrl, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch Agent Card from ${agentCardUrl}: ${response.status} ${response.statusText}`
        );
      }
      const agentCard: AgentCard = await response.json();
      if (!agentCard.url) {
        throw new Error(
          "Fetched Agent Card does not contain a valid 'url' for the service endpoint."
        );
      }
      this.serviceEndpointUrl = agentCard.url; // Cache the service endpoint URL from the agent card
      return agentCard;
    } catch (error) {
      console.error('Error fetching or parsing Agent Card:', error);
      // Allow the promise to reject so users of agentCardPromise can handle it.
      throw error;
    }
  }

  /**
   * Retrieves the Agent Card.
   * If an `agentBaseUrl` is provided, it fetches the card from that specific URL.
   * Otherwise, it returns the card fetched and cached during client construction.
   * @param agentBaseUrl Optional. The base URL of the agent to fetch the card from.
   * @param agentCardPath path to the agent card, defaults to .well-known/agent-card.json
   * If provided, this will fetch a new card, not use the cached one from the constructor's URL.
   * @returns A Promise that resolves to the AgentCard.
   */
  public async getAgentCard(agentBaseUrl?: string, agentCardPath?: string): Promise<AgentCard> {
    if (agentBaseUrl) {
      const agentCardUrl = this.resolveAgentCardUrl(agentBaseUrl, agentCardPath);

      const response = await this._fetch(agentCardUrl, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch Agent Card from ${agentCardUrl}: ${response.status} ${response.statusText}`
        );
      }
      return (await response.json()) as AgentCard;
    }
    // If no specific URL is given, return the promise for the initially configured agent's card.
    return this.agentCardPromise;
  }

  /**
   * Determines the agent card URL based on the agent URL.
   * @param agentBaseUrl The agent URL.
   * @param agentCardPath Optional relative path to the agent card, defaults to .well-known/agent-card.json
   */
  private resolveAgentCardUrl(
    agentBaseUrl: string,
    agentCardPath: string = AGENT_CARD_PATH
  ): string {
    return `${agentBaseUrl.replace(/\/$/, '')}/${agentCardPath.replace(/^\//, '')}`;
  }

  /**
   * Gets the RPC service endpoint URL. Ensures the agent card has been fetched first.
   * @returns A Promise that resolves to the service endpoint URL string.
   */
  private async _getServiceEndpoint(): Promise<string> {
    if (this.serviceEndpointUrl) {
      return this.serviceEndpointUrl;
    }
    // If serviceEndpointUrl is not set, it means the agent card fetch is pending or failed.
    // Awaiting agentCardPromise will either resolve it or throw if fetching failed.
    await this.agentCardPromise;
    if (!this.serviceEndpointUrl) {
      // This case should ideally be covered by the error handling in _fetchAndCacheAgentCard
      throw new Error(
        'Agent Card URL for RPC endpoint is not available. Fetching might have failed.'
      );
    }
    return this.serviceEndpointUrl;
  }

  private async invokeJsonRpc<TParams extends JsonRpcParams, TResponse extends JSONRPCResponse>(
    caller: JsonRpcCaller<TParams, TResponse>,
    params?: TParams
  ): Promise<TResponse> {
    const transport = await this._getOrCreateTransport();
    const requestId = this.requestIdCounter++;
    try {
      const result = await caller(transport, params, requestId);
      return {
        id: requestId,
        jsonrpc: '2.0',
        result: result ?? null, // JSON-RPC requires result property on success, it will be null for "void" methods.
      } as TResponse;
    } catch (e) {
      // For compatibility, return JSON-RPC errors as response objects instead of throwing transport-agnostic errors
      // produced by JsonRpcTransport.
      const errorResponse = extractJSONRPCError(e);
      if (errorResponse) {
        return errorResponse as TResponse;
      }
      throw e;
    }
  }
}

function extractJSONRPCError(error: unknown): JSONRPCErrorResponse {
  if (
    error instanceof Object &&
    'errorResponse' in error &&
    error.errorResponse instanceof Object &&
    'jsonrpc' in error.errorResponse &&
    error.errorResponse.jsonrpc === '2.0' &&
    'error' in error.errorResponse &&
    error.errorResponse.error !== null
  ) {
    return error.errorResponse as JSONRPCErrorResponse;
  } else {
    return undefined;
  }
}

// Utility unexported types to properly factor out common "compatibility" logic via invokeJsonRpc.
type ParamsOf<T> = T extends { params: unknown } ? T['params'] : undefined;
type ResultOf<T> = T extends { result: unknown } ? T['result'] : void;
type JsonRpcParams = ParamsOf<A2ARequest>;
type JsonRpcCaller<TParams extends JsonRpcParams, TResponse extends JSONRPCResponse> = (
  transport: JsonRpcTransport,
  params: TParams,
  idOverride: number
) => Promise<ResultOf<TResponse>>;

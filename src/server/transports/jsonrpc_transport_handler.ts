import { JSONRPCErrorResponse, MessageSendParams, TaskQueryParams, TaskIdParams, TaskPushNotificationConfig, A2ARequest, JSONRPCResponse, DeleteTaskPushNotificationConfigParams, ListTaskPushNotificationConfigParams } from "../../types.js";
import { ServerCallContext } from "../context.js";
import { A2AError } from "../error.js";
import { A2ARequestHandler } from "../request_handler/a2a_request_handler.js";

/**
 * Handles JSON-RPC transport layer, routing requests to A2ARequestHandler.
 */
export class JsonRpcTransportHandler {
    private requestHandler: A2ARequestHandler;

    constructor(requestHandler: A2ARequestHandler) {
        this.requestHandler = requestHandler;
    }

    /**
     * Handles an incoming JSON-RPC request.
     * For streaming methods, it returns an AsyncGenerator of JSONRPCResult.
     * For non-streaming methods, it returns a Promise of a single JSONRPCMessage (Result or ErrorResponse).
     */
    public async handle(
        requestBody: any, context?: ServerCallContext
    ): Promise<JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>> {
        let rpcRequest: A2ARequest;

        try {
            if (typeof requestBody === 'string') {
                rpcRequest = JSON.parse(requestBody);
            } else if (typeof requestBody === 'object' && requestBody !== null) {
                rpcRequest = requestBody as A2ARequest;
            } else {
                throw A2AError.parseError('Invalid request body type.');
            }

            if (!this.isRequestValid(rpcRequest)) {
                throw A2AError.invalidRequest('Invalid JSON-RPC Request.');
            }
        } catch (error: any) {
            const a2aError = error instanceof A2AError ? error : A2AError.parseError(error.message || 'Failed to parse JSON request.');
            return {
                jsonrpc: '2.0',
                id: (typeof rpcRequest!?.id !== 'undefined' ? rpcRequest!.id : null),
                error: a2aError.toJSONRPCError(),
            } as JSONRPCErrorResponse;
        }

        const { method, id: requestId = null } = rpcRequest;
        try {
            if(method === 'agent/getAuthenticatedExtendedCard') {
                const result = await this.requestHandler.getAuthenticatedExtendedAgentCard();
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    result: result,
                } as JSONRPCResponse;
            }

            if (!this.paramsAreValid(rpcRequest.params)) {
                throw A2AError.invalidParams(`Invalid method parameters.`);
            }

            if (method === 'message/stream' || method === 'tasks/resubscribe') {
                const params = rpcRequest.params;
                const agentCard = await this.requestHandler.getAgentCard();
                if (!agentCard.capabilities.streaming) {
                    throw A2AError.unsupportedOperation(`Method ${method} requires streaming capability.`);
                }
                const agentEventStream = method === 'message/stream'
                    ? this.requestHandler.sendMessageStream(params as MessageSendParams, context)
                    : this.requestHandler.resubscribe(params as TaskIdParams, context);

                // Wrap the agent event stream into a JSON-RPC result stream
                return (async function* jsonRpcEventStream(): AsyncGenerator<JSONRPCResponse, void, undefined> {
                    try {
                        for await (const event of agentEventStream) {
                            yield {
                                jsonrpc: '2.0',
                                id: requestId, // Use the original request ID for all streamed responses
                                result: event,
                            };
                        }
                    } catch (streamError: any) {
                        // If the underlying agent stream throws an error, we need to yield a JSONRPCErrorResponse.
                        // However, an AsyncGenerator is expected to yield JSONRPCResult.
                        // This indicates an issue with how errors from the agent's stream are propagated.
                        // For now, log it. The Express layer will handle the generator ending.
                        console.error(`Error in agent event stream for ${method} (request ${requestId}):`, streamError);
                        // Ideally, the Express layer should catch this and send a final error to the client if the stream breaks.
                        // Or, the agentEventStream itself should yield a final error event that gets wrapped.
                        // For now, we re-throw so it can be caught by A2AExpressApp's stream handling.
                        throw streamError;
                    }
                })();
            } else {
                // Handle non-streaming methods
                let result: any;
                switch (method) {
                    case 'message/send':
                        result = await this.requestHandler.sendMessage(rpcRequest.params, context);
                        break;
                    case 'tasks/get':
                        result = await this.requestHandler.getTask(rpcRequest.params, context);
                        break;
                    case 'tasks/cancel':
                        result = await this.requestHandler.cancelTask(rpcRequest.params, context);
                        break;
                    case 'tasks/pushNotificationConfig/set':
                        result = await this.requestHandler.setTaskPushNotificationConfig(
                            rpcRequest.params, context
                        );
                        break;
                    case 'tasks/pushNotificationConfig/get':
                        result = await this.requestHandler.getTaskPushNotificationConfig(
                            rpcRequest.params, context
                        );
                        break;
                    case 'tasks/pushNotificationConfig/delete':
                        await this.requestHandler.deleteTaskPushNotificationConfig(
                            rpcRequest.params, context
                        );
                        result = null;
                        break;
                    case 'tasks/pushNotificationConfig/list':
                        result = await this.requestHandler.listTaskPushNotificationConfigs(
                            rpcRequest.params, context
                        );
                        break;
                    default:
                        throw A2AError.methodNotFound(method);
                }
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    result: result,
                } as JSONRPCResponse;
            }
        } catch (error: any) {
            const a2aError = error instanceof A2AError ? error : A2AError.internalError(error.message || 'An unexpected error occurred.');
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: a2aError.toJSONRPCError(),
            } as JSONRPCErrorResponse;
        }
    }

    // Validates the basic structure of a JSON-RPC request
    private isRequestValid(rpcRequest: A2ARequest): boolean {
        if (rpcRequest.jsonrpc !== '2.0') {
            return false;
        }
        if ('id' in rpcRequest) {
            const id = rpcRequest.id;
            const isString = typeof id === 'string';
            const isInteger = typeof id === 'number' && Number.isInteger(id);
            const isNull = id === null;

            if (!isString && !isInteger && !isNull) {
                return false;
            }
        }
        if (!rpcRequest.method || typeof rpcRequest.method !== 'string') {
            return false;
        }

        return true;
    }

    // Validates that params is an object with non-empty string keys
    private paramsAreValid(params: any): boolean {
        if (typeof params !== 'object' || params === null || Array.isArray(params)) {
            return false;
        }

        for (const key of Object.keys(params)) {
            if (key === "") {
                return false;
            }
        }
        return true;
    }
}
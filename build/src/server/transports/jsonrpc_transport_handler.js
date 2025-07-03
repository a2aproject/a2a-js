"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonRpcTransportHandler = void 0;
const error_js_1 = require("../error.js");
/**
 * Handles JSON-RPC transport layer, routing requests to A2ARequestHandler.
 */
class JsonRpcTransportHandler {
    requestHandler;
    constructor(requestHandler) {
        this.requestHandler = requestHandler;
    }
    /**
     * Handles an incoming JSON-RPC request.
     * For streaming methods, it returns an AsyncGenerator of JSONRPCResult.
     * For non-streaming methods, it returns a Promise of a single JSONRPCMessage (Result or ErrorResponse).
     */
    async handle(requestBody) {
        let rpcRequest;
        try {
            if (typeof requestBody === 'string') {
                rpcRequest = JSON.parse(requestBody);
            }
            else if (typeof requestBody === 'object' && requestBody !== null) {
                rpcRequest = requestBody;
            }
            else {
                throw error_js_1.A2AError.parseError('Invalid request body type.');
            }
            if (rpcRequest.jsonrpc !== '2.0' ||
                !rpcRequest.method ||
                typeof rpcRequest.method !== 'string') {
                throw error_js_1.A2AError.invalidRequest('Invalid JSON-RPC request structure.');
            }
        }
        catch (error) {
            const a2aError = error instanceof error_js_1.A2AError ? error : error_js_1.A2AError.parseError(error.message || 'Failed to parse JSON request.');
            return {
                jsonrpc: '2.0',
                id: (typeof rpcRequest?.id !== 'undefined' ? rpcRequest.id : null),
                error: a2aError.toJSONRPCError(),
            };
        }
        const { method, params = {}, id: requestId = null } = rpcRequest;
        try {
            if (method === 'message/stream' || method === 'tasks/resubscribe') {
                const agentCard = await this.requestHandler.getAgentCard();
                if (!agentCard.capabilities.streaming) {
                    throw error_js_1.A2AError.unsupportedOperation(`Method ${method} requires streaming capability.`);
                }
                const agentEventStream = method === 'message/stream'
                    ? this.requestHandler.sendMessageStream(params)
                    : this.requestHandler.resubscribe(params);
                // Wrap the agent event stream into a JSON-RPC result stream
                return (async function* jsonRpcEventStream() {
                    try {
                        for await (const event of agentEventStream) {
                            yield {
                                jsonrpc: '2.0',
                                id: requestId, // Use the original request ID for all streamed responses
                                result: event,
                            };
                        }
                    }
                    catch (streamError) {
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
            }
            else {
                // Handle non-streaming methods
                let result;
                switch (method) {
                    case 'message/send':
                        result = await this.requestHandler.sendMessage(params);
                        break;
                    case 'tasks/get':
                        result = await this.requestHandler.getTask(params);
                        break;
                    case 'tasks/cancel':
                        result = await this.requestHandler.cancelTask(params);
                        break;
                    case 'tasks/pushNotificationConfig/set':
                        result = await this.requestHandler.setTaskPushNotificationConfig(params);
                        break;
                    case 'tasks/pushNotificationConfig/get':
                        result = await this.requestHandler.getTaskPushNotificationConfig(params);
                        break;
                    default:
                        throw error_js_1.A2AError.methodNotFound(method);
                }
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    result: result,
                };
            }
        }
        catch (error) {
            const a2aError = error instanceof error_js_1.A2AError ? error : error_js_1.A2AError.internalError(error.message || 'An unexpected error occurred.');
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: a2aError.toJSONRPCError(),
            };
        }
    }
}
exports.JsonRpcTransportHandler = JsonRpcTransportHandler;
//# sourceMappingURL=jsonrpc_transport_handler.js.map
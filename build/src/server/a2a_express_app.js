"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.A2AExpressApp = void 0;
const express_1 = __importDefault(require("express"));
const error_js_1 = require("./error.js");
const jsonrpc_transport_handler_js_1 = require("./transports/jsonrpc_transport_handler.js");
class A2AExpressApp {
    requestHandler; // Kept for getAgentCard
    jsonRpcTransportHandler;
    constructor(requestHandler) {
        this.requestHandler = requestHandler; // DefaultRequestHandler instance
        this.jsonRpcTransportHandler = new jsonrpc_transport_handler_js_1.JsonRpcTransportHandler(requestHandler);
    }
    /**
     * Adds A2A routes to an existing Express app.
     * @param app Optional existing Express app.
     * @param baseUrl The base URL for A2A endpoints (e.g., "/a2a/api").
     * @returns The Express app with A2A routes.
     */
    setupRoutes(app, baseUrl = '') {
        app.use(express_1.default.json());
        app.get(`${baseUrl}/.well-known/agent.json`, async (req, res) => {
            try {
                // getAgentCard is on A2ARequestHandler, which DefaultRequestHandler implements
                const agentCard = await this.requestHandler.getAgentCard();
                res.json(agentCard);
            }
            catch (error) {
                console.error("Error fetching agent card:", error);
                res.status(500).json({ error: "Failed to retrieve agent card" });
            }
        });
        app.post(baseUrl, async (req, res) => {
            try {
                const rpcResponseOrStream = await this.jsonRpcTransportHandler.handle(req.body);
                // Check if it's an AsyncGenerator (stream)
                if (typeof rpcResponseOrStream?.[Symbol.asyncIterator] === 'function') {
                    const stream = rpcResponseOrStream;
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    res.flushHeaders();
                    try {
                        for await (const event of stream) {
                            // Each event from the stream is already a JSONRPCResult
                            res.write(`id: ${new Date().getTime()}\n`);
                            res.write(`data: ${JSON.stringify(event)}\n\n`);
                        }
                    }
                    catch (streamError) {
                        console.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
                        // If the stream itself throws an error, send a final JSONRPCErrorResponse
                        const a2aError = streamError instanceof error_js_1.A2AError ? streamError : error_js_1.A2AError.internalError(streamError.message || 'Streaming error.');
                        const errorResponse = {
                            jsonrpc: '2.0',
                            id: req.body?.id || null, // Use original request ID if available
                            error: a2aError.toJSONRPCError(),
                        };
                        if (!res.headersSent) { // Should not happen if flushHeaders worked
                            res.status(500).json(errorResponse); // Should be JSON, not SSE here
                        }
                        else {
                            // Try to send as last SSE event if possible, though client might have disconnected
                            res.write(`id: ${new Date().getTime()}\n`);
                            res.write(`event: error\n`); // Custom event type for client-side handling
                            res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
                        }
                    }
                    finally {
                        if (!res.writableEnded) {
                            res.end();
                        }
                    }
                }
                else { // Single JSON-RPC response
                    const rpcResponse = rpcResponseOrStream;
                    res.status(200).json(rpcResponse);
                }
            }
            catch (error) { // Catch errors from jsonRpcTransportHandler.handle itself (e.g., initial parse error)
                console.error("Unhandled error in A2AExpressApp POST handler:", error);
                const a2aError = error instanceof error_js_1.A2AError ? error : error_js_1.A2AError.internalError('General processing error.');
                const errorResponse = {
                    jsonrpc: '2.0',
                    id: req.body?.id || null,
                    error: a2aError.toJSONRPCError(),
                };
                if (!res.headersSent) {
                    res.status(500).json(errorResponse);
                }
                else if (!res.writableEnded) {
                    // If headers sent (likely during a stream attempt that failed early), try to end gracefully
                    res.end();
                }
            }
        });
        // The separate /stream endpoint is no longer needed.
        return app;
    }
}
exports.A2AExpressApp = A2AExpressApp;
//# sourceMappingURL=a2a_express_app.js.map
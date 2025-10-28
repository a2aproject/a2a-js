import express, { Request, Response, Express, RequestHandler, ErrorRequestHandler } from 'express';

import { A2AError } from "../error.js";
import { JSONRPCErrorResponse, JSONRPCSuccessResponse, JSONRPCResponse } from "../../index.js";
import { A2ARequestHandler } from "../request_handler/a2a_request_handler.js";
import { JsonRpcTransportHandler } from "../transports/jsonrpc_transport_handler.js";
import { createHttpRestRouter } from "./http_rest_routes.js";
import { AGENT_CARD_PATH } from "../../constants.js";

export interface A2AExpressOptions {
    baseUrl?: string;
    middlewares?: Array<RequestHandler | ErrorRequestHandler>;
    agentCardPath?: string;
    transport?: "jsonrpc" | "http-rest" | "both";
}

export class A2AExpressApp {
    private requestHandler: A2ARequestHandler; // Kept for getAgentCard
    private jsonRpcTransportHandler: JsonRpcTransportHandler;

    constructor(requestHandler: A2ARequestHandler) {
        this.requestHandler = requestHandler; // DefaultRequestHandler instance
        this.jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
    }

    /**
     * Adds A2A routes to an existing Express app.
     * Supports both old signature (for backward compatibility) and new options-based signature.
     * @param app Express app instance.
     * @param baseUrlOrOptions Base URL string (old signature) or options object (new signature).
     * @param middlewares Optional middlewares (old signature only).
     * @param agentCardPath Optional agent card path (old signature only).
     * @returns The Express app with A2A routes.
     */
    public setupRoutes(
        app: Express,
        baseUrlOrOptions?: string | A2AExpressOptions,
        middlewares?: Array<RequestHandler | ErrorRequestHandler>,
        agentCardPath?: string
    ): Express {
        // Handle both old and new signatures
        let options: A2AExpressOptions;
        if (typeof baseUrlOrOptions === 'string') {
            // Old signature: setupRoutes(app, baseUrl, middlewares, agentCardPath)
            options = {
                baseUrl: baseUrlOrOptions,
                middlewares,
                agentCardPath: agentCardPath || AGENT_CARD_PATH,
                transport: "both" // Default to both for backward compatibility
            };
        } else {
            // New signature: setupRoutes(app, options)
            options = {
                baseUrl: "",
                agentCardPath: AGENT_CARD_PATH,
                transport: "both",
                ...baseUrlOrOptions
            };
        }

        const { baseUrl = "", middlewares: mws, agentCardPath: cardPath = AGENT_CARD_PATH, transport = "both" } = options;
        const router = express.Router();
        router.use(express.json(), ...(mws ?? []));

        // Agent card route (shared by both transports)
        router.get(`/${cardPath}`, async (req: Request, res: Response) => {
            try {
                // getAgentCard is on A2ARequestHandler, which DefaultRequestHandler implements
                const agentCard = await this.requestHandler.getAgentCard();
                res.json(agentCard);
            } catch (error: any) {
                console.error("Error fetching agent card:", error);
                res.status(500).json({ error: "Failed to retrieve agent card" });
            }
        });

        // JSON-RPC routes
        if (transport === "jsonrpc" || transport === "both") {
            router.post("/", async (req: Request, res: Response) => {
            try {
                const rpcResponseOrStream = await this.jsonRpcTransportHandler.handle(req.body);

                // Check if it's an AsyncGenerator (stream)
                if (typeof (rpcResponseOrStream as any)?.[Symbol.asyncIterator] === 'function') {
                    const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCSuccessResponse, void, undefined>;

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
                    } catch (streamError: any) {
                        console.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
                        // If the stream itself throws an error, send a final JSONRPCErrorResponse
                        const a2aError = streamError instanceof A2AError ? streamError : A2AError.internalError(streamError.message || 'Streaming error.');
                        const errorResponse: JSONRPCErrorResponse = {
                            jsonrpc: '2.0',
                            id: req.body?.id || null, // Use original request ID if available
                            error: a2aError.toJSONRPCError(),
                        };
                        if (!res.headersSent) { // Should not happen if flushHeaders worked
                            res.status(500).json(errorResponse); // Should be JSON, not SSE here
                        } else {
                            // Try to send as last SSE event if possible, though client might have disconnected
                            res.write(`id: ${new Date().getTime()}\n`);
                            res.write(`event: error\n`); // Custom event type for client-side handling
                            res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
                        }
                    } finally {
                        if (!res.writableEnded) {
                            res.end();
                        }
                    }
                } else { // Single JSON-RPC response
                    const rpcResponse = rpcResponseOrStream as JSONRPCResponse;
                    res.status(200).json(rpcResponse);
                }
            } catch (error: any) { // Catch errors from jsonRpcTransportHandler.handle itself (e.g., initial parse error)
                console.error("Unhandled error in A2AExpressApp POST handler:", error);
                const a2aError = error instanceof A2AError ? error : A2AError.internalError('General processing error.');
                const errorResponse: JSONRPCErrorResponse = {
                    jsonrpc: '2.0',
                    id: req.body?.id || null,
                    error: a2aError.toJSONRPCError(),
                };
                if (!res.headersSent) {
                    res.status(500).json(errorResponse);
                } else if (!res.writableEnded) {
                    // If headers sent (likely during a stream attempt that failed early), try to end gracefully
                    res.end();
                }
            }
            });
        }

        // HTTP+REST routes
        if (transport === "http-rest" || transport === "both") {
            const httpRestRouter = createHttpRestRouter(this.requestHandler);
            router.use(httpRestRouter);
        }

        app.use(baseUrl, router);
        return app;
    }
}

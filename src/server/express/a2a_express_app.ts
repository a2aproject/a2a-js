import express, { Request, Response, Express, RequestHandler, ErrorRequestHandler } from 'express';

import { A2AError } from "../error.js";
import { JSONRPCErrorResponse, JSONRPCSuccessResponse, JSONRPCResponse } from "../../index.js";
import { A2ARequestHandler } from "../request_handler/a2a_request_handler.js";
import { DynamicAgentRequestHandler, RouteContext } from "../request_handler/dynamic_request_handler.js";
import { JsonRpcTransportHandler } from "../transports/jsonrpc_transport_handler.js";
import { AGENT_CARD_PATH } from "../../constants.js";

export class A2AExpressApp {
    private requestHandler: A2ARequestHandler;
    private jsonRpcTransportHandler: JsonRpcTransportHandler;

    constructor(requestHandler: A2ARequestHandler) {
        this.requestHandler = requestHandler;
        this.jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
    }

    private createRouteContext(req: Request): RouteContext {
        return {
            url: req.originalUrl || req.url,
            method: req.method,
            headers: req.headers as Record<string, string>,
            query: req.query as Record<string, string>
        };
    }

    private setRouteContextIfNeeded(req: Request): void {
        if ('setRouteContext' in this.requestHandler) {
            const routeContext = this.createRouteContext(req);
            (this.requestHandler as DynamicAgentRequestHandler).setRouteContext(routeContext);
        }
    }

    private async handleAgentCardRequest(req: Request, res: Response): Promise<void> {
        try {
            this.setRouteContextIfNeeded(req);
            const agentCard = await this.requestHandler.getAgentCard();
            res.json(agentCard);
        } catch (error: any) {
            console.error("Error fetching agent card:", error);
            res.status(500).json({ error: "Failed to retrieve agent card" });
        }
    }

    private async handleJsonRpcRequest(req: Request, res: Response): Promise<void> {
        try {
            this.setRouteContextIfNeeded(req);
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
    }

    /**
     * Adds A2A routes to an existing Express app.
     * Dynamic routing is automatically enabled if a DynamicAgentRequestHandler is provided.
     * @param app Optional existing Express app.
     * @param baseUrl The base URL for A2A endpoints (e.g., "/a2a/api").
     * @param middlewares Optional array of Express middlewares to apply to the A2A routes.
     * @param agentCardPath Optional custom path for the agent card endpoint (defaults to .well-known/agent-card.json).
     * @returns The Express app with A2A routes.
     */
    public setupRoutes(
        app: Express,
        baseUrl: string = "",
        middlewares?: Array<RequestHandler | ErrorRequestHandler>,
        agentCardPath: string = AGENT_CARD_PATH
    ): Express {
        const router = express.Router();
        router.use(express.json(), ...(middlewares ?? []));

        // Handle agent card requests with optional sub-path parameter
        router.get(`/:agentType/${agentCardPath}`, async (req: Request, res: Response) => {
            await this.handleAgentCardRequest(req, res);
        });

        // Also handle base path without agent type
        router.get(`/${agentCardPath}`, async (req: Request, res: Response) => {
            await this.handleAgentCardRequest(req, res);
        });

        // Handle JSON-RPC requests for sub-paths  
        router.post("/:agentType", async (req: Request, res: Response) => {
            await this.handleJsonRpcRequest(req, res);
        });

        // Handle JSON-RPC requests for base path
        router.post("/", async (req: Request, res: Response) => {
            await this.handleJsonRpcRequest(req, res);
        });


        app.use(baseUrl, router);
        return app;
    }

}

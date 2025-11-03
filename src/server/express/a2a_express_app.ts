import express, { Express, RequestHandler, ErrorRequestHandler } from 'express';

import { A2ARequestHandler } from "../request_handler/a2a_request_handler.js";
import { JsonRpcTransportHandler } from "../transports/jsonrpc_transport_handler.js";
import { AGENT_CARD_PATH } from "../../constants.js";
import { jsonRpcHandler } from './json_rpc_handler.js';
import { agentCardHandler } from './agent_card_handler.js';
import { jsonErrorHandler } from './utils.js';

export class A2AExpressApp {
    private requestHandler: A2ARequestHandler; // Kept for getAgentCard
    private jsonRpcTransportHandler: JsonRpcTransportHandler;

    constructor(requestHandler: A2ARequestHandler) {
        this.requestHandler = requestHandler; // DefaultRequestHandler instance
        this.jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
    }

    /**
     * Adds A2A routes to an existing Express app.
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

        // Doing it here to maintain previous behaviour of invoking provided middlewares
        // after JSON body is parsed, jsonRpcHandler registers JSON parsing on the local router.
        router.use(express.json(), jsonErrorHandler);

        if (middlewares && middlewares.length > 0) {
            router.use(middlewares);
        }

        router.use(jsonRpcHandler(this.jsonRpcTransportHandler));
        router.use(`/${agentCardPath}`, agentCardHandler(this.requestHandler));
        

        app.use(baseUrl, router);
        return app;
    }
}

import { Express } from 'express';
import { A2ARequestHandler } from "./request_handler/a2a_request_handler.js";
export declare class A2AExpressApp {
    private requestHandler;
    private jsonRpcTransportHandler;
    constructor(requestHandler: A2ARequestHandler);
    /**
     * Adds A2A routes to an existing Express app.
     * @param app Optional existing Express app.
     * @param baseUrl The base URL for A2A endpoints (e.g., "/a2a/api").
     * @returns The Express app with A2A routes.
     */
    setupRoutes(app: Express, baseUrl?: string): Express;
}

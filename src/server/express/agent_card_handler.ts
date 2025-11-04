import express, { Request, RequestHandler, Response } from "express";
import { AgentCard } from "../../types.js";

export interface AgentCardHandlerOptions {
    agentCardProvider: AgentCardProvider;
}

export interface AgentCardProvider {
    getAgentCard(): Promise<AgentCard>;
}

export function agentCardHandler(options: AgentCardHandlerOptions): RequestHandler {
    const router = express.Router()

    router.get('/', async (_req: Request, res: Response) => {
        try {
            const agentCard = await options.agentCardProvider.getAgentCard();
            res.json(agentCard);
        } catch (error: any) {
            console.error("Error fetching agent card:", error);
            res.status(500).json({ error: "Failed to retrieve agent card" });
        }
    })

    return router
}

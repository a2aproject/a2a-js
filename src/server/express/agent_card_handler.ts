import express, { Request, Response, Router } from "express";
import { AgentCard } from "../../types.js";

export interface AgentCardProvider {
    getAgentCard(): Promise<AgentCard>;
}

export function agentCardHandler(agentCardProvider: AgentCardProvider): Router {
    const router = express.Router()

    router.get('/', async (_req: Request, res: Response) => {
        try {
            const agentCard = await agentCardProvider.getAgentCard();
            res.json(agentCard);
        } catch (error: any) {
            console.error("Error fetching agent card:", error);
            res.status(500).json({ error: "Failed to retrieve agent card" });
        }
    })

    return router
}

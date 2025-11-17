import express, { Request, RequestHandler, Response } from 'express';
import { AgentCard } from '../../types.js';

export interface AgentCardHandlerOptions {
  agentCardProvider: AgentCardProvider;
}

export type AgentCardProvider = { getAgentCard(): Promise<AgentCard> } | (() => Promise<AgentCard>);

/**
 * Creates Express.js middleware to handle agent card requests.
 * @example
 * // With an existing A2ARequestHandler instance:
 * app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: a2aRequestHandler }));
 * // or with a factory lambda:
 * app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: async () => agentCard }));
 */
export function agentCardHandler(options: AgentCardHandlerOptions): RequestHandler {
  const router = express.Router();

  const provider =
    typeof options.agentCardProvider === 'function'
      ? options.agentCardProvider
      : options.agentCardProvider.getAgentCard.bind(options.agentCardProvider);

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const agentCard = await provider();
      res.json(agentCard);
    } catch (error: any) {
      console.error('Error fetching agent card:', error);
      res.status(500).json({ error: 'Failed to retrieve agent card' });
    }
  });

  return router;
}

import crypto from 'crypto';
import express, { Request, RequestHandler, Response } from 'express';
import { AgentCard } from '../../index.js';

export interface AgentCardCacheOptions {
  maxAge?: number; // Defaults to 3600 (1 hour).
}

export interface AgentCardHandlerOptions {
  agentCardProvider: AgentCardProvider;
  cache?: AgentCardCacheOptions;
}

export type AgentCardProvider = { getAgentCard(): Promise<AgentCard> } | (() => Promise<AgentCard>);

function computeETag(json: string): string {
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Creates Express.js middleware to handle agent card requests.
 *
 * Per §8.6:
 * - Server SHOULD include `Cache-Control` with `max-age`
 * - Server SHOULD include `ETag`
 * - Client SHOULD honor HTTP caching (conditional requests via `If-None-Match`)
 *
 * @example
 * ```ts
 * // With an existing A2ARequestHandler instance:
 * app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: a2aRequestHandler }));
 * // With caching options:
 * app.use('/.well-known/agent-card.json', agentCardHandler({
 *   agentCardProvider: a2aRequestHandler,
 *   cache: { maxAge: 7200 }
 * }));
 * ```
 */
export function agentCardHandler(options: AgentCardHandlerOptions): RequestHandler {
  const router = express.Router();
  const maxAge = options.cache?.maxAge ?? 3600;

  const provider =
    typeof options.agentCardProvider === 'function'
      ? options.agentCardProvider
      : options.agentCardProvider.getAgentCard.bind(options.agentCardProvider);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const agentCard = await provider();
      const body = JSON.stringify(agentCard);
      const etag = computeETag(body);

      res.setHeader('ETag', etag);
      if (maxAge > 0) {
        res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }

      // Support conditional requests: if client sends If-None-Match
      // matching the current ETag, return 304 with no body.
      if (req.fresh) {
        res.status(304).end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(body);
    } catch (error) {
      console.error('Error fetching agent card:', error);
      res.status(500).json({ error: 'Failed to retrieve agent card' });
    }
  });

  return router;
}

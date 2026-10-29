import crypto from 'crypto';
import express, { Request, RequestHandler, Response } from 'express';
import { A2A_VERSION_HEADER } from '../../constants.js';
import { legacyAgentCardRouter } from '../../compat/v0_3/server/express/index.js';
import { AgentCard } from '../../index.js';

export interface AgentCardCacheOptions {
  maxAge?: number; // Defaults to 3600 (1 hour).
}

export interface AgentCardHandlerOptions {
  agentCardProvider: AgentCardProvider;
  cache?: AgentCardCacheOptions;
  /**
   * Enables the v0.3 protocol compatibility layer. When enabled, the
   * handler inspects the `A2A-Version` header (defaulting to `'0.3'`
   * when absent): legacy-range versions get a v0.3-shaped card via
   * `toCompatAgentCard(card)`; non-legacy versions get the v1.0 card
   * unchanged. Per-version `ETag`s and `Vary: A2A-Version` are emitted
   * so shared HTTP caches keep separate entries per version.
   *
   * Default: omitted (disabled).
   */
  legacyCompat?: { enabled: boolean };
}

export type AgentCardProvider = { getAgentCard(): Promise<AgentCard> } | (() => Promise<AgentCard>);

function computeETag(json: string): string {
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Creates Express.js middleware serving the agent card with `Cache-Control`,
 * `ETag`, and `If-None-Match` (304) support. When
 * `legacyCompat: { enabled: true }`, the handler mounts the v0.3 compat
 * router at the top of its chain; that router serves a v0.3-translated
 * card for legacy-range requests and falls through to v1.0 otherwise.
 *
 * @example
 * ```ts
 * app.use(
 *   '/.well-known/agent-card.json',
 *   agentCardHandler({ agentCardProvider: a2aRequestHandler })
 * );
 * app.use(
 *   '/.well-known/agent-card.json',
 *   agentCardHandler({
 *     agentCardProvider: a2aRequestHandler,
 *     legacyCompat: { enabled: true },
 *   })
 * );
 * ```
 */
export function agentCardHandler(options: AgentCardHandlerOptions): RequestHandler {
  const router = express.Router();
  const maxAge = options.cache?.maxAge ?? 3600;

  const provider =
    typeof options.agentCardProvider === 'function'
      ? options.agentCardProvider
      : options.agentCardProvider.getAgentCard.bind(options.agentCardProvider);

  // Opt-in v0.3 compatibility: the legacy router dispatches by
  // `A2A-Version` header and falls through to the v1.0 handler below
  // via `next('router')` for non-legacy versions.
  if (options.legacyCompat?.enabled) {
    router.use(legacyAgentCardRouter(options));
  }

  router.get('/', async (req: Request, res: Response) => {
    try {
      const agentCard = await provider();
      const body = JSON.stringify(agentCard);
      const etag = computeETag(body);

      res.setHeader('ETag', etag);
      // The cache key must include `A2A-Version` so a v1.0 client
      // doesn't receive a cached v0.3 body (and vice versa) when sitting
      // behind a shared HTTP cache.
      if (options.legacyCompat?.enabled) {
        res.append('Vary', A2A_VERSION_HEADER);
      }
      if (maxAge > 0) {
        res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }

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

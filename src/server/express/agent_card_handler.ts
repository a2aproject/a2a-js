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
   * Enables the v0.3 protocol compatibility layer.
   *
   * When enabled, the handler inspects the `A2A-Version` header on
   * each request (defaulting to `'0.3'` per §3.6.2 when absent): for
   * versions in the legacy range `[0.3, 1.0)` it serves a v0.3-shaped
   * card produced by `toCompatAgentCard(card)`; for any non-legacy
   * version it serves the modern v1.0 card unchanged.
   *
   * When `toCompatAgentCard` throws `VersionNotSupportedError`
   * (no v0.3 interface advertised on the agent card), the handler
   * responds with HTTP 400 and a v0.3-shaped error body.
   *
   * Per-version `ETag`s are emitted and `Vary: A2A-Version` is set on
   * every response so shared HTTP caches keep separate entries per
   * version.
   *
   * Default: omitted (treated as disabled). When disabled, the v0.3
   * compat module is not instantiated and the well-known endpoint
   * behaves exactly as it did before this option was introduced.
   */
  legacyCompat?: { enabled: boolean };
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
 * When `legacyCompat: { enabled: true }`, the handler mounts the v0.3
 * compat router at the top of its chain; that router inspects the
 * `A2A-Version` header and serves a `toCompatAgentCard()`-translated
 * card for legacy-range requests. Non-legacy requests fall through to
 * the v1.0 handler below unchanged.
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
 * // With v0.3 compat negotiation enabled:
 * app.use('/.well-known/agent-card.json', agentCardHandler({
 *   agentCardProvider: a2aRequestHandler,
 *   legacyCompat: { enabled: true },
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

  // Opt-in v0.3 compatibility. When enabled, the legacy router is
  // mounted at the top of the chain (path-less) and dispatches per
  // `A2A-Version` header internally: legacy-range requests get served
  // a v0.3 card; non-legacy requests fall through via `next('router')`
  // to the v1.0 handler below. When `legacyCompat` is omitted or
  // disabled, the compat module is never instantiated.
  if (options.legacyCompat?.enabled) {
    router.use(legacyAgentCardRouter(options));
  }

  router.get('/', async (req: Request, res: Response) => {
    try {
      const agentCard = await provider();
      const body = JSON.stringify(agentCard);
      const etag = computeETag(body);

      res.setHeader('ETag', etag);
      // When compat negotiation is enabled, the cache key must include
      // `A2A-Version` so a v1.0 client doesn't receive a cached v0.3
      // body (and vice versa) when sitting behind a shared HTTP cache.
      if (options.legacyCompat?.enabled) {
        res.append('Vary', A2A_VERSION_HEADER);
      }
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

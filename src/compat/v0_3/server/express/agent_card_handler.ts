/**
 * v0.3 well-known agent-card Express handler.
 *
 * Mirrors the v1.0 {@link agentCardHandler} but serves a v0.3-shaped
 * agent card produced by {@link toCompatAgentCard} for requests whose
 * `A2A-Version` header falls in the legacy range `[0.3, 1.0)` (or is
 * absent — per §3.6.2 a missing header defaults to `'0.3'`).
 *
 * Designed to be mounted at the top of the v1.0 handler's chain by the
 * core `agentCardHandler` when `legacyCompat: { enabled: true }`. The
 * router short-circuits non-legacy requests via `next('router')` so the
 * v1.0 handler keeps serving the modern card unchanged.
 */

import crypto from 'crypto';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { A2A_VERSION_HEADER } from '../../../../constants.js';
import { VersionNotSupportedError } from '../../../../errors.js';
import type {
  AgentCardCacheOptions,
  AgentCardProvider,
} from '../../../../server/express/agent_card_handler.js';
import { A2A_LEGACY_PROTOCOL_VERSION, LEGACY_JSON_CONTENT_TYPE } from '../../constants.js';
import { toCompatAgentCard } from '../../translate/agent_card.js';
import { isLegacyVersion } from '../../translate/versions.js';
import type * as legacy from '../../types/types.js';
import { HTTP_STATUS, toLegacyHTTPError } from '../transports/rest/rest_transport_handler.js';

/**
 * Options for {@link legacyAgentCardRouter}.
 *
 * Re-uses the v1.0 {@link AgentCardProvider} and
 * {@link AgentCardCacheOptions} types so a single options object can be
 * passed through unchanged from the core `agentCardHandler`.
 */
export interface LegacyAgentCardHandlerOptions {
  agentCardProvider: AgentCardProvider;
  cache?: AgentCardCacheOptions;
}

function computeETag(json: string): string {
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Creates an Express router that serves a v0.3-shaped agent card for
 * legacy-range requests on the well-known agent-card path.
 *
 * Dispatch is **header-based**, not path-based: a middleware at the top
 * of the chain parses `A2A-Version` (defaulting to `'0.3'` per §3.6.2
 * when absent) and short-circuits any request whose version is not in
 * `[0.3, 1.0)` by calling `next('router')`, falling through to the
 * parent's v1.0 handler.
 *
 * For legacy requests, the router:
 *   - Calls the configured `agentCardProvider` to obtain the v1.0
 *     proto card.
 *   - Runs the card through {@link toCompatAgentCard}, which filters
 *     `supportedInterfaces` to legacy entries and rebuilds the v0.3
 *     card-level `(url, preferredTransport, additionalInterfaces)`
 *     fields. If no interface qualifies the translator throws
 *     {@link VersionNotSupportedError}; the router maps that to an
 *     HTTP 400 with a v0.3-shaped error body.
 *   - Sets `Content-Type: application/json` (the v0.3 spelling — v1.0
 *     uses `application/a2a+json`).
 *   - Computes a per-version `ETag` derived from the v0.3 body and
 *     emits `Vary: A2A-Version` so caches keep separate entries per
 *     version.
 *   - Honors conditional `If-None-Match` requests via `req.fresh`.
 *
 * @example
 * ```ts
 * import { legacyAgentCardRouter } from '@a2a-js/sdk/compat/v0_3';
 * app.use(
 *   '/.well-known/agent-card.json',
 *   legacyAgentCardRouter({ agentCardProvider: requestHandler })
 * );
 * ```
 */
export function legacyAgentCardRouter(options: LegacyAgentCardHandlerOptions): RequestHandler {
  const router = express.Router();
  const maxAge = options.cache?.maxAge ?? 3600;

  const provider =
    typeof options.agentCardProvider === 'function'
      ? options.agentCardProvider
      : options.agentCardProvider.getAgentCard.bind(options.agentCardProvider);

  // Version-based dispatch: short-circuit anything that isn't in the
  // legacy range `[0.3, 1.0)`. Header-less requests default to `'0.3'`
  // per §3.6.2 and stay in this router.
  router.use((req: Request, _res: Response, next: NextFunction) => {
    const requestedVersion = req.header(A2A_VERSION_HEADER) || A2A_LEGACY_PROTOCOL_VERSION;
    if (isLegacyVersion(requestedVersion)) {
      next();
    } else {
      next('router');
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const coreCard = await provider();
      let compatCard: legacy.AgentCard;
      try {
        compatCard = toCompatAgentCard(coreCard);
      } catch (error) {
        if (error instanceof VersionNotSupportedError) {
          res.append('Vary', A2A_VERSION_HEADER);
          res
            .status(HTTP_STATUS.BAD_REQUEST)
            .setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE)
            .json(toLegacyHTTPError(error));
          return;
        }
        throw error;
      }

      const body = JSON.stringify(compatCard);
      const etag = computeETag(body);

      res.setHeader('ETag', etag);
      // `Vary: A2A-Version` partitions the cache per protocol version
      // so a v1.0 client doesn't get a cached v0.3 body (and vice
      // versa) when sitting behind a shared HTTP cache.
      res.append('Vary', A2A_VERSION_HEADER);
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

      res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
      res.status(HTTP_STATUS.OK).send(body);
    } catch (error) {
      console.error('Error fetching legacy agent card:', error);
      res.append('Vary', A2A_VERSION_HEADER);
      res
        .status(500)
        .setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE)
        .json({ error: 'Failed to retrieve agent card' });
    }
  });

  return router;
}

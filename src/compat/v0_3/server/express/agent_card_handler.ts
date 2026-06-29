/**
 * v0.3 well-known agent-card Express handler. Mirrors the v1.0
 * `agentCardHandler` but serves a v0.3-shaped card produced by
 * `toCompatAgentCard` for requests whose `A2A-Version` header falls in
 * the legacy range (or is absent — defaults to `'0.3'`).
 *
 * Mounted at the top of the v1.0 handler's chain by the core
 * `agentCardHandler` when `legacyCompat: { enabled: true }`. Short-
 * circuits non-legacy requests via `next('router')` so the v1.0 handler
 * keeps serving the modern card unchanged.
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

/** Options for {@link legacyAgentCardRouter}. */
export interface LegacyAgentCardHandlerOptions {
  agentCardProvider: AgentCardProvider;
  cache?: AgentCardCacheOptions;
}

function computeETag(json: string): string {
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Creates an Express router serving a v0.3-shaped agent card for
 * legacy-range requests. Dispatch is header-based: requests whose
 * `A2A-Version` is not in `[0.3, 1.0)` are routed via `next('router')`
 * to the parent's v1.0 handler.
 *
 * Sets `Content-Type: application/json` (v0.3 spelling), emits per-
 * version `ETag` + `Vary: A2A-Version`, and honors `If-None-Match`.
 *
 * @example
 * ```ts
 * import { legacyAgentCardRouter } from '@a2a-js/sdk/compat/v0_3/server/express';
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

  // Version-based dispatch: short-circuit anything outside the legacy
  // range. Header-less requests default to `'0.3'` and stay here.
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
        // `synthesize: true` makes the legacy endpoint discoverable
        // even when the operator only declared v1.0 interfaces — so
        // they don't need to duplicate every v1.0 entry with a v0.3
        // stub. `embedV1Interfaces: true` emits a "superset" card whose
        // JSON document satisfies BOTH shapes (v0.3 top-level fields
        // AND v1.0 `supportedInterfaces`), so a v1.0 peer that didn't
        // negotiate `A2A-Version: 1.0` can still dial bindings without
        // v0.3 compat. The two top-level field sets are disjoint, so
        // the hybrid representation is unambiguous.
        compatCard = toCompatAgentCard(coreCard, {
          synthesize: true,
          embedV1Interfaces: true,
        });
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
      // Partition the cache by protocol version so a v1.0 client doesn't
      // get a cached v0.3 body (and vice versa).
      res.append('Vary', A2A_VERSION_HEADER);
      if (maxAge > 0) {
        res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }

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

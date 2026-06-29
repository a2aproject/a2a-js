/**
 * Helper for picking the best-matching `AgentInterface` for a given
 * protocol binding. Lives in its own module so protocol-specific
 * factories can share the same dispatch policy.
 */

import type { AgentCard, AgentInterface } from '../../types/pb/a2a.js';

/**
 * Picks the `AgentInterface` for `protocolBinding` whose `url` matches
 * `url`, preferring `protocolVersion === '1.0'`. Falls back to any
 * matching binding entry when no URL match is found, then to
 * `undefined` when nothing matches. Mirrors Python's
 * `_find_best_interface(..., url=...)`.
 */
export function pickMatchingInterface(
  agentCard: AgentCard,
  protocolBinding: string,
  url: string
): AgentInterface | undefined {
  const target = protocolBinding.toUpperCase();
  const candidates = (agentCard.supportedInterfaces ?? []).filter(
    (i) => i.protocolBinding?.toUpperCase() === target
  );
  if (candidates.length === 0) return undefined;

  const byUrl = candidates.filter((i) => i.url === url);
  const pool = byUrl.length > 0 ? byUrl : candidates;

  return pool.find((i) => i.protocolVersion === '1.0') ?? pool[0];
}

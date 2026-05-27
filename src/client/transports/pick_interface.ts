/**
 * Shared helper for picking the best-matching `AgentInterface` for a
 * given protocol binding from an agent card's `supportedInterfaces`.
 *
 * Lives in its own module so protocol-specific factories can
 * share the same dispatch policy when deciding whether to dispatch to a
 * v0.3 compat transport.
 */

import type { AgentCard, AgentInterface } from '../../types/pb/a2a.js';

/**
 * Picks the `AgentInterface` for the given protocol binding that best
 * matches the endpoint URL.
 *
 * Mirrors Python's `_find_best_interface(..., url=...)`: filters by
 * `protocolBinding` (case-insensitive), narrows to entries whose `url`
 * matches if any such entry exists, then prefers `protocolVersion === '1.0'`
 * among the survivors. Returns `undefined` when nothing matches so the
 * caller can fall back to a default policy (today: assume v1.0).
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

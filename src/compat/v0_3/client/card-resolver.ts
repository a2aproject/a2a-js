/**
 * v0.3 detection and translation helpers for `DefaultAgentCardResolver`
 * when `legacyCompat: { enabled: true }` is set. Translates v0.3 card
 * payloads to v1.0 so the rest of the client stack sees a uniform
 * representation.
 */
import type { AgentCard as V1AgentCard } from '../../../types/pb/a2a.js';
import { toCoreAgentCard } from '../translate/agent_card.js';
import { isLegacyVersion } from '../translate/versions.js';
import type * as legacy from '../types/types.js';

// Top-level fields that only appear on v0.3 cards. Presence of any (or a
// parseable legacy `protocolVersion`) classifies the payload as v0.3.
const LEGACY_ONLY_TOP_LEVEL_FIELDS = [
  'preferredTransport',
  'additionalInterfaces',
  'supportsAuthenticatedExtendedCard',
] as const;

/**
 * Heuristic detection of v0.3-shaped agent cards.
 *
 * For "superset" cards emitted with `embedV1Interfaces: true` (which
 * carry both shapes), the v1.0 representation wins — returns `false` so
 * the caller's v1.0 parser reads `supportedInterfaces` directly instead
 * of going through the lossy v0.3 translation.
 */
export function isLegacyAgentCard(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const card = raw as Record<string, unknown>;

  if (Array.isArray(card.supportedInterfaces) && card.supportedInterfaces.length > 0) {
    return false;
  }

  if (typeof card.url === 'string' && !('supportedInterfaces' in card)) {
    return true;
  }

  for (const field of LEGACY_ONLY_TOP_LEVEL_FIELDS) {
    if (field in card) return true;
  }

  if (typeof card.protocolVersion === 'string' && isLegacyVersion(card.protocolVersion)) {
    return true;
  }

  return false;
}

/**
 * Translates a v0.3 JSON agent card into a v1.0 proto `AgentCard`.
 * Every entry in `supportedInterfaces` is stamped with the card-level
 * `protocolVersion` (defaulting to `'0.3'`) so factories with
 * `legacyCompat` enabled can select the compat transport.
 *
 * Assumes the input has already passed `isLegacyAgentCard`.
 */
export function parseLegacyAgentCard(raw: unknown): V1AgentCard {
  return toCoreAgentCard(raw as legacy.AgentCard);
}

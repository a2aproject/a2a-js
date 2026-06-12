/**
 * v0.3 compat-layer helpers for the client-side {@link AgentCardResolver}.
 *
 * These helpers let a {@link DefaultAgentCardResolver} configured with
 * `legacyCompat: { enabled: true }` detect a v0.3-shaped agent-card
 * payload and translate it into a v1.0 proto {@link V1AgentCard} so the
 * rest of the client stack (transport factories, multitransport client)
 * sees a uniform v1.0 representation.
 *
 * The translator already lives in {@link toCoreAgentCard}
 * (`../translate/agent_card.ts`) and stamps `protocolVersion: '0.3'` on
 * every synthesized interface — both the primary (line 200) and every
 * entry of `additionalInterfaces` (via {@link toCoreAgentInterface}).
 * A {@link JsonRpcTransportFactory} constructed with
 * `legacyCompat: { enabled: true }` will then pick the compat transport
 * automatically when the matched interface declares a legacy version.
 *
 * Kept in the compat layer (rather than in the core
 * `src/client/card-resolver.ts`) so the v0.3 types and translators are
 * only called when an operator has explicitly opted into compat.
 */
import type { AgentCard as V1AgentCard } from '../../../types/pb/a2a.js';
import { toCoreAgentCard } from '../translate/agent_card.js';
import { isLegacyVersion } from '../translate/versions.js';
import type * as legacy from '../types/types.js';

/**
 * Field names that only appear on the v0.3 `AgentCard` shape (not on
 * the v1.0 proto-JSON shape).
 *
 * The presence of ANY of these (or a parseable legacy
 * `protocolVersion`) is enough to classify the payload as v0.3 without
 * inspecting every field on the card.
 */
const LEGACY_ONLY_TOP_LEVEL_FIELDS = [
  'preferredTransport',
  'additionalInterfaces',
  'supportsAuthenticatedExtendedCard',
] as const;

/**
 * Heuristically detects whether a raw agent-card JSON payload is
 * shaped according to the v0.3 spec.
 *
 * Returns `true` when ANY of the following holds:
 *  - The card has a top-level `url` AND no `supportedInterfaces`.
 *  - The card has any of {@link LEGACY_ONLY_TOP_LEVEL_FIELDS}.
 *  - The card has a `protocolVersion` value that falls inside the
 *    legacy range `[0.3, 1.0)` (per
 *    {@link isLegacyVersion}).
 *
 * Returns `false` for non-objects, null, and anything that lacks the
 * above indicators (which includes well-formed v1.0 cards).
 *
 * **Hybrid-card override.** A "superset" card emitted by
 * `toCompatAgentCard({ embedV1Interfaces: true })` carries BOTH a v0.3
 * top-level surface AND a v1.0 `supportedInterfaces[]`. When the
 * payload contains a non-empty `supportedInterfaces` array, this
 * function treats the v1.0 representation as authoritative and
 * returns `false` — the caller's v1.0 parser will read
 * `supportedInterfaces` directly, skipping the lossy legacy
 * translation that would otherwise stamp every entry with
 * `protocolVersion: '0.3'`.
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
 * Translates a v0.3 JSON agent-card payload into a v1.0 proto
 * {@link V1AgentCard}.
 *
 * The returned card has every entry in `supportedInterfaces` stamped
 * with `protocolVersion: '0.3'` (or whatever value the legacy card
 * declared at the card level), so downstream factories configured with
 * `legacyCompat: { enabled: true }` can select the v0.3 transport.
 *
 * The input is assumed to have already passed {@link isLegacyAgentCard}.
 * Callers that pass an obviously-malformed payload will get whatever
 * runtime error {@link toCoreAgentCard} produces.
 */
export function parseLegacyAgentCard(raw: unknown): V1AgentCard {
  return toCoreAgentCard(raw as legacy.AgentCard);
}

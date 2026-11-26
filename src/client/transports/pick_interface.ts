/**
 * Helper for picking the best-matching `AgentInterface` for a given
 * protocol binding. Lives in its own module so protocol-specific
 * factories and `ClientFactory` share the same dispatch policy.
 */

import type { AgentCard, AgentInterface } from '../../types/pb/a2a.js';
import { A2A_PROTOCOL_VERSION } from '../../constants.js';
import { isLegacyVersion, negotiateVersion, supportsVersion } from '../../version_utils.js';

/**
 * Picks the interface to use among `candidates` of one binding: the first
 * that serves this client's version, else the first the client can
 * downgrade to (an older v1 minor), else the first legacy v0.3 interface
 * (served by the compat transports when enabled). Returns `undefined` when
 * only other majors are offered, so the caller can try another binding.
 */
export function preferredInterface(candidates: AgentInterface[]): AgentInterface | undefined {
  return (
    candidates.find((iface) => supportsVersion(iface.protocolVersion, A2A_PROTOCOL_VERSION)) ??
    candidates.find((iface) => negotiateVersion(iface.protocolVersion) !== undefined) ??
    candidates.find((iface) => isLegacyVersion(iface.protocolVersion))
  );
}

/**
 * Picks the `AgentInterface` for `protocolBinding` whose `url` matches
 * `url`, using {@link preferredInterface}. Falls back to any matching
 * binding entry when no URL match is found, then to `undefined` when
 * nothing matches. Mirrors Python's `_find_best_interface(..., url=...)`.
 */
export function pickMatchingInterface(
  agentCard: AgentCard,
  protocolBinding: string,
  url: string
): AgentInterface | undefined {
  const candidates = interfacesForBinding(agentCard, protocolBinding);
  const byUrl = candidates.filter((iface) => iface.url === url);
  return preferredInterface(byUrl.length > 0 ? byUrl : candidates);
}

/** The card's interfaces for `protocolBinding`, compared case-insensitively. */
export function interfacesForBinding(
  agentCard: AgentCard,
  protocolBinding: string
): AgentInterface[] {
  const target = protocolBinding.toUpperCase();
  return (agentCard.supportedInterfaces ?? []).filter(
    (iface) => iface.protocolBinding?.toUpperCase() === target
  );
}

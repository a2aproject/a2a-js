import { A2A_LEGACY_PROTOCOL_VERSION } from '../constants.js';
import { TransportProtocolName } from '../core.js';
import { VersionNotSupportedError } from '../errors.js';
import { AgentCard } from '../index.js';

/**
 * Extracts the set of unique protocol versions explicitly declared in the
 * agent card's supported interfaces. There is no implicit default; if a
 * version is not listed, the agent does not support it.
 */
export function getSupportedVersions(
  agentCard: AgentCard,
  protocolBinding?: TransportProtocolName
): Set<string> {
  const versions = new Set<string>();
  for (const agentInterface of agentCard.supportedInterfaces ?? []) {
    if (protocolBinding && agentInterface.protocolBinding !== protocolBinding) {
      continue;
    }
    if (agentInterface.protocolVersion) {
      versions.add(agentInterface.protocolVersion);
    }
  }
  return versions;
}

/** Options for {@link validateVersion}. */
export interface ValidateVersionOptions {
  /**
   * Opt-in to v0.3 compatibility. When enabled, the legacy v0.3 protocol
   * version is implicitly added to the supported set for any binding the
   * card already exposes at least one interface for — so v0.3 (and
   * header-less) clients succeed without operators having to duplicate
   * every v1.0 `supportedInterfaces` entry with a v0.3 stub.
   *
   * Default: omitted (strict; only explicitly declared versions accepted).
   */
  legacyCompat?: { enabled: boolean };
}

/**
 * Validates that the requested A2A protocol version is supported by the
 * agent for the given protocol binding. Throws
 * {@link VersionNotSupportedError} if not.
 *
 * When `options.legacyCompat.enabled` is `true` AND the agent card exposes
 * at least one interface for the requested binding, the legacy v0.3
 * version is implicitly accepted.
 */
export function validateVersion(
  requestedVersion: string,
  agentCard: AgentCard,
  protocolBinding?: TransportProtocolName,
  options?: ValidateVersionOptions
): void {
  const supported = getSupportedVersions(agentCard, protocolBinding);

  if (options?.legacyCompat?.enabled) {
    // Implicit v0.3 acceptance: only if the card actually exposes the
    // requested binding. Otherwise we'd accept v0.3 for a transport the
    // agent doesn't serve and the failure would surface later as a
    // less useful dispatcher error.
    const hasBindingInterface = (agentCard.supportedInterfaces ?? []).some(
      (intf) => !protocolBinding || intf.protocolBinding === protocolBinding
    );
    if (hasBindingInterface) {
      supported.add(A2A_LEGACY_PROTOCOL_VERSION);
    }
  }

  if (!supported.has(requestedVersion)) {
    throw new VersionNotSupportedError(
      `The requested A2A protocol version '${requestedVersion}' is not supported. ` +
        `Supported versions: ${[...supported].join(', ')}`
    );
  }
}

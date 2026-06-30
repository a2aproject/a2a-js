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

/**
 * Validates that the requested A2A protocol version is supported by the
 * agent for the given protocol binding. Throws
 * {@link VersionNotSupportedError} if not. Accepts only versions
 * explicitly declared in `agentCard.supportedInterfaces`; to advertise
 * v0.3 on a binding, declare a per-interface `protocolVersion: '0.3'`
 * (manually or via `duplicateInterfacesForLegacy`).
 */
export function validateVersion(
  requestedVersion: string,
  agentCard: AgentCard,
  protocolBinding?: TransportProtocolName
): void {
  const supported = getSupportedVersions(agentCard, protocolBinding);

  if (!supported.has(requestedVersion)) {
    throw new VersionNotSupportedError(
      `The requested A2A protocol version '${requestedVersion}' is not supported. ` +
        `Supported versions: ${[...supported].join(', ')}`
    );
  }
}

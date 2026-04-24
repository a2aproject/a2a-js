import { TransportProtocolName } from '../core.js';
import { VersionNotSupportedError } from '../errors.js';
import { AgentCard } from '../index.js';

/**
 * Extracts the set of unique protocol versions from an AgentCard's
 * supported interfaces.
 *
 * Only versions explicitly declared in the agent card are returned.
 * An agent that does not list a version in its interfaces does not
 * support it — there is no implicit default.
 *
 * @param agentCard - The agent card to extract versions from.
 * @param protocolBinding - The protocol binding to filter versions by.
 * @returns A Set of supported version strings (Major.Minor format).
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
 * Validates that the requested A2A protocol version is supported by the agent.
 *
 * Per §3.6.2: "Agents MUST process requests using the semantics of the
 * requested A2A-Version (matching Major.Minor). If the version is not
 * supported by the interface, agents MUST return a VersionNotSupportedError."
 *
 * @param requestedVersion - The version requested by the client (from A2A-Version header).
 * @param agentCard - The agent card declaring supported interfaces/versions.
 * @param protocolBinding - The protocol binding to filter versions by.
 * @throws {VersionNotSupportedError} If the requested version is not supported.
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

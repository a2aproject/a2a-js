import { A2A_DEFAULT_VERSION } from '../constants.js';
import { VersionNotSupportedError } from '../errors.js';
import { AgentCard } from '../index.js';

/**
 * Extracts the set of unique protocol versions from an AgentCard's
 * supported interfaces. Results always include {@link A2A_DEFAULT_VERSION}
 * because agents MUST accept requests with an empty version header,
 * interpreting them as 0.3 (§3.6.2).
 *
 * @param agentCard - The agent card to extract versions from.
 * @returns A Set of supported version strings (Major.Minor format).
 */
export function getSupportedVersions(agentCard: AgentCard): Set<string> {
  const versions = new Set<string>();
  versions.add(A2A_DEFAULT_VERSION);
  for (const agentInterface of agentCard.supportedInterfaces ?? []) {
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
 * @throws {VersionNotSupportedError} If the requested version is not supported.
 */
export function validateVersion(requestedVersion: string, agentCard: AgentCard): void {
  const supported = getSupportedVersions(agentCard);
  if (!supported.has(requestedVersion)) {
    throw new VersionNotSupportedError(
      `The requested A2A protocol version '${requestedVersion}' is not supported. ` +
        `Supported versions: ${[...supported].join(', ')}`
    );
  }
}

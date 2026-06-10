import { A2A_LEGACY_PROTOCOL_VERSION } from '../constants.js';
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
 * Options for {@link validateVersion}.
 */
export interface ValidateVersionOptions {
  /**
   * Opt-in to v0.3 compatibility. When `{ enabled: true }`, the legacy
   * v0.3 protocol version ({@link A2A_LEGACY_PROTOCOL_VERSION}) is
   * treated as implicitly supported for any binding that the agent
   * card exposes at least one interface for — even if the card itself
   * doesn't declare a v0.3 `protocolVersion` entry.
   *
   * This honors the §3.6.2 default-to-`'0.3'` rule (clients that omit
   * the `A2A-Version` header MUST be treated as v0.3 requests) under
   * the SDK's opt-in compat layer. Operators that don't opt in
   * (`legacyCompat: { enabled: false }` or omitted) keep the strict
   * behavior — only explicitly declared versions are accepted.
   *
   * The `{ enabled: boolean }` shape mirrors the option used by every
   * public handler / transport-factory option type that exposes
   * legacy compat (`AgentCardHandlerOptions`, `JsonRpcHandlerOptions`,
   * `RestHandlerOptions`, `AgentCardResolverOptions`,
   * `JsonRpcTransportFactoryOptions`, `RestTransportFactoryOptions`,
   * `GrpcTransportFactoryOptions`).
   *
   * Default: omitted (strict). Has no effect unless the agent card
   * already advertises at least one interface for the requested
   * binding; otherwise the implicit v0.3 entry would route requests
   * to a binding the agent doesn't actually serve.
   */
  legacyCompat?: { enabled: boolean };
}

/**
 * Validates that the requested A2A protocol version is supported by the agent.
 *
 * Per §3.6.2: "Agents MUST process requests using the semantics of the
 * requested A2A-Version (matching Major.Minor). If the version is not
 * supported by the interface, agents MUST return a VersionNotSupportedError."
 *
 * When `options.legacyCompat` is `true` AND the agent card exposes at
 * least one interface for the requested binding, the legacy v0.3
 * version is implicitly added to the supported set. This lets a v1.0
 * server opted into the compat layer honor the §3.6.2 default-to-`'0.3'`
 * rule (and explicit `A2A-Version: 0.3` requests) without forcing
 * operators to duplicate every v1.0 `supportedInterfaces` entry with a
 * matching v0.3 stub.
 *
 * @param requestedVersion - The version requested by the client (from A2A-Version header).
 * @param agentCard - The agent card declaring supported interfaces/versions.
 * @param protocolBinding - The protocol binding to filter versions by.
 * @param options - Validation options (see {@link ValidateVersionOptions}).
 * @throws {VersionNotSupportedError} If the requested version is not supported.
 */
export function validateVersion(
  requestedVersion: string,
  agentCard: AgentCard,
  protocolBinding?: TransportProtocolName,
  options?: ValidateVersionOptions
): void {
  const supported = getSupportedVersions(agentCard, protocolBinding);

  if (options?.legacyCompat?.enabled) {
    // Implicit v0.3 acceptance: only if the agent card actually
    // exposes the requested binding (otherwise we'd accept v0.3 for a
    // transport the agent doesn't serve, which would just defer the
    // failure to the dispatcher with a less useful error).
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

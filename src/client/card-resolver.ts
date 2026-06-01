import { AGENT_CARD_PATH } from '../constants.js';
import { AgentCard } from '../index.js';
import { isLegacyAgentCard, parseLegacyAgentCard } from '../compat/v0_3/client/card-resolver.js';

export interface AgentCardResolverOptions {
  path?: string;
  fetchImpl?: typeof fetch;
  /**
   * Enables the v0.3 protocol compatibility layer.
   *
   * When enabled, the resolver inspects each fetched agent-card
   * payload; if its shape matches v0.3 (top-level `url` without
   * `supportedInterfaces`, `preferredTransport`,
   * `additionalInterfaces`, `supportsAuthenticatedExtendedCard`, or
   * a `protocolVersion` in `[0.3, 1.0)`), it is translated to the
   * v1.0 proto shape via `toCoreAgentCard`. Each synthesized
   * `AgentInterface` is stamped with `protocolVersion: '0.3'` so
   * that a {@link JsonRpcTransportFactory} configured with
   * `legacyCompat: { enabled: true }` selects the compat transport
   * automatically.
   *
   * Default: omitted (treated as disabled). When disabled, the v0.3
   * compat module is never loaded.
   */
  legacyCompat?: { enabled: boolean };
}

export interface AgentCardResolver {
  /**
   * Fetches the agent card based on provided base URL and path,
   */
  resolve(baseUrl: string, path?: string): Promise<AgentCard>;
}

export class DefaultAgentCardResolver implements AgentCardResolver {
  constructor(public readonly options?: AgentCardResolverOptions) {}

  /**
   * Fetches the agent card based on provided base URL and path.
   * Path is selected in the following order:
   * 1) path parameter
   * 2) path from options
   * 3) .well-known/agent-card.json
   */
  async resolve(baseUrl: string, path?: string): Promise<AgentCard> {
    const agentCardUrl = new URL(path ?? this.options?.path ?? AGENT_CARD_PATH, baseUrl);
    const response = await this.fetchImpl(agentCardUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Agent Card from ${agentCardUrl}: ${response.status}`);
    }
    const rawCard = await response.json();
    return this.normalizeAgentCard(rawCard);
  }

  private fetchImpl(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    if (this.options?.fetchImpl) {
      return this.options.fetchImpl(...args);
    }
    return fetch(...args);
  }

  /*
   * In the v0.3.0 specification, there was a structural drift between the JSON Schema data model
   * and the Protobuf-based data model for AgentCards.
   * The JSON Schema format uses a `"type"` discriminator (e.g., `{"type": "openIdConnect"}`),
   * while the Protobuf JSON representation uses the `oneof` field name as the discriminator
   * (e.g., `{"openIdConnectSecurityScheme": {...}}`).
   *
   * The A2A SDK internal logic expects the JSON Schema-based format. This fallback detection
   * allows us to parse cards served by endpoints returning the Protobuf JSON structure by
   * identifying the lack of the "type" field in security schemes or the presence of the
   * "schemes" wrapper in security entries, and normalizing it before use.
   *
   * When `legacyCompat: { enabled: true }`, this method also detects
   * v0.3-shaped cards and translates them via the compat
   * module so the rest of the client stack sees a uniform v1.0
   * representation with `protocolVersion: '0.3'` stamped on every
   * synthesized interface.
   */
  private normalizeAgentCard(card: unknown): AgentCard {
    if (this.options?.legacyCompat?.enabled) {
      if (isLegacyAgentCard(card)) {
        return parseLegacyAgentCard(card);
      }
    }
    if (this.isProtoAgentCard(card)) {
      const parsedProto = AgentCard.fromJSON(card);
      return parsedProto;
    }
    return card as AgentCard;
  }

  private isProtoAgentCard(card: unknown): boolean {
    if (!card || typeof card !== 'object') return false;
    const c = card as Record<string, unknown>;

    if (this.hasProtoSecurity(c.security)) return true;

    if (this.hasProtoSecuritySchemes(c.securitySchemes)) return true;

    if (Array.isArray(c.skills)) {
      return c.skills.some(
        (skill) =>
          skill &&
          typeof skill === 'object' &&
          this.hasProtoSecurity((skill as Record<string, unknown>).security)
      );
    }

    return false;
  }

  private hasProtoSecurity(securityArray: unknown): boolean {
    if (Array.isArray(securityArray) && securityArray.length > 0) {
      const first = securityArray[0];
      return first && typeof first === 'object' && 'schemes' in first;
    }
    return false;
  }

  private hasProtoSecuritySchemes(securitySchemes: unknown): boolean {
    if (securitySchemes && typeof securitySchemes === 'object') {
      const schemes = Object.values(securitySchemes);
      if (schemes.length > 0) {
        const first = schemes[0];
        // Proto JSON maps use the oneof field name directly rather than a "type" property
        return first && typeof first === 'object' && !('type' in first);
      }
    }
    return false;
  }
}

export const AgentCardResolver = {
  default: new DefaultAgentCardResolver(),
};

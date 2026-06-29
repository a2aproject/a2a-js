import { A2A_PROTOCOL_VERSION, A2A_VERSION_HEADER, AGENT_CARD_PATH } from '../constants.js';
import { AgentCard } from '../index.js';
import { isLegacyAgentCard, parseLegacyAgentCard } from '../compat/v0_3/client/index.js';

export interface AgentCardResolverOptions {
  path?: string;
  fetchImpl?: typeof fetch;
  /**
   * Enables the v0.3 protocol compatibility layer. When enabled, the
   * resolver detects v0.3-shaped card payloads and translates them to
   * the v1.0 proto shape via `toCoreAgentCard`. Each synthesized
   * `AgentInterface` is stamped with `protocolVersion: '0.3'` so that
   * a transport factory configured with `legacyCompat: { enabled: true }`
   * selects the compat transport automatically.
   *
   * Detection is based on the response shape, not the request, so the
   * discovery request always announces the SDK's native v1.0 in the
   * `A2A-Version` header.
   *
   * Default: omitted (disabled).
   */
  legacyCompat?: { enabled: boolean };
}

export interface AgentCardResolver {
  resolve(baseUrl: string, path?: string): Promise<AgentCard>;
}

export class DefaultAgentCardResolver implements AgentCardResolver {
  constructor(public readonly options?: AgentCardResolverOptions) {}

  /**
   * Fetches the agent card. Path is selected in this order:
   * `path` parameter → `options.path` → `/.well-known/agent-card.json`.
   */
  async resolve(baseUrl: string, path?: string): Promise<AgentCard> {
    const agentCardUrl = new URL(path ?? this.options?.path ?? AGENT_CARD_PATH, baseUrl);
    const response = await this.fetchImpl(agentCardUrl, {
      headers: { [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION },
    });
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
   * In v0.3 there was structural drift between the JSON Schema data
   * model and the Protobuf-based data model for AgentCards: JSON Schema
   * uses a `"type"` discriminator, while Protobuf JSON uses the `oneof`
   * field name. The SDK expects the JSON Schema format; this fallback
   * detects the Protobuf JSON shape and normalizes it before use.
   *
   * When `legacyCompat: { enabled: true }`, this method also detects
   * v0.3-shaped cards and translates them via the compat module.
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
        // Proto JSON uses the oneof field name directly rather than a "type" property.
        return first && typeof first === 'object' && !('type' in first);
      }
    }
    return false;
  }
}

export const AgentCardResolver = {
  default: new DefaultAgentCardResolver(),
};

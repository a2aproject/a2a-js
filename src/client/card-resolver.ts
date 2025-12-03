import { AGENT_CARD_PATH } from '../constants.js';
import { AgentCard } from '../types.js';

export interface AgentCardResolverOptions {
  path?: string;
  fetchImpl?: typeof fetch;
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
    return await response.json();
  }

  private fetchImpl(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    if (this.options?.fetchImpl) {
      return this.options.fetchImpl(...args);
    }
    return fetch(...args);
  }
}

export const AgentCardResolver = {
  Default: new DefaultAgentCardResolver(),
};

import { TransportProtocolName } from '../core.js';
import { AgentCard } from '../types.js';
import { Client, ClientConfig } from './multitransport-client.js';
import { JsonRpcTransportFactory } from './transports/json_rpc_transport.js';
import { TransportFactory } from './transports/transport.js';

export interface ClientFactoryOptions {
  /**
   * Transport factories to use.
   * Effectively defines transports supported by this client factory.
   */
  transports: ReadonlyArray<TransportFactory>;

  /**
   * Client config to be used for clients created by this factory.
   */
  clientConfig?: ClientConfig;

  /**
   * Transport preferences to override ones defined by the agent card.
   * If no matches are found among preferred transports, agent card values are used next.
   */
  preferredTransports?: TransportProtocolName[];
}

export const ClientFactoryOptions = {
  Default: {
    transports: [new JsonRpcTransportFactory()],
  },
};

export class ClientFactory {
  private readonly transportsByName = new Map<string, TransportFactory>();

  constructor(public readonly options: ClientFactoryOptions = ClientFactoryOptions.Default) {
    if (!options.transports || options.transports.length === 0) {
      throw new Error('No transports provided');
    }
    for (const transport of options.transports) {
      if (this.transportsByName.has(transport.protocolName)) {
        throw new Error(`Duplicate transport name: ${transport.protocolName}`);
      }
      this.transportsByName.set(transport.protocolName, transport);
    }
    for (const transport of options.preferredTransports ?? []) {
      const factory = this.options.transports.find((t) => t.protocolName === transport);
      if (!factory) {
        throw new Error(
          `Unknown preferred transport: ${transport}, available transports: ${[...this.transportsByName.keys()].join()}`
        );
      }
    }
  }

  async createFromAgentCard(agentCard: AgentCard): Promise<Client> {
    const agentCardPreferred = agentCard.preferredTransport ?? JsonRpcTransportFactory.name;
    const additionalInterfaces = agentCard.additionalInterfaces ?? [];
    const urlsPerAgentTransports = new Map<string, string>([
      [agentCardPreferred, agentCard.url],
      ...additionalInterfaces.map<[string, string]>((i) => [i.transport, i.url]),
    ]);
    const transportsByPreference = [
      ...(this.options.preferredTransports ?? []),
      agentCardPreferred,
      ...additionalInterfaces.map((i) => i.transport),
    ];
    for (const transport of transportsByPreference) {
      if (!urlsPerAgentTransports.has(transport)) {
        continue;
      }
      const factory = this.transportsByName.get(transport);
      if (!factory) {
        continue;
      }
      return new Client(
        await factory.create(urlsPerAgentTransports.get(transport), agentCard),
        agentCard,
        this.options.clientConfig
      );
    }
    throw new Error(
      'No compatible transport found, available transports: ' +
        [...this.transportsByName.keys()].join()
    );
  }
}

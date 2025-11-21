import { AgentCard, AgentInterface } from '../types.js';
import { Client } from './client.js';
import { JsonRpcTransportFactory } from './transports/json_rpc_transport.js';
import { TransportFactory } from './transports/transport.js';

export interface ClientFactoryOptions {
  transports: ReadonlyArray<TransportFactory>;
}

export const ClientFactoryOptions = {
  Default: {
    transports: [new JsonRpcTransportFactory()],
  },
};

export class ClientFactory {
  private readonly transportsByName = new Map<string, TransportFactory>();

  constructor(public readonly options: ClientFactoryOptions = ClientFactoryOptions.Default) {
    for (const transport of options.transports) {
      if (this.transportsByName.has(transport.name)) {
        throw new Error(`Duplicate transport name: ${transport.name}`);
      }
      this.transportsByName.set(transport.name, transport);
    }
  }

  async createClient(agentCard: AgentCard): Promise<Client> {
    const preferred: AgentInterface = {
      transport: agentCard.preferredTransport ?? JsonRpcTransportFactory.name,
      url: agentCard.url,
    };
    // Additional interfaces may contain preferred transport as well, but it won't impact the logic below.
    const all = [preferred, ...(agentCard.additionalInterfaces ?? [])];
    for (const transport of all) {
      const factory = this.transportsByName.get(transport.transport);
      if (factory) {
        return new Client(await factory.create(transport.url, agentCard));
      }
    }
    throw new Error(
      'No compatible transport found, available transports: ' +
        [...this.transportsByName.keys()].join()
    );
  }
}

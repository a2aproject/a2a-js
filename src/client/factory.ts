import { AgentCard } from '../types.js';
import { Client } from './client.js';
import { Transport, TransportFactory } from './transports/transport.js';

export class ClientFactoryOptions {
  private readonly _transports: TransportFactory[] = [];

  get transports(): ReadonlyArray<TransportFactory> {
    return this._transports;
  }

  withTransport(transportFactory: TransportFactory): ClientFactoryOptions {
    this._transports.push(transportFactory);
    return this;
  }
}

export class ClientFactory {
  constructor(private readonly options: ClientFactoryOptions = new ClientFactoryOptions()) {}

  async createClient(agentCard: AgentCard): Promise<Client> {
    const preferred = agentCard.preferredTransport;
    const transport = agentCard.additionalInterfaces.find((t) => t.transport === preferred);
    const transportFactory = this.options.transports.find((t) => t.name === preferred);
    
  }
}

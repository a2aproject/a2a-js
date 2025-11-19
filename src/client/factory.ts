import { JsonRpcTransport } from './transports/json_rpc_transport.js';
import { Transport } from './transports/transport.js';
import { TransportProtocol } from '../types.js';

export class ClientFactoryOptions {
  private readonly transports: Map<TransportProtocol, Transport> = new Map();

  addTransport(protocol: TransportProtocol, transport: Transport): ClientFactoryOptions {
    this.transports.set(protocol, transport);
    return this;
  }
}

export class ClientFactory {
  constructor(private readonly options: ClientFactoryOptions = new ClientFactoryOptions()) {}
}

new ClientFactoryOptions().addTransport(
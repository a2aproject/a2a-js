import { TransportProtocolName } from '../core.js';
import { AgentCard } from '../types.js';
import { AgentCardResolver } from './card-resolver.js';
import { Client, ClientConfig } from './multitransport-client.js';
import { JsonRpcTransportFactory } from './transports/json_rpc_transport.js';
import { RestTransportFactory } from './transports/rest_transport.js';
import { TransportFactory } from './transports/transport.js';

export interface ClientFactoryOptions {
  /**
   * Transport factories to use.
   * Effectively defines transports supported by this client factory.
   */
  transports: TransportFactory[];

  /**
   * Client config to be used for clients created by this factory.
   */
  clientConfig?: ClientConfig;

  /**
   * Transport preferences to override ones defined by the agent card.
   * If no matches are found among preferred transports, agent card values are used next.
   */
  preferredTransports?: TransportProtocolName[];

  /**
   * Used for createFromAgentCardUrl to download agent card.
   */
  cardResolver?: AgentCardResolver;
}

export const ClientFactoryOptions = {
  /**
   * SDK default options for {@link ClientFactory}.
   */
  default: {
    transports: [new JsonRpcTransportFactory(), new RestTransportFactory()],
  } as Readonly<ClientFactoryOptions>,

  /**
   * Creates new options by merging an original and an override object.
   * Transports are merged based on `TransportFactory.protocolName`,
   * interceptors are concatenated, other fields are overriden.
   *
   * @example
   * ```ts
   * const options = ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
   *  transports: [new MyCustomTransportFactory()], // adds a custom transport
   *  clientConfig: { interceptors: [new MyInterceptor()] }, // adds a custom interceptor
   * });
   * ```
   */
  createFrom(
    original: ClientFactoryOptions,
    overrides: Partial<ClientFactoryOptions>
  ): ClientFactoryOptions {
    return {
      ...original,
      ...overrides,
      transports: mergeTransports(original.transports, overrides.transports),
      clientConfig: {
        ...(original.clientConfig ?? {}),
        ...(overrides.clientConfig ?? {}),
        interceptors: mergeArrays(
          original.clientConfig?.interceptors,
          overrides.clientConfig?.interceptors
        ),
        acceptedOutputModes:
          overrides.clientConfig?.acceptedOutputModes ?? original.clientConfig?.acceptedOutputModes,
      },
      preferredTransports: overrides.preferredTransports ?? original.preferredTransports,
    };
  },
};

export class ClientFactory {
  private readonly transportsByName: CaseInsensitiveMap<TransportFactory>;
  private readonly agentCardResolver: AgentCardResolver;

  constructor(public readonly options: ClientFactoryOptions = ClientFactoryOptions.default) {
    if (!options.transports || options.transports.length === 0) {
      throw new Error('No transports provided');
    }
    this.transportsByName = transportsByName(options.transports);
    for (const transport of options.preferredTransports ?? []) {
      if (!this.transportsByName.has(transport)) {
        throw new Error(
          `Unknown preferred transport: ${transport}, available transports: ${[...this.transportsByName.keys()].join()}`
        );
      }
    }
    this.agentCardResolver = options.cardResolver ?? AgentCardResolver.default;
  }

  /**
   * Creates a new client from the provided agent card.
   */
  async createFromAgentCard(agentCard: AgentCard): Promise<Client> {
    const agentCardPreferred = agentCard.preferredTransport ?? JsonRpcTransportFactory.name;
    const additionalInterfaces = agentCard.additionalInterfaces ?? [];
    const urlsPerAgentTransports = new CaseInsensitiveMap<string>([
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

  /**
   * Downloads agent card using AgentCardResolver from options
   * and creates a new client from the downloaded card.
   *
   * @example
   * ```ts
   * const factory = new ClientFactory(); // use default options and default {@link AgentCardResolver}.
   * const client1 = await factory.createFromUrl('https://example.com'); // /.well-known/agent-card.json is used by default
   * const client2 = await factory.createFromUrl('https://example.com', '/my-agent-card.json'); // specify custom path
   * const client3 = await factory.createFromUrl('https://example.com/my-agent-card.json', ''); // specify full URL and set path to empty
   * ```
   */
  async createFromUrl(baseUrl: string, path?: string): Promise<Client> {
    const agentCard = await this.agentCardResolver.resolve(baseUrl, path);
    return this.createFromAgentCard(agentCard);
  }
}

function mergeTransports(
  original: TransportFactory[],
  overrides: TransportFactory[] | undefined
): TransportFactory[] {
  if (!overrides) {
    return original;
  }

  const result = transportsByName(original);
  const overridesByName = transportsByName(overrides);
  for (const [name, factory] of overridesByName) {
    result.set(name, factory);
  }
  return Array.from(result.values());
}

function transportsByName(
  transports: ReadonlyArray<TransportFactory> | undefined
): CaseInsensitiveMap<TransportFactory> {
  const result = new CaseInsensitiveMap<TransportFactory>();
  if (!transports) {
    return result;
  }
  for (const t of transports) {
    if (result.has(t.protocolName)) {
      throw new Error(`Duplicate protocol name: ${t.protocolName}`);
    }
    result.set(t.protocolName, t);
  }
  return result;
}

function mergeArrays<T>(
  a1: ReadonlyArray<T> | undefined,
  a2: ReadonlyArray<T> | undefined
): T[] | undefined {
  if (!a1 && !a2) {
    return undefined;
  }

  return [...(a1 ?? []), ...(a2 ?? [])];
}

/**
 * A Map that normalizes string keys to uppercase for case-insensitive lookups.
 * This prevents errors from inconsistent casing in protocol names.
 */
class CaseInsensitiveMap<T> extends Map<string, T> {
  private normalizeKey(key: string): string {
    return key.toUpperCase();
  }

  override set(key: string, value: T): this {
    return super.set(this.normalizeKey(key), value);
  }

  override get(key: string): T | undefined {
    return super.get(this.normalizeKey(key));
  }

  override has(key: string): boolean {
    return super.has(this.normalizeKey(key));
  }

  override delete(key: string): boolean {
    return super.delete(this.normalizeKey(key));
  }
}

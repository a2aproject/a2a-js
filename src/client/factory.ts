import { TransportProtocolName } from '../core.js';
import { AgentCard } from '../index.js';
import { AgentCardResolver } from './card-resolver.js';
import { Client, ClientConfig } from './multitransport-client.js';
import { JsonRpcTransportFactory } from './transports/json_rpc_transport.js';
import { RestTransportFactory } from './transports/rest_transport.js';
import { TenantTransportDecorator } from './transports/tenant_transport_decorator.js';
import { TransportFactory } from './transports/transport.js';

export interface ClientFactoryOptions {
  /**
   * Transport factories to use. Effectively defines transports supported
   * by this client factory.
   */
  transports: TransportFactory[];

  /** Client config used for clients created by this factory. */
  clientConfig?: ClientConfig;

  /**
   * Transport preferences overriding those defined by the agent card.
   * If no matches are found among preferred transports, agent card
   * values are used next.
   */
  preferredTransports?: TransportProtocolName[];

  /** Used by `createFromUrl` to download the agent card. */
  cardResolver?: AgentCardResolver;
}

export const ClientFactoryOptions = {
  /** SDK default options for {@link ClientFactory}. */
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
   * Creates a new client from the provided agent card. When the selected
   * `AgentInterface` declares a non-empty `tenant`, the transport is
   * wrapped with a {@link TenantTransportDecorator} so the default tenant
   * is applied to every request.
   */
  async createFromAgentCard(agentCard: AgentCard): Promise<Client> {
    const interfaces = agentCard.supportedInterfaces ?? [];

    const bestInterfacePerProtocol = new CaseInsensitiveMap<(typeof interfaces)[number]>();
    for (const agentInterface of interfaces) {
      const existing = bestInterfacePerProtocol.get(agentInterface.protocolBinding);
      if (!existing || agentInterface.protocolVersion === '1.0') {
        bestInterfacePerProtocol.set(agentInterface.protocolBinding, agentInterface);
      }
    }

    const transportsByPreference = [
      ...(this.options.preferredTransports ?? []),
      ...interfaces.map((i) => i.protocolBinding),
    ];
    for (const transportName of transportsByPreference) {
      const selectedInterface = bestInterfacePerProtocol.get(transportName);
      const factory = this.transportsByName.get(transportName);
      if (factory && selectedInterface) {
        let transport = await factory.create(selectedInterface.url, agentCard);

        if (selectedInterface.tenant) {
          transport = new TenantTransportDecorator(transport, selectedInterface.tenant);
        }

        return new Client(transport, agentCard, this.options.clientConfig);
      }
    }
    throw new Error(
      'No compatible transport found, available transports: ' +
        [...this.transportsByName.keys()].join()
    );
  }

  /**
   * Downloads the agent card using the configured {@link AgentCardResolver}
   * and creates a new client from it.
   *
   * @example
   * ```ts
   * const factory = new ClientFactory();
   * // /.well-known/agent-card.json is used by default.
   * const client = await factory.createFromUrl('https://example.com');
   * // Custom path.
   * const client2 = await factory.createFromUrl('https://example.com', '/my-card.json');
   * // Full URL with empty path.
   * const client3 = await factory.createFromUrl('https://example.com/my-card.json', '');
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
 * Map that uppercases string keys so protocol-name lookups are case-insensitive.
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

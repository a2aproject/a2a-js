/**
 * Opaque context object to carry per-call context data.
 * Use {@link ClientCallContextKey} to create typed keys for storing and retrieving values.
 */
export type ClientCallContext = Record<symbol, unknown>;

/**
 * Function that applies an update to a {@link ClientCallContext}.
 */
export type ContextUpdate = (context: ClientCallContext) => void;

export const ClientCallContext = {
  /**
   * Create a new {@link ClientCallContext} with optional updates applied.
   */
  create: (...updates: ContextUpdate[]): ClientCallContext => {
    return ClientCallContext.createFrom(undefined, ...updates);
  },

  /**
   * Create a new {@link ClientCallContext} based on an existing one with updates applied.
   */
  createFrom: (
    context: ClientCallContext | undefined,
    ...updates: ContextUpdate[]
  ): ClientCallContext => {
    const result = context ? { ...context } : {};
    for (const update of updates) {
      update(result);
    }
    return result;
  },
};

/**
 * Each instance represents a unique key for storing
 * and retrieving typed values in a {@link ClientCallContext}.
 *
 * @example
 * ```ts
 * const key = new ClientCallContextKey<string>('My key');
 * const context = ClientCallContext.create(key.set('example-value'));
 * const value = key.get(context); // 'example-value'
 * ```
 */
export class ClientCallContextKey<T> {
  public readonly symbol: symbol;

  constructor(description: string) {
    this.symbol = Symbol(description);
  }

  set(value: T): ContextUpdate {
    return (context) => {
      context[this.symbol] = value;
    };
  }

  get(context: ClientCallContext): T | undefined {
    return context[this.symbol] as T | undefined;
  }
}

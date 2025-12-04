export type ClientCallContext = Record<symbol, unknown>;

export type ContextUpdate = (context: ClientCallContext) => void;

export const ClientCallContext = {
  create: (...updates: ContextUpdate[]): ClientCallContext => {
    return ClientCallContext.createFrom(undefined, ...updates);
  },

  createFrom: (
    context: ClientCallContext | undefined,
    ...updates: ContextUpdate[]
  ): ClientCallContext => {
    const result = { ...context };
    for (const update of updates) {
      update(result);
    }
    return result;
  },
};

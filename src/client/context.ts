export type Context = Record<string, unknown>;

export type ContextUpdate = (context: Context) => void;

export const Context = {
  create: (...updates: ContextUpdate[]): Context => {
    const result = {};
    Context.withUpdates(result, ...updates);
    return result;
  },

  withUpdates: (context: Context | undefined, ...updates: ContextUpdate[]) => {
    const result = { ...context };
    for (const update of updates) {
      update(result);
    }
  },
};

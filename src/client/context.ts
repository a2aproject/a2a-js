export type Context = Record<string, unknown>;

export type ContextUpdate = (context: Context) => void;

export function buildContext(...updates: ContextUpdate[]): Context {
  const result = {};
  updateContext(result, ...updates);
  return result;
}

export function updateContext(context: Context | undefined, ...updates: ContextUpdate[]) {
  for (const update of updates) {
    update(context);
  }
  return context;
}

export function withMy(s: string): ContextUpdate {
  return (context: Context) => {
    context.my = s;
  };
}

updateContext(undefined, withMy('hello'))
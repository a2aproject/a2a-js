/** What a call produced, merged into the response passed to the `after` hook. */
export interface CallOutcome {
  payload?: unknown;
  error?: unknown;
  isStreamEvent: boolean;
  isFinal: boolean;
}

/** One side's (server or client) hooks, bound from a `PluginManager`. */
export interface CallHooks<Req, Res> {
  before(request: Req): void | Promise<void>;
  around<T>(request: Req, next: () => T): T;
  after(response: Res): void | Promise<void>;
  /** Builds the `after` argument. Called after `before`, so it sees changes `before` made. */
  response(request: Req, outcome: CallOutcome): Res;
}

/** Runs a unary call: `before`, then the call inside `around`, then `after` with the result or error. */
export async function runCall<Req, Res, T>(
  hooks: CallHooks<Req, Res>,
  request: Req,
  call: () => Promise<T>
): Promise<T> {
  await hooks.before(request);
  let result: T;
  try {
    result = await hooks.around(request, call);
  } catch (error) {
    await hooks.after(hooks.response(request, { error, isStreamEvent: false, isFinal: true }));
    throw error;
  }
  await hooks.after(
    hooks.response(request, { payload: result, isStreamEvent: false, isFinal: true })
  );
  return result;
}

/**
 * Runs a streaming call. `around` wraps every pull of the inner stream, so the
 * code producing each event runs inside the plugin's scope. `after` runs once
 * per event and once more when the stream ends, including on error and when
 * the consumer stops early.
 */
export async function* runStream<Req, Res, T>(
  hooks: CallHooks<Req, Res>,
  request: Req,
  open: () => AsyncGenerator<T, void, undefined>
): AsyncGenerator<T, void, undefined> {
  await hooks.before(request);
  let iterator: AsyncGenerator<T, void, undefined> | undefined;
  let error: unknown;
  try {
    iterator = open();
    while (true) {
      const next = await hooks.around(request, () => iterator!.next());
      if (next.done === true) {
        break;
      }
      await hooks.after(
        hooks.response(request, { payload: next.value, isStreamEvent: true, isFinal: false })
      );
      yield next.value;
    }
  } catch (e) {
    error = e;
    throw e;
  } finally {
    try {
      // Closes the inner stream if the consumer stopped early; a no-op on a
      // generator that already finished or threw.
      await iterator?.return(undefined);
    } finally {
      await hooks.after(hooks.response(request, { error, isStreamEvent: false, isFinal: true }));
    }
  }
}

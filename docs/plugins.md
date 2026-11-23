# Plugins

A plugin is one object that hooks into the A2A client and server. Cross-cutting
features such as tracing, metrics, auditing, authentication or experiment
propagation often need to touch several places at once: the call on the client,
the request on the server, the agent's execution and the task store. A plugin
registers for all of them in one place.

Plugins live in a separate entry point with no runtime dependencies, so they work
anywhere the SDK runs, including Cloudflare Workers:

```ts
import type { A2APlugin } from '@a2a-js/sdk/plugins';
```

See the [`plugins` sample](../src/samples/plugins/) for a runnable server and
client, and [`src/plugins/types.ts`](../src/plugins/types.ts) for the full API.

## Writing a plugin

A plugin is a plain object with a `name` and any hooks it needs. Every hook is
optional.

```ts
import { TaskState } from '@a2a-js/sdk';
import type { A2APlugin } from '@a2a-js/sdk/plugins';

const audit: A2APlugin = {
  name: 'audit',
  afterHandlerRun: ({ method, context, error, isFinal }) => {
    if (isFinal) console.log(method, context.protocolBinding, error ?? 'ok');
  },
  onTaskEvent: ({ taskId, fromState, toState }) => {
    const from = fromState === undefined ? 'new' : TaskState[fromState];
    console.log(`task ${taskId}: ${from} -> ${TaskState[toState]}`);
  },
};
```

## Registering plugins

Pass plugins as an array. They run in the order given. The same object can be
registered on both sides; each side only calls the hooks that apply to it.

**Server.** `DefaultRequestHandler` runs the server, execution and task hooks:

```ts
const requestHandler = new DefaultRequestHandler(
  agentCard,
  taskStore,
  agentExecutor,
  undefined, // eventBusManager
  undefined, // pushNotificationStore
  undefined, // pushNotificationSender
  undefined, // extendedAgentCardProvider
  undefined, // agentCardSignatureGenerator
  { plugins: [audit] }
);
```

The handler also passes its plugins to the `DefaultPushNotificationSender` it
creates when the agent card declares `capabilities.pushNotifications`. If you
pass your own sender, give it the plugins yourself:

```ts
new DefaultPushNotificationSender(pushNotificationStore, { plugins: [audit] });
```

**Client.** Set `plugins` in `ClientConfig`:

```ts
const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    clientConfig: { plugins: [tracing] },
  })
);
```

`ClientFactoryOptions.createFrom` concatenates `plugins` from both arguments, the
same way it does `interceptors`.

## Hooks

| Hook                  | Runs                                                        | Can                                   |
| --------------------- | ----------------------------------------------------------- | ------------------------------------- |
| `beforeHandlerRun`    | Before `DefaultRequestHandler` handles a request            | Reject the request by throwing        |
| `aroundHandlerRun`    | Around the handler call                                     | Run the call inside a scope           |
| `afterHandlerRun`     | With the result, once per stream event, and once at the end | Observe                               |
| `beforeClientRequest` | Before `Client` sends a call                                | Change the payload or headers, cancel |
| `aroundClientRequest` | Around the call                                             | Run the call inside a scope           |
| `afterClientRequest`  | With the result, once per stream event, and once at the end | Observe                               |
| `beforeExecution`     | Before `AgentExecutor.execute`                              | Fail the execution by throwing        |
| `aroundExecution`     | Around `execute`                                            | Run the agent inside a scope          |
| `onExecutionEvent`    | Each time the agent publishes an event (synchronous)        | Observe                               |
| `afterExecution`      | After `execute` returns or throws                           | Observe                               |
| `onTaskEvent`         | After each successful task write                            | Observe                               |
| `beforePushSend`      | Before each push notification webhook request               | Add headers, skip, fail by throwing   |
| `onPushSent`          | After each delivery attempt, or when it was skipped         | Observe                               |

Server hooks run for every method of `DefaultRequestHandler` except
`getAgentCard`, and receive the spec method name (`SendMessage`,
`SubscribeToTask`, …). `context.protocolBinding` says which transport the request
came in on: `JSONRPC`, `HTTP+JSON` or `GRPC`.

`onTaskEvent` receives the state before the write (`fromState`, `undefined` for a
new task) and after it (`toState`). Writes that don't change the state, such as
artifact updates, report the same value for both.

`onPushSent` reports `durationMs` for the HTTP request only, and `0` when nothing
was sent.

## How hooks run

With several plugins:

- `before*` hooks run in registration order. If one throws, the plugins that
  already ran get their matching `after*` hook with the error, and the error
  goes back to the caller. `beforePushSend` is the exception: every push plugin
  gets `onPushSent` with the error, and the sender logs it instead of returning
  it.
- `around*` hooks nest: the first plugin is the outermost wrapper.
- `after*` hooks run in reverse order.
- `on*` hooks run in registration order.

Hooks are awaited, so a slow hook slows the call it runs in. Errors thrown by
`after*` and `on*` hooks are logged with `console.error` and ignored, so an
observing plugin can't break a call.

For streams (`SendStreamingMessage`, `SubscribeToTask`):

- `after*` runs once per event with `isStreamEvent: true`, then once more with
  `isFinal: true` and no payload. The final call also happens when the stream
  fails (with `error`) or when the consumer stops early.
- `around*` wraps each pull of the next event, not the stream as a whole, so it
  runs once per event plus once for the end of the stream.

`onExecutionEvent` reports only events the agent publishes, with that
execution's `RequestContext`. `onTaskEvent` runs after the task's write lock is
released, so a hook may write to the task through the `TaskStore`. Don't await
`DefaultRequestHandler.cancelTask` for the same task from `onTaskEvent`: it
waits for the event processing that the hook is part of, so neither finishes.

## Passing data between hooks

Each call carries an object that every hook of that call sees:

- **Server:** `context.state`, a `Map` on the `ServerCallContext`. With the
  default context builder it also holds the request headers under
  `STATE_HEADERS_KEY`; a custom `contextBuilder` has to add them itself.
- **Push:** `request.state`, a `Map` that comes back as `result.request.state` in
  `onPushSent`.
- **Client:** `options.context`, the `ClientCallContext` of the call. It is
  `undefined` unless the caller passed one, and it is the caller's own object, so
  replace it rather than editing it:
  `req.options.context = ClientCallContext.createFrom(req.options.context, key.set(value))`,
  with a `ClientCallContextKey` from `@a2a-js/sdk/client`.

Prefix `Map` keys with the plugin name to avoid collisions:

```ts
import type { A2APlugin } from '@a2a-js/sdk/plugins';

const timing: A2APlugin = {
  name: 'timing',
  beforeHandlerRun: ({ context }) => {
    context.state.set('timing.start', performance.now());
  },
  afterHandlerRun: ({ method, context, isFinal }) => {
    if (!isFinal) return;
    const start = context.state.get('timing.start') as number;
    console.log(`${method} took ${(performance.now() - start).toFixed(1)}ms`);
  },
};
```

To send a value to the server, add it to `serviceParameters` in
`beforeClientRequest`. Each transport sends service parameters as HTTP headers
(JSON-RPC, REST) or gRPC metadata. On the server, read them from the headers in
`context.state`:

```ts
import { STATE_HEADERS_KEY } from '@a2a-js/sdk/server';
import type { A2APlugin } from '@a2a-js/sdk/plugins';

const experiments: A2APlugin = {
  name: 'experiments',
  beforeClientRequest: (req) => {
    req.options.serviceParameters = {
      ...req.options.serviceParameters,
      'x-experiment-id': 'exp-42',
    };
  },
  beforeHandlerRun: ({ context }) => {
    const headers = context.state.get(STATE_HEADERS_KEY) as Record<string, string> | undefined;
    console.log('experiment', headers?.['x-experiment-id']);
  },
};
```

Each client call gets its own copy of `serviceParameters`, so a plugin that edits
it in place never changes the caller's `RequestOptions`.

## Scoping work with `around*` hooks

`around*` hooks receive a `next` function and must return its result. Code that
runs inside `next` runs inside whatever scope the hook sets up, such as an
`AsyncLocalStorage` store or an OpenTelemetry active span. `before*` and `after*`
hooks can't do this, because they run before and after the work, not around it.

Use `aroundExecution` to scope the agent's own work, including any calls it
makes to other agents. The agent can keep running after the request that
started it has returned, and this hook's scope covers the whole execution. This
plugin forwards a tenant ID from the request an agent serves to every call that
agent makes:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { STATE_HEADERS_KEY } from '@a2a-js/sdk/server';
import type { A2APlugin } from '@a2a-js/sdk/plugins';

const tenant = new AsyncLocalStorage<string | undefined>();

export const tenantPropagation: A2APlugin = {
  name: 'tenant-propagation',
  aroundExecution: (requestContext, next) => {
    const headers = requestContext.context.state.get(STATE_HEADERS_KEY) as
      | Record<string, string>
      | undefined;
    return tenant.run(headers?.['x-tenant'], next);
  },
  beforeClientRequest: (req) => {
    const value = tenant.getStore();
    if (value) {
      req.options.serviceParameters = { ...req.options.serviceParameters, 'x-tenant': value };
    }
  },
};
```

Register it on the agent's `DefaultRequestHandler` and on the `Client` the agent
uses for its outgoing calls.

## Plugins and interceptors

The client also has `CallInterceptor`s (`ClientConfig.interceptors`). Both can
change outgoing calls; they differ in scope:

|                      | Plugins                                           | Interceptors                  |
| -------------------- | ------------------------------------------------- | ----------------------------- |
| Where                | Client, server, agent execution, task store, push | Client only                   |
| Order on the client  | Outside: run first and finish last                | Inside plugins                |
| Short-circuit a call | Throw in `beforeClientRequest`                    | Set `earlyReturn` in `before` |
| Scope the call       | `aroundClientRequest`                             | Not supported                 |

When an interceptor returns early, plugins see that value as the call's result.
Use interceptors for client-only changes, such as an existing `CallInterceptor`
or an early return from a cache; use plugins when a feature spans both sides or
needs a scope.

# Client Interceptors

This sample demonstrates two transport-agnostic client customization techniques
provided by the SDK:

1. **`CallInterceptor`** — wrap every method call with `before` / `after`
   hooks. Use cases include header injection (request IDs, tracing,
   authentication) and metrics collection.
2. **`AbortSignal` per-call timeouts** — pass a `signal` field in
   `RequestOptions` to abort a single call after a fixed duration.

See [`src/client/interceptors.ts`](../../../client/interceptors.ts) for the
interface, and the
[A2A Specification §3.6 HTTP Headers](https://a2a-protocol.org/latest/specification/#36-http-headers)
for protocol-level header conventions.

## What the sample does

- `RequestIdInterceptor` injects a unique `X-Request-ID` value into
  `RequestOptions.serviceParameters` for every call.
- `LoggingInterceptor` records the start time in `serviceParameters` during
  `before` and prints elapsed milliseconds during `after`.
- The script then sends three messages:
  1. a normal call to demonstrate both interceptors firing,
  2. a call with a generous `AbortSignal.timeout(5000)`,
  3. a call with `AbortSignal.timeout(1)` that should abort.

## Running the sample

Start any A2A server (for example the bundled sample agent):

```bash
npm run agents:sample-agent
```

Then in another terminal:

```bash
npm run client:interceptors
```

Sample output:

```
[RequestIdInterceptor] sendMessage -> X-Request-ID=...
[LoggingInterceptor] -> sendMessage
[LoggingInterceptor] <- sendMessage (1280.4ms)

--- Demo 2: Per-call AbortSignal.timeout ---
...
[Main] Call returned within the timeout.

--- Demo 3: Forcing a timeout (1ms) ---
...
[Main] As expected, the call was aborted: ...
```

## Configuration

| Variable    | Default                   | Description                |
| ----------- | ------------------------- | -------------------------- |
| `AGENT_URL` | `http://localhost:41241`  | A2A server to call         |

# Plugins

This sample shows the plugin system from [`@a2a-js/sdk/plugins`](../../plugins/types.ts).
A plugin is one object that hooks into the client, the server, agent execution and task
writes, so a cross-cutting feature needs a single registration.

The server serves the [sample agent](../agents/sample-agent/) over JSON-RPC, REST and gRPC
from one `DefaultRequestHandler`. The client calls it once per run, with a streaming message
and a `getTask`.

## Plugins in this sample

All four live in [`plugins.ts`](./plugins.ts).

| Plugin            | Side   | Hooks                                 | What it does                                                                                                                                                                |
| ----------------- | ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `experiments`     | client | `beforeClientRequest`                 | Adds an `x-experiment-id` service parameter to every call.                                                                                                                  |
| `audit`           | server | `afterHandlerRun`, `onTaskEvent`      | Logs each finished call with its method, binding and experiment ID, and each task state change.                                                                             |
| `timing`          | server | `beforeHandlerRun`, `afterHandlerRun` | Logs how long each call took and how many events it streamed, keeping per-call data in `context.state`.                                                                     |
| `experimentScope` | server | `aroundExecution`                     | Runs the agent inside an `AsyncLocalStorage` scope holding the experiment ID, so code the agent runs can tag its logs with `logWithExperiment` without being passed the ID. |

`around*` hooks wrap the call, so a plugin can scope the work inside it. An OpenTelemetry
plugin would use the same pattern to make its span the active one. See
[`src/plugins/types.ts`](../../plugins/types.ts) for every hook.

## Running the sample

Start the server:

```bash
npm run agents:plugins-server
```

Then, in another terminal, run the client. Pick a binding with `--transport`:

```bash
npm run agents:plugins-client -- --transport=GRPC
```

Client output:

```
[client] GRPC to localhost:41242, experiment=exp-42
[client] agent replied: Hello World! Nice to meet you!
[client] task c1ff89c4 is TASK_STATE_COMPLETED
```

Server output for the same run (the sample agent's own log lines are left out):

```
[agent experiment=exp-42] handling task c1ff89c4
[audit] task c1ff89c4: new -> SUBMITTED
[audit] task c1ff89c4: SUBMITTED -> WORKING
[audit] task c1ff89c4: WORKING -> WORKING
[audit] task c1ff89c4: WORKING -> COMPLETED
[timing] SendStreamingMessage took 1004.4ms, 4 streamed event(s)
[audit] SendStreamingMessage over GRPC experiment=exp-42 ok
[timing] GetTask took 0.2ms, 0 streamed event(s)
[audit] GetTask over GRPC experiment=exp-42 ok
```

The `WORKING -> WORKING` line is the artifact write: it changes the task but not its state.

## Configuration

| Variable        | Used by | Default                  | Description                     |
| --------------- | ------- | ------------------------ | ------------------------------- |
| `HTTP_PORT`     | server  | `41241`                  | Port for JSON-RPC and REST      |
| `GRPC_PORT`     | server  | `41242`                  | Port for gRPC                   |
| `AGENT_URL`     | client  | `http://localhost:41241` | Base URL of the agent card      |
| `EXPERIMENT_ID` | client  | `exp-42`                 | Value sent as `x-experiment-id` |

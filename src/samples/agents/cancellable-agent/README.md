# Cancellable Agent

This sample demonstrates user-initiated A2A task cancellation. The agent runs a
multi-step (5×1s) task and checks for cancellation before each step. The
companion client kicks off the task and, after a short delay, calls
`cancelTask` on the same `client` instance.

For details, see the
[A2A Specification §3.1.7 cancelTask](https://a2a-protocol.org/latest/specification/#317-canceltask).

## Components

- `agent_executor.ts` — implements `cancelTask(taskId, eventBus)` by recording
  the taskId in an in-memory `Set`. The `execute` loop checks this set before
  each step and, if cancelled, publishes a final
  `TaskState.TASK_STATE_CANCELED` status update.
- `index.ts` — Express A2A server using JSON-RPC.
- `client.ts` — sends a streaming message, captures the taskId from the first
  `task` event, then triggers cancellation after `CANCEL_AFTER_MS`.

## Running the sample

Open two terminals.

**Terminal 1 — start the agent:**

```bash
npm run agents:cancellable-agent
```

**Terminal 2 — run the cancelling client:**

```bash
npm run agents:cancellable-client
```

Expected output (timing-dependent):

```
[Client] Sending streaming message to http://localhost:41241
[Client] Task created id=<task-id> state=TASK_STATE_SUBMITTED
[Client] statusUpdate task=<task-id> state=TASK_STATE_WORKING
[Client] Sending cancelTask for <task-id> after 2500ms
[Client] statusUpdate task=<task-id> state=TASK_STATE_CANCELED
[Client] Confirmed task <task-id> was cancelled.
[Client] cancelTask returned state=TASK_STATE_CANCELED
[Client] Stream complete.
```

On the agent side you should see:

```
[CancellableAgentExecutor] Task <task-id>: step 1/5
[CancellableAgentExecutor] Task <task-id>: step 2/5
[CancellableAgentExecutor] Cancellation requested for task <task-id>
[CancellableAgentExecutor] Aborting task <task-id> at step 3.
```

## Configuration

| Variable          | Default                  | Used by |
| ----------------- | ------------------------ | ------- |
| `PORT`            | `41241`                  | server  |
| `AGENT_URL`       | `http://localhost:41241` | client  |
| `CANCEL_AFTER_MS` | `2500`                   | client  |

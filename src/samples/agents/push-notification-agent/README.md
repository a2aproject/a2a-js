# Push Notification Agent

This sample demonstrates the A2A push notification mechanism. The agent runs a
multi-step long-running task and uses
[`DefaultPushNotificationSender`](../../../server/push_notification/default_push_notification_sender.ts)
to POST every task / status / artifact event to a client-provided webhook URL.

For details on the protocol, see the
[A2A Specification §4.3 Push Notifications](https://a2a-protocol.org/latest/specification/#43-push-notifications).

## Components

- `agent_executor.ts` — long-running executor that publishes the initial task,
  three intermediate `working` status updates, an artifact, and a final
  `completed` status.
- `index.ts` — Express A2A server with `pushNotifications: true` in its
  capabilities, wired with `InMemoryPushNotificationStore` +
  `DefaultPushNotificationSender`.
- `webhook.ts` — standalone Express webhook that receives push notifications,
  verifies the `X-A2A-Notification-Token` header, and prints each event.
- `client.ts` — sends a single message that includes a
  `taskPushNotificationConfig` pointing at the webhook.

## Running the sample

Open three terminals.

**Terminal 1 — start the agent:**

```bash
npm run agents:push-notification-agent
```

The agent listens on `http://localhost:41241`.

**Terminal 2 — start the webhook receiver:**

```bash
npm run agents:push-notification-webhook
```

The webhook listens on `http://localhost:42424/webhook/task-updates` and expects
`X-A2A-Notification-Token: demo-token`.

**Terminal 3 — send a message:**

```bash
npm run agents:push-notification-client
```

The client sends a message with `returnImmediately: true` and a
`taskPushNotificationConfig` pointing at the webhook. As the agent executes,
Terminal 2 will print one notification per published event, e.g.:

```
[Webhook] task id=<task-id> state=TASK_STATE_SUBMITTED
[Webhook] statusUpdate task=<task-id> state=TASK_STATE_WORKING message="Working... (step 1/3)"
[Webhook] statusUpdate task=<task-id> state=TASK_STATE_WORKING message="Working... (step 2/3)"
[Webhook] statusUpdate task=<task-id> state=TASK_STATE_WORKING message="Working... (step 3/3)"
[Webhook] artifactUpdate task=<task-id> artifact="Result"
[Webhook] statusUpdate task=<task-id> state=TASK_STATE_COMPLETED
```

## Troubleshooting

**The webhook terminal exits immediately, and the agent prints
`ECONNREFUSED` errors.**

This almost always means port `42424` (or whatever you set `WEBHOOK_PORT` to)
is already in use — typically by a previous webhook instance that didn't
shut down cleanly. The webhook will print a clear message in this case:

```
[Webhook] Port 42424 is already in use. Set WEBHOOK_PORT to a free port,
or stop the process using it (e.g. `lsof -i :42424` or `fuser -k 42424/tcp`).
```

Either pick a different port (and update `WEBHOOK_URL` for the client to
match), or kill the stale process. The same caveat applies to `PORT` for
the agent.

## Configuration

The following environment variables can override the defaults:

| Variable        | Default                                              | Used by          |
| --------------- | ---------------------------------------------------- | ---------------- |
| `PORT`          | `41241`                                              | agent server     |
| `WEBHOOK_PORT`  | `42424`                                              | webhook + client |
| `WEBHOOK_URL`   | `http://localhost:${WEBHOOK_PORT}/webhook/task-updates` | client           |
| `WEBHOOK_TOKEN` | `demo-token`                                         | webhook + client |
| `AGENT_URL`     | `http://localhost:41241`                             | client           |

The client derives `WEBHOOK_URL` from `WEBHOOK_PORT` if `WEBHOOK_URL` itself is
not set, so you only need to set `WEBHOOK_PORT` consistently in the webhook
and client terminals to change the port:

```bash
# Terminal 2 (webhook):
WEBHOOK_PORT=52424 npm run agents:push-notification-webhook

# Terminal 3 (client):
WEBHOOK_PORT=52424 npm run agents:push-notification-client
```

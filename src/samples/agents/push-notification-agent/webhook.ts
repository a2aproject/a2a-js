import express from 'express';

/**
 * Standalone webhook endpoint that receives A2A push notifications.
 *
 * The A2A server POSTs the JSON wire form of `StreamResponse` (see
 * `StreamResponse.toJSON` in `src/types/pb/a2a.ts`) to the URL the client
 * provided in `taskPushNotificationConfig.url`. The body has exactly one of
 * `task`, `message`, `statusUpdate`, or `artifactUpdate` set at the top
 * level. When `pushConfig.token` is set, the value is forwarded in the
 * `X-A2A-Notification-Token` header (or whatever header name was configured
 * on `DefaultPushNotificationSender`).
 *
 * The Content-Type is `application/a2a+json` (per A2A Specification §14.1.1
 * https://a2a-protocol.org/latest/specification/#1411-applicationa2ajson),
 * which the default `express.json()` middleware does not parse — see the
 * `buildApp` body for the workaround.
 *
 * This sample webhook:
 *   1. Verifies the token header.
 *   2. Logs the received payload in a human-readable form.
 *   3. Always returns 200.
 */

const PORT = Number(process.env.WEBHOOK_PORT || 42424);
const EXPECTED_TOKEN = process.env.WEBHOOK_TOKEN || 'demo-token';

interface MessageLike {
  parts?: Array<{ text?: string }>;
}

/**
 * Extracts the first textual part from a message in the A2A JSON wire form.
 * Per `Part.toJSON` in src/types/pb/a2a.ts, text parts serialize to
 * `{ text: "...", mediaType: "text/plain" }` (the protobuf-style
 * `content.$case` discriminator is collapsed at the JSON boundary).
 */
function extractText(message: MessageLike): string {
  const parts = message?.parts ?? [];
  for (const part of parts) {
    if (typeof part?.text === 'string') {
      return part.text;
    }
  }
  return '';
}

function buildApp(): express.Express {
  const app = express();
  // The A2A server posts notifications with Content-Type `application/a2a+json`,
  // which Express's default `express.json()` does not parse. Accept both
  // standard `application/json` and the A2A-specific media type so we can
  // read the body in either case.
  app.use(
    express.json({
      limit: '1mb',
      type: ['application/json', 'application/a2a+json'],
    })
  );

  app.post('/webhook/task-updates', (req, res) => {
    const token = req.header('X-A2A-Notification-Token');
    if (token !== EXPECTED_TOKEN) {
      console.warn(`[Webhook] Rejected request: bad token "${token}"`);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // The body is the JSON wire form of `StreamResponse` (see
    // `StreamResponse.toJSON` in src/types/pb/a2a.ts). Exactly one of the
    // following keys is set per request: `task`, `message`, `statusUpdate`,
    // or `artifactUpdate`.
    const body = req.body ?? {};

    if (body.task) {
      const task = body.task;
      console.log(`[Webhook] task id=${task.id} state=${task.status?.state}`);
    } else if (body.statusUpdate) {
      const update = body.statusUpdate;
      console.log(
        `[Webhook] statusUpdate task=${update.taskId} state=${update.status?.state}` +
          (update.status?.message ? ` message="${extractText(update.status.message)}"` : '')
      );
    } else if (body.artifactUpdate) {
      const update = body.artifactUpdate;
      console.log(
        `[Webhook] artifactUpdate task=${update.taskId} ` +
          `artifact="${update.artifact?.name ?? '(unnamed)'}"`
      );
    } else if (body.message) {
      console.log(`[Webhook] message id=${body.message.messageId}`);
    } else {
      console.log('[Webhook] Unrecognized payload:');
      console.log(JSON.stringify(req.body, null, 2));
    }

    res.status(200).json({ received: true });
  });

  return app;
}

async function main() {
  const app = buildApp();

  const server = app.listen(PORT);

  // Surface bind errors clearly. Without an explicit `error` handler, an
  // EADDRINUSE (or any other listen error) terminates the process silently
  // because the unhandled `error` event becomes a fatal exception. This is the
  // classic "the webhook terminal closes immediately" symptom — usually it
  // means a stale process is still holding the port.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Webhook] Port ${PORT} is already in use. ` +
          `Set WEBHOOK_PORT to a free port, or stop the process using it ` +
          `(e.g. \`lsof -i :${PORT}\` or \`fuser -k ${PORT}/tcp\`).`
      );
    } else {
      console.error('[Webhook] Server error:', err);
    }
    process.exit(1);
  });

  server.on('listening', () => {
    console.log(`[Webhook] Listening on http://localhost:${PORT}/webhook/task-updates`);
    console.log(`[Webhook] Expected token: "${EXPECTED_TOKEN}"`);
    console.log('[Webhook] Press Ctrl+C to stop.');
  });

  // Graceful shutdown so Ctrl+C doesn't leave a zombie process holding the port.
  const shutdown = (signal: string) => {
    console.log(`\n[Webhook] Received ${signal}, shutting down.`);
    server.close(() => process.exit(0));
    // Force exit if close hangs.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Webhook] Fatal:', err);
  process.exit(1);
});

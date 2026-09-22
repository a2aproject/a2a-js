import express from 'express';

/**
 * Standalone webhook endpoint that receives A2A push notifications for the
 * database-backed agent sample.
 *
 * When an agent is configured with DatabasePushNotificationStore and
 * DefaultPushNotificationSender, incoming client push configs are stored in
 * SQLite. As the agent processes tasks, DefaultPushNotificationSender reads
 * those configs from the database and POSTs events to this endpoint.
 */

const PORT = Number(process.env.WEBHOOK_PORT || 42424);
const EXPECTED_TOKEN = process.env.WEBHOOK_TOKEN || 'sample-secret-token';

interface MessageLike {
  parts?: Array<{ text?: string }>;
}

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

    const body = req.body ?? {};

    if (body.task) {
      const task = body.task;
      console.log(`[Webhook] Received Task event: id=${task.id} state=${task.status?.state}`);
    } else if (body.statusUpdate) {
      const update = body.statusUpdate;
      console.log(
        `[Webhook] Received StatusUpdate: task=${update.taskId} state=${update.status?.state}` +
          (update.status?.message ? ` message="${extractText(update.status.message)}"` : '')
      );
    } else if (body.artifactUpdate) {
      const update = body.artifactUpdate;
      console.log(
        `[Webhook] Received ArtifactUpdate: task=${update.taskId} ` +
          `artifact="${update.artifact?.name ?? '(unnamed)'}"`
      );
    } else if (body.message) {
      console.log(`[Webhook] Received Message: id=${body.message.messageId}`);
    } else {
      console.log('[Webhook] Unrecognized payload:', JSON.stringify(req.body, null, 2));
    }

    res.status(200).json({ received: true });
  });

  return app;
}

const app = buildApp();
const server = app.listen(PORT, () => {
  console.log(
    `[Webhook] Listening for push notifications on http://localhost:${PORT}/webhook/task-updates`
  );
  console.log(`[Webhook] Expected X-A2A-Notification-Token: "${EXPECTED_TOKEN}"`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[Webhook] Port ${PORT} is already in use. ` +
        `Set WEBHOOK_PORT to a free port, or stop the process using it.`
    );
  } else {
    console.error('[Webhook] Server error:', err);
  }
  process.exit(1);
});

const shutdown = () => {
  console.log('\n[Webhook] Shutting down...');
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

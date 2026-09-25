import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { DefaultRequestHandler } from '../../src/server/index.js';
import { AgentEvent, ExecutionEventBus } from '../../src/server/events/execution_event_bus.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../src/server/context.js';
import { RequestContext } from '../../src/server/agent_execution/request_context.js';
import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import { connect } from '../../src/cli/connect.js';
import { migrateStore } from '../../src/cli/migrator.js';
import { ledgerTableFor } from '../../src/server/database/store_migrations.js';
import { taskStoreMigrations } from '../../src/server/database/task/migrations.js';
import { TASK_TABLE } from '../../src/server/database/task/schema.js';
import { DatabaseTaskStore } from '../../src/server/database/task/store.js';
import { Role, Task, TaskState } from '../../src/types/pb/a2a.js';
import { DeferredSettleBusManager, DelayingTaskStore, waitFor } from './support/delaying.js';
import { agentCard, drain, lastState, makeParams } from './support/fixtures.js';

const STORE_DELAY_MS = 25;
const BUS_DELAY_MS = 60;

/** Publishes a Task, an agent Message into history, then completes. */
class ChattyExecutor implements AgentExecutor {
  public taskId = '';
  public contextId = '';

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    this.taskId = ctx.taskId;
    this.contextId = ctx.contextId;

    bus.publish(
      AgentEvent.task({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: undefined,
        },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );

    bus.publish(
      AgentEvent.statusUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: {
            messageId: `agent-${ctx.taskId}`,
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: { $case: 'text', value: 'working on it' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            taskId: ctx.taskId,
            contextId: ctx.contextId,
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
          timestamp: undefined,
        },
        metadata: {},
      })
    );

    bus.publish(
      AgentEvent.artifactUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        artifact: {
          artifactId: `artifact-${ctx.taskId}`,
          name: 'result',
          description: '',
          parts: [
            {
              content: { $case: 'text', value: 'the answer' },
              mediaType: 'text/plain',
              filename: '',
              metadata: undefined,
            },
          ],
          metadata: {},
          extensions: [],
        },
        append: false,
        lastChunk: true,
        metadata: {},
      })
    );

    bus.publish(
      AgentEvent.statusUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        },
        metadata: {},
      })
    );
  }

  async cancelTask(): Promise<void> {}
}

/** What differs between engines is only how to reach a database. */
interface Engine {
  readonly name: string;
  freshUrl(): string;
}

const tempDirs: string[] = [];

const ENGINES: Engine[] = [
  {
    name: 'sqlite',
    freshUrl() {
      const dir = mkdtempSync(join(tmpdir(), 'a2a-delayed-task-store-'));
      tempDirs.push(dir);
      return `sqlite:${join(dir, 'a2a.db')}`;
    },
  },
];

const SERVERS = [
  { name: 'postgres', variable: 'POSTGRES_TEST_DSN' },
  { name: 'mysql', variable: 'MYSQL_TEST_DSN' },
] as const;

/** Set where every engine is meant to be reachable, so a misconfigured job fails. */
const REQUIRE_EVERY_ENGINE = process.env.A2A_TEST_REQUIRE_ALL_ENGINES === '1';
const UNCONFIGURED: string[] = [];

for (const server of SERVERS) {
  const url = process.env[server.variable];
  if (url !== undefined) {
    ENGINES.push({ name: server.name, freshUrl: () => url });
  } else if (REQUIRE_EVERY_ENGINE) {
    throw new Error(
      `${server.variable} is not set, but A2A_TEST_REQUIRE_ALL_ENGINES demands every engine.`
    );
  } else {
    UNCONFIGURED.push(`${server.name} (${server.variable} not set)`);
  }
}

/** A connection of its own, as an operator's migration step would have. */
async function withConnection(url: string, use: (db: Kysely<unknown>) => Promise<void>) {
  const connection = await connect(url);
  try {
    await use(connection);
  } finally {
    await connection.destroy();
  }
}

/** The ledger goes too, or a re-migration finds 0001 applied and builds nothing. */
async function dropTable(db: Kysely<unknown>): Promise<void> {
  for (const table of [TASK_TABLE, ledgerTableFor(TASK_TABLE)]) {
    await sql.raw(`drop table if exists ${table}`).execute(db);
  }
}

// Reported rather than dropped, so a run against fewer engines than intended is visible.
for (const label of UNCONFIGURED) {
  describe.skip(`delayed task store on ${label}`, () => {
    it('has no database to run against', () => {});
  });
}

// The same suite with a real DatabaseTaskStore behind DelayingTaskStore: once at the
// database's own speed, and once with STORE_DELAY_MS added to every read and write, as a
// slow database would.
const CASES = ENGINES.flatMap((engine) =>
  [0, STORE_DELAY_MS].map((delayMs): [string, number, Engine] => [engine.name, delayMs, engine])
);

describe.each(CASES)('delayed task store on %s (+%i ms)', (_name, delayMs, engine) => {
  let url: string;
  let db: Kysely<unknown>;
  let taskStore: DelayingTaskStore;
  let busManager: DefaultExecutionEventBusManager;
  const serverContext = new ServerCallContext();

  beforeAll(async () => {
    url = engine.freshUrl();
    // The shared servers may still hold the table, from another suite or an interrupted run.
    await withConnection(url, async (connection) => {
      await dropTable(connection);
      await migrateStore(connection, taskStoreMigrations());
    });
    db = await connect(url);
  });

  afterAll(async () => {
    await db?.destroy();
    await withConnection(url, dropTable);
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    taskStore = new DelayingTaskStore(delayMs, new DatabaseTaskStore(db));
    busManager = new DefaultExecutionEventBusManager();
  });

  const makeHandler = (executor: AgentExecutor) =>
    new DefaultRequestHandler(agentCard, taskStore, executor, busManager);

  it('blocking sendMessage completes and persists the full task', async () => {
    const executor = new ChattyExecutor();
    const result = (await makeHandler(executor).sendMessage(
      makeParams('delayed-store-blocking'),
      serverContext
    )) as Task;

    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const stored = await taskStore.load(result.id, serverContext);
    expect(stored?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(stored?.artifacts).toHaveLength(1);
    // The user turn plus the agent's WORKING message.
    expect(stored?.history?.length).toBeGreaterThanOrEqual(2);
  });

  it('sendMessageStream completes against a slow store', async () => {
    const executor = new ChattyExecutor();
    const events = await drain(
      makeHandler(executor).sendMessageStream(makeParams('delayed-store-stream'), serverContext)
    );

    expect(lastState(events)).toBe(TaskState.TASK_STATE_COMPLETED);
    const stored = await taskStore.load(executor.taskId, serverContext);
    expect(stored?.artifacts).toHaveLength(1);
  });

  it('getTask returns the persisted history after completion', async () => {
    const executor = new ChattyExecutor();
    const handler = makeHandler(executor);
    const result = (await handler.sendMessage(
      makeParams('delayed-store-gettask'),
      serverContext
    )) as Task;

    const fetched = await handler.getTask({ id: result.id, tenant: '' }, serverContext);
    expect(fetched.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(fetched.history?.length).toBeGreaterThanOrEqual(2);
  });

  it('two sequential turns on the same task accumulate history', async () => {
    // Second turn re-reads through the slow store before merging, so a
    // read-modify-write that lost the race would drop the first turn.
    class PausingExecutor implements AgentExecutor {
      public taskId = '';
      public turn = 0;

      async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
        this.taskId = ctx.taskId;
        this.turn += 1;
        const terminal =
          this.turn === 1 ? TaskState.TASK_STATE_INPUT_REQUIRED : TaskState.TASK_STATE_COMPLETED;
        bus.publish(
          AgentEvent.task({
            id: ctx.taskId,
            contextId: ctx.contextId,
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          })
        );
        bus.publish(
          AgentEvent.statusUpdate({
            taskId: ctx.taskId,
            contextId: ctx.contextId,
            status: { state: terminal, message: undefined, timestamp: undefined },
            metadata: {},
          })
        );
      }

      async cancelTask(): Promise<void> {}
    }

    const executor = new PausingExecutor();
    const handler = makeHandler(executor);

    const first = (await handler.sendMessage(
      makeParams('delayed-store-turn-1', 'first'),
      serverContext
    )) as Task;
    expect(first.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);

    const followUp = makeParams('delayed-store-turn-2', 'second');
    followUp.message!.taskId = first.id;
    followUp.message!.contextId = first.contextId;
    const second = (await handler.sendMessage(followUp, serverContext)) as Task;

    expect(second.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    const texts = (second.history ?? []).flatMap((message) =>
      message.parts.map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
    );
    expect(texts).toContain('first');
    expect(texts).toContain('second');
  });

  describe('combined with a delayed event bus', () => {
    let deferredManager: DeferredSettleBusManager;

    beforeEach(() => {
      deferredManager = new DeferredSettleBusManager(BUS_DELAY_MS);
    });

    afterEach(() => {
      deferredManager.disposeAll();
    });

    it('completes when both the store and the bus are slow', async () => {
      const executor = new ChattyExecutor();
      const handler = new DefaultRequestHandler(agentCard, taskStore, executor, deferredManager);

      const result = (await handler.sendMessage(
        makeParams('delayed-store-and-bus'),
        serverContext
      )) as Task;

      expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
      await waitFor(
        () => deferredManager.getByTaskId(executor.taskId) === undefined,
        'the manager to release the bus'
      );
    });
  });
});

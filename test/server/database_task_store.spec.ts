import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { connect } from '../../src/cli/connect.js';
import { migrateStore } from '../../src/cli/migrator.js';
import { taskStoreMigrations } from '../../src/server/database/task/migrations.js';
import { DatabaseTaskStore } from '../../src/server/database/task/store.js';
import type { TaskDatabase } from '../../src/server/database/task/schema.js';
import { ServerCallContext } from '../../src/server/context.js';
import type { User } from '../../src/server/authentication/user.js';
import {
  Role,
  TaskState,
  type Artifact,
  type ListTasksRequest,
  type Message,
  type Task,
} from '../../src/types/pb/a2a.js';
import { DEFAULT_PAGE_SIZE } from '../../src/constants.js';

// Spelled out rather than imported from the store
const TABLE = 'tasks';
const LEDGER_TABLE = 'a2a_tasks_migrations';
const LOCK_TABLE = 'a2a_migrations_lock';

/** What a deployment that renamed the table would have instead, ledger included. */
const RENAMED_TABLE = 'agent_tasks';
const RENAMED_LEDGER_TABLE = 'a2a_agent_tasks_migrations';

class TestUser implements User {
  constructor(private readonly _userName: string) {}
  get isAuthenticated(): boolean {
    return true;
  }
  get userName(): string {
    return this._userName;
  }
}

function makeContext(options: { tenant?: string; user?: string } = {}): ServerCallContext {
  return new ServerCallContext({
    tenant: options.tenant,
    user: options.user === undefined ? undefined : new TestUser(options.user),
  });
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    messageId: 'msg-1',
    contextId: 'ctx-1',
    taskId: 'task-1',
    role: Role.ROLE_USER,
    parts: [{ content: { $case: 'text', value: 'hello' }, mediaType: 'text/plain', filename: '' }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
    ...overrides,
  } as Message;
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    artifactId: 'artifact-1',
    name: 'report',
    description: 'the output',
    parts: [{ content: { $case: 'text', value: 'result' }, mediaType: 'text/plain', filename: '' }],
    metadata: undefined,
    extensions: [],
    ...overrides,
  } as Artifact;
}

/** Already in the shape `Task.fromJSON` produces, so a round trip compares equal. */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    contextId: 'ctx-1',
    status: {
      state: TaskState.TASK_STATE_WORKING,
      message: undefined,
      timestamp: '2026-01-02T03:04:05.678Z',
    },
    artifacts: [],
    history: [],
    metadata: undefined,
    ...overrides,
  };
}

/** Every field the interface demands, so a test states only what it varies. */
function makeListRequest(overrides: Partial<ListTasksRequest> = {}): ListTasksRequest {
  return {
    tenant: '',
    contextId: '',
    status: TaskState.TASK_STATE_UNSPECIFIED,
    pageToken: '',
    statusTimestampAfter: undefined,
    ...overrides,
  };
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
      const dir = mkdtempSync(join(tmpdir(), 'a2a-task-store-'));
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Reported rather than dropped, so a run against fewer engines than intended is visible.
for (const label of UNCONFIGURED) {
  describe.skip(`DatabaseTaskStore on ${label}`, () => {
    it('has no database to run against', () => {});
  });
}

for (const engine of ENGINES) {
  describe(`DatabaseTaskStore on ${engine.name}`, () => {
    let url: string;
    let db: Kysely<TaskDatabase>;
    let store: DatabaseTaskStore;

    /** A connection of its own, as an operator's migration step would have. */
    async function withConnection<T>(use: (db: Kysely<unknown>) => Promise<T>): Promise<T> {
      const connection = await connect(url);
      try {
        return await use(connection);
      } finally {
        await connection.destroy();
      }
    }

    async function migrate(): Promise<void> {
      await withConnection((connection) => migrateStore(connection, taskStoreMigrations()));
    }

    /** The ledger goes too, or a re-migration finds 0001 applied and builds nothing. */
    async function dropEverything(): Promise<void> {
      await withConnection(async (connection) => {
        for (const table of [
          TABLE,
          LEDGER_TABLE,
          LOCK_TABLE,
          RENAMED_TABLE,
          RENAMED_LEDGER_TABLE,
        ]) {
          await sql.raw(`drop table if exists ${table}`).execute(connection);
        }
      });
    }

    async function execute(text: string): Promise<void> {
      await withConnection(async (connection) => {
        await sql.raw(text).execute(connection);
      });
    }

    async function rowsInTable(): Promise<Record<string, unknown>[]> {
      return withConnection(
        async (connection) =>
          (await sql.raw(`select * from ${TABLE}`).execute(connection)).rows as Record<
            string,
            unknown
          >[]
      );
    }

    /** Saves tasks whose ids and timestamps are the only thing a listing test varies. */
    async function saveAll(context: ServerCallContext, tasks: Partial<Task>[]): Promise<void> {
      for (const task of tasks) {
        await store.save(makeTask(task), context);
      }
    }

    function taskAt(timestamp: string, overrides: Partial<Task> = {}): Partial<Task> {
      return {
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp },
        ...overrides,
      };
    }

    beforeEach(async () => {
      url = engine.freshUrl();
      // SQLite gets a new file each time; the shared servers need the last run cleared.
      await dropEverything();
      await migrate();
      db = (await connect(url)) as Kysely<TaskDatabase>;
      store = new DatabaseTaskStore(db);
    });

    afterEach(async () => {
      await db?.destroy();
    });

    describe('save() and load()', () => {
      it('round-trips a fully populated task', async () => {
        const task = makeTask({
          artifacts: [makeArtifact()],
          history: [makeMessage()],
          metadata: { note: 'kept' },
        });
        const context = makeContext({ tenant: 'acme', user: 'alice' });

        await store.save(task, context);

        expect(await store.load('task-1', context)).toEqual(task);
      });

      it('returns undefined for a task that is not there', async () => {
        expect(await store.load('task-unknown', makeContext())).toBeUndefined();
      });

      it('survives the connection that wrote it', async () => {
        await store.save(makeTask(), makeContext());
        await db.destroy();

        // A whole new connection and store, as a restarted process would have.
        db = (await connect(url)) as Kysely<TaskDatabase>;
        const restarted = new DatabaseTaskStore(db);

        expect(await restarted.load('task-1', makeContext())).toEqual(makeTask());
      });

      it('replaces rather than duplicates when a task is saved twice', async () => {
        const context = makeContext();
        await store.save(makeTask({ metadata: { pass: 'first' } }), context);
        await store.save(makeTask({ metadata: { pass: 'second' } }), context);

        expect(await rowsInTable()).toHaveLength(1);
        expect((await store.load('task-1', context))?.metadata).toEqual({ pass: 'second' });
      });

      it('keeps different tasks apart', async () => {
        const context = makeContext();
        await store.save(makeTask({ id: 'task-a' }), context);
        await store.save(makeTask({ id: 'task-b' }), context);

        expect((await store.load('task-a', context))?.id).toBe('task-a');
        expect((await store.load('task-b', context))?.id).toBe('task-b');
      });

      // The schema permits nulls and save() never writes them, so only something other
      // than this store can produce this row. It has to read rather than throw.
      it('reads a row whose payload columns are all null as a task with only its key', async () => {
        await store.save(makeTask({ artifacts: [makeArtifact()] }), makeContext());
        await execute(
          `update ${TABLE} set status = null, artifacts = null, history = null, metadata = null`
        );

        expect(await store.load('task-1', makeContext())).toEqual({
          id: 'task-1',
          contextId: 'ctx-1',
          status: undefined,
          artifacts: [],
          history: [],
          metadata: undefined,
        });
      });

      it('keeps the stored values when the caller mutates the task after save', async () => {
        const task = makeTask({ metadata: { note: 'original' } });
        await store.save(task, makeContext());

        task.metadata = { note: 'mutated' };
        task.contextId = 'ctx-mutated';

        const loaded = await store.load('task-1', makeContext());
        expect(loaded?.metadata).toEqual({ note: 'original' });
        expect(loaded?.contextId).toBe('ctx-1');
      });

      it('does not let a mutated result reach the next load', async () => {
        const context = makeContext();
        await store.save(makeTask(), context);

        const first = await store.load('task-1', context);
        first!.contextId = 'ctx-attacker';

        expect((await store.load('task-1', context))?.contextId).toBe('ctx-1');
      });
    });

    describe('stored row shape', () => {
      it('writes status_state and protocol_version', async () => {
        await store.save(makeTask(), makeContext());

        const [row] = await rowsInTable();
        expect(row.status_state).toBe('TASK_STATE_WORKING');
        expect(row.protocol_version).toBe('1.0');
      });

      it('rewrites the derived columns when the status changes', async () => {
        const context = makeContext();
        await store.save(makeTask(), context);
        await store.save(
          makeTask(
            taskAt('2026-03-04T05:06:07.000Z', {
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                message: undefined,
                timestamp: '2026-03-04T05:06:07.000Z',
              },
            })
          ),
          context
        );

        const rows = await rowsInTable();
        expect(Number(rows[0].status_last_updated)).toBe(Date.parse('2026-03-04T05:06:07.000Z'));
        expect(rows[0].status_state).toBe('TASK_STATE_COMPLETED');
      });
    });

    describe('list()', () => {
      const context = makeContext({ tenant: 'acme', user: 'alice' });

      it('orders newest first, breaking ties by id descending', async () => {
        const tie = taskAt('2026-02-01T00:00:00.000Z');
        await saveAll(context, [
          { id: 'old', ...taskAt('2026-01-01T00:00:00.000Z') },
          { id: 'tie-a', ...tie },
          { id: 'tie-b', ...tie },
          { id: 'new', ...taskAt('2026-03-01T00:00:00.000Z') },
        ]);

        const response = await store.list(makeListRequest(), context);
        expect(response.tasks.map((task) => task.id)).toEqual(['new', 'tie-b', 'tie-a', 'old']);
      });

      // Four matching tasks over two full pages, with a tie split across the boundary so
      // the cursor has to compare the id as well, and unmatched rows either side of it so
      // a filter dropped on the second page shows up.
      it('walks a filtered set one page at a time, without repeats or gaps', async () => {
        const tie = '2026-02-01T00:00:00.000Z';
        await saveAll(context, [
          { id: 'w1', contextId: 'ctx-wanted', ...taskAt('2026-01-01T00:00:00.000Z') },
          { id: 'w2', contextId: 'ctx-wanted', ...taskAt(tie) },
          { id: 'w3', contextId: 'ctx-wanted', ...taskAt(tie) },
          { id: 'w4', contextId: 'ctx-wanted', ...taskAt('2026-04-01T00:00:00.000Z') },
          { id: 'other-1', contextId: 'ctx-other', ...taskAt('2026-03-01T00:00:00.000Z') },
          { id: 'other-2', contextId: 'ctx-other', ...taskAt(tie) },
        ]);

        const seen: string[] = [];
        let pageToken = '';
        // Bounded, so a token that never empties fails rather than hanging.
        for (let page = 0; page < 4; page++) {
          const response = await store.list(
            makeListRequest({ contextId: 'ctx-wanted', pageSize: 2, pageToken }),
            context
          );
          seen.push(...response.tasks.map((task) => task.id));
          pageToken = response.nextPageToken;
          if (!pageToken) break;
        }

        // The last page is full, so the token must still come back empty.
        expect(pageToken).toBe('');
        expect(seen).toEqual(['w4', 'w3', 'w2', 'w1']);
      });

      it('filters by context id, status and status timestamp', async () => {
        const completed = (timestamp: string): Partial<Task> => ({
          status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp },
        });
        await saveAll(context, [
          { id: 'match', contextId: 'ctx-wanted', ...completed('2026-03-01T00:00:00.000Z') },
          { id: 'wrong-context', contextId: 'ctx-other', ...completed('2026-03-01T00:00:00.000Z') },
          { id: 'wrong-status', contextId: 'ctx-wanted', ...taskAt('2026-03-01T00:00:00.000Z') },
          { id: 'on-boundary', contextId: 'ctx-wanted', ...completed('2026-02-01T00:00:00.000Z') },
        ]);

        const response = await store.list(
          makeListRequest({
            contextId: 'ctx-wanted',
            status: TaskState.TASK_STATE_COMPLETED,
            statusTimestampAfter: '2026-02-01T00:00:00.000Z',
          }),
          context
        );
        expect(response.tasks.map((task) => task.id)).toEqual(['match']);
      });

      it('treats an unspecified status as no filter rather than a state to match', async () => {
        await saveAll(context, [{ id: 'task-1' }, { id: 'task-2' }]);

        const response = await store.list(
          makeListRequest({ status: TaskState.TASK_STATE_UNSPECIFIED }),
          context
        );
        expect(response.tasks.map((task) => task.id)).toEqual(['task-2', 'task-1']);
      });

      it('counts every match before pagination, and only what the filters match', async () => {
        await saveAll(context, [
          { id: 'in-1', contextId: 'ctx-wanted', ...taskAt('2026-01-01T00:00:00.000Z') },
          { id: 'in-2', contextId: 'ctx-wanted', ...taskAt('2026-02-01T00:00:00.000Z') },
          { id: 'in-3', contextId: 'ctx-wanted', ...taskAt('2026-03-01T00:00:00.000Z') },
          { id: 'out', contextId: 'ctx-other', ...taskAt('2026-04-01T00:00:00.000Z') },
        ]);

        // One row on the page, three matching the filter, four in the table.
        const response = await store.list(
          makeListRequest({ contextId: 'ctx-wanted', pageSize: 1 }),
          context
        );
        expect(response.tasks).toHaveLength(1);
        expect(response.totalSize).toBe(3);
      });

      it('strips artifacts by default and includes them when asked', async () => {
        await store.save(makeTask({ artifacts: [makeArtifact()] }), context);

        const [stripped] = (await store.list(makeListRequest(), context)).tasks;
        expect(stripped.artifacts).toEqual([]);

        const [full] = (await store.list(makeListRequest({ includeArtifacts: true }), context))
          .tasks;
        expect(full.artifacts).toEqual([makeArtifact()]);
      });

      // Zero is the one historyLength expressible as a projection, so the store honours
      // it by leaving the column unselected. Trimming to N is the handler's, after the
      // store returns, which is why a positive length still comes back whole.
      it('drops history for a non-positive historyLength and keeps it otherwise', async () => {
        const first = makeMessage({ messageId: 'msg-1' });
        const second = makeMessage({ messageId: 'msg-2' });
        await store.save(makeTask({ history: [first, second] }), context);

        const [unset] = (await store.list(makeListRequest(), context)).tasks;
        expect(unset.history).toEqual([first, second]);

        const [zero] = (await store.list(makeListRequest({ historyLength: 0 }), context)).tasks;
        expect(zero.history).toEqual([]);

        // Matches the handler, which treats any non-positive length as "omit".
        const [negative] = (await store.list(makeListRequest({ historyLength: -1 }), context))
          .tasks;
        expect(negative.history).toEqual([]);

        const [limited] = (await store.list(makeListRequest({ historyLength: 1 }), context)).tasks;
        expect(limited.history).toEqual([first, second]);
      });

      it('returns an empty page for no matches and for a page size of zero', async () => {
        expect(await store.list(makeListRequest(), context)).toEqual({
          tasks: [],
          nextPageToken: '',
          pageSize: DEFAULT_PAGE_SIZE,
          totalSize: 0,
        });

        // The handler rejects a page size of zero, but this store is public.
        await saveAll(context, [{ id: 'task-1' }]);
        expect(await store.list(makeListRequest({ pageSize: 0 }), context)).toEqual({
          tasks: [],
          nextPageToken: '',
          pageSize: 0,
          totalSize: 1,
        });
      });

      // A page size of one makes the unreadable row a whole page, so the cursor has to
      // come from the row rather than from the tasks.
      it('skips unreadable rows and keeps paging past them', async () => {
        await saveAll(context, [
          { id: 'task-1', ...taskAt('2026-01-01T00:00:00.000Z') },
          { id: 'task-2', ...taskAt('2026-02-01T00:00:00.000Z') },
          { id: 'task-3', ...taskAt('2026-03-01T00:00:00.000Z') },
        ]);
        await execute(`update ${TABLE} set status = 'not json' where id = 'task-2'`);

        const seen: string[] = [];
        let pageToken = '';
        for (let page = 0; page < 4; page++) {
          const response = await store.list(makeListRequest({ pageSize: 1, pageToken }), context);
          seen.push(...response.tasks.map((task) => task.id));
          expect(response.totalSize).toBe(3);
          pageToken = response.nextPageToken;
          if (!pageToken) break;
        }

        expect(seen).toEqual(['task-3', 'task-1']);
      });

      it('lists a task with no status, sorting it oldest and excluding it from filters', async () => {
        await saveAll(context, [
          { id: 'with-status', ...taskAt('2026-01-01T00:00:00.000Z') },
          { id: 'no-status', status: undefined },
        ]);

        const all = await store.list(makeListRequest(), context);
        expect(all.tasks.map((task) => task.id)).toEqual(['with-status', 'no-status']);

        // status_state is null and status_last_updated is 0, so neither filter reaches it.
        const byStatus = await store.list(
          makeListRequest({ status: TaskState.TASK_STATE_WORKING }),
          context
        );
        expect(byStatus.tasks.map((task) => task.id)).toEqual(['with-status']);

        const byTimestamp = await store.list(
          makeListRequest({ statusTimestampAfter: '1970-01-01T00:00:00.000Z' }),
          context
        );
        expect(byTimestamp.tasks.map((task) => task.id)).toEqual(['with-status']);
      });
    });

    describe('scoping', () => {
      it('isolates tasks between tenants', async () => {
        const acme = makeContext({ tenant: 'acme' });
        const globex = makeContext({ tenant: 'globex' });
        await store.save(makeTask(), acme);

        expect(await store.load('task-1', acme)).toBeDefined();
        expect(await store.load('task-1', globex)).toBeUndefined();
      });

      // An absent tenant is the global bucket, which is a tenant like any other.
      it('isolates the global bucket from a named tenant', async () => {
        const untenanted = makeContext();
        const acme = makeContext({ tenant: 'acme' });
        await store.save(makeTask({ id: 'global-task' }), untenanted);
        await store.save(makeTask({ id: 'acme-task' }), acme);

        const fromGlobal = await store.list(makeListRequest(), untenanted);
        const fromAcme = await store.list(makeListRequest(), acme);

        expect(fromGlobal.tasks.map((task) => task.id)).toEqual(['global-task']);
        expect(fromAcme.tasks.map((task) => task.id)).toEqual(['acme-task']);
      });

      it('allows the same task id in different tenants', async () => {
        const acme = makeContext({ tenant: 'acme' });
        const globex = makeContext({ tenant: 'globex' });
        await store.save(makeTask({ contextId: 'ctx-acme' }), acme);
        await store.save(makeTask({ contextId: 'ctx-globex' }), globex);

        expect((await store.load('task-1', acme))?.contextId).toBe('ctx-acme');
        expect((await store.load('task-1', globex))?.contextId).toBe('ctx-globex');
      });

      it('isolates tasks between owners in one tenant', async () => {
        const alice = makeContext({ tenant: 'acme', user: 'alice' });
        const bob = makeContext({ tenant: 'acme', user: 'bob' });
        await store.save(makeTask(), alice);

        expect(await store.load('task-1', alice)).toBeDefined();
        expect(await store.load('task-1', bob)).toBeUndefined();
      });

      it('isolates tasks between owners with no tenant', async () => {
        const alice = makeContext({ user: 'alice' });
        const bob = makeContext({ user: 'bob' });
        await store.save(makeTask(), alice);

        expect(await store.load('task-1', alice)).toBeDefined();
        expect(await store.load('task-1', bob)).toBeUndefined();
      });

      it('allows the same task id for different owners', async () => {
        const alice = makeContext({ user: 'alice' });
        const bob = makeContext({ user: 'bob' });
        await store.save(makeTask({ contextId: 'ctx-alice' }), alice);
        await store.save(makeTask({ contextId: 'ctx-bob' }), bob);

        expect(await rowsInTable()).toHaveLength(2);
        expect((await store.load('task-1', alice))?.contextId).toBe('ctx-alice');
        expect((await store.load('task-1', bob))?.contextId).toBe('ctx-bob');
      });

      it('does not list another tenant tasks', async () => {
        const acme = makeContext({ tenant: 'acme' });
        const globex = makeContext({ tenant: 'globex' });
        await store.save(makeTask(), acme);

        const response = await store.list(makeListRequest(), globex);
        expect(response.tasks).toEqual([]);
        expect(response.totalSize).toBe(0);
      });

      it('does not list another owner tasks', async () => {
        const alice = makeContext({ user: 'alice' });
        const bob = makeContext({ user: 'bob' });
        await store.save(makeTask(), alice);

        const response = await store.list(makeListRequest(), bob);
        expect(response.tasks).toEqual([]);
        expect(response.totalSize).toBe(0);
      });

      it('files an anonymous caller under the shared unknown owner', async () => {
        await store.save(makeTask(), makeContext());

        expect(String((await rowsInTable())[0].owner)).toBe('unknown');
      });

      it('files a tenantless caller under the global bucket', async () => {
        await store.save(makeTask(), makeContext());

        expect(String((await rowsInTable())[0].tenant)).toBe('');
      });

      it('honours a custom OwnerResolver', async () => {
        const byTenant = new DatabaseTaskStore(db, {
          ownerResolver: (context) => context.tenant ?? 'none',
        });
        const acme = makeContext({ tenant: 'acme', user: 'alice' });
        const acmeOther = makeContext({ tenant: 'acme', user: 'bob' });

        await byTenant.save(makeTask(), acme);

        // Different users, same resolved owner, so bob sees alice's task.
        expect(await byTenant.load('task-1', acmeOther)).toBeDefined();
        expect(String((await rowsInTable())[0].owner)).toBe('acme');
      });

      it('keeps owners and tenants that differ only in case apart', async () => {
        const lower = makeContext({ tenant: 'acme', user: 'alice' });
        const upper = makeContext({ tenant: 'ACME', user: 'Alice' });
        await store.save(makeTask({ contextId: 'ctx-lower' }), lower);
        await store.save(makeTask({ contextId: 'ctx-upper' }), upper);

        expect(await rowsInTable()).toHaveLength(2);
        expect((await store.load('task-1', lower))?.contextId).toBe('ctx-lower');
        expect((await store.load('task-1', upper))?.contextId).toBe('ctx-upper');
      });
    });

    describe('tableName', () => {
      const context = () => makeContext({ tenant: 'acme', user: 'alice' });

      /**
       * The outer setup migrated the default table, so a test that needs the renamed one
       * has to swap it. Tests that want the default simply do not call this.
       */
      async function migrateRenamedOnly(): Promise<void> {
        await withConnection(async (connection) => {
          for (const table of [TABLE, LEDGER_TABLE]) {
            await sql.raw(`drop table if exists ${table}`).execute(connection);
          }
          await migrateStore(connection, taskStoreMigrations(RENAMED_TABLE));
        });
      }

      it('reads and writes the table it was given', async () => {
        await migrateRenamedOnly();
        const renamed = new DatabaseTaskStore(db, { tableName: RENAMED_TABLE });
        const task = makeTask();

        await renamed.save(task, context());

        expect(await renamed.load('task-1', context())).toEqual(task);
        const rows = await withConnection(
          async (connection) =>
            (await sql.raw(`select * from ${RENAMED_TABLE}`).execute(connection)).rows
        );
        expect(rows).toHaveLength(1);
      });

      it('a store left on the default name cannot read a renamed table', async () => {
        await migrateRenamedOnly();

        await expect(store.load('task-1', context())).rejects.toThrow();
      });

      it('a store given a name cannot read the default table', async () => {
        const renamed = new DatabaseTaskStore(db, { tableName: RENAMED_TABLE });

        await expect(renamed.load('task-1', context())).rejects.toThrow();
      });
    });
  });
}

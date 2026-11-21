// The DatabaseTaskStore tests every runtime has to pass: the Node suite runs them on each
// engine, the edge suite on D1, and each hands them its database through a StoreHarness.
// Imported in workerd too, so nothing here may pull in a Node built-in.
import { beforeEach, describe, expect, it } from 'vitest';

import { DatabaseTaskStore } from '../../../src/server/database/task/store.js';
import { DefaultRequestHandler } from '../../../src/server/request_handler/default_request_handler.js';
import { AgentEvent } from '../../../src/server/events/execution_event_bus.js';
import type { AgentExecutor } from '../../../src/server/agent_execution/agent_executor.js';
import type { ServerCallContext } from '../../../src/server/context.js';
import { Role, TaskState, type AgentCard, type Task } from '../../../src/types/pb/a2a.js';
import { DEFAULT_PAGE_SIZE } from '../../../src/constants.js';

import { makeArtifact, makeContext, makeListRequest, makeMessage, makeTask } from './builders.js';
import type { StoreHarness } from './store_harness.js';

// Spelled out rather than imported from the store
const TABLE = 'tasks';

/** What a deployment that renamed the table would have instead, ledger included. */
export const RENAMED_TABLE = 'agent_tasks';
export const RENAMED_LEDGER_TABLE = 'a2a_agent_tasks_migrations';

/**
 * Declares the tests in the caller's describe. The caller's beforeEach runs first, since it
 * was declared first, and leaves the database this one builds the store on.
 */
export function describeDatabaseTaskStoreBehavior(harness: StoreHarness): void {
  const { execute, rowsInTable } = harness;
  let store: DatabaseTaskStore;

  /** Saves tasks whose ids and timestamps are the only thing a listing test varies. */
  async function saveAll(context: ServerCallContext, tasks: Partial<Task>[]): Promise<void> {
    for (const task of tasks) {
      await store.save(makeTask(task), context);
    }
  }

  function taskAt(timestamp: string | undefined, overrides: Partial<Task> = {}): Partial<Task> {
    return {
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp },
      ...overrides,
    };
  }

  beforeEach(() => {
    store = new DatabaseTaskStore(harness.db());
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

      // A whole new connection and store, as a restarted process or a fresh isolate would have.
      const restarted = new DatabaseTaskStore(await harness.reconnect());

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

    it.each([undefined, 1])(
      'orders submillisecond timestamps with page size %s',
      async (pageSize) => {
        const newer = '2026-10-02T00:00:00.000900Z';
        const older = '2026-10-02T00:00:00.000100Z';
        await saveAll(context, [
          { id: 'a-newer', ...taskAt(newer) },
          { id: 'z-older', ...taskAt(older) },
        ]);
        expect((await store.load('a-newer', context))?.status?.timestamp).toBe(newer);
        expect((await store.load('z-older', context))?.status?.timestamp).toBe(older);

        const seen: string[] = [];
        let pageToken = '';
        for (let page = 0; page < 3; page++) {
          const response = await store.list(makeListRequest({ pageSize, pageToken }), context);
          seen.push(...response.tasks.map((task) => task.id));
          pageToken = response.nextPageToken;
          if (!pageToken) break;
        }
        expect(pageToken).toBe('');
        expect(seen).toEqual(['a-newer', 'z-older']);
      }
    );

    it.each([
      {
        name: 'nanosecond precision',
        timestamps: ['2026-10-02T00:00:00.000000009Z', '2026-10-02T00:00:00.000000001Z'],
        expected: ['a-first', 'z-second'],
      },
      {
        name: 'equivalent fractional widths',
        timestamps: ['2026-10-02T00:00:00.0009Z', '2026-10-02T00:00:00.000900000Z'],
        expected: ['z-second', 'a-first'],
      },
      {
        name: 'equivalent timezone offsets',
        timestamps: ['2026-10-02T01:00:00.000900001+01:00', '2026-10-01T19:00:00.000900001-05:00'],
        expected: ['z-second', 'a-first'],
      },
      {
        name: 'pre-epoch nanoseconds',
        timestamps: ['1969-12-31T23:59:59.999900001Z', '1969-12-31T23:59:59.9999Z'],
        expected: ['a-first', 'z-second'],
      },
      {
        name: 'epoch nanoseconds and an absent timestamp',
        timestamps: ['1970-01-01T00:00:00.000000001Z', undefined],
        expected: ['a-first', 'z-second'],
      },
    ])('pages through $name without repeats or gaps', async ({ timestamps, expected }) => {
      await saveAll(context, [
        { id: 'a-first', ...taskAt(timestamps[0]) },
        { id: 'z-second', ...taskAt(timestamps[1]) },
      ]);
      const seen: string[] = [];
      let pageToken = '';
      for (let page = 0; page < 3; page++) {
        const response = await store.list(makeListRequest({ pageSize: 1, pageToken }), context);
        seen.push(...response.tasks.map((task) => task.id));
        pageToken = response.nextPageToken;
        if (!pageToken) break;
      }
      expect(pageToken).toBe('');
      expect(seen).toEqual(expected);
    });

    it('accepts an existing millisecond cursor as an exact millisecond boundary', async () => {
      await saveAll(context, [
        { id: 'tie-z', ...taskAt('2026-10-02T00:00:00.001Z') },
        { id: 'tie-a', ...taskAt('2026-10-02T00:00:00.001Z') },
        { id: 'older', ...taskAt('2026-10-02T00:00:00.000900001Z') },
      ]);
      const pageToken = Buffer.from('2026-10-02T00:00:00.001Z|tie-z').toString('base64');
      const response = await store.list(makeListRequest({ pageToken }), context);
      expect(response.tasks.map((task) => task.id)).toEqual(['tie-a', 'older']);
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

      const [full] = (await store.list(makeListRequest({ includeArtifacts: true }), context)).tasks;
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
      const [negative] = (await store.list(makeListRequest({ historyLength: -1 }), context)).tasks;
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
      const byTenant = new DatabaseTaskStore(harness.db(), {
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

    it('reads and writes the table it was given', async () => {
      await harness.migrateRenamed();
      const renamed = new DatabaseTaskStore(harness.db(), { tableName: RENAMED_TABLE });
      const task = makeTask();

      await renamed.save(task, context());

      expect(await renamed.load('task-1', context())).toEqual(task);
      expect(await rowsInTable(RENAMED_TABLE)).toHaveLength(1);
    });

    it('a store left on the default name cannot read a renamed table', async () => {
      await harness.migrateRenamed();

      await expect(store.load('task-1', context())).rejects.toThrow();
    });

    it('a store given a name cannot read the default table', async () => {
      const renamed = new DatabaseTaskStore(harness.db(), { tableName: RENAMED_TABLE });

      await expect(renamed.load('task-1', context())).rejects.toThrow();
    });
  });

  describe('with DefaultRequestHandler', () => {
    const agentCard: AgentCard = {
      name: 'Test Agent',
      description: 'Test agent',
      version: '1.0.0',
      provider: undefined,
      documentationUrl: '',
      supportedInterfaces: [
        {
          url: 'http://localhost/a2a',
          protocolBinding: 'HTTP+JSON',
          tenant: '',
          protocolVersion: '1.0',
        },
      ],
      capabilities: {
        extensions: [],
        streaming: true,
        pushNotifications: false,
      },
      securitySchemes: {},
      securityRequirements: [],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
      signatures: [],
    };

    it('persists task events from sendMessage and reads the task back via getTask', async () => {
      const context = makeContext({ tenant: 'acme', user: 'alice' });
      const userMessage = makeMessage({ messageId: 'msg-user', taskId: '' });
      const agentMessage = makeMessage({ messageId: 'msg-agent', role: Role.ROLE_AGENT });
      const artifact = makeArtifact();

      const executor: AgentExecutor = {
        async execute(ctx, bus) {
          const ids = { taskId: ctx.taskId, contextId: ctx.contextId };
          bus.publish(
            AgentEvent.task(
              makeTask({
                id: ctx.taskId,
                contextId: ctx.contextId,
                status: {
                  state: TaskState.TASK_STATE_SUBMITTED,
                  message: undefined,
                  timestamp: undefined,
                },
              })
            )
          );
          bus.publish(
            AgentEvent.statusUpdate({
              ...ids,
              status: {
                state: TaskState.TASK_STATE_WORKING,
                message: { ...agentMessage, ...ids },
                timestamp: undefined,
              },
              metadata: undefined,
            })
          );
          bus.publish(
            AgentEvent.artifactUpdate({
              ...ids,
              artifact,
              append: false,
              lastChunk: true,
              metadata: undefined,
            })
          );
          bus.publish(
            AgentEvent.statusUpdate({
              ...ids,
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                message: undefined,
                timestamp: undefined,
              },
              metadata: undefined,
            })
          );
        },
        async cancelTask() {},
      };

      const handler = new DefaultRequestHandler(agentCard, store, executor);
      const result = (await handler.sendMessage(
        {
          tenant: 'acme',
          message: userMessage,
          configuration: undefined,
          metadata: undefined,
        },
        context
      )) as Task;

      expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

      const stored = await store.load(result.id, context);
      expect(stored?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
      expect(stored?.artifacts).toEqual([artifact]);
      expect(stored?.history).toEqual([userMessage, { ...agentMessage, taskId: result.id }]);

      const fetched = await handler.getTask({ id: result.id, tenant: 'acme' }, context);
      expect(fetched).toEqual(stored);
    });
  });
}

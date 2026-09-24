import type { ExpressionBuilder, Kysely } from 'kysely';

import { DEFAULT_PAGE_SIZE } from '../../../constants.js';
import {
  TaskState,
  taskStateToJSON,
  type ListTasksRequest,
  type ListTasksResponse,
  type Task,
} from '../../../types/pb/a2a.js';
import type { ServerCallContext } from '../../context.js';
import { type OwnerResolver, resolveUserScope } from '../../owner_resolver.js';
import type { TaskStore } from '../../store.js';
import { callerScope, decodePageToken, encodePageToken } from '../../utils.js';
import { dialectOf, type DialectName } from '../dialect.js';
import {
  TASK_TABLE,
  TASK_TABLE_COLUMNS,
  TASK_TABLE_KEY_COLUMNS,
  type TaskDatabase,
  type TaskRow,
} from './schema.js';
import { fromTaskRow, statusLastUpdated, toTaskRow, type TaskScope } from './serialization.js';

/**
 * The columns a listing needs. A payload column the caller will not see is left
 * unselected, so the engine never reads it.
 */
function listColumns(params: ListTasksRequest): readonly (keyof TaskRow)[] {
  const skipped = new Set<keyof TaskRow>();
  if (!params.includeArtifacts) {
    skipped.add('artifacts');
  }
  if (params.historyLength !== undefined && params.historyLength <= 0) {
    skipped.add('history');
  }
  return TASK_TABLE_COLUMNS.filter((column) => !skipped.has(column));
}

/** Cursor form of the sort key. 0 means no timestamp, which InMemoryTaskStore spells ''. */
function cursorTimestamp(statusLastUpdated: number): string {
  return statusLastUpdated === 0 ? '' : new Date(statusLastUpdated).toISOString();
}

export interface DatabaseTaskStoreOptions {
  /** Defaults to {@link resolveUserScope}. */
  readonly ownerResolver?: OwnerResolver;
  /**
   * Table to read and write. Defaults to {@link TASK_TABLE}, and must be the table
   * `taskStoreMigrations` created.
   */
  readonly tableName?: string;
}

/**
 * {@link TaskStore} backed by a database.
 *
 * The caller builds the {@link Kysely} instance and can type it with any schema: the
 * store names its table at runtime, so one connection can serve other stores and the
 * application's own tables too.
 * The table must already exist, migrating is an operator step, not something
 * the store does on first use.
 */
export class DatabaseTaskStore<DB = unknown> implements TaskStore {
  private readonly db: Kysely<TaskDatabase>;
  private readonly ownerResolver: OwnerResolver;
  private readonly dialect: DialectName;
  private readonly tableName: string;

  constructor(db: Kysely<DB>, options: DatabaseTaskStoreOptions = {}) {
    // Safe: the table is named at runtime, so the caller's schema type is never used.
    // Kysely only accepts an exact schema type, so the conversion goes through unknown.
    this.db = db as unknown as Kysely<TaskDatabase>;
    this.ownerResolver = options.ownerResolver ?? resolveUserScope;
    this.tableName = options.tableName ?? TASK_TABLE;
    // Fixed for the connection's lifetime, and rejects an engine we cannot
    // write to here rather than on the first save.
    this.dialect = dialectOf(db);
  }

  private scopeOf(context: ServerCallContext): TaskScope {
    // Shared with the in-memory stores, so one caller reaches the same data
    // through either.
    return callerScope(context, this.ownerResolver);
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    const row = toTaskRow(this.scopeOf(context), task);
    // Everything outside the primary key: a save replaces the whole task.
    const replaceable = {
      context_id: row.context_id,
      status_last_updated: row.status_last_updated,
      status_state: row.status_state,
      status: row.status,
      artifacts: row.artifacts,
      history: row.history,
      metadata: row.metadata,
      protocol_version: row.protocol_version,
    };

    const insert = this.db.insertInto(this.tableName).values(row);
    await (
      this.dialect === 'mysql'
        ? insert.onDuplicateKeyUpdate(replaceable)
        : insert.onConflict((clause) =>
            clause.columns([...TASK_TABLE_KEY_COLUMNS]).doUpdateSet(replaceable)
          )
    ).execute();
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const scope = this.scopeOf(context);

    const row = await this.db
      .selectFrom(this.tableName)
      .select([...TASK_TABLE_COLUMNS])
      .where('tenant', '=', scope.tenant)
      .where('owner', '=', scope.owner)
      .where('id', '=', taskId)
      .executeTakeFirst();

    return row ? fromTaskRow(row) : undefined;
  }

  /**
   * The caller's scope plus whichever filters the request carries. Shared by
   * the count and the page so the two cannot drift.
   */
  private listFilter(scope: TaskScope, params: ListTasksRequest) {
    return (eb: ExpressionBuilder<TaskDatabase, string>) => {
      const conditions = [eb('tenant', '=', scope.tenant), eb('owner', '=', scope.owner)];

      if (params.contextId) {
        conditions.push(eb('context_id', '=', params.contextId));
      }
      // UNSPECIFIED is the absent filter, not a state to match.
      if (params.status !== undefined && params.status !== TaskState.TASK_STATE_UNSPECIFIED) {
        conditions.push(eb('status_state', '=', taskStateToJSON(params.status)));
      }
      if (params.statusTimestampAfter) {
        conditions.push(eb('status_last_updated', '>', Date.parse(params.statusTimestampAfter)));
      }

      return eb.and(conditions);
    };
  }

  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    const scope = this.scopeOf(context);
    const { pageSize = DEFAULT_PAGE_SIZE, pageToken } = params;
    const filter = this.listFilter(scope, params);

    // Counted before paginating, so it reports the whole match, not the page.
    const counted = await this.db
      .selectFrom(this.tableName)
      .select((eb) => eb.fn.countAll().as('total'))
      .where(filter)
      .executeTakeFirstOrThrow();
    // The engines disagree on what type a count comes back as.
    const totalSize = Number(counted.total);

    let query = this.db
      .selectFrom(this.tableName)
      .select([...listColumns(params)])
      .where(filter)
      .orderBy('status_last_updated', 'desc')
      .orderBy('id', 'desc')
      // One extra row answers whether a next page exists.
      .limit(pageSize + 1);

    if (pageToken) {
      const cursor = decodePageToken(pageToken);
      const cursorUpdated = statusLastUpdated(cursor.timestamp);
      // Keyset: everything ordering after the cursor row.
      query = query.where((eb) =>
        eb.or([
          eb('status_last_updated', '<', cursorUpdated),
          eb.and([eb('status_last_updated', '=', cursorUpdated), eb('id', '<', cursor.id)]),
        ])
      );
    }

    const rows = await query.execute();
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;

    const tasks: Task[] = [];
    for (const row of page) {
      try {
        // An unselected payload column reads as absent, which is an empty value.
        tasks.push(
          fromTaskRow({ ...row, artifacts: row.artifacts ?? null, history: row.history ?? null })
        );
      } catch (error) {
        // One unreadable row must not lose the rest, nor the rows behind it.
        console.error(
          `Skipping task "${row.id}" for owner "${scope.owner}" in tenant ` +
            `"${scope.tenant}": it could not be read.`,
          error
        );
      }
    }

    // Follows the last row the page consumed, read or skipped.
    const lastRow = page.at(-1);

    return {
      // Fewer than pageSize when a row was skipped, which the field allows.
      tasks,
      nextPageToken:
        hasMore && lastRow
          ? // Number(): bigint is a string on some drivers.
            encodePageToken(cursorTimestamp(Number(lastRow.status_last_updated)), lastRow.id)
          : '',
      pageSize,
      totalSize,
    };
  }
}

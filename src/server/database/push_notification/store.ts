import type { Kysely } from 'kysely';

import type { TaskPushNotificationConfig } from '../../../types/pb/a2a.js';
import type { ServerCallContext } from '../../context.js';
import { type OwnerResolver, resolveUserScope } from '../../owner_resolver.js';
import type {
  PushNotificationStore,
  StoredPushNotificationConfig,
} from '../../push_notification/push_notification_store.js';
import { callerScope } from '../../utils.js';
import { dialectOf, type DialectName } from '../dialect.js';
import {
  PUSH_NOTIFICATION_TABLE,
  PUSH_NOTIFICATION_TABLE_COLUMNS,
  PUSH_NOTIFICATION_TABLE_KEY_COLUMNS,
  type PushNotificationDatabase,
} from './schema.js';
import {
  fromPushNotificationConfigRow,
  toPushNotificationConfigRow,
  type PushNotificationConfigScope,
} from './serialization.js';

/**
 * {@link PushNotificationStore} backed by a database.
 *
 * The caller builds the {@link Kysely} instance.
 * The table must already exist, migrating is an operator step, not something
 * the store does on first use.
 */
export class DatabasePushNotificationStore implements PushNotificationStore {
  private readonly db: Kysely<PushNotificationDatabase>;
  private readonly ownerResolver: OwnerResolver;
  private readonly dialect: DialectName;
  private schemaCheck?: Promise<void>;

  constructor(
    db: Kysely<PushNotificationDatabase>,
    ownerResolver: OwnerResolver = resolveUserScope
  ) {
    this.db = db;
    this.ownerResolver = ownerResolver;
    // Fixed for the connection's lifetime, and rejects an engine we cannot
    // write to here rather than on the first save.
    this.dialect = dialectOf(db);
  }

  /**
   * Checks the table is reachable and has the columns this store uses.
   * Optional: every method does it anyway. Call it at startup to fail there
   * instead of on the first request.
   */
  async initialize(): Promise<void> {
    // Only success is cached, so migrating a database this store already
    // rejected does not need a restart.
    this.schemaCheck ??= this.checkSchema().catch((error: unknown) => {
      this.schemaCheck = undefined;
      throw error;
    });
    await this.schemaCheck;
  }

  /**
   * A no-row select, so the engine resolves the table and every column the
   * same way a real query would.
   */
  private async checkSchema(): Promise<void> {
    try {
      await this.db
        .selectFrom(PUSH_NOTIFICATION_TABLE)
        .select([...PUSH_NOTIFICATION_TABLE_COLUMNS])
        .limit(0)
        .execute();
    } catch (cause) {
      // Conditional, because this also catches an unreachable database, and
      // telling someone to migrate through a refused connection is no help.
      throw new Error(
        `Cannot read table "${PUSH_NOTIFICATION_TABLE}": ${String(cause)}. ` +
          `If it is missing or out of date, run "npx a2a-db upgrade".`,
        { cause }
      );
    }
  }

  private scopeOf(taskId: string, context: ServerCallContext): PushNotificationConfigScope {
    // Shared with the in-memory stores, so one caller reaches the same data
    // through either.
    return { ...callerScope(context, this.ownerResolver), taskId };
  }

  async save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void> {
    await this.initialize();

    // id is the *result* of Create, written onto the caller's object so it
    // observes what was assigned.
    if (!pushNotificationConfig.id) {
      pushNotificationConfig.id = crypto.randomUUID();
    }

    const row = toPushNotificationConfigRow(this.scopeOf(taskId, context), {
      config: pushNotificationConfig,
      wireVersion: context.requestedVersion,
    });

    const replaceable = {
      config_data: row.config_data,
      protocol_version: row.protocol_version,
    };
    const insert = this.db.insertInto(PUSH_NOTIFICATION_TABLE).values(row);
    await (
      this.dialect === 'mysql'
        ? insert.onDuplicateKeyUpdate(replaceable)
        : insert.onConflict((clause) =>
            clause.columns([...PUSH_NOTIFICATION_TABLE_KEY_COLUMNS]).doUpdateSet(replaceable)
          )
    ).execute();
  }

  async load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]> {
    const stored = await this.loadWithMetadata(taskId, context);
    // Discarding the wire version, which is not needed here.
    return stored.map((entry) => entry.config);
  }

  async loadWithMetadata(
    taskId: string,
    context: ServerCallContext
  ): Promise<StoredPushNotificationConfig[]> {
    await this.initialize();
    const scope = this.scopeOf(taskId, context);

    const rows = await this.db
      .selectFrom(PUSH_NOTIFICATION_TABLE)
      .select([...PUSH_NOTIFICATION_TABLE_COLUMNS])
      .where('tenant', '=', scope.tenant)
      .where('owner', '=', scope.owner)
      .where('task_id', '=', scope.taskId)
      .execute();

    const stored: StoredPushNotificationConfig[] = [];
    for (const row of rows) {
      try {
        stored.push(fromPushNotificationConfigRow(row));
      } catch (error) {
        // One unreadable row must not lose the rest.
        console.error(
          `Skipping push notification config "${row.config_id}" for task ` +
            `"${row.task_id}" owned by "${scope.owner}": it could not be read.`,
          error
        );
      }
    }
    return stored;
  }

  async delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void> {
    // Optional on the interface. Ambiguous when absent, so reject rather than guess.
    if (configId === undefined) {
      throw new Error('Deleting a push notification config needs its configId.');
    }

    await this.initialize();
    const scope = this.scopeOf(taskId, context);

    await this.db
      .deleteFrom(PUSH_NOTIFICATION_TABLE)
      .where('tenant', '=', scope.tenant)
      .where('owner', '=', scope.owner)
      .where('task_id', '=', scope.taskId)
      .where('config_id', '=', configId)
      .execute();
  }
}

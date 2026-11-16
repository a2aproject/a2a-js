import { describe, expect, it } from 'vitest';

import { migrationModule } from '../../src/cli/migrator.js';

/** What the CLI calls on a Migrator. Extend when it starts using another. */
const USED_METHODS = ['getMigrations', 'migrateTo', 'migrateToLatest', 'migrateDown'] as const;

describe('migrationModule', () => {
  it('loads a Migrator carrying every method the CLI calls', async () => {
    const { Migrator } = await migrationModule();
    const proto = Migrator.prototype as Record<string, unknown>;

    for (const name of USED_METHODS) {
      expect(typeof proto[name], name).toBe('function');
    }
  });

  it('loads the sentinel kysely recognises as revert-everything', async () => {
    const { NO_MIGRATIONS } = await migrationModule();

    expect(NO_MIGRATIONS.__noMigrations__).toBe(true);
  });
});

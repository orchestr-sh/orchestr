/**
 * Schema builder wiring and cross-dialect compilation
 *
 * The builder owns the fluent API and executes statements; every dialect
 * decision belongs to the grammar it resolves from the connection's driver.
 * SQLite is exercised against a real driver in `SchemaBuilderSqlite.test.ts`,
 * so this suite checks the registry and the statements Postgres and MySQL
 * receive, without needing a server.
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import { Connection } from '@/Database/Connection';
import {
  MySqlSchemaGrammar,
  PostgresSchemaGrammar,
  SchemaGrammar,
  SqliteSchemaGrammar,
  schemaGrammarForDriver,
  supportedSchemaGrammarDrivers,
} from '@/Database/Migrations/Grammars';
import { SchemaBuilder } from '@/Database/Migrations/SchemaBuilder';
import { recordAdapter } from '../Query/support';

/**
 * A schema builder on a recording adapter, plus the statements it has sent.
 */
function schemaFor(
  driver: string,
  results: { select?: any[] } = {}
): { schema: SchemaBuilder; adapter: DatabaseAdapter; sqls: () => string[] } {
  const { adapter, queries } = recordAdapter(results);
  const schema = new SchemaBuilder(new Connection(adapter, { driver, database: 'db' }));

  return { schema, adapter, sqls: () => queries.map((query) => query.sql) };
}

describe('schemaGrammarForDriver', () => {
  it.each([
    ['sqlite', SqliteSchemaGrammar],
    ['better-sqlite3', SqliteSchemaGrammar],
    ['postgres', PostgresSchemaGrammar],
    ['postgresql', PostgresSchemaGrammar],
    ['mysql', MySqlSchemaGrammar],
    ['mariadb', MySqlSchemaGrammar],
  ])('maps the %s driver onto its schema grammar', (driver, Grammar) => {
    expect(schemaGrammarForDriver(driver)).toBeInstanceOf(Grammar);
  });

  it('is case insensitive about the configured driver', () => {
    expect(schemaGrammarForDriver('MySQL')).toBeInstanceOf(MySqlSchemaGrammar);
  });

  it('names the supported drivers when a grammar is missing', () => {
    expect(() => schemaGrammarForDriver('oracle')).toThrow(/No schema grammar is registered for the \[oracle\] driver/);
    expect(supportedSchemaGrammarDrivers()).toContain('sqlite');
  });

  it('gives every schema grammar the same compile surface', () => {
    const grammar = schemaGrammarForDriver('sqlite');

    expect(grammar).toBeInstanceOf(SchemaGrammar);
    expect(typeof grammar.compileCreate).toBe('function');
    expect(typeof grammar.compileAlter).toBe('function');
    expect(typeof grammar.compileHasTable).toBe('function');
    expect(typeof grammar.compileColumnListing).toBe('function');
    expect(typeof grammar.supportsSchemaTransactions).toBe('function');
  });

  it('shares identifier conventions with the query grammar', () => {
    expect(schemaGrammarForDriver('mysql').wrapTable('users')).toBe('`users`');
    expect(schemaGrammarForDriver('postgres').wrapTable('users')).toBe('"users"');
    expect(() => schemaGrammarForDriver('sqlite').wrapTable('users"; DROP TABLE users;--')).toThrow(
      /Unsupported identifier/
    );
  });
});

describe('SchemaBuilder (mysql, compiled statements)', () => {
  it('runs the create statements in grammar order', async () => {
    const { schema, sqls } = schemaFor('mysql');

    await schema.create('posts', (table) => {
      table.id();
      table.foreignId('user_id').constrained().nullOnDelete();
      table.string('title');
      table.index('title');
    });

    expect(sqls()).toEqual([
      'CREATE TABLE `posts` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `user_id` BIGINT UNSIGNED NOT NULL, `title` VARCHAR(255) NOT NULL, PRIMARY KEY (`id`))',
      'CREATE INDEX `posts_title_index` ON `posts` (`title`)',
      'ALTER TABLE `posts` ADD CONSTRAINT `posts_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL',
    ]);
  });

  it('escapes a string default that contains a quote', async () => {
    const { schema, sqls } = schemaFor('mysql');

    await schema.create('users', (table) => {
      table.string('nickname').default("O'Brien");
    });

    expect(sqls()[0]).toBe("CREATE TABLE `users` (`nickname` VARCHAR(255) NOT NULL DEFAULT 'O\\'Brien')");
  });

  it('switches session constraints off around a callback and back on after it', async () => {
    const { schema, sqls } = schemaFor('mysql');

    await schema.withoutForeignKeyConstraints(async () => {
      await schema.dropIfExists('posts');
    });

    expect(sqls()).toEqual(['SET FOREIGN_KEY_CHECKS=0', 'DROP TABLE IF EXISTS `posts`', 'SET FOREIGN_KEY_CHECKS=1']);
  });

  it('pins the span to one session, because the toggle is a session variable', async () => {
    const { schema, adapter } = schemaFor('mysql');

    await schema.withoutForeignKeyConstraints(async () => {
      await schema.dropIfExists('posts');
    });

    expect(adapter.beginTransaction).toHaveBeenCalledTimes(1);
    expect(adapter.commit).toHaveBeenCalledTimes(1);
  });

  it('compiles every drop and rename helper', async () => {
    const { schema, sqls } = schemaFor('mysql');

    await schema.table('users', (table) => {
      table.dropColumn(['name', 'email']);
      table.dropTimestamps();
      table.dropSoftDeletes();
      table.dropIndex('users_name_index');
      table.dropUnique(['email']);
      table.dropPrimary();
      table.dropForeign(['user_id']);
      table.renameIndex('users_name_index', 'users_handle_index');
      table.renameColumn('login', 'username');
    });

    expect(sqls()).toEqual([
      'ALTER TABLE `users` DROP COLUMN `name`, DROP COLUMN `email`',
      'ALTER TABLE `users` DROP COLUMN `created_at`, DROP COLUMN `updated_at`',
      'ALTER TABLE `users` DROP COLUMN `deleted_at`',
      'ALTER TABLE `users` DROP INDEX `users_name_index`',
      'ALTER TABLE `users` DROP INDEX `users_email_unique`',
      'ALTER TABLE `users` DROP PRIMARY KEY',
      'ALTER TABLE `users` DROP FOREIGN KEY `users_user_id_foreign`',
      'ALTER TABLE `users` RENAME INDEX `users_name_index` TO `users_handle_index`',
      'ALTER TABLE `users` RENAME COLUMN `login` TO `username`',
    ]);
  });

  it('asks the information schema about one column by name', async () => {
    const { schema, sqls } = schemaFor('mysql', { select: [{ name: 'email' }] });

    await expect(schema.hasColumn('users', 'email')).resolves.toBe(true);
    await expect(schema.hasColumn('users', 'missing')).resolves.toBe(false);

    expect(sqls()[1]).toBe(
      'SELECT `COLUMN_NAME` AS `name` FROM `information_schema`.`COLUMNS` ' +
        "WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'users'"
    );
  });

  it('refuses to modify a column, because MySQL cannot', async () => {
    const { schema } = schemaFor('mysql');

    await expect(schema.table('users', (table) => table.string('name').change())).rejects.toThrow(
      /does not support modifying table columns/
    );
  });
});

describe('SchemaBuilder (postgres, compiled statements)', () => {
  it('creates the primary key as a table constraint', async () => {
    const { schema, sqls } = schemaFor('postgres');

    await schema.create('users', (table) => {
      table.id();
      table.ulid('share_code');
    });

    expect(sqls()).toEqual([
      'CREATE TABLE "users" ("id" BIGSERIAL NOT NULL, "share_code" VARCHAR(26) NOT NULL, PRIMARY KEY ("id"))',
    ]);
  });

  it('redefines a column in place', async () => {
    const { schema, sqls } = schemaFor('postgres');

    await schema.table('users', (table) => {
      table.string('name', 100).nullable().change();
    });

    expect(sqls()).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "name" TYPE VARCHAR(100)',
      'ALTER TABLE "users" ALTER COLUMN "name" DROP NOT NULL',
    ]);
  });

  it('runs the callback without constraint statements and cascades the drop', async () => {
    const { schema, adapter, sqls } = schemaFor('postgres');

    await schema.withoutForeignKeyConstraints(async () => {
      await schema.drop('users');
    });

    // PostgreSQL has no session switch, so nothing is turned off and the drop
    // takes dependent tables with it instead.
    expect(sqls()).toEqual(['DROP TABLE "users" CASCADE']);
    expect(adapter.beginTransaction).not.toHaveBeenCalled();
  });

  it('asks the catalog for tables and columns', async () => {
    const tables = schemaFor('postgres', { select: [{ name: 'users' }] });
    const columns = schemaFor('postgres', { select: [{ name: 'id' }] });

    await expect(tables.schema.hasTable('users')).resolves.toBe(true);
    expect(tables.sqls()[0]).toContain('"pg_tables"');

    await expect(columns.schema.hasColumn('users', 'id')).resolves.toBe(true);
    await expect(columns.schema.hasColumn('users', 'missing')).resolves.toBe(false);
    expect(columns.sqls()[0]).toContain('"information_schema"."columns"');
  });
});

describe('SchemaBuilder (sqlite, compiled statements)', () => {
  it('exposes the grammar the connection resolved', () => {
    const { schema } = schemaFor('better-sqlite3');

    expect(schema.getGrammar()).toBeInstanceOf(SqliteSchemaGrammar);
  });

  it('refuses a driver with no schema grammar', () => {
    const { adapter } = recordAdapter();

    expect(() => new SchemaBuilder(new Connection(adapter, { driver: 'oracle', database: 'db' }))).toThrow(
      /No schema grammar is registered/
    );
  });

  it('turns the column modifier into a real unique index', async () => {
    const { schema, sqls } = schemaFor('sqlite');

    await schema.create('users', (table) => {
      table.id();
      table.string('email').unique();
    });

    expect(sqls()).toEqual([
      'CREATE TABLE "users" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "email" VARCHAR(255) NOT NULL)',
      'CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email")',
    ]);
  });

  it('renames and drops tables with quoted identifiers', async () => {
    const { schema, sqls } = schemaFor('sqlite');

    await schema.rename('users', 'accounts');
    await schema.drop('accounts');
    await schema.dropIfExists('accounts');

    expect(sqls()).toEqual([
      'ALTER TABLE "users" RENAME TO "accounts"',
      'DROP TABLE "accounts"',
      'DROP TABLE IF EXISTS "accounts"',
    ]);
  });
});

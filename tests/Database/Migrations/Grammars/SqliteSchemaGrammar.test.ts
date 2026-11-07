/**
 * SQLite schema grammar
 *
 * Compile-only checks for the dialect rules SQLite needs: the primary key has
 * to sit inside the column definition for `AUTOINCREMENT` to apply, foreign
 * keys can only be written while the table is created, and one `ALTER TABLE`
 * statement carries exactly one action.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SchemaConnection } from '@/Database/Migrations/Grammars';
import { Blueprint } from '@/Database/Migrations/Blueprint';
import { SqliteSchemaGrammar } from '@/Database/Migrations/Grammars';
import { raw } from '@/Database/Query/Expression';

const grammar = new SqliteSchemaGrammar();

/**
 * A blueprint filled in by the callback, as `Schema::create` would build it.
 */
function createBlueprint(table: string, callback: (blueprint: Blueprint) => void): Blueprint {
  const blueprint = new Blueprint(table);
  blueprint.isCreate = true;
  callback(blueprint);

  return blueprint;
}

/**
 * A connection double that records what was asked and hands back fixed rows.
 */
function fakeConnection(rows: any[] = []): { connection: SchemaConnection; statements: string[] } {
  const statements: string[] = [];

  return {
    statements,
    connection: {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
      }),
      select: vi.fn(async (sql: string) => {
        statements.push(sql);

        return rows;
      }),
    },
  };
}

describe('SqliteSchemaGrammar create table', () => {
  it('makes id() the primary key, spelled the way SQLite requires', () => {
    const statements = grammar.compileCreate(
      createBlueprint('users', (table) => {
        table.id();
      })
    );

    expect(statements).toEqual(['CREATE TABLE "users" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT)']);
  });

  it('makes increments() and bigIncrements() primary keys too', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('posts', (table) => {
          table.increments('post_id');
        })
      )
    ).toEqual(['CREATE TABLE "posts" ("post_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT)']);

    expect(
      grammar.compileCreate(
        createBlueprint('logs', (table) => {
          table.bigIncrements('log_id');
        })
      )
    ).toEqual(['CREATE TABLE "logs" ("log_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT)']);
  });

  it('keeps a non-incrementing primary key inline', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('cache', (table) => {
          table.string('key', 255).primary();
          table.text('value');
        })
      )
    ).toEqual(['CREATE TABLE "cache" ("key" VARCHAR(255) NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)']);
  });

  it('falls back to a table constraint for a composite primary key', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('post_user', (table) => {
          table.integer('post_id');
          table.integer('user_id');
          table.primary(['post_id', 'user_id']);
        })
      )
    ).toEqual([
      'CREATE TABLE "post_user" ("post_id" INTEGER NOT NULL, "user_id" INTEGER NOT NULL, PRIMARY KEY ("post_id", "user_id"))',
    ]);
  });

  it('compiles every column type onto SQLite storage classes', () => {
    const [statement] = grammar.compileCreate(
      createBlueprint('everything', (table) => {
        table.uuid('public_id');
        table.ulid('sort_key');
        table.string('name');
        table.text('body');
        table.mediumText('medium');
        table.longText('long');
        table.integer('votes');
        table.bigInteger('big');
        table.smallInteger('small');
        table.tinyInteger('tiny');
        table.decimal('price', 10, 2);
        table.float('ratio');
        table.double('wide');
        table.boolean('active');
        table.date('birthday');
        table.datetime('published_at');
        table.timestamp('synced_at');
        table.json('payload');
        table.jsonb('also_payload');
        table.binary('blob');
        table.enum('status', ['draft', 'live']);
      })
    );

    expect(statement).toBe(
      'CREATE TABLE "everything" ("public_id" VARCHAR(36) NOT NULL, "sort_key" VARCHAR(26) NOT NULL, ' +
        '"name" VARCHAR(255) NOT NULL, "body" TEXT NOT NULL, "medium" TEXT NOT NULL, "long" TEXT NOT NULL, ' +
        '"votes" INTEGER NOT NULL, "big" INTEGER NOT NULL, "small" INTEGER NOT NULL, "tiny" INTEGER NOT NULL, ' +
        '"price" REAL NOT NULL, "ratio" REAL NOT NULL, "wide" REAL NOT NULL, "active" INTEGER NOT NULL, ' +
        '"birthday" DATE NOT NULL, "published_at" DATETIME NOT NULL, "synced_at" DATETIME NOT NULL, ' +
        '"payload" TEXT NOT NULL, "also_payload" TEXT NOT NULL, "blob" BLOB NOT NULL, "status" TEXT NOT NULL)'
    );
  });

  it('indexes and unique keys after the table is created', () => {
    const statements = grammar.compileCreate(
      createBlueprint('users', (table) => {
        table.id();
        table.string('email');
        table.string('name');
        table.index('name');
        table.unique('email');
      })
    );

    expect(statements).toEqual([
      'CREATE TABLE "users" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "email" VARCHAR(255) NOT NULL, "name" VARCHAR(255) NOT NULL)',
      'CREATE INDEX "users_name_index" ON "users" ("name")',
      'CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email")',
    ]);
  });

  it('inlines foreign keys, because SQLite cannot attach them afterwards', () => {
    const statements = grammar.compileCreate(
      createBlueprint('posts', (table) => {
        table.id();
        table.foreignId('user_id').constrained().cascadeOnDelete();
      })
    );

    expect(statements).toEqual([
      'CREATE TABLE "posts" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "user_id" INTEGER NOT NULL, ' +
        'CONSTRAINT "posts_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE)',
    ]);
  });

  it('refuses a foreign key that was never pointed at anything', () => {
    const blueprint = createBlueprint('posts', (table) => {
      table.integer('user_id');
      table.foreign('user_id');
    });

    expect(() => grammar.compileCreate(blueprint)).toThrow(/missing the column and table it references/);
  });

  it('refuses to add a foreign key to a table that already exists', () => {
    const blueprint = new Blueprint('posts');
    blueprint.integer('author_id');
    blueprint.foreign('author_id').references('id').on('users');

    expect(() => grammar.compileAlter(blueprint)).toThrow(/does not support adding foreign keys/);
  });
});

describe('SqliteSchemaGrammar defaults', () => {
  it('escapes quotes inside a string default', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('products', (table) => {
          table.string('nickname').default("O'Brien");
        })
      )
    ).toEqual([`CREATE TABLE "products" ("nickname" VARCHAR(255) NOT NULL DEFAULT 'O''Brien')`]);
  });

  it('emits raw SQL only when the default was wrapped in an expression', () => {
    const [statement] = grammar.compileCreate(
      createBlueprint('logs', (table) => {
        table.timestamp('created_at').default(raw('CURRENT_TIMESTAMP'));
        table.string('host').default(`now()'); DROP TABLE logs;--`);
      })
    );

    expect(statement).toBe(
      'CREATE TABLE "logs" ' +
        `("created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
        `"host" VARCHAR(255) NOT NULL DEFAULT 'now()''); DROP TABLE logs;--')`
    );
  });

  it('refuses a default it cannot turn into a literal', () => {
    expect(() =>
      grammar.compileCreate(
        createBlueprint('logs', (table) => {
          table.json('payload').default({ a: 1 });
        })
      )
    ).toThrow(/Cannot use a value of type "object" as a column default value/);
  });

  it('renders booleans as integers and null as NULL', () => {
    const statements = grammar.compileCreate(
      createBlueprint('flags', (table) => {
        table.boolean('active').default(true);
        table.boolean('hidden').default(false);
        table.string('note').nullable().default(null);
      })
    );

    expect(statements[0]).toBe(
      'CREATE TABLE "flags" ("active" INTEGER NOT NULL DEFAULT 1, "hidden" INTEGER NOT NULL DEFAULT 0, ' +
        '"note" VARCHAR(255) DEFAULT NULL)'
    );
  });
});

describe('SqliteSchemaGrammar alter table', () => {
  it('adds one column per statement and creates indexes after it', () => {
    const statements = grammar.compileAlter(
      (() => {
        const blueprint = new Blueprint('users');
        blueprint.string('nickname');
        blueprint.integer('votes').default(0);
        blueprint.index('nickname');

        return blueprint;
      })()
    );

    expect(statements).toEqual([
      'ALTER TABLE "users" ADD COLUMN "nickname" VARCHAR(255) NOT NULL',
      'ALTER TABLE "users" ADD COLUMN "votes" INTEGER NOT NULL DEFAULT 0',
      'CREATE INDEX "users_nickname_index" ON "users" ("nickname")',
    ]);
  });

  it('drops one column per statement', () => {
    const statements = grammar.compileAlter(
      (() => {
        const blueprint = new Blueprint('users');
        blueprint.dropColumn(['name', 'email']);

        return blueprint;
      })()
    );

    expect(statements).toEqual(['ALTER TABLE "users" DROP COLUMN "name"', 'ALTER TABLE "users" DROP COLUMN "email"']);
  });

  it('renames a column', () => {
    const blueprint = new Blueprint('users');
    blueprint.renameColumn('name', 'full_name');

    expect(grammar.compileAlter(blueprint)).toEqual(['ALTER TABLE "users" RENAME COLUMN "name" TO "full_name"']);
  });

  it('drops an index by name or by the columns it covers', () => {
    const byName = new Blueprint('users');
    byName.dropIndex('users_email_index');

    const byColumns = new Blueprint('users');
    byColumns.dropIndex(['email']);

    expect(grammar.compileAlter(byName)).toEqual(['DROP INDEX IF EXISTS "users_email_index"']);
    expect(grammar.compileAlter(byColumns)).toEqual(['DROP INDEX IF EXISTS "users_email_index"']);
  });

  it('drops a unique index by the columns it covers', () => {
    const blueprint = new Blueprint('users');
    blueprint.dropUnique(['email']);

    expect(grammar.compileAlter(blueprint)).toEqual(['DROP INDEX IF EXISTS "users_email_unique"']);
  });

  it('drops timestamps and soft deletes as column drops', () => {
    const timestamps = new Blueprint('users');
    timestamps.dropTimestamps();

    const softDeletes = new Blueprint('users');
    softDeletes.dropSoftDeletes();

    expect(grammar.compileAlter(timestamps)).toEqual([
      'ALTER TABLE "users" DROP COLUMN "created_at"',
      'ALTER TABLE "users" DROP COLUMN "updated_at"',
    ]);
    expect(grammar.compileAlter(softDeletes)).toEqual(['ALTER TABLE "users" DROP COLUMN "deleted_at"']);
  });

  it('says so when SQLite cannot express the command', () => {
    const dropForeign = new Blueprint('posts');
    dropForeign.dropForeign('posts_user_id_foreign');

    const dropPrimary = new Blueprint('posts');
    dropPrimary.dropPrimary();

    const renameIndex = new Blueprint('posts');
    renameIndex.renameIndex('posts_user_id_index', 'posts_author_id_index');

    const change = new Blueprint('posts');
    change.string('title').change();

    expect(() => grammar.compileAlter(dropForeign)).toThrow(/does not support dropping foreign key constraints/);
    expect(() => grammar.compileAlter(dropPrimary)).toThrow(/does not support dropping primary keys/);
    expect(() => grammar.compileAlter(renameIndex)).toThrow(/does not support renaming indexes/);
    expect(() => grammar.compileAlter(change)).toThrow(/does not support modifying table columns/);
  });
});

describe('SqliteSchemaGrammar introspection', () => {
  it('asks the catalog for one table by name', () => {
    expect(grammar.compileHasTable('users')).toBe(
      `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'users'`
    );
  });

  it('lists the columns of the requested table', () => {
    expect(grammar.compileColumnListing('users')).toBe('PRAGMA table_info("users")');
  });

  it('answers hasColumn from the listed rows, not from "any column exists"', async () => {
    const { connection, statements } = fakeConnection([{ name: 'id' }, { name: 'email' }]);

    await expect(grammar.hasColumn(connection, 'users', 'email')).resolves.toBe(true);
    await expect(grammar.hasColumn(connection, 'users', 'missing')).resolves.toBe(false);
    expect(statements).toContain('PRAGMA table_info("users")');
  });

  it('answers hasTable when the catalog returned a row', async () => {
    const { connection } = fakeConnection([{ name: 'users' }]);

    await expect(grammar.hasTable(connection, 'users')).resolves.toBe(true);
    await expect(grammar.hasTable(fakeConnection().connection, 'users')).resolves.toBe(false);
  });

  it('escapes the name it asks the catalog about', () => {
    expect(grammar.compileHasTable("su'ers")).toBe(
      `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'su''ers'`
    );
  });

  it('rejects an injection attempt passed as a table name', () => {
    expect(() => grammar.compileColumnListing('users"; DROP TABLE users;--')).toThrow(/Unsupported identifier/);
  });
});

describe('SqliteSchemaGrammar capabilities', () => {
  it('switches constraints off and back on with pragmas', () => {
    expect(grammar.compileDisableForeignKeyConstraints()).toBe('PRAGMA foreign_keys = OFF');
    expect(grammar.compileEnableForeignKeyConstraints()).toBe('PRAGMA foreign_keys = ON');
  });

  it('rolls DDL back with the transaction', () => {
    expect(grammar.supportsSchemaTransactions()).toBe(true);
  });

  it('drops and renames whole tables', () => {
    expect(grammar.compileDropTable('users')).toBe('DROP TABLE "users"');
    expect(grammar.compileDropTableIfExists('users')).toBe('DROP TABLE IF EXISTS "users"');
    expect(grammar.compileRenameTable('users', 'accounts')).toBe('ALTER TABLE "users" RENAME TO "accounts"');
  });
});

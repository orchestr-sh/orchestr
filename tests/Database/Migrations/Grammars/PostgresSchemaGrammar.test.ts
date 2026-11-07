/**
 * PostgreSQL schema grammar
 *
 * Compile-only checks for the PostgreSQL dialect: `SERIAL` carries the counter,
 * the primary key is a table constraint, indexes and foreign keys are separate
 * statements, and the catalog answers table/column questions.
 */

import { describe, expect, it } from 'vitest';
import { Blueprint } from '@/Database/Migrations/Blueprint';
import { PostgresSchemaGrammar } from '@/Database/Migrations/Grammars';
import { raw } from '@/Database/Query/Expression';

const grammar = new PostgresSchemaGrammar();

function createBlueprint(table: string, callback: (blueprint: Blueprint) => void): Blueprint {
  const blueprint = new Blueprint(table);
  blueprint.isCreate = true;
  callback(blueprint);

  return blueprint;
}

function alterBlueprint(table: string, callback: (blueprint: Blueprint) => void): Blueprint {
  const blueprint = new Blueprint(table);
  callback(blueprint);

  return blueprint;
}

describe('PostgresSchemaGrammar create table', () => {
  it('makes id() a BIGSERIAL primary key', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('users', (table) => {
          table.id();
          table.string('email');
        })
      )
    ).toEqual(['CREATE TABLE "users" ("id" BIGSERIAL NOT NULL, "email" VARCHAR(255) NOT NULL, PRIMARY KEY ("id"))']);
  });

  it('makes increments() a SERIAL primary key', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('votes', (table) => {
          table.increments('vote_id');
        })
      )
    ).toEqual(['CREATE TABLE "votes" ("vote_id" SERIAL NOT NULL, PRIMARY KEY ("vote_id"))']);
  });

  it('adds a composite primary key as a table constraint', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('post_user', (table) => {
          table.foreignId('post_id');
          table.foreignId('user_id');
          table.primary(['post_id', 'user_id']);
        })
      )
    ).toEqual([
      'CREATE TABLE "post_user" ("post_id" BIGINT NOT NULL, "user_id" BIGINT NOT NULL, PRIMARY KEY ("post_id", "user_id"))',
    ]);
  });

  it('maps the native types', () => {
    const [statement] = grammar.compileCreate(
      createBlueprint('row', (table) => {
        table.bigInteger('big');
        table.integer('int');
        table.smallInteger('small');
        table.tinyInteger('tiny');
        table.uuid('public_id');
        table.ulid('sort_key');
        table.decimal('price', 12, 4);
        table.float('ratio');
        table.double('wide');
        table.boolean('active');
        table.datetime('at', 3);
        table.timestamp('stamped');
        table.json('plain');
        table.jsonb('structured');
        table.binary('bytes');
        table.longText('story');
        table.enum('status', ['draft', 'live']);
      })
    );

    expect(statement).toBe(
      'CREATE TABLE "row" ("big" BIGINT NOT NULL, "int" INTEGER NOT NULL, "small" SMALLINT NOT NULL, ' +
        '"tiny" SMALLINT NOT NULL, "public_id" UUID NOT NULL, "sort_key" VARCHAR(26) NOT NULL, ' +
        '"price" DECIMAL(12, 4) NOT NULL, "ratio" REAL NOT NULL, "wide" DOUBLE PRECISION NOT NULL, ' +
        '"active" BOOLEAN NOT NULL, "at" TIMESTAMP(3) NOT NULL, "stamped" TIMESTAMP NOT NULL, ' +
        '"plain" JSON NOT NULL, "structured" JSONB NOT NULL, "bytes" BYTEA NOT NULL, "story" TEXT NOT NULL, ' +
        '"status" VARCHAR(255) NOT NULL)'
    );
  });

  it('emits indexes and foreign keys as separate statements', () => {
    const statements = grammar.compileCreate(
      createBlueprint('posts', (table) => {
        table.id();
        table.foreignId('user_id').constrained().cascadeOnDelete().restrictOnUpdate();
        table.string('slug');
        table.unique('slug');
        table.index(['user_id', 'slug']);
      })
    );

    expect(statements).toEqual([
      'CREATE TABLE "posts" ("id" BIGSERIAL NOT NULL, "user_id" BIGINT NOT NULL, "slug" VARCHAR(255) NOT NULL, PRIMARY KEY ("id"))',
      'CREATE UNIQUE INDEX "posts_slug_unique" ON "posts" ("slug")',
      'CREATE INDEX "posts_user_id_slug_index" ON "posts" ("user_id", "slug")',
      'ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ' +
        'ON DELETE CASCADE ON UPDATE RESTRICT',
    ]);
  });
});

describe('PostgresSchemaGrammar defaults', () => {
  it('doubles quotes inside a string default', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('products', (table) => {
          table.string('nickname').default("O'Brien");
        })
      )
    ).toEqual([`CREATE TABLE "products" ("nickname" VARCHAR(255) NOT NULL DEFAULT 'O''Brien')`]);
  });

  it('uses boolean literals and passes wrapped SQL through', () => {
    const [statement] = grammar.compileCreate(
      createBlueprint('flags', (table) => {
        table.boolean('active').default(true);
        table.timestamp('created_at').default(raw('CURRENT_TIMESTAMP'));
      })
    );

    expect(statement).toBe(
      'CREATE TABLE "flags" ("active" BOOLEAN NOT NULL DEFAULT TRUE, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    );
  });
});

describe('PostgresSchemaGrammar alter table', () => {
  it('drops several columns in one statement', () => {
    expect(
      grammar.compileAlter(
        alterBlueprint('users', (table) => {
          table.dropColumn(['name', 'email']);
        })
      )
    ).toEqual(['ALTER TABLE "users" DROP COLUMN "name", DROP COLUMN "email"']);
  });

  it('drops indexes, keys and constraints by name or columns', () => {
    expect(
      grammar.compileAlter(
        alterBlueprint('users', (table) => {
          table.dropIndex('users_name_index');
          table.dropUnique(['email']);
          table.dropPrimary();
          table.dropForeign(['user_id']);
        })
      )
    ).toEqual([
      'DROP INDEX IF EXISTS "users_name_index"',
      'DROP INDEX IF EXISTS "users_email_unique"',
      'ALTER TABLE "users" DROP CONSTRAINT "users_pkey"',
      'ALTER TABLE "users" DROP CONSTRAINT "users_user_id_foreign"',
    ]);
  });

  it('renames an index and a column', () => {
    expect(
      grammar.compileAlter(
        alterBlueprint('users', (table) => {
          table.renameIndex('users_email_index', 'users_handle_index');
          table.renameColumn('name', 'full_name');
        })
      )
    ).toEqual([
      'ALTER INDEX "users_email_index" RENAME TO "users_handle_index"',
      'ALTER TABLE "users" RENAME COLUMN "name" TO "full_name"',
    ]);
  });

  it('redefines a column in place', () => {
    const blueprint = new Blueprint('users');
    blueprint.string('name', 100).nullable().default('anon').change();

    expect(grammar.compileAlter(blueprint)).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "name" TYPE VARCHAR(100)',
      'ALTER TABLE "users" ALTER COLUMN "name" DROP NOT NULL',
      `ALTER TABLE "users" ALTER COLUMN "name" SET DEFAULT 'anon'`,
    ]);
  });

  it('refuses to turn an existing column into a counter', () => {
    const blueprint = new Blueprint('users');
    blueprint.increments('id').change();

    expect(() => grammar.compileAlter(blueprint)).toThrow(/auto-incrementing/);
  });
});

describe('PostgresSchemaGrammar introspection', () => {
  it('asks the catalog for tables and columns', () => {
    expect(grammar.compileHasTable('users')).toBe(
      'SELECT "tablename" AS "name" FROM "pg_tables" ' +
        `WHERE "schemaname" NOT IN ('pg_catalog', 'information_schema') AND "tablename" = 'users'`
    );

    expect(grammar.compileColumnListing('users')).toBe(
      'SELECT "column_name" AS "name" FROM "information_schema"."columns" ' +
        `WHERE "table_schema" = current_schema() AND "table_name" = 'users'`
    );
  });
});

describe('PostgresSchemaGrammar capabilities', () => {
  it('has no session switch for foreign keys', () => {
    expect(grammar.compileDisableForeignKeyConstraints()).toBe('');
    expect(grammar.compileEnableForeignKeyConstraints()).toBe('');
  });

  it('keeps DDL inside a transaction', () => {
    expect(grammar.supportsSchemaTransactions()).toBe(true);
  });

  it('wraps identifiers the PostgreSQL way', () => {
    expect(grammar.wrapTable('users')).toBe('"users"');
    expect(grammar.compileDropTable('users')).toBe('DROP TABLE "users" CASCADE');
    expect(grammar.compileDropTableIfExists('users')).toBe('DROP TABLE IF EXISTS "users" CASCADE');
  });
});

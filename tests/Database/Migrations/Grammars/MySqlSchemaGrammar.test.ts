/**
 * MySQL schema grammar
 *
 * Compile-only checks for the MySQL dialect: backtick identifiers, the counter
 * spelled inside the column definition, keys addressed through `ALTER TABLE`,
 * and the session switch that lets a table be dropped out of order.
 */

import { describe, expect, it } from 'vitest';
import { Blueprint } from '@/Database/Migrations/Blueprint';
import { MySqlSchemaGrammar } from '@/Database/Migrations/Grammars';
import { raw } from '@/Database/Query/Expression';

const grammar = new MySqlSchemaGrammar();

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

describe('MySqlSchemaGrammar create table', () => {
  it('makes id() an auto-incrementing primary key', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('users', (table) => {
          table.id();
        })
      )
    ).toEqual(['CREATE TABLE `users` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`))']);
  });

  it('makes increments() an auto-incrementing primary key', () => {
    expect(
      grammar.compileCreate(
        createBlueprint('votes', (table) => {
          table.increments('vote_id');
        })
      )
    ).toEqual(['CREATE TABLE `votes` (`vote_id` INT UNSIGNED NOT NULL AUTO_INCREMENT, PRIMARY KEY (`vote_id`))']);
  });

  it('maps the native types, including the fixed-width identifiers', () => {
    const [statement] = grammar.compileCreate(
      createBlueprint('row', (table) => {
        table.bigInteger('signed');
        table.bigInteger('unsigned').unsigned();
        table.uuid('public_id');
        table.ulid('sort_key');
        table.boolean('active');
        table.enum('status', ["it's", 'live']);
        table.decimal('price', 12, 4);
        table.float('ratio');
        table.mediumText('body');
      })
    );

    expect(statement).toBe(
      'CREATE TABLE `row` (`signed` BIGINT NOT NULL, `unsigned` BIGINT UNSIGNED NOT NULL, ' +
        '`public_id` CHAR(36) NOT NULL, `sort_key` CHAR(26) NOT NULL, `active` TINYINT(1) NOT NULL, ' +
        "`status` ENUM('it\\'s', 'live') NOT NULL, `price` DECIMAL(12, 4) NOT NULL, " +
        '`ratio` FLOAT NOT NULL, `body` MEDIUMTEXT NOT NULL)'
    );
  });

  it('honours column placement, which only MySQL understands', () => {
    expect(
      grammar.compileAlter(
        alterBlueprint('users', (table) => {
          table.string('handle').first();
          table.integer('votes').after('handle');
        })
      )
    ).toEqual([
      'ALTER TABLE `users` ADD COLUMN `handle` VARCHAR(255) NOT NULL FIRST',
      'ALTER TABLE `users` ADD COLUMN `votes` INT NOT NULL AFTER `handle`',
    ]);
  });

  it('attaches foreign keys after the table exists', () => {
    const statements = grammar.compileCreate(
      createBlueprint('posts', (table) => {
        table.id();
        table.foreignId('user_id').constrained().cascadeOnDelete();
      })
    );

    expect(statements).toEqual([
      'CREATE TABLE `posts` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `user_id` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`))',
      'ALTER TABLE `posts` ADD CONSTRAINT `posts_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE',
    ]);
  });

  it('rejects an unknown referential action instead of emitting it', () => {
    const blueprint = createBlueprint('posts', (table) => {
      table.foreignId('user_id').constrained();
    });

    (blueprint.foreignKeys[0] as any).onDeleteAction = 'cascade; DROP TABLE users';

    expect(() => grammar.compileCreate(blueprint)).toThrow(/Unsupported foreign key action/);
  });
});

describe('MySqlSchemaGrammar defaults', () => {
  it('escapes quotes and backslashes in a string default', () => {
    const [statement] = grammar.compileCreate(
      createBlueprint('products', (table) => {
        table.string('label').default("O'Brien\\");
      })
    );

    expect(statement).toBe(`CREATE TABLE \`products\` (\`label\` VARCHAR(255) NOT NULL DEFAULT 'O\\'Brien\\\\')`);
  });

  it('renders booleans as integers and passes wrapped SQL through', () => {
    const [statement] = grammar.compileCreate(
      createBlueprint('flags', (table) => {
        table.boolean('active').default(false);
        table.timestamp('created_at').default(raw('CURRENT_TIMESTAMP'));
      })
    );

    expect(statement).toBe(
      'CREATE TABLE `flags` (`active` TINYINT(1) NOT NULL DEFAULT 0, `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    );
  });
});

describe('MySqlSchemaGrammar alter table', () => {
  it('addresses keys through the table', () => {
    expect(
      grammar.compileAlter(
        alterBlueprint('users', (table) => {
          table.dropIndex(['name']);
          table.dropUnique('users_email_unique');
          table.dropPrimary();
          table.dropForeign(['user_id']);
          table.renameIndex('users_name_index', 'users_handle_index');
        })
      )
    ).toEqual([
      'ALTER TABLE `users` DROP INDEX `users_name_index`',
      'ALTER TABLE `users` DROP INDEX `users_email_unique`',
      'ALTER TABLE `users` DROP PRIMARY KEY',
      'ALTER TABLE `users` DROP FOREIGN KEY `users_user_id_foreign`',
      'ALTER TABLE `users` RENAME INDEX `users_name_index` TO `users_handle_index`',
    ]);
  });

  it('drops timestamps and soft deletes', () => {
    expect(
      grammar.compileAlter(
        alterBlueprint('users', (table) => {
          table.dropTimestamps();
          table.dropSoftDeletes('archived_at');
        })
      )
    ).toEqual([
      'ALTER TABLE `users` DROP COLUMN `created_at`, DROP COLUMN `updated_at`',
      'ALTER TABLE `users` DROP COLUMN `archived_at`',
    ]);
  });

  it('says so when MySQL cannot modify a column', () => {
    const blueprint = new Blueprint('users');
    blueprint.string('name').change();

    expect(() => grammar.compileAlter(blueprint)).toThrow(/does not support modifying table columns/);
  });
});

describe('MySqlSchemaGrammar introspection', () => {
  it('scopes the catalog lookup to the current database', () => {
    expect(grammar.compileHasTable('users')).toBe(
      'SELECT `TABLE_NAME` AS `name` FROM `information_schema`.`TABLES` ' +
        "WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'users'"
    );

    expect(grammar.compileColumnListing('users')).toBe(
      'SELECT `COLUMN_NAME` AS `name` FROM `information_schema`.`COLUMNS` ' +
        "WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'users'"
    );
  });
});

describe('MySqlSchemaGrammar capabilities', () => {
  it('toggles constraint checking for the session', () => {
    expect(grammar.compileDisableForeignKeyConstraints()).toBe('SET FOREIGN_KEY_CHECKS=0');
    expect(grammar.compileEnableForeignKeyConstraints()).toBe('SET FOREIGN_KEY_CHECKS=1');
  });

  it('commits DDL implicitly, so migrations are not wrapped in a transaction', () => {
    expect(grammar.supportsSchemaTransactions()).toBe(false);
  });
});

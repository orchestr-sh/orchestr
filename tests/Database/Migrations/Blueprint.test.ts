/**
 * Blueprint tests
 *
 * The blueprint owns the fluent table definition: which columns and keys are
 * recorded, what the newer helpers register, and how a modification leaves the
 * added-column list. SQL text is asserted in the grammar suites.
 */

import { describe, expect, it } from 'vitest';
import { Blueprint } from '@/Database/Migrations/Blueprint';
import { ColumnDefinition } from '@/Database/Migrations/ColumnDefinition';

function blueprint(table = 'users'): Blueprint {
  return new Blueprint(table);
}

describe('Blueprint primary keys', () => {
  it('marks id(), bigIncrements() and increments() as primary keys', () => {
    const users = blueprint();
    users.id();
    users.bigIncrements('other_id');
    users.increments('plain_id');

    expect(users.columns.map((column) => [column.name, column.type, column.isPrimary, column.isAutoIncrement])).toEqual(
      [
        ['id', 'bigIncrements', true, true],
        ['other_id', 'bigIncrements', true, true],
        ['plain_id', 'increments', true, true],
      ]
    );
  });

  it('records an explicit primary key as a table level index', () => {
    const users = blueprint();
    users.primary(['tenant_id', 'email']);

    expect(users.indexes).toEqual([{ columns: ['tenant_id', 'email'], name: undefined, type: 'primary' }]);
  });
});

describe('Blueprint foreign keys', () => {
  it('creates an unsigned big integer column', () => {
    const posts = blueprint('posts');
    const column = posts.foreignId('user_id');

    expect(column).toBeInstanceOf(ColumnDefinition);
    expect(posts.columns).toEqual([column]);
    expect([column.name, column.type, column.isUnsigned]).toEqual(['user_id', 'bigInteger', true]);
  });

  it('derives the referenced table from the column name', () => {
    const posts = blueprint('posts');
    posts.foreignId('user_id').constrained();

    expect(posts.foreignKeys[0].columns).toEqual(['user_id']);
    expect(posts.foreignKeys[0].referencedTable).toBe('users');
    expect(posts.foreignKeys[0].referencedColumns).toEqual(['id']);
  });

  it('accepts an explicit table and column', () => {
    const posts = blueprint('posts');
    posts.foreignId('writer').constrained('authors', 'slug');

    expect([posts.foreignKeys[0].referencedTable, posts.foreignKeys[0].referencedColumns]).toEqual([
      'authors',
      ['slug'],
    ]);
  });

  it('names the column after a company with a consonant before the y', () => {
    const invoices = blueprint('invoices');
    invoices.foreignId('company_id').constrained();

    expect(invoices.foreignKeys[0].referencedTable).toBe('companies');
  });

  it('forwards the referential actions to the constraint', () => {
    const posts = blueprint('posts');
    posts.foreignId('user_id').constrained().cascadeOnDelete().restrictOnUpdate();

    expect([posts.foreignKeys[0].onDeleteAction, posts.foreignKeys[0].onUpdateAction]).toEqual(['cascade', 'restrict']);
  });

  it('refuses a referential action before the column is constrained', () => {
    const posts = blueprint('posts');

    expect(() => posts.foreignId('user_id').cascadeOnDelete()).toThrow(/before calling constrained/);
  });

  it('takes the table and key from a model class or instance', () => {
    class User {
      getTable() {
        return 'team_members';
      }
      getKeyName() {
        return 'uuid';
      }
      getForeignKey() {
        return 'member_id';
      }
    }

    const posts = blueprint('posts');
    posts.foreignIdFor(User);

    expect(posts.columns[0].name).toBe('member_id');
    expect([posts.foreignKeys[0].referencedTable, posts.foreignKeys[0].referencedColumns]).toEqual([
      'team_members',
      ['uuid'],
    ]);
  });

  it('falls back to the naming conventions for a plain name', () => {
    const posts = blueprint('posts');
    posts.foreignIdFor('AuthorProfile');

    expect(posts.columns[0].name).toBe('author_profile_id');
    expect(posts.foreignKeys[0].referencedTable).toBe('author_profiles');
    expect(posts.foreignKeys[0].referencedColumns).toEqual(['id']);
  });

  it('lets the caller name the column', () => {
    const posts = blueprint('posts');
    posts.foreignIdFor('User', 'owner_id');

    expect(posts.columns[0].name).toBe('owner_id');
    expect(posts.foreignKeys[0].referencedTable).toBe('users');
  });
});

describe('Blueprint morphs and identifiers', () => {
  it('adds the type and id pair', () => {
    const comments = blueprint('comments');
    comments.morphs('commentable');

    expect(comments.columns.map((column) => [column.name, column.type, column.isUnsigned])).toEqual([
      ['commentable_type', 'string', false],
      ['commentable_id', 'bigInteger', true],
    ]);
  });

  it('adds a nullable pair', () => {
    const comments = blueprint('comments');
    comments.nullableMorphs('authorable');

    expect(comments.columns.map((column) => column.isNullable)).toEqual([true, true]);
  });

  it('sizes a ulid column to 26 characters', () => {
    const orders = blueprint('orders');

    expect([orders.ulid('ulid').type, orders.columns[0].length]).toEqual(['ulid', 26]);
  });
});

describe('Blueprint drop and rename commands', () => {
  it('records column drops', () => {
    const users = blueprint();
    users.dropColumn('name');
    users.dropTimestamps();
    users.dropSoftDeletes();

    expect(users.commands).toEqual([
      { type: 'dropColumn', columns: ['name'] },
      { type: 'dropColumn', columns: ['created_at', 'updated_at'] },
      { type: 'dropColumn', columns: ['deleted_at'] },
    ]);
  });

  it('names a dropped key by columns or keeps the given name', () => {
    const users = blueprint();
    users.dropIndex(['email']);
    users.dropIndex('custom_index');
    users.dropUnique(['email']);
    users.dropForeign(['user_id']);
    users.dropPrimary();
    users.renameIndex('custom_index', 'better_index');

    expect(users.commands).toEqual([
      { type: 'dropIndex', columns: ['email'] },
      { type: 'dropIndex', name: 'custom_index' },
      { type: 'dropUnique', columns: ['email'] },
      { type: 'dropForeign', columns: ['user_id'] },
      { type: 'dropPrimary' },
      { type: 'renameIndex', name: 'custom_index', to: 'better_index' },
    ]);
  });

  it('drops one named timestamp column when asked', () => {
    const users = blueprint();
    users.dropTimestamps('published_at');

    expect(users.commands).toEqual([{ type: 'dropColumn', columns: ['published_at'] }]);
  });

  it('records column renames', () => {
    const users = blueprint();
    users.renameColumn('name', 'full_name');

    expect(users.commands).toEqual([{ type: 'renameColumn', from: 'name', to: 'full_name' }]);
  });
});

describe('Blueprint modifiers that describe table objects', () => {
  it('turns ->unique() and ->index() into index definitions', () => {
    const users = blueprint();
    users.string('email').unique();
    users.string('name').index('people_name_index');

    expect(users.indexes).toEqual([
      { columns: ['email'], name: undefined, type: 'unique' },
      { columns: ['name'], name: 'people_name_index', type: 'index' },
    ]);
  });

  it('leaves the definition detached when it has no blueprint', () => {
    const orphan = new ColumnDefinition('legacy', 'string');

    expect(() => orphan.change()).toThrow(/does not belong to a blueprint/);
    expect(() => orphan.unique()).not.toThrow();
  });

  it('moves a changed column out of the added-column list', () => {
    const users = blueprint();
    const column = users.string('name', 100).nullable().change();

    expect(users.columns).toEqual([]);
    expect(users.commands).toEqual([{ type: 'change', definitions: [column] }]);
  });

  it('accepts a list of columns to change', () => {
    const users = blueprint();
    const first = users.string('first_name');
    const last = users.string('last_name');

    first.nullable();
    users.change([first, last]);

    expect(users.columns).toEqual([]);
    expect(users.commands).toEqual([{ type: 'change', definitions: [first, last] }]);
  });
});

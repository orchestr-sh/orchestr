/**
 * Model factories against a real SQLite database
 *
 * The pure suite covers attribute generation; this one proves the behaviour
 * the ticket promises: create() persists, count(n) returns three models,
 * relationships wire foreign keys (`has()` children hang off their parent,
 * `for()` parents are created first), definitions can embed factories as
 * attribute values, and afterCreating fires once rows actually exist.
 *
 * better-sqlite3 is an optional dependency (and needs a native build), so
 * the integration suite only runs when the driver is actually installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FactoryAttributes } from '@/Database/Factories';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { Factory, Fake, registerFactory } from '@/Database/Factories';
import { fake } from '@/Support/helpers';
import { WITH_BETTER_SQLITE } from '../support';
import { DeterministicFake } from './support';

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    active INTEGER,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    published INTEGER,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE role_user (
    user_id INTEGER,
    role_id INTEGER
  );
`;

// ---------------------------------------------------------------------------
// Test models and factories
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static fillable: string[] = ['name', 'email'];

  posts() {
    return this.hasMany(Post, 'user_id');
  }

  roles() {
    return this.belongsToMany(Role);
  }
}

class Post extends Ensemble {
  static fillable: string[] = ['user_id', 'title'];

  user() {
    return this.belongsTo(User, 'user_id');
  }
}

class Role extends Ensemble {
  static fillable: string[] = ['name'];

  users() {
    return this.belongsToMany(User);
  }
}

class UserFactory extends Factory<User> {
  static model = User;

  definition(): FactoryAttributes {
    return { name: fake('name.fullName'), email: fake('internet.email'), active: false };
  }
}

class PostFactory extends Factory<Post> {
  static model = Post;

  definition(): FactoryAttributes {
    // Relationship defined inside the factory: each post gets a fresh user.
    return { user_id: User.factory(), title: fake('lorem.sentence'), published: false };
  }
}

class RoleFactory extends Factory<Role> {
  static model = Role;

  definition(): FactoryAttributes {
    return { name: fake('name.lastName') };
  }
}

registerFactory(UserFactory);
registerFactory(PostFactory);
registerFactory(RoleFactory);

describe.skipIf(!WITH_BETTER_SQLITE)('Model factories (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;

  beforeEach(async () => {
    Fake.use(new DeterministicFake());

    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    for (const statement of SCHEMA.split(';').filter((s) => s.trim() !== '')) {
      await adapter.query(statement);
    }

    const manager = new DatabaseManager({
      default: 'main',
      connections: {
        main: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' },
      },
    });
    manager.registerAdapter('drizzle', () => adapter);
    Ensemble.setConnectionResolver(manager);
  });

  afterEach(async () => {
    await adapter.disconnect();
    Fake.reset();
    Factory.configure().reset();
  });

  async function rowCount(table: string): Promise<number> {
    const rows = await adapter.select<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
    return rows[0].count;
  }

  async function column(table: string, col: string): Promise<any[]> {
    const rows = await adapter.select<Record<string, any>>(`SELECT ${col} FROM ${table} ORDER BY rowid`);
    return rows.map((row) => row[col]);
  }

  it('create() persists the model', async () => {
    const user = await User.factory().createOne();

    expect(user).toBeInstanceOf(User);
    expect(user.exists).toBe(true);
    expect(user.wasRecentlyCreated).toBe(true);
    expect(user.getKey()).toBeTruthy();
    expect(user.getAttribute('name')).toBe('Person 0');
    expect(await rowCount('users')).toBe(1);

    const stored = await adapter.select<{ name: string; email: string }>('SELECT name, email FROM users');
    expect(stored[0]).toEqual({ name: 'Person 0', email: 'person1@example.com' });
  });

  it('count(3).create() returns three persisted models', async () => {
    const users = (await User.factory().count(3).create()) as User[];

    expect(users).toHaveLength(3);
    expect(users.every((user) => user.exists)).toBe(true);
    expect(new Set(users.map((user) => user.getKey())).size).toBe(3);
    expect(await rowCount('users')).toBe(3);
  });

  it('create() arguments and states are persisted', async () => {
    const named = await User.factory().createOne({ name: 'Ada Lovelace' });
    const admin = await User.factory().state({ active: true }).createOne();

    expect(await column('users', 'name')).toEqual(['Ada Lovelace', 'Person 2']);
    expect(await column('users', 'active')).toEqual([0, 1]);
    expect(admin.exists).toBe(true);
  });

  it('sequences alternate values across persisted models', async () => {
    await User.factory()
      .count(4)
      .sequence([{ active: true }, { active: false }])
      .create();

    expect(await column('users', 'active')).toEqual([1, 0, 1, 0]);
  });

  it('make() does not touch the database', async () => {
    const users = await User.factory().count(2).make();

    expect((users as User[]).every((user) => !user.exists)).toBe(true);
    expect(await rowCount('users')).toBe(0);
  });

  it('createMany() persists a list', async () => {
    const users = await User.factory().createMany([{}, { name: 'Grace' }]);

    expect(users).toHaveLength(2);
    expect(await column('users', 'name')).toEqual(['Person 0', 'Grace']);
  });

  it('makeMany() builds unsaved models in bulk', async () => {
    const users = await User.factory().makeMany(2);

    expect(users).toHaveLength(2);
    expect(await rowCount('users')).toBe(0);
  });

  it('has() creates related models through a hasMany relationship', async () => {
    const user = (await User.factory().has(Post.factory().count(2)).create()) as User;

    expect(await rowCount('posts')).toBe(2);
    expect(await column('posts', 'user_id')).toEqual([user.getKey(), user.getKey()]);

    const relation = user.getRelation('posts') as EnsembleCollection<Post>;
    expect(relation).toBeInstanceOf(EnsembleCollection);
    expect(relation).toHaveLength(2);

    // And the posts really load through the relationship.
    const loaded = await user.posts().get();
    expect(loaded).toHaveLength(2);
  });

  it('has() accepts an explicit count and relationship name', async () => {
    await User.factory().has(Post.factory(), 3, 'posts').createOne();

    expect(await rowCount('posts')).toBe(3);
  });

  it('has() gives every parent in a batch its own children', async () => {
    const users = (await User.factory().count(2).has(Post.factory()).create()) as User[];

    expect(await rowCount('users')).toBe(2);
    expect(await rowCount('posts')).toBe(2);

    const rows = await adapter.select<{ user_id: number }>('SELECT user_id FROM posts ORDER BY id');
    expect(rows.map((row) => row.user_id)).toEqual(users.map((user) => user.getKey()));
  });

  it('has() attaches belongsToMany relationships through the pivot', async () => {
    const user = (await User.factory().has(Role.factory().count(2)).create()) as User;

    const attached = await adapter.select<{ user_id: number; role_id: number }>(
      'SELECT * FROM role_user ORDER BY role_id'
    );
    expect(attached).toHaveLength(2);
    expect(attached.every((row) => row.user_id === user.getKey())).toBe(true);
    expect(await rowCount('roles')).toBe(2);
  });

  it('for() creates the belongsTo parent and wires the foreign key', async () => {
    const post = (await Post.factory()
      .for(User.factory().state({ name: 'Jessica Archer' }))
      .create()) as Post;

    expect(await rowCount('users')).toBe(1);
    expect(await column('users', 'name')).toEqual(['Jessica Archer']);
    expect(post.getAttribute('title')).toBe('Sentence 0');

    const parent = post.getRelation('user') as User;
    expect(parent).toBeInstanceOf(User);

    const stored = await adapter.select<{ user_id: number }>('SELECT user_id FROM posts');
    expect(stored[0].user_id).toBe(parent.getKey());
  });

  it('for() shares one existing model instance across records', async () => {
    const user = await User.factory().createOne();
    const posts = (await Post.factory().count(2).for(user).create()) as Post[];

    expect(await rowCount('users')).toBe(1);
    expect(await rowCount('posts')).toBe(2);
    expect(await column('posts', 'user_id')).toEqual([user.getKey(), user.getKey()]);
    expect(posts.every((post) => post.getRelation('user') === user)).toBe(true);
  });

  it('creates for() parents even while only making models (Laravel parity)', async () => {
    const post = (await Post.factory().for(User.factory()).make()) as Post;

    expect(post.exists).toBe(false);
    expect(post.getAttribute('user_id')).toBeTruthy();
    expect(await rowCount('users')).toBe(1);
    expect(await rowCount('posts')).toBe(0);
  });

  it('factory values inside definitions create the related parent', async () => {
    const post = await Post.factory().createOne();

    expect(await rowCount('users')).toBe(1);
    expect(post.getAttribute('user_id')).toBe(Number((await column('users', 'id'))[0]));
  });

  it('afterCreating runs after persistence', async () => {
    const observed: Array<{ exists: boolean; key: any }> = [];

    const user = await User.factory()
      .has(Post.factory())
      .afterCreating(async (created) => {
        observed.push({ exists: created.exists, key: created.getKey() });

        // The database row is already there when the hook runs.
        const posts = await adapter.select<{ count: number }>('SELECT COUNT(*) as count FROM posts');
        expect(posts[0].count).toBe(1);
      })
      .createOne();

    expect(observed).toEqual([{ exists: true, key: user.getKey() }]);
  });

  it('the created parent is available to related factories via afterCreating', async () => {
    await User.factory()
      .afterCreating((user) => Post.factory().for(user).create())
      .createOne();

    expect(await rowCount('posts')).toBe(1);
    expect(await rowCount('users')).toBe(1);
  });

  it('Factory.configure() registers global afterCreating hooks', async () => {
    const created: string[] = [];

    Factory.configure((config) => {
      config.afterCreating((model) => created.push(`${model.constructor.name}`), User);
    });

    await User.factory().count(2).create();
    await Role.factory().createOne();

    expect(created).toEqual(['User', 'User']);
  });

  it('the factory passes mass assignment protection, like Laravel unguarding', async () => {
    // 'id' is not fillable on User, but factories still honour explicit keys.
    const user = await User.factory().state({ id: 99 }).createOne();

    expect(user.getKey()).toBe(99);
    expect(await rowCount('users')).toBe(1);
  });
});

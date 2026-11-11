/**
 * Model factory tests (no database)
 *
 * Covers the User -> UserFactory resolution convention, definitions, state
 * overrides, sequences, counts, make()/makeMany()/raw(), afterMaking and
 * configure() callbacks, and the fake adapter behind fake(). Persistence,
 * relationships and afterCreating run against real SQLite in
 * FactorySqlite.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FactoryAttributes } from '@/Database/Factories';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Factory, Fake, Sequence, registerFactory } from '@/Database/Factories';
import { factory, fake } from '@/Support/helpers';
import { DeterministicFake, FAKER_ABSENT } from './support';

// ---------------------------------------------------------------------------
// Test models and factories
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static fillable: string[] = ['name', 'email'];

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

class Post extends Ensemble {
  static fillable: string[] = ['title'];

  user() {
    return this.belongsTo(User, 'user_id');
  }
}

class UserFactory extends Factory<User> {
  static model = User;

  definition(): FactoryAttributes {
    return {
      name: fake('name.fullName'),
      email: fake('internet.email'),
      active: false,
      slug: (attributes: FactoryAttributes) => String(attributes.name).toLowerCase().replace(' ', '-'),
    };
  }
}

class PostFactory extends Factory<Post> {
  static model = Post;

  definition(): FactoryAttributes {
    return { title: fake('lorem.sentence'), published: false };
  }
}

registerFactory(UserFactory);
registerFactory(PostFactory);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Model factories', () => {
  let provider: DeterministicFake;

  beforeEach(() => {
    provider = new DeterministicFake();
    Fake.use(provider);
  });

  afterEach(() => {
    Fake.reset();
    Factory.configure().reset();
  });

  describe('resolution convention', () => {
    it('resolves the model factory by convention (User -> UserFactory)', () => {
      const userFactory = User.factory();

      expect(userFactory).toBeInstanceOf(UserFactory);
      expect(userFactory.modelName()).toBe('User');
    });

    it('the global factory() helper resolves through the same convention', () => {
      expect(factory(User)).toBeInstanceOf(UserFactory);
      expect(factory(User, 3).currentCount()).toBe(3);
      expect(factory(User, { active: true })).toBeInstanceOf(UserFactory);
    });

    it('Model.factory(count, state) seeds count and state', async () => {
      const users = (await User.factory(2, { active: true }).make()) as User[];

      expect(users).toHaveLength(2);
      expect(users.every((user) => user.getAttribute('active') === true)).toBe(true);
    });

    it('prefers a newFactory() override on the model', async () => {
      class Page extends Ensemble {
        static newFactory(): Factory<Page> {
          return new CustomPageFactory();
        }
      }

      class CustomPageFactory extends Factory<Page> {
        static model = Page;

        definition(): FactoryAttributes {
          return { title: 'Overridden' };
        }
      }

      const page = await Page.factory().makeOne();

      expect(page.getAttribute('title')).toBe('Overridden');
    });

    it('throws a helpful error when no factory is registered', () => {
      class Orphan extends Ensemble {}

      expect(() => Orphan.factory()).toThrow(/Unable to locate a factory for model \[Orphan\]/);
    });

    it('registerFactory requires the factory to know its model', () => {
      class BrokenFactory extends Factory<User> {
        definition(): FactoryAttributes {
          return {};
        }
      }

      expect(() => registerFactory(BrokenFactory)).toThrow(/static model/);
    });

    it('runs the configure() hook when the factory is constructed', async () => {
      class Account extends Ensemble {}

      class AccountFactory extends Factory<Account> {
        static model = Account;

        configure(): this {
          return this.afterMaking((account) => account.setAttribute('audited', true));
        }

        definition(): FactoryAttributes {
          return { label: 'primary' };
        }
      }

      registerFactory(AccountFactory);

      const account = await Account.factory().makeOne();

      expect(account.getAttribute('label')).toBe('primary');
      expect(account.getAttribute('audited')).toBe(true);
    });
  });

  describe('definitions and states', () => {
    it('make() returns an unsaved model with generated attributes', async () => {
      const user = await User.factory().makeOne();

      expect(user).toBeInstanceOf(User);
      expect(user.exists).toBe(false);
      expect(user.wasRecentlyCreated).toBe(false);
      expect(user.getAttribute('name')).toBe('Person 0');
      expect(user.getAttribute('email')).toBe('person1@example.com');
    });

    it('state() overrides the definition without touching other attributes', async () => {
      const user = await User.factory().state({ active: true }).makeOne();

      expect(user.getAttribute('active')).toBe(true);
      expect(user.getAttribute('name')).toBe('Person 0');
    });

    it('state() clones the factory so the base definition is untouched', async () => {
      const base = User.factory();
      const admin = base.state({ active: true });

      expect((await base.makeOne()).getAttribute('active')).toBe(false);
      expect((await admin.makeOne()).getAttribute('active')).toBe(true);
    });

    it('state closures receive the attributes built so far', async () => {
      const user = await User.factory()
        .state((attributes) => ({ email: `${attributes.name}@orchestr.test` }))
        .makeOne();

      expect(user.getAttribute('email')).toBe('Person 0@orchestr.test');
    });

    it('make() arguments apply as a state', async () => {
      const user = (await User.factory().make({ name: 'Ada Lovelace' })) as User;

      expect(user.getAttribute('name')).toBe('Ada Lovelace');
      expect(user.getAttribute('email')).toBe('person1@example.com');
    });

    it('supports named states', async () => {
      User.factory().state({ active: true }, 'promoted');

      const promoted = await User.factory().state('promoted').makeOne();
      expect(promoted.getAttribute('active')).toBe(true);

      expect(() => User.factory().state('unknown')).toThrow(/no state registered under the name \[unknown\]/);
    });

    it('resolves closure attributes against the evaluated definition', async () => {
      const user = await User.factory().makeOne();

      expect(user.getAttribute('slug')).toBe('person-0');
    });
  });

  describe('sequences', () => {
    it('sequence([...]) cycles values deterministically', async () => {
      const users = (await User.factory()
        .count(4)
        .sequence([{ active: true }, { active: false }])
        .make()) as User[];

      expect(users.map((user) => user.getAttribute('active'))).toEqual([true, false, true, false]);
    });

    it('sequence() accepts variadic items and closures with the index', async () => {
      const users = (await User.factory()
        .count(3)
        .sequence((sequence: Sequence) => ({ name: `Name ${sequence.index}` }))
        .make()) as User[];

      expect(users.map((user) => user.getAttribute('name'))).toEqual(['Name 0', 'Name 1', 'Name 2']);
    });

    it('a sequence requires at least one state', () => {
      expect(() => User.factory().sequence()).toThrow(/at least one state/);
    });
  });

  describe('counts', () => {
    it('count(3).make() returns three unsaved models', async () => {
      const users = await User.factory().count(3).make();

      expect(Array.isArray(users)).toBe(true);
      expect(users).toHaveLength(3);
      expect((users as User[]).map((user) => user.getAttribute('name'))).toEqual(['Person 0', 'Person 2', 'Person 4']);
    });

    it('count(0) makes no models', async () => {
      expect(await User.factory().count(0).make()).toEqual([]);
    });

    it('makeMany() accepts a count or per-record attributes', async () => {
      const byCount = await User.factory().makeMany(2);
      expect(byCount).toHaveLength(2);

      const byRecords = await User.factory().makeMany([{ name: 'A' }, { name: 'B', active: true }]);

      expect(byRecords).toHaveLength(2);
      expect(byRecords[0].getAttribute('name')).toBe('A');
      expect(byRecords[1].getAttribute('name')).toBe('B');
      expect(byRecords[1].getAttribute('active')).toBe(true);
      expect(byRecords[0].exists).toBe(false);
    });

    it('static times() counts upfront', () => {
      expect(UserFactory.times(2).currentCount()).toBe(2);
    });

    it('static new() applies attributes as initial state', async () => {
      const user = await UserFactory.new({ active: true }).makeOne();

      expect(user.getAttribute('active')).toBe(true);
    });
  });

  describe('raw attributes', () => {
    it('raw() returns plain attribute records without models', async () => {
      const attributes = (await User.factory().raw()) as FactoryAttributes;

      expect(attributes).not.toBeInstanceOf(Ensemble);
      expect(attributes.name).toBe('Person 0');
      expect(attributes.email).toBe('person1@example.com');
      expect(attributes.slug).toBe('person-0');
    });

    it('raw() with a count returns one record per model', async () => {
      const records = (await User.factory().count(2).raw()) as FactoryAttributes[];

      expect(Array.isArray(records)).toBe(true);
      expect(records).toHaveLength(2);
      expect(records.map((record) => record.name)).toEqual(['Person 0', 'Person 2']);
    });
  });

  describe('callbacks', () => {
    it('afterMaking runs on made models before they are saved', async () => {
      const seen: string[] = [];

      const user = await User.factory()
        .afterMaking((model) => {
          seen.push(model.getAttribute('name'));
          expect(model.exists).toBe(false);
          model.setAttribute('nickname', 'bestie');
        })
        .makeOne();

      expect(seen).toEqual(['Person 0']);
      expect(user.getAttribute('nickname')).toBe('bestie');
    });

    it('afterMaking runs once per model in a batch', async () => {
      let calls = 0;

      await User.factory()
        .count(3)
        .afterMaking(() => {
          calls++;
        })
        .make();

      expect(calls).toBe(3);
    });

    it('raw() does not run afterMaking callbacks', async () => {
      let calls = 0;

      await User.factory()
        .afterMaking(() => {
          calls++;
        })
        .raw();

      expect(calls).toBe(0);
    });

    it('Factory.configure() registers global hooks', async () => {
      const users: string[] = [];
      const posts: string[] = [];

      Factory.configure((config) => {
        config.afterMaking((model) => users.push(model.constructor.name), User);
        config.afterMaking((model) => posts.push(model.constructor.name), Post);
      });

      await User.factory().count(2).make();
      await Post.factory().makeOne();

      expect(users).toEqual(['User', 'User']);
      expect(posts).toEqual(['Post']);
    });
  });

  describe('fake adapter', () => {
    it('fake() returns the substituted generator', () => {
      expect(fake()).toBe(provider);
      expect(fake('name')).toBe(provider.name);
      expect(fake('name.fullName')).toBe('Person 0');
    });

    it('fake("namespace.method") calls with arguments', () => {
      expect(fake('lorem.words', 2)).toBe('word0 word1');
    });

    it('supports deterministic seeds: same seed, same values', () => {
      Fake.use(new DeterministicFake());
      Fake.seed(100);
      const first = [fake('name.fullName'), fake('internet.email')];

      Fake.use(new DeterministicFake());
      Fake.seed(100);
      const second = [fake('name.fullName'), fake('internet.email')];

      expect(second).toEqual(first);
      expect(first[0]).toBe('Person 100');
    });

    it('re-seeding moves the generator along', () => {
      Fake.seed(1);
      expect(fake('name.fullName')).toBe('Person 1');

      Fake.seed(50);
      expect(fake('name.fullName')).toBe('Person 50');
      expect(Fake.getSeed()).toBe(50);
    });

    it('Fake.use applies a previously stored seed', () => {
      Fake.seed(42);
      Fake.use(new DeterministicFake());

      expect(fake('name.fullName')).toBe('Person 42');
    });

    it('throws a clear installation message when nothing is available', () => {
      Fake.reset();

      expect(() => fake()).toThrow(/@faker-js\/faker/);
      expect(() => fake()).toThrow(/Fake\.use/);
    });

    it.skipIf(!FAKER_ABSENT)('absent peer dependency: fake() throws, never returns random data', async () => {
      Fake.reset();

      await expect(User.factory().make()).rejects.toThrow(/@faker-js\/faker/);
      await expect(Fake.load()).rejects.toThrow(/peer dependency/);

      Fake.use(new DeterministicFake());
      await expect(User.factory().make()).resolves.toBeInstanceOf(User);
    });

    it('factories with static definitions work without any generator', async () => {
      Fake.reset();

      class Note extends Ensemble {}

      class NoteFactory extends Factory<Note> {
        static model = Note;

        definition(): FactoryAttributes {
          return { body: 'no faker needed' };
        }
      }

      registerFactory(NoteFactory);

      const note = await Note.factory().makeOne();
      expect(note.getAttribute('body')).toBe('no faker needed');
    });
  });

  describe('relationship configuration (no persistence)', () => {
    it('has() infers the relationship name from the related model', () => {
      const withPosts = User.factory().has(Post.factory().count(2));

      expect(withPosts).toBeInstanceOf(UserFactory);
    });

    it('has() and for() accept explicit names and counts', () => {
      expect(User.factory().has(Post.factory(), 3, 'posts')).toBeInstanceOf(UserFactory);
      expect(Post.factory().for(User.factory(), 'author')).toBeInstanceOf(PostFactory);
    });
  });

  describe('Post factory basics', () => {
    it('posts are built from their own factory definition', async () => {
      const post = await Post.factory().makeOne();

      expect(post).toBeInstanceOf(Post);
      expect(post.getAttribute('title')).toBe('Sentence 0');
      expect(post.getAttribute('published')).toBe(false);
    });
  });
});

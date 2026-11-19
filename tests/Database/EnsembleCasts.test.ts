/**
 * Ensemble advanced attribute casting
 *
 * The ticket pins the behaviour the old `castAttribute` switch could not
 * reach: custom `CastsAttributes` classes round-tripping through hydration
 * and save, enums, encrypted and hashed writes, collection casts, decimal
 * precision, formatted dates, modern `Attribute` accessors alongside the
 * legacy `getXAttribute` pair, and dirty tracking that compares cast values
 * rather than stored bytes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import type { CastDefinition } from '@/Database/Ensemble/Casts';
import { DatabaseManager } from '@/Database/DatabaseManager';
import {
  ArrayObject,
  AsArrayObject,
  AsCollection,
  AsEncryptedCollection,
  AsEnumCollection,
  AsStringable,
  Attribute,
  CastRegistry,
} from '@/Database/Ensemble/Casts';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Encrypter } from '@/Encryption/Encrypter';
import { ScryptHasher } from '@/Hashing/ScryptHasher';
import { Collection } from '@/Support/Collection';
import { Stringable } from '@/Support/Stringable';
import type { ExecutedQuery } from './Query/support';
import { recordAdapter } from './Query/support';

const KEY = '0123456789abcdef0123456789ABCDEF';

/** Point every Ensemble query at a recording adapter and return the log. */
function useRecorder(results: Record<string, any> = {}): ExecutedQuery[] {
  const { adapter, queries } = recordAdapter(results);

  const manager = new DatabaseManager({
    default: 'test',
    connections: {
      test: { adapter: 'recording', driver: 'sqlite', database: ':memory:' },
    },
  });
  manager.registerAdapter('recording', () => adapter);
  Ensemble.setConnectionResolver(manager);

  return queries;
}

/** Mark a hydrated model as loaded, the way the builder's hydration does. */
function persisted<T extends Ensemble>(model: T): T {
  model.exists = true;
  (model as any).syncOriginal();

  return model;
}

// ---------------------------------------------------------------------------
// Application casts and enums
// ---------------------------------------------------------------------------

/** Dollars in, integer cents out: the custom get/set pair Laravel ships. */
class MoneyCentsCast implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    return typeof value === 'number' ? `$${(value / 100).toFixed(2)}` : value;
  }

  set(_model: any, _key: string, value: any): any {
    if (typeof value === 'string') {
      return Math.round(Number.parseFloat(value.replace('$', '')) * 100);
    }

    return value;
  }
}

/** Unregistered on purpose: `ensureCastsAreStringValues` must refuse it. */
class GhostCast implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    return value;
  }

  set(_model: any, _key: string, value: any): any {
    return value;
  }
}

enum TicketStatus {
  Open = 'open',
  Closed = 'closed',
}

enum Level {
  Entry = 1,
  Senior = 2,
}

CastRegistry.register('cents', MoneyCentsCast);
CastRegistry.registerEnum('TicketStatus', TicketStatus);
CastRegistry.registerEnum('Level', Level);

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

class Invoice extends Ensemble {
  static fillable: string[] = ['id', 'amount', 'fee'];
  static casts: Record<string, CastDefinition> = { amount: MoneyCentsCast };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'invoices';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

class Ticket extends Ensemble {
  static fillable: string[] = ['id', 'status', 'level'];
  static casts: Record<string, CastDefinition> = { status: 'enum:TicketStatus', level: 'enum:Level' };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'tickets';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

class Product extends Ensemble {
  static fillable: string[] = ['id', 'name', 'price'];
  static casts: Record<string, CastDefinition> = { name: 'string', price: 'decimal:2' };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'products';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

class Library extends Ensemble {
  static fillable: string[] = ['id', 'tags', 'options', 'bio', 'keys', 'flags', 'scores'];
  static casts: Record<string, CastDefinition> = {
    tags: AsCollection,
    options: 'AsArrayObject',
    bio: 'AsStringable',
    keys: new AsEncryptedCollection(),
    flags: 'AsEnumCollection:TicketStatus',
    scores: 'collection',
  };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'libraries';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

class Account extends Ensemble {
  static fillable: string[] = ['id', 'password', 'secret'];
  static casts: Record<string, CastDefinition> = { password: 'hashed', secret: 'encrypted' };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'accounts';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

class CalendarEvent extends Ensemble {
  static fillable: string[] = ['id', 'starts_at', 'ends_at', 'stamped_at', 'frozen_at'];
  static casts: Record<string, CastDefinition> = {
    starts_at: 'date:Y-m-d',
    ends_at: 'datetime',
    stamped_at: 'timestamp',
    frozen_at: 'immutable_date',
  };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'calendar_events';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

class Profile extends Ensemble {
  static fillable: string[] = ['id', 'first_name', 'last_name', 'full_name', 'label', 'tagline', 'nickname'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'profiles';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }

  /** Modern accessor: the method-return shape, `Attribute::make()`. */
  protected fullName(): Attribute {
    return Attribute.make(
      (value: any, attributes: Record<string, any>) =>
        value ?? `${attributes.first_name ?? ''} ${attributes.last_name ?? ''}`.trim(),
      (value: any) => String(value).toLowerCase()
    );
  }

  /** Modern accessor: the property shape. */
  label = Attribute.make({
    get: (value: any) => (value === null || value === undefined ? value : `[${value}]`),
    set: (value: any) => String(value).toUpperCase(),
  });

  /** Legacy pair, untouched by the modern accessors. */
  getTaglineAttribute(): string {
    return `~ ${(this as any).attributes['tagline'] ?? ''}`;
  }

  setTaglineAttribute(value: any): void {
    (this as any).attributes['tagline'] = String(value).trim();
  }

  /** Legacy get wins over the modern accessor when both exist (Laravel). */
  getNicknameAttribute(): string {
    return `legacy:${(this as any).attributes['nickname'] ?? ''}`;
  }

  protected nickname(): Attribute {
    return Attribute.make((value: any) => `modern:${value}`);
  }
}

class Memo extends Ensemble {
  static fillable: string[] = ['id', 'data'];
  static casts: Record<string, CastDefinition> = { data: 'json' };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'memos';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

class Draft extends Ensemble {
  static fillable: string[] = ['id', 'body', 'kind'];
  static casts: Record<string, CastDefinition> = { kind: TicketStatus };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'drafts';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ensemble custom casts', () => {
  let queries: ExecutedQuery[];

  beforeEach(() => {
    queries = useRecorder();
  });

  it('runs a custom CastsAttributes class through fill, reads and persistence', async () => {
    queries = useRecorder({ insert: 9 });

    const invoice = await Invoice.create({ amount: '$50.00' });

    // The stored shape goes to the database; the application shape reads back.
    expect(invoice.getRawAttributes().amount).toBe(5000);
    expect(invoice.getAttribute('amount')).toBe('$50.00');
    expect(queries.find((query) => query.method === 'insert')!.bindings).toContain(5000);

    queries = useRecorder({ select: [[{ id: 1, amount: 2500 }]], update: 1 });

    // Hydration reads the stored cents back through the same cast...
    const hydrated = persisted(new Invoice({ id: 1, amount: 2500 }, true));

    expect(hydrated.getAttribute('amount')).toBe('$25.00');

    // ...and the save writes the cast's set form into the bindings.
    hydrated.setAttribute('amount', '$30.00');

    expect(hydrated.getDirty()).toEqual({ amount: 3000 });

    await hydrated.save();

    const update = queries.find((query) => query.method === 'update');
    expect(update!.bindings).toContain(3000);
  });

  it('resolves registered cast names, mergeCasts and string-form casts', () => {
    const invoice = persisted(new Invoice({ id: 1 }, true));

    invoice.mergeCasts({ fee: MoneyCentsCast });

    // mergeCasts reduced the class entry to its registered name...
    expect(invoice.getCasts().fee).toBe('cents');

    invoice.setAttribute('fee', '$12.34');

    expect(invoice.getRawAttributes().fee).toBe(1234);
    expect(invoice.getAttribute('fee')).toBe('$12.34');
    expect(invoice.hasCast('fee')).toBe(true);
    expect(invoice.hasCast('id')).toBe(false);
  });

  it('keeps unknown cast strings as no-ops instead of corrupting values', () => {
    class WeirdCast extends Invoice {
      static casts: Record<string, CastDefinition> = { amount: 'not-a-real-cast' };
    }

    const invoice = persisted(new WeirdCast({ id: 1 }, true));
    invoice.setAttribute('amount', 'still a string');

    expect(invoice.getAttribute('amount')).toBe('still a string');
  });

  it('supports the { class, arguments } cast form', () => {
    class PrefixedCast implements CastsAttributes {
      constructor(public prefix: string = '#') {}

      get(_model: any, _key: string, value: any): any {
        return `${this.prefix}${value}`;
      }

      set(_model: any, _key: string, value: any): any {
        return String(value).replace(this.prefix, '');
      }
    }

    CastRegistry.register('prefixed', PrefixedCast);

    const invoice = persisted(new Invoice({ id: 1, amount: 100 }, true));
    invoice.mergeCasts({ label: { class: PrefixedCast, arguments: ['@'] } });

    (invoice as any).attributes['label'] = 'abc';

    expect(invoice.getAttribute('label')).toBe('@abc');
  });
});

describe('Ensemble enum casts', () => {
  let queries: ExecutedQuery[];

  beforeEach(() => {
    queries = useRecorder();
  });

  it('casts a string column to a TS enum value and back', async () => {
    queries = useRecorder({ insert: 4 });

    const ticket = await Ticket.create({ status: TicketStatus.Open });

    expect(ticket.getRawAttributes().status).toBe('open');
    expect(ticket.getAttribute('status')).toBe(TicketStatus.Open);
    expect(queries.find((query) => query.method === 'insert')!.bindings).toContain('open');

    const loaded = persisted(new Ticket({ id: 1, status: 'closed' }, true));

    expect(loaded.getAttribute('status')).toBe(TicketStatus.Closed);

    loaded.setAttribute('status', 'Open');

    expect(loaded.getRawAttributes().status).toBe('open');
  });

  it('maps numeric enums by value and by name', () => {
    const ticket = persisted(new Ticket({ id: 1, level: 2 }, true));

    expect(ticket.getAttribute('level')).toBe(Level.Senior);

    ticket.setAttribute('level', 'Entry');

    expect(ticket.getRawAttributes().level).toBe(1);
  });

  it('refuses values outside the enum', () => {
    const ticket = persisted(new Ticket({ id: 1 }, true));

    expect(() => ticket.setAttribute('status', 'ghost')).toThrow(/not a member/i);
  });

  it('accepts an enum object directly as the cast', () => {
    const draft = persisted(new Draft({ id: 1, kind: 'closed' }, true));

    expect(draft.getAttribute('kind')).toBe(TicketStatus.Closed);
    expect(draft.hasCast('kind', 'enum')).toBe(true);
  });

  it('resolves AsEnumCollection through the string argument form', () => {
    const library = persisted(new Library({ id: 1 }, true));

    library.setAttribute('flags', [TicketStatus.Open, 'Closed']);

    expect(library.getRawAttributes().flags).toBe(JSON.stringify(['open', 'closed']));
    expect(library.getAttribute('flags')).toBeInstanceOf(Collection);
    expect(library.getAttribute('flags').all()).toEqual(['open', 'closed']);
    expect(library.toObject().flags).toEqual(['open', 'closed']);
  });
});

describe('Ensemble collection casts', () => {
  beforeEach(() => {
    useRecorder();
  });

  it('AsCollection returns a Collection and serializes to an array', () => {
    const library = persisted(new Library({ id: 1 }, true));

    library.setAttribute('tags', ['php', 'ts']);

    expect(library.getRawAttributes().tags).toBe('["php","ts"]');

    const tags = library.getAttribute('tags');

    expect(tags).toBeInstanceOf(Collection);
    expect(tags.all()).toEqual(['php', 'ts']);
    expect(library.toObject().tags).toEqual(['php', 'ts']);

    // Hydration reads the same shape back from the stored JSON.
    const hydrated = persisted(new Library({ id: 2, tags: '["js"]' }, true));

    expect(hydrated.getAttribute('tags').all()).toEqual(['js']);
  });

  it('the plain collection string cast resolves to the same Collection behaviour', () => {
    const library = persisted(new Library({ id: 1, scores: '{"a":1}' }, true));

    expect(library.getAttribute('scores')).toBeInstanceOf(Collection);
    expect(library.getAttribute('scores').get('a')).toBe(1);
  });

  it('AsArrayObject reads and writes with array semantics', () => {
    const library = persisted(new Library({ id: 1 }, true));

    library.setAttribute('options', { theme: 'dark' });

    expect(library.getRawAttributes().options).toBe('{"theme":"dark"}');

    const options = library.getAttribute('options');

    expect(options).toBeInstanceOf(ArrayObject);
    expect(options.offsetGet('theme')).toBe('dark');

    // Mutating the cast result in memory is not a model write, exactly as
    // in Laravel; handing the object back through setAttribute is.
    options.offsetSet('layout', 'wide');

    expect(library.toObject().options).toEqual({ theme: 'dark' });

    library.setAttribute('options', options);

    expect(library.getRawAttributes().options).toBe('{"theme":"dark","layout":"wide"}');
    expect(library.toObject().options).toEqual({ theme: 'dark', layout: 'wide' });
  });

  it('AsStringable hands back a fluent Stringable and serializes to a string', () => {
    const library = persisted(new Library({ id: 1, bio: 'ada lovelace' }, true));

    expect(library.getAttribute('bio')).toBeInstanceOf(Stringable);
    expect(library.getAttribute('bio').upper().toString()).toBe('ADA LOVELACE');
    expect(library.toObject().bio).toBe('ada lovelace');
    expect(JSON.parse(JSON.stringify(library))).toMatchObject({ bio: 'ada lovelace' });
  });

  it('AsEncryptedCollection stores ciphertext per item and reads plaintext back', () => {
    const encrypter = new Encrypter(KEY);
    Ensemble.encryptUsing(encrypter);

    try {
      const library = persisted(new Library({ id: 1 }, true));

      library.setAttribute('keys', ['alpha', 'beta']);

      const stored = JSON.parse(library.getRawAttributes().keys);

      expect(stored).toHaveLength(2);
      expect(stored.join('')).not.toContain('alpha');
      expect(encrypter.decrypt(stored[0])).toBe('alpha');

      const keys = library.getAttribute('keys');

      expect(keys).toBeInstanceOf(Collection);
      expect(keys.all()).toEqual(['alpha', 'beta']);
      expect(library.toObject().keys).toEqual(['alpha', 'beta']);

      // Hydrated ciphertext decrypts through the same cast.
      const hydrated = new Library({ id: 2, keys: library.getRawAttributes().keys }, true);

      expect(hydrated.getAttribute('keys').all()).toEqual(['alpha', 'beta']);
    } finally {
      Ensemble.encryptUsing(null);
    }
  });
});

describe('Ensemble encrypted and hashed casts', () => {
  let encrypter: Encrypter;

  beforeEach(() => {
    useRecorder();
    encrypter = new Encrypter(KEY);
    Ensemble.encryptUsing(encrypter);
  });

  afterEach(() => {
    Ensemble.encryptUsing(null);
    Ensemble.hashUsing(null);
  });

  it('encrypted stores ciphertext and returns plaintext through the registry', () => {
    const written = new Account();
    written.setAttribute('secret', 'hunter2');

    expect(written.getRawAttributes().secret).not.toBe('hunter2');
    expect(encrypter.decrypt(written.getRawAttributes().secret)).toBe('hunter2');
    expect(written.getAttribute('secret')).toBe('hunter2');
    expect(written.toObject().secret).toBe('hunter2');

    // A hydrated ciphertext round-trips through the same cast.
    const hydrated = new Account({ id: 1, secret: written.getRawAttributes().secret }, true);

    expect(hydrated.getAttribute('secret')).toBe('hunter2');
  });

  it('hashed stores a hash, verifies it, and never re-hashes its own output', () => {
    const hasher = new ScryptHasher();
    Ensemble.hashUsing(hasher);

    const account = new Account();
    account.setAttribute('password', 'correct horse');

    const stored = account.getRawAttributes().password;

    expect(stored).not.toBe('correct horse');
    expect(hasher.check('correct horse', stored)).toBe(true);
    expect(account.getAttribute('password')).toBe(stored);

    // Setting the already-hashed value back must not salt it a second time.
    account.setAttribute('password', stored);

    expect(account.getRawAttributes().password).toBe(stored);

    // Re-saving the loaded hash must not mark it dirty, but a row whose
    // stored hash differs is dirty in its stored form.
    const loaded = persisted(new Account({ id: 1, password: stored }, true));
    loaded.setAttribute('password', stored);

    expect(loaded.isDirty('password')).toBe(false);

    loaded.setAttribute('password', 'another secret');

    expect(Object.keys(loaded.getDirty())).toContain('password');
    expect(hasher.check('another secret', loaded.getDirty().password)).toBe(true);
  });
});

describe('Ensemble decimal casts', () => {
  it('decimal:2 preserves precision in reads and writes', () => {
    const product = persisted(new Product({ id: 1, price: '10.5' }, true));

    expect(product.getAttribute('price')).toBe('10.50');
    expect(product.toObject().price).toBe('10.50');

    product.setAttribute('price', 99.999);

    // The stored form keeps the full precision; reads render two places.
    expect(product.getRawAttributes().price).toBe('99.999');
    expect(product.getAttribute('price')).toBe('100.00');
  });

  it('rounds the same rendered value to no change for dirty tracking', () => {
    const product = persisted(new Product({ id: 1, price: '10.5' }, true));

    product.setAttribute('price', '10.499');

    // 10.5 and 10.499 both render as 10.50: the cast values agree.
    expect(product.isDirty('price')).toBe(false);

    product.setAttribute('price', '11');

    expect(product.isDirty('price')).toBe(true);
    expect(product.getDirty().price).toBe('11');
  });
});

describe('Ensemble date casts', () => {
  beforeEach(() => {
    useRecorder();
  });

  it('date:format serializes with the declared format and parses on read', () => {
    const event = persisted(new CalendarEvent({ id: 1, starts_at: '2026-12-25 13:45:00' }, true));

    expect(event.getAttribute('starts_at')).toBeInstanceOf(Date);
    expect(event.toObject().starts_at).toBe('2026-12-25');

    event.setAttribute('starts_at', new Date('2027-01-01T23:30:00'));

    expect(event.getRawAttributes().starts_at).toBeInstanceOf(Date);
    expect(event.toObject().starts_at).toBe('2027-01-01');
  });

  it('plain datetime keeps handing back the Date object', () => {
    const event = persisted(new CalendarEvent({ id: 1, ends_at: '2026-12-25T18:00:00.000Z' }, true));

    expect(event.getAttribute('ends_at')).toBeInstanceOf(Date);
    expect((event.getAttribute('ends_at') as Date).toISOString()).toBe('2026-12-25T18:00:00.000Z');
    expect(event.toObject().ends_at).toBeInstanceOf(Date);
  });

  it('timestamp serializes to epoch seconds', () => {
    const event = persisted(new CalendarEvent({ id: 1, stamped_at: '2026-12-25T18:00:00.000Z' }, true));

    expect(event.getAttribute('stamped_at')).toBeInstanceOf(Date);
    expect(event.toObject().stamped_at).toBe(Math.floor(Date.parse('2026-12-25T18:00:00.000Z') / 1000));
  });

  it('immutable dates refuse mutation', () => {
    const event = persisted(new CalendarEvent({ id: 1, frozen_at: '2026-06-01 09:30:00' }, true));

    const frozen = event.getAttribute('frozen_at') as Date;

    expect(frozen).toBeInstanceOf(Date);
    // The date kind zeroes the clock, like Laravel's startOfDay.
    expect(frozen.getHours()).toBe(0);
    expect(() => frozen.setTime(0)).toThrow(/immutable/i);
  });
});

describe('Ensemble modern accessors', () => {
  beforeEach(() => {
    useRecorder();
  });

  it('Attribute.make accessors work as methods and as properties', () => {
    const profile = persisted(new Profile({ id: 1, first_name: 'Ada', last_name: 'Lovelace', full_name: null }, true));

    // The method form computes the value from sibling attributes.
    expect(profile.getAttribute('full_name')).toBe('Ada Lovelace');

    profile.setAttribute('full_name', 'Grace Hopper');

    expect(profile.getRawAttributes().full_name).toBe('grace hopper');

    // The property form: the set callback shapes the stored value, the get
    // callback reads it back from that stored shape.
    profile.setAttribute('label', 'analytical engine');

    expect(profile.getRawAttributes().label).toBe('ANALYTICAL ENGINE');
    expect(profile.getAttribute('label')).toBe('[ANALYTICAL ENGINE]');

    // toObject flows through the same accessors.
    expect(profile.toObject().label).toBe('[ANALYTICAL ENGINE]');
  });

  it('legacy getXAttribute/setXAttribute still own their attributes', () => {
    const profile = persisted(new Profile({ id: 1 }, true));

    profile.setAttribute('tagline', '  first programmer  ');

    expect(profile.getRawAttributes().tagline).toBe('first programmer');
    expect(profile.getAttribute('tagline')).toBe('~ first programmer');
  });

  it('legacy accessors win over modern ones on the same attribute', () => {
    const profile = persisted(new Profile({ id: 1, nickname: 'ada' }, true));

    expect(profile.getAttribute('nickname')).toBe('legacy:ada');
  });

  it('an accessor without a get callback falls through to the cast', () => {
    class Ledger extends Ensemble {
      static fillable: string[] = ['id', 'amount'];
      static casts: Record<string, CastDefinition> = { amount: 'decimal:2' };
      protected timestamps: boolean = false;

      getTable(): string {
        return 'ledgers';
      }

      getRawAttributes(): Record<string, any> {
        return this.attributes;
      }

      protected amount(): Attribute {
        return Attribute.make({ set: (value: any) => Number(value) * 100 });
      }
    }

    const ledger = persisted(new Ledger({ id: 1, amount: '1.05' }, true));

    // set multiplies; the decimal cast reads the stored value.
    expect(ledger.getAttribute('amount')).toBe('1.05');

    ledger.setAttribute('amount', 2);

    expect(ledger.getRawAttributes().amount).toBe(200);
    expect(ledger.getAttribute('amount')).toBe('200.00');
  });
});

describe('Ensemble dirty tracking with casts', () => {
  beforeEach(() => {
    useRecorder();
    Ensemble.encryptUsing(new Encrypter(KEY));
  });

  afterEach(() => {
    Ensemble.encryptUsing(null);
  });

  it('a JSON column rewritten key-for-key is not dirty', () => {
    const memo = persisted(new Memo({ id: 1, data: '{"a":1,"b":2}' }, true));

    memo.setAttribute('data', { b: 2, a: 1 });

    expect(memo.isDirty('data')).toBe(false);

    memo.setAttribute('data', { a: 1, b: 3 });

    expect(memo.isDirty('data')).toBe(true);
    expect(memo.getDirty().data).toBe('{"a":1,"b":3}');
  });

  it('encrypting the same plaintext again changes nothing', () => {
    const first = new Account();
    first.setAttribute('secret', 'same');

    const second = new Account();
    second.setAttribute('secret', 'same');

    // Two payloads, one plaintext: the cast values decide.
    expect(first.getRawAttributes().secret).not.toBe(second.getRawAttributes().secret);

    const account = persisted(new Account({ id: 1, secret: first.getRawAttributes().secret }, true));
    account.setAttribute('secret', 'same');

    expect(account.isDirty('secret')).toBe(false);

    account.setAttribute('secret', 'other');

    expect(account.isDirty('secret')).toBe(true);
  });

  it('enum and date casts compare application values, not stored bytes', () => {
    const ticket = persisted(new Ticket({ id: 1, status: 'open' }, true));

    ticket.setAttribute('status', TicketStatus.Open);

    expect(ticket.isDirty('status')).toBe(false);

    ticket.setAttribute('status', TicketStatus.Closed);

    expect(ticket.isDirty('status')).toBe(true);

    const event = persisted(new CalendarEvent({ id: 1, ends_at: '2026-12-25T18:00:00.000Z' }, true));

    event.setAttribute('ends_at', new Date('2026-12-25T18:00:00.000Z'));

    expect(event.isDirty('ends_at')).toBe(false);
  });
});

describe('Ensemble cast metadata', () => {
  it('getCasts merges static, instance and runtime entries with precedence', () => {
    class Layered extends Ensemble {
      static casts: Record<string, CastDefinition> = { a: 'int', b: 'json' };
      protected casts: Record<string, CastDefinition> = { b: 'string', c: 'bool' };
    }

    const model = new Layered();

    // static beats instance; instance entries survive where static is silent.
    expect(model.getCasts()).toEqual({ a: 'int', b: 'json', c: 'bool' });

    model.mergeCasts({ b: 'array' });

    expect(model.getCasts().b).toBe('array');

    expect(() => model.ensureCastsAreStringValues({ x: GhostCast })).toThrow(/registered/i);

    expect(model.ensureCastsAreStringValues({ y: 'decimal:3', z: TicketStatus })).toEqual({
      y: 'decimal:3',
      z: 'enum:TicketStatus',
    });
  });

  it('hasCast answers about base cast types', () => {
    class Casts extends Ensemble {
      static casts: Record<string, CastDefinition> = { born: 'date:Y-m-d', alive: 'bool', thing: 'no-such' };
    }

    const model = new Casts();

    expect(model.hasCast('born')).toBe(true);
    expect(model.hasCast('born', ['date', 'datetime'])).toBe(true);
    expect(model.hasCast('born', 'string')).toBe(false);
    expect(model.hasCast('alive', 'bool')).toBe(true);
    expect(model.hasCast('thing')).toBe(true);
    expect(model.hasCast('nothing')).toBe(false);
  });

  it('soft-deleting models cast their deleted-at column as a datetime', () => {
    class Ghost extends Ensemble {
      protected static softDeletes = true;
    }

    const ghost = new Ghost();

    expect(ghost.getCasts().deleted_at).toBe('datetime');
    expect(ghost.hasCast('deleted_at', 'datetime')).toBe(true);
  });
});

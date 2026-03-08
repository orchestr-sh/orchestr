/**
 * Ensemble model tests
 *
 * Covers the fillable/guarded behaviour including the subclass
 * initialisation-order bug where class field declarations on a subclass
 * run *after* the parent constructor, causing fill() to see only the
 * parent defaults (fillable=[], guarded=['*']) and therefore drop every
 * attribute silently.
 */

import { describe, it, expect } from 'vitest';
import { Ensemble } from '@/Database/Ensemble/Ensemble';

// ---------------------------------------------------------------------------
// Minimal connection stub so Ensemble instances can be constructed without a
// real database.  We only need the non-DB methods in these tests.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

/**
 * BUG DEMONSTRATION MODEL
 *
 * Uses the classic TypeScript class-field pattern.  Before the fix the
 * fillable field initialiser runs *after* super(), so fill() always sees
 * the parent defaults and every key is rejected.
 */
class InstanceFillableModel extends Ensemble {
  // Instance field – initialised after super() in JS runtime
  protected fillable: string[] = ['name', 'email'];
  // No DB needed for these tests; suppress timestamp logic
  protected timestamps: boolean = false;

  // Expose attributes for assertions
  getAttributes(): Record<string, any> {
    return (this as any).attributes;
  }
}

/**
 * FIXED PATTERN – static fillable
 *
 * Static properties are available on the constructor object before the
 * instance is created, so isFillable() can read them from
 * this.constructor regardless of when field initialisers run.
 */
class StaticFillableModel extends Ensemble {
  static fillable: string[] = ['name', 'email'];
  protected timestamps: boolean = false;

  getAttributes(): Record<string, any> {
    return (this as any).attributes;
  }
}

/**
 * Static guarded model – only 'admin' is guarded; everything else is fillable.
 */
class StaticGuardedModel extends Ensemble {
  static guarded: string[] = ['admin'];
  protected timestamps: boolean = false;

  getAttributes(): Record<string, any> {
    return (this as any).attributes;
  }
}

/**
 * Fully unguarded model – static guarded = [] means all keys are fillable.
 */
class UnguardedModel extends Ensemble {
  static guarded: string[] = [];
  protected timestamps: boolean = false;

  getAttributes(): Record<string, any> {
    return (this as any).attributes;
  }
}

/**
 * Static fillable + static guarded together.
 * fillable takes precedence when non-empty.
 */
class StaticBothModel extends Ensemble {
  static fillable: string[] = ['name'];
  static guarded: string[] = ['secret'];
  protected timestamps: boolean = false;

  getAttributes(): Record<string, any> {
    return (this as any).attributes;
  }
}

/**
 * Model with NO fillable/guarded overrides at all – inherits parent
 * defaults (fillable=[], guarded=['*']).  No attributes should be set
 * via fill().
 */
class DefaultGuardedModel extends Ensemble {
  protected timestamps: boolean = false;

  getAttributes(): Record<string, any> {
    return (this as any).attributes;
  }
}

/**
 * Model that uses the old constructor-workaround pattern that subclasses
 * previously needed.  Must continue to work after the fix so we don't
 * break existing code.
 */
class ConstructorWorkaroundModel extends Ensemble {
  protected fillable: string[] = [];
  protected timestamps: boolean = false;

  constructor(attrs: Record<string, any> = {}, fromDatabase: boolean = false) {
    super(attrs, fromDatabase);
    // Workaround: reset fillable then re-fill after super() initialises fields
    this.fillable = ['name', 'email'];
    if (!fromDatabase) {
      this.fill(attrs);
    }
  }

  getAttributes(): Record<string, any> {
    return (this as any).attributes;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ensemble – fillable / guarded', () => {
  // -------------------------------------------------------------------------
  // Bug demonstration (instance field pattern)
  // -------------------------------------------------------------------------
  describe('instance fillable class field (classic pattern)', () => {
    it('demonstrates the bug: attributes are empty when using instance field fillable', () => {
      // This test documents the EXISTING broken behaviour for instance fields.
      // After the fix is applied for static fields the instance field path
      // is untouched – we verify its (broken) behaviour is still consistent
      // so we know exactly what is and is not fixed.
      const model = new InstanceFillableModel({ name: 'Alice', email: 'alice@example.com' });
      const attrs = model.getAttributes();
      // With the bug: attributes are empty because fillable is [] when fill() runs
      // After the fix (static fields): this test still documents instance-field
      // behaviour – instance fields remain broken UNLESS the subclass also uses
      // a constructor workaround OR switches to static fields.
      expect(attrs).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Constructor workaround (backward-compat)
  // -------------------------------------------------------------------------
  describe('constructor workaround (existing models)', () => {
    it('still fills attributes correctly', () => {
      const model = new ConstructorWorkaroundModel({ name: 'Bob', email: 'bob@example.com' });
      expect(model.getAttributes()).toMatchObject({ name: 'Bob', email: 'bob@example.com' });
    });

    it('does not fill guarded attributes', () => {
      const model = new ConstructorWorkaroundModel({ name: 'Bob', password: 'secret' });
      expect(model.getAttributes()).toMatchObject({ name: 'Bob' });
      expect(model.getAttributes()).not.toHaveProperty('password');
    });
  });

  // -------------------------------------------------------------------------
  // Fix: static fillable
  // -------------------------------------------------------------------------
  describe('static fillable (fixed pattern)', () => {
    it('fills only fillable attributes via constructor', () => {
      const model = new StaticFillableModel({ name: 'Alice', email: 'alice@example.com', secret: 'x' });
      expect(model.getAttributes()).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
      expect(model.getAttributes()).not.toHaveProperty('secret');
    });

    it('constructor with no args produces empty attributes', () => {
      const model = new StaticFillableModel();
      expect(model.getAttributes()).toEqual({});
    });

    it('fill() called after construction still respects static fillable', () => {
      const model = new StaticFillableModel();
      model.fill({ name: 'Charlie', admin: true });
      expect(model.getAttributes()).toMatchObject({ name: 'Charlie' });
      expect(model.getAttributes()).not.toHaveProperty('admin');
    });

    it('setAttribute() bypasses fillable/guarded checks', () => {
      const model = new StaticFillableModel();
      model.setAttribute('secret', 'value');
      expect(model.getAttributes()).toMatchObject({ secret: 'value' });
    });
  });

  // -------------------------------------------------------------------------
  // Fix: static guarded
  // -------------------------------------------------------------------------
  describe('static guarded (fixed pattern)', () => {
    it('allows all non-guarded attributes', () => {
      const model = new StaticGuardedModel({ name: 'Dana', email: 'dana@example.com', admin: true });
      expect(model.getAttributes()).toMatchObject({ name: 'Dana', email: 'dana@example.com' });
      expect(model.getAttributes()).not.toHaveProperty('admin');
    });

    it("guarded=['*'] (parent default) blocks everything", () => {
      const model = new DefaultGuardedModel({ name: 'Eve' });
      expect(model.getAttributes()).toEqual({});
    });

    it('guarded=[] allows all attributes', () => {
      const model = new UnguardedModel({ name: 'Frank', email: 'frank@example.com', arbitrary: 42 });
      expect(model.getAttributes()).toMatchObject({ name: 'Frank', email: 'frank@example.com', arbitrary: 42 });
    });
  });

  // -------------------------------------------------------------------------
  // Fix: static fillable wins over static guarded when both are defined
  // -------------------------------------------------------------------------
  describe('static fillable takes precedence over static guarded', () => {
    it('only allows explicitly fillable keys even if not in guarded', () => {
      const model = new StaticBothModel({ name: 'Grace', email: 'grace@example.com', secret: 'x' });
      expect(model.getAttributes()).toMatchObject({ name: 'Grace' });
      expect(model.getAttributes()).not.toHaveProperty('email');
      expect(model.getAttributes()).not.toHaveProperty('secret');
    });
  });

  // -------------------------------------------------------------------------
  // isFillable() helper directly
  // -------------------------------------------------------------------------
  describe('isFillable()', () => {
    it('returns true for keys in static fillable', () => {
      const model = new StaticFillableModel();
      expect((model as any).isFillable('name')).toBe(true);
      expect((model as any).isFillable('email')).toBe(true);
    });

    it('returns false for keys not in static fillable', () => {
      const model = new StaticFillableModel();
      expect((model as any).isFillable('admin')).toBe(false);
    });

    it('returns false when guarded=["*"] (parent default) and fillable is empty', () => {
      const model = new DefaultGuardedModel();
      expect((model as any).isFillable('name')).toBe(false);
    });

    it('returns true for non-guarded keys when static guarded is a specific list', () => {
      const model = new StaticGuardedModel();
      expect((model as any).isFillable('name')).toBe(true);
      expect((model as any).isFillable('admin')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // setRawAttributes() always bypasses fillable (DB hydration path)
  // -------------------------------------------------------------------------
  describe('setRawAttributes() / fromDatabase hydration', () => {
    it('sets all attributes regardless of static fillable', () => {
      const model = new StaticFillableModel({ name: 'Hydrated', secret: 'value' }, true);
      expect(model.getAttributes()).toMatchObject({ name: 'Hydrated', secret: 'value' });
    });
  });
});

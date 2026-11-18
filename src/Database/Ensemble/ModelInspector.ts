/**
 * ModelInspector
 *
 * Reads the metadata `model:show` reports for an Ensemble model: the table it
 * lives in, its keys, attribute/cast declarations, and the relationships it
 * defines. Laravel gets this from PHP reflection over the model *and* the
 * database schema; this port works from the model's own declared surface
 * (fillable, casts, timestamps, and zero-argument relation methods), which
 * keeps the inspector free of schema introspection.
 *
 * Relation discovery calls each candidate method on a throwaway instance and
 * keeps the ones that answer with a Relation - exactly what Laravel's
 * reflection does, minus the type metadata TypeScript does not retain.
 * Methods that need a database connection (or any arguments) simply fail the
 * probe and are skipped.
 *
 * SRP: pure metadata extraction; resolving *which* class the user meant is
 * the command's business.
 */

import { CastRegistry } from './Casts';
import { Ensemble } from './Ensemble';
import { Relation } from './Relations/Relation';

export interface ModelAttributeInfo {
  name: string;
  /** Declared cast (`'json'`, `'boolean'`, ...) or null for none. */
  cast: string | null;
  fillable: boolean;
}

export interface ModelRelationInfo {
  name: string;
  /** Relation class (`HasMany`, `BelongsTo`, ...) */
  type: string;
  /** Related model class name */
  related: string;
}

export interface ModelMetadata {
  className: string;
  table: string;
  primaryKey: string;
  keyType: string;
  incrementing: boolean;
  timestamps: boolean;
  softDeletes: boolean;
  connection: string | null;
  attributes: ModelAttributeInfo[];
  relations: ModelRelationInfo[];
}

export class ModelInspector {
  /**
   * True when the value is a concrete Ensemble model class.
   */
  static isModelClass(value: unknown): value is new () => Ensemble {
    return (
      typeof value === 'function' &&
      value !== (Ensemble as unknown as Function) &&
      (value as any).prototype instanceof Ensemble
    );
  }

  /**
   * Collect the model's display metadata.
   */
  inspect(ModelClass: new () => Ensemble): ModelMetadata {
    const instance = new ModelClass();
    const anyClass = ModelClass as any;
    const anyInstance = instance as any;

    // Respect the same static-over-instance precedence Ensemble uses.
    const ownOrInstance = <T>(property: string, fallback: T): T =>
      Object.prototype.hasOwnProperty.call(anyClass, property)
        ? (anyClass[property] ?? fallback)
        : (anyInstance[property] ?? fallback);

    // Read the casts through the model itself, so the precedence Ensemble
    // uses - static over instance, runtime merges over declared - and the
    // display stay in one place. Entries that are not strings (cast classes,
    // instances, enums) are reduced to a name worth showing.
    const casts = this.displayCasts((instance as any).getCasts() ?? {});
    const fillable = (ownOrInstance<string[]>('fillable', []) ?? []) as string[];

    const attributes = this.attributeNames(
      instance,
      casts,
      fillable,
      anyClass.softDeletes === true
    ).map<ModelAttributeInfo>((name) => ({
      name,
      cast: casts[name] ?? null,
      fillable: fillable.includes(name) || fillable.length === 0,
    }));

    return {
      className: ModelClass.name,
      table: instance.getTable(),
      primaryKey: instance.getKeyName(),
      keyType: instance.getKeyType(),
      incrementing: anyInstance.incrementing !== false,
      timestamps: instance.getUpdatedAtColumn() !== null,
      softDeletes: anyClass.softDeletes === true,
      connection: anyInstance.connection ?? null,
      attributes,
      relations: this.detectRelations(instance),
    };
  }

  /**
   * Count the model's rows; null when the database is not reachable (the
   * command renders that as "unavailable" instead of failing).
   */
  async count(ModelClass: new () => Ensemble): Promise<number | null> {
    try {
      const builder = (ModelClass as any).query();
      return await builder.count();
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------- internals

  /**
   * Reduce casts-map entries to display strings: cast strings pass through,
   * classes and instances name themselves, argument forms fold into the
   * `name:arguments` shape, and bare enum objects report as `enum`.
   */
  private displayCasts(casts: Record<string, any>): Record<string, string> {
    const display: Record<string, string> = {};

    for (const [key, entry] of Object.entries(casts)) {
      display[key] = this.displayCast(entry);
    }

    return display;
  }

  private displayCast(entry: any): string {
    if (typeof entry === 'string') {
      return entry;
    }

    try {
      return CastRegistry.nameFor(entry);
    } catch {
      // Unregistered: name it the best way available.
    }

    if (typeof entry === 'function') {
      return entry.name;
    }

    if (entry && typeof entry.get === 'function') {
      return entry.constructor?.name ?? 'cast';
    }

    if (entry && 'class' in entry) {
      const form = entry as { class: any; arguments?: any[] };
      const name = typeof form.class === 'string' ? form.class : this.displayCast(form.class);

      return form.arguments && form.arguments.length > 0 ? `${name}:${form.arguments.join(',')}` : name;
    }

    return 'enum';
  }

  /**
   * The attributes worth listing: primary key, fillable list, cast map,
   * timestamps, and soft-delete column - unioned and sorted.
   */
  private attributeNames(
    instance: Ensemble,
    casts: Record<string, string>,
    fillable: string[],
    softDeletes: boolean
  ): string[] {
    const names = new Set<string>([instance.getKeyName(), ...fillable, ...Object.keys(casts)]);

    const createdAt = instance.getCreatedAtColumn();
    const updatedAt = instance.getUpdatedAtColumn();

    for (const column of [createdAt, updatedAt, softDeletes ? instance.getDeletedAtColumn() : null]) {
      if (typeof column === 'string' && column !== '') {
        names.add(column);
      }
    }

    return [...names].sort();
  }

  /**
   * Call every model-declared, zero-argument method and keep the ones that
   * return a Relation. Methods from Ensemble itself are never probed: the
   * scan stops at the base class.
   */
  private detectRelations(instance: Ensemble): ModelRelationInfo[] {
    const relations: ModelRelationInfo[] = [];

    for (const method of this.modelMethodNames(instance)) {
      try {
        const result = (instance as any)[method]();

        if (result instanceof Relation) {
          relations.push({
            name: method,
            type: result.constructor.name,
            related: result.getRelated().constructor.name,
          });
        }
      } catch {
        // Anything the inspector cannot invoke without arguments or a live
        // database is not reportable; skip it silently like Laravel's
        // reflection silently skips non-Relation methods.
      }
    }

    return relations;
  }

  private modelMethodNames(instance: Ensemble): string[] {
    const names = new Set<string>();

    let prototype: object | null = Object.getPrototypeOf(instance);

    while (prototype !== null && prototype !== Ensemble.prototype) {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key !== 'constructor' && typeof (instance as any)[key] === 'function') {
          names.add(key);
        }
      }

      prototype = Object.getPrototypeOf(prototype);
    }

    return [...names];
  }
}

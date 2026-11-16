/**
 * ModelShowCommand
 *
 * Display an Ensemble model's operational profile: table, attributes,
 * casts, relations, and the live row count. Mirrors Laravel's
 * `php artisan model:show <model>`.
 *
 * Resolution order matches how Laravel's container finds the model: an
 * explicit container binding wins, otherwise the class file is located in
 * `app/Models` (by class name or path) and imported. The metadata itself is
 * the ModelInspector's job; this command only resolves and renders.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { pathToFileURL } from 'url';
import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { ModelMetadata } from '@/Database/Ensemble/ModelInspector';
import { Command, CommandOptions } from '@/Console/Command';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelInspector } from '@/Database/Ensemble/ModelInspector';
import { Application } from '@/Foundation/Application';

const MODEL_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);

export class ModelShowCommand extends Command {
  signature = 'model:show {model : The model class name, container binding, or path}';
  description = 'Display information about the given model';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    await this.app.boot();

    const requested = String(args[0] ?? '');

    if (requested === '') {
      this.error('A model name is required.');
      return;
    }

    const ModelClass = await this.resolveModel(requested);

    if (ModelClass === null) {
      this.error(`Model [${requested}] could not be resolved from container bindings or [${this.app.path('Models')}].`);
      return;
    }

    const inspector = new ModelInspector();
    const metadata = inspector.inspect(ModelClass);
    const records = await inspector.count(ModelClass);

    this.info(`Model: ${ModelClass.name}`);
    this.renderInformation(metadata, records);
    this.renderAttributes(metadata);
    this.renderRelations(metadata);
  }

  // ----------------------------------------------------------- resolution

  /**
   * Find the model class: container binding first, then a file under
   * `app/Models` named after the class (or the given relative path).
   */
  private async resolveModel(requested: string): Promise<(new () => Ensemble) | null> {
    const fromContainer = this.fromContainer(requested);

    if (fromContainer !== null) {
      return fromContainer;
    }

    const className = this.classNameOf(requested);

    const explicitFile = this.findFile(requested);

    if (explicitFile !== null) {
      return this.classFromModule(explicitFile, className);
    }

    const directory = this.app.path('Models');

    for (const file of this.walk(directory)) {
      if (basename(file, extname(file)) === className && MODEL_EXTENSIONS.has(extname(file))) {
        return this.classFromModule(file, className);
      }
    }

    return null;
  }

  private fromContainer(requested: string): (new () => Ensemble) | null {
    if (!this.app.bound(requested)) {
      return null;
    }

    try {
      const value = this.app.make<unknown>(requested);

      if (value instanceof Ensemble) {
        return value.constructor as new () => Ensemble;
      }

      return ModelInspector.isModelClass(value) ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * `App\Models\User`, `app/Models/User.ts`, and `User` all name the class
   * `User`.
   */
  private classNameOf(requested: string): string {
    const segments = requested.replace(/\\/g, '/').split('/');
    const last = segments[segments.length - 1];

    return basename(last, extname(last));
  }

  /**
   * A path-style model reference that exists on disk verbatim.
   */
  private findFile(requested: string): string | null {
    const candidate = requested.replace(/\\/g, '/');

    if (!candidate.includes('/') || !MODEL_EXTENSIONS.has(extname(candidate))) {
      return null;
    }

    const absolute = candidate.startsWith('.') || candidate.startsWith('/') ? candidate : this.app.path(candidate);

    return existsSync(absolute) ? absolute : null;
  }

  private async classFromModule(file: string, className: string): Promise<(new () => Ensemble) | null> {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;

    const candidates = [module.default, module[className], ...Object.values(module)];

    for (const candidate of candidates) {
      if (ModelInspector.isModelClass(candidate) && candidate.name === className) {
        return candidate;
      }
    }

    return null;
  }

  private *walk(dir: string): Generator<string> {
    let entries: string[];

    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries.sort()) {
      const full = join(dir, entry);

      let isDirectory = false;

      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }

      if (isDirectory) {
        yield* this.walk(full);
      } else {
        yield full;
      }
    }
  }

  // -------------------------------------------------------------- rendering

  private renderInformation(metadata: ModelMetadata, records: number | null): void {
    const connection =
      metadata.connection ??
      (this.app.bound('db') ? this.app.make<DatabaseManager>('db').getDefaultConnection() : 'default');

    this.newLine();
    this.comment('Information');
    this.newLine();

    const rows: Array<[string, string]> = [
      ['Table', metadata.table],
      ['Connection', connection],
      ['Primary Key', `${metadata.primaryKey} (${metadata.keyType}${metadata.incrementing ? ', incremental' : ''})`],
      ['Timestamps', metadata.timestamps ? 'yes' : 'no'],
      ['Soft Deletes', metadata.softDeletes ? 'yes' : 'no'],
      ['Records', records === null ? 'unavailable' : String(records)],
    ];

    this.table(['Key', 'Value'], rows);
  }

  private renderAttributes(metadata: ModelMetadata): void {
    this.newLine();
    this.comment(`Attributes (${metadata.attributes.length})`);
    this.newLine();

    this.table(
      ['Attribute', 'Cast', 'Fillable'],
      metadata.attributes.map((attribute) => [attribute.name, attribute.cast ?? '-', attribute.fillable ? 'yes' : 'no'])
    );
  }

  private renderRelations(metadata: ModelMetadata): void {
    this.newLine();
    this.comment(`Relations (${metadata.relations.length})`);
    this.newLine();

    if (metadata.relations.length === 0) {
      this.comment('This model does not define any relationships.');
      return;
    }

    this.table(
      ['Relation', 'Type', 'Related'],
      metadata.relations.map((relation) => [relation.name, relation.type, relation.related])
    );
  }
}

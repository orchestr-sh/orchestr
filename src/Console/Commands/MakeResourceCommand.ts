/**
 * MakeResourceCommand
 *
 * Create a new JSON resource class. `--collection` switches to the
 * collection stub - the same one `make:collection` (the subclass in
 * MakeCollectionCommand) renders by default - so the collection
 * placeholders live here once (DRY).
 * Mirrors Laravel's `php artisan make:resource`.
 */

import { existsSync } from 'fs';
import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeResourceCommand extends GeneratorCommand {
  signature = 'make:resource {name} {--collection} {--force}';
  description = 'Create a new resource class';

  protected artifact = 'Resource';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return this.collectionWanted(options) ? 'collection' : 'resource';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Http/Resources');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    return this.collectionWanted(options) ? this.collectionReplacements(context) : {};
  }

  protected collectionWanted(options: CommandOptions): boolean {
    return this.flag(options, 'collection');
  }

  /**
   * Wire a collection to the resource named after it: `PostCollection`
   * maps to `PostResource`, names that already end in `Resource` map to
   * themselves, and anything else gains the suffix. When that sibling file
   * exists the import and the `collects` declaration go in proper;
   * otherwise they stay commented so the generated code still compiles.
   */
  private collectionReplacements(context: GeneratorContext): StubReplacements {
    const resource = this.resourceName(context.className);

    const resourcePath = `${context.directory}/${resource}.ts`;

    if (!existsSync(resourcePath)) {
      return {
        resource,
        resource_import: `// import { ${resource} } from './${resource}';`,
        collects: `// protected static collects = ${resource};`,
      };
    }

    return {
      resource,
      resource_import: `import { ${resource} } from './${resource}';`,
      collects: `protected static collects = ${resource};`,
    };
  }

  private resourceName(className: string): string {
    if (className.endsWith('Resource')) {
      return className;
    }

    if (className.endsWith('Collection')) {
      return `${className.slice(0, -'Collection'.length)}Resource`;
    }

    return `${className}Resource`;
  }
}

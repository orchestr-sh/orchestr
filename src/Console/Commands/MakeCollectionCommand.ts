/**
 * MakeCollectionCommand
 *
 * Create a new resource collection class - `make:resource --collection`
 * with the flag pre-set, so the collection logic stays in one command
 * (DRY).
 * Mirrors Laravel's `php artisan make:collection`.
 */

import { CommandOptions } from '@/Console/Command';
import { MakeResourceCommand } from './MakeResourceCommand';

export class MakeCollectionCommand extends MakeResourceCommand {
  signature = 'make:collection {name} {--force}';
  description = 'Create a new resource collection class';

  protected artifact = 'Collection';

  protected collectionWanted(_options: CommandOptions): boolean {
    return true;
  }
}

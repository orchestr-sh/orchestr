/**
 * Resource collection stub. `{{ resource_import }}` and `{{ collects }}`
 * wire the collection to its sibling resource when that file exists;
 * otherwise they stay commented so the generated code always compiles.
 *
 * Laravel: Illuminate\Foundation\Console\CollectionMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { ResourceCollection } from '@orchestr-sh/orchestr';

{{ resource_import }}

export class {{ class }} extends ResourceCollection {
  /**
   * The resource each item is wrapped in.
   * Laravel: ResourceCollection::$collects
   */
  {{ collects }}
}
`;

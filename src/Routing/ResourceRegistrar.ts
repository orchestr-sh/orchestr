import { Str } from '@/Support/Str';
import { HttpMethod } from './Route';

/**
 * The seven conventional resource controller actions
 * Laravel: Illuminate\Routing\ResourceRegistrar::$resourceMethods
 */
export type ResourceActionName = 'index' | 'create' | 'store' | 'show' | 'edit' | 'update' | 'destroy';

/**
 * Options accepted by Route::resource / Route::apiResource
 */
export interface ResourceOptions {
  /** Register only these actions */
  only?: ResourceActionName | ResourceActionName[];
  /** Register every action except these */
  except?: ResourceActionName | ResourceActionName[];
  /**
   * Either a replacement for the resource portion of every name
   * (`'admins'` => `admins.index`) or a map of custom action segments
   * (`{ index: 'members' }` => `users.members`)
   */
  names?: string | Partial<Record<ResourceActionName, string>>;
  /**
   * Custom parameter names keyed by the singular segment name
   * (`{ user: 'uuid' }` => `/users/:uuid`)
   */
  parameters?: Record<string, string>;
  /**
   * Serve the item routes off the child URI only, dropping parent segments
   * (meaningful on nested resources such as `users.posts`)
   */
  shallow?: boolean;
}

/**
 * A single route produced by resource registration
 */
export interface ResourceRouteDefinition {
  methods: HttpMethod[];
  uri: string;
  action: ResourceActionName;
  name: string;
}

interface ResourceActionDefinition {
  action: ResourceActionName;
  methods: HttpMethod[];
  /** Collection routes hang off `/resource`, item routes off `/resource/:param` */
  level: 'collection' | 'item';
  /** Path appended after the collection or item base */
  suffix: string;
  /** Whether the action belongs to apiResource */
  apiSafe: boolean;
}

/**
 * The single route-definition table every resource route is generated from.
 * Laravel: ResourceRegistrar::getResourceRoutes()
 */
const RESOURCE_ACTIONS: readonly ResourceActionDefinition[] = [
  { action: 'index', methods: ['GET'], level: 'collection', suffix: '', apiSafe: true },
  { action: 'create', methods: ['GET'], level: 'collection', suffix: '/create', apiSafe: false },
  { action: 'store', methods: ['POST'], level: 'collection', suffix: '', apiSafe: true },
  { action: 'show', methods: ['GET'], level: 'item', suffix: '', apiSafe: true },
  { action: 'edit', methods: ['GET'], level: 'item', suffix: '/edit', apiSafe: false },
  { action: 'update', methods: ['PUT', 'PATCH'], level: 'item', suffix: '', apiSafe: true },
  { action: 'destroy', methods: ['DELETE'], level: 'item', suffix: '', apiSafe: true },
];

function toActionSet(
  value: ResourceActionName | ResourceActionName[] | undefined,
  option: string
): Set<ResourceActionName> | null {
  if (value === undefined) {
    return null;
  }

  const list = Array.isArray(value) ? value : [value];
  const known = new Set<ResourceActionName>(RESOURCE_ACTIONS.map((definition) => definition.action));

  for (const action of list) {
    if (!known.has(action)) {
      throw new Error(`Invalid resource action [${action}] in [${option}].`);
    }
  }

  return new Set(list);
}

/**
 * Build the route definitions for a resource without touching the Router -
 * the Router registers each definition through its normal (group-aware)
 * addRoute pipeline.
 */
export function buildResourceRoutes(
  resource: string,
  options: ResourceOptions = {},
  api: boolean = false
): ResourceRouteDefinition[] {
  const segments = resource.split('.');
  const parents = segments.slice(0, -1);
  const child = segments[segments.length - 1];
  const parameters = options.parameters ?? {};

  if (segments.length === 0 || segments.some((segment) => segment === '')) {
    throw new Error(`Invalid resource name [${resource}].`);
  }

  const parameterFor = (segment: string): string => {
    const singular = Str.singular(segment);
    return parameters[singular] ?? singular;
  };

  const childParameter = parameterFor(child);

  // /users/:user/posts
  const collectionBase = '/' + [...parents.flatMap((parent) => [parent, `:${parameterFor(parent)}`]), child].join('/');

  // Shallow item routes drop the parent segments: /posts/:post
  const itemBase =
    options.shallow && parents.length > 0 ? `/${child}/:${childParameter}` : `${collectionBase}/:${childParameter}`;

  const only = toActionSet(options.only, 'only');
  const except = toActionSet(options.except, 'except');
  const customNames = typeof options.names === 'string' ? null : options.names;
  const namePrefix = typeof options.names === 'string' ? options.names : resource;

  const definitions: ResourceRouteDefinition[] = [];

  for (const definition of RESOURCE_ACTIONS) {
    if (api && !definition.apiSafe) {
      continue;
    }

    if (only && !only.has(definition.action)) {
      continue;
    }

    if (except && except.has(definition.action)) {
      continue;
    }

    const custom = customNames ? customNames[definition.action] : undefined;
    const name =
      custom === undefined
        ? `${namePrefix}.${definition.action}`
        : custom.includes('.')
          ? custom
          : `${namePrefix}.${custom}`;

    const base = definition.level === 'collection' ? collectionBase : itemBase;

    definitions.push({
      methods: [...definition.methods],
      uri: base + definition.suffix,
      action: definition.action,
      name,
    });
  }

  return definitions;
}

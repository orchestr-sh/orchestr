/**
 * HasAttributes Concern
 *
 * Provides attribute handling functionality for models
 */

import type { CastDefinition } from '../Casts';

export interface HasAttributes {
  /**
   * The model's attributes
   */
  attributes: Record<string, any>;

  /**
   * The model's original attributes
   */
  original: Record<string, any>;

  /**
   * The attributes that should be cast. Values are cast strings
   * (`'int'`, `'decimal:2'`, `'enum:Status'`), cast classes or instances,
   * `{ class, arguments }` objects, or TypeScript enum objects.
   */
  casts: Record<string, CastDefinition>;

  /**
   * The attributes that should be hidden
   */
  hidden: string[];

  /**
   * The attributes that should be visible
   */
  visible: string[];

  /**
   * The accessors to append
   */
  appends: string[];
}

/**
 * Cast types supported by the model, as the base name of a casts-map
 * entry. Anything beyond these is a registered cast class resolved by
 * name through the CastRegistry.
 */
export type CastType =
  | 'int'
  | 'integer'
  | 'real'
  | 'float'
  | 'double'
  | 'decimal'
  | 'string'
  | 'bool'
  | 'boolean'
  | 'object'
  | 'array'
  | 'json'
  | 'collection'
  | 'date'
  | 'datetime'
  | 'immutable_date'
  | 'immutable_datetime'
  | 'timestamp'
  | 'encrypted'
  | 'hashed'
  | 'enum';

/**
 * Attribute mutator function type
 */
export type AttributeMutator = (value: any) => void;

/**
 * Attribute accessor function type
 */
export type AttributeAccessor = () => any;

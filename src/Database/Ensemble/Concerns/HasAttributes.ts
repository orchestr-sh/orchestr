/**
 * HasAttributes Concern
 *
 * Provides attribute handling functionality for models
 */

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
   * The attributes that should be cast
   */
  casts: Record<string, string>;

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
 * Cast types supported by the model
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
  | 'timestamp'
  | 'encrypted';

/**
 * Attribute mutator function type
 */
export type AttributeMutator = (value: any) => void;

/**
 * Attribute accessor function type
 */
export type AttributeAccessor = () => any;

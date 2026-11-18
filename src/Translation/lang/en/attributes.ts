/**
 * Default English attribute names
 * lang/en/attributes.ts
 *
 * The human-readable names validation messages interpolate for
 * `:attribute` (keyed by field name, `first_name` -> "First name").
 * Laravel keeps these under validation.php's `attributes` array; this
 * port ships them as their own group so the Validator resolves
 * `attributes.{field}` before falling back to the underscore-split field
 * name. The published defaults are empty - fill in the names your forms
 * should use.
 */

export const defaultAttributeLines: Record<string, string> = {};

export default defaultAttributeLines;

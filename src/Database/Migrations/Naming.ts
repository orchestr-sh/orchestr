/**
 * Naming Conventions
 *
 * The identifier conventions migrations follow when a name has to be derived
 * rather than given: a model class to a table name, a column to the table it
 * references. Shared by the blueprint and the foreign key column definition so
 * both spell a derived name the same way.
 */

/**
 * `BlogPost` to `blog_post`.
 */
export function snakeCase(value: string): string {
  return value
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, '_')
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, '_')
    .toLowerCase();
}

/**
 * `user` to `users`, `company` to `companies`, `address` to `addresses`.
 */
export function pluralize(value: string): string {
  if (/[^aeiou]y$/.test(value)) {
    return `${value.slice(0, -1)}ies`;
  }

  if (/(?:s|x|z|ch|sh)$/.test(value)) {
    return `${value}es`;
  }

  return `${value}s`;
}

/**
 * Trait stub - TypeScript has no traits, so generated traits follow the
 * mixin pattern the framework itself uses for concerns such as
 * HandlesAuthorization: a function that wraps a base class and returns
 * the extended abstraction.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

export function {{ class }}(Base: abstract new (...args: any[]) => any = class {}) {
  abstract class {{ class }}Mixin extends Base {
    // Example: greet(name: string): string { return \`Hi \${name}\`; }
  }

  return {{ class }}Mixin;
}
`;

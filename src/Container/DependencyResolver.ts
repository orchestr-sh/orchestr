import type { Container } from './Container';
import type { ParameterDescriptor } from './ParameterReflector';
import type { Abstract, ParameterOverrides } from './types';
import { isResolvableType } from './ParameterReflector';

/**
 * Resolves one callable/constructor argument list - the single pipeline
 * every injection path shares: `build`, contextual bindings, tags, and
 * `call()` all arrive here.
 *
 * Precedence per parameter mirrors Laravel's `resolveDependencies`:
 *
 * 1. explicit override - positional (array) or by name (record)
 * 2. contextual binding - classes by type, primitives by `'$name'`
 * 3. class-typed dependencies resolve through `Container.make`, where the
 *    contextual registry and normal bindings apply
 * 4. default values (passing `undefined` lets the declaration fill in)
 * 5. the unresolvable-primitive error for reflected primitives
 */
export class DependencyResolver {
  constructor(private container: Container) {}

  /**
   * Resolve a full argument list for a reflected signature.
   *
   * Explicitly provided positional parameters extend the reflected arity
   * (and can substitute it entirely when metadata is absent), so callers
   * such as console command discovery can hand a class its `Application`
   * even when decorators were not compiled. Named overrides only extend
   * arity for parameters whose name was actually reflected.
   */
  resolveArguments(
    descriptors: ParameterDescriptor[],
    overrides: ParameterOverrides = [],
    label: string = 'callable'
  ): any[] {
    const positionalCount = Array.isArray(overrides) ? overrides.length : 0;
    const namedCount = Array.isArray(overrides) ? 0 : this.countNamedMatches(descriptors, overrides);

    const count = Math.max(
      // Reflected *types* keep the historical arity floor: a class whose
      // decorators were not compiled still receives no dependencies.
      this.reflectedTypeCount(descriptors),
      positionalCount,
      namedCount
    );

    const args: any[] = [];

    for (let index = 0; index < count; index++) {
      const value = this.resolveArgument(index, descriptors[index], overrides, label);

      // Rest parameters collect their resolved values, Laravel's
      // variadic merge: the array expands into the call itself.
      if (descriptors[index]?.variadic && Array.isArray(value)) {
        args.push(...value);
      } else {
        args.push(value);
      }
    }

    return args;
  }

  private reflectedTypeCount(descriptors: ParameterDescriptor[]): number {
    return descriptors.reduce((count, descriptor) => (descriptor.reflected ? count + 1 : count), 0);
  }

  private countNamedMatches(descriptors: ParameterDescriptor[], overrides: Record<string, any>): number {
    let count = 0;

    descriptors.forEach((descriptor, index) => {
      if (descriptor.name !== undefined && Object.prototype.hasOwnProperty.call(overrides, descriptor.name)) {
        count = Math.max(count, index + 1);
      }
    });

    return count;
  }

  private resolveArgument(
    index: number,
    descriptor: ParameterDescriptor | undefined,
    overrides: ParameterOverrides,
    label: string
  ): any {
    const explicit = this.overrideFor(index, descriptor, overrides);

    if (explicit.found) {
      return explicit.value;
    }

    if (descriptor?.variadic) {
      // Rest parameters collect any further positional overrides; without
      // them the call receives no extra arguments.
      return Array.isArray(overrides) ? overrides.slice(index).filter((value) => value !== undefined) : [];
    }

    if (descriptor !== undefined && isResolvableType(descriptor.type)) {
      return this.resolveClassDependency(descriptor, descriptor.type);
    }

    // Contextual primitives: when(X).needs('$threshold').give(5) - only
    // consulted for parameters the container cannot build by type.
    const contextualPrimitive =
      descriptor?.name !== undefined ? this.container.findContextualBinding(`$${descriptor.name}`) : undefined;

    if (contextualPrimitive !== undefined) {
      return this.container.unwrapContextualImplementation(contextualPrimitive);
    }

    // Reflected `Object`/primitive hints and untyped parameters alike:
    // defaults let the declaration fill the argument in itself.
    if (descriptor?.hasDefault) {
      return undefined;
    }

    // Untyped parameters that TypeScript never reflected (decorators off)
    // stay undefined, exactly like the historical autowiring behaviour -
    // the error below is reserved for what metadata says is a primitive.
    if (descriptor === undefined || !descriptor.reflected) {
      return undefined;
    }

    throw new Error(
      `Cannot resolve dependency at position ${index} for ${label}. ` +
        `Make sure TypeScript decorators are enabled and the class has proper type hints.`
    );
  }

  /**
   * Positional overrides address constructor/call arguments by index -
   * the historical `make(abstract, [app])` convention - while record
   * overrides address the parameter by name.
   */
  private overrideFor(
    index: number,
    descriptor: ParameterDescriptor | undefined,
    overrides: ParameterOverrides
  ): { found: boolean; value?: any } {
    if (Array.isArray(overrides)) {
      return overrides[index] !== undefined ? { found: true, value: overrides[index] } : { found: false };
    }

    if (descriptor?.name !== undefined && Object.prototype.hasOwnProperty.call(overrides, descriptor.name)) {
      return { found: true, value: overrides[descriptor.name] };
    }

    return { found: false };
  }

  private resolveClassDependency(
    descriptor: ParameterDescriptor,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    type: Function
  ): any {
    // A declared default wins when nothing is bound for the type and no
    // contextual rule substitutes it: Laravel refuses to override the
    // developer's own default with an autowired instance.
    if (descriptor.hasDefault && !this.container.bound(type) && this.findContextual(type) === undefined) {
      return undefined;
    }

    return this.container.make(type);
  }

  private findContextual(dependency: Abstract): any {
    return this.container.findContextualBinding(dependency);
  }
}

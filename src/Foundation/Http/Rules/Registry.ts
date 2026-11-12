/**
 * Rule registry - the single map every string validation rule resolves
 * through (DRY)
 *
 * Illuminate\Validation\Rule is a lookup, not a switch: the Validator asks
 * the registry for a rule by name and plugs custom rules in with
 * `Validator.extend` / `extendImplicit`, so new rules never require editing
 * the Validator (OCP). Rule objects built by the `Rule` builder carry a
 * string form (e.g. `required_if:type:card`) and resolve through the very
 * same registry, keeping one implementation per rule.
 */

import type { Validator } from '../Validator';
import { builtInRules } from './BuiltIn';

/**
 * The outcome of a rule: `true` passes, a string is the failure message,
 * and `false` fails with the validator's resolved default message
 */
export type RuleResult = boolean | string;

/**
 * Everything a rule implementation may consult while validating one
 * attribute: the value, the parsed parameters, sibling field lookups
 * (wildcard-bound) and the validator itself
 */
export interface RuleContext {
  /** Concrete attribute path (wildcards already expanded) */
  field: string;
  /** The original rule pattern when the field came from a wildcard */
  pattern: string;
  /** Displayable attribute name used in messages */
  attribute: string;
  /** The rule name currently running */
  rule: string;
  /** Current value of the attribute */
  value: any;
  /** Parameters after the first colon of the rule string */
  params: string[];
  /** Parameters split on both commas and colons */
  list: string[];
  /** The full data set under validation */
  data: Record<string, any>;
  /** Value of another field, with `*` bound to the current wildcard index */
  other: (field: string) => any;
  /** Whether the resolved data carries another field */
  has: (field: string) => boolean;
  /** The validator running the rule */
  validator: Validator;
  /** Custom message or fallback for the running rule */
  getMessage: (rule: string, fallback: string) => string;
  /** Build the failure message for the running rule */
  fail: (fallback: string) => string;
}

/**
 * A registered rule: the predicate plus the flags the validator loop needs
 */
export interface RuleDefinition {
  /**
   * Run the rule against the attribute; returning a string fails with that
   * message, `true` passes
   */
  passes: (ctx: RuleContext) => RuleResult | Promise<RuleResult>;
  /** Implicit rules also run when the attribute is missing or empty */
  implicit?: boolean;
  /**
   * Exclude modifiers: returning `true` removes the attribute from further
   * validation instead of reporting an error
   */
  exclude?: boolean;
  /**
   * Conditional rules whose parameters reference other fields; `*` inside
   * those parameters binds to the current wildcard index
   */
  fieldParams?: boolean;
  /** Extension-provided rules skip missing values unless implicit */
  extension?: boolean;
  /** Default failure message supplied through `Validator.extend` */
  message?: string;
}

/**
 * The Laravel-style extension callback: receives the attribute name, the
 * value, the rule parameters and the running validator
 */
export type RuleExtension = (
  attribute: string,
  value: any,
  params: string[],
  validator: Validator
) => boolean | Promise<boolean>;

/**
 * Message replacer hook applied to every resolved message, mirroring
 * `Validator::replacer`
 */
export type MessageReplacer = (
  message: string,
  attribute: string,
  field: string,
  rule: string,
  params: string[]
) => string;

export class RuleRegistry {
  private definitions: Map<string, RuleDefinition> = new Map();

  private replacerFn: MessageReplacer | null = null;

  /**
   * Register a rule under one name, replacing any previous definition
   */
  register(name: string, definition: RuleDefinition): this {
    this.definitions.set(name, definition);
    return this;
  }

  /**
   * Register a custom rule callback (Laravel: Validator::extend /
   * Validator::extendImplicit); returning `false` fails the attribute with
   * the provided or default message
   */
  extend(name: string, callback: RuleExtension, options: { implicit?: boolean; message?: string } = {}): this {
    const definition: RuleDefinition = {
      extension: true,
      implicit: options.implicit,
      message: options.message,
      passes: async (ctx) => {
        const result = await callback(ctx.attribute, ctx.value, ctx.params, ctx.validator);

        return result ? true : ctx.fail(options.message ?? `The ${ctx.attribute} is invalid.`);
      },
    };

    this.definitions.set(name, definition);
    return this;
  }

  /**
   * Remove a registered rule (used by extensions that need unloading, e.g.
   * between test cases)
   */
  forget(name: string): this {
    this.definitions.delete(name);
    return this;
  }

  /**
   * Resolve a rule by name, or undefined when unknown
   */
  resolve(name: string): RuleDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * Determine whether a rule is registered
   */
  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /**
   * The names currently registered
   */
  names(): string[] {
    return [...this.definitions.keys()];
  }

  /**
   * Register a message replacer applied to every resolved validation
   * message (Laravel: Validator::replacer)
   */
  replacer(callback: MessageReplacer): this {
    this.replacerFn = callback;
    return this;
  }

  /**
   * Run the registered replacer over a message
   */
  applyReplacer(message: string, attribute: string, field: string, rule: string, params: string[]): string {
    return this.replacerFn ? this.replacerFn(message, attribute, field, rule, params) : message;
  }
}

/**
 * The registry shared by the Validator and every `Rule` object's string
 * form; `Validator.extend` and friends operate on it
 */
export const defaultRegistry = new RuleRegistry();

for (const [name, definition] of Object.entries(builtInRules)) {
  defaultRegistry.register(name, definition);
}

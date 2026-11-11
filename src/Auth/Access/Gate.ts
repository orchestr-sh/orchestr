/**
 * Gate
 *
 * The single authorization service every layer funnels through (DRY):
 * the 'can' middleware, `Request.can/authorize`, `FormRequest.authorize()`
 * and `Rule.can()` all resolve the same container-bound 'gate'. Abilities
 * are defined as closures with `define()`, model policies are attached with
 * `policy()` (or discovered by convention from a configurable namespace and
 * the model's `policy` static), and `before()`/`after()` callbacks can
 * override checks globally - new authorization rules are registered,
 * never hard-coded (OCP).
 *
 * Checks resolve the current user through the resolver wired by the
 * AuthServiceProvider (the auth manager's default guard), so during a
 * request the running user is consulted; `forUser()` hands back a Gate
 * bound to a specific user without touching the original.
 *
 * Laravel: Illuminate\Auth\Access\Gate
 *
 * @example
 * ```typescript
 * const gate = app.make<Gate>('gate');
 *
 * gate.define('update-post', (user, post) => user.getAuthIdentifier() === post.authorId);
 * gate.policy(Post, PostPolicy);
 * gate.before((user) => (user as Admin).isSuperAdmin ? true : null);
 *
 * await gate.allows('update-post', post);   // true | false
 * await gate.authorize('update-post', post); // Response, throws AuthorizationException on denial
 * ```
 */

import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { Container } from '@/Container/Container';
import { getGlobalApp } from '@/Support/helpers';
import { Str } from '@/Support/Str';
import { Response } from './Response';

/**
 * The user an ability is checked against; null represents a guest
 */
export type GateUser = Authenticatable | null;

/**
 * Resolves the user the Gate checks against when none was pinned with
 * forUser()
 * Laravel: the callback behind Gate::resolveUsersUsing()
 */
export type GateUserResolver = () => GateUser | Promise<GateUser>;

/**
 * What ability callbacks, before/after callbacks and policy methods may
 * return: a boolean, a Response, a string used as the denial message, or
 * null/undefined to leave the verdict to the next check
 */
export type AuthorizationResult = boolean | string | Response | null | undefined;

/**
 * A defined ability callback: (user, ...arguments)
 * Laravel: Gate::define() callback
 */
export type AbilityCallback = (user: GateUser, ...args: any[]) => AuthorizationResult | Promise<AuthorizationResult>;

/**
 * A before callback consulted ahead of every check; returning a truthy
 * result short-circuits the check as that result
 * Laravel: Gate::before()
 */
export type BeforeCallback = (
  user: GateUser,
  ability: string,
  args: any[]
) => AuthorizationResult | Promise<AuthorizationResult>;

/**
 * An after callback consulted with the produced result; returning a defined
 * result overrides it
 * Laravel: Gate::after()
 */
export type AfterCallback = (
  user: GateUser,
  ability: string,
  result: AuthorizationResult,
  args: any[]
) => AuthorizationResult | Promise<AuthorizationResult>;

/**
 * The model side of a policy registration: the class itself or its name
 */
export type PolicyModel = (new (...args: any[]) => any) | string;

/**
 * A policy: an object with ability methods, or a class the container can
 * instantiate (constructor injection works like Laravel's policy resolution)
 */
export type PolicyTarget = Record<string, any> | (new (...args: any[]) => Record<string, any>);

/**
 * Maps a model name to the candidate policy names consulted from the
 * container, replacing the built-in `<Model>Policy` convention
 * Laravel: Gate::guessPolicyNamesUsing()
 */
export type PolicyNameGuesser = (modelName: string) => string[];

/**
 * The container surface the Gate needs to instantiate container-bound
 * policies (Application satisfies it)
 */
type PolicyContainer = Pick<Container, 'bound' | 'make'>;

export class Gate {
  /**
   * Abilities registered through define(), keyed by ability name
   */
  private abilities: Map<string, AbilityCallback> = new Map();

  /**
   * Policies registered through policy(), keyed by model name
   */
  private policies: Map<string, PolicyTarget> = new Map();

  /**
   * Instantiated policies, cached per model name
   */
  private policyInstances: Map<string, Record<string, any>> = new Map();

  private beforeCallbacks: BeforeCallback[] = [];

  private afterCallbacks: AfterCallback[] = [];

  /**
   * Resolves the current user for shared checks (guests when unset)
   */
  private userResolver: GateUserResolver | null = null;

  /**
   * A user pinned by forUser(), overriding the resolver on the clone
   */
  private fixedUser: GateUser | GateUserResolver | null = null;

  /**
   * Whether forUser() pinned a user (null must pin as a guest, not fall
   * back to the resolver)
   */
  private userPinned: boolean = false;

  /**
   * Namespace consulted when guessing policy names by convention
   */
  private policyNamespace: string | null = null;

  /**
   * Custom convention replacing the `<Model>Policy` guesser
   */
  private policyGuesser: PolicyNameGuesser | null = null;

  constructor(private readonly container: PolicyContainer | null = null) {}

  // ---------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------

  /**
   * Register an ability and its authorization callback
   * Laravel: Gate::define()
   */
  define(ability: string, callback: AbilityCallback): this {
    this.abilities.set(ability, callback);
    return this;
  }

  /**
   * Register the policy class (or instance) consulted for a model
   * Laravel: Gate::policy()
   */
  policy(model: PolicyModel, policy: PolicyTarget): this {
    this.policies.set(Gate.modelName(model) ?? String(model), policy);
    this.policyInstances.clear();
    return this;
  }

  /**
   * Register a callback consulted before any ability or policy; a truthy
   * result short-circuits the check (the classic super-admin override)
   * Laravel: Gate::before()
   */
  before(callback: BeforeCallback): this {
    this.beforeCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback consulted with the produced result; returning a
   * defined value overrides it (the classic "banned users never pass" hook)
   * Laravel: Gate::after()
   */
  after(callback: AfterCallback): this {
    this.afterCallbacks.push(callback);
    return this;
  }

  /**
   * Wire the callback resolving the current user; the AuthServiceProvider
   * points it at the auth manager's default guard
   * Laravel: Gate::resolveUsersUsing()
   */
  resolveUsersUsing(resolver: GateUserResolver): this {
    this.userResolver = resolver;
    return this;
  }

  /**
   * Set the namespace policies are guessed from, e.g. 'App\\Policies':
   * the Gate resolves `<namespace>\\<Model>Policy` (and the bare
   * `<Model>Policy`) from the container when no policy was registered
   * explicitly
   */
  usePolicyNamespace(namespace: string): this {
    this.policyNamespace = namespace;
    return this;
  }

  /**
   * Replace the convention-based policy name lookup entirely
   * Laravel: Gate::guessPolicyNamesUsing()
   */
  guessPolicyNamesUsing(guesser: PolicyNameGuesser): this {
    this.policyGuesser = guesser;
    return this;
  }

  /**
   * A copy of this Gate checking against a specific user (null for a
   * guest); the clone shares registrations with the original
   * Laravel: Gate::forUser()
   */
  forUser(user: GateUser | GateUserResolver): Gate {
    const gate = new Gate(this.container);

    gate.abilities = this.abilities;
    gate.policies = this.policies;
    gate.policyInstances = this.policyInstances;
    gate.beforeCallbacks = this.beforeCallbacks;
    gate.afterCallbacks = this.afterCallbacks;
    gate.userResolver = this.userResolver;
    gate.policyNamespace = this.policyNamespace;
    gate.policyGuesser = this.policyGuesser;
    gate.fixedUser = user;
    gate.userPinned = true;

    return gate;
  }

  // ---------------------------------------------------------------------
  // Checking
  // ---------------------------------------------------------------------

  /**
   * The user checks run against: the forUser() user when pinned, the
   * resolver's user otherwise, and a guest when neither is set
   */
  async user(): Promise<GateUser> {
    if (this.userPinned) {
      return typeof this.fixedUser === 'function' ? await this.fixedUser() : this.fixedUser;
    }

    return this.userResolver ? await this.userResolver() : null;
  }

  /**
   * Determine whether the current user can perform the ability
   * Laravel: Gate::allows()
   */
  async allows(ability: string, args: any = []): Promise<boolean> {
    return (await this.inspect(ability, args)).allowed;
  }

  /**
   * Determine whether the current user cannot perform the ability
   * Laravel: Gate::denies()
   */
  async denies(ability: string, args: any = []): Promise<boolean> {
    return !(await this.allows(ability, args));
  }

  /**
   * Determine whether the current user can perform at least one ability
   * Laravel: Gate::any()
   */
  async any(abilities: string | string[], args: any = []): Promise<boolean> {
    for (const ability of Array.isArray(abilities) ? abilities : [abilities]) {
      if (await this.allows(ability, args)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine whether the current user can perform none of the abilities
   * Laravel: Gate::none()
   */
  async none(abilities: string | string[], args: any = []): Promise<boolean> {
    for (const ability of Array.isArray(abilities) ? abilities : [abilities]) {
      if (await this.allows(ability, args)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Alias of any(): the current user passes the check when at least one
   * ability succeeds
   * Laravel: Gate::check()
   */
  async check(abilities: string | string[], args: any = []): Promise<boolean> {
    return this.any(abilities, args);
  }

  /**
   * Run the check and hand back the allow/deny Response with its message
   * and status
   * Laravel: Gate::inspect()
   */
  async inspect(ability: string, args: any = []): Promise<Response> {
    return this.raw(ability, args);
  }

  /**
   * Run the check, returning the Response when allowed and throwing the
   * matching AuthorizationException when denied
   * Laravel: Gate::authorize()
   */
  async authorize(ability: string, args: any = []): Promise<Response> {
    return (await this.raw(ability, args)).authorize();
  }

  /**
   * Run the full authorization pipeline - before callbacks, the defined
   * ability or policy method, then after callbacks - and normalise the
   * outcome into a Response
   * Laravel: Gate::raw()
   */
  async raw(ability: string, args: any = []): Promise<Response> {
    const argumentList = Gate.normalizeArguments(args);
    const user = await this.user();

    let result = await this.callBeforeCallbacks(user, ability, argumentList);

    if (result === null) {
      result = await this.callAuthCallback(user, ability, argumentList);
    }

    result = await this.callAfterCallbacks(user, ability, argumentList, result);

    return Response.from(result);
  }

  // ---------------------------------------------------------------------
  // Policies
  // ---------------------------------------------------------------------

  /**
   * The policy instance consulted for a model (class, instance or class
   * name), or null when none is registered, statically declared or
   * guessable through the container
   * Laravel: Gate::getPolicyFor()
   */
  getPolicyFor(model: PolicyModel | object): Record<string, any> | null {
    const key = Gate.modelName(model);

    if (!key) {
      return null;
    }

    const cached = this.policyInstances.get(key);

    if (cached) {
      return cached;
    }

    const target = this.policies.get(key) ?? Gate.staticPolicyOverride(model) ?? this.guessedPolicy(key);

    if (!target) {
      return null;
    }

    const instance = this.instantiatePolicy(target);

    this.policyInstances.set(key, instance);

    return instance;
  }

  /**
   * Determine whether a policy resolves for the model
   * Laravel: Gate::hasPolicy()
   */
  hasPolicy(model: PolicyModel | object): boolean {
    return this.getPolicyFor(model) !== null;
  }

  /**
   * The names of the abilities registered through define()
   * Laravel: Gate::getAbilities()
   */
  getAbilities(): string[] {
    return [...this.abilities.keys()];
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Before callbacks run ahead of every check; like Laravel, a guest is
   * denied outright while they are registered (they would receive a null
   * user), and a truthy result short-circuits with that result
   */
  private async callBeforeCallbacks(user: GateUser, ability: string, args: any[]): Promise<AuthorizationResult | null> {
    for (const before of this.beforeCallbacks) {
      if (user === null) {
        return false;
      }

      const result = await before(user, ability, args);

      if (result) {
        return result;
      }
    }

    return null;
  }

  /**
   * Resolve the check itself: an explicitly defined ability callback wins
   * first, then a policy method for the first argument, and unknown
   * abilities deny
   */
  private async callAuthCallback(user: GateUser, ability: string, args: any[]): Promise<AuthorizationResult> {
    const defined = this.abilities.get(ability);

    if (defined) {
      return defined(user, ...args);
    }

    if (args.length > 0) {
      const policy = this.getPolicyFor(args[0] as PolicyModel | object);
      const method = policy ? Gate.policyMethodFor(policy, ability) : null;

      if (policy && method) {
        // Policy methods describe what an authenticated user may do with
        // a model, so guests fail the check (Laravel's canBeCalledWithUser)
        return user === null ? false : await policy[method](user, ...args);
      }
    }

    return false;
  }

  /**
   * After callbacks receive the produced result and may override it by
   * returning a defined value
   */
  private async callAfterCallbacks(
    user: GateUser,
    ability: string,
    args: any[],
    result: AuthorizationResult
  ): Promise<AuthorizationResult> {
    for (const after of this.afterCallbacks) {
      const override = await after(user, ability, result, args);

      if (override !== null && override !== undefined) {
        result = override;
      }
    }

    return result;
  }

  /**
   * The policy method answering an ability: the ability itself, its camel
   * form, and (for 'view-post'-style abilities) the camel form of the part
   * before the last dash - covering 'view', 'viewAny' and 'update'
   */
  private static policyMethodFor(policy: Record<string, any>, ability: string): string | null {
    const candidates = [ability, Str.camel(ability)];

    if (ability.includes('-')) {
      candidates.push(Str.camel(Str.beforeLast(ability, '-')));
    }

    for (const candidate of candidates) {
      if (candidate !== 'constructor' && typeof policy[candidate] === 'function') {
        return candidate;
      }
    }

    return null;
  }

  /**
   * A model's static `policy` override: a policy class or instance declared
   * on the model itself, consulted when no policy was registered with the
   * Gate
   */
  private static staticPolicyOverride(model: PolicyModel | object): PolicyTarget | null {
    if (typeof model === 'string') {
      return null;
    }

    const ctor = typeof model === 'function' ? (model as any) : (model as any)?.constructor;

    const declared = ctor?.policy;

    if (typeof declared === 'function' || (declared && typeof declared === 'object')) {
      return declared as PolicyTarget;
    }

    return null;
  }

  /**
   * The container-bound candidate the convention resolves to, if any
   */
  private guessedPolicy(modelName: string): PolicyTarget | string | null {
    if (!this.container) {
      return null;
    }

    for (const candidate of this.policyGuesser ? this.policyGuesser(modelName) : this.defaultPolicyNames(modelName)) {
      if (this.container.bound(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Built-in convention: `<namespace>\\<Model>Policy` when a namespace is
   * configured, then the bare `<Model>Policy`
   */
  private defaultPolicyNames(modelName: string): string[] {
    const short = `${modelName}Policy`;

    return this.policyNamespace ? [`${this.policyNamespace}\\${short}`, short] : [short];
  }

  /**
   * Instantiate a registered policy: container-bound names and policy
   * classes go through the container (constructor injection), plain objects
   * pass through
   */
  private instantiatePolicy(target: PolicyTarget | string): Record<string, any> {
    if (typeof target === 'string') {
      if (!this.container) {
        throw new Error(
          `Policy [${target}] was guessed by convention, but the Gate has no container to resolve it from.`
        );
      }

      return this.container.make<Record<string, any>>(target);
    }

    if (typeof target === 'function') {
      return this.container
        ? this.container.make<Record<string, any>>(target)
        : new (target as new (...args: any[]) => Record<string, any>)();
    }

    return target;
  }

  /**
   * The registry key for a model: its name when a class or string, its
   * constructor name when an instance
   */
  private static modelName(model: PolicyModel | object): string | null {
    if (typeof model === 'string') {
      return model;
    }

    if (typeof model === 'function') {
      return model.name;
    }

    if (model && typeof model === 'object') {
      return (model as any).constructor?.name ?? null;
    }

    return null;
  }

  /**
   * `allows('update', post)` and `allows('update', [post, comment])` both
   * normalise to an argument list
   */
  private static normalizeArguments(args: any): any[] {
    if (Array.isArray(args)) {
      return args;
    }

    return args === undefined ? [] : [args];
  }
}

/**
 * Resolve the application's shared gate from the container
 * Laravel: the Gate facade / container binding
 */
export function resolveGate(): Gate {
  const app = getGlobalApp();

  if (!app) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  if (!app.bound('gate')) {
    throw new Error('Authorization is not available. Register the AuthServiceProvider first.');
  }

  return app.make<Gate>('gate');
}

/**
 * CompilerEngine - Blade-compatible view engine.
 *
 * Replaces the old regex TemplateEngine behind the same ViewEngine
 * contract. Pipeline (each concern in its own class per SRP):
 *
 *   TemplateCompiler  source      -> TemplateAst (parsing)
 *   ViewCache         TemplateAst -> disk cache  (source-hash invalidation)
 *   CompilerEngine    TemplateAst -> HTML        (runtime rendering, this file)
 *
 * Sandbox boundary: the engine never calls `eval` or `new Function`. All
 * expressions embedded in templates run through ExpressionEvaluator, a
 * whitelist interpreter over the view data scope (see that file for the
 * supported grammar and the list of global helpers). `@php ... @endphp`
 * therefore supports expression/assignment statements only - not arbitrary
 * JavaScript.
 *
 * Rendering accumulates into caller-owned string buffers so that, like
 * PHP's echo, output produced before a @break/@continue survives the jump.
 *
 * Mirrors Illuminate\View\Engines\CompilerEngine + Illuminate\View\Factory.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type { Node, TemplateAst } from '../Compilers/Ast';
import type { ViewEngine, ViewResolver } from './ViewEngine';
import {
  assignScope,
  childScope,
  createScope,
  evaluate,
  ExpressionError,
  looseEqual,
  normalizeName,
  stringifyValue,
  toEntries,
  UndefinedVariableError,
  type Scope,
} from '../Compilers/ExpressionEvaluator';
import { TemplateCompiler } from '../Compilers/TemplateCompiler';
import { ViewCache } from '../Compilers/ViewCache';

/**
 * Sentinel written where a section body used `@parent`; a later (ancestor)
 * section definition of the same name replaces it with that definition's
 * content, exactly like Blade's parent placeholders. Unresolved sentinels
 * are stripped from the final output.
 */
const PARENT_MARKER = '\u0000orchestr:parent\u0000';

/** Extra context passed to a custom directive handler. */
export interface DirectiveContext {
  /** Evaluate an expression in the current view scope (sandboxed). */
  evaluate(expr: string): unknown;
  /** HTML-escape a value the way `{{ }}` would. */
  escape(value: unknown): string;
  /** The current view data as a plain object. */
  data: Record<string, unknown>;
}

/** Handler registered through `View.directive(name, handler)`. */
export type CustomDirectiveHandler = (args: string, ctx: DirectiveContext) => string | Promise<string>;

/** Translator used by `@lang` / `@choice`; falls back to the key. */
export type ViewTranslator = (
  key: string,
  number?: number,
  replace?: Record<string, unknown>
) => string | null | undefined;

/** `$loop` metadata exposed inside @foreach / @each bodies. */
interface LoopInfo {
  iteration: number;
  index: number;
  remaining: number;
  count: number;
  first: boolean;
  last: boolean;
  depth: number;
  parent: LoopInfo | null;
}

class BreakSignal {
  constructor(public levels = 1) {}
}

class ContinueSignal {
  constructor(public levels = 1) {}
}

/** Per-render shared state: sections, stacks and once-block bookkeeping. */
interface RenderCtx {
  sections: Map<string, string>;
  stacks: Map<string, string[]>;
  onceKeys: Set<string>;
}

/** Per-file execution frame collecting @extends footers. */
interface Frame {
  ctx: RenderCtx;
  path: string;
  extends: Array<{ view: string; data?: string }>;
}

/** Accumulated node output; ownership by loops keeps partial echo alive. */
export type OutputBuffer = string[];

/**
 * A string of pre-rendered HTML. Echoing one with `{{ }}` is NOT escaped,
 * mirroring Blade's treatment of Htmlable instances (component slots and
 * application-provided markup).
 */
export class HtmlString {
  constructor(public readonly html: string = '') {}

  toString(): string {
    return this.html;
  }
}

export interface CompilerEngineOptions {
  /** Disk cache for compiled ASTs; omit for in-memory compilation only. */
  cache?: ViewCache | null;
}

export class CompilerEngine implements ViewEngine {
  protected compiler = new TemplateCompiler();
  protected resolver: ViewResolver | null = null;
  protected cache: ViewCache | null;
  protected memoryCache = new Map<string, { hash: string; ast: TemplateAst }>();
  protected directives = new Map<string, CustomDirectiveHandler>();
  protected csrfTokenResolver: (() => string) | null = null;
  protected translator: ViewTranslator | null = null;

  constructor(options: CompilerEngineOptions = {}) {
    this.cache = options.cache ?? null;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /** Set the resolver used by @include / @extends / @each / @component. */
  setResolver(resolver: ViewResolver): void {
    this.resolver = resolver;
  }

  /** Attach (or detach) the on-disk compiled-view cache. */
  setCache(cache: ViewCache | null): void {
    this.cache = cache;
  }

  getCache(): ViewCache | null {
    return this.cache;
  }

  /** Register a custom directive handler; name is matched case-insensitively. */
  registerDirective(name: string, handler: CustomDirectiveHandler): void {
    this.directives.set(name.toLowerCase(), handler);
  }

  /** Determine whether a custom directive has been registered. */
  hasDirective(name: string): boolean {
    return this.directives.has(name.toLowerCase());
  }

  /** Registered custom directive names (for introspection/tests). */
  listDirectives(): string[] {
    return [...this.directives.keys()];
  }

  /** Remove a custom directive registration. */
  forgetDirective(name: string): void {
    this.directives.delete(name.toLowerCase());
  }

  /** Supply the CSRF token for @csrf when it is not in the view data. */
  setCsrfTokenResolver(resolver: (() => string) | null): void {
    this.csrfTokenResolver = resolver;
  }

  /** Supply translations for @lang / @choice. */
  setTranslator(translator: ViewTranslator | null): void {
    this.translator = translator;
  }

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  /**
   * Get the evaluated contents of the view.
   * Implements the ViewEngine contract.
   */
  async get(path: string, data: Record<string, any>): Promise<string> {
    const output = await this.renderFile(path, createScope(data), this.newCtx());
    return this.stripParentMarkers(output);
  }

  /**
   * Render a template source string with the given data - handy for tests,
   * mail bodies, and parity checks against the old engine.
   */
  async renderString(source: string, data: Record<string, any> = {}): Promise<string> {
    const ast = this.compiler.compile(source);
    const ctx = this.newCtx();
    const frame: Frame = { ctx, path: '<string>', extends: [] };
    const buf: OutputBuffer = [];
    await this.executeNodes(ast, createScope(data), frame, buf);
    return this.stripParentMarkers(buf.join(''));
  }

  /** Parse (and cache) the file's AST without rendering - used by view:cache. */
  compileFile(path: string): TemplateAst {
    return this.loadAst(path);
  }

  /** Drop in-memory and on-disk compiled views; returns files deleted. */
  flushCompiled(): number {
    this.memoryCache.clear();
    return this.cache ? this.cache.flush() : 0;
  }

  // -------------------------------------------------------------------------
  // Loading & caching
  // -------------------------------------------------------------------------

  protected newCtx(): RenderCtx {
    return { sections: new Map(), stacks: new Map(), onceKeys: new Set() };
  }

  protected loadAst(path: string): TemplateAst {
    const source = readFileSync(path, 'utf8');
    const hash = createHash('sha256').update(source).digest('hex');

    const memory = this.memoryCache.get(path);
    if (memory && memory.hash === hash) {
      return memory.ast;
    }

    const disk = this.cache?.get(path, source);
    if (disk) {
      this.memoryCache.set(path, { hash, ast: disk });
      return disk;
    }

    const ast = this.compiler.compile(source);
    this.memoryCache.set(path, { hash, ast });
    this.cache?.put(path, source, ast);
    return ast;
  }

  /** Compile (cached) + render a file, then flush its @extends footers. */
  protected async renderFile(path: string, scope: Scope, ctx: RenderCtx): Promise<string> {
    const ast = this.loadAst(path);
    const frame: Frame = { ctx, path, extends: [] };
    const buf: OutputBuffer = [];
    try {
      await this.executeNodes(ast, scope, frame, buf);
    } catch (err) {
      // A break/continue that escapes its file terminates that file's render
      // with the output accumulated so far, like a PHP break at scope.
      if (!(err instanceof BreakSignal) && !(err instanceof ContinueSignal)) {
        throw err;
      }
    }

    let out = buf.join('');

    // Blade appends parent templates as a footer: they render after the
    // whole child file (and therefore see every captured section).
    for (const parent of frame.extends) {
      const layoutName = stringifyValue(this.evaluateExpr(parent.view, scope, ''));
      const extra = parent.data ? this.toObject(this.evaluateExpr(parent.data, scope, {})) : {};
      const layoutScope = childScope(createScope(this.flattenScope(scope)), extra);
      out += await this.renderFile(this.resolvePath(layoutName), layoutScope, ctx);
    }

    return out;
  }

  protected resolvePath(name: string): string {
    if (!this.resolver) {
      throw new Error(
        `CompilerEngine: No resolver set. Cannot resolve view "${name}". ` +
          `Call setResolver() before using @include, @extends, @each or @component.`
      );
    }
    return this.resolver.findView(name);
  }

  protected tryResolvePath(name: string): string | null {
    try {
      return this.resolvePath(name);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Node execution
  // -------------------------------------------------------------------------

  protected async executeNodes(nodes: Node[], scope: Scope, frame: Frame, buf: OutputBuffer): Promise<void> {
    for (const node of nodes) {
      await this.executeNode(node, scope, frame, buf);
    }
  }

  /** Render `nodes` into a private buffer and return its text. */
  protected async capture(nodes: Node[], scope: Scope, frame: Frame): Promise<string> {
    const buf: OutputBuffer = [];
    await this.executeNodes(nodes, scope, frame, buf);
    return buf.join('');
  }

  protected async executeNode(node: Node, scope: Scope, frame: Frame, buf: OutputBuffer): Promise<void> {
    switch (node.type) {
      case 'text':
        buf.push(node.value);
        return;

      case 'echo': {
        let value: unknown;
        try {
          value = evaluate(node.expr, scope);
        } catch (err) {
          if (err instanceof UndefinedVariableError || err instanceof ExpressionError) {
            value = '';
          } else {
            throw err;
          }
        }
        if (value instanceof HtmlString) {
          buf.push(value.html);
          return;
        }
        const text = stringifyValue(value);
        buf.push(node.escape ? this.escapeHtml(text) : text);
        return;
      }

      case 'if': {
        for (const branch of node.branches) {
          if (branch.test === null || this.checkCondition(branch.test, scope)) {
            await this.executeNodes(branch.body, scope, frame, buf);
            return;
          }
        }
        return;
      }

      case 'foreach':
        await this.runForeach(node, scope, frame, buf);
        return;

      case 'for':
        await this.runFor(node, scope, frame, buf);
        return;

      case 'while':
        await this.runWhile(node, scope, frame, buf);
        return;

      case 'switch':
        await this.runSwitch(node, scope, frame, buf);
        return;

      case 'control': {
        const levels = this.resolveLevels(node.levels, scope);
        if (levels === 0) {
          return;
        }
        throw node.action === 'break' ? new BreakSignal(levels) : new ContinueSignal(levels);
      }

      case 'extends': {
        frame.extends.push({ view: node.view, data: node.data });
        return;
      }

      case 'section': {
        const name = stringifyValue(this.evaluateExpr(node.name, scope, ''));
        let content: string;
        if (node.inline !== undefined) {
          content = this.escapeHtml(stringifyValue(this.evaluateExpr(node.inline, scope, '')));
        } else {
          // Section bodies capture into their own buffer but share the outer
          // one's partial state via capture(): breaks inside sections behave
          // like PHP's ob_* nesting.
          content = await this.captureSection(node, scope, frame);
        }
        this.storeSection(frame.ctx, name, content, node.mode);
        if (node.mode === 'show') {
          buf.push(this.yieldSection(frame.ctx, name));
        }
        return;
      }

      case 'yield': {
        const name = stringifyValue(this.evaluateExpr(node.name, scope, ''));
        const fallback =
          node.default !== undefined ? this.escapeHtml(stringifyValue(this.evaluateExpr(node.default, scope, ''))) : '';
        buf.push(this.yieldSection(frame.ctx, name, fallback));
        return;
      }

      case 'parent':
        buf.push(PARENT_MARKER);
        return;

      case 'sectionCheck': {
        const name = stringifyValue(this.evaluateExpr(node.name, scope, ''));
        const exists = frame.ctx.sections.has(name);
        const body = exists !== node.missing ? node.body : (node.else ?? []);
        await this.executeNodes(body, scope, frame, buf);
        return;
      }

      case 'include':
        await this.runInclude(node, scope, frame, buf);
        return;

      case 'includeFirst':
        await this.runIncludeFirst(node, scope, frame, buf);
        return;

      case 'each':
        await this.runEach(node, scope, frame, buf);
        return;

      case 'push': {
        const stack = stringifyValue(this.evaluateExpr(node.stack, scope, ''));
        if (node.once) {
          const onceId = node.onceId !== undefined ? stringifyValue(this.evaluateExpr(node.onceId, scope, '')) : '';
          const key = `pushOnce:${stack}:${onceId}:${frame.path}`;
          if (frame.ctx.onceKeys.has(key)) {
            return;
          }
          frame.ctx.onceKeys.add(key);
        }
        const content = await this.capture(node.body, scope, frame);
        const entries = frame.ctx.stacks.get(stack) ?? [];
        if (node.mode === 'prepend') {
          entries.unshift(content);
        } else {
          entries.push(content);
        }
        frame.ctx.stacks.set(stack, entries);
        return;
      }

      case 'stack': {
        const stack = stringifyValue(this.evaluateExpr(node.name, scope, ''));
        buf.push((frame.ctx.stacks.get(stack) ?? []).join('\n'));
        return;
      }

      case 'once': {
        const key = `${frame.path}#${node.id}`;
        if (frame.ctx.onceKeys.has(key)) {
          return;
        }
        frame.ctx.onceKeys.add(key);
        await this.executeNodes(node.body, scope, frame, buf);
        return;
      }

      case 'component':
        await this.runComponent(node, scope, frame, buf);
        return;

      case 'props': {
        const defaults = this.toObject(this.evaluateExpr(node.expr, scope, {}));
        for (const [key, value] of Object.entries(defaults)) {
          if (!(key in scope)) {
            assignScope(scope, key, value);
          }
        }
        return;
      }

      case 'csrf': {
        const token = this.resolveCsrfToken(scope);
        buf.push(`<input type="hidden" name="_token" value="${this.escapeHtml(token)}" autocomplete="off">`);
        return;
      }

      case 'method': {
        const verb = stringifyValue(this.evaluateExpr(node.expr, scope, ''));
        buf.push(`<input type="hidden" name="_method" value="${this.escapeHtml(verb)}">`);
        return;
      }

      case 'error': {
        const field = stringifyValue(this.evaluateExpr(node.field, scope, ''));
        const message = this.firstErrorMessage(scope, field);
        if (message !== null) {
          await this.executeNodes(node.body, childScope(scope, { message, first: message }), frame, buf);
          return;
        }
        await this.executeNodes(node.else ?? [], scope, frame, buf);
        return;
      }

      case 'php': {
        for (const statement of node.statements) {
          evaluate(statement, scope);
        }
        return;
      }

      case 'json': {
        let value = this.evaluateExpr(node.expr, scope, null);
        // Associative array literals evaluate to ordered Maps; serialize them
        // as objects so @json matches Blade's output for PHP-style arrays.
        if (value instanceof Map) {
          value = Object.fromEntries(value.entries());
        }
        buf.push(JSON.stringify(value === undefined ? null : value) ?? 'null');
        return;
      }

      case 'attrJoin': {
        const value = this.evaluateExpr(node.expr, scope, '');
        buf.push(node.helper === 'class' ? this.buildClassList(value) : this.buildStyleString(value));
        return;
      }

      case 'flag': {
        const value = this.evaluateExpr(node.expr, scope, false);
        if (value) {
          buf.push(node.attribute);
        }
        return;
      }

      case 'lang': {
        const key = stringifyValue(this.evaluateExpr(node.expr, scope, ''));
        const replace = node.replace ? this.toObject(this.evaluateExpr(node.replace, scope, {})) : undefined;
        buf.push(this.translate(key, undefined, replace) ?? key);
        return;
      }

      case 'choice': {
        const key = stringifyValue(this.evaluateExpr(node.expr, scope, ''));
        const number = Number(this.evaluateExpr(node.number, scope, 1)) || 0;
        const replace = node.replace ? this.toObject(this.evaluateExpr(node.replace, scope, {})) : undefined;
        buf.push(this.translate(key, number, replace) ?? key);
        return;
      }

      case 'directive': {
        buf.push(await this.runCustomDirective(node, scope));
        return;
      }

      default:
        return;
    }
  }

  /**
   * Section capture shares the surrounding buffer chain so partial output
   * before a signal is not silently thrown away by ob-equivalent capture.
   */
  private async captureSection(node: Extract<Node, { type: 'section' }>, scope: Scope, frame: Frame): Promise<string> {
    const buf: OutputBuffer = [];
    try {
      await this.executeNodes(node.body, scope, frame, buf);
    } catch (err) {
      if (!(err instanceof BreakSignal) && !(err instanceof ContinueSignal)) {
        throw err;
      }
      // The signal keeps travelling outward after the section is stored.
      const content = buf.join('');
      this.storeSection(
        frame.ctx,
        stringifyValue(this.evaluateExpr(node.name, scope, '')),
        content,
        node.mode === 'show' ? 'stop' : node.mode
      );
      throw err;
    }
    return buf.join('');
  }

  // -------------------------------------------------------------------------
  // Loops
  // -------------------------------------------------------------------------

  protected async runForeach(
    node: Extract<Node, { type: 'foreach' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    const items = toEntries(this.evaluateExpr(node.source, scope, []));
    const parentLoop = (scope as Record<string, unknown>).loop as LoopInfo | undefined;
    const count = items.length;

    for (let index = 0; index < count; index++) {
      const [key, value] = items[index];
      const loop: LoopInfo = {
        iteration: index + 1,
        index,
        remaining: count - index - 1,
        count,
        first: index === 0,
        last: index === count - 1,
        depth: (parentLoop?.depth ?? 0) + 1,
        parent: parentLoop ?? null,
      };

      const vars: Record<string, unknown> = { loop };
      vars[node.value] = value;
      if (node.key) {
        vars[node.key] = key;
      }

      if (!(await this.runIteration(node.body, scope, frame, vars, buf))) {
        return;
      }
    }
  }

  protected async runFor(
    node: Extract<Node, { type: 'for' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    // Loop variables live on a child scope but new assignments bubble to the
    // template root, like PHP variables inside a compiled for-loop.
    const loopScope = childScope(scope);
    if (node.init.trim()) {
      evaluate(node.init, loopScope);
    }

    for (;;) {
      if (node.test.trim() && !this.checkCondition(node.test, loopScope)) {
        break;
      }
      if (!(await this.runIteration(node.body, scope, frame, {}, buf, loopScope))) {
        break;
      }
      if (node.update.trim()) {
        evaluate(node.update, loopScope);
      }
    }
  }

  protected async runWhile(
    node: Extract<Node, { type: 'while' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    while (this.checkCondition(node.test, scope)) {
      if (!(await this.runIteration(node.body, scope, frame, {}, buf))) {
        break;
      }
    }
  }

  /**
   * Run one loop body. Partial output is flushed to `buf` either way (like
   * PHP's echo), and the return value reports whether the loop should keep
   * iterating.
   */
  protected async runIteration(
    body: Node[],
    scope: Scope,
    frame: Frame,
    vars: Record<string, unknown>,
    buf: OutputBuffer,
    target?: Scope
  ): Promise<boolean> {
    const loopScope = target ?? childScope(scope, vars);
    if (target && Object.keys(vars).length > 0) {
      Object.assign(loopScope, vars);
    }
    const iterationBuf: OutputBuffer = [];
    let keepGoing = true;
    try {
      await this.executeNodes(body, loopScope, frame, iterationBuf);
    } catch (err) {
      if (err instanceof BreakSignal) {
        if (err.levels > 1) {
          err.levels--;
          buf.push(...iterationBuf);
          throw err;
        }
        keepGoing = false;
      } else if (err instanceof ContinueSignal) {
        if (err.levels > 1) {
          err.levels--;
          buf.push(...iterationBuf);
          throw err;
        }
      } else {
        throw err;
      }
    }
    buf.push(...iterationBuf);
    return keepGoing;
  }

  protected async runSwitch(
    node: Extract<Node, { type: 'switch' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    const subject = this.evaluateExpr(node.expr, scope, undefined);

    let start = -1;
    let defaultAt = -1;
    for (let i = 0; i < node.cases.length; i++) {
      const arm = node.cases[i];
      if (arm.tests === null) {
        if (defaultAt === -1) {
          defaultAt = i;
        }
        continue;
      }
      if (start === -1 && arm.tests.some((test) => looseEqual(this.evaluateExpr(test, scope, undefined), subject))) {
        start = i;
      }
    }
    if (start === -1) {
      start = defaultAt;
    }
    if (start === -1) {
      return;
    }

    try {
      for (let i = start; i < node.cases.length; i++) {
        await this.executeNodes(node.cases[i].body, scope, frame, buf);
      }
    } catch (err) {
      if (err instanceof BreakSignal) {
        if (err.levels > 1) {
          err.levels--;
          throw err;
        }
        return; // switch break
      }
      throw err;
    }
  }

  protected resolveLevels(expr: string | undefined, scope: Scope): number {
    if (!expr) {
      return 1;
    }
    let value: unknown;
    try {
      value = evaluate(expr, scope);
    } catch {
      return 1;
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      return Math.max(0, value);
    }
    if (value === true) {
      return 1;
    }
    if (value === false || value === null || value === undefined || value === 0 || value === '') {
      return 0; // `@break(cond)` / `@continue(cond)` are no-ops when falsy
    }
    return 1;
  }

  // -------------------------------------------------------------------------
  // Includes / each / components
  // -------------------------------------------------------------------------

  protected async runInclude(
    node: Extract<Node, { type: 'include' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    if (node.condition !== undefined) {
      const condition = this.checkCondition(node.condition, scope);
      if (node.mode === 'when' ? !condition : condition) {
        return;
      }
    }

    const name = stringifyValue(this.evaluateExpr(node.view, scope, ''));
    if (node.mode === 'if' && this.tryResolvePath(name) === null) {
      return;
    }

    const extra = node.data ? this.toObject(this.evaluateExpr(node.data, scope, {})) : {};
    buf.push(await this.renderFile(this.resolvePath(name), childScope(scope, extra), frame.ctx));
  }

  protected async runIncludeFirst(
    node: Extract<Node, { type: 'includeFirst' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    const names = toEntries(this.evaluateExpr(node.views, scope, [])).map(([, v]) => stringifyValue(v));
    const found = names.find((name) => this.tryResolvePath(name) !== null);

    if (found === undefined) {
      throw new Error(`None of views [${names.join(', ')}] exist for @includeFirst.`);
    }

    const extra = node.data ? this.toObject(this.evaluateExpr(node.data, scope, {})) : {};
    buf.push(await this.renderFile(this.resolvePath(found), childScope(scope, extra), frame.ctx));
  }

  protected async runEach(
    node: Extract<Node, { type: 'each' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    const name = stringifyValue(this.evaluateExpr(node.view, scope, ''));
    const items = toEntries(this.evaluateExpr(node.source, scope, []));
    const keyVar = node.key ?? 'key';

    if (items.length === 0 && node.empty) {
      const emptyValue = stringifyValue(this.evaluateExpr(node.empty, scope, ''));
      if (emptyValue.startsWith('raw|')) {
        buf.push(emptyValue.slice(4));
        return;
      }
      buf.push(await this.renderFile(this.resolvePath(emptyValue), scope, frame.ctx));
      return;
    }

    const path = this.resolvePath(name);
    const parentLoop = (scope as Record<string, unknown>).loop as LoopInfo | undefined;
    const count = items.length;

    for (let index = 0; index < count; index++) {
      const [key, value] = items[index];
      const vars: Record<string, unknown> = {
        loop: {
          iteration: index + 1,
          index,
          remaining: count - index - 1,
          count,
          first: index === 0,
          last: index === count - 1,
          depth: (parentLoop?.depth ?? 0) + 1,
          parent: parentLoop ?? null,
        } satisfies LoopInfo,
        [keyVar]: key,
        [node.value]: value,
      };
      buf.push(await this.renderFile(path, childScope(scope, vars), frame.ctx));
    }
  }

  protected async runComponent(
    node: Extract<Node, { type: 'component' }>,
    scope: Scope,
    frame: Frame,
    buf: OutputBuffer
  ): Promise<void> {
    const name = stringifyValue(this.evaluateExpr(node.view, scope, ''));

    // Slots and default content render in the parent scope.
    const componentData: Record<string, unknown> = node.data
      ? this.toObject(this.evaluateExpr(node.data, scope, {}))
      : {};
    for (const slot of node.slots) {
      const slotName = normalizeName(stringifyValue(this.evaluateExpr(slot.name, scope, '')));
      componentData[slotName] = new HtmlString(await this.capture(slot.body, scope, frame));
    }
    componentData.slot = new HtmlString(await this.capture(node.body, scope, frame));

    // Old-style @component: the template renders with its own data (args +
    // slots + $slot) and replaces the directive region wholesale.
    buf.push(await this.renderFile(this.resolvePath(name), createScope({ ...componentData }), frame.ctx));
  }

  // -------------------------------------------------------------------------
  // Custom directives
  // -------------------------------------------------------------------------

  protected async runCustomDirective(node: Extract<Node, { type: 'directive' }>, scope: Scope): Promise<string> {
    const handler = this.directives.get(node.name.toLowerCase());
    if (!handler) {
      return node.args !== undefined ? `@${node.name}(${node.args})` : `@${node.name}`;
    }

    const ctx: DirectiveContext = {
      evaluate: (expr: string) => evaluate(expr, scope),
      escape: (value: unknown) => this.escapeHtml(stringifyValue(value)),
      data: this.flattenScope(scope),
    };

    const rendered = await handler(node.args ?? '', ctx);
    return stringifyValue(rendered);
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  /**
   * Fold a stopped section into the map with Blade's rules: plain stops
   * replace the `@parent` placeholder inside the existing content (or win
   * outright when nothing exists yet), `@append` concatenates after the
   * existing content, and `@overwrite` replaces unconditionally.
   */
  protected storeSection(
    ctx: RenderCtx,
    name: string,
    content: string,
    mode: 'stop' | 'show' | 'append' | 'overwrite'
  ): void {
    const existing = ctx.sections.get(name);

    if (mode === 'append') {
      ctx.sections.set(name, (existing ?? '') + content);
      return;
    }
    if (mode === 'overwrite') {
      ctx.sections.set(name, content);
      return;
    }
    if (existing === undefined) {
      ctx.sections.set(name, content);
      return;
    }
    ctx.sections.set(name, existing.split(PARENT_MARKER).join(content));
  }

  /** Render the folded value of a section, mirroring Factory::yieldContent. */
  protected yieldSection(ctx: RenderCtx, name: string, fallback: string = ''): string {
    const content = ctx.sections.has(name) ? (ctx.sections.get(name) as string) : fallback;
    return content.split(PARENT_MARKER).join('');
  }

  // -------------------------------------------------------------------------
  // Forms, i18n, attribute helpers
  // -------------------------------------------------------------------------

  protected resolveCsrfToken(scope: Scope): string {
    const fromData = (scope as Record<string, unknown>)._token ?? (scope as Record<string, unknown>).csrf_token;
    if (typeof fromData === 'string' && fromData !== '') {
      return fromData;
    }
    if (this.csrfTokenResolver) {
      try {
        return this.csrfTokenResolver() ?? '';
      } catch {
        return '';
      }
    }
    return '';
  }

  protected translate(key: string, number?: number, replace?: Record<string, unknown>): string | null {
    if (!this.translator) {
      return null;
    }
    try {
      const value = this.translator(key, number, replace);
      return value === null || value === undefined ? null : value;
    } catch {
      return null;
    }
  }

  /**
   * Find the first validation message for a field. Accepts the plain
   * `Record<string, string | string[]>` produced by Validator::errors() as
   * well as Map-backed and MessageBag-shaped (`first(key)`) containers.
   */
  protected firstErrorMessage(scope: Scope, field: string): string | null {
    const errors = (scope as Record<string, unknown>).errors;
    if (errors === null || errors === undefined) {
      return null;
    }

    let entry: unknown;
    if (errors instanceof Map) {
      entry = errors.get(field);
    } else if (typeof (errors as any).first === 'function') {
      entry = (errors as any).first(field);
    } else if (typeof errors === 'object') {
      entry = (errors as Record<string, unknown>)[field];
    }

    if (entry === null || entry === undefined || entry === false) {
      return null;
    }
    if (Array.isArray(entry)) {
      return entry.length > 0 ? stringifyValue(entry[0]) : null;
    }
    return stringifyValue(entry);
  }

  /** Blade's `@class([...])` helper. */
  protected buildClassList(value: unknown): string {
    const classes: string[] = [];
    const walk = (item: unknown): void => {
      if (item === null || item === undefined || item === false) {
        return;
      }
      if (typeof item === 'string') {
        classes.push(...item.split(/\s+/).filter(Boolean));
        return;
      }
      if (typeof item === 'number' || typeof item === 'boolean') {
        classes.push(String(item));
        return;
      }
      if (Array.isArray(item)) {
        item.forEach(walk);
        return;
      }
      if (item instanceof Map) {
        for (const [cls, gate] of item.entries()) {
          if (typeof cls === 'number') {
            walk(gate); // positional entry: the value is the class list
          } else if (gate) {
            walk(cls);
          }
        }
        return;
      }
      if (typeof item === 'object') {
        for (const [cls, gate] of Object.entries(item as Record<string, unknown>)) {
          if (/^\d+$/.test(cls)) {
            walk(gate);
          } else if (gate) {
            walk(cls);
          }
        }
      }
    };
    walk(value);
    return classes.map((cls) => this.escapeHtml(cls)).join(' ');
  }

  /** Blade's `@style([...])` helper. */
  protected buildStyleString(value: unknown): string {
    const declarations: string[] = [];
    const add = (text: string): void => {
      const trimmed = text.trim();
      if (trimmed !== '') {
        declarations.push(trimmed);
      }
    };

    if (typeof value === 'string') {
      add(value);
    } else {
      this.collectStylePairs(value, add);
    }

    return declarations.map((decl) => this.escapeHtml(decl)).join('; ');
  }

  private collectStylePairs(source: unknown, add: (text: string) => void): void {
    if (source === null || source === undefined || typeof source !== 'object') {
      return;
    }
    if (Array.isArray(source)) {
      for (const item of source) {
        if (typeof item === 'string') {
          add(item);
        } else {
          this.collectStylePairs(item, add);
        }
      }
      return;
    }
    const entries: Iterable<[unknown, unknown]> =
      source instanceof Map ? source.entries() : Object.entries(source as Record<string, unknown>);
    for (const [prop, val] of entries) {
      if (typeof prop === 'number' || /^\d+$/.test(String(prop))) {
        // positional entry: a full declaration string or a nested pair list
        if (typeof val === 'string') {
          add(val);
        } else {
          this.collectStylePairs(val, add);
        }
        continue;
      }
      if (val !== null && val !== undefined && val !== false && val !== '') {
        add(`${prop}: ${stringifyValue(val)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shared evaluation helpers
  // -------------------------------------------------------------------------

  /** Truthiness for condition positions; expression errors count as false. */
  protected checkCondition(expr: string, scope: Scope): boolean {
    try {
      return !!evaluate(expr, scope);
    } catch (err) {
      if (err instanceof UndefinedVariableError || err instanceof ExpressionError) {
        return false;
      }
      throw err;
    }
  }

  /** Evaluate an argument expression, falling back on template errors. */
  protected evaluateExpr(expr: string, scope: Scope, fallback: unknown): unknown {
    try {
      return evaluate(expr, scope);
    } catch (err) {
      if (err instanceof UndefinedVariableError || err instanceof ExpressionError) {
        return fallback;
      }
      throw err;
    }
  }

  protected toObject(value: unknown): Record<string, unknown> {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries());
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>) };
    }
    if (Array.isArray(value)) {
      return Object.fromEntries(value.entries());
    }
    return {};
  }

  /** Materialize the scope prototype chain into a plain object (innermost wins). */
  protected flattenScope(scope: Scope): Record<string, unknown> {
    const chain: Scope[] = [];
    let current: Scope | null = scope;
    while (current) {
      chain.unshift(current);
      current = Object.getPrototypeOf(current) as Scope | null;
    }
    const data: Record<string, unknown> = {};
    for (const level of chain) {
      // Object.assign copies own enumerable properties; scopes are
      // null-prototype objects, so this materializes the chain in order.
      Object.assign(data, level);
    }
    return data;
  }

  /** HTML-escape like Blade's `e()`: quotes included, single quotes as `&#039;`. */
  protected escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  protected stripParentMarkers(output: string): string {
    return output.split(PARENT_MARKER).join('');
  }
}

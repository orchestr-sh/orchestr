/**
 * TemplateCompiler - parses view source into the Ast node tree.
 *
 * Replaces the old regex pipeline with a hand-written scanner + recursive
 * descent parser: echoes, raw blocks, comments, verbatim sections and every
 * directive are tokenized in a single pass and assembled into structured
 * nodes, so nesting (@if inside @foreach inside @switch, nested layouts) is
 * handled by the grammar rather than by repeated regex substitution.
 *
 * Parsing only - no file IO, no data. Compilation happens once per source
 * and the resulting tree is JSON-serializable, which is what lets the
 * CompilerEngine cache it (see ViewCache).
 *
 * Mirrors Illuminate\View\Compilers\BladeCompiler (behaviour, not regexes).
 */

import type { ComponentNode, EachNode, Node, SwitchNode, TemplateAst } from './Ast';
import { normalizeName } from './ExpressionEvaluator';

/** Raised when a template cannot be parsed. */
export class ViewParseException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewParseException';
  }
}

interface Terminator {
  name: string;
  args?: string;
}

/** Directives that only make sense as a block closer; stray ones stay text. */
const CLOSE_ONLY = new Set([
  'else',
  'elseif',
  'endif',
  'endunless',
  'endisset',
  'endempty',
  'endfor',
  'endforelse',
  'endforeach',
  'endwhile',
  'endswitch',
  'endcase',
  'endsection',
  'stop',
  'show',
  'append',
  'overwrite',
  'endpush',
  'endpushonce',
  'endprepend',
  'endonce',
  'endcomponent',
  'endslot',
  'endphp',
  'endverbatim',
  'enderror',
]);

export class TemplateCompiler {
  private source = '';
  private pos = 0;
  private onceCounter = 0;
  private pendingTerminator: Terminator | null = null;

  /** Compile Blade-ish template source into an executable node tree. */
  compile(source: string): TemplateAst {
    this.source = source;
    this.pos = 0;
    this.onceCounter = 0;
    this.pendingTerminator = null;
    const { nodes, terminator } = this.parseNodes(new Set());
    if (terminator) {
      throw new ViewParseException(`Unexpected @${terminator.name} without a matching opening directive`);
    }
    return nodes;
  }

  // -------------------------------------------------------------------------
  // Node parsing
  // -------------------------------------------------------------------------

  /** Parse nodes until one of `stops` appears (which is consumed) or EOF. */
  private parseNodes(stops: Set<string>): { nodes: Node[]; terminator: Terminator | null } {
    const nodes: Node[] = [];

    for (;;) {
      const atom = this.parseAtom(stops);
      if (atom === 'eof') {
        return { nodes, terminator: null };
      }
      if (atom === 'stop') {
        const terminator = this.pendingTerminator;
        this.pendingTerminator = null;
        return { nodes, terminator };
      }
      nodes.push(...atom);
    }
  }

  /**
   * Consume the next chunk: a text run, an echo tag, a comment, or a
   * directive. Returns 'stop' when a stop directive was consumed and 'eof'
   * at the end of input.
   */
  private parseAtom(stops: Set<string>): Node[] | 'stop' | 'eof' {
    if (this.pos >= this.source.length) {
      return 'eof';
    }

    const start = this.pos;

    for (let i = this.pos; i < this.source.length; i++) {
      const ch = this.source[i];

      if (ch === '\\') {
        // Escaped directive: `\@if(...)` renders as literal text.
        if (this.source[i + 1] === '@') {
          this.pos = i + 2;
          return [{ type: 'text', value: `${this.source.slice(start, i)}@` }];
        }
        continue;
      }

      if (ch === '{') {
        if (this.source.startsWith('{{--', i)) {
          if (i > start) {
            this.pos = i;
            return [{ type: 'text', value: this.source.slice(start, i) }];
          }
          // {{-- comment --}} is dropped entirely.
          const end = this.source.indexOf('--}}', i + 4);
          this.pos = end === -1 ? this.source.length : end + 4;
          return [];
        }
        if (this.source.startsWith('{!!', i)) {
          if (i > start) {
            this.pos = i;
            return [{ type: 'text', value: this.source.slice(start, i) }];
          }
          return this.readRawEcho(i);
        }
        if (this.source.startsWith('{{', i)) {
          if (i > start) {
            this.pos = i;
            return [{ type: 'text', value: this.source.slice(start, i) }];
          }
          return this.readEcho(i);
        }
      }

      if (ch === '@') {
        // `@@directive` escapes the directive sigil: `@@if` renders as `@if`.
        if (this.source[i + 1] === '@') {
          this.pos = i + 2;
          return [{ type: 'text', value: `${this.source.slice(start, i)}@` }];
        }

        // `@{{ }}` / `@{!! !!}` - escaped echo tags for client-side templating.
        if (this.source.startsWith('@{{', i) || this.source.startsWith('@{!!', i)) {
          const literal = this.source.startsWith('@{{', i) ? '{{' : '{!!';
          if (i > start) {
            this.pos = i;
            return [{ type: 'text', value: this.source.slice(start, i) }];
          }
          this.pos = i + 1 + literal.length;
          return [{ type: 'text', value: literal }];
        }

        const nameMatch = /^@([A-Za-z_][A-Za-z0-9_]*)/.exec(this.source.slice(i));
        if (!nameMatch) {
          continue; // plain '@' (email addresses and the like)
        }
        if (i > start) {
          this.pos = i;
          return [{ type: 'text', value: this.source.slice(start, i) }];
        }
        return this.readDirective(nameMatch[1], i, stops);
      }
    }

    this.pos = this.source.length;
    return [{ type: 'text', value: this.source.slice(start) }];
  }

  /** `{{ expr }}` / `{{{ expr }}}` (legacy triple-brace == raw). */
  private readEcho(i: number): Node[] {
    const triple = this.source.startsWith('{{{', i);
    const openLen = triple ? 3 : 2;
    const closer = triple ? '}}}' : '}}';
    const end = this.findEchoEnd(i + openLen, closer);
    if (end === -1) {
      throw new ViewParseException(`Unclosed {{ expression near offset ${i}`);
    }
    const expr = this.source.slice(i + openLen, end);
    this.pos = end + closer.length;
    return [{ type: 'echo', expr: expr.trim(), escape: !triple }];
  }

  /** `{!! expr !!}`. */
  private readRawEcho(i: number): Node[] {
    const end = this.source.indexOf('!!}', i + 3);
    if (end === -1) {
      throw new ViewParseException(`Unclosed {!! expression near offset ${i}`);
    }
    const expr = this.source.slice(i + 3, end);
    this.pos = end + 3;
    return [{ type: 'echo', expr: expr.trim(), escape: false }];
  }

  private findEchoEnd(from: number, closer: string): number {
    let i = from;
    while (i < this.source.length) {
      if (this.source.startsWith(closer, i)) {
        return i;
      }
      if (this.source[i] === "'" || this.source[i] === '"' || this.source[i] === '`') {
        const next = skipString(this.source, i);
        i = next === -1 ? this.source.length : next;
        continue;
      }
      i++;
    }
    return -1;
  }

  // -------------------------------------------------------------------------
  // Directive dispatch
  // -------------------------------------------------------------------------

  private readDirective(name: string, at: number, stops: Set<string>): Node[] | 'stop' {
    const lower = name.toLowerCase();
    const afterName = at + name.length + 1;

    if (stops.has(lower)) {
      // Only argument-taking terminators parse parentheses; `@show(stop)`
      // must not eat the following text as arguments.
      const takesArgs = lower === 'elseif' || lower === 'case' || lower === 'slot';
      const args = takesArgs ? this.scanArgs(afterName) : null;
      let end = args ? args.end : afterName;
      if (lower === 'default' && this.source[end] === ':') {
        end++; // @default: form
      }
      this.pendingTerminator = { name: lower, args: args?.value };
      this.pos = end;
      return 'stop';
    }

    switch (lower) {
      case 'if':
        return this.readIf(afterName);
      case 'unless':
        return this.readUnless(afterName);
      case 'isset':
        return this.readDefinedCheck(afterName, 'isset');
      case 'empty':
        return this.readDefinedCheck(afterName, 'empty');
      case 'for':
        return this.readFor(afterName);
      case 'foreach':
        return this.readForeach(afterName);
      case 'while':
        return this.readWhile(afterName);
      case 'switch':
        return this.readSwitch(afterName);
      case 'break':
      case 'continue':
        return this.readControl(afterName, lower);
      case 'extends':
        return this.readExtends(afterName);
      case 'section':
        return this.readSection(afterName);
      case 'yield':
        return this.readYield(afterName);
      case 'parent': {
        const args = this.scanArgs(afterName);
        this.pos = args ? args.end : afterName;
        return [{ type: 'parent' }];
      }
      case 'hassection':
        return this.readSectionCheck(afterName, false);
      case 'sectionmissing':
        return this.readSectionCheck(afterName, true);
      case 'include':
        return this.readInclude(afterName, 'include');
      case 'includeif':
        return this.readInclude(afterName, 'includeIf');
      case 'includewhen':
        return this.readInclude(afterName, 'includeWhen');
      case 'includeunless':
        return this.readInclude(afterName, 'includeUnless');
      case 'includefirst':
        return this.readIncludeFirst(afterName);
      case 'each':
        return this.readEach(afterName);
      case 'push':
        return this.readPush(afterName, 'push');
      case 'pushonce':
        return this.readPush(afterName, 'pushOnce');
      case 'prepend':
        return this.readPush(afterName, 'prepend');
      case 'stack':
        return this.readStack(afterName);
      case 'once':
        return this.readOnce(afterName);
      case 'component':
        return this.readComponent(afterName);
      case 'props': {
        const expr = this.requireArgs(afterName, 'props');
        return [{ type: 'props', expr }];
      }
      case 'csrf': {
        this.pos = afterName;
        return [{ type: 'csrf' }];
      }
      case 'method': {
        const expr = this.requireArgs(afterName, 'method');
        return [{ type: 'method', expr }];
      }
      case 'error':
        return this.readError(afterName);
      case 'php':
        return this.readPhp(afterName);
      case 'verbatim':
        return this.readVerbatim(afterName);
      case 'json': {
        const expr = this.requireArgs(afterName, 'json');
        return [{ type: 'json', expr }];
      }
      case 'class': {
        const expr = this.requireArgs(afterName, 'class');
        return [{ type: 'attrJoin', helper: 'class', expr }];
      }
      case 'style': {
        const expr = this.requireArgs(afterName, 'style');
        return [{ type: 'attrJoin', helper: 'style', expr }];
      }
      case 'checked':
      case 'selected':
      case 'disabled':
      case 'readonly':
      case 'required': {
        const expr = this.requireArgs(afterName, lower);
        return [{ type: 'flag', attribute: lower, expr }];
      }
      case 'lang': {
        const args = this.requireArgs(afterName, 'lang');
        const parts = splitArgs(args);
        return [{ type: 'lang', expr: parts[0] ?? "''", replace: parts[1] }];
      }
      case 'choice': {
        const args = this.requireArgs(afterName, 'choice');
        const parts = splitArgs(args);
        if (parts.length < 2) {
          throw new ViewParseException('@choice expects @choice(key, number[, replace])');
        }
        return [{ type: 'choice', expr: parts[0], number: parts[1], replace: parts[2] }];
      }
      default:
        return this.readCustomDirective(name, afterName, lower);
    }
  }

  /**
   * Unknown directives compile to a DirectiveNode; the renderer executes the
   * registered handler (View.directive) or falls back to the original text,
   * exactly like Blade leaving unknown tags untouched. Keeping resolution at
   * render time also makes the compiled cache independent of registration
   * order.
   */
  private readCustomDirective(original: string, afterName: number, lower: string): Node[] {
    if (lower === 'default' && this.source[afterName] === ':') {
      this.pos = afterName + 1;
      return [{ type: 'text', value: this.source.slice(afterName - original.length - 1, this.pos) }];
    }

    // Stray closers (`@endif` without `@if`, `@slot` outside a component,
    // `@show` with no section ...) stay literal text, like Blade.
    const args = this.scanArgs(afterName);
    const end = args ? args.end : afterName;

    if (CLOSE_ONLY.has(lower) || (lower === 'default' && !args)) {
      this.pos = end;
      return [{ type: 'text', value: this.source.slice(afterName - original.length - 1, end) }];
    }

    this.pos = end;
    return [{ type: 'directive', name: original, args: args?.value }];
  }

  // -- control flow -----------------------------------------------------------

  private readIf(afterName: number): Node[] {
    const first = this.requireArgs(afterName, 'if');
    const branches: Array<{ test: string | null; body: Node[] }> = [{ test: first, body: [] }];

    for (;;) {
      const { nodes, terminator } = this.parseNodes(new Set(['else', 'elseif', 'endif']));
      branches[branches.length - 1].body = nodes;

      if (!terminator) {
        throw new ViewParseException('Unclosed @if: missing @endif');
      }
      if (terminator.name === 'endif') {
        break;
      }
      if (terminator.name === 'elseif') {
        if (terminator.args === undefined) {
          throw new ViewParseException('@elseif requires a condition');
        }
        branches.push({ test: terminator.args, body: [] });
      } else {
        branches.push({ test: null, body: [] });
      }
    }

    return [{ type: 'if', branches }];
  }

  private readUnless(afterName: number): Node[] {
    const cond = this.requireArgs(afterName, 'unless');
    return this.readBlockAsIf(`!(${cond})`, ['else', 'endunless'], 'unless');
  }

  private readDefinedCheck(afterName: number, kind: 'isset' | 'empty'): Node[] {
    const args = this.requireArgs(afterName, kind);
    const test = splitArgs(args)
      .map((arg) => `${kind}(${arg})`)
      .join(' && ');
    return this.readBlockAsIf(test, ['else', `end${kind}`], kind);
  }

  /** Shared @unless / @isset / @empty shape: one test, optional @else, closer. */
  private readBlockAsIf(test: string, stops: string[], label: string): Node[] {
    const branches: Array<{ test: string | null; body: Node[] }> = [{ test, body: [] }];

    for (;;) {
      const { nodes, terminator } = this.parseNodes(new Set(stops));
      branches[branches.length - 1].body = nodes;
      if (!terminator) {
        throw new ViewParseException(`Unclosed @${label}: missing @end${label}`);
      }
      if (terminator.name.startsWith('end')) {
        break;
      }
      branches.push({ test: null, body: [] });
    }

    return [{ type: 'if', branches }];
  }

  private readFor(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'for');
    const parts = splitStatements(args, ';');

    if (parts.length !== 3 && !(parts.length === 2 && args.trim().endsWith(';'))) {
      throw new ViewParseException('@for expects three semicolon-separated clauses: @for(init; test; update)');
    }

    const { nodes, terminator } = this.parseNodesUntil('endfor', '@for');
    this.pos = terminator;
    return [{ type: 'for', init: parts[0] ?? '', test: parts[1] ?? '', update: parts[2] ?? '', body: nodes }];
  }

  private readForeach(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'foreach');
    const asMatch = splitAs(args);
    if (!asMatch) {
      throw new ViewParseException('@foreach expects the "collection as $item" syntax');
    }

    const { nodes, terminator } = this.parseNodesUntil('endforeach', '@foreach');
    this.pos = terminator;
    return [{ type: 'foreach', source: asMatch.source, value: asMatch.value, key: asMatch.key, body: nodes }];
  }

  private readWhile(afterName: number): Node[] {
    const test = this.requireArgs(afterName, 'while');
    const { nodes, terminator } = this.parseNodesUntil('endwhile', '@while');
    this.pos = terminator;
    return [{ type: 'while', test, body: nodes }];
  }

  private readSwitch(afterName: number): Node[] {
    const subject = this.requireArgs(afterName, 'switch');
    const cases: SwitchNode['cases'] = [];
    let current: SwitchNode['cases'][number] | null = null;

    for (;;) {
      const { nodes, terminator } = this.parseNodes(new Set(['case', 'default', 'endswitch']));
      if (current) {
        current.body = nodes;
      }

      if (!terminator) {
        throw new ViewParseException('Unclosed @switch: missing @endswitch');
      }
      if (terminator.name === 'endswitch') {
        break;
      }
      if (terminator.name === 'case') {
        const tests = splitArgs(terminator.args ?? '').filter((t) => t !== '');
        if (tests.length === 0) {
          throw new ViewParseException('@case requires at least one value');
        }
        current = { tests, body: [] };
      } else {
        current = { tests: null, body: [] };
      }
      cases.push(current);
    }

    return [{ type: 'switch', expr: subject, cases }];
  }

  private readControl(afterName: number, action: 'break' | 'continue'): Node[] {
    const args = this.scanArgs(afterName);
    this.pos = args ? args.end : afterName;
    const trimmed = args?.value.trim();
    return [{ type: 'control', action, levels: trimmed ? trimmed : undefined }];
  }

  // -- layouts -----------------------------------------------------------------

  private readExtends(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'extends');
    const parts = splitArgs(args);
    return [{ type: 'extends', view: parts[0], data: parts[1] }];
  }

  private readSection(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'section');
    const parts = splitArgs(args);
    const name = parts[0];

    if (parts.length > 1) {
      // Inline form: @section('title', 'value')
      return [{ type: 'section', name, inline: parts.slice(1).join(','), body: [], mode: 'stop' }];
    }

    const { nodes, terminator } = this.parseNodes(new Set(['endsection', 'stop', 'show', 'append', 'overwrite']));
    if (!terminator) {
      throw new ViewParseException('Unclosed @section: missing @endsection');
    }

    const mode =
      terminator.name === 'endsection' || terminator.name === 'stop'
        ? 'stop'
        : (terminator.name as 'show' | 'append' | 'overwrite');
    return [{ type: 'section', name, body: nodes, mode }];
  }

  private readYield(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'yield');
    const parts = splitArgs(args);
    return [{ type: 'yield', name: parts[0], default: parts[1] }];
  }

  private readSectionCheck(afterName: number, missing: boolean): Node[] {
    const kind = missing ? 'sectionMissing' : 'hasSection';
    const args = this.requireArgs(afterName, kind);
    const parts = splitArgs(args);
    const name = parts[0];

    const { nodes: body, terminator } = this.parseNodes(new Set(['else', 'endif']));
    if (!terminator) {
      throw new ViewParseException(`Unclosed @${kind}: missing @endif`);
    }

    if (terminator.name === 'else') {
      const { nodes: elseBody, terminator: end } = this.parseNodes(new Set(['endif']));
      if (!end) {
        throw new ViewParseException(`Unclosed @${kind}: missing @endif`);
      }
      return [{ type: 'sectionCheck', name, missing, body, else: elseBody }];
    }

    return [{ type: 'sectionCheck', name, missing, body }];
  }

  // -- includes ------------------------------------------------------------------

  private readInclude(afterName: number, kind: 'include' | 'includeIf' | 'includeWhen' | 'includeUnless'): Node[] {
    const args = this.requireArgs(afterName, kind);
    const parts = splitArgs(args);

    if (kind === 'include' || kind === 'includeIf') {
      return [
        {
          type: 'include',
          view: parts[0],
          data: parts[1],
          mode: kind === 'include' ? 'include' : 'if',
        },
      ];
    }

    if (parts.length < 2) {
      throw new ViewParseException(`@${kind} requires a condition and a view name`);
    }
    return [
      {
        type: 'include',
        view: parts[1],
        data: parts[2],
        mode: kind === 'includeWhen' ? 'when' : 'unless',
        condition: parts[0],
      },
    ];
  }

  private readIncludeFirst(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'includeFirst');
    const parts = splitArgs(args);
    return [{ type: 'includeFirst', views: parts[0], data: parts[1] }];
  }

  private readEach(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'each');
    const parts = splitArgs(args);
    if (parts.length < 3) {
      throw new ViewParseException('@each expects @each(view, data, valueVar[, keyVar[, emptyView]])');
    }
    const node: EachNode = {
      type: 'each',
      view: parts[0],
      source: parts[1],
      value: parts[2] ? literalName(parts[2]) : 'item',
    };
    if (parts[3]) {
      node.key = literalName(parts[3]);
    }
    if (parts[4]) {
      node.empty = parts[4];
    }
    return [node];
  }

  // -- stacks / once / components ---------------------------------------------------

  private readPush(afterName: number, kind: 'push' | 'pushOnce' | 'prepend'): Node[] {
    const args = this.requireArgs(afterName, kind);
    const parts = splitArgs(args);

    const stops =
      kind === 'pushOnce'
        ? new Set(['endpush', 'endpushonce'])
        : kind === 'prepend'
          ? new Set(['endprepend'])
          : new Set(['endpush']);
    const { nodes, terminator } = this.parseNodes(stops);
    if (!terminator) {
      throw new ViewParseException(`Unclosed @${kind}: missing @end${kind === 'pushOnce' ? 'push' : kind}`);
    }

    return [
      {
        type: 'push',
        stack: parts[0],
        body: nodes,
        mode: kind === 'prepend' ? 'prepend' : 'push',
        once: kind === 'pushOnce',
        onceId: parts[1],
      },
    ];
  }

  private readStack(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'stack');
    const parts = splitArgs(args);
    return [{ type: 'stack', name: parts[0] }];
  }

  private readOnce(afterName: number): Node[] {
    this.pos = afterName;
    const { nodes, terminator } = this.parseNodesUntil('endonce', '@once');
    this.pos = terminator;
    return [{ type: 'once', id: String(this.onceCounter++), body: nodes }];
  }

  private readComponent(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'component');
    const parts = splitArgs(args);

    const node: ComponentNode = { type: 'component', view: parts[0], data: parts[1], slots: [], body: [] };
    const body: Node[] = [];

    for (;;) {
      const { nodes, terminator } = this.parseNodes(new Set(['slot', 'endcomponent']));
      body.push(...nodes);

      if (!terminator) {
        throw new ViewParseException('Unclosed @component: missing @endcomponent');
      }
      if (terminator.name === 'endcomponent') {
        break;
      }

      // @slot('name') ... @endslot
      const slotName = splitArgs(terminator.args ?? '')[0];
      if (!slotName) {
        throw new ViewParseException('@slot requires a name');
      }
      const inner = this.parseNodesUntil('endslot', '@slot');
      node.slots.push({ name: slotName, body: inner.nodes });
      this.pos = inner.terminator;
    }

    node.body = body;
    return [node];
  }

  // -- forms / utilities ---------------------------------------------------------------

  private readError(afterName: number): Node[] {
    const args = this.requireArgs(afterName, 'error');
    const parts = splitArgs(args);
    const field = parts[0];

    const { nodes: body, terminator } = this.parseNodes(new Set(['else', 'enderror']));
    if (!terminator) {
      throw new ViewParseException('Unclosed @error: missing @enderror');
    }

    if (terminator.name === 'else') {
      const { nodes: elseBody, terminator: end } = this.parseNodes(new Set(['enderror']));
      if (!end) {
        throw new ViewParseException('Unclosed @error: missing @enderror');
      }
      return [{ type: 'error', field, body, else: elseBody }];
    }

    return [{ type: 'error', field, body }];
  }

  private readPhp(afterName: number): Node[] {
    this.pos = afterName;
    const end = this.source.indexOf('@endphp', this.pos);
    if (end === -1) {
      throw new ViewParseException('Unclosed @php: missing @endphp');
    }
    const raw = this.source.slice(this.pos, end);
    this.pos = end + '@endphp'.length;

    const statements = splitStatements(raw, ';\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return [{ type: 'php', statements }];
  }

  private readVerbatim(afterName: number): Node[] {
    this.pos = afterName;
    const end = this.source.indexOf('@endverbatim', this.pos);
    if (end === -1) {
      throw new ViewParseException('Unclosed @verbatim: missing @endverbatim');
    }
    const raw = this.source.slice(this.pos, end);
    this.pos = end + '@endverbatim'.length;
    return [{ type: 'text', value: raw }];
  }

  // -- arg helpers -----------------------------------------------------------------------

  /** Consume `@name(args)` (given the offset just after the name). */
  private requireArgs(afterName: number, name: string): string {
    const scanned = this.scanArgs(afterName);
    if (!scanned) {
      throw new ViewParseException(`@${name} requires parenthesized arguments`);
    }
    this.pos = scanned.end;
    return scanned.value;
  }

  /**
   * If `(` immediately follows the directive name, scan the balanced,
   * string-aware argument text; returns null when there is no adjacency.
   */
  private scanArgs(afterName: number): { value: string; end: number } | null {
    if (this.source[afterName] !== '(') {
      return null;
    }
    const end = skipBalanced(this.source, afterName);
    if (end === -1) {
      throw new ViewParseException(`Unclosed arguments for directive at offset ${afterName}`);
    }
    return { value: this.source.slice(afterName + 1, end), end: end + 1 };
  }

  /** Parse a block until `stop`; resolves to the position after the closer. */
  private parseNodesUntil(stop: string, label: string): { nodes: Node[]; terminator: number } {
    const { nodes, terminator } = this.parseNodes(new Set([stop]));
    if (!terminator) {
      throw new ViewParseException(`Unclosed ${label}: missing @${stop}`);
    }
    return { nodes, terminator: this.pos };
  }
}

// ---------------------------------------------------------------------------
// Source scanning helpers (shared, string-aware)
// ---------------------------------------------------------------------------

/** Return the index after the string literal starting at `i`, or -1. */
export function skipString(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src[j] === quote) {
      return j + 1;
    }
    j++;
  }
  return -1;
}

/** Return the index of the closing bracket matching the opener at `i`, or -1. */
export function skipBalanced(src: string, i: number): number {
  const opener = src[i];
  const closer = opener === '(' ? ')' : opener === '[' ? ']' : opener === '{' ? '}' : '';
  let depth = 0;
  let j = i;

  while (j < src.length) {
    const ch = src[j];
    if (ch === "'" || ch === '"' || ch === '`') {
      const next = skipString(src, j);
      if (next === -1) {
        return -1;
      }
      j = next;
      continue;
    }
    if (ch === opener) {
      depth++;
    } else if (ch === closer) {
      depth--;
      if (depth === 0) {
        return j;
      }
    }
    j++;
  }
  return -1;
}

/** Split top-level (outside strings/brackets) arguments on commas. */
export function splitArgs(src: string): string[] {
  return splitTopLevel(src, ',');
}

/** Split on any of the given separators at nesting depth zero. */
export function splitStatements(src: string, separators: string): string[] {
  return splitTopLevel(src, ...[...separators]);
}

function splitTopLevel(src: string, ...separators: string[]): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const next = skipString(src, i);
      if (next === -1) {
        current += src.slice(i);
        break;
      }
      current += src.slice(i, next);
      i = next;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    }

    if (depth === 0 && separators.includes(ch)) {
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  parts.push(current);
  return parts.map((p) => p.trim());
}

/**
 * Parse `collection as $value` / `collection as $key => $value`, locating the
 * ` as ` separator outside strings and nested brackets.
 */
export function splitAs(args: string): { source: string; value: string; key?: string } | null {
  let depth = 0;
  let i = 0;

  while (i < args.length) {
    const ch = args[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const next = skipString(args, i);
      if (next === -1) {
        return null;
      }
      i = next;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      i++;
      continue;
    }

    if (depth === 0 && /\s/.test(ch)) {
      const match = /^\s+as\s+/.exec(args.slice(i));
      if (match) {
        const source = args.slice(0, i).trim();
        const tail = args.slice(i + match[0].length).trim();
        if (source && tail) {
          return parseAsTail(source, tail);
        }
      }
    }
    i++;
  }

  return null;
}

/**
 * Resolve @each-style variable name arguments: a quoted string ('item') or
 * a bare/$ variable-style name, mapped to the scope key it should bind.
 */
function literalName(src: string): string {
  const trimmed = src.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  if (quoted) {
    return quoted[2];
  }
  return normalizeName(trimmed);
}

function parseAsTail(source: string, tail: string): { source: string; value: string; key?: string } | null {
  // `$key => $value` form
  const arrow = findTopLevelArrow(tail);
  if (arrow !== -1) {
    const key = tail.slice(0, arrow);
    const value = tail.slice(arrow + 2);
    return { source, key: normalizeName(key), value: normalizeName(value) };
  }

  // Legacy `value, key` form supported by the original engine
  const parts = splitTopLevel(tail, ',');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { source, value: normalizeName(parts[0]), key: normalizeName(parts[1]) };
  }

  return { source, value: normalizeName(tail) };
}

function findTopLevelArrow(src: string): number {
  for (let i = 0; i < src.length - 1; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const next = skipString(src, i);
      if (next === -1) {
        return -1;
      }
      i = next - 1;
      continue;
    }
    if (src.startsWith('=>', i)) {
      return i;
    }
  }
  return -1;
}

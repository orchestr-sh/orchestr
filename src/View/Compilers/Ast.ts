/**
 * Ast - Compiled template node types.
 *
 * The Blade-compatible compiler parses view source into a plain,
 * JSON-serializable abstract syntax tree. Keeping the tree free of
 * functions/closures is what allows the compiled output to be written to
 * the disk view cache (see ViewCache) and re-read on later renders.
 *
 * Mirrors the compiled PHP Blade emits, minus the `eval`: nothing in here
 * is executable source, the CompilerEngine interprets these nodes.
 */

/** Literal markup passed through untouched. */
export interface TextNode {
  type: 'text';
  value: string;
}

/** `{{ expr }}` (escaped) or `{!! expr !!}` (raw). */
export interface EchoNode {
  type: 'echo';
  expr: string;
  escape: boolean;
}

/** `@if / @elseif / @else`; a branch with `test === null` is the else arm. */
export interface IfNode {
  type: 'if';
  branches: Array<{ test: string | null; body: Node[] }>;
}

/** `@foreach (expr as $value)` / `@foreach (expr as $key => $value)`. */
export interface ForeachNode {
  type: 'foreach';
  source: string;
  value: string;
  key?: string;
  body: Node[];
}

/** `@for (init; test; update)`. */
export interface ForNode {
  type: 'for';
  init: string;
  test: string;
  update: string;
  body: Node[];
}

/** `@while (test)`. */
export interface WhileNode {
  type: 'while';
  test: string;
  body: Node[];
}

/** `@switch` block; `tests: null` marks the `@default` arm. */
export interface SwitchNode {
  type: 'switch';
  expr: string;
  cases: Array<{ tests: string[] | null; body: Node[] }>;
}

/** `@break` / `@continue` with an optional level expression. */
export interface ControlNode {
  type: 'control';
  action: 'break' | 'continue';
  levels?: string;
}

/** `@extends('layout', data?)` - the chain renders after this file's body. */
export interface ExtendsNode {
  type: 'extends';
  view: string;
  data?: string;
}

/**
 * `@section('name') ... @endsection` (or the inline `@section('name', 'v')`
 * form). `mode` records which closing directive ended the block.
 */
export interface SectionNode {
  type: 'section';
  name: string;
  inline?: string;
  body: Node[];
  mode: 'stop' | 'show' | 'append' | 'overwrite';
}

/** `@yield('name', 'default')`. */
export interface YieldNode {
  type: 'yield';
  name: string;
  default?: string;
}

/** `@parent` - placeholder resolved from an ancestor section at yield time. */
export interface ParentNode {
  type: 'parent';
}

/** `@hasSection('x')` / `@sectionMissing('x')` with optional `@else`. */
export interface SectionCheckNode {
  type: 'sectionCheck';
  name: string;
  missing: boolean;
  body: Node[];
  else?: Node[];
}

/** `@include`, `@includeIf`, `@includeWhen`, `@includeUnless`, `@each`. */
export interface IncludeNode {
  type: 'include';
  view: string;
  data?: string;
  mode: 'include' | 'if' | 'when' | 'unless';
  condition?: string;
}

/** `@includeFirst(['a', 'b'], data?)`. */
export interface IncludeFirstNode {
  type: 'includeFirst';
  views: string;
  data?: string;
}

/** `@each('view', items, 'value', 'key?'?)`. */
export interface EachNode {
  type: 'each';
  view: string;
  source: string;
  value: string;
  key?: string;
  empty?: string;
}

/** `@push('name')` / `@pushOnce` / `@prepend('name')` blocks. */
export interface PushNode {
  type: 'push';
  stack: string;
  body: Node[];
  mode: 'push' | 'prepend';
  once?: boolean;
  onceId?: string;
}

/** `@stack('name')`. */
export interface StackNode {
  type: 'stack';
  name: string;
}

/** `@once ... @endonce`; `id` is unique per template and occurrence. */
export interface OnceNode {
  type: 'once';
  id: string;
  body: Node[];
}

/** `@component('view', data?)` with any `@slot` blocks collected. */
export interface ComponentNode {
  type: 'component';
  view: string;
  data?: string;
  slots: Array<{ name: string; body: Node[] }>;
  body: Node[];
}

/** `@props(['type' => 'info'])` inside a component view. */
export interface PropsNode {
  type: 'props';
  expr: string;
}

/** `@csrf` hidden input. */
export interface CsrfNode {
  type: 'csrf';
}

/** `@method('PUT')` hidden input. */
export interface MethodNode {
  type: 'method';
  expr: string;
}

/** `@error('field') ... @enderror`, `$message` available in the body. */
export interface ErrorNode {
  type: 'error';
  field: string;
  body: Node[];
  else?: Node[];
}

/** `@php ... @endphp`; each entry is an assignment expression. */
export interface PhpNode {
  type: 'php';
  statements: string[];
}

/** `@json(expr)`. */
export interface JsonNode {
  type: 'json';
  expr: string;
}

/** `@class([...])` / `@style([...])` attribute-string helpers. */
export interface AttrJoinNode {
  type: 'attrJoin';
  helper: 'class' | 'style';
  expr: string;
}

/** `@checked(expr)` and friends - emit the attribute name when truthy. */
export interface FlagNode {
  type: 'flag';
  attribute: string;
  expr: string;
}

/** `@lang('key')` / `@choice('key', number)`. */
export interface LangNode {
  type: 'lang';
  expr: string;
  replace?: string;
}

export interface ChoiceNode {
  type: 'choice';
  expr: string;
  number: string;
  replace?: string;
}

/**
 * A registered custom directive (`View.directive('name', handler)`).
 * Unregistered `@names` never reach here; they compile to TextNodes.
 */
export interface DirectiveNode {
  type: 'directive';
  name: string;
  args?: string;
}

export type Node =
  | TextNode
  | EchoNode
  | IfNode
  | ForeachNode
  | ForNode
  | WhileNode
  | SwitchNode
  | ControlNode
  | ExtendsNode
  | SectionNode
  | YieldNode
  | ParentNode
  | SectionCheckNode
  | IncludeNode
  | IncludeFirstNode
  | EachNode
  | PushNode
  | StackNode
  | OnceNode
  | ComponentNode
  | PropsNode
  | CsrfNode
  | MethodNode
  | ErrorNode
  | PhpNode
  | JsonNode
  | AttrJoinNode
  | FlagNode
  | LangNode
  | ChoiceNode
  | DirectiveNode;

export type TemplateAst = Node[];

import { describe, it, expect, beforeEach } from 'vitest';
import { CompilerEngine, HtmlString } from '@/View/Engines/CompilerEngine';

/**
 * Blade-compatible compiler: parsing, control flow, echoes and directives.
 * Everything here renders from a source string; file-backed behavior
 * (layouts, includes, cache) lives in the sibling suites.
 */
describe('CompilerEngine', () => {
  let engine: CompilerEngine;

  beforeEach(() => {
    engine = new CompilerEngine();
  });

  describe('{{ }} and {!! !!} echoes', () => {
    it('outputs escaped values', async () => {
      expect(await engine.renderString('{{ name }}', { name: 'John' })).toBe('John');
    });

    it('escapes HTML characters in {{ }}', async () => {
      expect(await engine.renderString('{{ html }}', { html: '<script>alert("xss")</script>' })).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('escapes single quotes like Blade e()', async () => {
      expect(await engine.renderString('{{ q }}', { q: "it's" })).toBe('it&#039;s');
    });

    it('does not escape {!! !!}', async () => {
      expect(await engine.renderString('{!! html !!}', { html: '<b>Bold</b>' })).toBe('<b>Bold</b>');
    });

    it('evaluates arithmetic expressions', async () => {
      expect(await engine.renderString('{{ x + y * 2 }}', { x: 2, y: 3 })).toBe('8');
    });

    it('renders undefined variables as empty strings', async () => {
      expect(await engine.renderString('{{ missing }}', {})).toBe('');
    });

    it('renders null as an empty string and booleans Blade-style', async () => {
      expect(await engine.renderString('{{ a }}|{{ b }}|{{ c }}', { a: null, b: true, c: false })).toBe('|1|');
    });

    it('supports the ?? ternary and member access', async () => {
      expect(await engine.renderString('{{ user.name ?? "guest" }}', { user: {} })).toBe('guest');
      expect(await engine.renderString('{{ user?.name }}', {})).toBe('');
    });

    it('echoes HtmlString values without escaping', async () => {
      const html = await engine.renderString('{{ body }}', { body: new HtmlString('<p>hi</p>') });
      expect(html).toBe('<p>hi</p>');
    });
  });

  describe('@if / @elseif / @else / @endif', () => {
    it('renders truthy and falsy branches', async () => {
      expect(await engine.renderString('@if(show)Visible@endif', { show: true })).toBe('Visible');
      expect(await engine.renderString('@if(show)Hidden@endif', { show: false })).toBe('');
    });

    it('handles @else and @elseif chains', async () => {
      const template = '@if(type === "a")A@elseif(type === "b")B@else other@endif';
      expect(await engine.renderString(template, { type: 'a' })).toBe('A');
      expect(await engine.renderString(template, { type: 'b' })).toBe('B');
      expect(await engine.renderString(template, { type: 'c' })).toBe(' other');
    });

    it('handles deeply nested @if blocks', async () => {
      const template = '@if(a)@if(b)@if(c)abc@endif@endif@endif';
      expect(await engine.renderString(template, { a: true, b: true, c: true })).toBe('abc');
      expect(await engine.renderString(template, { a: true, b: true, c: false })).toBe('');
      expect(await engine.renderString(template, { a: false, b: true, c: true })).toBe('');
    });

    it('mixes @if/@else at multiple nesting levels', async () => {
      const template = '@if(a)@if(b)AB@else A-only @endif@else none@endif';
      expect(await engine.renderString(template, { a: true, b: false })).toBe(' A-only ');
      expect(await engine.renderString(template, { a: false })).toBe(' none');
    });
  });

  describe('@unless / @isset / @empty', () => {
    it('@unless negates the condition and supports @else', async () => {
      expect(await engine.renderString('@unless($admin)guest@else host@endunless', { admin: 0 })).toBe('guest');
      expect(await engine.renderString('@unless($admin)guest@else host@endunless', { admin: 1 })).toBe(' host');
    });

    it('@isset checks all variables', async () => {
      expect(await engine.renderString('@isset(a, b)both@else incomplete@endisset', { a: 1, b: 2 })).toBe('both');
      expect(await engine.renderString('@isset(a, b)both@else incomplete@endisset', { a: 1 })).toBe(' incomplete');
    });

    it('@isset does not explode on missing variables', async () => {
      expect(await engine.renderString('@isset(deeply.nested.thing)y@else n@endisset', {})).toBe(' n');
    });

    it('@empty catches empty values and PHP-ish zeros', async () => {
      expect(await engine.renderString('@empty(v)empty!@endempty', { v: [] })).toBe('empty!');
      expect(await engine.renderString('@empty(v)empty!@endempty', { v: '0' })).toBe('empty!');
      expect(await engine.renderString('@empty(v)empty!@endempty', { v: [1] })).toBe('');
    });
  });

  describe('@foreach / @for / @while', () => {
    it('iterates arrays', async () => {
      expect(
        await engine.renderString('@foreach(items as item){{ item }}@endforeach', { items: ['a', 'b', 'c'] })
      ).toBe('abc');
    });

    it('iterates with the key => value syntax', async () => {
      const out = await engine.renderString('@foreach($items as $index => $item){{ $index }}:{{ item }}@endforeach', {
        items: ['x', 'y'],
      });
      expect(out).toBe('0:x1:y');
    });

    it('iterates with the legacy "value, key" syntax', async () => {
      const out = await engine.renderString('@foreach(items as item, idx){{ idx }}:{{ item }} @endforeach', {
        items: ['a', 'b'],
      });
      expect(out).toBe('0:a 1:b ');
    });

    it('iterates objects and strings of entries', async () => {
      expect(
        await engine.renderString('@foreach(obj as val, key){{ key }}={{ val }} @endforeach', { obj: { x: 1, y: 2 } })
      ).toBe('x=1 y=2 ');
    });

    it('handles empty and undefined iterables gracefully', async () => {
      expect(await engine.renderString('@foreach(items as item){{ item }}@endforeach', { items: [] })).toBe('');
      expect(await engine.renderString('@foreach(missing as item){{ item }}@endforeach', {})).toBe('');
    });

    it('exposes the $loop variable', async () => {
      const out = await engine.renderString(
        '@foreach(items as item){{ $loop->index }}/{{ $loop->iteration }}/{{ $loop->first ? "F" : "-" }}/{{ $loop->last ? "L" : "-" }}/{{ $loop->count }};@endforeach',
        { items: ['a', 'b'] }
      );
      expect(out).toBe('0/1/F/-/2;1/2/-/L/2;');
    });

    it('supports nested loops and loops over nested data', async () => {
      const out = await engine.renderString(
        '@foreach(rows as row)@foreach(row as cell)[{{ cell }}]@endforeach|@endforeach',
        {
          rows: [[1, 2], [3]],
        }
      );
      expect(out).toBe('[1][2]|[3]|');
    });

    it('supports @for with assignment and increment clauses', async () => {
      expect(await engine.renderString('@for($i = 0; $i < 3; $i++){{ $i }}@endfor')).toBe('012');
      expect(await engine.renderString('@for(i = 1; i <= 2; i++)x@endfor')).toBe('xx');
    });

    it('supports @while with @php state', async () => {
      const out = await engine.renderString(
        '@php $n = 3 @endphp@while($n > 0)[{{ $n }}]@php $n = $n - 1 @endphp@endwhile'
      );
      expect(out).toBe('[3][2][1]');
    });

    it('breaks and continues loops', async () => {
      expect(
        await engine.renderString('@foreach(items as i)@if(i == 3)@break@endif{{ i }},@endforeach', {
          items: [1, 2, 3, 4],
        })
      ).toBe('1,2,');
      expect(
        await engine.renderString('@foreach(items as i)@if(i == 2)@continue@endif{{ i }},@endforeach', {
          items: [1, 2, 3],
        })
      ).toBe('1,3,');
    });

    it('honors multi-level @break(n) / @continue(n)', async () => {
      const out = await engine.renderString(
        '@foreach(a as x)@foreach(b as y)@if(y == 2)@break(2)@endif{{ x }}{{ y }};@endforeach@endforeach',
        { a: [1, 2], b: [1, 2, 3] }
      );
      expect(out).toBe('11;');

      const skip = await engine.renderString(
        '@foreach(a as x)@foreach(b as y)@if(y == 2)@continue(2)@endif{{ x }}{{ y }};@endforeach@endforeach',
        { a: [1, 2], b: [1, 2] }
      );
      expect(skip).toBe('11;21;');
    });

    it('conditional @break(cond) only breaks when the condition holds', async () => {
      const out = await engine.renderString('@foreach(items as i){{ i }}@break(i == 9)@endforeach', { items: [1, 2] });
      expect(out).toBe('12');
    });
  });

  describe('@switch', () => {
    const template = '@switch($fruit)@case("apple")Apple@break@case("banana")Banana@break@default:Unknown@endswitch';

    it('matches cases and stops at @break', async () => {
      expect(await engine.renderString(template, { fruit: 'apple' })).toBe('Apple');
      expect(await engine.renderString(template, { fruit: 'banana' })).toBe('Banana');
      expect(await engine.renderString(template, { fruit: 'kiwi' })).toBe('Unknown');
    });

    it('falls through when @break is omitted (PHP semantics)', async () => {
      expect(await engine.renderString('@switch($x)@case(1)a@case(2)b@break@default z@endswitch', { x: 1 })).toBe('ab');
    });

    it('accepts multiple values per @case', async () => {
      expect(await engine.renderString('@switch($x)@case(1, 2)low@break@default high@endswitch', { x: 2 })).toBe('low');
    });

    it('compiles correctly nested inside @if and @foreach', async () => {
      const out = await engine.renderString(
        '@if(true)@foreach(items as item)@switch(item)@case(1)one@break@case(2)two@break@default:?@endswitch;@endforeach@endif',
        { items: [1, 2, 3] }
      );
      expect(out).toBe('one;two;?;');
    });
  });

  describe('comments, escapes and raw blocks', () => {
    it('strips {{-- comments --}}', async () => {
      expect(await engine.renderString('a{{-- hidden --}}b')).toBe('ab');
      expect(await engine.renderString('{{-- {{ x }} --}}', { x: 1 })).toBe('');
    });

    it('keeps {{ }} literal inside @verbatim', async () => {
      expect(await engine.renderString('@verbatim Hi {{ name }} @endverbatim', { name: 'x' })).toBe(' Hi {{ name }} ');
    });

    it('escapes the directive sigil with @@ and \\@', async () => {
      expect(await engine.renderString('@@if(x)')).toBe('@if(x)');
      expect(await engine.renderString('\\@if(x)')).toBe('@if(x)');
    });

    it('escapes echoes for client-side frameworks with @{{ }}', async () => {
      expect(await engine.renderString('@{{ message }}')).toBe('{{ message }}');
    });

    it('leaves unknown directives as literal text', async () => {
      expect(await engine.renderString('@unknownThing(1 + 2)')).toBe('@unknownThing(1 + 2)');
    });
  });

  describe('@php / @json / attribute helpers', () => {
    it('executes @php assignment statements', async () => {
      const out = await engine.renderString('@php $greeting = "hello"; $n = 1 + 1 @endphp{{ $greeting }} {{ $n }}');
      expect(out).toBe('hello 2');
    });

    it('@json outputs JSON', async () => {
      expect(await engine.renderString('@json(user)', { user: { name: 'Ada' } })).toBe('{"name":"Ada"}');
    });

    it('@class builds a class list from arrays and conditionals', async () => {
      const out = await engine.renderString("@class(['btn', 'btn-lg' => $large, 'hidden' => false])", { large: true });
      expect(out).toBe('btn btn-lg');
    });

    it('@class supports nested arrays', async () => {
      expect(await engine.renderString("@class(['a' => true, ['b', 'c' => true]])")).toBe('a b c');
    });

    it('@style builds a declaration list', async () => {
      const out = await engine.renderString("@style(['color: red', 'display' => $none])", { none: null });
      expect(out).toBe('color: red');
    });

    it('renders boolean form attributes when truthy', async () => {
      expect(await engine.renderString('@checked($on)', { on: false })).toBe('');
      expect(await engine.renderString('@checked($on)', { on: true })).toBe('checked');
      expect(await engine.renderString('@selected($on)', { on: true })).toBe('selected');
      expect(await engine.renderString('@disabled(!$on)', { on: false })).toBe('disabled');
      expect(await engine.renderString('@readonly($on)', { on: true })).toBe('readonly');
      expect(await engine.renderString('@required($on)', { on: true })).toBe('required');
    });
  });

  describe('@csrf and @method', () => {
    it('emits the CSRF hidden input from view data', async () => {
      const out = await engine.renderString('@csrf', { _token: 'abc123' });
      expect(out).toBe('<input type="hidden" name="_token" value="abc123" autocomplete="off">');
    });

    it('escapes the token value', async () => {
      const out = await engine.renderString('@csrf', { _token: 'a"b<c' });
      expect(out).toBe('<input type="hidden" name="_token" value="a&quot;b&lt;c" autocomplete="off">');
    });

    it('falls back to the configured token resolver', async () => {
      engine.setCsrfTokenResolver(() => 'from-session');
      expect(await engine.renderString('@csrf')).toContain('value="from-session"');
    });

    it('emits the method spoofing input', async () => {
      expect(await engine.renderString("@method('PUT')")).toBe('<input type="hidden" name="_method" value="PUT">');
    });
  });

  describe('@error', () => {
    it('exposes $message inside the block when the field has errors', async () => {
      const template = "@error('email')<p>{{ $message }}</p>@enderror";
      const out = await engine.renderString(template, { errors: { email: ['The email field is required.'] } });
      expect(out).toBe('<p>The email field is required.</p>');
    });

    it('renders the @else branch when valid', async () => {
      const template = "@error('email')bad@else ok@enderror";
      expect(await engine.renderString(template, { errors: {} })).toBe(' ok');
      expect(await engine.renderString(template, { errors: { email: 'oops' } })).toBe('bad');
    });
  });

  describe('@lang / @choice', () => {
    it('falls back to the key when no translator is bound', async () => {
      expect(await engine.renderString("@lang('messages.hello')")).toBe('messages.hello');
      expect(await engine.renderString("@choice('apples', 3)")).toBe('apples');
    });

    it('uses a registered translator', async () => {
      engine.setTranslator((key, number) => (key === 'apples' ? `${number} apples` : 'HELLO'));
      expect(await engine.renderString("@lang('messages.hello')")).toBe('HELLO');
      expect(await engine.renderString("@choice('apples', 3)")).toBe('3 apples');
    });
  });

  describe('custom directives', () => {
    it('renders a registered directive with evaluated args', async () => {
      engine.registerDirective('datetime', (args, ctx) => `<time>${ctx.escape(ctx.evaluate(args))}</time>`);
      expect(await engine.renderString('@datetime($published)', { published: '2026-11-16' })).toBe(
        '<time>2026-11-16</time>'
      );
    });

    it('supports argument-less directives and async handlers', async () => {
      engine.registerDirective('now', () => '12:00');
      engine.registerDirective('upper', async (args, ctx) => String(ctx.evaluate(args)).toUpperCase());
      expect(await engine.renderString('@now @upper($word)', { word: 'abc' })).toBe('12:00 ABC');
    });

    it('directive names are matched case-insensitively and unknown ones stay text', async () => {
      engine.registerDirective('Hello', () => 'hi');
      expect(await engine.renderString('@hello')).toBe('hi');
      expect(await engine.renderString('@goodbye')).toBe('@goodbye');
    });
  });

  describe('sandbox boundary', () => {
    it('cannot reach globals through identifiers', async () => {
      expect(await engine.renderString('{{ process }}{{ require }}{{ globalThis }}{{ constructor }}', {})).toBe('');
    });

    it('cannot reach Object.prototype members', async () => {
      expect(await engine.renderString('@if(missing.toString)boom@endif', {})).toBe('');
      expect(await engine.renderString('{{ undefined_thing }}', {})).toBe('');
    });

    it('calls application-provided functions on the data only', async () => {
      const out = await engine.renderString('{{ shout(word) }}', { word: 'hi', shout: (v: string) => v.toUpperCase() });
      expect(out).toBe('HI');
    });

    it('whitelisted helpers work', async () => {
      expect(
        await engine.renderString('{{ count(items) }} {{ strtoupper(word) }} {{ number_format(1234.5678, 2) }}', {
          items: [1, 2],
          word: 'x',
        })
      ).toBe('2 X 1,234.57');
    });

    it('supports the in operator', async () => {
      expect(await engine.renderString('@if("b" in letters)yes@else no@endif', { letters: ['a', 'b'] })).toBe('yes');
    });
  });

  describe('parse errors', () => {
    it('reports unclosed blocks', async () => {
      await expect(engine.renderString('@if(x)body')).rejects.toThrow(/Unclosed @if/);
      await expect(engine.renderString('@foreach(items as i)x')).rejects.toThrow(/Unclosed @foreach/);
    });

    it('reports malformed @for clauses', async () => {
      await expect(engine.renderString('@for($i = 0)@endfor')).rejects.toThrow(/@for expects three/);
    });
  });
});

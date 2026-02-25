"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const TemplateEngine_1 = require("../../src/View/Engines/TemplateEngine");
(0, vitest_1.describe)('TemplateEngine', () => {
    let engine;
    (0, vitest_1.beforeEach)(() => {
        engine = new TemplateEngine_1.TemplateEngine();
    });
    (0, vitest_1.describe)('{{ expression }}', () => {
        (0, vitest_1.it)('outputs escaped values', async () => {
            const result = await engine.compile('{{ name }}', { name: 'John' });
            (0, vitest_1.expect)(result).toBe('John');
        });
        (0, vitest_1.it)('escapes HTML characters', async () => {
            const result = await engine.compile('{{ html }}', { html: '<script>alert("xss")</script>' });
            (0, vitest_1.expect)(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        });
        (0, vitest_1.it)('handles expressions', async () => {
            const result = await engine.compile('{{ x + y }}', { x: 2, y: 3 });
            (0, vitest_1.expect)(result).toBe('5');
        });
        (0, vitest_1.it)('handles undefined as empty string', async () => {
            const result = await engine.compile('{{ missing }}', {});
            (0, vitest_1.expect)(result).toBe('');
        });
    });
    (0, vitest_1.describe)('{!! expression !!}', () => {
        (0, vitest_1.it)('outputs raw unescaped values', async () => {
            const result = await engine.compile('{!! html !!}', { html: '<b>Bold</b>' });
            (0, vitest_1.expect)(result).toBe('<b>Bold</b>');
        });
    });
    (0, vitest_1.describe)('@if / @elseif / @else / @endif', () => {
        (0, vitest_1.it)('renders truthy @if blocks', async () => {
            const result = await engine.compile('@if(show)Visible@endif', { show: true });
            (0, vitest_1.expect)(result).toBe('Visible');
        });
        (0, vitest_1.it)('skips falsy @if blocks', async () => {
            const result = await engine.compile('@if(show)Hidden@endif', { show: false });
            (0, vitest_1.expect)(result).toBe('');
        });
        (0, vitest_1.it)('handles @else', async () => {
            const result = await engine.compile('@if(show)Yes@elseNo@endif', { show: false });
            (0, vitest_1.expect)(result).toBe('No');
        });
        (0, vitest_1.it)('handles @elseif', async () => {
            const template = '@if(type === "a")A@elseif(type === "b")B@elseC@endif';
            (0, vitest_1.expect)(await engine.compile(template, { type: 'a' })).toBe('A');
            (0, vitest_1.expect)(await engine.compile(template, { type: 'b' })).toBe('B');
            (0, vitest_1.expect)(await engine.compile(template, { type: 'c' })).toBe('C');
        });
        (0, vitest_1.it)('handles nested @if', async () => {
            const template = '@if(outer)@if(inner)Both@endif@endif';
            (0, vitest_1.expect)(await engine.compile(template, { outer: true, inner: true })).toBe('Both');
            (0, vitest_1.expect)(await engine.compile(template, { outer: true, inner: false })).toBe('');
            (0, vitest_1.expect)(await engine.compile(template, { outer: false, inner: true })).toBe('');
        });
    });
    (0, vitest_1.describe)('@foreach / @endforeach', () => {
        (0, vitest_1.it)('iterates over arrays', async () => {
            const result = await engine.compile('@foreach(items as item){{ item }}@endforeach', { items: ['a', 'b', 'c'] });
            (0, vitest_1.expect)(result).toBe('abc');
        });
        (0, vitest_1.it)('iterates with key and value', async () => {
            const result = await engine.compile('@foreach(items as item, idx){{ idx }}:{{ item }} @endforeach', { items: ['a', 'b'] });
            (0, vitest_1.expect)(result).toBe('0:a 1:b ');
        });
        (0, vitest_1.it)('handles objects', async () => {
            const result = await engine.compile('@foreach(obj as val, key){{ key }}={{ val }} @endforeach', { obj: { x: 1, y: 2 } });
            (0, vitest_1.expect)(result).toBe('x=1 y=2 ');
        });
        (0, vitest_1.it)('handles empty arrays', async () => {
            const result = await engine.compile('@foreach(items as item){{ item }}@endforeach', { items: [] });
            (0, vitest_1.expect)(result).toBe('');
        });
        (0, vitest_1.it)('handles undefined iterable gracefully', async () => {
            const result = await engine.compile('@foreach(missing as item){{ item }}@endforeach', {});
            (0, vitest_1.expect)(result).toBe('');
        });
    });
    (0, vitest_1.describe)('combined directives', () => {
        (0, vitest_1.it)('uses {{ }} inside @foreach', async () => {
            const template = '@foreach(items as item)<span>{{ item }}</span>@endforeach';
            const result = await engine.compile(template, { items: ['a', 'b'] });
            (0, vitest_1.expect)(result).toBe('<span>a</span><span>b</span>');
        });
        (0, vitest_1.it)('uses {{ }} inside @if', async () => {
            const template = '@if(show)<p>{{ message }}</p>@endif';
            const result = await engine.compile(template, { show: true, message: 'Hello' });
            (0, vitest_1.expect)(result).toBe('<p>Hello</p>');
        });
    });
    (0, vitest_1.describe)('HTML escaping', () => {
        (0, vitest_1.it)('escapes &', async () => {
            const result = await engine.compile('{{ val }}', { val: 'a&b' });
            (0, vitest_1.expect)(result).toContain('&amp;');
        });
        (0, vitest_1.it)('escapes <>', async () => {
            const result = await engine.compile('{{ val }}', { val: '<div>' });
            (0, vitest_1.expect)(result).toContain('&lt;');
            (0, vitest_1.expect)(result).toContain('&gt;');
        });
        (0, vitest_1.it)('escapes quotes', async () => {
            const result = await engine.compile('{{ val }}', { val: '"hello"' });
            (0, vitest_1.expect)(result).toContain('&quot;');
        });
        (0, vitest_1.it)('escapes single quotes', async () => {
            const result = await engine.compile('{{ val }}', { val: "it's" });
            (0, vitest_1.expect)(result).toContain('&#039;');
        });
    });
});
//# sourceMappingURL=TemplateEngine.test.js.map
import { describe, it, expect, beforeEach } from 'vitest';
import { TemplateEngine } from '@/View/Engines/TemplateEngine';

describe('TemplateEngine', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  describe('{{ expression }}', () => {
    it('outputs escaped values', async () => {
      const result = await engine.compile('{{ name }}', { name: 'John' });
      expect(result).toBe('John');
    });

    it('escapes HTML characters', async () => {
      const result = await engine.compile('{{ html }}', { html: '<script>alert("xss")</script>' });
      expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('handles expressions', async () => {
      const result = await engine.compile('{{ x + y }}', { x: 2, y: 3 });
      expect(result).toBe('5');
    });

    it('handles undefined as empty string', async () => {
      const result = await engine.compile('{{ missing }}', {});
      expect(result).toBe('');
    });
  });

  describe('{!! expression !!}', () => {
    it('outputs raw unescaped values', async () => {
      const result = await engine.compile('{!! html !!}', { html: '<b>Bold</b>' });
      expect(result).toBe('<b>Bold</b>');
    });
  });

  describe('@if / @elseif / @else / @endif', () => {
    it('renders truthy @if blocks', async () => {
      const result = await engine.compile('@if(show)Visible@endif', { show: true });
      expect(result).toBe('Visible');
    });

    it('skips falsy @if blocks', async () => {
      const result = await engine.compile('@if(show)Hidden@endif', { show: false });
      expect(result).toBe('');
    });

    it('handles @else', async () => {
      const result = await engine.compile('@if(show)Yes@elseNo@endif', { show: false });
      expect(result).toBe('No');
    });

    it('handles @elseif', async () => {
      const template = '@if(type === "a")A@elseif(type === "b")B@elseC@endif';
      expect(await engine.compile(template, { type: 'a' })).toBe('A');
      expect(await engine.compile(template, { type: 'b' })).toBe('B');
      expect(await engine.compile(template, { type: 'c' })).toBe('C');
    });

    it('handles nested @if', async () => {
      const template = '@if(outer)@if(inner)Both@endif@endif';
      expect(await engine.compile(template, { outer: true, inner: true })).toBe('Both');
      expect(await engine.compile(template, { outer: true, inner: false })).toBe('');
      expect(await engine.compile(template, { outer: false, inner: true })).toBe('');
    });
  });

  describe('@foreach / @endforeach', () => {
    it('iterates over arrays', async () => {
      const result = await engine.compile('@foreach(items as item){{ item }}@endforeach', { items: ['a', 'b', 'c'] });
      expect(result).toBe('abc');
    });

    it('iterates with key and value', async () => {
      const result = await engine.compile('@foreach(items as item, idx){{ idx }}:{{ item }} @endforeach', {
        items: ['a', 'b'],
      });
      expect(result).toBe('0:a 1:b ');
    });

    it('handles objects', async () => {
      const result = await engine.compile('@foreach(obj as val, key){{ key }}={{ val }} @endforeach', {
        obj: { x: 1, y: 2 },
      });
      expect(result).toBe('x=1 y=2 ');
    });

    it('handles empty arrays', async () => {
      const result = await engine.compile('@foreach(items as item){{ item }}@endforeach', { items: [] });
      expect(result).toBe('');
    });

    it('handles undefined iterable gracefully', async () => {
      const result = await engine.compile('@foreach(missing as item){{ item }}@endforeach', {});
      expect(result).toBe('');
    });
  });

  describe('combined directives', () => {
    it('uses {{ }} inside @foreach', async () => {
      const template = '@foreach(items as item)<span>{{ item }}</span>@endforeach';
      const result = await engine.compile(template, { items: ['a', 'b'] });
      expect(result).toBe('<span>a</span><span>b</span>');
    });

    it('uses {{ }} inside @if', async () => {
      const template = '@if(show)<p>{{ message }}</p>@endif';
      const result = await engine.compile(template, { show: true, message: 'Hello' });
      expect(result).toBe('<p>Hello</p>');
    });
  });

  describe('HTML escaping', () => {
    it('escapes &', async () => {
      const result = await engine.compile('{{ val }}', { val: 'a&b' });
      expect(result).toContain('&amp;');
    });

    it('escapes <>', async () => {
      const result = await engine.compile('{{ val }}', { val: '<div>' });
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    it('escapes quotes', async () => {
      const result = await engine.compile('{{ val }}', { val: '"hello"' });
      expect(result).toContain('&quot;');
    });

    it('escapes single quotes', async () => {
      const result = await engine.compile('{{ val }}', { val: "it's" });
      expect(result).toContain('&#039;');
    });
  });
});

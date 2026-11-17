/**
 * Markdown converter subset used by markdown() mail bodies.
 */

import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '@/Mail/Markdown';

describe('markdownToHtml', () => {
  it('renders headings at every level', () => {
    expect(markdownToHtml('# One')).toBe('<h1>One</h1>');
    expect(markdownToHtml('### Three ##')).toBe('<h3>Three</h3>');
  });

  it('wraps paragraphs and joins soft breaks', () => {
    expect(markdownToHtml('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('renders strong and emphasis', () => {
    expect(markdownToHtml('**bold** and *italic*')).toBe('<p><strong>bold</strong> and <em>italic</em></p>');
    expect(markdownToHtml('__under__ _snake_')).toBe('<p><strong>under</strong> <em>snake</em></p>');
  });

  it('renders links and images', () => {
    expect(markdownToHtml('[shop](https://shop.test)')).toBe('<p><a href="https://shop.test">shop</a></p>');
    expect(markdownToHtml('![logo](https://cdn.test/logo.png)')).toBe(
      '<p><img alt="logo" src="https://cdn.test/logo.png"></p>'
    );
  });

  it('keeps code spans verbatim and fenced blocks escaped', () => {
    expect(markdownToHtml('run `npm install` now')).toBe('<p>run <code>npm install</code> now</p>');
    expect(markdownToHtml('```\n<b>raw</b>\n```')).toBe('<pre><code>&lt;b&gt;raw&lt;/b&gt;</code></pre>');
  });

  it('renders bullet and numbered lists', () => {
    expect(markdownToHtml('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(markdownToHtml('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
  });

  it('renders blockquotes and rules', () => {
    expect(markdownToHtml('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>');
    expect(markdownToHtml('---')).toBe('<hr>');
  });

  it('escapes html in the source', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
});

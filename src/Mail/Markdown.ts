/**
 * Markdown - the minimal converter behind `Mailable::markdown()`.
 *
 * Laravel renders Markdown mail templates with the `erusev/parsedown`
 * package; orchestr keeps mail free of external dependencies, so this is
 * a small, single-pass renderer covering the subset templates actually
 * use: ATX headings, paragraphs (soft line breaks included), bold,
 * italic, inline code, fenced code blocks, links, images, ordered and
 * unordered lists, blockquotes and horizontal rules. Anything outside
 * that subset passes through escaped.
 */

/** Escape HTML-significant characters (text is treated as Markdown, never raw HTML). */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline pass: code spans first (their content stays verbatim), then emphasis and links. */
function renderInline(text: string): string {
  const codes: string[] = [];

  let out = escapeHtml(text).replace(/`([^`]+)`/gu, (_match, code: string) => {
    codes.push(`<code>${code}</code>`);

    return `\uE000${codes.length - 1}\uE001`;
  });

  out = out
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/gu, (_m, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/gu, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/gu, '$1<em>$2</em>');

  // Private-use markers restore the stashed code spans; anything else
  // (a stray marker without an entry) survives untouched.
  return out.replace(/\uE000(\d+)\uE001/gu, (match, index: string) => codes[Number(index)] ?? match);
}

/**
 * Convert Markdown source into an HTML fragment. Output is intentionally
 * email-safe: block elements only, no styles or scripts of any kind.
 */
export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const html: string[] = [];

  let index = 0;

  const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === '';

  while (index < lines.length) {
    const line = lines[index];

    if (isBlank(line)) {
      index++;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/u);

    if (fence) {
      const body: string[] = [];
      index++;

      while (index < lines.length && !/^```\s*$/u.test(lines[index])) {
        body.push(lines[index]);
        index++;
      }

      index++; // closing fence
      html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      html.push('<hr>');
      index++;
      continue;
    }

    // ATX heading
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/u);

    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    // Blockquote
    if (/^>\s?/u.test(line)) {
      const quoted: string[] = [];

      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/u, ''));
        index++;
      }

      html.push(`<blockquote>${markdownToHtml(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    // Lists (unordered and ordered), one nesting level deep at most
    const bullet = line.match(/^\s*[-*+]\s+/u);
    const ordered = line.match(/^\s*\d+[.)]\s+/u);

    if (bullet || ordered) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index];
        const starts = bullet ? /^\s*[-*+]\s+/u.test(current) : /^\s*\d+[.)]\s+/u.test(current);

        if (!starts && !(items.length > 0 && /^\s+\S/u.test(current) && !isBlank(current))) {
          break;
        }

        items.push(current.replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, ''));
        index++;
      }

      const tag = bullet ? 'ul' : 'ol';
      html.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // Paragraph: consecutive non-blank lines that open no other block
    const paragraph: string[] = [];

    while (
      index < lines.length &&
      !isBlank(lines[index]) &&
      !/^(?:#{1,6}\s|```|>|\s*(?:-{3,}|\*{3,}|_{3,})\s*$|\s*[-*+]\s+|\s*\d+[.)]\s+)/u.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index++;
    }

    html.push(`<p>${paragraph.map((each) => renderInline(each)).join('<br>')}</p>`);
  }

  return html.join('\n');
}

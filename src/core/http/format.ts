/**
 * Indents XML for display. Text is only re-indented between tags: declarations, comments,
 * CDATA and text content are kept as written, and input that is not well nested is returned
 * unchanged.
 */
export function prettyXml(xml: string, indent = '  '): string {
  const tokens = xml.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g);
  if (!tokens) return xml;
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith('<')) {
      if (t.trim()) out.push(indent.repeat(depth) + t.trim());
      continue;
    }
    if (/^<\//.test(t)) {
      depth--;
      if (depth < 0) return xml;
      out.push(indent.repeat(depth) + t);
    } else if (/^<[?!]/.test(t) || /\/>$/.test(t)) out.push(indent.repeat(depth) + t);
    else {
      // <a>text</a> stays on one line.
      const text = tokens[i + 1];
      const close = tokens[i + 2];
      if (text && !text.startsWith('<') && close?.startsWith('</')) {
        out.push(indent.repeat(depth) + t + text.trim() + close);
        i += 2;
      } else {
        out.push(indent.repeat(depth) + t);
        depth++;
      }
    }
  }
  return depth === 0 ? out.join('\n') : xml;
}

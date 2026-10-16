import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import abbr from 'markdown-it-abbr';
import mark from 'markdown-it-mark';
import katex from 'katex';

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function richInlinePlugin(md: MarkdownIt): void {
  md.use(footnote).use(deflist).use(abbr).use(mark);
  md.inline.ruler.after('backticks', 'wiki_math', (state, silent) => {
    const start = state.pos;
    if (
      state.src[start] !== '$' ||
      state.src[start + 1] === '$' ||
      /\s/.test(state.src[start + 1] || '')
    )
      return false;
    let end = start + 1;
    while ((end = state.src.indexOf('$', end)) >= 0) {
      if (state.src[end - 1] !== '\\' && !/\s/.test(state.src[end - 1] || '')) break;
      end++;
    }
    if (end < 0 || end - start > 4097) return false;
    if (!silent) {
      const token = state.push('wiki_math', '', 0);
      token.content = state.src.slice(start + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.before('fence', 'wiki_math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const first = state.src.slice(start, state.eMarks[startLine]).trim();
    if (!first.startsWith('$$')) return false;
    let last = startLine;
    let content = first.slice(2);
    if (content.endsWith('$$') && content.length > 2) content = content.slice(0, -2);
    else {
      const parts: string[] = [];
      if (content) parts.push(content);
      let found = false;
      for (let line = startLine + 1; line < endLine; line++) {
        const text = state.src.slice(state.bMarks[line], state.eMarks[line]);
        if (text.trim().endsWith('$$')) {
          parts.push(text.replace(/\$\$\s*$/, ''));
          last = line;
          found = true;
          break;
        }
        parts.push(text);
      }
      if (!found) return false;
      content = parts.join('\n');
    }
    if (content.length > 4096) return false;
    if (!silent) {
      const token = state.push('wiki_math_block', '', 0);
      token.content = content;
      token.map = [startLine, last + 1];
    }
    state.line = last + 1;
    return true;
  });
  const math = (source: string, displayMode: boolean) => {
    try {
      return katex.renderToString(source, {
        displayMode,
        output: 'mathml',
        throwOnError: false,
        trust: false,
        maxExpand: 1000,
      });
    } catch {
      return `<code>${escape(source)}</code>`;
    }
  };
  md.renderer.rules.wiki_math = (tokens, i) => math(tokens[i].content, false);
  md.renderer.rules.wiki_math_block = (tokens, i) =>
    `<div class="math-block">${math(tokens[i].content, true)}</div>`;
  md.inline.ruler.after('wiki_math', 'wiki_keycap', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '++') return false;
    const end = state.src.indexOf('++', state.pos + 2);
    if (end < 0 || end - state.pos > 82 || end === state.pos + 2) return false;
    const value = state.src.slice(state.pos + 2, end);
    if (/\n/.test(value)) return false;
    if (!silent) {
      const token = state.push('wiki_keycap', '', 0);
      token.content = value;
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wiki_keycap = (tokens, i) => `<kbd>${escape(tokens[i].content)}</kbd>`;
  md.inline.ruler.after('wiki_keycap', 'wiki_inline_component', (state, silent) => {
    const match = /^\{(badge|button|tip|icon|emoji):([^}\n]{1,200})\}/.exec(
      state.src.slice(state.pos),
    );
    if (!match) return false;
    const kind = match[1];
    const parts = match[2].split('|');
    if ((kind === 'button' || kind === 'tip') && parts.length !== 2) return false;
    if (!silent) {
      const token = state.push(`wiki_${kind}`, '', 0);
      token.content = parts[0].trim();
      token.meta = { value: parts.slice(1).join('|').trim() };
    }
    state.pos += match[0].length;
    return true;
  });
  const symbols: Record<string, string> = {
    info: 'ℹ',
    check: '✓',
    warning: '⚠',
    star: '★',
    heart: '♥',
    arrow: '→',
    smile: '🙂',
  };
  md.renderer.rules.wiki_badge = (tokens, i) =>
    `<span class="doc-badge">${escape(tokens[i].content)}</span>`;
  md.renderer.rules.wiki_tip = (tokens, i) =>
    `<abbr class="doc-tip" title="${escape(String(tokens[i].meta.value))}">${escape(tokens[i].content)}</abbr>`;
  md.renderer.rules.wiki_icon = (tokens, i) =>
    `<span class="doc-icon" role="img" aria-label="${escape(tokens[i].content)}">${escape(symbols[tokens[i].content] || '•')}</span>`;
  md.renderer.rules.wiki_emoji = md.renderer.rules.wiki_icon;
}

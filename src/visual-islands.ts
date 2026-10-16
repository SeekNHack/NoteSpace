import { Mark, Node } from '@tiptap/core';
import { richBlockHeader } from './core/rich-blocks';

/**
 * Source islands keep Markdown that Studio does not model as structured content byte-identical.
 * Studio shows them rendered and edits their source in place. Each tokenizer mirrors the reader's
 * markdown-it rule for the same construct, so Studio and the reader agree on what is an island.
 */

export type InlineIslandKind =
  | 'keys'
  | 'math'
  | 'badge'
  | 'button'
  | 'tip'
  | 'icon'
  | 'emoji'
  | 'footnote'
  | 'reflink'
  | 'html'
  | 'media';
export type BlockIslandKind =
  'math' | 'include' | 'footnote' | 'abbr' | 'refdef' | 'deflist' | 'html' | 'container';

/** Matches one inline island at the start of `src`. */
export function matchInlineIsland(
  src: string,
): { kind: InlineIslandKind; raw: string } | undefined {
  if (src.startsWith('++')) {
    const end = src.indexOf('++', 2);
    const value = src.slice(2, end);
    if (end > 2 && end <= 82 && !/\n/.test(value))
      return { kind: 'keys', raw: src.slice(0, end + 2) };
    return undefined;
  }
  if (src[0] === '$') {
    if (src[1] === '$' || /\s/.test(src[1] || '') || !src[1]) return undefined;
    let end = 1;
    while ((end = src.indexOf('$', end)) >= 0) {
      if (src[end - 1] !== '\\' && !/\s/.test(src[end - 1] || '')) break;
      end++;
    }
    if (end < 0 || end > 4097 || src.slice(0, end).includes('\n\n')) return undefined;
    return { kind: 'math', raw: src.slice(0, end + 1) };
  }
  const component = /^\{(badge|button|tip|icon|emoji):([^}\n]{1,200})\}/.exec(src);
  if (component) {
    const parts = component[2].split('|');
    if ((component[1] === 'button' || component[1] === 'tip') && parts.length !== 2)
      return undefined;
    return { kind: component[1] as InlineIslandKind, raw: component[0] };
  }
  const footnote = /^\[\^[^\]\s]+\]/.exec(src);
  if (footnote && src[footnote[0].length] !== ':') return { kind: 'footnote', raw: footnote[0] };
  const reflink = /^!?\[[^\]\n]+\]\[[^\]\n]*\]/.exec(src);
  if (reflink) return { kind: 'reflink', raw: reflink[0] };
  const media = /^!\[[^\]\n]*\]\([^)\n]*\.(?:mp4|webm|mp3|ogg)(?:[?#][^)\n]*)?\)/i.exec(src);
  if (media) return { kind: 'media', raw: media[0] };
  const html = /^(?:<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*(?:\s[^<>\n]*)?\/?>)/.exec(src);
  if (html) return { kind: 'html', raw: html[0] };
  return undefined;
}

const lineStart = (src: string, index: number) => index === 0 || src[index - 1] === '\n';
const nextLine = (src: string, at: number) => {
  const end = src.indexOf('\n', at);
  return end < 0 ? src.length : end + 1;
};

/** Matches one block island at the start of `src` (which must be at a line start). */
export function matchBlockIsland(src: string): { kind: BlockIslandKind; raw: string } | undefined {
  const firstEnd = nextLine(src, 0);
  const first = src.slice(0, firstEnd).replace(/\r?\n$/, '');
  const take = (end: number) => src.slice(0, end);
  if (/^\s*\$\$/.test(first)) {
    const rest = first.trim().slice(2);
    if (rest.endsWith('$$') && rest.length > 2) return { kind: 'math', raw: take(firstEnd) };
    let at = firstEnd;
    while (at < src.length) {
      const end = nextLine(src, at);
      if (src.slice(at, end).trim().endsWith('$$')) return { kind: 'math', raw: take(end) };
      at = end;
    }
    return undefined;
  }
  if (/^\{\{[ \t]*include[ \t]+"[^"\n]+"[^\n]*\}\}[ \t]*$/.test(first))
    return { kind: 'include', raw: take(firstEnd) };
  if (/^\*\[[^\]\n]+\]:/.test(first)) return { kind: 'abbr', raw: take(firstEnd) };
  if (/^\[\^[^\]\n]+\]:/.test(first)) {
    let end = firstEnd;
    // Continuation lines are indented; blank lines may separate them.
    for (;;) {
      const lineEnd = nextLine(src, end);
      const line = src.slice(end, lineEnd);
      if (/^(?: {4}|\t)\S/.test(line)) end = lineEnd;
      else if (
        /^[ \t]*\r?\n$/.test(line) &&
        /^(?: {4}|\t)\S/.test(src.slice(lineEnd, nextLine(src, lineEnd)))
      )
        end = lineEnd;
      else break;
    }
    return { kind: 'footnote', raw: take(end) };
  }
  if (/^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S/.test(first))
    return { kind: 'refdef', raw: take(firstEnd) };
  if (/^ {0,3}<!--/.test(first)) {
    const close = src.indexOf('-->');
    if (close < 0) return undefined;
    return { kind: 'html', raw: take(nextLine(src, close)) };
  }
  if (/^ {0,3}<(?:[a-zA-Z][\w-]*(?:[\s/>]|$)|\/[a-zA-Z])/.test(first)) {
    let end = firstEnd;
    while (end < src.length && !/^[ \t]*\r?\n?$/.test(src.slice(end, nextLine(src, end))))
      end = nextLine(src, end);
    return { kind: 'html', raw: take(end) };
  }
  if (/^:::[a-z]/i.test(first) && !richBlockHeader(first)) {
    // Unknown or malformed container: keep it whole when it is balanced.
    let depth = 1,
      at = firstEnd,
      fence = '';
    while (at < src.length) {
      const end = nextLine(src, at);
      const line = src.slice(at, end).replace(/\r?\n$/, '');
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1];
        else if (fence[0] === fenceMatch[1][0] && fenceMatch[1].length >= fence.length) fence = '';
      } else if (!fence && /^:::[ \t]*$/.test(line)) {
        if (!--depth) return { kind: 'container', raw: take(end) };
      } else if (!fence && /^:::[a-z]/i.test(line)) depth++;
      at = end;
    }
    return undefined;
  }
  // Definition list: a term line followed (optionally after one blank line) by ": definition".
  if (first.trim() && !/^\s*(?:[#>|*+-]|\d+[.)]|:::|```|~~~)/.test(first)) {
    const secondEnd = nextLine(src, firstEnd);
    let defAt = firstEnd;
    if (/^[ \t]*\r?\n$/.test(src.slice(firstEnd, secondEnd))) defAt = secondEnd;
    if (!/^ {0,3}:[ \t]/.test(src.slice(defAt, nextLine(src, defAt)))) return undefined;
    let end = nextLine(src, defAt);
    for (;;) {
      const lineEnd = nextLine(src, end);
      const line = src.slice(end, lineEnd);
      if (!line) break;
      if (/^ {0,3}:[ \t]/.test(line) || /^(?: {2,}|\t)\S/.test(line)) {
        end = lineEnd;
        continue;
      }
      if (/^[ \t]*\r?\n$/.test(line)) {
        const after = src.slice(lineEnd, nextLine(src, lineEnd));
        if (/^ {0,3}:[ \t]|^(?: {2,}|\t)\S/.test(after)) {
          end = lineEnd;
          continue;
        }
        // Another term/definition pair after a blank line continues the list.
        const termEnd = nextLine(src, lineEnd);
        if (after.trim() && /^ {0,3}:[ \t]/.test(src.slice(termEnd, nextLine(src, termEnd)))) {
          end = lineEnd;
          continue;
        }
        break;
      }
      // A new term directly followed by a definition.
      if (line.trim() && /^ {0,3}:[ \t]/.test(src.slice(lineEnd, nextLine(src, lineEnd)))) {
        end = lineEnd;
        continue;
      }
      break;
    }
    return { kind: 'deflist', raw: take(end) };
  }
  return undefined;
}

/** First index in `src` where a block island could start (line starts only). */
function blockStart(src: string): number {
  const pattern =
    /(^|\n)(?=[ \t]*\$\$|\{\{[ \t]*include|\*\[|\[\^|[ ]{0,3}\[[^\]\n]+\]:|[ ]{0,3}<[!a-zA-Z/]|:::[a-z]|[^\n]+\n(?:[ \t]*\n)?[ ]{0,3}:[ \t])/i;
  const match = pattern.exec(src);
  if (!match) return -1;
  const index = match.index + match[1].length;
  return lineStart(src, index) ? index : -1;
}

/** `==text==`, rendered as <mark> by the reader (markdown-it-mark). */
export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML() {
    return ['mark', 0];
  },
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start(src: string) {
      return src.indexOf('==');
    },
    tokenize(src: string, _tokens, lexer) {
      const match = /^==(?=[^\s=])([\s\S]*?[^\s=])==(?!=)/.exec(src);
      if (!match || match[1].includes('\n\n')) return;
      return {
        type: 'highlight',
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark('highlight', helpers.parseInline(token.tokens || []));
  },
  renderMarkdown(node, helpers) {
    return `==${helpers.renderChildren(node)}==`;
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name) };
  },
});

export const InlineIsland = Node.create({
  name: 'inlineIsland',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',
  addAttributes() {
    return {
      source: { default: '', parseHTML: (element) => element.getAttribute('data-source') || '' },
      kind: {
        default: 'html',
        parseHTML: (element) => element.getAttribute('data-island') || 'html',
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-island]' }];
  },
  renderHTML({ node }) {
    return [
      'span',
      { 'data-island': node.attrs.kind, 'data-source': node.attrs.source, class: 'island' },
      node.attrs.source,
    ];
  },
  markdownTokenizer: {
    name: 'inlineIsland',
    level: 'inline',
    start(src: string) {
      const match =
        /\+\+|\$(?!\$)|\{(?:badge|button|tip|icon|emoji):|!?\[[^\]\n]+\]\[|\[\^|<[!/a-zA-Z]|!\[[^\]\n]*\]\([^)\n]*\.(?:mp4|webm|mp3|ogg)/i.exec(
          src,
        );
      return match ? match.index : -1;
    },
    tokenize(src: string) {
      const island = matchInlineIsland(src);
      if (!island) return;
      return { type: 'inlineIsland', raw: island.raw, kind: island.kind };
    },
  },
  parseMarkdown(token) {
    return { type: 'inlineIsland', attrs: { source: token.raw, kind: token.kind } };
  },
  renderMarkdown(node) {
    return String(node.attrs?.source || '');
  },
});

export const BlockIsland = Node.create({
  name: 'blockIsland',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      source: { default: '', parseHTML: (element) => element.getAttribute('data-source') || '' },
      kind: {
        default: 'html',
        parseHTML: (element) => element.getAttribute('data-island') || 'html',
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-island]' }];
  },
  renderHTML({ node }) {
    return [
      'div',
      { 'data-island': node.attrs.kind, 'data-source': node.attrs.source, class: 'island-block' },
      node.attrs.source,
    ];
  },
  markdownTokenizer: {
    name: 'blockIsland',
    level: 'block',
    start: blockStart,
    tokenize(src: string) {
      const island = matchBlockIsland(src);
      if (!island) return;
      return { type: 'blockIsland', raw: island.raw, kind: island.kind };
    },
  },
  parseMarkdown(token) {
    return {
      type: 'blockIsland',
      attrs: { source: String(token.raw).replace(/\s+$/, ''), kind: token.kind },
    };
  },
  renderMarkdown(node) {
    return String(node.attrs?.source || '');
  },
});

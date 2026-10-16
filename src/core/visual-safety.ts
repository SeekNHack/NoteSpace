import MarkdownIt from 'markdown-it';
import { markdown, maskInlineCode, wikiPlugin } from './markdown';
import { richInlinePlugin } from './rich-inline';
import { richBlockHeader } from './rich-blocks';

export function splitFrontmatter(source: string): { prefix: string; body: string } {
  const match = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source);
  return { prefix: match?.[0] ?? '', body: source.slice(match?.[0].length ?? 0) };
}

/** The smallest UTF-16 edit that changes only the Markdown body. */
export function planVisualBodyEdit(
  source: string,
  nextBody: string,
): { start: number; end: number; text: string } | undefined {
  const { prefix, body } = splitFrontmatter(source);
  if (body === nextBody) return undefined;
  let start = 0;
  while (start < body.length && start < nextBody.length && body[start] === nextBody[start]) start++;
  let oldEnd = body.length;
  let newEnd = nextBody.length;
  while (oldEnd > start && newEnd > start && body[oldEnd - 1] === nextBody[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    start: prefix.length + start,
    end: prefix.length + oldEnd,
    text: nextBody.slice(start, newEnd),
  };
}
/** Conversion is disabled for syntax whose preservation has not been verified. */
export function visualSafety(source: string): string | undefined {
  const { body } = splitFrontmatter(source);
  const lines = body.split(/\r?\n/);
  for (const token of markdown.parse(body, {})) {
    if ((token.type !== 'fence' && token.type !== 'code_block') || !token.map) continue;
    for (let line = token.map[0]; line < token.map[1]; line++) lines[line] = '';
  }
  const visible = lines.join('\n');
  const visibleMask = visible.split('');
  maskInlineCode(visible, visibleMask);
  const active = visibleMask.join('');
  // Known containers become Studio blocks; balanced unknown or malformed ones become source
  // islands. Only unbalanced containers remain unsafe.
  let containerDepth = 0;
  for (const line of lines) {
    if (!line.startsWith(':::')) continue;
    if (containerDepth && /^:::[ \t]*$/.test(line)) {
      containerDepth--;
      continue;
    }
    if (/^:::[a-z]/i.test(line)) {
      if (richBlockHeader(line) && containerDepth >= 4)
        return 'Containers nested more than four levels deep require Markdown source editing.';
      containerDepth++;
      continue;
    }
    return 'This page contains a stray container marker. Edit it in Markdown source.';
  }
  if (containerDepth)
    return 'This page contains an unclosed container. Edit it in Markdown source.';
  const inlineReason = inlineAtomSafety(body);
  if (inlineReason) return inlineReason;
  // Shortcut reference links (`[label]` with a definition) have no source island.
  const labels = [...active.matchAll(/^ {0,3}\[(?!\^)([^\]\n]+)\]:/gm)].map((m) =>
    m[1].toLowerCase(),
  );
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`(?<!\\])\\[${escaped}\\](?![\\[(:])`, 'i').test(
        active.replace(/^ {0,3}\[[^\]\n]+\]:.*$/gm, ''),
      )
    )
      return 'This page uses shortcut reference links. Edit it in Markdown source.';
  }
  return undefined;
}

/** Inline atoms (wiki links, source islands) cannot carry formatting marks in Studio. */
const atomTokens = new Set([
  'wiki_link',
  'wiki_math',
  'wiki_keycap',
  'wiki_badge',
  'wiki_button',
  'wiki_tip',
  'wiki_icon',
  'wiki_emoji',
  'footnote_ref',
  'html_inline',
]);
let parser: MarkdownIt | undefined;
/** Same inline syntax as the reader, with HTML tokens visible so they are checked too. */
const atomParser = () => {
  if (!parser) {
    parser = new MarkdownIt({ html: true, linkify: true });
    wikiPlugin(parser);
    richInlinePlugin(parser);
  }
  return parser;
};
function inlineAtomSafety(body: string): string | undefined {
  if (/^[ \t]*\|.*\[\[[^\]\n]*\|/m.test(body))
    return 'This page has labelled wiki links inside a table. Edit it in Markdown source.';
  for (const token of atomParser().parse(body, {})) {
    if (token.type !== 'inline' || !token.children) continue;
    let depth = 0;
    for (const child of token.children) {
      if (/_open$/.test(child.type)) depth++;
      else if (/_close$/.test(child.type)) depth--;
      else if (depth > 0 && atomTokens.has(child.type))
        return 'This page has links, math or inline components inside formatted text. Edit it in Markdown source.';
    }
  }
  return undefined;
}

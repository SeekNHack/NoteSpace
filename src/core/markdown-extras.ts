import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { daysBetween } from './tasks';

/** A block id written at the end of a paragraph or list item: `Some text ^my-block`. */
export const blockIdPattern = /[ \t]\^([A-Za-z0-9][A-Za-z0-9-]{0,31})[ \t]*$/;
/** The HTML id of a block (`^my-block` → `block-my-block`). */
export const blockAnchor = (id: string) => `block-${id}`;

/**
 * Block references: a trailing `^id` gives its paragraph (or list item) an anchor that
 * `[[Page#^id]]` links to and `![[Page#^id]]` embeds. The marker itself is not shown.
 */
export function blockIdPlugin(md: MarkdownIt): void {
  md.core.ruler.push('block_ids', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || !inline.children?.length) continue;
      const last = inline.children[inline.children.length - 1];
      if (last.type !== 'text') continue;
      const match = blockIdPattern.exec(last.content);
      if (!match) continue;
      // The paragraph, or the list item it belongs to.
      let open = tokens[i - 1];
      if (open?.type !== 'paragraph_open' && open?.type !== 'heading_open') continue;
      if (open.type === 'paragraph_open' && tokens[i - 2]?.type === 'list_item_open')
        open = tokens[i - 2];
      if (open.type === 'heading_open') continue;
      open.attrSet('id', blockAnchor(match[1]));
      last.content = last.content.slice(0, match.index);
      inline.content = inline.content.replace(blockIdPattern, '');
    }
  });
}

/** The source of a block with a `^id` marker: its paragraph or list item. */
export function blockSource(body: string, id: string): string | undefined {
  const lines = body.split('\n');
  const marker = new RegExp(`[ \\t]\\^${id.replace(/[^A-Za-z0-9-]/g, '')}[ \\t]*\\r?$`);
  const at = lines.findIndex((l) => marker.test(l));
  if (at < 0) return undefined;
  const item = /^(\s*)(?:[-*+]|\d+[.)])\s/;
  let start = at;
  if (!item.test(lines[at]))
    while (start > 0 && lines[start - 1].trim() && !item.test(lines[start - 1])) start--;
  return lines
    .slice(start, at + 1)
    .join('\n')
    .replace(marker, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
}

/** The source of a heading's section: the heading line and everything up to the next heading of its level. */
export function sectionSource(body: string, offset: number): string {
  const rest = body.slice(offset);
  const level = /^(#{1,6})\s/.exec(rest)?.[1].length || 1;
  const lines = rest.split('\n');
  let fence = '';
  let end = lines.length;
  for (let i = 1; i < lines.length; i++) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (f) fence = fence ? (f[1][0] === fence[0] ? '' : fence) : f[1];
    const h = !fence && /^(#{1,6})\s/.exec(lines[i]);
    if (h && h[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(0, end).join('\n').trimEnd();
}

const mentionPattern =
  /(^|[\s(])@(\d{4}-\d{2}-\d{2}|today|tomorrow|yesterday|[\p{L}][\p{L}\p{N}_-]*[\p{L}\p{N}])/gu;

/**
 * Mentions in text: `@2026-10-22` (or `@today`, `@tomorrow`) as a date chip that reads as
 * Today, Tomorrow or the date, and `@name` as a person chip. Task lines keep their own
 * `@person` badges (they are handled before this rule).
 */
export function mentionPlugin(md: MarkdownIt, today?: string): void {
  md.core.ruler.push('mentions', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const out: Token[] = [];
      let inLink = 0;
      for (const child of block.children) {
        if (child.type === 'link_open') inLink++;
        if (child.type === 'link_close') inLink--;
        if (child.type !== 'text' || inLink || !child.content.includes('@')) {
          out.push(child);
          continue;
        }
        let last = 0;
        const text = child.content;
        for (const m of text.matchAll(mentionPattern)) {
          const at = m.index! + m[1].length;
          if (at > last) out.push(textToken(state, text.slice(last, at)));
          const t = new state.Token('mention', '', 0);
          const value = m[2];
          const date = resolveDate(value, today);
          t.meta = date ? { kind: 'date', date } : { kind: 'person', name: value };
          t.content = `@${value}`;
          out.push(t);
          last = at + 1 + value.length;
        }
        if (!last) out.push(child);
        else if (last < text.length) out.push(textToken(state, text.slice(last)));
      }
      block.children = out;
    }
  });
}
const textToken = (state: { Token: typeof Token }, content: string) => {
  const t = new state.Token('text', '', 0);
  t.content = content;
  return t;
};
function resolveDate(value: string, today?: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!today || !/^(today|tomorrow|yesterday)$/.test(value)) return undefined;
  const shift = value === 'today' ? 0 : value === 'tomorrow' ? 1 : -1;
  return new Date(Date.parse(`${today}T12:00:00Z`) + shift * 86400000).toISOString().slice(0, 10);
}
/** How a date mention reads: Today, Tomorrow, Yesterday, in 3 days, or the date. */
export function dateLabel(date: string, today?: string): string {
  if (!today) return date;
  const d = daysBetween(today, date);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const formatted = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  return formatted;
}

/** Code annotation markers: a comment that ends with `(1)` in an `annotate` code block. */
const annotationMarker =
  /(\s*)((?:#|\/\/|--|;|%|\/\*|<!--)\s*)?\((\d{1,2})\)(!?)\s*(\*\/|-->)?\s*$/;
export const markStart = '';
export const markEnd = '';

/**
 * Prepares an annotated code block: each line's trailing `# (1)` marker (any comment style)
 * becomes a placeholder that survives highlighting. With `(1)!` the comment is removed too.
 */
export function markAnnotations(code: string): { code: string; count: number } {
  let count = 0;
  const lines = code.split('\n').map((line) => {
    const m = annotationMarker.exec(line);
    if (!m || !m[2]) return line;
    count = Math.max(count, Number(m[3]));
    const before = line.slice(0, m.index);
    const marker = `${markStart}${m[3]}${markEnd}`;
    // `(1)!` drops the comment that only holds the marker.
    if (m[4] === '!') return `${before.trimEnd()} ${marker}`;
    return `${before}${m[1]}${m[2]}${marker}${m[5] ? ` ${m[5]}` : ''}`;
  });
  return { code: lines.join('\n'), count };
}

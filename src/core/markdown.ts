import MarkdownIt from 'markdown-it';
import { parseDocument } from 'yaml';
import { Heading, Link, Page } from './model';
import { pageId, posix, slug } from './paths';
export const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
export function wikiPlugin(md: MarkdownIt): void {
  const closing = new WeakMap<object, { start: number; end: number }>();
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '[[') return false;
    const cached = closing.get(state);
    const end =
      !cached || state.pos < cached.start || (cached.end !== -1 && cached.end < state.pos + 2)
        ? state.src.indexOf(']]', state.pos + 2)
        : cached.end;
    closing.set(state, { start: state.pos, end });
    if (end < 0 || state.src.slice(state.pos, end).includes('\n')) return false;
    const value = state.src.slice(state.pos + 2, end);
    const pipe = value.indexOf('|');
    const target = (pipe < 0 ? value : value.slice(0, pipe)).trim();
    if (!target) return false;
    if (!silent) {
      const t = state.push('wiki_link', '', 0);
      t.content = pipe < 0 ? target : value.slice(pipe + 1).trim();
      t.meta = { target };
    }
    state.pos = end + 2;
    return true;
  });
}
wikiPlugin(markdown);

const isEscaped = (source: string, at: number): boolean => {
  let n = 0;
  while (at > 0 && source[--at] === '\\') n++;
  return n % 2 === 1;
};

/** Blank matched Markdown code spans without changing source offsets or line breaks. */
export function maskInlineCode(source: string, mask: string[]): void {
  const runs = [...mask.join('').matchAll(/`+/g)];
  const nextSame = new Map<number, number>(),
    closing = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    const length = runs[i][0].length;
    const next = nextSame.get(length);
    if (next !== undefined) closing.set(i, next);
    nextSame.set(length, i);
  }
  for (let i = 0; i < runs.length; i++) {
    if (isEscaped(source, runs[i].index!)) continue;
    const end = closing.get(i);
    if (end === undefined) continue;
    for (let at = runs[i].index!; at < runs[end].index! + runs[end][0].length; at++)
      if (mask[at] !== '\n' && mask[at] !== '\r') mask[at] = ' ';
    i = end;
  }
}

export function parsePage(root: string, file: string, uri: string, text: string): Page {
  let body = text,
    title: string | undefined,
    tags: string[] = [],
    draft = false,
    order: number | undefined,
    metadataError: string | undefined,
    translatedFrom: string | undefined,
    description: string | undefined;
  const metadataWarnings: string[] = [];
  let properties: Record<string, string> | undefined;
  let bodyOffset = 0;
  const fm = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (fm) {
    bodyOffset = fm[0].length;
    body = text.slice(bodyOffset);
    try {
      const doc = parseDocument(fm[1], { uniqueKeys: true });
      if (doc.errors.length) throw new Error(doc.errors[0].message);
      const data = doc.toJS({ maxAliasCount: 0 });
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const expect = (key: string, ok: boolean, type: string) => {
          if (key in data && !ok) metadataWarnings.push(`“${key}” should be ${type}`);
        };
        expect('title', typeof data.title === 'string', 'text');
        expect('description', typeof data.description === 'string', 'text');
        expect('draft', typeof data.draft === 'boolean', 'true or false');
        expect('order', typeof data.order === 'number' && Number.isFinite(data.order), 'a number');
        expect(
          'tags',
          typeof data.tags === 'string' ||
            (Array.isArray(data.tags) && data.tags.every((t: unknown) => typeof t === 'string')),
          'a list of words',
        );
        for (const [key, value] of Object.entries(data)) {
          const text =
            value === null || value === undefined
              ? ''
              : Array.isArray(value)
                ? value.filter((v) => v !== null && typeof v !== 'object').join(', ')
                : value instanceof Date
                  ? value.toISOString().slice(0, 10)
                  : typeof value === 'object'
                    ? '[object]'
                    : String(value);
          (properties ||= {})[key] = text;
        }
        if (typeof data.translated_from === 'string') translatedFrom = data.translated_from;
        if (typeof data.description === 'string') description = data.description;
        if (typeof data.title === 'string') title = data.title;
        if (typeof data.draft === 'boolean') draft = data.draft;
        if (typeof data.order === 'number' && Number.isFinite(data.order)) order = data.order;
        if (Array.isArray(data.tags))
          tags = data.tags.filter((t: unknown): t is string => typeof t === 'string');
        else if (typeof data.tags === 'string')
          tags = data.tags
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
      }
    } catch (e) {
      metadataError = e instanceof Error ? e.message : String(e);
    }
  }
  const tokens = markdown.parse(body, {});
  const lines = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === '\n') lines.push(i + 1);
  const mask = body.split('');
  const blank = (a: number, b: number) => {
    for (let i = a; i < b; i++) if (mask[i] !== '\n' && mask[i] !== '\r') mask[i] = ' ';
  };
  const headings: Heading[] = [],
    used = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (['fence', 'code_block', 'html_block'].includes(t.type) && t.map)
      blank(lines[t.map[0]], lines[t.map[1]] ?? body.length);
    if (t.type === 'heading_open' && t.map) {
      const inline = tokens[i + 1];
      const content =
        inline.children
          ?.filter((t) => ['text', 'code_inline', 'wiki_link', 'image'].includes(t.type))
          .map((t) => t.content)
          .join('') || inline.content;
      const base = slug(content);
      let id = base,
        n = 0;
      while (used.has(id)) id = `${base}-${++n}`;
      used.add(id);
      headings.push({
        text: content,
        slug: id,
        level: Number(t.tag.slice(1)),
        offset: bodyOffset + lines[t.map[0]],
      });
    }
  }
  maskInlineCode(body, mask);
  let masked = mask.join('');
  for (let start = masked.indexOf('<!--'); start >= 0;) {
    const end = masked.indexOf('-->', start + 4);
    if (end < 0) break;
    blank(start, end + 3);
    start = masked.indexOf('<!--', end + 3);
  }
  masked = mask.join('');
  const references = new Map<string, { target: string; start: number; end: number }>();
  const normalizeReference = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
  for (const match of masked.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/gm)) {
    if (match[1].startsWith('^')) continue;
    const target = match[2] ?? match[3],
      start = match.index! + match[0].lastIndexOf(target);
    const key = normalizeReference(match[1]);
    if (!references.has(key))
      references.set(key, {
        target,
        start: start + bodyOffset,
        end: start + target.length + bodyOffset,
      });
    blank(match.index!, match.index! + match[0].length);
  }
  masked = mask.join('');
  const links: Link[] = [];
  // Searches only move forward, avoiding quadratic scans of malformed bracket runs.
  const cursors = new Map<string, number>();
  const next = (marker: string, start: number): number => {
    let position = cursors.get(marker);
    if (position === undefined || (position !== -1 && position < start)) {
      position = masked.indexOf(marker, start);
      cursors.set(marker, position);
    }
    return position;
  };
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '[' || isEscaped(body, i)) continue;
    if (masked[i + 1] === '[') {
      const end = next(']]', i + 2),
        newline = next('\n', i);
      if (end < 0 || (newline >= 0 && newline < end)) continue;
      const value = body.slice(i + 2, end),
        pipe = value.indexOf('|'),
        raw = pipe < 0 ? value : value.slice(0, pipe),
        target = raw.trim();
      if (target) {
        const start = i + 2 + raw.indexOf(target);
        links.push({
          kind: 'wiki',
          target,
          label: pipe < 0 ? target : value.slice(pipe + 1),
          start: i + bodyOffset,
          end: end + 2 + bodyOffset,
          targetStart: start + bodyOffset,
          targetEnd: start + target.length + bodyOffset,
        });
      }
      i = end + 1;
      continue;
    }
    const bracket = next(']', i + 1);
    if (
      bracket >= 0 &&
      (next('[', i + 1) < 0 || next('[', i + 1) > bracket) &&
      masked[bracket + 1] !== '('
    ) {
      const label = body.slice(i + 1, bracket);
      let ref = label,
        end = bracket + 1;
      if (masked[end] === '[') {
        const refEnd = masked.indexOf(']', end + 1);
        if (refEnd >= 0) {
          ref = body.slice(end + 1, refEnd) || label;
          end = refEnd + 1;
        }
      }
      const definition = references.get(normalizeReference(ref));
      if (definition) {
        const image = i > 0 && masked[i - 1] === '!' && !isEscaped(body, i - 1);
        links.push({
          kind: image ? 'image' : 'markdown',
          label,
          target: definition.target,
          start: i - Number(image) + bodyOffset,
          end: end + bodyOffset,
          targetStart: definition.start,
          targetEnd: definition.end,
        });
        i = end - 1;
        continue;
      }
    }
    const close = next('](', i + 1),
      newline = next('\n', i + 1),
      nested = next('[', i + 1);
    if (close < 0 || (newline >= 0 && newline < close) || (nested >= 0 && nested < close)) continue;
    let start = close + 2;
    while (/\s/.test(masked[start] || '') && start < masked.length) start++;
    let end = start,
      finish = -1;
    if (masked[start] === '<') {
      start++;
      end = masked.indexOf('>', start);
      if (end < 0) continue;
      finish = masked.indexOf(')', end + 1);
    } else {
      let depth = 0;
      for (; end < masked.length; end++) {
        const c = masked[end];
        if (isEscaped(body, end)) continue;
        if (c === '(') depth++;
        else if (c === ')') {
          if (depth === 0) {
            finish = end;
            break;
          }
          depth--;
        } else if (/\s/.test(c) && depth === 0) {
          finish = masked.indexOf(')', end);
          break;
        }
      }
    }
    if (finish < 0 || !body.slice(start, end)) continue;
    const image = i > 0 && masked[i - 1] === '!' && !isEscaped(body, i - 1);
    links.push({
      kind: image ? 'image' : 'markdown',
      target: body.slice(start, end).replace(/\\([()])/g, '$1'),
      label: body.slice(i + 1, close),
      start: i - Number(image) + bodyOffset,
      end: finish + 1 + bodyOffset,
      targetStart: start + bodyOffset,
      targetEnd: end + bodyOffset,
    });
    i = finish;
  }
  return {
    id: pageId(root, file),
    root,
    path: file,
    uri,
    title:
      title ||
      headings.find((h) => h.level === 1)?.text ||
      posix.basename(file, posix.extname(file)),
    tags,
    draft,
    order,
    text,
    body,
    headings,
    links,
    metadataError,
    ...(metadataWarnings.length ? { metadataWarnings } : {}),
    ...(translatedFrom ? { translatedFrom } : {}),
    ...(description ? { description } : {}),
    ...(properties ? { properties } : {}),
    ...(!title && !headings.some((h) => h.level === 1) ? { titleFromFile: true } : {}),
  };
}

import type { Page } from './model';

/**
 * The page body with code, links, wiki links, HTML and URLs blanked out (same length), so text
 * searches only match words a reader sees as plain text.
 */
export function plainMask(body: string): string {
  const mask = body.split('');
  const blank = (a: number, b: number) => {
    for (let i = a; i < b; i++) if (mask[i] !== '\n') mask[i] = ' ';
  };
  // Fenced code blocks.
  let fence = '';
  let offset = 0;
  let start = 0;
  for (const line of body.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m && !fence) {
      fence = m[1];
      start = offset;
    } else if (m && fence && m[1][0] === fence[0] && m[1].length >= fence.length) {
      fence = '';
      blank(start, offset + line.length);
    }
    offset += line.length + 1;
  }
  if (fence) blank(start, body.length);
  const text = () => mask.join('');
  for (const pattern of [
    /`[^`\n]+`/g,
    /!?\[\[[^\]\n]*\]\]/g,
    /!?\[[^\]\n]*\]\([^)\n]*\)/g,
    /<[^>\n]+>/g,
    /https?:\/\/\S+/g,
    /^ {0,3}#{1,6} .*$/gm,
    /^ {0,3}\[[^\]\n]+\]:.*$/gm,
  ])
    for (const m of text().matchAll(pattern)) blank(m.index!, m.index! + m[0].length);
  return text();
}

/** Markdown links and emphasis read as their text. */
const readable = (text: string) =>
  text
    .replace(/!?\[\[([^\]|\n]*)\|([^\]\n]*)\]\]/g, '$2')
    .replace(/!?\[\[([^\]#\n]*)[^\]\n]*\]\]/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]( \[[ xX]\])?|\d+\.|>)\s+/, '')
    .replace(/[*_`]+/g, '');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Mention {
  page: Page;
  /** Offset of the mention in the page's text (front matter included) and its length. */
  offset: number;
  length: number;
  /** The words around the mention. */
  excerpt: string;
}

/**
 * Places where another page writes this page's title as plain text without linking to it
 * (at most one per page, the first). Titles shorter than three letters are not searched.
 */
export function unlinkedMentions(
  target: Page,
  pages: Page[],
  linksTo: (page: Page) => boolean,
  limit = 20,
): Mention[] {
  const title = target.title.trim();
  if (title.length < 3) return [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(title)}(?![\\p{L}\\p{N}_])`, 'iu');
  const out: Mention[] = [];
  for (const page of pages) {
    if (out.length >= limit) break;
    if (page.id === target.id || page.root !== target.root || linksTo(page)) continue;
    const match = pattern.exec(plainMask(page.body));
    if (!match) continue;
    const bodyOffset = page.text.length - page.body.length;
    const at = match.index;
    const lineStart = page.body.lastIndexOf('\n', at) + 1;
    const lineEnd = page.body.indexOf('\n', at);
    const line = page.body.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    const from = Math.max(0, at - lineStart - 60);
    out.push({
      page,
      offset: bodyOffset + at,
      length: match[0].length,
      excerpt: readable(
        `${from ? '…' : ''}${line.slice(from, at - lineStart + match[0].length + 60).trim()}${
          at - lineStart + match[0].length + 60 < line.length ? '…' : ''
        }`,
      ),
    });
  }
  return out;
}

/** The text with the mention at `offset` turned into a wiki link to `title`. */
export function linkMention(text: string, offset: number, length: number, title: string): string {
  const words = text.slice(offset, offset + length);
  if (words.toLocaleLowerCase() !== title.toLocaleLowerCase())
    throw new Error('The page changed; the mention is no longer there.');
  const link = words === title ? `[[${title}]]` : `[[${title}|${words}]]`;
  return text.slice(0, offset) + link + text.slice(offset + length);
}

/** A short plain-text summary of a page: its description, else its first paragraph. */
export function excerptOf(page: Page, max = 220): string {
  if (page.description?.trim()) return page.description.trim().slice(0, max);
  const plain = page.body
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*|$)/gm, '')
    .replace(/^ {0,3}#{1,6} .*$/gm, '')
    .replace(/!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\[\[([^\]|\n]*)\|([^\]\n]*)\]\]/g, '$2')
    .replace(/\[\[([^\]#\n]*)[^\]\n]*\]\]/g, '$1')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/^\s*(?:[-*+]( \[[ xX]\])?|\d+\.|>|!!!.*|\?\?\?.*|:::.*|\|.*)\s*/gm, '')
        .replace(/[*_~=`]+/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .find((p) => p.length > 20);
  if (!plain) return '';
  return plain.length > max ? `${plain.slice(0, max).replace(/\s+\S*$/, '')}…` : plain;
}

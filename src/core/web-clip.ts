/** What a clipped web page keeps: its title, summary, site, author, date and first paragraphs. */
export interface Clip {
  url: string;
  title: string;
  description: string;
  site: string;
  author: string;
  published: string;
  paragraphs: string[];
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return entities[code.toLowerCase()] ?? all;
  });
const plain = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Reads a page's metadata and main paragraphs from its HTML (no scripts, styles or menus). */
export function clipFromHtml(html: string, url: string): Clip {
  const meta = (name: string) => {
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = tag[0];
      const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase();
      if (key !== name) continue;
      const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(attrs);
      if (content) return plain(content[1] ?? content[2] ?? '');
    }
    return '';
  };
  const body = html
    .replace(
      /<(script|style|noscript|svg|nav|header|footer|aside|form|template)\b[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2] || body;
  const paragraphs = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => plain(m[1]))
    .filter((p) => p.length >= 40)
    .slice(0, 6);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  return {
    url,
    title:
      meta('og:title') ||
      plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '') ||
      plain(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] || '') ||
      host ||
      'Clipped page',
    description: meta('og:description') || meta('description') || meta('twitter:description'),
    site: meta('og:site_name') || host,
    author: meta('author') || meta('article:author'),
    published: (meta('article:published_time') || meta('date')).slice(0, 10),
    paragraphs,
  };
}

const yamlText = (s: string) => JSON.stringify(s);
/** The Markdown page for a clip: source in the front matter, the summary and the first paragraphs as quotes. */
export function clipMarkdown(clip: Clip, today: string): string {
  const front = [
    '---',
    `source: ${yamlText(clip.url)}`,
    clip.site ? `site: ${yamlText(clip.site)}` : '',
    clip.author ? `author: ${yamlText(clip.author)}` : '',
    /^\d{4}-\d{2}-\d{2}$/.test(clip.published) ? `published: ${clip.published}` : '',
    `clipped: ${today}`,
    'tags: [clip]',
    '---',
  ].filter(Boolean);
  const escape = (s: string) => s.replace(/([\\`*_[\]<>#|])/g, '\\$1');
  const parts = [`# ${escape(clip.title.slice(0, 200))}`];
  if (clip.description) parts.push(`> ${escape(clip.description.slice(0, 600))}`);
  for (const p of clip.paragraphs) parts.push(`> ${escape(p.slice(0, 1200))}`);
  parts.push(
    `[Open the original](<${clip.url.replace(/>/g, '%3E')}>)${clip.site ? ` · ${escape(clip.site)}` : ''}`,
  );
  parts.push('## Notes\n');
  return `${front.join('\n')}\n\n${parts.join('\n\n')}\n`;
}

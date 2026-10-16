import type { Page } from './model';

/**
 * Search query syntax. Free words are searched in titles, paths and text (every word must
 * match); the rest are filters that narrow the pages first:
 *
 *   "exact phrase"        the words in this order
 *   -word                 pages without the word
 *   tag:api  #api         pages tagged api
 *   path:guides/          pages whose path contains guides/
 *   heading:install       pages with a heading containing “install”
 *   prop:owner            pages whose front matter has a non-empty owner
 *   prop:owner=alice      … whose owner contains “alice” (prop:status!=done excludes)
 *   link:setup            pages linking to a page or URL matching “setup”
 *   code:python           pages with a ```python code block
 *   type:draft            draft pages; also chart, dashboard, openapi, notebook, canvas,
 *                         mermaid, tasks, image, math
 *   version:1.0           pages of an archived version (_versions/1.0/); version:latest or
 *                         version:current is the live documentation
 *   sort:title            sort by title (also path, relevance — the default)
 *
 * A filter value may be quoted (heading:"Getting started"); filters of the same name are
 * combined with AND.
 */
export interface SearchQuery {
  terms: string[];
  phrases: string[];
  exclude: string[];
  tags: string[];
  paths: string[];
  headings: string[];
  props: Array<{ key: string; value?: string; negate?: boolean }>;
  links: string[];
  code: string[];
  types: string[];
  /** Archived version ids; '' is the current (latest) version. Empty = no version filter. */
  versions: string[];
  sort: 'relevance' | 'title' | 'path';
  /** Unknown `name:` filters, reported to the user instead of silently ignored. */
  unknown: string[];
}

export const searchTypes = [
  'draft',
  'chart',
  'dashboard',
  'openapi',
  'notebook',
  'canvas',
  'mermaid',
  'tasks',
  'image',
  'math',
] as const;
const filters = ['tag', 'path', 'heading', 'prop', 'link', 'code', 'type', 'sort', 'version'];

export function parseQuery(input: string): SearchQuery {
  const q: SearchQuery = {
    terms: [],
    phrases: [],
    exclude: [],
    tags: [],
    paths: [],
    headings: [],
    props: [],
    links: [],
    code: [],
    types: [],
    versions: [],
    sort: 'relevance',
    unknown: [],
  };
  const token = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = token.exec(input))) {
    const negate = m[1] === '-';
    const name = m[2]?.toLowerCase();
    const quoted = m[3] !== undefined;
    const value = (quoted ? m[3] : m[4] || '').trim();
    if (name && !filters.includes(name)) {
      // `http://…` and similar stay words.
      if (/^\/\//.test(value)) q.terms.push(`${m[2]}:${value}`);
      else q.unknown.push(`${name}:`);
      continue;
    }
    if (!name) {
      if (!value) continue;
      if (!quoted && value.startsWith('#') && value.length > 1 && !negate)
        q.tags.push(value.slice(1).toLocaleLowerCase());
      else if (negate) q.exclude.push(value.toLocaleLowerCase());
      else if (quoted) q.phrases.push(value.toLocaleLowerCase());
      else q.terms.push(value);
      continue;
    }
    if (!value) continue;
    const lower = value.toLocaleLowerCase();
    if (name === 'tag') q.tags.push(lower.replace(/^#/, ''));
    else if (name === 'path') q.paths.push(lower.replace(/\\/g, '/'));
    else if (name === 'heading') q.headings.push(lower);
    else if (name === 'link') q.links.push(lower);
    else if (name === 'code') q.code.push(lower);
    else if (name === 'type') q.types.push(lower);
    else if (name === 'version')
      q.versions.push(lower === 'latest' || lower === 'current' ? '' : value);
    else if (name === 'sort') {
      if (lower === 'title' || lower === 'path' || lower === 'relevance') q.sort = lower;
      else q.unknown.push(`sort:${value}`);
    } else if (name === 'prop') {
      const eq = /^([^=!]+?)(!?=)(.*)$/.exec(value);
      if (eq)
        q.props.push({
          key: eq[1].trim(),
          value: eq[3].trim().toLocaleLowerCase(),
          negate: eq[2] === '!=' || negate,
        });
      else q.props.push({ key: value, negate });
    }
  }
  for (const type of q.types)
    if (!(searchTypes as readonly string[]).includes(type)) q.unknown.push(`type:${type}`);
  return q;
}

export const hasFilters = (q: SearchQuery): boolean =>
  !!(
    q.tags.length ||
    q.paths.length ||
    q.headings.length ||
    q.props.length ||
    q.links.length ||
    q.code.length ||
    q.types.length ||
    q.versions.length ||
    q.phrases.length ||
    q.exclude.length
  );

const features = new WeakMap<Page, { code: Set<string>; types: Set<string>; lower: string }>();
/** Code block languages and content kinds of a page, computed once per parsed page. */
export function pageFeatures(page: Page): { code: Set<string>; types: Set<string>; lower: string } {
  let f = features.get(page);
  if (f) return f;
  const code = new Set<string>();
  const types = new Set<string>();
  for (const m of page.body.matchAll(/^ {0,3}(?:`{3,}|~{3,})\s*([\w+#.-]+)/gm)) {
    const lang = m[1].toLowerCase();
    if (['chart', 'dashboard', 'openapi', 'notebook', 'canvas', 'mermaid', 'tasks'].includes(lang))
      types.add(lang);
    else code.add(lang);
  }
  if (page.draft) types.add('draft');
  if (page.links.some((l) => l.kind === 'image')) types.add('image');
  if (/\$\$[\s\S]+?\$\$|^ {0,3}```math/m.test(page.body)) types.add('math');
  if (/^\s*[-*+] \[[ xX]\]\s/m.test(page.body)) types.add('tasks');
  f = { code, types, lower: page.text.toLocaleLowerCase() };
  features.set(page, f);
  return f;
}

/** Aliases accepted by code: (code:js finds ```javascript blocks and the other way round). */
const codeAliases: Record<string, string[]> = {
  js: ['javascript', 'js', 'mjs', 'cjs', 'jsx'],
  javascript: ['javascript', 'js', 'mjs', 'cjs', 'jsx'],
  ts: ['typescript', 'ts', 'tsx'],
  typescript: ['typescript', 'ts', 'tsx'],
  py: ['python', 'py'],
  python: ['python', 'py'],
  sh: ['bash', 'sh', 'shell', 'zsh', 'console'],
  bash: ['bash', 'sh', 'shell', 'zsh', 'console'],
  shell: ['bash', 'sh', 'shell', 'zsh', 'console'],
  yml: ['yaml', 'yml'],
  yaml: ['yaml', 'yml'],
};

/**
 * Whether a page passes the filters. `linkTargets` gives the title and path of each page a
 * link resolves to (so link: matches by name), plus the raw target.
 */
export function matchesFilters(
  page: Page,
  q: SearchQuery,
  linkTargets: (page: Page) => string[],
): boolean {
  const f = pageFeatures(page);
  if (q.versions.length) {
    const archived = /^_versions\/([^/]+)\//.exec(page.path)?.[1] ?? '';
    if (!q.versions.includes(archived)) return false;
  }
  if (!q.tags.every((tag) => page.tags.some((t) => t.toLocaleLowerCase() === tag))) return false;
  const path = page.path.toLocaleLowerCase();
  if (!q.paths.every((p) => path.includes(p))) return false;
  if (!q.headings.every((h) => page.headings.some((x) => x.text.toLocaleLowerCase().includes(h))))
    return false;
  for (const prop of q.props) {
    const key = Object.keys(page.properties || {}).find(
      (k) => k.toLocaleLowerCase() === prop.key.toLocaleLowerCase(),
    );
    const value = key ? page.properties![key].toLocaleLowerCase() : '';
    const ok = prop.value === undefined ? !!value.trim() : value.includes(prop.value);
    if (ok === !!prop.negate) return false;
  }
  if (q.code.length && !q.code.every((c) => (codeAliases[c] || [c]).some((l) => f.code.has(l))))
    return false;
  if (!q.types.every((t) => f.types.has(t))) return false;
  if (q.links.length) {
    const targets = linkTargets(page).map((t) => t.toLocaleLowerCase());
    if (!q.links.every((l) => targets.some((t) => t.includes(l)))) return false;
  }
  if (!q.phrases.every((p) => f.lower.includes(p))) return false;
  if (q.exclude.some((w) => f.lower.includes(w))) return false;
  return true;
}

/** Ranges of `words` (and phrases) in `text`, merged, for highlighted previews. */
export function highlightRanges(text: string, words: string[]): Array<[number, number]> {
  // Accents are folded per character so offsets stay those of `text` (search ignores accents).
  let lower = '';
  for (const c of text) {
    const base = c
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLocaleLowerCase();
    lower +=
      base.length === c.length
        ? base
        : c.toLocaleLowerCase().length === c.length
          ? c.toLocaleLowerCase()
          : c;
  }
  words = words.map((w) => w.normalize('NFKD').replace(/\p{M}+/gu, ''));
  const out: Array<[number, number]> = [];
  for (const word of new Set(words.map((w) => w.toLocaleLowerCase()).filter(Boolean))) {
    let i = lower.indexOf(word);
    while (i >= 0 && out.length < 50) {
      out.push([i, i + word.length]);
      i = lower.indexOf(word, i + word.length);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of out)
    if (merged.length && r[0] <= merged[merged.length - 1][1])
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    else merged.push([r[0], r[1]]);
  return merged;
}

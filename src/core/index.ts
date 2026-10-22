import { blockAnchor } from './markdown-extras';
import { Heading, Link, Page, Resolution, TextChange } from './model';
import { SearchIndex, tokenize } from './search';
import { encodePath, insidePath, isExternal, pageId, posix, slug, splitTarget } from './paths';
import { highlightRanges, matchesFilters, parseQuery, SearchQuery } from './query';

export interface SearchResult {
  page: Page;
  score: number;
  excerpt: string;
  /** Ranges of matched words in `excerpt`. */
  matches: Array<[number, number]>;
  heading?: Heading;
}

export class WikiIndex {
  readonly pages = new Map<string, Page>();
  private readonly uris = new Map<string, Page>();
  private readonly aliases = new Map<string, Set<string>>();
  private readonly sorted = new Map<string, Page[]>();
  private readonly searchText = new Map<string, { title: string; path: string }>();
  private readonly text = new SearchIndex();
  /**
   * Optional scope prefix of a page (`it`, `_versions/1.0`, `''` for current default-language
   * pages). `[[links]]` prefer pages in the linking page's scope, so translations and archived
   * versions link among themselves.
   */
  scope?: (page: Page) => string;
  private aliasKeys(page: Page): string[] {
    return [
      ...new Set(
        [page.title, posix.basename(page.path).replace(/\.md$/i, '')].map((s) =>
          pageId(page.root, s.toLocaleLowerCase()),
        ),
      ),
    ];
  }
  replace(pages: Page[]): void {
    this.pages.clear();
    this.uris.clear();
    this.aliases.clear();
    this.sorted.clear();
    this.searchText.clear();
    this.text.clear();
    for (const p of pages) this.upsert(p);
  }
  upsert(page: Page): void {
    const old = this.pages.get(page.id);
    if (old) {
      this.uris.delete(old.uri);
      for (const key of this.aliasKeys(old)) {
        const set = this.aliases.get(key);
        set?.delete(old.id);
        if (!set?.size) this.aliases.delete(key);
      }
    }
    this.pages.set(page.id, page);
    this.sorted.clear();
    this.searchText.set(page.id, {
      title: page.title.toLocaleLowerCase(),
      path: page.path.toLocaleLowerCase(),
    });
    this.text.update(page);
    this.uris.set(page.uri, page);
    for (const key of this.aliasKeys(page)) {
      const set = this.aliases.get(key) ?? new Set<string>();
      set.add(page.id);
      this.aliases.set(key, set);
    }
  }
  remove(uri: string): void {
    const old = this.uris.get(uri);
    if (!old) return;
    this.pages.delete(old.id);
    this.sorted.clear();
    this.searchText.delete(old.id);
    this.text.remove(old.id);
    this.uris.delete(uri);
    for (const key of this.aliasKeys(old)) {
      const set = this.aliases.get(key);
      set?.delete(old.id);
      if (!set?.size) this.aliases.delete(key);
    }
  }
  byUri(uri: string): Page | undefined {
    return this.uris.get(uri);
  }
  all(root?: string): Page[] {
    const key = root || '\0all';
    let pages = this.sorted.get(key);
    if (!pages) {
      pages = [...this.pages.values()]
        .filter((p) => !root || p.root === root)
        .sort((a, b) => a.path.localeCompare(b.path));
      this.sorted.set(key, pages);
    }
    return [...pages];
  }
  resolve(source: Page, target: string, kind: Link['kind'] = 'wiki'): Resolution {
    if (isExternal(target)) return { external: true };
    const { path: raw, anchor } = splitTarget(target);
    if (raw.includes('\\') || /[\x00-\x1f]/.test(raw)) return { error: 'unsafe' };
    let page: Page | undefined;
    if (!raw) page = source;
    else {
      const name = /\.md$/i.test(raw) ? raw : `${raw}.md`;
      const rootPath = posix.normalize(name.replace(/^\//, ''));
      const localPath = posix.normalize(posix.join(posix.dirname(source.path), name));
      if (raw.startsWith('/'))
        page = insidePath(rootPath) ? this.pages.get(pageId(source.root, rootPath)) : undefined;
      else if (insidePath(localPath)) page = this.pages.get(pageId(source.root, localPath));
      else return { error: 'unsafe' };
      if (!page && kind === 'wiki' && !/^\.{1,2}\//.test(raw) && !raw.startsWith('/')) {
        const prefix = this.scope?.(source);
        if (prefix) page = this.pages.get(pageId(source.root, posix.join(prefix, rootPath)));
        page ||= this.pages.get(pageId(source.root, rootPath));
        if (!page && !raw.includes('/')) {
          const key = raw.replace(/\.md$/i, '').toLocaleLowerCase();
          let matches = [...(this.aliases.get(pageId(source.root, key)) ?? [])].map((id) =>
            this.pages.get(id)!,
          );
          if (this.scope && matches.length > 1) {
            const own = this.scope(source);
            const scoped = matches.filter((p) => this.scope!(p) === own);
            if (scoped.length) matches = scoped;
          }
          if (matches.length > 1) return { error: 'ambiguous' };
          page = matches[0];
        }
      }
    }
    if (!page) return { error: 'missing' };
    if (anchor?.startsWith('^')) {
      // A block reference: `[[Page#^id]]` targets the paragraph ending with `^id`.
      const id = anchor.slice(1);
      const at = new RegExp(`[ \\t]\\^${id.replace(/[^A-Za-z0-9-]/g, '')}[ \\t]*\\r?$`, 'm').exec(
        page.body,
      );
      if (!at || !/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(id)) return { page, error: 'heading' };
      return {
        page,
        heading: {
          text: `^${id}`,
          slug: blockAnchor(id),
          level: 0,
          offset: page.text.length - page.body.length + at.index,
        },
      };
    }
    if (anchor) {
      const heading = page.headings.find((h) => h.slug === anchor || h.slug === slug(anchor));
      if (!heading) return { page, error: 'heading' };
      return { page, heading };
    }
    return { page };
  }
  backlinks(target: Page): { page: Page; link: Link }[] {
    return this.all(target.root).flatMap((page) =>
      page.links
        .filter(
          (l) => l.kind !== 'image' && this.resolve(page, l.target, l.kind).page?.id === target.id,
        )
        .map((link) => ({ page, link })),
    );
  }
  /**
   * Ranked full-text search: every word must occur in the page (title, path or text; partial
   * words match). Filters (`tag:`, `#tag`, `path:`, `heading:`, `prop:`, `link:`, `code:`,
   * `type:`, phrases, `-word`; see core/query.ts) narrow the pages first. Each result names the
   * best-matching section and the ranges of the matched words in its excerpt.
   */
  search(
    query: string | SearchQuery,
    root?: string,
    include: (page: Page) => boolean = () => true,
  ): SearchResult[] {
    const q = typeof query === 'string' ? parseQuery(query) : query;
    const linkTargets = (page: Page) =>
      page.links
        .filter((l) => l.kind !== 'image')
        .flatMap((l) => {
          const target = this.resolve(page, l.target, l.kind).page;
          return target ? [l.target, target.title, target.path] : [l.target];
        });
    const pool = this.all(root).filter((p) => include(p) && matchesFilters(p, q, linkTargets));
    const filterBoost = q.tags.length * 15;
    const words = q.terms.flatMap((t) => tokenize(t));
    const marks = [...words, ...q.phrases];
    const headingFor = (page: Page) =>
      q.headings.length
        ? page.headings.find((h) => h.text.toLocaleLowerCase().includes(q.headings[0]))
        : undefined;
    const excerptOf = (source: string) => {
      const lines = source.split(/\r?\n/);
      const wanted = [...words, ...q.phrases.flatMap((p) => tokenize(p))];
      const line =
        (wanted.length
          ? lines.find(
              (l) =>
                !/^#{1,6}\s/.test(l) && tokenize(l).some((t) => wanted.some((w) => t.includes(w))),
            )
          : undefined) ??
        lines.find((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^---$/.test(l.trim())) ??
        '';
      const excerpt = line.trim().slice(0, 180);
      return { excerpt, matches: highlightRanges(excerpt, marks) };
    };
    let results: SearchResult[];
    if (!words.length) {
      results = pool.map((page) => {
        const heading = headingFor(page);
        const source = heading
          ? page.text.slice(heading.offset).replace(/^[^\n]*\n/, '')
          : page.body;
        return { page, score: filterBoost, heading, ...excerptOf(source) };
      });
    } else {
      const hits = this.text.query(q.terms, new Set(pool.map((p) => p.id)));
      const phrase = q.terms.join(' ').toLocaleLowerCase().trim();
      results = [...hits.values()].map((hit) => {
        const page = this.pages.get(hit.pageId)!;
        const { title, path } = this.searchText.get(page.id)!;
        let boost = filterBoost + (title === phrase ? 100 : 0);
        for (const word of words) boost += title.includes(word) ? 40 : path.includes(word) ? 20 : 0;
        return {
          page,
          score: hit.score * 10 + boost,
          heading: hit.heading,
          // A title-only section has nothing to show; fall back to the page text.
          ...(() => {
            const best = excerptOf(hit.text || page.body);
            return best.excerpt ? best : excerptOf(page.body);
          })(),
        };
      });
    }
    const byTitle = (a: SearchResult, b: SearchResult) =>
      a.page.title.localeCompare(b.page.title) || a.page.path.localeCompare(b.page.path);
    return results.sort(
      q.sort === 'title'
        ? byTitle
        : q.sort === 'path'
          ? (a, b) => a.page.path.localeCompare(b.page.path)
          : (a, b) => b.score - a.score || byTitle(a, b),
    );
  }
  renameChanges(page: Page, newPath: string): Map<string, TextChange[]> {
    const changes = new Map<string, TextChange[]>();
    for (const source of this.all(page.root)) {
      const edits: TextChange[] = [];
      for (const link of source.links) {
        if (isExternal(link.target)) continue;
        const resolved =
          link.kind === 'image' ? undefined : this.resolve(source, link.target, link.kind).page;
        const target = splitTarget(link.target);
        const movingSource = source.id === page.id;
        if (resolved?.id !== page.id && !movingSource) continue;
        // Preserve anchor-only links when their containing page moves.
        if (!target.path && movingSource) continue;
        let destination = resolved?.id === page.id ? newPath : resolved?.path;
        if (
          !destination &&
          movingSource &&
          link.kind !== 'wiki' &&
          target.path &&
          !target.path.startsWith('/')
        )
          destination = posix.normalize(posix.join(posix.dirname(source.path), target.path));
        if (!destination || !insidePath(destination)) continue;
        const anchor = link.target.includes('#') ? link.target.slice(link.target.indexOf('#')) : '';
        const replacement =
          link.kind === 'wiki'
            ? `/${destination.replace(/\.md$/i, '')}${anchor}`
            : `${encodePath(posix.relative(posix.dirname(movingSource ? newPath : source.path), destination))}${anchor}`;
        if (replacement !== link.target)
          edits.push({ start: link.targetStart, end: link.targetEnd, text: replacement });
      }
      if (edits.length)
        changes.set(source.uri, [
          ...new Map(edits.map((e) => [`${e.start}:${e.end}`, e])).values(),
        ]);
    }
    return changes;
  }
  graph(root?: string): {
    nodes: { id: string; title: string; path: string }[];
    edges: { source: string; target: string }[];
  } {
    const pages = this.all(root),
      edges = new Map<string, { source: string; target: string }>();
    for (const p of pages)
      for (const l of p.links.filter((l) => l.kind !== 'image')) {
        const r = this.resolve(p, l.target, l.kind);
        if (r.page) edges.set(`${p.id}\0${r.page.id}`, { source: p.id, target: r.page.id });
      }
    return {
      nodes: pages.map((p) => ({ id: p.id, title: p.title, path: p.path })),
      edges: [...edges.values()],
    };
  }
}

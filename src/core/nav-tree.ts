import { humanize, isFolderIndex } from './titles';

/** A page as the navigation tree needs it. */
export interface NavPage {
  id: string;
  path: string;
  title: string;
  /** The title came from the file name (shown humanized when `readable`). */
  titleFromFile?: boolean;
  order?: number;
  draft?: boolean;
  uri?: string;
  /** A notebook or canvas file listed with the pages (opened in its own editor). */
  file?: 'notebook' | 'canvas';
  tags?: string[];
  /** Front matter values: `status` and `icon` are shown in the navigation. */
  properties?: Record<string, string>;
}
/** Page statuses shown as badges (front matter `status:`). */
export const pageStatuses = ['new', 'updated', 'beta', 'deprecated', 'draft'] as const;
export type PageStatus = (typeof pageStatuses)[number];
export const pageStatus = (p: { properties?: Record<string, string> }): PageStatus | undefined => {
  const value = p.properties?.status?.trim().toLowerCase();
  return (pageStatuses as readonly string[]).includes(value || '')
    ? (value as PageStatus)
    : undefined;
};
/** A page's icon: an icon name or a short emoji (front matter `icon:`). */
export const pageIcon = (p: { properties?: Record<string, string> }): string | undefined => {
  const value = p.properties?.icon?.trim();
  if (!value) return undefined;
  if (/^[a-z][a-zA-Z0-9-]{0,39}$/.test(value)) return value;
  return [...value].length <= 4 && !/[\w\s<>&"']/.test(value) ? value : undefined;
};
/** Previous / next links under the page: only where its front matter says `pager: true`. */
export const pageShowsPager = (p: { properties?: Record<string, unknown> }): boolean =>
  String(p.properties?.pager ?? '')
    .trim()
    .toLowerCase() === 'true';
export interface NavNode {
  kind: 'page' | 'section' | 'file';
  title: string;
  /** Page path, or the section folder (`guides/`). */
  path: string;
  /** Page id; for a section, the id of its index or README page. */
  id?: string;
  uri?: string;
  file?: 'notebook' | 'canvas';
  draft?: boolean;
  status?: PageStatus;
  icon?: string;
  tags?: string[];
  pager?: boolean;
  children?: NavNode[];
}
export interface NavOptions {
  sort: 'filename' | 'title' | 'order';
  directorySort?: 'folders-first' | 'files-first' | 'mixed';
  readable?: boolean;
  acronyms?: string[];
}

/**
 * The wiki as a documentation-site navigation: folders become sections, a folder's index, README
 * or same-named page becomes the section's own page, and the order follows the Wiki Explorer.
 */
/**
 * A folder's own page (`folder` ends with `/`): its index or README, else a page named like the
 * folder beside it (`Guide.md` next to `Guide/`), else one inside it (`Guide/Guide.md`).
 */
export function folderPage<P extends NavPage>(pages: P[], folder: string): P | undefined {
  const parent = folder.replace(/[^/]+\/$/, '');
  const name = folder.slice(parent.length, -1).toLowerCase();
  const here = (p: P, dir: string) =>
    !p.file && p.path.startsWith(dir) && !p.path.slice(dir.length).includes('/');
  const stem = (path: string) => path.replace(/^.*\//, '').replace(/\.md$/i, '').toLowerCase();
  return (
    pages.find((p) => here(p, folder) && isFolderIndex(p.path)) ||
    pages.find((p) => here(p, parent) && stem(p.path) === name) ||
    pages.find((p) => here(p, folder) && stem(p.path) === name)
  );
}

export function navTree(pages: NavPage[], options: NavOptions, prefix = ''): NavNode[] {
  const name = (text: string) => (options.readable ? humanize(text, options.acronyms) : text);
  const meta = (p: NavPage) => ({
    status: pageStatus(p),
    icon: pageIcon(p),
    tags: p.tags?.length ? p.tags : undefined,
    pager: pageShowsPager(p) || undefined,
  });
  const notes = new Map<string, NavPage>();
  for (const page of pages) {
    if (!page.path.startsWith(prefix)) continue;
    const relative = page.path.slice(prefix.length);
    const slash = relative.indexOf('/');
    if (slash < 0) continue;
    const dir = relative.slice(0, slash);
    if (notes.has(dir)) continue;
    const note = folderPage(pages, `${prefix}${dir}/`);
    if (note) notes.set(dir, note);
  }
  const noteIds = new Set([...notes.values()].map((p) => p.id));
  const nodes: Array<NavNode & { order?: number }> = [];
  const dirs = new Set<string>();
  for (const page of pages) {
    if (!page.path.startsWith(prefix)) continue;
    const relative = page.path.slice(prefix.length);
    const slash = relative.indexOf('/');
    if (slash >= 0) {
      const dir = relative.slice(0, slash);
      if (dirs.has(dir)) continue;
      dirs.add(dir);
      const folder = `${prefix}${dir}/`;
      const index = notes.get(dir);
      const children = navTree(pages, options, folder).filter((n) => n.id !== index?.id);
      nodes.push({
        kind: 'section',
        title: index && !index.titleFromFile ? index.title : name(dir),
        path: folder,
        id: index?.id,
        children,
        order: index?.order,
        ...(index ? meta(index) : {}),
      });
    } else if (!noteIds.has(page.id))
      nodes.push({
        kind: page.file ? 'file' : 'page',
        title: page.titleFromFile ? name(page.title) : page.title,
        path: page.path,
        id: page.file ? undefined : page.id,
        uri: page.uri,
        file: page.file,
        draft: page.draft || undefined,
        order: page.order,
        ...meta(page),
      });
  }
  const kind = (n: NavNode) =>
    options.directorySort === 'mixed'
      ? 0
      : Number(n.kind !== 'section') * (options.directorySort === 'files-first' ? -1 : 1);
  nodes.sort(
    (a, b) =>
      Number(b.kind === 'page' && isFolderIndex(b.path)) -
        Number(a.kind === 'page' && isFolderIndex(a.path)) ||
      kind(a) - kind(b) ||
      Number(a.kind === 'file') - Number(b.kind === 'file') ||
      (options.sort === 'order' ? (a.order ?? Infinity) - (b.order ?? Infinity) : 0) ||
      (options.sort === 'title' ? a.title.localeCompare(b.title) : a.path.localeCompare(b.path)),
  );
  return nodes.map(({ order: _order, ...node }) => node);
}

/** Pages in reading order (sections first show their own page), for previous / next links. */
export function navOrder(nodes: NavNode[]): NavNode[] {
  return nodes.flatMap((n) =>
    n.kind === 'page' ? [n] : [...(n.id ? [n] : []), ...navOrder(n.children || [])],
  );
}

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
}
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
  children?: NavNode[];
}
export interface NavOptions {
  sort: 'filename' | 'title' | 'order';
  directorySort?: 'folders-first' | 'files-first' | 'mixed';
  readable?: boolean;
  acronyms?: string[];
}

/**
 * The wiki as an MkDocs-style navigation: folders become sections, a folder's index or README
 * page becomes the section's own page, and the order follows the Wiki Explorer.
 */
export function navTree(pages: NavPage[], options: NavOptions, prefix = ''): NavNode[] {
  const name = (text: string) => (options.readable ? humanize(text, options.acronyms) : text);
  const byPath = new Map(pages.map((p) => [p.path, p]));
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
      const index = [...byPath.values()].find(
        (p) =>
          !p.file &&
          p.path.startsWith(folder) &&
          !p.path.slice(folder.length).includes('/') &&
          isFolderIndex(p.path),
      );
      const children = navTree(pages, options, folder).filter((n) => n.id !== index?.id);
      nodes.push({
        kind: 'section',
        title: index && !index.titleFromFile ? index.title : name(dir),
        path: folder,
        id: index?.id,
        children,
        order: index?.order,
      });
    } else
      nodes.push({
        kind: page.file ? 'file' : 'page',
        title: page.titleFromFile ? name(page.title) : page.title,
        path: page.path,
        id: page.file ? undefined : page.id,
        uri: page.uri,
        file: page.file,
        draft: page.draft || undefined,
        order: page.order,
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

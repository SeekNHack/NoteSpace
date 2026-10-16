import * as vscode from 'vscode';
import { Page } from './core/model';
import { WikiWorkspace } from './workspace';
import { posix } from './core/paths';
import { resolveImage, resolveAttachment } from './assets';
import { WikiActivity } from './activity';
import { Task } from './core/tasks';
import { pageQuality, QualityIssue, rulesFor } from './core/quality';
import { scopeOf } from './core/scopes';
import { defaultAcronyms, DirectorySort, humanize, isFolderIndex } from './core/titles';
export interface PageNode {
  label: string;
  root: string;
  prefix?: string;
  page?: Page;
  offset?: number;
  sectionOrder?: number;
  kind?:
    | 'favorites'
    | 'recent'
    | 'section'
    | 'heading'
    | 'link'
    | 'property'
    | 'task'
    | 'notebooks'
    | 'notebook'
    | 'canvases'
    | 'canvas';
  uri?: vscode.Uri;
  /** Context view: grouping key, nested heading children, link state. */
  group?: 'outline' | 'backlinks' | 'links' | 'properties' | 'tasks';
  children?: PageNode[];
  detail?: string;
  broken?: string;
  icon?: string;
}
const RECENT_LIMIT = 10;
export class WikiTree
  implements
    vscode.TreeDataProvider<PageNode>,
    vscode.TreeDragAndDropController<PageNode>,
    vscode.Disposable
{
  readonly dragMimeTypes = ['application/vnd.wikistudio.pages'];
  readonly dropMimeTypes = ['application/vnd.wikistudio.pages'];
  private readonly emitter = new vscode.EventEmitter<PageNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private filter = '';
  private timer?: ReturnType<typeof setTimeout>;
  /** Canvases in wiki roots (set by the extension). */
  canvases?: (rootId?: string) => Array<{ root: string; path: string; uri: vscode.Uri }>;
  /** Notebooks in wiki roots (set by the extension). */
  notebooks?: (rootId?: string) => Array<{ root: string; path: string; uri: vscode.Uri }>;
  /** Tasks in a page plus tasks elsewhere that link to it (set by the extension). */
  tasksFor?: (page: Page) => Task[];
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly mode: 'pages' | 'backlinks' | 'outline' | 'context',
    private readonly activity?: WikiActivity,
  ) {
    this.subscriptions = [
      workspace.onDidChange(() => this.refresh()),
      ...(mode === 'pages'
        ? []
        : [vscode.window.onDidChangeActiveTextEditor(() => this.refresh())]),
      ...(activity ? [activity.onDidChange(() => this.refresh())] : []),
    ];
  }
  refreshNow(): void {
    this.emitter.fire(undefined);
  }
  private refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emitter.fire(undefined), 60);
  }
  setFilter(value: string): void {
    this.filter = value.trim().toLocaleLowerCase();
    void vscode.commands.executeCommand('setContext', 'notespace.filtered', !!this.filter);
    this.emitter.fire(undefined);
  }
  getFilter(): string {
    return this.filter;
  }
  private matches(page: Page): boolean {
    return (
      !this.filter ||
      `${page.title} ${page.path} ${page.tags.join(' ')}`.toLocaleLowerCase().includes(this.filter)
    );
  }
  private activePage(): Page | undefined {
    const active =
      this.activity?.activeUri || vscode.window.activeTextEditor?.document.uri.toString();
    return active ? this.workspace.index.byUri(active) : undefined;
  }
  private showRoots(): boolean {
    return this.workspace.roots.length > 1;
  }
  getTreeItem(node: PageNode): vscode.TreeItem {
    const collapsible = node.page
      ? node.children?.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
      : node.kind === 'notebook' || node.kind === 'canvas'
        ? vscode.TreeItemCollapsibleState.None
        : node.kind === 'recent' ||
            node.kind === 'notebooks' ||
            node.kind === 'canvases' ||
            (node.prefix && node.kind !== 'section' && this.filter === '' && node.prefix !== '')
          ? vscode.TreeItemCollapsibleState.Collapsed
          : node.kind === 'property' || node.kind === 'link'
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Expanded;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.id = this.idOf(node);
    if (node.group) {
      // Context view sections.
      item.iconPath = new vscode.ThemeIcon(
        {
          outline: 'list-tree',
          backlinks: 'references',
          links: 'link',
          properties: 'tag',
          tasks: 'checklist',
        }[node.group],
      );
      item.description = node.detail;
      item.contextValue = `wikiContext-${node.group}`;
      return item;
    }
    if (node.kind === 'canvases') {
      item.iconPath = new vscode.ThemeIcon('symbol-structure');
      item.contextValue = 'wikiGroup';
      return item;
    }
    if (node.kind === 'canvas' && node.uri) {
      item.resourceUri = node.uri;
      item.iconPath = new vscode.ThemeIcon('symbol-structure');
      item.contextValue = 'wikiCanvas';
      item.description =
        posix.dirname(node.detail || '') === '.' ? '' : posix.dirname(node.detail || '');
      item.command = {
        command: 'vscode.openWith',
        title: 'Open Canvas',
        arguments: [node.uri, 'notespace.canvas'],
      };
      return item;
    }
    if (node.kind === 'notebooks') {
      item.iconPath = new vscode.ThemeIcon('notebook');
      item.contextValue = 'wikiGroup';
      return item;
    }
    if (node.kind === 'notebook' && node.uri) {
      item.resourceUri = node.uri;
      item.iconPath = vscode.ThemeIcon.File;
      item.contextValue = 'wikiNotebook';
      item.description =
        posix.dirname(node.detail || '') === '.' ? '' : posix.dirname(node.detail || '');
      item.tooltip = `${node.detail}\nOpens in the notebook editor`;
      item.command = {
        command: 'notespace.openNotebook',
        title: 'Open Notebook',
        arguments: [node],
      };
      return item;
    }
    if (!node.page && (node.kind === 'favorites' || node.kind === 'recent')) {
      item.iconPath = new vscode.ThemeIcon(node.kind === 'favorites' ? 'star-full' : 'history');
      item.contextValue = 'wikiGroup';
      return item;
    }
    if (node.kind === 'property') {
      item.description = node.detail;
      item.iconPath = new vscode.ThemeIcon(node.icon || 'symbol-property');
      item.command = { command: 'notespace.pageProperties', title: 'Edit Page Properties' };
      item.tooltip = 'Edit page properties';
      return item;
    }
    if (node.page) {
      const page = node.page;
      if (node.kind === 'task') {
        item.iconPath = new vscode.ThemeIcon(node.icon || 'circle-large-outline');
        item.description = node.detail;
        item.tooltip = `${node.label}\n${page.path}`;
      } else if (node.kind === 'heading') {
        item.iconPath = new vscode.ThemeIcon('symbol-number');
        item.tooltip = `${'#'.repeat(Number(node.detail) || 1)} ${node.label}`;
      } else if (node.kind === 'link') {
        item.iconPath = new vscode.ThemeIcon(
          node.broken ? 'warning' : 'file',
          node.broken ? new vscode.ThemeColor('problemsWarningIcon.foreground') : undefined,
        );
        item.description = node.detail;
        item.tooltip = node.broken ? `Broken link: ${node.broken}` : page.path;
        if (node.broken) {
          item.command = {
            command: 'notespace.openPage',
            title: 'Show Link',
            arguments: [page.uri, node.offset],
          };
          return item;
        }
      } else {
        item.resourceUri = vscode.Uri.parse(page.uri);
        item.iconPath = vscode.ThemeIcon.File;
        const favorite = this.activity?.isFavorite(page);
        item.contextValue = favorite ? 'wikiFavoritePage' : 'wikiPage';
        const notes = [
          page.draft ? 'draft' : '',
          favorite && this.mode === 'pages' && !node.kind ? '★' : '',
        ];
        item.description =
          this.mode === 'pages' && !node.kind
            ? notes.filter(Boolean).join(' ')
            : posix.dirname(page.path) === '.'
              ? ''
              : posix.dirname(page.path);
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**${page.title.replace(/[\\*_[\]`]/g, '\\$&')}**  \n`);
        md.appendText(page.path);
        if (page.tags.length)
          md.appendMarkdown('\n\n').appendText(page.tags.map((t) => `#${t}`).join(' '));
        item.tooltip = md;
      }
      item.command = {
        command: 'notespace.openPage',
        title: 'Open Page',
        arguments: [page.uri, node.offset],
      };
      return item;
    }
    // Folder or wiki root.
    const root = this.workspace.roots.find((r) => r.id === node.root);
    if (node.prefix === '' && root) {
      const color = root.config?.wiki.color;
      item.iconPath = new vscode.ThemeIcon(
        root.config?.wiki.icon || 'book',
        color ? new vscode.ThemeColor(`charts.${color}`) : undefined,
      );
      item.contextValue = 'wikiRoot';
      const isDefault = this.workspace.defaultRoot === root.id && this.workspace.roots.length > 1;
      item.description =
        [
          root.config?.wiki.title && root.config.wiki.title !== root.name
            ? root.config.wiki.title
            : '',
          isDefault ? 'default' : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined;
      item.tooltip = root.uri.fsPath || root.uri.path;
    } else {
      item.iconPath = vscode.ThemeIcon.Folder;
      if (root && node.prefix) item.resourceUri = vscode.Uri.joinPath(root.uri, node.prefix);
      item.contextValue = 'wikiFolder';
      const count = this.workspace.index
        .all(node.root)
        .filter((p) => p.path.startsWith(node.prefix!) && this.matches(p)).length;
      item.description = this.filter ? String(count) : undefined;
      item.tooltip = `${node.prefix}\n${count} page${count === 1 ? '' : 's'}`;
    }
    return item;
  }
  private idOf(node: PageNode): string {
    if (node.group) return `${this.mode}:${node.group}`;
    if (!node.page && (node.kind === 'favorites' || node.kind === 'recent'))
      return `${this.mode}:${node.kind}`;
    const where = node.kind ?? 'tree';
    if (node.page)
      return `${this.mode}:${where}:${node.page.id}:${node.offset ?? ''}:${node.label}:${node.group ?? ''}`;
    return `${this.mode}:folder:${node.root}:${node.prefix ?? ''}`;
  }
  getParent(node: PageNode): PageNode | undefined {
    if (this.mode !== 'pages' || node.kind) return undefined;
    const path = node.page ? node.page.path : node.prefix?.replace(/\/$/, '');
    if (path === undefined || node.prefix === '') return undefined;
    const dir = posix.dirname(path);
    if (dir === '.' || dir === '') return this.showRoots() ? this.rootNode(node.root) : undefined;
    return { label: posix.basename(dir), root: node.root, prefix: `${dir}/` };
  }
  private rootNode(id: string): PageNode | undefined {
    const root = this.workspace.roots.find((r) => r.id === id);
    return root && { label: root.name, root: root.id, prefix: '' };
  }
  /** The tree node for a page, for `TreeView.reveal`. */
  nodeFor(page: Page): PageNode {
    return { label: this.pageLabel(page), root: page.root, page };
  }
  /** Explorer label: the title, or a readable form of the file name when that is the title. */
  private pageLabel(page: Page): string {
    if (!page.titleFromFile) return page.title;
    const folder = this.workspace.roots.find((r) => r.id === page.root)?.folder.uri;
    const settings = vscode.workspace.getConfiguration('notespace.explorer', folder);
    return settings.get<boolean>('humanizeNames', true)
      ? humanize(page.title, settings.get<string[]>('acronyms', defaultAcronyms))
      : page.title;
  }
  handleDrag(source: readonly PageNode[], transfer: vscode.DataTransfer): void {
    if (this.mode !== 'pages') return;
    const movable = source.filter((node) => !node.kind && (node.page || node.prefix));
    if (!movable.length) return;
    transfer.set(
      'application/vnd.wikistudio.pages',
      new vscode.DataTransferItem(
        JSON.stringify(
          movable.map((node) => ({ root: node.root, page: node.page?.uri, prefix: node.prefix })),
        ),
      ),
    );
  }
  async handleDrop(target: PageNode | undefined, transfer: vscode.DataTransfer): Promise<void> {
    if (this.mode !== 'pages') return;
    if (target?.kind) return;
    const raw = await transfer.get('application/vnd.wikistudio.pages')?.asString();
    if (!raw || raw.length > 50000) return;
    let nodes: Array<{ root: string; page?: string; prefix?: string }>;
    try {
      nodes = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      !Array.isArray(nodes) ||
      nodes.length > 50 ||
      nodes.some((node) => !node || typeof node.root !== 'string')
    )
      return;
    const dir = target?.page
      ? posix.dirname(target.page.path).replace(/^\.$/, '')
      : target?.prefix?.replace(/\/$/, '') || '';
    for (const node of nodes) {
      if (target && node.root !== target.root) continue;
      const wiki = this.workspace.roots.find((root) => root.id === node.root);
      if (!wiki) continue;
      if (typeof node.page === 'string') {
        const page = this.workspace.index.byUri(node.page);
        if (page?.root === wiki.id)
          await this.workspace.renamePage(page, posix.join(dir, posix.basename(page.path)));
      } else if (typeof node.prefix === 'string' && node.prefix) {
        const from = node.prefix.replace(/\/$/, '');
        const destination = posix.join(dir, posix.basename(from));
        if (destination !== from) await this.workspace.moveSection(wiki, node.prefix, destination);
      }
    }
  }
  getChildren(node?: PageNode): PageNode[] {
    if (node?.children) return node.children;
    if (this.mode !== 'pages') return this.contextChildren(node);
    if (node?.kind === 'canvases')
      return (this.canvases?.() || [])
        .filter((n) => !this.filter || n.path.toLowerCase().includes(this.filter))
        .map((n) => ({
          label: posix.basename(n.path, '.canvas'),
          root: n.root,
          kind: 'canvas' as const,
          uri: n.uri,
          detail: n.path,
        }));
    if (node?.kind === 'notebooks')
      return (this.notebooks?.() || [])
        .filter((n) => !this.filter || n.path.toLowerCase().includes(this.filter))
        .map((n) => ({
          label: posix.basename(n.path),
          root: n.root,
          kind: 'notebook' as const,
          uri: n.uri,
          detail: n.path,
        }));
    if (node && !node.page && (node.kind === 'favorites' || node.kind === 'recent')) {
      const pages =
        node.kind === 'favorites'
          ? this.activity?.favoritePages()
          : this.activity?.recentPages().slice(0, RECENT_LIMIT);
      return (pages || [])
        .filter((p) => this.matches(p))
        .map((page) => ({ label: page.title, root: page.root, page, kind: node.kind }));
    }
    if (!node) {
      const groups: PageNode[] = [];
      if (!this.filter && this.activity?.favoritePages().length)
        groups.push({ label: 'Favorites', root: '', kind: 'favorites' });
      if (!this.filter && this.activity?.recentPages().length)
        groups.push({ label: 'Recent', root: '', kind: 'recent' });
      if (this.notebooks?.().length)
        groups.push({ label: 'Notebooks', root: '', kind: 'notebooks' });
      if (this.canvases?.().length) groups.push({ label: 'Canvases', root: '', kind: 'canvases' });
      if (this.showRoots())
        return [
          ...groups,
          ...this.workspace.roots.map((r) => ({ label: r.name, root: r.id, prefix: '' })),
        ];
      return [...groups, ...this.folderChildren(this.workspace.roots[0]?.id, '')];
    }
    return this.folderChildren(node.root, node.prefix ?? '');
  }
  private folderChildren(root: string | undefined, prefix: string): PageNode[] {
    if (root === undefined) return [];
    const result: PageNode[] = [],
      dirs = new Set<string>();
    const pages = this.workspace.index.all(root).filter((p) => this.matches(p)),
      byPath = new Map(pages.map((p) => [p.path, p]));
    const folder = this.workspace.roots.find((r) => r.id === root)?.folder.uri;
    const settings = vscode.workspace.getConfiguration('notespace.explorer', folder);
    const readable = settings.get<boolean>('humanizeNames', true);
    const acronyms = settings.get<string[]>('acronyms', defaultAcronyms);
    const directorySort = settings.get<DirectorySort>('directorySort', 'folders-first');
    const name = (text: string) => (readable ? humanize(text, acronyms) : text);
    for (const page of pages) {
      if (!page.path.startsWith(prefix)) continue;
      const relative = page.path.slice(prefix.length),
        slash = relative.indexOf('/');
      if (slash >= 0) {
        const dir = relative.slice(0, slash);
        if (!dirs.has(dir)) {
          dirs.add(dir);
          result.push({
            label: name(dir),
            root: page.root,
            prefix: `${prefix}${dir}/`,
            sectionOrder: byPath.get(`${prefix}${dir}/index.md`)?.order,
          });
        }
      } else
        result.push({
          label: this.pageLabel(page),
          root: page.root,
          page,
        });
    }
    const sort =
      this.workspace.roots.find((r) => r.id === root)?.config?.navigation.sort || 'filename';
    const kind = (n: PageNode) =>
      directorySort === 'mixed' ? 0 : Number(!!n.page) * (directorySort === 'files-first' ? -1 : 1);
    return result.sort(
      (a, b) =>
        // A folder's index or README page comes first, then folders and pages as configured.
        Number(!!b.page && isFolderIndex(b.page.path)) -
          Number(!!a.page && isFolderIndex(a.page.path)) ||
        kind(a) - kind(b) ||
        (sort === 'order'
          ? (a.page?.order ?? a.sectionOrder ?? Infinity) -
            (b.page?.order ?? b.sectionOrder ?? Infinity)
          : 0) ||
        (sort === 'filename'
          ? (a.page?.path || a.label).localeCompare(b.page?.path || b.label)
          : a.label.localeCompare(b.label)),
    );
  }
  private taskGroup(page: Page): PageNode[] {
    const tasks = this.tasksFor?.(page) || [];
    if (!tasks.length) return [];
    return [
      {
        label: 'Tasks',
        root: page.root,
        group: 'tasks',
        detail: `${tasks.filter((t) => t.status !== 'done').length} open`,
        children: tasks.map((task) => {
          const owner = this.workspace.index.pages.get(task.pageId) || page;
          const offset =
            owner.text.split('\n').slice(0, task.line).join('\n').length + (task.line ? 1 : 0);
          return {
            label: task.title,
            page: owner,
            root: owner.root,
            offset,
            kind: 'task' as const,
            detail: [
              task.due ? `due ${task.due}` : '',
              task.status !== 'todo' ? task.status : '',
              owner.id === page.id ? '' : owner.title,
            ]
              .filter(Boolean)
              .join(' · '),
            icon: task.status === 'done' ? 'pass-filled' : 'circle-large-outline',
          };
        }),
      },
    ];
  }
  private outline(page: Page): PageNode[] {
    const top: PageNode[] = [];
    const stack: Array<{ level: number; node: PageNode }> = [];
    for (const heading of page.headings) {
      const node: PageNode = {
        label: heading.text,
        page,
        root: page.root,
        offset: heading.offset,
        kind: 'heading',
        detail: String(heading.level),
        children: [],
      };
      while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
      (stack.length ? stack[stack.length - 1].node.children! : top).push(node);
      stack.push({ level: heading.level, node });
    }
    return top;
  }
  private contextChildren(node?: PageNode): PageNode[] {
    const page = this.activePage();
    if (!page) return [];
    const backlinks = this.workspace.index
      .backlinks(page)
      .filter(
        (b, i, all) => b.page.id !== page.id && all.findIndex((x) => x.page.id === b.page.id) === i,
      );
    if (this.mode === 'outline')
      return page.headings.map((h) => ({
        label: `${'  '.repeat(h.level - 1)}${h.text}`,
        page,
        root: page.root,
        offset: h.offset,
      }));
    if (this.mode === 'backlinks')
      return this.workspace.index.backlinks(page).map((b) => ({
        label: b.page.title,
        page: b.page,
        root: b.page.root,
        offset: b.link.start,
      }));
    if (!node) {
      const links = page.links.filter((l) => l.kind !== 'image');
      return [
        {
          label: 'Outline',
          root: page.root,
          group: 'outline',
          detail: String(page.headings.length),
          children: this.outline(page),
        },
        {
          label: 'Backlinks',
          root: page.root,
          group: 'backlinks',
          detail: String(backlinks.length),
          children: backlinks.map((b) => ({
            label: b.page.title,
            page: b.page,
            root: b.page.root,
            offset: b.link.start,
            kind: 'link' as const,
          })),
        },
        {
          label: 'Links',
          root: page.root,
          group: 'links',
          detail: String(links.length),
          children: links.flatMap((link): PageNode[] => {
            if (/^(?:[a-z]+:|\/\/)/i.test(link.target)) return [];
            if (
              link.kind === 'markdown' &&
              /\.[a-z\d]+(?:#.*)?$/i.test(link.target) &&
              !/\.md(?:#.*)?$/i.test(link.target)
            )
              return [];
            const result = this.workspace.index.resolve(page, link.target, link.kind);
            return [
              result.page && !result.error
                ? {
                    label: result.page.title,
                    page: result.page,
                    root: page.root,
                    offset: result.heading?.offset,
                    kind: 'link',
                  }
                : {
                    label: link.label || link.target,
                    page,
                    root: page.root,
                    offset: link.start,
                    kind: 'link',
                    broken: result.error || 'missing',
                    detail: result.error || 'missing',
                  },
            ];
          }),
        },
        ...this.taskGroup(page),
        {
          label: 'Properties',
          root: page.root,
          group: 'properties',
          children: [
            { label: 'Path', detail: page.path, root: page.root, kind: 'property', icon: 'file' },
            {
              label: 'Tags',
              detail: page.tags.length ? page.tags.map((t) => `#${t}`).join(' ') : 'none',
              root: page.root,
              kind: 'property',
              icon: 'tag',
            },
            {
              label: 'Status',
              detail: page.draft ? 'Draft' : 'Published',
              root: page.root,
              kind: 'property',
              icon: page.draft ? 'eye-closed' : 'eye',
            },
            ...(page.order === undefined
              ? []
              : [
                  {
                    label: 'Order',
                    detail: String(page.order),
                    root: page.root,
                    kind: 'property' as const,
                    icon: 'list-ordered',
                  },
                ]),
          ],
        },
      ];
    }
    return [];
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.emitter.dispose();
    for (const sub of this.subscriptions) sub.dispose();
  }
}
export async function showPage(
  uri: string | vscode.Uri,
  offset?: number,
  viewColumn?: vscode.ViewColumn,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(
    typeof uri === 'string' ? vscode.Uri.parse(uri) : uri,
  );
  await vscode.window.showTextDocument(doc, {
    ...(offset === undefined
      ? {}
      : { selection: new vscode.Range(doc.positionAt(offset), doc.positionAt(offset)) }),
    viewColumn,
    preview: false,
  });
}
const qualityFixes = new Set([
  'missing-alt',
  'heading-skip',
  'multiple-h1',
  'missing-field',
  'missing-section',
  'duplicate-heading',
]);
/** Quick fixes for content quality findings; each is a single, reviewable text edit. */
function qualityActions(
  doc: vscode.TextDocument,
  page: Page,
  diagnostics: vscode.Diagnostic[],
  issues: QualityIssue[],
): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const text = doc.getText();
  for (const d of diagnostics) {
    const issue = issues.find((i) => i.kind === d.code && i.message === d.message);
    if (!issue) continue;
    const edit = new vscode.WorkspaceEdit();
    let title = '';
    if (issue.kind === 'missing-alt' && issue.offset !== undefined) {
      const link = page.links.find((l) => l.kind === 'image' && l.start === issue.offset);
      if (!link) continue;
      const name = posix
        .basename(link.target.split(/[?#]/)[0], posix.extname(link.target.split(/[?#]/)[0]))
        .replace(/[-_]+/g, ' ')
        .trim();
      const bracket = text.indexOf('[', link.start);
      if (bracket < 0 || bracket > link.targetStart) continue;
      edit.insert(doc.uri, doc.positionAt(bracket + 1), name || 'Image');
      title = `Use “${name || 'Image'}” as alternative text`;
    } else if (
      (issue.kind === 'heading-skip' || issue.kind === 'multiple-h1') &&
      issue.offset !== undefined
    ) {
      const marks = /^#+/.exec(text.slice(issue.offset))?.[0];
      if (!marks) continue;
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(issue.offset), doc.positionAt(issue.offset + marks.length)),
        '#'.repeat(Number(issue.detail)),
      );
      title = `Change to a level ${issue.detail} heading`;
    } else if (issue.kind === 'duplicate-heading' && issue.offset !== undefined) {
      const heading = page.headings.find((h) => h.offset === issue.offset);
      if (!heading) continue;
      const lineEnd = text.indexOf('\n', heading.offset);
      const line = text
        .slice(heading.offset, lineEnd < 0 ? text.length : lineEnd)
        .replace(/\r$/, '');
      const taken = new Set(page.headings.map((h) => h.text.toLocaleLowerCase()));
      let n = 2;
      while (taken.has(`${heading.text} (${n})`.toLocaleLowerCase())) n++;
      const at = line.lastIndexOf(heading.text);
      if (at < 0) continue;
      edit.insert(doc.uri, doc.positionAt(heading.offset + at + heading.text.length), ` (${n})`);
      title = `Rename to “${heading.text} (${n})”`;
    } else if (
      issue.kind === 'missing-field' &&
      issue.detail &&
      !(issue.detail in (page.properties || {}))
    ) {
      const key = /^[A-Za-z_][\w-]*$/.test(issue.detail)
        ? issue.detail
        : JSON.stringify(issue.detail);
      const fm = /^(\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      if (fm) {
        const close = fm[0].search(/\r?\n---(?:\r?\n|$)/);
        edit.insert(doc.uri, doc.positionAt(close), `${eol}${key}: `);
      } else edit.insert(doc.uri, new vscode.Position(0, 0), `---${eol}${key}: ${eol}---${eol}`);
      title = `Add front matter field “${issue.detail}”`;
    } else if (issue.kind === 'missing-section' && issue.detail) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const ending = text.endsWith('\n') ? '' : eol;
      edit.insert(doc.uri, doc.positionAt(text.length), `${ending}${eol}## ${issue.detail}${eol}`);
      title = `Add section “${issue.detail}”`;
    } else continue;
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [d];
    action.edit = edit;
    action.isPreferred = true;
    actions.push(action);
  }
  return actions;
}
export function registerLanguageFeatures(workspace: WikiWorkspace): vscode.Disposable {
  const selector = { language: 'markdown' },
    index = workspace.index;
  const pageAt = (doc: vscode.TextDocument) => index.byUri(doc.uri.toString());
  const linkAt = (doc: vscode.TextDocument, pos: vscode.Position) =>
    pageAt(doc)?.links.find((l) => doc.offsetAt(pos) >= l.start && doc.offsetAt(pos) <= l.end);
  const diagnostics = vscode.languages.createDiagnosticCollection('notespace');
  const issuesOf = (page: Page, sameScope: Page[]): QualityIssue[] => {
    const config = workspace.rootFor(page).config;
    return pageQuality(
      page,
      sameScope,
      config ? rulesFor(config.quality.rules, scopeOf(page.path, config).logical) : [],
    );
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const update = async () => {
    const current = ++revision;
    const output: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];
    // Duplicate titles only matter within one wiki, language and version.
    const groups = new Map<string, Page[]>();
    for (const page of index.all()) {
      const key = `${page.root}\0${index.scope?.(page) ?? ''}`;
      groups.set(key, [...(groups.get(key) || []), page]);
    }
    for (const page of index.all()) {
      if (
        !vscode.workspace
          .getConfiguration('notespace', vscode.Uri.parse(page.uri))
          .get('diagnostics', true)
      )
        continue;
      const offsets = [0];
      for (let i = 0; i < page.text.length; i++) if (page.text[i] === '\n') offsets.push(i + 1);
      const position = (offset: number) => {
        let lo = 0,
          hi = offsets.length;
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1;
          if (offsets[mid] <= offset) lo = mid;
          else hi = mid;
        }
        return new vscode.Position(lo, offset - offsets[lo]);
      };
      const items: vscode.Diagnostic[] = [];
      if (page.metadataError) {
        const d = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 3),
          `Invalid front matter: ${page.metadataError}`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'NoteSpace';
        items.push(d);
      }
      for (const link of page.links) {
        if (link.kind === 'image') {
          if (/^(?:[a-z]+:|\/\/)/i.test(link.target)) continue;
          const uri = await resolveImage(workspace, workspace.rootFor(page), page, link.target);
          if (!uri) {
            const d = new vscode.Diagnostic(
              new vscode.Range(position(link.targetStart), position(link.targetEnd)),
              `Local image not found or unsupported: ${link.target}`,
              vscode.DiagnosticSeverity.Warning,
            );
            d.source = 'NoteSpace';
            d.code = 'image';
            items.push(d);
          }
          continue;
        }
        // Non-Markdown file links are not page links.
        if (
          link.kind === 'markdown' &&
          /\.[a-z\d]+(?:#.*)?$/i.test(link.target) &&
          !/\.md(?:#.*)?$/i.test(link.target)
        ) {
          if (
            /\.(?:pdf|txt|csv|zip|docx|xlsx|pptx)(?:#.*)?$/i.test(link.target) &&
            !(await resolveAttachment(workspace, workspace.rootFor(page), page, link.target))
          ) {
            const d = new vscode.Diagnostic(
              new vscode.Range(position(link.targetStart), position(link.targetEnd)),
              `Local attachment not found: ${link.target}`,
              vscode.DiagnosticSeverity.Warning,
            );
            d.source = 'NoteSpace';
            d.code = 'attachment';
            items.push(d);
          }
          continue;
        }
        const result = index.resolve(page, link.target, link.kind);
        if (!result.error) continue;
        const messages = {
          missing: 'Page not found',
          ambiguous: 'Ambiguous page name; use a path',
          heading: 'Heading not found',
          unsafe: 'Link escapes the wiki or contains an unsafe path',
        };
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(position(link.targetStart), position(link.targetEnd)),
          `${messages[result.error]}: ${link.target}`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.code = result.error;
        diagnostic.source = 'NoteSpace';
        items.push(diagnostic);
      }
      for (const issue of issuesOf(
        page,
        groups.get(`${page.root}\0${index.scope?.(page) ?? ''}`) || [],
      )) {
        const lineEnd = issue.offset === undefined ? -1 : page.text.indexOf('\n', issue.offset);
        const d = new vscode.Diagnostic(
          issue.offset === undefined
            ? new vscode.Range(0, 0, 0, 0)
            : new vscode.Range(
                position(issue.offset),
                position(lineEnd < 0 ? page.text.length : lineEnd),
              ),
          issue.message,
          issue.kind === 'empty' || issue.kind === 'missing-section'
            ? vscode.DiagnosticSeverity.Information
            : vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'NoteSpace';
        d.code = issue.kind;
        items.push(d);
      }
      output.push([vscode.Uri.parse(page.uri), items]);
    }
    if (current !== revision) return;
    diagnostics.clear();
    diagnostics.set(output);
  };
  const subscriptions = [
    diagnostics,
    workspace.onDidChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void update();
      }, 120);
    }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems(doc, pos) {
          const page = pageAt(doc);
          if (!page) return;
          const line = doc.lineAt(pos).text.slice(0, pos.character),
            match = /\[\[([^\]\n|]*)$/.exec(line);
          if (!match) return;
          const prefix = match[1],
            hash = prefix.indexOf('#');
          const range = new vscode.Range(
            pos.line,
            pos.character - prefix.length,
            pos.line,
            pos.character,
          );
          if (hash >= 0) {
            const target = index.resolve(page, prefix.slice(0, hash)).page;
            if (!target) return;
            return target.headings.map((h) => {
              const item = new vscode.CompletionItem(h.text, vscode.CompletionItemKind.Reference);
              item.insertText = `${prefix.slice(0, hash)}#${h.slug}`;
              item.range = range;
              item.filterText = `${prefix.slice(0, hash)}#${h.text}`;
              return item;
            });
          }
          return index.all(page.root).map((p) => {
            const item = new vscode.CompletionItem(p.title, vscode.CompletionItemKind.File);
            item.detail = p.path;
            item.insertText = `/${p.path.replace(/\.md$/i, '')}`;
            item.filterText = `${p.title} /${p.path}`;
            item.range = range;
            return item;
          });
        },
      },
      '[',
      '/',
      '#',
    ),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(doc, pos) {
        const page = pageAt(doc),
          link = linkAt(doc, pos);
        if (!page || !link || link.kind === 'image') return;
        const r = index.resolve(page, link.target, link.kind);
        if (!r.page) return;
        const before = r.page.text.slice(0, r.heading?.offset || 0).split('\n');
        return new vscode.Location(
          vscode.Uri.parse(r.page.uri),
          new vscode.Position(before.length - 1, before.at(-1)!.length),
        );
      },
    }),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(doc, pos) {
        const page = pageAt(doc),
          link = linkAt(doc, pos);
        if (!page || !link || link.kind === 'image') return;
        const r = index.resolve(page, link.target, link.kind);
        if (!r.page) return;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${r.page.title.replace(/[\\*_[\]`]/g, '\\$&')}**  \n`);
        md.appendText(r.page.path);
        md.appendMarkdown('\n\n');
        const excerpt = r.page.body
          .replace(/^(?:#{1,6}\s+.*|\s*)\n/gm, '')
          .trim()
          .slice(0, 350);
        md.appendText(excerpt || 'Empty page');
        if (r.page.tags.length) {
          md.appendMarkdown('\n\n');
          md.appendText(r.page.tags.map((tag) => `#${tag}`).join(' '));
        }
        return new vscode.Hover(md);
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      provideReferences(doc, pos, context) {
        const page = pageAt(doc);
        if (!page) return;
        const link = linkAt(doc, pos),
          target = link ? index.resolve(page, link.target, link.kind).page : page;
        if (!target) return;
        const refs = index.backlinks(target).map((b) => {
          const lines = b.page.text.slice(0, b.link.start).split('\n');
          return new vscode.Location(
            vscode.Uri.parse(b.page.uri),
            new vscode.Position(lines.length - 1, lines.at(-1)!.length),
          );
        });
        if (context.includeDeclaration)
          refs.unshift(
            new vscode.Location(vscode.Uri.parse(target.uri), new vscode.Position(0, 0)),
          );
        return refs;
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(doc) {
        return pageAt(doc)?.headings.map((h) => {
          const p = doc.positionAt(h.offset),
            range = new vscode.Range(p, doc.lineAt(p).range.end);
          return new vscode.DocumentSymbol(h.text, '', vscode.SymbolKind.String, range, range);
        });
      },
    }),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(doc, range, context) {
          const page = pageAt(doc);
          if (!page) return;
          const quality = context.diagnostics.filter(
            (d) =>
              d.source === 'NoteSpace' && typeof d.code === 'string' && qualityFixes.has(d.code),
          );
          const fixes = quality.length
            ? qualityActions(doc, page, quality, issuesOf(page, []))
            : [];
          return fixes.concat(
            context.diagnostics
              .filter((d) => d.source === 'NoteSpace' && d.code === 'missing')
              .flatMap((d) => {
                const link = linkAt(doc, range.start);
                if (!link || link.kind !== 'wiki') return [];
                const raw = link.target.split('#')[0];
                if (!raw) return [];
                const name = raw.startsWith('/')
                  ? raw.slice(1)
                  : /^\.{1,2}\//.test(raw)
                    ? posix.join(posix.dirname(page.path), raw)
                    : raw;
                const action = new vscode.CodeAction(
                  `Create page “${name}”`,
                  vscode.CodeActionKind.QuickFix,
                );
                action.diagnostics = [d];
                action.command = {
                  command: 'notespace.newPage',
                  title: 'Create Page',
                  arguments: [name, page.root],
                };
                return [action];
              }),
          );
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  ];
  void update();
  return new vscode.Disposable(() => {
    if (timer) clearTimeout(timer);
    subscriptions.forEach((s) => s.dispose());
  });
}

import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { randomBytes } from 'node:crypto';
import { WikiRoot, WikiWorkspace } from './workspace';
import { PlannerService } from './planner';
import { BoardService } from './boards';
import { Task, TaskChange, TaskStatus, taskStatuses } from './core/tasks';
import {
  Board,
  boardColors,
  BoardColor,
  BoardConfig,
  columnOf,
  isMember,
  STATUS_BOARD,
  statusBoard,
  subtaskKeys,
  statusColumns,
} from './core/boards';
import { contentHealth } from './core/quality';
import { plannerCss } from './planner-css';
import { WikiActivity } from './activity';
import { namedPage, posix } from './core/paths';
import { navOrder, navTree, pageIcon, pageShowsPager, pageStatus } from './core/nav-tree';
import { excerptOf, linkMention, unlinkedMentions } from './core/mentions';
import { propertyValue, PropertyType, typedProperties, validPropertyKey } from './core/properties';
import { withFrontMatter } from './core/frontmatter';
import { listTemplates } from './template-files';
import { fillTemplate } from './templates';
import { defaultAcronyms, DirectorySort, isFolderIndex } from './core/titles';
import { escapeHtml, pageCss, safeExternal } from './core/render';
import { fonts, resolveAppearance, widths } from './core/themes';
import type { Page } from './core/model';
import { resolveAttachment, resolveImage } from './assets';
import { richTabsScript } from './core/reader-interactions';
import { tokensCss } from './core/design';
import { apiClientCss } from './api-client-css';
import type { HttpBlocks } from './http-blocks';

/** Destinations of the workspace panel; the old Planner views are kept as aliases. */
export type PlannerView =
  | 'home'
  | 'wiki'
  | 'api'
  | 'health'
  | 'graph'
  | 'tasks'
  | 'boards'
  | 'board'
  | 'calendar'
  | 'insights'
  | 'today'
  | 'upcoming'
  | 'inbox'
  | 'overdue'
  | 'completed'
  | 'table';
export const plannerViews: PlannerView[] = [
  'home',
  'wiki',
  'api',
  'health',
  'graph',
  'tasks',
  'boards',
  'board',
  'calendar',
  'insights',
  'today',
  'upcoming',
  'inbox',
  'overdue',
  'completed',
  'table',
];
type Destination =
  | 'home'
  | 'wiki'
  | 'api'
  | 'health'
  | 'graph'
  | 'tasks'
  | 'boards'
  | 'board'
  | 'calendar'
  | 'insights';
type TaskList = 'today' | 'upcoming' | 'overdue' | 'inbox' | 'all' | 'completed';
interface SavedView {
  name: string;
  list: TaskList;
  layout: 'list' | 'table';
  filter: Record<string, string>;
  group?: string;
}
interface Prefs {
  destination: Destination;
  taskList: TaskList;
  taskLayout: 'list' | 'table';
  group: 'none' | 'board' | 'page' | 'priority' | 'project';
  board: string;
  statusColumns: TaskStatus[];
  swimlane: 'none' | 'project' | 'priority';
  calendar: 'month' | 'week' | 'day';
  pinned: string[];
  recentBoards: string[];
  savedViews: SavedView[];
  /** The page shown in the Wiki destination (a path in the current wiki). */
  wikiPage?: string;
}

const lists: TaskList[] = ['today', 'upcoming', 'overdue', 'inbox', 'all', 'completed'];
const destinations: Destination[] = [
  'home',
  'wiki',
  'api',
  'health',
  'graph',
  'tasks',
  'boards',
  'board',
  'calendar',
  'insights',
];

/** Subtasks: following tasks of the same page that are indented deeper. */
function subtaskCounts(tasks: Task[]): Map<string, { total: number; done: number }> {
  const out = new Map<string, { total: number; done: number }>();
  const byPage = new Map<string, Task[]>();
  for (const t of tasks) byPage.set(t.pageId, [...(byPage.get(t.pageId) || []), t]);
  for (const list of byPage.values()) {
    list.sort((a, b) => a.line - b.line);
    for (let i = 0; i < list.length; i++) {
      const parent = list[i];
      let total = 0,
        done = 0;
      for (let j = i + 1; j < list.length && list[j].indent.length > parent.indent.length; j++) {
        total++;
        if (list[j].checked) done++;
      }
      if (total) out.set(parent.key, { total, done });
    }
  }
  return out;
}

const dto = (
  task: Task,
  boards: Board[],
  subtasks: Map<string, { total: number; done: number }>,
  nested: Set<string>,
) => ({
  key: task.key,
  title: task.title,
  description: task.description,
  status: task.status,
  checked: task.checked,
  priority: task.priority,
  due: task.due,
  start: task.start,
  done: task.done,
  repeat: task.repeat,
  project: task.project,
  assignee: task.assignee,
  order: task.order,
  tags: task.tags,
  links: task.links,
  pagePath: task.pagePath,
  pageTitle: task.pageTitle,
  journal: task.journal,
  board: task.board,
  // Board id → column id, for every board the task is on.
  boards: Object.fromEntries(
    boards
      .filter((b) => isMember(task, b) && (!nested.has(task.key) || !!task.board))
      .map((b) => [b.id, columnOf(task, b)]),
  ),
  subtasks: subtasks.get(task.key),
});

const boardDto = (board: Board, tasks: Task[], nested: Set<string>) => {
  const members = tasks.filter((t) => isMember(t, board) && (!nested.has(t.key) || !!t.board));
  const columns = new Map(members.map((t) => [t.key, columnOf(t, board)]));
  const completed = new Set(board.columns.filter((c) => c.completed).map((c) => c.id));
  return {
    ...board,
    count: members.length,
    open: members.filter((t) => !completed.has(columns.get(t.key)!)).length,
    inProgress: members.filter(
      (t) => !completed.has(columns.get(t.key)!) && columns.get(t.key) !== board.defaultColumn,
    ).length,
  };
};

/**
 * The NoteSpace workspace panel: Home, Tasks, Boards, Calendar and Insights over the same
 * task lines (PlannerService) and board pages (BoardService). Wiki reads the pages in place,
 * with an MkDocs-style navigation.
 */
export class PlannerPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private rootId?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions: vscode.Disposable[];
  readonly boards: BoardService;
  /** Renders a page body for a webview (set by the extension; shared with the Reader). */
  reader?: (
    page: Page,
    webview: vscode.Webview,
    href: (target: Page, anchor?: string) => string,
  ) => Promise<string>;
  /** The API Client, shown as the API destination (set by the extension). */
  api?: { receive(message: Record<string, unknown>): void; hostClosed(): void };
  /** Content health and the link graph, shown as Insights pages (set by the extension). */
  pages?: {
    frameDocument(
      kind: 'health' | 'graph',
      rootId?: string,
    ): Promise<{ title: string; css: string; body: string; scripts: string[] }>;
    handleFrame(message: unknown, openInPanel: (page: Page) => Promise<void>): Promise<void>;
  };
  /** Notebooks and canvases of a wiki, listed with its pages (set by the extension). */
  files?: (rootId: string) => Array<{ path: string; uri: string; file: 'notebook' | 'canvas' }>;
  /** Frame documents last sent, so unchanged pages are not reloaded. */
  private frameSent = new Map<string, string>();
  /** ```http blocks of wiki pages (set by the extension; shared with the Reader). */
  http?: HttpBlocks;
  /** Text of the page last sent to the Wiki destination, to re-render only on change. */
  private wikiShown?: string;
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly planner: PlannerService,
    private readonly extensionUri: vscode.Uri,
    private readonly memento: vscode.Memento,
    private readonly open: (uri: vscode.Uri, line?: number) => Promise<void>,
    private readonly activity?: WikiActivity,
  ) {
    this.boards = new BoardService(workspace, planner);
    this.subscriptions = [
      planner.onDidChange(() => this.schedule()),
      workspace.onDidChange(() => {
        const destination = this.prefs().destination;
        if (!this.panel) return;
        if (destination === 'wiki') void this.sendWikiPage();
        if (destination === 'health' || destination === 'graph') void this.sendFrame(destination);
      }),
    ];
  }
  get visible(): boolean {
    return !!this.panel;
  }
  get destination(): Destination {
    return this.prefs().destination;
  }
  private prefs(): Prefs {
    const stored = this.memento.get<Partial<Prefs> & { view?: string; columns?: string[] }>(
      'planner.prefs',
      {},
    );
    const columns = (stored.statusColumns || stored.columns || []).filter((c): c is TaskStatus =>
      taskStatuses.includes(c as TaskStatus),
    );
    // Preferences of the earlier Planner (`view`) map onto the new destinations.
    const legacy = stored.view;
    const destination: Destination = destinations.includes(stored.destination as Destination)
      ? (stored.destination as Destination)
      : legacy === 'board'
        ? 'board'
        : legacy === 'calendar'
          ? 'calendar'
          : legacy
            ? 'tasks'
            : 'home';
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
    return {
      destination,
      taskList: lists.includes(stored.taskList as TaskList)
        ? (stored.taskList as TaskList)
        : lists.includes(legacy as TaskList)
          ? (legacy as TaskList)
          : 'today',
      taskLayout: stored.taskLayout === 'table' || legacy === 'table' ? 'table' : 'list',
      group: ['none', 'board', 'page', 'priority', 'project'].includes(stored.group || '')
        ? stored.group!
        : 'none',
      board: typeof stored.board === 'string' ? stored.board : STATUS_BOARD,
      statusColumns: columns.length === taskStatuses.length ? columns : [...taskStatuses],
      swimlane: ['none', 'project', 'priority'].includes(stored.swimlane || '')
        ? stored.swimlane!
        : 'none',
      calendar: ['month', 'week', 'day'].includes(stored.calendar || '')
        ? stored.calendar!
        : 'month',
      pinned: strings(stored.pinned),
      recentBoards: strings(stored.recentBoards),
      savedViews: Array.isArray(stored.savedViews) ? stored.savedViews.slice(0, 30) : [],
      wikiPage: typeof stored.wikiPage === 'string' ? stored.wikiPage : undefined,
    };
  }
  private async setPrefs(next: Partial<Prefs>): Promise<void> {
    const { ...current } = this.prefs();
    await this.memento.update('planner.prefs', { ...current, ...next });
  }
  root(): WikiRoot | undefined {
    const active = this.activity?.activeUri && this.workspace.index.byUri(this.activity.activeUri);
    return (
      this.workspace.roots.find((r) => r.id === this.rootId) ||
      (active ? this.workspace.rootFor(active) : undefined) ||
      this.workspace.roots.find((r) => r.id === this.workspace.defaultRoot) ||
      this.workspace.roots[0]
    );
  }

  /** Opens (or reveals) the panel; `view` picks a destination or a task list. */
  show(view?: PlannerView | string, boardId?: string): void {
    const v = view as PlannerView | undefined;
    if (v && plannerViews.includes(v)) {
      const next: Partial<Prefs> = destinations.includes(v as Destination)
        ? { destination: v as Destination }
        : v === 'table'
          ? { destination: 'tasks', taskLayout: 'table' }
          : { destination: 'tasks', taskList: v as TaskList, taskLayout: 'list' };
      if (boardId) Object.assign(next, { board: boardId, destination: 'board' });
      void this.setPrefs(next).then(() => this.post(false, next));
    } else if (boardId)
      void this.setPrefs({ destination: 'board', board: boardId }).then(() =>
        this.post(false, { destination: 'board', board: boardId }),
      );
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'notespace.planner',
        'NoteSpace',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          // Wiki images and media are served from the wiki folders.
          localResourceRoots: [
            this.extensionUri,
            ...this.workspace.roots.flatMap((r) =>
              r.projectUri ? [r.uri, r.projectUri] : [r.uri],
            ),
          ],
        },
      );
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(this.extensionUri, 'media', 'notespace-light.svg'),
        dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'notespace-dark.svg'),
      };
      const nonce = randomBytes(18).toString('base64');
      const script = this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'planner.js'),
      );
      this.panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${this.panel.webview.cspSource} data:; media-src ${this.panel.webview.cspSource}; base-uri 'none'; form-action 'none'"><title>NoteSpace</title><style>${plannerCss}\n${pageCss}</style></head><body><div id="app"></div><script nonce="${nonce}">${richTabsScript}</script><script nonce="${nonce}" src="${script}"></script></body></html>`;
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.wikiShown = undefined;
        this.api?.hostClosed();
        this.frameSent.clear();
      });
      // Messages are handled one at a time: two quick edits of the same page must not both
      // compute their change from the same text.
      this.panel.webview.onDidReceiveMessage((message) => {
        this.queue = this.queue.then(() =>
          this.onMessage(message).catch((error) => {
            const text = error instanceof Error ? error.message : String(error);
            // The view rolls back optimistic changes when it receives the current state again.
            void this.panel?.webview.postMessage({ type: 'error', message: text });
            this.post(true);
          }),
        );
      });
    } else this.panel.reveal();
  }

  /** A message for the API Client frame. */
  postApi(message: unknown): Thenable<boolean> {
    return (
      this.panel?.webview.postMessage({ type: 'frame', frame: 'api', message }) ??
      Promise.resolve(false)
    );
  }

  /** Sends a frame's document (the API Client once; Insights pages again when they change). */
  private async sendFrame(frame: 'api' | 'health' | 'graph'): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    let doc: { title: string; css: string; body: string; scripts: string[] } | undefined;
    if (frame === 'api') {
      if (this.frameSent.has('api')) return;
      const code = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'api-client.js'),
      );
      doc = {
        title: 'API Client',
        css: `${tokensCss}${apiClientCss}`,
        body: '<div id="app"></div>',
        scripts: [new TextDecoder().decode(code)],
      };
    } else doc = await this.pages?.frameDocument(frame, this.root()?.id);
    if (!doc || this.panel !== panel) return;
    const key = frame === 'api' ? 'sent' : doc.body;
    if (this.frameSent.get(frame) === key) return;
    this.frameSent.set(frame, key);
    void panel.webview.postMessage({ type: 'frameDoc', frame, doc });
  }

  /**
   * Shows the Wiki destination: a page (by id or path), a section (expanded, with its own page
   * when it has one) or the page filter.
   */
  async showWiki(target: {
    path?: string;
    id?: string;
    root?: string;
    section?: string;
    filter?: boolean;
  }): Promise<void> {
    this.show('wiki');
    const byId = target.id ? this.workspace.index.pages.get(target.id) : undefined;
    const rootId = byId?.root || target.root;
    if (rootId && this.workspace.roots.some((r) => r.id === rootId)) this.rootId = rootId;
    const root = this.root();
    const pages = root ? this.wikiPages(root) : [];
    const section = target.section?.replace(/\/?$/, '/');
    const page =
      byId ||
      (target.path ? pages.find((p) => p.path === target.path) : undefined) ||
      (section
        ? pages.find(
            (p) =>
              p.path.startsWith(section) &&
              isFolderIndex(p.path) &&
              !p.path.slice(section.length).includes('/'),
          )
        : undefined);
    if (page) await this.setPrefs({ destination: 'wiki', wikiPage: page.path });
    else await this.setPrefs({ destination: 'wiki' });
    this.post(false, { destination: 'wiki', ...(page ? { wikiPage: page.path } : {}) });
    await this.sendWikiPage(undefined, true);
    if (section || target.filter)
      void this.panel?.webview.postMessage({ type: 'wikiReveal', section, filter: target.filter });
  }

  /** Sends the state again (a list it shows changed elsewhere). */
  refresh(): void {
    this.schedule();
  }

  private schedule(): void {
    if (!this.panel) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.post(), 80);
  }

  private insights(root: WikiRoot, tasks: Task[], today: string) {
    const pages = this.workspace.index
      .all(root.id)
      .filter((p) => !this.workspace.isArchived(p) && !this.workspace.isVariant(p));
    const homepage = root.config?.content.homepage || 'index.md';
    const daily = this.planner.config(root).dailyFolder;
    const boardFiles = new Set(this.boards.boards(root.id).map((b) => b.pagePath));
    const health = contentHealth(
      this.workspace.index,
      pages,
      homepage,
      (p) => this.workspace.index.scope?.(p) ?? '',
    );
    const words = pages.reduce((n, p) => n + (p.body.match(/\S+/g)?.length || 0), 0);
    const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      pages: pages.length,
      words,
      sections: new Set(pages.map((p) => posix.dirname(p.path))).size,
      dailyNotes: pages.filter((p) => p.path.startsWith(`${daily}/`)).length,
      score: health.score,
      broken: health.broken.slice(0, 8).map((b) => ({
        title: b.page.title,
        path: b.page.path,
        uri: b.page.uri,
        target: b.target,
      })),
      brokenCount: health.broken.length,
      orphans: health.orphans
        .filter(
          (p) =>
            !p.path.startsWith(`${daily}/`) &&
            p.path !== this.planner.config(root).inbox &&
            !boardFiles.has(p.path),
        )
        .slice(0, 8)
        .map((p) => ({ title: p.title, path: p.path, uri: p.uri })),
      orphanCount: health.orphans.filter(
        (p) =>
          !p.path.startsWith(`${daily}/`) &&
          p.path !== this.planner.config(root).inbox &&
          !boardFiles.has(p.path),
      ).length,
      issues:
        health.duplicateHeadings.length +
        health.duplicateTitles.length +
        health.metadata.length +
        health.empty.length +
        health.structure.length +
        health.rules.length,
      tasks: {
        total: tasks.length,
        open: tasks.filter((t) => !t.checked).length,
        done: tasks.filter((t) => t.checked).length,
        overdue: tasks.filter((t) => !t.checked && t.due && t.due.slice(0, 10) < today).length,
        doneThisWeek: tasks.filter((t) => t.checked && t.done && t.done >= weekAgo).length,
      },
    };
  }

  /** Sends the state; `go` asks the view to switch destination (commands, created boards). */
  private post(force = false, go?: Partial<Prefs>): void {
    const panel = this.panel;
    const root = this.root();
    if (!panel) return;
    if (!root) {
      void panel.webview.postMessage({ type: 'state', empty: true, force });
      return;
    }
    const config = this.planner.config(root);
    const prefs = this.prefs();
    const notes = [...this.planner.dailyNotes(root).keys()].sort();
    const tasks = this.planner.tasks(root.id);
    const boards = this.boards.boards(root.id);
    const subtasks = subtaskCounts(tasks);
    const nested = subtaskKeys(tasks);
    const today = this.planner.today(root);
    const homepage = root.config?.content.homepage || 'index.md';
    const pages = this.workspace.index
      .all(root.id)
      .filter((p) => !this.workspace.isArchived(p) && !this.workspace.isVariant(p));
    const pageDto = (p: (typeof pages)[number]) => ({
      title: p.title,
      path: p.path,
      uri: p.uri,
      section: posix.dirname(p.path) === '.' ? '' : posix.dirname(p.path),
      modified: this.workspace.modifiedAt(p.uri),
    });
    const recent = pages
      .filter((p) => this.workspace.modifiedAt(p.uri))
      .sort((a, b) => this.workspace.modifiedAt(b.uri)! - this.workspace.modifiedAt(a.uri)!)
      .slice(0, 8)
      .map(pageDto);
    void panel.webview.postMessage({
      type: 'state',
      force,
      go,
      today,
      roots: this.workspace.roots.map((r) => ({ id: r.id, name: r.name })),
      root: root.id,
      workspace: {
        name: root.config?.wiki.title || root.name,
        description: root.config?.wiki.description || root.look?.description || '',
        icon: root.config?.wiki.icon || root.look?.icon,
        color: root.config?.wiki.color || root.look?.color,
        // The site's announcement, also shown above Wiki pages (inline Markdown, no HTML).
        announcement: root.config?.wiki.announcement
          ? new MarkdownIt({ html: false, linkify: true }).renderInline(
              root.config.wiki.announcement,
            )
          : undefined,
        homepage: pages.some((p) => p.path === homepage) ? homepage : undefined,
        boardsFolder: vscode.workspace
          .getConfiguration('notespace', root.folder.uri)
          .get<string>('boards.folder', 'boards'),
        notesFolder: vscode.workspace
          .getConfiguration('notespace', root.folder.uri)
          .get<string>('notes.folder', 'notes'),
      },
      tasks: tasks.map((t) => dto(t, boards, subtasks, nested)),
      boards: boards.map((b) => boardDto(b, tasks, nested)),
      statusBoard: {
        ...statusBoard(prefs.statusColumns.map((id) => statusColumns.find((c) => c.id === id)!)),
        count: tasks.length,
      },
      notes,
      streak: this.planner.streak(root),
      prefs,
      upcomingDays: config.upcomingDays,
      timeZone: config.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      inbox: config.inbox,
      home: {
        recent,
        favorites: (this.activity?.favoritePages() || [])
          .filter((p) => p.root === root.id)
          .slice(0, 8)
          .map(pageDto),
        dailyNote: notes.includes(today),
      },
      insights:
        prefs.destination === 'insights' || prefs.destination === 'home'
          ? this.insights(root, tasks, today)
          : undefined,
      wiki: { tree: this.wikiTree(root) },
    });
    // After an error the page is sent again too, undoing a checkbox that did not save.
    if (prefs.destination === 'wiki' || go?.destination === 'wiki')
      void this.sendWikiPage(undefined, force);
    const page = go?.destination || prefs.destination;
    if (page === 'health' || page === 'graph') void this.sendFrame(page);
  }

  /** Pages the Wiki destination lists: published pages, without archived versions or translations. */
  private wikiPages(root: WikiRoot): Page[] {
    return this.workspace.index
      .all(root.id)
      .filter((p) => !this.workspace.isArchived(p) && !this.workspace.isVariant(p));
  }
  /** The Wiki destination's page tree (also used by tests). */
  wikiTree(root: WikiRoot) {
    const settings = vscode.workspace.getConfiguration('notespace.explorer', root.folder.uri);
    const files = (this.files?.(root.id) || []).map((f) => ({
      id: f.uri,
      path: f.path,
      title: posix.basename(f.path),
      uri: f.uri,
      file: f.file,
    }));
    return navTree([...this.wikiPages(root), ...files], {
      sort: root.config?.navigation.sort || 'filename',
      directorySort: settings.get<DirectorySort>('directorySort', 'folders-first'),
      readable: settings.get<boolean>('humanizeNames', true),
      acronyms: settings.get<string[]>('acronyms', defaultAcronyms),
    });
  }
  /** The page of the Wiki destination: the one last read, else the homepage, else the first. */
  private wikiPage(root: WikiRoot): Page | undefined {
    const pages = this.wikiPages(root);
    const wanted = this.prefs().wikiPage;
    const homepage = root.config?.content.homepage || 'index.md';
    return (
      (wanted && pages.find((p) => p.path === wanted)) ||
      pages.find((p) => p.path === homepage) ||
      pages.find((p) => /^(index|home|readme)\.md$/i.test(p.path)) ||
      navOrder(this.wikiTree(root))
        .map((n) => pages.find((p) => p.id === n.id))
        .find(Boolean)
    );
  }
  /** Rewrites a page's text with an edit of the whole document, then saves it. */
  private async editText(uri: string, change: (text: string) => string): Promise<void> {
    const target = vscode.Uri.parse(uri);
    const document = await vscode.workspace.openTextDocument(target);
    const text = document.getText();
    const next = change(text);
    if (next === text) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      target,
      new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
      next,
    );
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not edit the page.');
    await document.save();
    await this.workspace.refresh();
  }
  /** The pages of a folder as database rows: their typed properties, icon, status and cover. */
  private async sendDatabase(prefix: string): Promise<void> {
    const panel = this.panel;
    const root = this.root();
    if (!panel || !root) return;
    const rows = [];
    for (const page of this.wikiPages(root)) {
      if (!page.path.startsWith(prefix)) continue;
      const rest = page.path.slice(prefix.length);
      if (rest.includes('/') || isFolderIndex(page.path)) continue;
      const coverTarget = page.properties?.cover || page.properties?.image;
      let cover: string | undefined;
      if (coverTarget && !/^[a-z][a-z0-9+.-]*:/i.test(coverTarget)) {
        const uri = await resolveImage(this.workspace, root, page, coverTarget);
        if (uri) cover = panel.webview.asWebviewUri(uri).toString();
      }
      rows.push({
        id: page.id,
        uri: page.uri,
        path: page.path,
        title: page.title,
        icon: pageIcon(page),
        status: pageStatus(page),
        cover,
        excerpt: excerptOf(page, 140),
        modified: this.workspace.modifiedAt(page.uri),
        properties: typedProperties(page.text),
      });
    }
    if (this.panel === panel)
      void panel.webview.postMessage({ type: 'wikiDatabase', prefix, rows });
  }
  /** Renders the current wiki page into the panel when it (or the page) changed. */
  private async sendWikiPage(anchor?: string, force = false): Promise<void> {
    const panel = this.panel;
    const root = this.root();
    if (!panel || !root) return;
    const page = this.wikiPage(root);
    if (!page) {
      this.wikiShown = undefined;
      void panel.webview.postMessage({ type: 'wikiPage', page: undefined });
      return;
    }
    const backlinks = this.workspace.index
      .backlinks(page)
      .filter(
        (b, i, all) => b.page.id !== page.id && all.findIndex((x) => x.page.id === b.page.id) === i,
      )
      .map((b) => ({ id: b.page.id, title: b.page.title, path: b.page.path }));
    // Linking a mention elsewhere changes this page's backlinks, not its text.
    const key = `${page.uri}\0${page.text}\0${vscode.window.activeColorTheme.kind}\0${backlinks
      .map((b) => b.id)
      .join(',')}`;
    if (!force && !anchor && key === this.wikiShown) return;
    this.wikiShown = key;
    const href = (p: Page, a?: string) =>
      p.id === page.id && a
        ? `#${a}`
        : `#wiki:${encodeURIComponent(p.id)}${a ? `?anchor=${encodeURIComponent(a)}` : ''}`;
    const body = this.reader
      ? await this.reader(page, panel.webview, href)
      : `<pre>${escapeHtml(page.body)}</pre>`;
    const look = resolveAppearance(root.config?.appearance);
    // Pages that write this page's title without linking to it.
    const linking = new Set(backlinks.map((b) => b.id));
    const mentions = unlinkedMentions(page, this.wikiPages(root), (p) => linking.has(p.id), 12).map(
      (m) => ({
        id: m.page.id,
        title: m.page.title,
        path: m.page.path,
        excerpt: m.excerpt,
        offset: m.offset,
        length: m.length,
      }),
    );
    const coverTarget = page.properties?.cover || page.properties?.image;
    let cover: string | undefined;
    if (coverTarget && !/^[a-z][a-z0-9+.-]*:/i.test(coverTarget)) {
      const uri = await resolveImage(this.workspace, root, page, coverTarget);
      if (uri) cover = panel.webview.asWebviewUri(uri).toString();
    }
    if (this.panel !== panel) return;
    void panel.webview.postMessage({
      type: 'wikiPage',
      anchor,
      page: {
        id: page.id,
        uri: page.uri,
        path: page.path,
        title: page.title,
        tags: page.tags,
        draft: page.draft,
        status: pageStatus(page),
        icon: pageIcon(page),
        pager: pageShowsPager(page),
        cover,
        description: page.description,
        properties: typedProperties(page.text),
        mentions,
        modified: this.workspace.modifiedAt(page.uri),
        headings:
          root.config?.features.tableOfContents === false
            ? []
            : page.headings
                .filter((h) => h.level > 1 && h.level < 5)
                .map((h) => ({ level: h.level, text: h.text, slug: h.slug })),
        backlinks,
        html: body,
        font: root.config ? fonts[look.font] : undefined,
        width: root.config ? widths[look.width] : undefined,
      },
    });
  }

  /** A message from the panel's webview (also used by tests). */
  async onMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    const root = this.root();
    const key = typeof m.key === 'string' ? m.key : '';
    const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const boardId = str(m.boardId, 80) || '';
    // Blocks of the wiki page: embedded boards and ```http requests, as in the Reader.
    const panel = this.panel;
    const reply = (message: unknown) =>
      panel?.webview.postMessage(message) ?? Promise.resolve(false);
    if (await this.planner.handleMove(m, reply)) return;
    if (this.http && (await this.http.handle(m, reply))) return;
    switch (m.type) {
      case 'ready':
        this.post();
        return;
      case 'renameWiki': {
        const name = str(m.name, 80)?.trim();
        if (root && name)
          await vscode.commands.executeCommand(
            'notespace.renameWiki',
            { label: root.name, root: root.id, prefix: '' },
            name,
          );
        this.post();
        return;
      }
      case 'wikiPreview': {
        const page = root && this.wikiPages(root).find((p) => p.id === str(m.id, 2000));
        if (page)
          void reply({
            type: 'wikiPreview',
            id: page.id,
            title: page.title,
            path: page.path,
            excerpt: excerptOf(page),
            status: pageStatus(page),
            icon: pageIcon(page),
            tags: page.tags,
          });
        return;
      }
      case 'wikiProperty': {
        // A front matter property edited in the Wiki (page properties or a database cell).
        const page = root && this.wikiPages(root).find((p) => p.uri === str(m.uri, 2000));
        const key = str(m.key, 40) || '';
        const type = str(m.propertyType, 12) as PropertyType;
        if (!page || !validPropertyKey(key)) return;
        try {
          const value = m.remove
            ? null
            : propertyValue(
                ['text', 'number', 'checkbox', 'date', 'list', 'url'].includes(type)
                  ? type
                  : 'text',
                m.value,
              );
          await this.editText(page.uri, (text) => withFrontMatter(text, { [key]: value }));
          if (typeof m.database === 'string') void this.sendDatabase(m.database);
        } catch (error) {
          void reply({
            type: 'toast',
            text: error instanceof Error ? error.message : String(error),
            error: true,
          });
          this.post(true);
        }
        return;
      }
      case 'templates': {
        // The template gallery: each template with a rendered preview.
        if (!root) return;
        const md = new MarkdownIt({ html: false, linkify: true });
        const items = (await listTemplates(this.workspace, root)).map((t) => ({
          label: t.label,
          description: t.description,
          preview: md.render(fillTemplate(t.body, 'Untitled')).slice(0, 20000),
        }));
        void reply({ type: 'templates', items });
        return;
      }
      case 'templateCreate': {
        // From the gallery (with a title) or a template button in a page (asks for it).
        if (!root) return;
        const name = str(m.name, 120);
        const prefix = str(m.prefix, 1000);
        if (!name) return;
        await vscode.commands.executeCommand(
          'notespace.newFromTemplate',
          { label: '', root: root.id, prefix: prefix ?? '' },
          name,
          str(m.title, 200),
        );
        return;
      }
      case 'wikiDatabase': {
        const prefix = str(m.prefix, 1000);
        if (prefix !== undefined) void this.sendDatabase(prefix);
        return;
      }
      case 'wikiDatabaseNew': {
        // A new page in the database's folder, with the properties the view is filtered by.
        const prefix = str(m.prefix, 1000) || '';
        const title = (str(m.title, 200) || '').trim();
        if (!root || !title) return;
        const fields =
          m.fields && typeof m.fields === 'object' ? (m.fields as Record<string, unknown>) : {};
        const values: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields))
          if (validPropertyKey(k) && ['string', 'number', 'boolean'].includes(typeof v))
            values[k] = v;
        try {
          // A URL-safe file name in the folder; the title stays as typed.
          const named = namedPage(`${prefix}${title.replace(/\//g, '-')}`);
          await this.workspace.createPage(
            root,
            named.path,
            withFrontMatter(`# ${title}\n`, values),
          );
          void this.sendDatabase(prefix);
        } catch (error) {
          void reply({
            type: 'toast',
            text: error instanceof Error ? error.message : String(error),
            error: true,
          });
        }
        return;
      }
      case 'linkMention': {
        const pages = root ? this.wikiPages(root) : [];
        const from = pages.find((p) => p.id === str(m.id, 2000));
        const target = pages.find((p) => p.id === str(m.target, 2000));
        const offset = Number(m.offset);
        const length = Number(m.length);
        if (!from || !target || !Number.isInteger(offset) || !Number.isInteger(length)) return;
        try {
          const uri = vscode.Uri.parse(from.uri);
          const document = await vscode.workspace.openTextDocument(uri);
          const text = document.getText();
          const next = linkMention(text, offset, length, target.title);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            uri,
            new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
            next,
          );
          if (await vscode.workspace.applyEdit(edit)) await document.save();
        } catch (error) {
          void vscode.window.showWarningMessage(
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }
      case 'frameDoc':
        // The API Client and the Insights pages run in same-origin frames of this webview
        // (their styles and shortcuts stay their own).
        if (m.frame === 'api' || m.frame === 'health' || m.frame === 'graph')
          await this.sendFrame(m.frame);
        return;
      case 'frame': {
        if (!m.message || typeof m.message !== 'object') return;
        if (m.frame === 'api') this.api?.receive(m.message as Record<string, unknown>);
        else if (m.frame === 'health' || m.frame === 'graph')
          await this.pages?.handleFrame(m.message, (page) => this.showWiki({ id: page.id }));
        return;
      }
      case 'setRoot':
        if (typeof m.id === 'string') this.rootId = m.id;
        this.post();
        return;
      case 'prefs': {
        if (!m.prefs || typeof m.prefs !== 'object') return;
        const p = m.prefs as Partial<Prefs>;
        const next: Partial<Prefs> = {};
        if (destinations.includes(p.destination as Destination)) next.destination = p.destination;
        if (lists.includes(p.taskList as TaskList)) next.taskList = p.taskList;
        if (p.taskLayout === 'list' || p.taskLayout === 'table') next.taskLayout = p.taskLayout;
        if (['none', 'board', 'page', 'priority', 'project'].includes(p.group as string))
          next.group = p.group;
        if (typeof p.board === 'string') {
          next.board = p.board;
          const recent = this.prefs().recentBoards.filter((b) => b !== p.board);
          next.recentBoards = [p.board, ...recent].slice(0, 8);
        }
        if (
          Array.isArray(p.statusColumns) &&
          p.statusColumns.length === taskStatuses.length &&
          p.statusColumns.every((c) => taskStatuses.includes(c))
        )
          next.statusColumns = p.statusColumns;
        if (['none', 'project', 'priority'].includes(p.swimlane as string))
          next.swimlane = p.swimlane;
        if (['month', 'week', 'day'].includes(p.calendar as string)) next.calendar = p.calendar;
        if (Array.isArray(p.savedViews)) next.savedViews = p.savedViews.slice(0, 30);
        await this.setPrefs(next);
        if (next.destination === 'wiki') void this.sendWikiPage(undefined, true);
        if (next.destination === 'health' || next.destination === 'graph')
          void this.sendFrame(next.destination);
        if (next.destination === 'insights' || next.board) this.post();
        return;
      }
      case 'pin': {
        if (!boardId) return;
        const pinned = this.prefs().pinned.filter((b) => b !== boardId);
        await this.setPrefs({ pinned: m.pinned === false ? pinned : [boardId, ...pinned] });
        this.post();
        return;
      }
      case 'add': {
        if (!root || typeof m.text !== 'string' || !m.text.trim()) return;
        const fields = sanitize(
          (m.fields && typeof m.fields === 'object' ? m.fields : {}) as TaskChange,
        );
        const text = m.text.slice(0, 500);
        if (m.target === 'board' && boardId) {
          await this.boards.addCard(boardId, text, str(m.column, 80), root.id);
          return;
        }
        const destination = vscode.workspace
          .getConfiguration('notespace', root.folder.uri)
          .get<string>('tasks.captureTo', 'inbox');
        const target =
          typeof m.date === 'string' && m.target === 'daily'
            ? { kind: 'daily' as const, date: m.date }
            : m.target === 'page' && typeof m.pageId === 'string'
              ? { kind: 'page' as const, pageId: m.pageId }
              : destination === 'daily'
                ? { kind: 'daily' as const, date: this.planner.today(root) }
                : { kind: 'inbox' as const };
        await this.planner.add(root, text, target, fields);
        return;
      }
      case 'update':
        if (key && m.change && typeof m.change === 'object')
          await this.planner.update(key, sanitize(m.change as TaskChange));
        return;
      case 'complete':
        if (key) await this.planner.complete(key, m.done !== false);
        return;
      case 'remove': {
        if (!key) return;
        const choice = await vscode.window.showWarningMessage(
          'Delete this task from its page?',
          {
            modal: true,
            detail: 'The line is removed from the Markdown file. Undo in the page restores it.',
          },
          'Delete Task',
        );
        if (choice) await this.planner.remove(key);
        return;
      }
      case 'duplicate':
        if (key) await this.boards.duplicateTask(key);
        return;
      case 'reorder':
        if (
          Array.isArray(m.keys) &&
          m.keys.every((k) => typeof k === 'string') &&
          m.keys.length <= 500
        )
          await this.planner.reorder(m.keys as string[]);
        return;
      case 'move': {
        const column = str(m.column, 80);
        const order =
          Array.isArray(m.order) && m.order.every((k) => typeof k === 'string')
            ? (m.order as string[]).slice(0, 500)
            : undefined;
        if (key && boardId && column) await this.boards.moveCard(boardId, key, column, order);
        return;
      }
      case 'assign':
        if (key) await this.boards.assign(key, boardId || null, str(m.column, 80));
        return;
      case 'moveToBoardFile':
        if (key && boardId) await this.boards.moveToBoardFile(key, boardId);
        return;
      case 'createBoard': {
        if (!root) return;
        const color = boardColors.includes(m.color as BoardColor)
          ? (m.color as BoardColor)
          : undefined;
        const board = await this.boards.create(root, {
          name: str(m.name, 120) || '',
          path: str(m.path, 300),
          template: str(m.template, 40),
          color,
          icon: str(m.icon, 40),
          description: str(m.description, 500),
        });
        await this.setPrefs({
          destination: 'board',
          board: board.id,
          recentBoards: [board.id, ...this.prefs().recentBoards].slice(0, 8),
        });
        this.post(false, { destination: 'board', board: board.id });
        return;
      }
      case 'updateBoard': {
        if (!boardId || !m.change || typeof m.change !== 'object') return;
        const c = m.change as Record<string, unknown>;
        await this.boards.configure(boardId, (config) => {
          if (typeof c.name === 'string') {
            if (!c.name.trim()) throw new Error('A board needs a name.');
            config.name = c.name.trim().slice(0, 120);
          }
          if (typeof c.description === 'string') {
            if (c.description.trim()) config.description = c.description.trim().slice(0, 500);
            else delete config.description;
          }
          if (c.color === null || boardColors.includes(c.color as BoardColor)) {
            if (c.color) config.color = c.color as BoardColor;
            else delete config.color;
          }
          if (c.icon === null || typeof c.icon === 'string') {
            if (c.icon) config.icon = String(c.icon).slice(0, 40);
            else delete config.icon;
          }
          if (c.density === 'compact' || c.density === 'comfortable') config.density = c.density;
          if (['manual', 'due', 'priority'].includes(c.sort as string))
            config.sort = c.sort as BoardConfig['sort'];
          if (typeof c.archived === 'boolean') {
            if (c.archived) config.archived = true;
            else delete config.archived;
          }
        });
        return;
      }
      case 'duplicateBoard': {
        if (!boardId) return;
        const copy = await this.boards.duplicate(
          boardId,
          str(m.name, 120) || 'Copy',
          str(m.path, 300),
        );
        await this.setPrefs({ destination: 'board', board: copy.id });
        this.post(false, { destination: 'board', board: copy.id });
        return;
      }
      case 'deleteBoard': {
        if (!boardId) return;
        const { board, inFile, linked } = this.boards.describe(boardId);
        const choice = await vscode.window.showWarningMessage(
          `Delete the board “${board.name}”?`,
          {
            modal: true,
            detail: `Its file ${board.pagePath}${inFile ? ` and the ${inFile} task${inFile === 1 ? '' : 's'} written in it` : ''} move to Wiki Trash, where you can restore ${inFile ? 'them' : 'it'}.${linked ? ` ${linked} task${linked === 1 ? '' : 's'} from other pages stay in ${linked === 1 ? 'its page' : 'their pages'}.` : ''}`,
          },
          'Delete Board',
        );
        if (choice !== 'Delete Board') return;
        await this.boards.remove(boardId);
        await this.setPrefs({
          destination: 'boards',
          board: STATUS_BOARD,
          pinned: this.prefs().pinned.filter((b) => b !== boardId),
        });
        this.post(false, { destination: 'boards' });
        return;
      }
      case 'addColumn':
        if (boardId && typeof m.title === 'string')
          await this.boards.addColumn(boardId, m.title, m.completed === true);
        return;
      case 'updateColumn': {
        const id = str(m.id, 80);
        if (!boardId || !id || !m.change || typeof m.change !== 'object') return;
        const c = m.change as Record<string, unknown>;
        await this.boards.updateColumn(boardId, id, {
          ...(typeof c.title === 'string' ? { title: c.title } : {}),
          ...(c.color === null || boardColors.includes(c.color as BoardColor)
            ? { color: (c.color as BoardColor) || undefined }
            : {}),
          ...(c.icon === null || typeof c.icon === 'string'
            ? { icon: (c.icon as string) || undefined }
            : {}),
          ...(typeof c.completed === 'boolean' ? { completed: c.completed } : {}),
          ...(c.isDefault === true ? { isDefault: true } : {}),
        });
        return;
      }
      case 'removeColumn': {
        const id = str(m.id, 80);
        if (boardId && id) await this.boards.removeColumn(boardId, id, str(m.moveTo, 80));
        return;
      }
      case 'reorderColumns':
        if (boardId && Array.isArray(m.ids) && m.ids.every((x) => typeof x === 'string')) {
          if (boardId === STATUS_BOARD)
            await this.setPrefs({ statusColumns: m.ids as TaskStatus[] });
          else await this.boards.reorderColumns(boardId, m.ids as string[]);
          this.post();
        }
        return;
      case 'open': {
        if (!key) return;
        const { document, task } = await this.planner.locate(key);
        await this.open(document.uri, document.offsetAt(document.lineAt(task.line).range.start));
        return;
      }
      case 'openBoardFile': {
        if (!boardId || boardId === STATUS_BOARD) return;
        const board = this.boards.board(boardId);
        await this.open(vscode.Uri.parse(this.workspace.index.pages.get(board.pageId)!.uri));
        return;
      }
      case 'openPage': {
        const uri = str(m.uri, 2000);
        if (uri && this.workspace.index.byUri(uri))
          await vscode.commands.executeCommand('notespace.openPage', uri);
        return;
      }
      case 'openDaily':
        if (root && typeof m.date === 'string')
          await this.open(await this.planner.ensureDaily(root, m.date));
        return;
      case 'wikiOpen': {
        // A page of the Wiki destination, by path (navigation) or id (links in a page).
        if (!root) return;
        const id = str(m.id, 2000);
        const path = str(m.path, 1000);
        const page = id
          ? this.workspace.index.pages.get(id)
          : this.wikiPages(root).find((p) => p.path === path);
        if (!page || page.root !== root.id) return;
        if (typeof m.offset === 'number') {
          await this.open(vscode.Uri.parse(page.uri), m.offset);
          return;
        }
        await this.setPrefs({ destination: 'wiki', wikiPage: page.path });
        await this.activity?.opened(page);
        await this.sendWikiPage(str(m.anchor, 200), true);
        return;
      }
      case 'wikiAction': {
        // Page and folder actions of the Wiki tree run the same commands as the editor menus.
        if (!root) return;
        const commands: Record<string, string> = {
          edit: 'openPage',
          openToSide: 'openToSide',
          preview: 'preview',
          newPage: 'newPage',
          newSection: 'newSection',
          toggleFavorite: 'toggleFavorite',
          copyLink: 'copyLink',
          pageProperties: 'pageProperties',
          pageHistory: 'pageHistory',
          renamePage: 'renamePage',
          movePage: 'movePage',
          duplicatePage: 'duplicatePage',
          deletePage: 'deletePage',
          renameSection: 'renameSection',
          deleteSection: 'deleteSection',
          revealInExplorer: 'revealInExplorer',
          exportPdf: 'exportPdf',
        };
        const name = str(m.action, 40) || '';
        const uri = str(m.uri, 2000);
        const prefix = str(m.prefix, 1000);
        // Wiki-wide actions: those that manage the wiki get it as the target, the others
        // (export, validate, import) choose it themselves.
        const forWiki = [
          'renameWiki',
          'editWikiDescription',
          'setWikiIcon',
          'setWikiColor',
          'openWikiSettings',
          'setDefaultWiki',
          'removeWiki',
          'deleteWiki',
        ];
        const global = [
          'export',
          'exportPdf',
          'exportEpub',
          'validate',
          'themeBuilder',
          'importProject',
          'importObsidian',
          'buildWiki',
        ];
        if (name.startsWith('wiki:')) {
          const command = name.slice(5);
          if (forWiki.includes(command))
            await vscode.commands.executeCommand(`notespace.${command}`, {
              label: root.name,
              root: root.id,
              prefix: '',
            });
          else if (global.includes(command))
            await vscode.commands.executeCommand(`notespace.${command}`);
          return;
        }
        if (name === 'openFile') {
          const file = uri && this.files?.(root.id).find((f) => f.uri === uri);
          if (!file) return;
          if (file.file === 'notebook')
            await vscode.commands.executeCommand(
              'notespace.openNotebook',
              vscode.Uri.parse(file.uri),
            );
          else
            await vscode.commands.executeCommand(
              'vscode.openWith',
              vscode.Uri.parse(file.uri),
              'notespace.canvas',
            );
          return;
        }
        const command = commands[name];
        if (!command) return;
        const page = uri ? this.workspace.index.byUri(uri) : undefined;
        if (name === 'revealInExplorer' && uri && !page) {
          if (this.files?.(root.id).some((f) => f.uri === uri))
            await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.parse(uri));
          return;
        }
        if (command === 'openPage') {
          if (page) await vscode.commands.executeCommand('notespace.openPage', page.uri);
          return;
        }
        const node = page
          ? { label: page.title, root: page.root, page }
          : prefix !== undefined
            ? {
                label: posix.basename(prefix.replace(/\/$/, '')) || root.name,
                root: root.id,
                prefix,
              }
            : undefined;
        if (node) await vscode.commands.executeCommand(`notespace.${command}`, node);
        return;
      }
      case 'wikiMove': {
        // Drag and drop in the Wiki tree: a page or a folder into a folder ('' is the top level).
        if (!root) return;
        const to = (str(m.to, 1000) || '').replace(/\/$/, '');
        const uri = str(m.uri, 2000);
        const prefix = str(m.prefix, 1000);
        const page = uri ? this.workspace.index.byUri(uri) : undefined;
        if (page && page.root === root.id) {
          const target = posix.join(to, posix.basename(page.path));
          if (target === page.path) return;
          const moved = await this.workspace.renamePage(page, target);
          if (this.prefs().wikiPage === page.path) {
            const next = this.workspace.index.byUri(moved.toString());
            if (next) await this.setPrefs({ wikiPage: next.path });
          }
        } else if (prefix) {
          const from = prefix.replace(/\/$/, '');
          const target = posix.join(to, posix.basename(from));
          if (target !== from && !`${to}/`.startsWith(`${from}/`))
            await this.workspace.moveSection(root, prefix, target);
        }
        this.post();
        return;
      }
      case 'wikiEdit': {
        const uri = str(m.uri, 2000);
        const page = uri && this.workspace.index.byUri(uri);
        if (!page) return;
        const heading =
          typeof m.anchor === 'string' ? page.headings.find((h) => h.slug === m.anchor) : undefined;
        await this.open(vscode.Uri.parse(page.uri), heading?.offset);
        return;
      }
      case 'wikiReader': {
        const uri = str(m.uri, 2000);
        const page = uri && this.workspace.index.byUri(uri);
        if (page)
          await vscode.commands.executeCommand('notespace.preview', {
            label: page.title,
            root: page.root,
            page,
          });
        return;
      }
      case 'wikiAsset':
      case 'wikiCode': {
        const uri = str(m.uri, 2000);
        const target = str(m.target, 1024);
        const page = uri && this.workspace.index.byUri(uri);
        if (!page || !target) return;
        if (m.type === 'wikiCode')
          await vscode.commands.executeCommand('notespace.openCodeRef', page.uri, target);
        else {
          const file = await resolveAttachment(
            this.workspace,
            this.workspace.rootFor(page),
            page,
            target,
          );
          if (file) await vscode.commands.executeCommand('vscode.open', file);
        }
        return;
      }
      case 'external': {
        const href = str(m.href, 2000);
        if (href && safeExternal(href)) await vscode.env.openExternal(vscode.Uri.parse(href));
        return;
      }
      case 'search':
        await vscode.commands.executeCommand('notespace.advancedSearch', str(m.query, 500) || '');
        return;
      case 'command': {
        // Quick Create and other actions that already exist as commands.
        const allowed = [
          'newPage',
          'newNote',
          'newSection',
          'newFromTemplate',
          'newBlogPost',
          'clipWebPage',
          'dailyNote',
          'contentHealth',
          'graph',
          'validate',
          'apiClient',
        ];
        const name = str(m.name, 40);
        if (name === 'newBlogPost' || name === 'clipWebPage')
          await vscode.commands.executeCommand(`notespace.${name}`, root?.id);
        else if (name && allowed.includes(name))
          await vscode.commands.executeCommand(`notespace.${name}`);
        return;
      }
      case 'boardFileExists': {
        // The create dialog warns before the host refuses an existing file.
        const path = str(m.path, 300) || '';
        const exists =
          !!root &&
          this.workspace.index
            .all(root.id)
            .some((p) => p.path.toLowerCase() === path.toLowerCase().replace(/^\/+/, ''));
        void this.panel?.webview.postMessage({ type: 'boardFileExists', path, exists });
        return;
      }
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.panel?.dispose();
    this.subscriptions.forEach((s) => s.dispose());
  }
}

/** Only known fields with plausible values reach the Markdown writer. */
function sanitize(change: TaskChange): TaskChange {
  const out: TaskChange = {};
  const date = (v: unknown) =>
    v === null || v === ''
      ? null
      : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(v)
        ? v
        : undefined;
  const text = (v: unknown, max = 80) =>
    v === null || v === '' ? null : typeof v === 'string' ? v.slice(0, max) : undefined;
  if (typeof change.title === 'string') out.title = change.title.slice(0, 500);
  if (taskStatuses.includes(change.status as TaskStatus)) out.status = change.status;
  if (typeof change.checked === 'boolean') out.checked = change.checked;
  if (change.priority === null || ['high', 'medium', 'low'].includes(change.priority as string))
    out.priority = change.priority;
  for (const k of ['due', 'start'] as const) {
    const v = date(change[k]);
    if (v !== undefined) out[k] = v;
  }
  const repeat = text(change.repeat, 30);
  if (
    repeat === null ||
    (repeat &&
      /^(daily|weekdays|weekly|monthly|yearly|every-\d{1,3}-(day|week|month|year)s?)$/.test(repeat))
  )
    out.repeat = repeat;
  const project = text(change.project);
  if (project !== undefined) out.project = project;
  const assignee = text(change.assignee, 40);
  if (assignee !== undefined) out.assignee = assignee?.replace(/^@/, '') ?? null;
  return out;
}

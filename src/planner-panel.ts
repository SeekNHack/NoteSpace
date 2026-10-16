import * as vscode from 'vscode';
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
import { posix } from './core/paths';

/** Destinations of the workspace panel; the old Planner views are kept as aliases. */
export type PlannerView =
  | 'home'
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
type Destination = 'home' | 'tasks' | 'boards' | 'board' | 'calendar' | 'insights';
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
}

const lists: TaskList[] = ['today', 'upcoming', 'overdue', 'inbox', 'all', 'completed'];
const destinations: Destination[] = ['home', 'tasks', 'boards', 'board', 'calendar', 'insights'];

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
 * task lines (PlannerService) and board pages (BoardService). Wiki opens the real homepage.
 */
export class PlannerPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private rootId?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions: vscode.Disposable[];
  readonly boards: BoardService;
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly planner: PlannerService,
    private readonly extensionUri: vscode.Uri,
    private readonly memento: vscode.Memento,
    private readonly open: (uri: vscode.Uri, line?: number) => Promise<void>,
    private readonly activity?: WikiActivity,
  ) {
    this.boards = new BoardService(workspace, planner);
    this.subscriptions = [planner.onDidChange(() => this.schedule())];
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
          localResourceRoots: [this.extensionUri],
        },
      );
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(this.extensionUri, 'media', 'wiki-light.svg'),
        dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'wiki-dark.svg'),
      };
      const nonce = randomBytes(18).toString('base64');
      const script = this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'planner.js'),
      );
      this.panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>NoteSpace</title><style>${plannerCss}</style></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
      this.panel.onDidDispose(() => (this.panel = undefined));
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
        description: root.config?.wiki.description || '',
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
      insights: prefs.destination === 'insights' ? this.insights(root, tasks, today) : undefined,
    });
  }

  private async onMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    const root = this.root();
    const key = typeof m.key === 'string' ? m.key : '';
    const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const boardId = str(m.boardId, 80) || '';
    switch (m.type) {
      case 'ready':
        this.post();
        return;
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
      case 'openWiki':
        await vscode.commands.executeCommand('notespace.openWikiHome', root?.id);
        return;
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
          'dailyNote',
          'contentHealth',
          'graph',
          'validate',
          'apiClient',
        ];
        const name = str(m.name, 40);
        if (name && allowed.includes(name))
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

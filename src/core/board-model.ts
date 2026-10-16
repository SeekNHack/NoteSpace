import { idPattern, Task, TaskChange, TaskStatus } from './tasks';

/**
 * Kanban boards. A board is an ordinary Markdown page whose front matter holds a `notespace`
 * block of `type: board` (see docs/workspace-redesign.md). Columns and boards have stable ids;
 * tasks join a board with `board:<id>` or by living in the board's file, and sit in a column
 * with `col:<id>`.
 */
export const boardColors = [
  'gray',
  'blue',
  'cyan',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'purple',
] as const;
export type BoardColor = (typeof boardColors)[number];
export const boardIcons = [
  'layout',
  'task',
  'code',
  'star',
  'calendar',
  'file',
  'folder',
  'edit',
  'check',
  'clock',
  'alert',
  'tip',
] as const;

export interface BoardColumn {
  id: string;
  title: string;
  color?: BoardColor;
  icon?: string;
  /** Cards in this column are completed tasks (checked boxes). */
  completed?: boolean;
}
export interface BoardConfig {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: BoardColor;
  columns: BoardColumn[];
  defaultColumn: string;
  density?: 'compact' | 'comfortable';
  sort?: 'manual' | 'due' | 'priority';
  archived?: boolean;
}
export interface Board extends BoardConfig {
  /** Page that holds the board (its tasks are written there by default). */
  pageId: string;
  pagePath: string;
  root: string;
}

/** The built-in board over every task of a wiki, with the four statuses as columns. */
export const STATUS_BOARD = 'status';
export const statusColumns: BoardColumn[] = [
  { id: 'todo', title: 'To do', color: 'gray' },
  { id: 'doing', title: 'In progress', color: 'blue' },
  { id: 'blocked', title: 'Blocked', color: 'red' },
  { id: 'done', title: 'Done', color: 'green', completed: true },
];

export const boardTemplates: Array<{ id: string; label: string; columns: BoardColumn[] }> = [
  {
    id: 'basic',
    label: 'To do → Doing → Done',
    columns: [
      { id: 'todo', title: 'To do', color: 'gray' },
      { id: 'doing', title: 'Doing', color: 'blue' },
      { id: 'done', title: 'Done', color: 'green', completed: true },
    ],
  },
  {
    id: 'development',
    label: 'Development',
    columns: [
      { id: 'backlog', title: 'Backlog', color: 'gray' },
      { id: 'planned', title: 'Planned', color: 'purple' },
      { id: 'developing', title: 'Developing', color: 'blue' },
      { id: 'testing', title: 'Testing', color: 'amber' },
      { id: 'released', title: 'Released', color: 'green', completed: true },
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    columns: [
      { id: 'ideas', title: 'Ideas', color: 'purple' },
      { id: 'todo', title: 'To do', color: 'gray' },
      { id: 'doing', title: 'Doing', color: 'blue' },
      { id: 'waiting', title: 'Waiting', color: 'amber' },
      { id: 'completed', title: 'Completed', color: 'green', completed: true },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    columns: [
      { id: 'ideas', title: 'Ideas', color: 'purple' },
      { id: 'script', title: 'Script', color: 'gray' },
      { id: 'recording', title: 'Recording', color: 'red' },
      { id: 'editing', title: 'Editing', color: 'amber' },
      { id: 'published', title: 'Published', color: 'green', completed: true },
    ],
  },
];

/** Validates a configuration before it is written. */
export function checkBoard(config: BoardConfig): void {
  if (!idPattern.test(config.id)) throw new Error('A board id uses letters, digits, - and _.');
  if (!config.name.trim()) throw new Error('A board needs a name.');
  if (!config.columns.length) throw new Error('A board needs at least one column.');
  const ids = new Set<string>();
  for (const c of config.columns) {
    if (!idPattern.test(c.id)) throw new Error(`“${c.id}” is not a valid column id.`);
    if (ids.has(c.id)) throw new Error(`The column id “${c.id}” is used twice.`);
    if (!c.title.trim()) throw new Error('Every column needs a title.');
    ids.add(c.id);
  }
  if (!ids.has(config.defaultColumn)) throw new Error('The default column is not on the board.');
}

/** File name for a new board: `boards/<slug>.md`. */
export function boardFileName(name: string, folder = 'boards'): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'board';
  return `${folder.replace(/^\/+|\/+$/g, '')}/${slug}.md`;
}

/** A column id that does not exist yet on the board, derived from its title. */
export function columnId(title: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base =
    title
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'column';
  let id = /^[a-z0-9]/.test(base) ? base : `c-${base}`;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// ---------------------------------------------------------------------------------------------
// Membership and columns
// ---------------------------------------------------------------------------------------------

/**
 * Keys of subtasks: tasks indented under an earlier task of the same page. On boards they are
 * the parent's checklist, not cards of their own (unless they carry `board:` themselves).
 */
export function subtaskKeys(tasks: Task[]): Set<string> {
  const out = new Set<string>();
  const byPage = new Map<string, Task[]>();
  for (const t of tasks) byPage.set(t.pageId, [...(byPage.get(t.pageId) || []), t]);
  for (const list of byPage.values()) {
    list.sort((a, b) => a.line - b.line);
    const stack: Task[] = [];
    for (const t of list) {
      while (stack.length && stack[stack.length - 1].indent.length >= t.indent.length) stack.pop();
      if (stack.length) out.add(t.key);
      stack.push(t);
    }
  }
  return out;
}

export function isMember(task: Task, board: Board): boolean {
  return task.board
    ? task.board === board.id
    : task.pagePath === board.pagePath && task.pageId === board.pageId;
}

const statusGuess: Record<TaskStatus, RegExp> = {
  todo: /^(todo|to-do|backlog)$/,
  doing: /^(doing|in-progress|progress|developing|active|wip)$/,
  blocked: /^(blocked|waiting|on-hold)$/,
  done: /^(done|completed|released|published|finished)$/,
};

/** The column a task is shown in. */
export function columnOf(task: Task, board: BoardConfig): string {
  if (task.column && board.columns.some((c) => c.id === task.column)) {
    const column = board.columns.find((c) => c.id === task.column)!;
    // A checked box always wins over a stale open column (edited outside NoteSpace).
    if (task.checked && !column.completed)
      return (board.columns.find((c) => c.completed) || column).id;
    if (!task.checked && column.completed) return board.defaultColumn;
    return column.id;
  }
  if (task.checked)
    return (board.columns.find((c) => c.completed) || board.columns[board.columns.length - 1]).id;
  if (task.status !== 'todo') {
    const match = board.columns.find((c) => !c.completed && statusGuess[task.status].test(c.id));
    if (match) return match.id;
  }
  return board.defaultColumn;
}

/** The line change that puts a task in `columnId`; completed columns check the box. */
export function moveChange(board: BoardConfig, columnId: string): TaskChange {
  const column = board.columns.find((c) => c.id === columnId);
  if (!column) throw new Error('That column is no longer on the board.');
  return {
    column: column.id,
    checked: !!column.completed,
    ...(column.completed ? {} : { status: 'todo' }),
  };
}

/** Status board: columns are statuses. */
export const statusBoard = (columns: BoardColumn[] = statusColumns): BoardConfig => ({
  id: STATUS_BOARD,
  name: 'Status board',
  description: 'Every task of the wiki by status',
  columns,
  defaultColumn: 'todo',
});

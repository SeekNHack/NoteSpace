/**
 * NoteSpace tasks are ordinary Markdown task-list items in any page. Optional metadata is
 * written as plain `key:value` words after the title, so files stay readable in any editor and
 * round-trip through Studio unchanged:
 *
 *   - [ ] Write the release notes due:2026-10-20 priority:high status:doing #docs @alice ^t-k3x9q2
 *
 * See docs/planner.md for the full schema. Every view (lists, calendar, board, table, page
 * embeds) reads these same lines; nothing is copied into another store.
 */

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';
export type TaskPriority = 'high' | 'medium' | 'low';
export const taskStatuses: TaskStatus[] = ['todo', 'doing', 'blocked', 'done'];
export const statusLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

export interface Task {
  /** `^id` when present, otherwise a position-derived key that is stable while the file is unchanged. */
  key: string;
  id?: string;
  pageId: string;
  pagePath: string;
  pageTitle: string;
  /** Zero-based line in the page text (including frontmatter). */
  line: number;
  raw: string;
  indent: string;
  title: string;
  description: string;
  checked: boolean;
  status: TaskStatus;
  priority?: TaskPriority;
  due?: string;
  start?: string;
  done?: string;
  repeat?: string;
  project?: string;
  assignee?: string;
  order?: number;
  /** Board membership (`board:<id>`); without it a task belongs to the board whose file holds it. */
  board?: string;
  /** Board column (`col:<id>`). */
  column?: string;
  tags: string[];
  links: string[];
  /** Daily-note date when the task lives in a daily note. */
  journal?: string;
}

const itemPattern = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const tokenPattern =
  /(?:^|\s)(?:(due|start|done|priority|status|repeat|project|order|board|col):(\S+)|@([\p{L}\p{N}_.-]+)|\^([A-Za-z0-9-]{1,32}))(?=\s|$)/gu;

export interface TaskSource {
  id: string;
  path: string;
  title: string;
  text: string;
}

/** Extracts tasks from a page. Fenced code is skipped. */
export function parseTasks(page: TaskSource, dailyFolder = 'daily'): Task[] {
  const lines = page.text.split('\n');
  const tasks: Task[] = [];
  const journal = new RegExp(`^${escapeRegExp(dailyFolder)}/(\\d{4}-\\d{2}-\\d{2})\\.md$`).exec(
    page.path,
  )?.[1];
  let fence = '';
  let frontmatter = /^(?:﻿)?---\r?$/.test(lines[0] || '');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (frontmatter) {
      if (i > 0 && /^---\s*$/.test(line)) frontmatter = false;
      continue;
    }
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fence[0] === fenceMatch[1][0] && fenceMatch[1].length >= fence.length) fence = '';
      continue;
    }
    if (fence) continue;
    const match = itemPattern.exec(line);
    if (!match) continue;
    const [, indent, , box, rest] = match;
    // Description: following lines indented deeper than the item that are not items themselves.
    const description: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].replace(/\r$/, '');
      if (!next.trim()) {
        if (
          j + 1 < lines.length &&
          indentOf(lines[j + 1]) > indent.length &&
          !itemPattern.test(lines[j + 1])
        )
          continue;
        break;
      }
      if (indentOf(next) <= indent.length || /^\s*([-*+]|\d+[.)])\s/.test(next)) break;
      description.push(next.trim());
    }
    tasks.push(
      taskFromLine(page, i, line, indent, box !== ' ', rest, description.join('\n'), journal),
    );
  }
  return tasks;
}

function taskFromLine(
  page: TaskSource,
  line: number,
  raw: string,
  indent: string,
  checked: boolean,
  rest: string,
  description: string,
  journal?: string,
): Task {
  const fields: Record<string, string> = {};
  let assignee: string | undefined, id: string | undefined;
  const title = rest
    .replace(
      tokenPattern,
      (_whole, key?: string, value?: string, person?: string, block?: string) => {
        if (key) fields[key] = value!;
        if (person) assignee = person;
        if (block) id = block;
        return '';
      },
    )
    .replace(/\s+/g, ' ')
    .trim();
  const tags = [...rest.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]);
  const links = [...rest.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
  const status = checked
    ? 'done'
    : taskStatuses.includes(fields.status as TaskStatus) && fields.status !== 'done'
      ? (fields.status as TaskStatus)
      : 'todo';
  const priority = ['high', 'medium', 'low'].includes(fields.priority)
    ? (fields.priority as TaskPriority)
    : undefined;
  const date = (value?: string) => (value && datePattern.test(value) ? value : undefined);
  return {
    key: id ? `${page.id}#${id}` : `${page.id}@${line}:${hash(raw)}`,
    id,
    pageId: page.id,
    pagePath: page.path,
    pageTitle: page.title,
    line,
    raw,
    indent,
    title,
    description,
    checked,
    status,
    priority,
    due: date(fields.due),
    start: date(fields.start),
    done: date(fields.done),
    repeat: fields.repeat && parseRepeat(fields.repeat) ? fields.repeat : undefined,
    project: fields.project?.replace(/_/g, ' '),
    assignee,
    order: fields.order && /^\d{1,6}$/.test(fields.order) ? Number(fields.order) : undefined,
    board: fields.board && idPattern.test(fields.board) ? fields.board : undefined,
    column: fields.col && idPattern.test(fields.col) ? fields.col : undefined,
    tags,
    links,
    journal,
  };
}

/** Board and column ids: letters, digits, `-` and `_`. */
export const idPattern = /^[A-Za-z0-9][\w-]{0,63}$/;
const indentOf = (line: string) => /^\s*/.exec(line)![0].length;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export interface TaskChange {
  title?: string;
  checked?: boolean;
  status?: TaskStatus;
  priority?: TaskPriority | null;
  due?: string | null;
  start?: string | null;
  done?: string | null;
  repeat?: string | null;
  project?: string | null;
  assignee?: string | null;
  order?: number | null;
  board?: string | null;
  column?: string | null;
  id?: string;
}

/**
 * Rewrites one task line with `change`, touching only the affected tokens. Unknown words,
 * tags and links stay where the user put them.
 */
export function updateTaskLine(line: string, change: TaskChange): string {
  const match = itemPattern.exec(line.replace(/\r$/, ''));
  if (!match) throw new Error('Not a task line.');
  const [, indent, marker, box] = match;
  let rest = match[4];
  let checked = box !== ' ';
  if (change.title !== undefined) {
    const tokens = [...rest.matchAll(tokenPattern)].map((m) => m[0].trim());
    const title = change.title.replace(/[\r\n]+/g, ' ').trim();
    if (!title) throw new Error('A task needs a title.');
    rest = [title, ...tokens].join(' ');
  }
  const set = (key: string, value: string | number | null | undefined) => {
    if (value === undefined) return;
    const pattern = new RegExp(`(^|\\s)${key}:\\S+(?=\\s|$)`, 'u');
    if (value === null || value === '') rest = rest.replace(pattern, '');
    else if (pattern.test(rest)) rest = rest.replace(pattern, `$1${key}:${value}`);
    else rest = insertToken(rest, `${key}:${value}`);
  };
  if (change.status !== undefined) {
    checked = change.status === 'done';
    set('status', change.status === 'todo' || change.status === 'done' ? null : change.status);
  }
  if (change.checked !== undefined) {
    checked = change.checked;
    if (checked) set('status', null);
  }
  set('priority', change.priority);
  set('due', change.due);
  set('start', change.start);
  set('done', change.done);
  set('repeat', change.repeat);
  set('project', change.project === null ? null : change.project?.trim().replace(/\s+/g, '_'));
  set('order', change.order);
  const ident = (v: string | null | undefined) => {
    if (v === undefined || v === null || v === '') return v;
    if (!idPattern.test(v)) throw new Error(`“${v}” is not a valid board or column id.`);
    return v;
  };
  set('board', ident(change.board));
  set('col', ident(change.column));
  if (change.assignee !== undefined) {
    rest = rest.replace(/(^|\s)@[\p{L}\p{N}_.-]+(?=\s|$)/u, '');
    if (change.assignee) rest = insertToken(rest, `@${change.assignee.replace(/\s+/g, '-')}`);
  }
  if (change.id && !/(^|\s)\^[A-Za-z0-9-]+(?=\s|$)/.test(rest))
    rest = `${rest.replace(/\s+$/, '')} ^${change.id}`;
  rest = rest.replace(/\s{2,}/g, ' ').trim();
  return `${indent}${marker} [${checked ? 'x' : ' '}] ${rest}`;
}

/** New tokens go before a trailing `^id` so the block id stays last. */
function insertToken(rest: string, token: string): string {
  const id = /\s\^[A-Za-z0-9-]+$/.exec(rest);
  return id
    ? `${rest.slice(0, id.index)} ${token}${id[0]}`
    : `${rest.replace(/\s+$/, '')} ${token}`;
}

export function newTaskLine(title: string, fields: TaskChange = {}): string {
  return updateTaskLine(
    `- [ ] ${title.replace(/[\r\n]+/g, ' ').trim() || 'Untitled task'}`,
    fields,
  );
}

export function newTaskId(random: () => number = Math.random): string {
  let id = 't-';
  for (let i = 0; i < 6; i++)
    id += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)];
  return id;
}

// ---------------------------------------------------------------------------------------------
// Dates. Due dates are calendar dates (optionally with a local time). "Today" is computed in the
// configured IANA time zone, or the host's zone, so the day boundary is predictable.
// ---------------------------------------------------------------------------------------------

export function todayIn(timeZone?: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const toUtc = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (time: number) => new Date(time).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * 86400000);
export const daysBetween = (from: string, to: string) =>
  Math.round((toUtc(to) - toUtc(from)) / 86400000);
export const weekday = (date: string) => new Date(toUtc(date)).getUTCDay();
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return fromUtc(target.getTime());
}
/** Monday-based start of the week containing `date`. */
export const startOfWeek = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/** Supported recurrence: daily, weekdays, weekly, monthly, yearly, every-N-days|weeks|months. */
export function parseRepeat(
  rule: string,
): { unit: 'day' | 'week' | 'month' | 'year' | 'weekday'; every: number } | undefined {
  const named: Record<
    string,
    { unit: 'day' | 'week' | 'month' | 'year' | 'weekday'; every: number }
  > = {
    daily: { unit: 'day', every: 1 },
    weekdays: { unit: 'weekday', every: 1 },
    weekly: { unit: 'week', every: 1 },
    monthly: { unit: 'month', every: 1 },
    yearly: { unit: 'year', every: 1 },
  };
  if (named[rule]) return named[rule];
  const match = /^every-(\d{1,3})-(day|week|month|year)s?$/.exec(rule);
  if (!match || Number(match[1]) < 1) return undefined;
  return { unit: match[2] as 'day' | 'week' | 'month' | 'year', every: Number(match[1]) };
}

/** The next due date after completing an occurrence due on `date`. */
export function nextOccurrence(date: string, rule: string): string | undefined {
  const repeat = parseRepeat(rule);
  if (!repeat) return undefined;
  const time = date.length > 10 ? date.slice(10) : '';
  const day = date.slice(0, 10);
  let next: string;
  switch (repeat.unit) {
    case 'day':
      next = addDays(day, repeat.every);
      break;
    case 'week':
      next = addDays(day, 7 * repeat.every);
      break;
    case 'month':
      next = addMonths(day, repeat.every);
      break;
    case 'year':
      next = addMonths(day, 12 * repeat.every);
      break;
    case 'weekday':
      next = addDays(day, 1);
      while (weekday(next) === 0 || weekday(next) === 6) next = addDays(next, 1);
      break;
  }
  return next + time;
}

/**
 * Completing a recurring task keeps the completed occurrence (with `done:`) and returns the
 * next occurrence's line, which the caller inserts directly after it.
 */
export function completeTaskLine(line: string, today: string): { line: string; next?: string } {
  const task = taskFromLine(
    { id: '', path: '', title: '', text: '' },
    0,
    line,
    '',
    false,
    itemPattern.exec(line)![4],
    '',
  );
  const done = updateTaskLine(line, { checked: true, done: today });
  if (!task.repeat) return { line: done };
  const base = task.due || today;
  const due = nextOccurrence(base, task.repeat)!;
  const start = task.start ? addDays(task.start, daysBetween(base, due)) : undefined;
  // The new occurrence gets its own id; the completed one keeps the original.
  let next = updateTaskLine(line.replace(/(^|\s)\^[A-Za-z0-9-]+(?=\s|$)/, ''), {
    checked: false,
    status: 'todo',
    due,
    start: start ?? undefined,
    done: null,
  });
  if (task.id) next = updateTaskLine(next, { id: newTaskId() });
  return { line: done, next };
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

export type PlannerList = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'all';

export function inList(task: Task, list: PlannerList, today: string, upcomingDays = 14): boolean {
  const due = task.due?.slice(0, 10);
  const start = task.start?.slice(0, 10);
  const open = task.status !== 'done';
  switch (list) {
    case 'inbox':
      return open && !due && !start && !task.project;
    case 'today':
      return (
        open &&
        ((!!due && due <= today) ||
          (!!start && start <= today && (!due || due >= today)) ||
          task.journal === today)
      );
    case 'upcoming':
      return open && !!due && due > today && daysBetween(today, due) <= upcomingDays;
    case 'overdue':
      return open && !!due && due < today;
    case 'completed':
      return !open;
    case 'all':
      return true;
  }
}

const priorityRank = { high: 0, medium: 1, low: 2 } as const;
export function compareTasks(a: Task, b: Task): number {
  return (
    (a.due || '9999').localeCompare(b.due || '9999') ||
    (a.priority ? priorityRank[a.priority] : 3) - (b.priority ? priorityRank[b.priority] : 3) ||
    (a.order ?? 1e9) - (b.order ?? 1e9) ||
    a.pagePath.localeCompare(b.pagePath) ||
    a.line - b.line
  );
}

export interface TaskFilter {
  text?: string;
  tag?: string;
  project?: string;
  assignee?: string;
  priority?: TaskPriority;
  status?: TaskStatus | 'open';
  page?: string;
}
export function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter.text) {
    const haystack =
      `${task.title} ${task.description} ${task.tags.join(' ')} ${task.project || ''} ${task.pageTitle}`.toLowerCase();
    if (
      !filter.text
        .toLowerCase()
        .split(/\s+/)
        .every((word) => haystack.includes(word))
    )
      return false;
  }
  if (filter.tag && !task.tags.includes(filter.tag.replace(/^#/, ''))) return false;
  if (filter.project && (task.project || '').toLowerCase() !== filter.project.toLowerCase())
    return false;
  if (
    filter.assignee &&
    (task.assignee || '').toLowerCase() !== filter.assignee.replace(/^@/, '').toLowerCase()
  )
    return false;
  if (filter.priority && task.priority !== filter.priority) return false;
  if (filter.status === 'open' && task.status === 'done') return false;
  if (filter.status && filter.status !== 'open' && task.status !== filter.status) return false;
  if (filter.page && task.pagePath !== filter.page) return false;
  return true;
}

/** Consecutive days with a daily note, ending today (or yesterday when today's note is missing). */
export function journalStreak(dates: Iterable<string>, today: string): number {
  const set = new Set(dates);
  let day = set.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Resolves a relative date word (today, tomorrow, +3d, +2w, fri) to a calendar date. */
export function resolveDate(value: string, today: string): string | undefined {
  const word = value.toLowerCase();
  if (datePattern.test(value)) return value;
  if (word === 'today') return today;
  if (word === 'tomorrow') return addDays(today, 1);
  if (word === 'yesterday') return addDays(today, -1);
  const offset = /^\+(\d{1,3})([dwm])$/.exec(word);
  if (offset) {
    const n = Number(offset[1]);
    return offset[2] === 'd'
      ? addDays(today, n)
      : offset[2] === 'w'
        ? addDays(today, 7 * n)
        : addMonths(today, n);
  }
  const day = weekdays.indexOf(word.slice(0, 3));
  if (day >= 0 && weekdays.some((name) => word === name || word.startsWith(name))) {
    const ahead = (day - weekday(today) + 7) % 7 || 7;
    return addDays(today, ahead);
  }
  return undefined;
}

/** Quick-add text: relative `due:`/`start:` words become dates; everything else is kept. */
export function quickAddLine(text: string, today: string): string {
  const resolved = text.replace(
    /(^|\s)(due|start):(\S+)/g,
    (whole, space: string, key: string, value: string) => {
      const date = resolveDate(value, today);
      return date ? `${space}${key}:${date}` : whole;
    },
  );
  const line = /^\s*[-*+] \[[ xX]\] /.test(resolved) ? resolved.trim() : `- [ ] ${resolved.trim()}`;
  return updateTaskLine(line, {});
}

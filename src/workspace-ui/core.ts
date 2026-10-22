import { daysBetween, TaskStatus } from '../core/tasks';
import type { BoardColumn, BoardConfig } from '../core/board-model';
import { icon, IconName } from '../core/icons';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): UiState | undefined;
  setState(state: UiState): void;
};

export interface TaskDto {
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  checked: boolean;
  priority?: 'high' | 'medium' | 'low';
  due?: string;
  start?: string;
  done?: string;
  repeat?: string;
  project?: string;
  assignee?: string;
  order?: number;
  tags: string[];
  links: string[];
  pagePath: string;
  pageTitle: string;
  journal?: string;
  board?: string;
  boards: Record<string, string>;
  subtasks?: { total: number; done: number };
}
export interface BoardDto extends BoardConfig {
  pageId: string;
  pagePath: string;
  root: string;
  count: number;
  open: number;
  inProgress: number;
}
export type Destination =
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
/** The five sections of the navigation; Tasks and Insights have pages of their own. */
export type Section = 'home' | 'wiki' | 'tasks' | 'api' | 'insights';
export const sectionOf = (d: Destination): Section =>
  d === 'boards' || d === 'board' || d === 'calendar'
    ? 'tasks'
    : d === 'health' || d === 'graph'
      ? 'insights'
      : d;
export type TaskList = 'today' | 'upcoming' | 'overdue' | 'inbox' | 'all' | 'completed';
export interface SavedView {
  name: string;
  list: TaskList;
  layout: 'list' | 'table';
  filter: Record<string, string>;
  group?: string;
}
export interface Prefs {
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
  wikiPage?: string;
}
export interface NavNode {
  kind: 'page' | 'section' | 'file';
  title: string;
  path: string;
  id?: string;
  uri?: string;
  file?: 'notebook' | 'canvas';
  draft?: boolean;
  /** Front matter `status` (new, updated, beta, deprecated, draft) and `icon`. */
  status?: string;
  icon?: string;
  tags?: string[];
  children?: NavNode[];
}
export interface WikiPageDto {
  id: string;
  uri: string;
  path: string;
  title: string;
  tags: string[];
  draft?: boolean;
  status?: string;
  icon?: string;
  /** The cover image (`cover:` in the front matter) as a webview URI. */
  cover?: string;
  description?: string;
  /** Pages that write this page's title without linking to it. */
  mentions: Array<{
    id: string;
    title: string;
    path: string;
    excerpt: string;
    offset: number;
    length: number;
  }>;
  modified?: number;
  headings: Array<{ level: number; text: string; slug: string }>;
  backlinks: Array<{ id: string; title: string; path: string }>;
  html: string;
  font?: string;
  width?: string;
}
/** A place in the panel, for Back and Forward. */
export interface Location {
  destination: Destination;
  board?: string;
  wikiPage?: string;
}
export interface PageDto {
  title: string;
  path: string;
  uri: string;
  section: string;
  modified?: number;
}
export interface Insights {
  pages: number;
  words: number;
  sections: number;
  dailyNotes: number;
  score: number;
  broken: Array<{ title: string; path: string; uri: string; target: string }>;
  brokenCount: number;
  orphans: Array<{ title: string; path: string; uri: string }>;
  orphanCount: number;
  issues: number;
  tasks: { total: number; open: number; done: number; overdue: number; doneThisWeek: number };
}
export interface State {
  empty?: boolean;
  force?: boolean;
  today: string;
  roots: Array<{ id: string; name: string }>;
  root: string;
  workspace: {
    name: string;
    description: string;
    /** wiki.yaml's icon (a codicon name) and color, shown in the header. */
    icon?: string;
    color?: string;
    homepage?: string;
    boardsFolder: string;
    notesFolder: string;
  };
  tasks: TaskDto[];
  boards: BoardDto[];
  statusBoard: BoardConfig & { count: number };
  notes: string[];
  streak: number;
  prefs: Prefs;
  upcomingDays: number;
  timeZone: string;
  inbox: string;
  home: { recent: PageDto[]; favorites: PageDto[]; dailyNote: boolean };
  insights?: Insights;
  wiki: { tree: NavNode[] };
}
export interface UiState {
  filter?: {
    text?: string;
    tag?: string;
    project?: string;
    assignee?: string;
    priority?: string;
    board?: string;
  };
  cursor?: string;
  selected?: string;
  sort?: { column: string; descending: boolean };
  homeDate?: string;
  /** The page last shown in each section, reopened when the section is chosen. */
  sections?: Partial<Record<Section, Destination>>;
  wikiExpanded?: string[];
  wikiFilter?: string;
  wikiNavHidden?: boolean;
  /** The Wiki shows the tag index (all tags, or the pages of one tag) instead of a page. */
  wikiTags?: string;
  history?: { entries: Location[]; at: number };
  /** Saved state of the pages shown in frames (the API Client keeps its tabs in the host). */
  frames?: Record<string, unknown>;
}

const vscode = acquireVsCodeApi();
export const ui: UiState = vscode.getState() || {};
export const store: { state?: State; prefs?: Prefs; lastState: string; render: () => void } = {
  lastState: '',
  render: () => undefined,
};
export const S = () => store.state!;
export const P = () => store.prefs!;
export const save = () => vscode.setState(ui);
export const post = (message: unknown) => vscode.postMessage(message);
/**
 * While an inline editor is open, refreshes from the host wait: re-rendering would replace the
 * input and lose what is being typed.
 */
let editing = 0;
let pending = false;
export const render = () => {
  if (editing) pending = true;
  else store.render();
};
export function beginEdit(): () => void {
  editing++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    editing--;
    if (!editing && pending) {
      pending = false;
      store.render();
    }
  };
}

export const setPrefs = (next: Partial<Prefs>) => {
  store.prefs = { ...store.prefs!, ...next };
  post({ type: 'prefs', prefs: next });
  render();
};

/**
 * Applies a change to the local copy at once and asks the host to persist it. If the host
 * fails, it reports the error and sends the real state again, which replaces the local copy.
 */
export function optimistic(mutate: (state: State) => void, message: unknown) {
  if (store.state) {
    mutate(store.state);
    store.lastState = '';
    render();
  }
  post(message);
}

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string | undefined | false | null>
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'text') element.textContent = String(value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children)
    if (child !== undefined && child !== false && child !== null) element.append(child);
  return element;
};
export const svg = (name: IconName, size = 14) => {
  const span = document.createElement('span');
  span.innerHTML = icon(name, size);
  return span.firstElementChild as SVGElement;
};
export const button = (
  label: string,
  run: (event: MouseEvent) => void,
  cls = 'btn',
  iconName?: IconName,
  extra: Record<string, string | undefined> = {},
) => {
  const b = h(
    'button',
    { type: 'button', class: cls, ...extra },
    iconName ? svg(iconName) : undefined,
    label || undefined,
  );
  if (!label && !extra['aria-label']) b.setAttribute('aria-label', extra.title || iconName || '');
  b.addEventListener('click', run);
  return b;
};
export const iconButton = (
  name: IconName,
  label: string,
  run: (event: MouseEvent) => void,
  cls = 'btn ghost icon-only',
) => button('', run, cls, name, { 'aria-label': label, title: label });

export function emptyState(text: string, ...actions: HTMLElement[]) {
  return h(
    'div',
    { class: 'empty' },
    h('p', { text }),
    actions.length ? h('div', { class: 'empty-actions' }, ...actions) : undefined,
  );
}

let toastTimer: number | undefined;
export function toast(text: string, error = false) {
  document.querySelector('.toast')?.remove();
  const el = h('div', {
    class: `toast${error ? ' error' : ''}`,
    role: error ? 'alert' : 'status',
    text,
  });
  document.body.append(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 4000);
}

export const formatDate = (date: string, style: 'short' | 'long' = 'short') =>
  new Intl.DateTimeFormat(undefined, {
    weekday: style === 'long' ? 'long' : 'short',
    month: 'short',
    day: 'numeric',
    year: date.slice(0, 4) === store.state?.today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`)) +
  (date.length > 10 ? ` ${date.slice(11)}` : '');
export const relative = (date: string) => {
  const diff = daysBetween(S().today, date.slice(0, 10));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatDate(date);
};
export const ago = (time?: number) => {
  if (!time) return '';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

const rank = { high: 0, medium: 1, low: 2 } as const;
export const byDue = (a: TaskDto, b: TaskDto) =>
  (a.due || '9999').localeCompare(b.due || '9999') ||
  (a.priority ? rank[a.priority] : 3) - (b.priority ? rank[b.priority] : 3) ||
  (a.order ?? 1e9) - (b.order ?? 1e9);
export const byPriority = (a: TaskDto, b: TaskDto) =>
  (a.priority ? rank[a.priority] : 3) - (b.priority ? rank[b.priority] : 3) || byDue(a, b);

/** A task's title as shown next to its chips: `#tags` are chips of their own. */
export const shownTitle = (t: { title: string }) =>
  t.title
    .replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || t.title;
/** Board configuration by id, including the built-in status board. */
export const boardById = (
  id: string,
): (BoardConfig & { pagePath?: string; count?: number }) | undefined =>
  id === 'status' ? S().statusBoard : S().boards.find((b) => b.id === id);
export const columnColor = (c: BoardColumn) => `var(--bc-${c.color || 'gray'})`;

// ---------------------------------------------------------------------------------------------
// Menus and dialogs (task actions never rely on the browser's text context menu)
// ---------------------------------------------------------------------------------------------
export interface MenuItem {
  label: string;
  run?: () => void;
  icon?: IconName;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  items?: MenuItem[];
  separator?: boolean;
}
let openMenuEl: HTMLElement | undefined;
let menuReturn: HTMLElement | null = null;
export function closeMenu(restore = true) {
  openMenuEl?.remove();
  openMenuEl = undefined;
  if (restore) menuReturn?.focus();
}
export function showMenu(
  items: MenuItem[],
  at: { x: number; y: number },
  label = 'Actions',
  returnTo?: HTMLElement | null,
) {
  closeMenu(false);
  menuReturn = returnTo ?? (document.activeElement as HTMLElement | null);
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label, tabindex: '-1' });
  const entries: HTMLElement[] = [];
  for (const item of items) {
    if (item.separator) {
      menu.append(h('div', { class: 'sep', role: 'separator' }));
      continue;
    }
    const el = h(
      'button',
      {
        type: 'button',
        role: item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem',
        class: `item${item.danger ? ' danger' : ''}`,
        'aria-checked': item.checked !== undefined ? String(item.checked) : undefined,
        'aria-haspopup': item.items ? 'menu' : undefined,
        disabled: item.disabled,
        tabindex: '-1',
      },
      item.icon ? svg(item.icon) : h('span', { class: 'gap' }),
      h('span', { text: item.label }),
      item.items ? h('span', { class: 'sub', text: '›' }) : undefined,
    );
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      if (item.items) {
        const r = el.getBoundingClientRect();
        showMenu(item.items, { x: r.right, y: r.top }, item.label, menuReturn);
        return;
      }
      closeMenu();
      item.run?.();
    });
    entries.push(el);
    menu.append(el);
  }
  menu.addEventListener('keydown', (event) => {
    const i = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const enabled = entries.filter((e) => !(e as HTMLButtonElement).disabled);
      const at = enabled.indexOf(document.activeElement as HTMLElement);
      enabled[
        (at + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
      ]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowRight' && i >= 0 && items[i]?.items) entries[i].click();
    else if (event.key === 'Tab') {
      event.preventDefault();
      closeMenu();
    }
  });
  document.body.append(menu);
  openMenuEl = menu;
  const w = menu.offsetWidth,
    hgt = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(at.x, window.innerWidth - w - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - hgt - 4))}px`;
  (entries.find((e) => !(e as HTMLButtonElement).disabled) || menu).focus();
}
document.addEventListener('mousedown', (event) => {
  if (openMenuEl && !openMenuEl.contains(event.target as Node)) closeMenu(false);
});
window.addEventListener('blur', () => closeMenu(false));

/** Menu at an element (keyboard) or at the pointer. */
export const menuAt = (event: MouseEvent | KeyboardEvent, items: MenuItem[], label?: string) => {
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  if (event instanceof MouseEvent && event.clientX)
    showMenu(items, { x: event.clientX, y: event.clientY }, label, target);
  else {
    const r = target.getBoundingClientRect();
    showMenu(items, { x: r.left, y: r.bottom + 2 }, label, target);
  }
};

/** A modal form inside the webview (focus trapped, Escape cancels). */
export function dialog(
  title: string,
  body: HTMLElement[],
  submitLabel: string,
  onSubmit: (form: HTMLFormElement) => boolean | void,
) {
  const back = h('div', { class: 'modal-back' });
  const form = h('form', {
    class: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  });
  const cancel = button('Cancel', () => close(), 'btn ghost');
  form.append(
    h('h2', { text: title }),
    ...body,
    h(
      'div',
      { class: 'modal-actions' },
      cancel,
      h('button', { type: 'submit', class: 'btn primary', text: submitLabel }),
    ),
  );
  const returnTo = document.activeElement as HTMLElement | null;
  const close = () => {
    back.remove();
    returnTo?.focus();
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (onSubmit(form) !== false) close();
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const focusable = Array.from(
        form.querySelectorAll<HTMLElement>('input,select,textarea,button'),
      ).filter((e) => !e.hasAttribute('disabled'));
      const i = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && i === 0) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && i === focusable.length - 1) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
  });
  back.append(form);
  document.body.append(back);
  form.querySelector<HTMLElement>('input,select,textarea')?.focus();
  return { form, close };
}
export const field = (label: string, input: HTMLElement, hint?: string) => {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h(
    'div',
    { class: 'form-row' },
    h('label', { for: id, text: label }),
    input,
    hint ? h('small', { text: hint }) : undefined,
  );
};

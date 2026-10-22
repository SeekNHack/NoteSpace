import {
  ago,
  button,
  emptyState,
  formatDate,
  h,
  menuAt,
  MenuItem,
  P,
  post,
  S,
  setPrefs,
  svg,
  shownTitle,
  iconButton,
} from './core';
import type { NavNode, PageDto } from './core';
import { listOf, quickAdd, row } from './tasks';
import { createBoardDialog, openBoard } from './boards';
import { openDay, tasksOn } from './calendar';
import { openWikiPage, randomPage, revealInWiki, showTags } from './wiki';
import { openFinder } from './finder';

/** Quick Create: every way to start something, one menu. */
export function quickCreateItems(): MenuItem[] {
  return [
    { label: 'Wiki page', icon: 'file', run: () => post({ type: 'command', name: 'newPage' }) },
    { label: 'Note', icon: 'edit', run: () => post({ type: 'command', name: 'newNote' }) },
    { label: 'Folder', icon: 'folder', run: () => post({ type: 'command', name: 'newSection' }) },
    {
      label: 'Blog post',
      icon: 'edit',
      run: () => post({ type: 'command', name: 'newBlogPost' }),
    },
    { label: 'Task', icon: 'task', run: () => focusQuickAdd() },
    { label: 'Kanban board', icon: 'layout', run: () => createBoardDialog() },
    {
      label: "Today's daily note",
      icon: 'calendar',
      run: () => post({ type: 'openDaily', date: S().today }),
    },
    {
      label: 'Page from template',
      icon: 'template',
      run: () => post({ type: 'command', name: 'newFromTemplate' }),
    },
  ];
}
export function focusQuickAdd() {
  const input = document.getElementById('home-add') || document.getElementById('quick-add');
  if (input) return input.focus();
  setPrefs({ destination: 'tasks', taskList: 'today' });
  requestAnimationFrame(() => document.getElementById('quick-add')?.focus());
}

function section(
  title: string,
  action: HTMLElement | undefined,
  ...body: Array<HTMLElement | undefined>
) {
  const id = `h-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return h(
    'section',
    { class: 'home-card', 'aria-labelledby': id },
    h(
      'div',
      { class: 'home-card-head' },
      h('h2', { id, text: title }),
      h('span', { class: 'spacer' }),
      action,
    ),
    ...body,
  );
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const countPages = (nodes: NavNode[]): number =>
  nodes.reduce((n, x) => n + (x.kind !== 'file' && x.id ? 1 : 0) + countPages(x.children || []), 0);

/** A page card: opens the page in the Wiki; the pencil edits it. */
function pageCard(p: PageDto, favorite = false): HTMLElement {
  const open = h(
    'button',
    { type: 'button', class: 'page-card-open', title: p.path },
    h('span', { class: 'page-card-icon' }, svg(favorite ? 'star' : 'file', 14)),
    h(
      'span',
      { class: 'page-card-text' },
      h('span', { class: 'title', text: p.title }),
      h('span', {
        class: 'muted small',
        text: [p.section, p.modified ? ago(p.modified) : ''].filter(Boolean).join(' · '),
      }),
    ),
  );
  open.addEventListener('click', () => {
    setPrefs({ destination: 'wiki' });
    openWikiPage({ path: p.path });
  });
  return h(
    'li',
    { class: 'page-card' },
    open,
    iconButton('edit', `Edit ${p.title}`, () => post({ type: 'openPage', uri: p.uri })),
  );
}

export function homeView(): HTMLElement {
  const s = S();
  const today = s.today;
  const wrap = h('div', { class: 'home' });
  // Today: overdue and due today, with progress.
  const todayTasks = listOf('today', s.tasks);
  const doneToday = s.tasks.filter((t) => t.checked && t.done === today).length;
  const total = todayTasks.length + doneToday;
  const overdue = todayTasks.filter((t) => t.due && t.due.slice(0, 10) < today);
  const due = todayTasks.filter((t) => !overdue.includes(t));
  const progress = h(
    'div',
    {
      class: 'progress',
      role: 'progressbar',
      'aria-label': 'Done today',
      'aria-valuemin': '0',
      'aria-valuemax': String(total || 1),
      'aria-valuenow': String(doneToday),
    },
    h('span', { style: `width:${total ? Math.round((doneToday / total) * 100) : 0}%` }),
  );
  const todayCard = section(
    'Today',
    button(
      'All tasks',
      () => setPrefs({ destination: 'tasks', taskList: 'today' }),
      'btn ghost small',
    ),
    h(
      'div',
      { class: 'progress-line' },
      progress,
      h('span', {
        class: 'muted small',
        text: total ? `${doneToday} of ${total} done` : 'Nothing planned yet',
      }),
    ),
    quickAdd(
      'Add a task for today',
      (text) => post({ type: 'add', text, fields: /(^|\s)due:/.test(text) ? {} : { due: today } }),
      'home-add',
    ),
    overdue.length ? h('h3', { class: 'alert', text: `Overdue · ${overdue.length}` }) : undefined,
    overdue.length ? h('ul', { class: 'rows' }, ...overdue.slice(0, 5).map(row)) : undefined,
    overdue.length && due.length ? h('h3', { text: `Due today · ${due.length}` }) : undefined,
    due.length ? h('ul', { class: 'rows' }, ...due.slice(0, 8).map(row)) : undefined,
    !todayTasks.length
      ? h('p', {
          class: 'muted small home-hint',
          text: 'Nothing due today. Type a task above, or plan the day in your daily note.',
        })
      : undefined,
  );
  // The coming week, day by day (today is in the card above).
  const open = s.tasks.filter((t) => !t.checked);
  const week = h('ol', { class: 'agenda' });
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today, i);
    const items = tasksOn(open, day);
    const note = s.notes.includes(day);
    const head = button(i === 1 ? 'Tomorrow' : formatDate(day, 'long'), () => openDay(day), 'link');
    week.append(
      h(
        'li',
        { class: `agenda-day${items.length ? '' : ' empty-day'}` },
        h(
          'div',
          { class: 'agenda-date' },
          h('span', { class: 'agenda-num', text: String(Number(day.slice(8, 10))) }),
        ),
        h(
          'div',
          { class: 'agenda-body' },
          h('div', { class: 'agenda-head' }, head, note ? svg('calendar', 12) : undefined),
          items.length
            ? h(
                'ul',
                { class: 'compact-list' },
                ...items.slice(0, 3).map((t) => h('li', { text: shownTitle(t) })),
                items.length > 3
                  ? h('li', { class: 'muted', text: `+${items.length - 3} more` })
                  : undefined,
              )
            : h('span', { class: 'muted small', text: 'Free' }),
        ),
      ),
    );
  }
  const weekCard = section(
    'This week',
    button('Calendar', () => setPrefs({ destination: 'calendar' }), 'btn ghost small'),
    week,
  );
  // Continue working: recently edited pages as cards, opened in the Wiki.
  const recent = section(
    'Continue working',
    button('Wiki', () => setPrefs({ destination: 'wiki' }), 'btn ghost small'),
    s.home.recent.length
      ? h('ul', { class: 'page-cards' }, ...s.home.recent.slice(0, 6).map((p) => pageCard(p)))
      : h('p', { class: 'muted small home-hint', text: 'Pages you edit appear here.' }),
  );
  const favorites = s.home.favorites.length
    ? section(
        'Favorites',
        undefined,
        h('ul', { class: 'page-cards' }, ...s.home.favorites.map((p) => pageCard(p, true))),
      )
    : undefined;
  // The wiki's top-level sections, as on a documentation site's landing page.
  const sections = s.wiki.tree.filter((n) => n.kind === 'section');
  const explore = sections.length
    ? section(
        'Explore the wiki',
        undefined,
        h(
          'ul',
          { class: 'section-cards' },
          ...sections.map((n) => {
            const pages = countPages(n.children || []) + (n.id ? 1 : 0);
            const b = h(
              'button',
              { type: 'button', class: 'section-card' },
              svg('folder', 16),
              h('span', { class: 'title', text: n.title }),
              h('span', { class: 'muted small', text: `${pages} page${pages === 1 ? '' : 's'}` }),
            );
            b.addEventListener('click', () => {
              setPrefs({ destination: 'wiki' });
              if (n.id) openWikiPage({ id: n.id });
              else revealInWiki(n.path);
            });
            return h('li', {}, b);
          }),
        ),
      )
    : undefined;
  // My boards: pinned first, then recently used; one line each with its progress.
  const ids = [...new Set([...P().pinned, ...P().recentBoards])];
  let boards = ids
    .map((id) => s.boards.find((b) => b.id === id && !b.archived))
    .filter((b): b is NonNullable<typeof b> => !!b);
  if (!boards.length) boards = s.boards.filter((b) => !b.archived).slice(0, 4);
  const myBoards = section(
    'My boards',
    button('All boards', () => setPrefs({ destination: 'boards' }), 'btn ghost small'),
    boards.length
      ? h(
          'ul',
          { class: 'board-lines' },
          ...boards.slice(0, 6).map((b) => {
            const done = b.count - b.open;
            const line = h(
              'button',
              {
                type: 'button',
                class: 'board-line',
                style: `--c:var(--bc-${b.color || 'gray'})`,
                'data-board': b.id,
              },
              h('span', { class: 'board-dot' }),
              h('span', { class: 'title', text: b.name }),
              h('span', { class: 'muted small', text: `${b.open} open` }),
              h(
                'span',
                { class: 'progress mini', 'aria-hidden': 'true' },
                h('span', { style: `width:${b.count ? Math.round((done / b.count) * 100) : 0}%` }),
              ),
            );
            line.addEventListener('click', () => openBoard(b.id));
            return h('li', {}, line);
          }),
        )
      : emptyState(
          'Boards organize tasks in your own columns.',
          button('New board', () => createBoardDialog(), 'btn', 'plus'),
        ),
  );
  // Pages that need attention: broken links and pages nothing links to.
  const ins = s.insights;
  const fix = (items: Array<{ title: string; path: string; uri: string; target?: string }>) =>
    items.slice(0, 4).map((i) => {
      const b = h(
        'button',
        { type: 'button', class: 'page-line' },
        svg(i.target ? 'unlinkPage' : 'file', 13),
        h('span', { class: 'title', text: i.title }),
        h('span', { class: 'muted', text: i.target ? `→ ${i.target}` : i.path }),
      );
      b.addEventListener('click', () => {
        setPrefs({ destination: 'wiki' });
        openWikiPage({ path: i.path });
      });
      return h('li', {}, b);
    });
  const attention =
    ins && (ins.brokenCount || ins.orphanCount)
      ? section(
          'Needs attention',
          button('Content health', () => setPrefs({ destination: 'health' }), 'btn ghost small'),
          ins.brokenCount
            ? h('h3', { class: 'alert', text: `Broken links · ${ins.brokenCount}` })
            : undefined,
          ins.brokenCount ? h('ul', { class: 'page-list' }, ...fix(ins.broken)) : undefined,
          ins.orphanCount
            ? h('h3', { text: `Not linked from any page · ${ins.orphanCount}` })
            : undefined,
          ins.orphanCount ? h('ul', { class: 'page-list' }, ...fix(ins.orphans)) : undefined,
        )
      : undefined;
  const discover = section(
    'Discover',
    undefined,
    h(
      'div',
      { class: 'discover' },
      button('Random page', () => randomPage(), 'btn', 'refresh'),
      button('Tags', () => showTags(''), 'btn', 'badge'),
      button('Link graph', () => setPrefs({ destination: 'graph' }), 'btn', 'link'),
    ),
  );
  wrap.append(
    h(
      'div',
      { class: 'home-grid' },
      h('div', { class: 'home-col main-col' }, todayCard, recent, explore),
      h('div', { class: 'home-col side-col' }, weekCard, favorites, myBoards, attention, discover),
    ),
  );
  return wrap;
}

/** The landing header: a greeting, the wiki, a search box and the numbers that matter today. */
export function homeHeader(): HTMLElement {
  const s = S();
  const create = button(
    'Create',
    (e) => menuAt(e, quickCreateItems(), 'Quick create'),
    'btn primary',
    'plus',
    { 'aria-haspopup': 'menu' },
  );
  const daily = button(
    s.home.dailyNote ? "Today's note" : "Start today's note",
    () => post({ type: 'openDaily', date: s.today }),
    'btn',
    'calendar',
  );
  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? 'Good night'
      : hour < 12
        ? 'Good morning'
        : hour < 18
          ? 'Good afternoon'
          : 'Good evening';
  const search = h(
    'button',
    { type: 'button', class: 'home-search', 'aria-keyshortcuts': '/' },
    svg('search', 16),
    h('span', { class: 'label', text: `Search ${s.workspace.name}…` }),
    h('kbd', { text: '/' }),
  );
  search.addEventListener('click', () => openFinder());
  const todayTasks = listOf('today', s.tasks);
  const overdue = todayTasks.filter((t) => t.due && t.due.slice(0, 10) < s.today).length;
  const stat = (n: number, label: string, run: () => void, tone = '') => {
    const b = h(
      'button',
      { type: 'button', class: `stat${tone && n ? ` ${tone}` : ''}` },
      h('strong', { text: String(n) }),
      h('span', { text: label }),
    );
    b.addEventListener('click', run);
    return b;
  };
  return h(
    'div',
    { class: 'home-head' },
    h(
      'div',
      { class: 'home-hero' },
      h(
        'div',
        { class: 'home-title' },
        h('p', { class: 'home-greeting', text: `${greeting} · ${formatDate(s.today, 'long')}` }),
        h('h1', { text: s.workspace.name }),
        s.workspace.description
          ? h('p', { class: 'muted', text: s.workspace.description })
          : undefined,
      ),
      h('div', { class: 'home-actions' }, daily, create),
    ),
    search,
    h(
      'div',
      { class: 'stats' },
      stat(todayTasks.length - overdue, 'due today', () =>
        setPrefs({ destination: 'tasks', taskList: 'today' }),
      ),
      stat(
        overdue,
        'overdue',
        () => setPrefs({ destination: 'tasks', taskList: 'overdue' }),
        'bad',
      ),
      stat(s.tasks.filter((t) => !t.checked).length, 'open tasks', () =>
        setPrefs({ destination: 'tasks', taskList: 'all' }),
      ),
      stat(countPages(s.wiki.tree), 'pages', () => setPrefs({ destination: 'wiki' })),
      stat(s.boards.filter((b) => !b.archived).length, 'boards', () =>
        setPrefs({ destination: 'boards' }),
      ),
    ),
  );
}

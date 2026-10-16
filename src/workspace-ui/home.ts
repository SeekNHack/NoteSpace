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
  render,
  S,
  save,
  setPrefs,
  svg,
  ui,
} from './core';
import { listOf, quickAdd, row } from './tasks';
import { boardCard, createBoardDialog } from './boards';
import { miniCalendar, openDay, tasksOn } from './calendar';

/** Quick Create: every way to start something, one menu. */
export function quickCreateItems(): MenuItem[] {
  return [
    { label: 'Wiki page', icon: 'file', run: () => post({ type: 'command', name: 'newPage' }) },
    { label: 'Note', icon: 'edit', run: () => post({ type: 'command', name: 'newNote' }) },
    { label: 'Folder', icon: 'folder', run: () => post({ type: 'command', name: 'newSection' }) },
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
    due.length ? h('ul', { class: 'rows' }, ...due.slice(0, 8).map(row)) : undefined,
    !todayTasks.length
      ? h('p', {
          class: 'muted small',
          text: 'Nothing due today. Type a task above, or plan the day in your daily note.',
        })
      : undefined,
  );
  // Calendar preview.
  const selected = ui.homeDate || today;
  const onDay = tasksOn(
    s.tasks.filter((t) => !t.checked),
    selected,
  );
  const upcoming = s.tasks
    .filter((t) => !t.checked && t.due && t.due.slice(0, 10) > today)
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .slice(0, 4);
  const calendarCard = section(
    'Calendar',
    button('Open calendar', () => setPrefs({ destination: 'calendar' }), 'btn ghost small'),
    h(
      'div',
      { class: 'cal-preview' },
      miniCalendar(selected, (day) => {
        ui.homeDate = day;
        save();
        render();
      }),
      h(
        'div',
        { class: 'cal-day' },
        h(
          'h3',
          {},
          button(formatDate(selected, 'long'), () => openDay(selected), 'link'),
        ),
        onDay.length
          ? h(
              'ul',
              { class: 'compact-list' },
              ...onDay.slice(0, 5).map((t) => h('li', { text: t.title })),
            )
          : h('p', { class: 'muted small', text: 'No tasks on this day.' }),
        s.notes.includes(selected)
          ? button(
              'Daily note',
              () => post({ type: 'openDaily', date: selected }),
              'btn ghost small',
              'calendar',
            )
          : undefined,
        upcoming.length ? h('h3', { text: 'Upcoming deadlines' }) : undefined,
        upcoming.length
          ? h(
              'ul',
              { class: 'compact-list' },
              ...upcoming.map((t) =>
                h(
                  'li',
                  {},
                  h('span', { class: 'muted', text: `${formatDate(t.due!)} · ` }),
                  t.title,
                ),
              ),
            )
          : undefined,
      ),
    ),
  );
  // Continue working.
  const pageLine = (p: { title: string; uri: string; section: string; modified?: number }) => {
    const b = h(
      'button',
      { type: 'button', class: 'page-line' },
      svg('file', 13),
      h('span', { class: 'title', text: p.title }),
      p.section ? h('span', { class: 'muted', text: p.section }) : undefined,
      h('span', { class: 'spacer' }),
      p.modified ? h('span', { class: 'muted small', text: ago(p.modified) }) : undefined,
    );
    b.addEventListener('click', () => post({ type: 'openPage', uri: p.uri }));
    return h('li', {}, b);
  };
  const recent = section(
    'Continue working',
    undefined,
    s.home.recent.length
      ? h('ul', { class: 'page-list' }, ...s.home.recent.map(pageLine))
      : h('p', { class: 'muted small', text: 'Pages you edit appear here.' }),
    s.home.favorites.length ? h('h3', { text: 'Favorites' }) : undefined,
    s.home.favorites.length
      ? h('ul', { class: 'page-list' }, ...s.home.favorites.map(pageLine))
      : undefined,
  );
  // My boards: pinned first, then recently used.
  const ids = [...new Set([...P().pinned, ...P().recentBoards])];
  const boards = ids
    .map((id) => s.boards.find((b) => b.id === id && !b.archived))
    .filter((b): b is NonNullable<typeof b> => !!b);
  const myBoards = section(
    'My boards',
    button('All boards', () => setPrefs({ destination: 'boards' }), 'btn ghost small'),
    boards.length
      ? h('div', { class: 'board-grid small' }, ...boards.slice(0, 6).map(boardCard))
      : s.boards.length
        ? h(
            'div',
            { class: 'board-grid small' },
            ...s.boards
              .filter((b) => !b.archived)
              .slice(0, 3)
              .map(boardCard),
          )
        : emptyState(
            'Boards organize tasks in your own columns.',
            button('New board', () => createBoardDialog(), 'btn', 'plus'),
          ),
  );
  wrap.append(h('div', { class: 'home-grid' }, todayCard, calendarCard, recent, myBoards));
  return wrap;
}

export function homeHeader(): HTMLElement {
  const s = S();
  const search = h('input', {
    class: 'field search',
    type: 'search',
    placeholder: 'Search the wiki',
    'aria-label': 'Search the wiki',
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') post({ type: 'search', query: search.value });
  });
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
  return h(
    'div',
    { class: 'home-head' },
    h(
      'div',
      { class: 'home-title' },
      h('h1', { text: s.workspace.name }),
      s.workspace.description
        ? h('p', { class: 'muted', text: s.workspace.description })
        : undefined,
    ),
    h('span', { class: 'spacer' }),
    search,
    daily,
    create,
  );
}

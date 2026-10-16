import { addDays, inList, statusLabels } from '../core/tasks';
import {
  beginEdit,
  boardById,
  button,
  byDue,
  byPriority,
  dialog,
  emptyState,
  field,
  formatDate,
  h,
  MenuItem,
  menuAt,
  optimistic,
  P,
  post,
  relative,
  render,
  S,
  save,
  SavedView,
  setPrefs,
  svg,
  TaskDto,
  TaskList,
  ui,
} from './core';

// ---------------------------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------------------------
export const filtered = (tasks = S().tasks) => {
  const f = ui.filter || {};
  return tasks.filter((t) => {
    if (f.text) {
      const hay =
        `${t.title} ${t.description} ${t.tags.join(' ')} ${t.project || ''} ${t.pageTitle}`.toLowerCase();
      if (
        !f.text
          .toLowerCase()
          .split(/\s+/)
          .every((w) => hay.includes(w))
      )
        return false;
    }
    if (f.tag && !t.tags.includes(f.tag)) return false;
    if (f.project && t.project !== f.project) return false;
    if (f.assignee && t.assignee !== f.assignee) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.board && !(f.board in t.boards)) return false;
    return true;
  });
};
export const listOf = (list: TaskList, tasks = filtered()) =>
  list === 'all'
    ? tasks.filter((t) => !t.checked)
    : tasks.filter((t) => inList(t as never, list as never, S().today, S().upcomingDays));

// ---------------------------------------------------------------------------------------------
// Task actions (shared by rows, cards, calendar items)
// ---------------------------------------------------------------------------------------------
export const updateTask = (task: TaskDto, change: Record<string, unknown>) =>
  optimistic(
    (s) => {
      const t = s.tasks.find((x) => x.key === task.key);
      if (!t) return;
      for (const [k, v] of Object.entries(change))
        (t as unknown as Record<string, unknown>)[k] = v === null ? undefined : v;
    },
    { type: 'update', key: task.key, change },
  );
export const completeTask = (task: TaskDto, done: boolean) =>
  optimistic(
    (s) => {
      const t = s.tasks.find((x) => x.key === task.key);
      if (t) {
        t.checked = done;
        t.status = done ? 'done' : 'todo';
      }
    },
    { type: 'complete', key: task.key, done },
  );

export function select(key?: string) {
  ui.selected = key;
  save();
  render();
}

/** Replaces a title element with an input: Enter saves, Escape cancels. */
export function editTitle(target: HTMLElement, task: TaskDto) {
  const input = h('input', {
    class: 'field inline-edit',
    type: 'text',
    value: task.title,
    'aria-label': 'Task title',
  });
  target.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const end = beginEdit();
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    end();
    const value = input.value.trim();
    if (commit && value && value !== task.title) updateTask(task, { title: value });
    else render();
  };
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('mousedown', (e) => e.stopPropagation());
}

/** Quick labels: tags are `#words` in the title, so adding one appends it. */
function labelDialog(task: TaskDto) {
  const input = h('input', {
    class: 'field',
    type: 'text',
    placeholder: 'release, docs',
    value: '',
  });
  const known = [...new Set(S().tasks.flatMap((t) => t.tags))].sort();
  const list = h('datalist', { id: 'known-tags' }, ...known.map((t) => h('option', { value: t })));
  input.setAttribute('list', 'known-tags');
  dialog(
    `Labels for “${task.title}”`,
    [
      field(
        'Add labels',
        input,
        task.tags.length
          ? `Current: ${task.tags.map((t) => `#${t}`).join(' ')}`
          : 'Separate labels with commas or spaces.',
      ),
      list,
    ],
    'Add',
    () => {
      const tags = input.value
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, '').trim())
        .filter((t) => /^[\p{L}\p{N}_/-]+$/u.test(t) && !task.tags.includes(t));
      if (tags.length)
        updateTask(task, { title: `${task.title} ${tags.map((t) => `#${t}`).join(' ')}` });
    },
  );
}

export function taskMenu(task: TaskDto, context?: { boardId?: string }): MenuItem[] {
  const today = S().today;
  const boards = S().boards.filter((b) => !b.archived);
  const inFileOf = boards.find((b) => b.pagePath === task.pagePath);
  const memberships = Object.keys(task.boards);
  const items: MenuItem[] = [
    { label: 'Edit details…', icon: 'edit', run: () => select(task.key) },
    {
      label: task.checked ? 'Reopen' : 'Complete',
      icon: 'check',
      run: () => completeTask(task, !task.checked),
    },
    {
      label: 'Priority',
      items: (['high', 'medium', 'low', ''] as const).map((p) => ({
        label: p ? p[0].toUpperCase() + p.slice(1) : 'None',
        checked: (task.priority || '') === p,
        run: () => updateTask(task, { priority: p || null }),
      })),
    },
    {
      label: 'Due date',
      icon: 'calendar',
      items: [
        { label: 'Today', run: () => updateTask(task, { due: today }) },
        { label: 'Tomorrow', run: () => updateTask(task, { due: addDays(today, 1) }) },
        { label: 'Next week', run: () => updateTask(task, { due: addDays(today, 7) }) },
        { label: 'Pick a date…', run: () => dueDialog(task) },
        { label: 'No date', disabled: !task.due, run: () => updateTask(task, { due: null }) },
      ],
    },
    { label: 'Labels…', run: () => labelDialog(task) },
  ];
  if (boards.length) {
    const sub: MenuItem[] = boards
      .filter((b) => !(b.id in task.boards))
      .map((b) => ({
        label: b.name,
        run: () => post({ type: 'assign', key: task.key, boardId: b.id }),
      }));
    if (task.board && task.board in task.boards && task.board !== inFileOf?.id)
      sub.push(
        { separator: true, label: '' },
        { label: 'Remove from board', run: () => post({ type: 'assign', key: task.key }) },
      );
    if (sub.length)
      items.push({
        label: memberships.length ? 'Add to another board' : 'Add to board',
        icon: 'layout',
        items: sub,
      });
    if (!inFileOf && memberships.some((id) => id !== 'status'))
      items.push({
        label: 'Move into board file',
        items: memberships
          .map((id) => boards.find((b) => b.id === id))
          .filter((b): b is (typeof boards)[number] => !!b)
          .map((b) => ({
            label: `${b.name} (${b.pagePath})`,
            run: () => post({ type: 'moveToBoardFile', key: task.key, boardId: b.id }),
          })),
      });
  }
  if (context?.boardId) {
    const board = boardById(context.boardId);
    const current = context.boardId === 'status' ? task.status : task.boards[context.boardId];
    if (board)
      items.push({
        label: 'Move to column',
        items: board.columns.map((c) => ({
          label: c.title,
          checked: c.id === current,
          run: () => moveCardTo(task, context.boardId!, c.id),
        })),
      });
  }
  items.push(
    { separator: true, label: '' },
    { label: 'Duplicate', icon: 'copy', run: () => post({ type: 'duplicate', key: task.key }) },
    {
      label: `Open source (${task.pageTitle})`,
      icon: 'file',
      run: () => post({ type: 'open', key: task.key }),
    },
    { separator: true, label: '' },
    {
      label: 'Delete…',
      icon: 'trash',
      danger: true,
      run: () => post({ type: 'remove', key: task.key }),
    },
  );
  return items;
}

export function moveCardTo(task: TaskDto, boardId: string, column: string, order?: string[]) {
  const board = boardById(boardId);
  const target = board?.columns.find((c) => c.id === column);
  optimistic(
    (s) => {
      const t = s.tasks.find((x) => x.key === task.key);
      if (!t) return;
      if (boardId === 'status') {
        t.status = column as TaskDto['status'];
        t.checked = column === 'done';
      } else {
        t.boards = { ...t.boards, [boardId]: column };
        t.checked = !!target?.completed;
      }
      if (order)
        order.forEach((k, i) => {
          const x = s.tasks.find((y) => y.key === k);
          if (x) x.order = i + 1;
        });
    },
    { type: 'move', key: task.key, boardId, column, order },
  );
}

function dueDialog(task: TaskDto) {
  const input = h('input', {
    class: 'field',
    type: 'date',
    value: task.due?.slice(0, 10) || S().today,
  });
  dialog('Due date', [field(task.title, input)], 'Save', () => {
    updateTask(task, { due: input.value ? input.value + (task.due?.slice(10) || '') : null });
  });
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------
export function chips(
  task: TaskDto,
  options: { page?: boolean; compact?: boolean } = {},
): HTMLElement {
  const box = h('span', { class: 'chips' });
  const today = S().today;
  if (task.due) {
    const day = task.due.slice(0, 10);
    const cls = !task.checked && day < today ? 'overdue' : day === today ? 'today' : '';
    box.append(
      h(
        'span',
        { class: `chip ${cls}`, title: `Due ${formatDate(task.due, 'long')}` },
        svg('calendar', 12),
        relative(task.due),
      ),
    );
  }
  if (task.repeat)
    box.append(h('span', { class: 'chip', title: `Repeats ${task.repeat}` }, svg('refresh', 12)));
  if (task.priority) box.append(h('span', { class: `chip ${task.priority}`, text: task.priority }));
  if (!options.compact) {
    if (task.status === 'doing' || task.status === 'blocked')
      box.append(h('span', { class: 'chip', text: statusLabels[task.status] }));
    for (const tag of task.tags.slice(0, 3))
      box.append(h('span', { class: 'chip tag', text: `#${tag}` }));
    if (task.project) box.append(h('span', { class: 'chip', text: task.project }));
  }
  if (task.assignee) box.append(h('span', { class: 'chip', text: `@${task.assignee}` }));
  if (task.subtasks)
    box.append(
      h('span', {
        class: 'chip',
        title: 'Subtasks done',
        text: `☑ ${task.subtasks.done}/${task.subtasks.total}`,
      }),
    );
  if (options.page !== false && task.pageTitle !== task.project)
    box.append(
      h('span', { class: 'chip page', title: task.pagePath }, svg('file', 11), task.pageTitle),
    );
  return box;
}

export function row(task: TaskDto): HTMLElement {
  const check = h('input', {
    type: 'checkbox',
    'aria-label': `Complete ${task.title}`,
    checked: task.checked,
  });
  check.addEventListener('click', (event) => {
    event.stopPropagation();
    completeTask(task, check.checked);
  });
  const title = h('span', { class: 'title', text: task.title, title: 'Click to rename' });
  title.addEventListener('click', (event) => {
    event.stopPropagation();
    editTitle(title, task);
  });
  const more = button(
    '',
    (e) => menuAt(e, taskMenu(task), 'Task actions'),
    'btn ghost icon-only more',
    'more',
    { 'aria-label': `Actions for ${task.title}`, title: 'Actions' },
  );
  more.addEventListener('click', (e) => e.stopPropagation());
  const li = h(
    'li',
    {
      class: `row${task.checked ? ' done' : ''}`,
      tabindex: '0',
      'data-key': task.key,
      'aria-current': ui.selected === task.key ? 'true' : undefined,
    },
    check,
    title,
    chips(task),
    more,
  );
  li.addEventListener('click', () => select(task.key));
  li.addEventListener('contextmenu', (e) => menuAt(e, taskMenu(task), 'Task actions'));
  li.addEventListener('keydown', (event) => {
    if (event.target !== li) return;
    if (event.key === 'Enter') select(task.key);
    else if (event.key === 'F2') editTitle(title, task);
    else if (event.key === ' ') {
      event.preventDefault();
      completeTask(task, !task.checked);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      menuAt(event, taskMenu(task), 'Task actions');
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.row[data-key]'));
      rows[rows.indexOf(li) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  });
  return li;
}

export function group(title: string, tasks: TaskDto[], alert = false, sort = byDue) {
  if (!tasks.length) return undefined;
  return h(
    'section',
    { class: 'group' },
    h(
      'h2',
      { class: alert ? 'alert' : undefined },
      title,
      h('span', { class: 'count', text: String(tasks.length) }),
    ),
    h('ul', { class: 'rows' }, ...tasks.sort(sort).map(row)),
  );
}

export function quickAdd(placeholder: string, send: (text: string) => void, id = 'quick-add') {
  const input = h('input', {
    id,
    class: 'field quick',
    type: 'text',
    placeholder,
    'aria-label': placeholder,
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !input.value.trim()) return;
    send(input.value);
    input.value = '';
  });
  return input;
}

// ---------------------------------------------------------------------------------------------
// Tasks destination
// ---------------------------------------------------------------------------------------------
const listLabels: Array<[TaskList, string]> = [
  ['today', 'Today'],
  ['upcoming', 'Upcoming'],
  ['overdue', 'Overdue'],
  ['inbox', 'Inbox'],
  ['all', 'All open'],
  ['completed', 'Completed'],
];

function grouped(tasks: TaskDto[]): HTMLElement[] {
  const g = P().group;
  if (g === 'none') return [group('Tasks', tasks)].filter((x): x is HTMLElement => !!x);
  const key = (t: TaskDto) =>
    g === 'board'
      ? Object.keys(t.boards).map((id) => boardById(id)?.name || id)[0] || 'No board'
      : g === 'page'
        ? t.pageTitle
        : g === 'priority'
          ? t.priority || 'No priority'
          : t.project || 'No project';
  const groups = new Map<string, TaskDto[]>();
  for (const t of tasks) groups.set(key(t), [...(groups.get(key(t)) || []), t]);
  return [...groups.keys()]
    .sort()
    .map((k) => group(k, groups.get(k)!, false, g === 'priority' ? byDue : byPriority)!);
}

function listBody(list: TaskList): HTMLElement {
  const main = h('div');
  const tasks = listOf(list);
  const today = S().today;
  if (list === 'today' && P().group === 'none') {
    const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < today);
    const due = tasks.filter((t) => t.due?.slice(0, 10) === today);
    const rest = tasks.filter((t) => !overdue.includes(t) && !due.includes(t));
    main.append(
      ...[
        group('Overdue', overdue, true),
        group('Due today', due),
        group('Started or from today’s note', rest),
      ].filter((x): x is HTMLElement => !!x),
    );
  } else if (list === 'upcoming' && P().group === 'none') {
    const days = new Map<string, TaskDto[]>();
    for (const t of tasks)
      days.set(t.due!.slice(0, 10), [...(days.get(t.due!.slice(0, 10)) || []), t]);
    for (const day of [...days.keys()].sort())
      main.append(group(formatDate(day, 'long'), days.get(day)!)!);
  } else if (list === 'completed' && P().group === 'none') {
    const days = new Map<string, TaskDto[]>();
    for (const t of tasks) days.set(t.done || '', [...(days.get(t.done || '') || []), t]);
    for (const day of [...days.keys()].sort().reverse())
      main.append(
        group(
          day ? `Completed ${formatDate(day, 'long')}` : 'Completed (no date)',
          days.get(day)!,
        )!,
      );
  } else main.append(...grouped(tasks));
  if (!tasks.length) {
    const hint: Record<TaskList, string> = {
      today: 'Nothing due today. Add a task above, or plan in today’s note.',
      upcoming: `No tasks due in the next ${S().upcomingDays} days.`,
      overdue: 'Nothing is overdue.',
      inbox: `Tasks without a date or project collect here. Quick add writes to ${S().inbox}.`,
      all:
        ui.filter && Object.values(ui.filter).some(Boolean)
          ? 'No open task matches these filters.'
          : 'No open tasks. Add one above.',
      completed: 'Completed tasks appear here with the day they were finished.',
    };
    main.append(
      emptyState(
        hint[list],
        ...(list === 'today'
          ? [
              button(
                "Open today's note",
                () => post({ type: 'openDaily', date: S().today }),
                'btn',
                'calendar',
              ),
            ]
          : []),
        ...(ui.filter && Object.values(ui.filter).some(Boolean)
          ? [button('Clear filters', () => ((ui.filter = {}), save(), render()))]
          : []),
      ),
    );
  }
  return main;
}

export function tableView(tasks: TaskDto[]): HTMLElement {
  const columns: Array<[string, (t: TaskDto) => string]> = [
    ['Title', (t) => t.title],
    ['Status', (t) => (t.checked ? 'Done' : statusLabels[t.status])],
    ['Priority', (t) => t.priority || ''],
    ['Due', (t) => t.due || ''],
    ['Start', (t) => t.start || ''],
    [
      'Board',
      (t) =>
        Object.keys(t.boards)
          .map((id) => boardById(id)?.name || id)
          .join(', '),
    ],
    ['Project', (t) => t.project || ''],
    ['Assignee', (t) => (t.assignee ? `@${t.assignee}` : '')],
    ['Page', (t) => t.pageTitle],
  ];
  const sort = ui.sort || { column: 'Due', descending: false };
  const value = columns.find(([name]) => name === sort.column)?.[1] || columns[3][1];
  const sorted = [...tasks].sort(
    (a, b) => (value(a) || '￿').localeCompare(value(b) || '￿') * (sort.descending ? -1 : 1),
  );
  const head = h('tr');
  for (const [name] of columns) {
    const th = h('th', {
      scope: 'col',
      tabindex: '0',
      text: name,
      'aria-sort':
        sort.column === name ? (sort.descending ? 'descending' : 'ascending') : undefined,
    });
    const toggle = () => {
      ui.sort = { column: name, descending: sort.column === name ? !sort.descending : false };
      save();
      render();
    };
    th.addEventListener('click', toggle);
    th.addEventListener('keydown', (e) => e.key === 'Enter' && toggle());
    head.append(th);
  }
  const body = h('tbody');
  for (const task of sorted) {
    const tr = h('tr', { 'data-key': task.key, tabindex: '0' });
    for (const [name, get] of columns)
      tr.append(h('td', { class: name === 'Title' ? 'title' : undefined, text: get(task) }));
    tr.addEventListener('click', () => select(task.key));
    tr.addEventListener('contextmenu', (e) => menuAt(e, taskMenu(task), 'Task actions'));
    tr.addEventListener('keydown', (e) => e.key === 'Enter' && select(task.key));
    body.append(tr);
  }
  return sorted.length
    ? h(
        'div',
        { class: 'table-wrap' },
        h('table', { 'aria-label': 'Tasks' }, h('thead', {}, head), body),
      )
    : emptyState('No tasks match these filters.');
}

export function filterBar(): HTMLElement {
  const all = S().tasks;
  const f = (ui.filter ||= {});
  const facet = (
    label: string,
    key: 'tag' | 'project' | 'assignee' | 'priority' | 'board',
    values: Array<[string, string]>,
  ) => {
    if (!values.length) return undefined;
    const s = h('select', { class: 'field', 'aria-label': `Filter by ${label}` });
    s.append(h('option', { value: '', text: `Any ${label}` }));
    for (const [v, text] of values)
      s.append(h('option', { value: v, text, selected: f[key] === v }));
    s.addEventListener('change', () => {
      f[key] = s.value || undefined;
      save();
      render();
    });
    return s;
  };
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const search = h('input', {
    id: 'filter-text',
    class: 'field',
    type: 'search',
    placeholder: 'Filter tasks',
    'aria-label': 'Filter tasks',
    value: f.text || '',
  });
  search.addEventListener('input', () => {
    f.text = search.value || undefined;
    save();
    render();
  });
  return h(
    'div',
    { class: 'filters' },
    search,
    facet(
      'board',
      'board',
      S().boards.map((b) => [b.id, b.name]),
    ),
    facet(
      'label',
      'tag',
      uniq(all.flatMap((t) => t.tags)).map((t) => [t, `#${t}`]),
    ),
    facet(
      'project',
      'project',
      uniq(all.flatMap((t) => (t.project ? [t.project] : []))).map((p) => [p, p]),
    ),
    facet(
      'assignee',
      'assignee',
      uniq(all.flatMap((t) => (t.assignee ? [t.assignee] : []))).map((a) => [a, `@${a}`]),
    ),
    facet('priority', 'priority', [
      ['high', 'High'],
      ['medium', 'Medium'],
      ['low', 'Low'],
    ]),
  );
}

export function tasksView(): HTMLElement {
  const prefs = P();
  const wrap = h('div', { class: 'tasks-view' });
  const counts: Partial<Record<TaskList, number>> = {};
  for (const [list] of listLabels)
    if (list !== 'completed' && list !== 'all') counts[list] = listOf(list).length;
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Task lists' });
  for (const [list, label] of listLabels) {
    const tab = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `list-${list}`,
        'aria-selected': String(prefs.taskList === list),
      },
      label,
    );
    if (counts[list])
      tab.append(
        h('span', {
          class: `count${list === 'overdue' ? ' alert' : ''}`,
          text: String(counts[list]),
        }),
      );
    tab.addEventListener('click', () => setPrefs({ taskList: list }));
    tabs.append(tab);
  }
  const layout = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Layout' });
  for (const [v, label] of [
    ['list', 'List'],
    ['table', 'Table'],
  ] as const) {
    const b = button(label, () => setPrefs({ taskLayout: v }), 'btn ghost');
    b.setAttribute('aria-pressed', String(prefs.taskLayout === v));
    layout.append(b);
  }
  const grouping = h('select', { class: 'field', 'aria-label': 'Group by' });
  for (const [v, t] of [
    ['none', 'No grouping'],
    ['board', 'Group by board'],
    ['page', 'Group by page'],
    ['priority', 'Group by priority'],
    ['project', 'Group by project'],
  ])
    grouping.append(h('option', { value: v, text: t, selected: prefs.group === v }));
  grouping.addEventListener('change', () =>
    setPrefs({ group: grouping.value as typeof prefs.group }),
  );
  // Saved views: a list, a layout, filters and grouping under a name.
  const views = h('select', { class: 'field', 'aria-label': 'Saved views' });
  views.append(
    h('option', { value: '', text: prefs.savedViews.length ? 'Saved views…' : 'No saved views' }),
  );
  prefs.savedViews.forEach((v, i) => views.append(h('option', { value: String(i), text: v.name })));
  views.append(h('option', { value: 'save', text: 'Save current view…' }));
  if (prefs.savedViews.length)
    views.append(h('option', { value: 'delete', text: 'Delete a saved view…' }));
  views.addEventListener('change', () => {
    const value = views.value;
    views.value = '';
    if (value === 'save') return saveViewDialog();
    if (value === 'delete') return deleteViewDialog();
    const view = prefs.savedViews[Number(value)];
    if (!view) return;
    ui.filter = { ...view.filter };
    save();
    setPrefs({
      taskList: view.list,
      taskLayout: view.layout,
      group: (view.group as typeof prefs.group) || 'none',
    });
  });
  wrap.append(
    h('div', { class: 'bar' }, tabs, h('span', { class: 'spacer' }), grouping, views, layout),
    h(
      'div',
      { class: 'bar' },
      quickAdd('Add a task — e.g. Call Bob due:tomorrow priority:high #sales', (text) => {
        const fields =
          prefs.taskList === 'today' && !/(^|\s)due:/.test(text) ? { due: S().today } : {};
        post({ type: 'add', text, fields });
      }),
    ),
    filterBar(),
  );
  const tasks = prefs.taskList === 'completed' ? listOf('completed') : listOf(prefs.taskList);
  wrap.append(prefs.taskLayout === 'table' ? tableView(tasks) : listBody(prefs.taskList));
  return wrap;
}

function saveViewDialog() {
  const name = h('input', {
    class: 'field',
    type: 'text',
    placeholder: 'High priority docs',
    required: true,
  });
  dialog(
    'Save view',
    [field('Name', name, 'Saves the list, layout, grouping and filters.')],
    'Save',
    () => {
      const prefs = P();
      if (!name.value.trim()) return false;
      const view: SavedView = {
        name: name.value.trim().slice(0, 60),
        list: prefs.taskList,
        layout: prefs.taskLayout,
        filter: Object.fromEntries(Object.entries(ui.filter || {}).filter(([, v]) => v)) as Record<
          string,
          string
        >,
        group: prefs.group,
      };
      setPrefs({ savedViews: [...prefs.savedViews.filter((v) => v.name !== view.name), view] });
    },
  );
}
function deleteViewDialog() {
  const s = h('select', { class: 'field' });
  P().savedViews.forEach((v, i) => s.append(h('option', { value: String(i), text: v.name })));
  dialog('Delete saved view', [field('View', s)], 'Delete', () => {
    setPrefs({ savedViews: P().savedViews.filter((_, i) => i !== Number(s.value)) });
  });
}

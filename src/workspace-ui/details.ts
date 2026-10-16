import { statusLabels } from '../core/tasks';
import { boardById, button, h, iconButton, post, S, TaskDto } from './core';
import { completeTask, moveCardTo, select, updateTask } from './tasks';

/** Advanced editing; simple changes happen inline on rows and cards. */
export function detail(task: TaskDto): HTMLElement {
  const panel = h('aside', { class: 'detail', 'aria-label': 'Task details' });
  const update = (change: Record<string, unknown>) => updateTask(task, change);
  const input = (
    label: string,
    value: string,
    type: string,
    commit: (v: string) => void,
    extra: Record<string, string> = {},
  ) => {
    const id = `f-${label.toLowerCase().replace(/\W/g, '')}`;
    const el = h('input', { id, class: 'field', type, value, ...extra });
    el.addEventListener('change', () => commit(el.value));
    return [h('label', { for: id, text: label }), el];
  };
  const choose = (
    label: string,
    value: string,
    options: Array<[string, string]>,
    commit: (v: string) => void,
  ) => {
    const id = `f-${label.toLowerCase().replace(/\W/g, '')}`;
    const el = h('select', { id, class: 'field' });
    for (const [v, text] of options)
      el.append(h('option', { value: v, text, selected: v === value }));
    el.addEventListener('change', () => commit(el.value));
    return [h('label', { for: id, text: label }), el];
  };
  const close = iconButton('chevron', 'Close details', () => select(undefined));
  close.style.marginLeft = 'auto';
  const repeatOptions: Array<[string, string]> = [
    ['', 'Does not repeat'],
    ['daily', 'Daily'],
    ['weekdays', 'Weekdays'],
    ['weekly', 'Weekly'],
    ['every-2-weeks', 'Every 2 weeks'],
    ['monthly', 'Monthly'],
    ['yearly', 'Yearly'],
  ];
  if (task.repeat && !repeatOptions.some(([v]) => v === task.repeat))
    repeatOptions.push([task.repeat, task.repeat]);
  panel.append(
    h('h2', {}, 'Task', close),
    ...input('Title', task.title, 'text', (v) => v.trim() && update({ title: v })),
    ...choose('Status', task.checked ? 'done' : task.status, Object.entries(statusLabels), (v) =>
      v === 'done' ? completeTask(task, true) : update({ status: v }),
    ),
    ...choose(
      'Priority',
      task.priority || '',
      [
        ['', 'None'],
        ['high', 'High'],
        ['medium', 'Medium'],
        ['low', 'Low'],
      ],
      (v) => update({ priority: v || null }),
    ),
    ...input('Due', task.due?.slice(0, 10) || '', 'date', (v) =>
      update({ due: v ? v + (task.due?.slice(10) || '') : null }),
    ),
    ...input('Start', task.start?.slice(0, 10) || '', 'date', (v) => update({ start: v || null })),
    ...choose('Repeat', task.repeat || '', repeatOptions, (v) => update({ repeat: v || null })),
    ...input('Project', task.project || '', 'text', (v) => update({ project: v.trim() || null })),
    ...input('Assignee', task.assignee || '', 'text', (v) =>
      update({ assignee: v.trim() || null }),
    ),
  );
  // Boards: membership and column per board. The line stays in its page.
  const boards = Object.entries(task.boards);
  const boardBox = h('div', { class: 'detail-boards' });
  for (const [id, col] of boards) {
    const board = boardById(id);
    if (!board) continue;
    const s = h('select', { class: 'field', 'aria-label': `Column on ${board.name}` });
    for (const c of board.columns)
      s.append(h('option', { value: c.id, text: c.title, selected: c.id === col }));
    s.addEventListener('change', () => moveCardTo(task, id, s.value));
    boardBox.append(h('div', { class: 'board-line' }, h('span', { text: board.name }), s));
  }
  const others = S().boards.filter((b) => !b.archived && !(b.id in task.boards));
  if (others.length) {
    const add = h('select', { class: 'field', 'aria-label': 'Add to board' });
    add.append(
      h('option', { value: '', text: 'Add to board…' }),
      ...others.map((b) => h('option', { value: b.id, text: b.name })),
    );
    add.addEventListener(
      'change',
      () => add.value && post({ type: 'assign', key: task.key, boardId: add.value }),
    );
    boardBox.append(add);
  }
  if (!boards.length && !others.length)
    boardBox.append(
      h('p', { class: 'desc', text: 'Create a board to organize this task in columns.' }),
    );
  panel.append(h('label', { text: 'Boards' }), boardBox);
  if (task.tags.length)
    panel.append(
      h('label', { text: 'Labels' }),
      h('div', { class: 'desc', text: task.tags.map((t) => `#${t}`).join(' ') }),
    );
  if (task.subtasks)
    panel.append(
      h('label', { text: 'Subtasks' }),
      h('div', { class: 'desc', text: `${task.subtasks.done} of ${task.subtasks.total} done` }),
    );
  panel.append(
    h('label', { text: 'Notes' }),
    h('div', {
      class: 'desc',
      text: task.description || 'Add notes as indented lines under the task in its page.',
    }),
    h('label', { text: 'Source page' }),
    h('div', { class: 'desc', text: task.pagePath }),
    h(
      'div',
      { class: 'actions' },
      button(
        task.checked ? 'Reopen' : 'Complete',
        () => completeTask(task, !task.checked),
        'btn primary',
        'check',
      ),
      button('Open in page', () => post({ type: 'open', key: task.key }), 'btn', 'file'),
      button('Delete', () => post({ type: 'remove', key: task.key }), 'btn ghost danger', 'trash'),
    ),
  );
  return panel;
}

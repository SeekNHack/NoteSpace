import { addDays, addMonths, startOfWeek } from '../core/tasks';
import {
  button,
  byDue,
  dialog,
  emptyState,
  field,
  formatDate,
  h,
  menuAt,
  P,
  post,
  render,
  S,
  save,
  setPrefs,
  TaskDto,
  ui,
} from './core';
import { filtered, row, select, taskMenu, updateTask } from './tasks';

const updateTaskDue = (task: TaskDto, day: string) =>
  updateTask(task, { due: day + (task.due?.slice(10) || '') });

let dragged: string | undefined;

/** Tasks on a calendar day: due that day, starting that day, or completed that day without a due date. */
export const tasksOn = (tasks: TaskDto[], day: string) =>
  tasks
    .filter(
      (t) =>
        t.due?.slice(0, 10) === day || t.start?.slice(0, 10) === day || (!t.due && t.done === day),
    )
    .sort(byDue);

export function addOnDay(day: string) {
  const input = h('input', {
    class: 'field',
    type: 'text',
    placeholder: 'Task title — tokens like priority:high #tag work',
    required: true,
  });
  const kind = h(
    'select',
    { class: 'field' },
    h('option', { value: 'due', text: 'Due this day' }),
    h('option', { value: 'start', text: 'Starts this day' }),
  );
  dialog(
    `New task on ${formatDate(day, 'long')}`,
    [field('Task', input), field('Date', kind)],
    'Add task',
    () => {
      if (!input.value.trim()) return false;
      post({ type: 'add', text: input.value, fields: { [kind.value]: day } });
    },
  );
}

/** Opens the Calendar destination on one day. */
export function openDay(day: string) {
  ui.cursor = day;
  save();
  setPrefs({ destination: 'calendar', calendar: 'day' });
}

function goto(day: string, mode?: 'month' | 'week' | 'day') {
  ui.cursor = day;
  save();
  if (mode) setPrefs({ calendar: mode });
  else render();
}

export function calendarView(): HTMLElement {
  let cursor = ui.cursor || S().today;
  const tasks = filtered();
  const notes = new Set(S().notes);
  const wrap = h('div', { class: 'calendar-view' });
  const mode = P().calendar;
  const step = (n: number) =>
    goto(mode === 'month' ? addMonths(cursor, n) : addDays(cursor, mode === 'week' ? 7 * n : n));
  const jump = h('input', {
    type: 'date',
    class: 'field',
    'aria-label': 'Jump to date',
    value: cursor,
  });
  jump.addEventListener('change', () => jump.value && goto(jump.value));
  const title =
    mode === 'month'
      ? new Intl.DateTimeFormat(undefined, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${cursor}T12:00:00Z`))
      : mode === 'week'
        ? `Week of ${formatDate(startOfWeek(cursor))}`
        : formatDate(cursor, 'long');
  const modes = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Calendar view' });
  for (const m of ['month', 'week', 'day'] as const) {
    const b = button(m[0].toUpperCase() + m.slice(1), () => setPrefs({ calendar: m }), 'btn ghost');
    b.setAttribute('aria-pressed', String(m === mode));
    modes.append(b);
  }
  const prev = button('', () => step(-1), 'btn ghost icon-only flip', 'chevronRight', {
    'aria-label': 'Previous',
    title: 'Previous',
  });
  const next = button('', () => step(1), 'btn ghost icon-only', 'chevronRight', {
    'aria-label': 'Next',
    title: 'Next',
  });
  wrap.append(
    h(
      'div',
      { class: 'cal-head' },
      prev,
      h('h2', { text: title }),
      next,
      button('Today', () => goto(S().today)),
      jump,
      modes,
      h('span', { class: 'spacer' }),
      h('span', {
        class: 'muted small',
        text: `${S().streak}-day journal streak · ${S().timeZone}`,
      }),
    ),
  );
  const dropReschedule = (el: HTMLElement, day: string) => {
    el.addEventListener('dragover', (event) => {
      if (!dragged) return;
      event.preventDefault();
      el.classList.add('drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('drop');
      const task = S().tasks.find((t) => t.key === dragged);
      dragged = undefined;
      if (task) updateTaskDue(task, day);
    });
  };
  const draggableItem = (task: TaskDto, el: HTMLElement) => {
    el.draggable = true;
    el.addEventListener('dragstart', (event) => {
      event.stopPropagation();
      dragged = task.key;
      event.dataTransfer!.setData('text/plain', task.key);
    });
  };
  if (mode === 'month') {
    const grid = h('div', { class: 'month', role: 'grid', 'aria-label': title });
    for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
      grid.append(h('div', { class: 'dow', role: 'columnheader', text: name }));
    const first = startOfWeek(cursor.slice(0, 8) + '01');
    for (let i = 0; i < 42; i++) {
      const day = addDays(first, i);
      const items = tasksOn(tasks, day);
      const cell = h('div', {
        class: `day${day.slice(0, 7) !== cursor.slice(0, 7) ? ' other' : ''}${day === S().today ? ' today' : ''}`,
        'data-date': day,
        tabindex: day === cursor ? '0' : '-1',
        role: 'gridcell',
        'aria-label': `${formatDate(day, 'long')}: ${items.length} task${items.length === 1 ? '' : 's'}${notes.has(day) ? ', daily note' : ''}`,
      });
      const open = button(String(Number(day.slice(8))), () => goto(day, 'day'), 'num', undefined, {
        title: 'Open this day',
        tabindex: '-1',
      });
      const add = button('+', () => addOnDay(day), 'add-day', undefined, {
        'aria-label': `Add a task on ${formatDate(day, 'long')}`,
        title: 'Add a task',
        tabindex: '-1',
      });
      cell.append(
        h(
          'span',
          { class: 'head' },
          open,
          notes.has(day) ? h('span', { class: 'note', title: 'Daily note' }) : undefined,
          add,
        ),
      );
      for (const task of items.slice(0, 3)) {
        const starts = task.start?.slice(0, 10) === day && task.due?.slice(0, 10) !== day;
        const item = h('button', {
          type: 'button',
          class: `item${task.checked ? ' done' : ''}${!task.checked && task.due && task.due.slice(0, 10) < S().today ? ' overdue' : ''}${starts ? ' start' : ''}`,
          text: `${starts ? '▸ ' : ''}${task.title}`,
          title: `${starts ? 'Starts: ' : ''}${task.title} — ${task.pageTitle}`,
          tabindex: '-1',
        });
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          select(task.key);
        });
        item.addEventListener('contextmenu', (e) => menuAt(e, taskMenu(task), 'Task actions'));
        draggableItem(task, item);
        cell.append(item);
      }
      if (items.length > 3)
        cell.append(h('span', { class: 'more', text: `+${items.length - 3} more` }));
      cell.addEventListener('dblclick', () => addOnDay(day));
      cell.addEventListener('keydown', (event) => {
        if (event.target !== cell) return;
        if (event.key === 'Enter') return goto(day, 'day');
        if (event.key === 'n') {
          event.preventDefault();
          return addOnDay(day);
        }
        const move = (
          { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>
        )[event.key];
        if (!move) return;
        event.preventDefault();
        cursor = addDays(day, move);
        goto(cursor);
        document.querySelector<HTMLElement>(`.day[data-date="${cursor}"]`)?.focus();
      });
      dropReschedule(cell, day);
      grid.append(cell);
    }
    wrap.append(
      grid,
      h('p', {
        class: 'muted small',
        text: 'Double-click a day or press N on it to add a task; drag a task to another day to change its due date.',
      }),
    );
  } else if (mode === 'week') {
    const week = h('div', { class: 'week' });
    const start = startOfWeek(cursor);
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const items = tasksOn(tasks, day);
      const col = h(
        'section',
        { class: `col${day === S().today ? ' today' : ''}`, 'aria-label': formatDate(day, 'long') },
        h(
          'h3',
          {},
          button(formatDate(day), () => goto(day, 'day'), 'link'),
          h(
            'span',
            {},
            button(
              notes.has(day) ? 'Note' : '+ Note',
              () => post({ type: 'openDaily', date: day }),
              'btn ghost small',
            ),
            button('+', () => addOnDay(day), 'btn ghost small', undefined, {
              'aria-label': `Add a task on ${formatDate(day, 'long')}`,
            }),
          ),
        ),
        items.length
          ? h('ul', { class: 'rows' }, ...items.map(row))
          : h('p', { class: 'col-empty', text: 'Free' }),
      );
      col
        .querySelectorAll<HTMLElement>('.row')
        .forEach((r, index) => draggableItem(items[index], r));
      dropReschedule(col, day);
      week.append(col);
    }
    wrap.append(week);
  } else {
    const items = tasksOn(tasks, cursor);
    const add = h('input', {
      class: 'field quick',
      type: 'text',
      placeholder: `Add a task due ${formatDate(cursor)}`,
      'aria-label': 'Add a task for this day',
    });
    add.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !add.value.trim()) return;
      post({ type: 'add', text: add.value, fields: { due: cursor } });
      add.value = '';
    });
    wrap.append(
      h(
        'div',
        { class: 'bar' },
        add,
        button(
          notes.has(cursor) ? 'Open daily note' : 'Create daily note',
          () => post({ type: 'openDaily', date: cursor }),
          'btn',
          'calendar',
        ),
      ),
      items.length
        ? h('ul', { class: 'rows' }, ...items.map(row))
        : emptyState('No scheduled tasks for this day.'),
    );
  }
  return wrap;
}

/** Compact month for the Home: dots for tasks and notes, a selected day below. */
export function miniCalendar(selected: string, onSelect: (day: string) => void): HTMLElement {
  const tasks = S().tasks.filter((t) => !t.checked);
  const notes = new Set(S().notes);
  const first = startOfWeek(selected.slice(0, 8) + '01');
  const grid = h('div', {
    class: 'mini-month',
    role: 'group',
    'aria-label': new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${selected}T12:00:00Z`)),
  });
  for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    grid.append(h('span', { class: 'dow', 'aria-hidden': 'true', text: d }));
  for (let i = 0; i < 42; i++) {
    const day = addDays(first, i);
    const count = tasksOn(tasks, day).length;
    const b = h(
      'button',
      {
        type: 'button',
        class: `mini-day${day.slice(0, 7) !== selected.slice(0, 7) ? ' other' : ''}${day === S().today ? ' today' : ''}${day === selected ? ' selected' : ''}`,
        'aria-pressed': String(day === selected),
        'aria-label': `${formatDate(day, 'long')}${count ? `, ${count} task${count === 1 ? '' : 's'}` : ''}${notes.has(day) ? ', daily note' : ''}`,
        tabindex: day === selected ? '0' : '-1',
      },
      h('span', { text: String(Number(day.slice(8))) }),
      count || notes.has(day)
        ? h(
            'span',
            { class: 'dots' },
            count ? h('i', { class: 'task' }) : undefined,
            notes.has(day) ? h('i', { class: 'note' }) : undefined,
          )
        : undefined,
    );
    b.addEventListener('click', () => onSelect(day));
    b.addEventListener('dblclick', () => openDay(day));
    b.addEventListener('keydown', (event) => {
      const move = (
        { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>
      )[event.key];
      if (!move) return;
      event.preventDefault();
      onSelect(addDays(day, move));
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.mini-day.selected')?.focus(),
      );
    });
    grid.append(b);
  }
  return grid;
}

import {
  boardColors,
  boardFileName,
  boardIcons,
  boardTemplates,
  BoardColumn,
  BoardConfig,
} from '../core/board-model';
import type { IconName } from '../core/icons';
import {
  beginEdit,
  BoardDto,
  boardById,
  button,
  byDue,
  byPriority,
  columnColor,
  dialog,
  emptyState,
  field,
  h,
  iconButton,
  MenuItem,
  menuAt,
  optimistic,
  P,
  post,
  render,
  S,
  setPrefs,
  svg,
  TaskDto,
  ui,
  shownTitle,
} from './core';
import {
  chips,
  completeTask,
  editTitle,
  filtered,
  moveCardTo,
  select,
  taskMenu,
  updateTask,
} from './tasks';

type AnyBoard = BoardConfig & { pagePath?: string; count?: number; archived?: boolean };

export function openBoard(id: string) {
  setPrefs({ destination: 'board', board: id });
}

const iconOf = (name?: string): IconName =>
  (boardIcons as readonly string[]).includes(name || '') ? (name as IconName) : 'layout';

// ---------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------
const colorSelect = (value?: string) => {
  const s = h('select', { class: 'field' });
  s.append(h('option', { value: '', text: 'Default' }));
  for (const c of boardColors)
    s.append(
      h('option', { value: c, text: c[0].toUpperCase() + c.slice(1), selected: c === value }),
    );
  return s;
};
const iconSelect = (value?: string) => {
  const s = h('select', { class: 'field' });
  s.append(h('option', { value: '', text: 'Default' }));
  for (const c of boardIcons) s.append(h('option', { value: c, text: c, selected: c === value }));
  return s;
};

export function createBoardDialog(defaults: { name?: string } = {}) {
  const folder = S().workspace.boardsFolder;
  const name = h('input', {
    class: 'field',
    type: 'text',
    placeholder: 'Product roadmap',
    value: defaults.name || '',
    required: true,
    maxlength: '120',
  });
  const path = h('input', {
    class: 'field',
    type: 'text',
    value: boardFileName(defaults.name || 'board', folder),
    spellcheck: 'false',
  });
  const exists = h('small', { class: 'warn', role: 'status' });
  let pathEdited = false;
  const check = () => post({ type: 'boardFileExists', path: path.value });
  name.addEventListener('input', () => {
    if (!pathEdited) path.value = boardFileName(name.value || 'board', folder);
    check();
  });
  path.addEventListener('input', () => {
    pathEdited = true;
    check();
  });
  const template = h('select', { class: 'field' });
  for (const t of boardTemplates) template.append(h('option', { value: t.id, text: t.label }));
  const preview = h('div', { class: 'col-preview', 'aria-live': 'polite' });
  const showPreview = () => {
    const t = boardTemplates.find((x) => x.id === template.value)!;
    preview.replaceChildren(
      ...t.columns.map((c) =>
        h('span', {
          class: 'col-pill',
          style: `--c:${columnColor(c)}`,
          text: c.title + (c.completed ? ' ✓' : ''),
        }),
      ),
    );
  };
  template.addEventListener('change', showPreview);
  showPreview();
  const color = colorSelect();
  const description = h('input', {
    class: 'field',
    type: 'text',
    placeholder: 'Optional',
    maxlength: '500',
  });
  const { close } = dialog(
    'New board',
    [
      field('Name', name),
      field(
        'File',
        path,
        'A Markdown file in the wiki; cards created on the board are written there.',
      ),
      exists,
      field('Starting columns', template),
      preview,
      field('Color', color),
      field('Description', description),
    ],
    'Create board',
    () => {
      if (!name.value.trim()) return false;
      post({
        type: 'createBoard',
        name: name.value,
        path: path.value,
        template: template.value,
        color: color.value || undefined,
        description: description.value,
      });
    },
  );
  void close;
  window.addEventListener('message', function listener(event) {
    const m = event.data;
    if (m?.type !== 'boardFileExists' || m.path !== path.value) return;
    exists.textContent = m.exists
      ? 'A page with this name already exists: choose another file.'
      : '';
    if (!document.body.contains(path)) window.removeEventListener('message', listener);
  });
  check();
}

function renameBoardDialog(board: AnyBoard) {
  const name = h('input', { class: 'field', type: 'text', value: board.name, required: true });
  const description = h('input', { class: 'field', type: 'text', value: board.description || '' });
  const color = colorSelect(board.color);
  const icon = iconSelect(board.icon);
  dialog(
    'Board settings',
    [
      field('Name', name),
      field('Description', description),
      field('Color', color),
      field('Icon', icon),
    ],
    'Save',
    () => {
      if (!name.value.trim()) return false;
      post({
        type: 'updateBoard',
        boardId: board.id,
        change: {
          name: name.value,
          description: description.value,
          color: color.value || null,
          icon: icon.value || null,
        },
      });
    },
  );
}
function duplicateBoardDialog(board: AnyBoard) {
  const folder = S().workspace.boardsFolder;
  const name = h('input', {
    class: 'field',
    type: 'text',
    value: `${board.name} copy`,
    required: true,
  });
  const path = h('input', {
    class: 'field',
    type: 'text',
    value: boardFileName(`${board.name} copy`, folder),
  });
  name.addEventListener('input', () => (path.value = boardFileName(name.value || 'board', folder)));
  dialog(
    'Duplicate board',
    [
      field('Name', name),
      field('File', path, 'The columns and settings are copied; cards are not.'),
    ],
    'Duplicate',
    () => {
      post({ type: 'duplicateBoard', boardId: board.id, name: name.value, path: path.value });
    },
  );
}

function boardMenu(board: AnyBoard): MenuItem[] {
  if (board.id === 'status') return [{ label: 'Open', run: () => openBoard('status') }];
  const pinned = P().pinned.includes(board.id);
  return [
    { label: 'Open', icon: 'layout', run: () => openBoard(board.id) },
    {
      label: pinned ? 'Unpin' : 'Pin to Home',
      icon: 'star',
      run: () => post({ type: 'pin', boardId: board.id, pinned: !pinned }),
    },
    { label: 'Rename and settings…', icon: 'edit', run: () => renameBoardDialog(board) },
    { label: 'Duplicate…', icon: 'copy', run: () => duplicateBoardDialog(board) },
    {
      label: board.archived ? 'Restore from archive' : 'Archive',
      run: () =>
        post({ type: 'updateBoard', boardId: board.id, change: { archived: !board.archived } }),
    },
    {
      label: `Open file (${board.pagePath})`,
      icon: 'file',
      run: () => post({ type: 'openBoardFile', boardId: board.id }),
    },
    { separator: true, label: '' },
    {
      label: 'Delete…',
      icon: 'trash',
      danger: true,
      run: () => post({ type: 'deleteBoard', boardId: board.id }),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Boards overview
// ---------------------------------------------------------------------------------------------
export function boardCard(
  board: BoardDto | (AnyBoard & { count: number; open?: number; inProgress?: number }),
): HTMLElement {
  const pinned = P().pinned.includes(board.id);
  const card = h(
    'article',
    {
      class: `board-card${board.archived ? ' archived' : ''}`,
      style: `--c:var(--bc-${board.color || 'gray'})`,
      'data-board': board.id,
    },
    h(
      'div',
      { class: 'board-card-head' },
      h('span', { class: 'board-icon' }, svg(iconOf(board.icon), 16)),
      h('h3', {}, h('a', { href: '#', class: 'open', text: board.name })),
    ),
    board.description ? h('p', { class: 'desc', text: board.description }) : undefined,
    h(
      'p',
      { class: 'meta' },
      `${board.count} task${board.count === 1 ? '' : 's'}`,
      'inProgress' in board && board.inProgress ? ` · ${board.inProgress} in progress` : '',
      'open' in board && board.open !== undefined ? ` · ${board.open} open` : '',
    ),
  );
  const actions = h('div', { class: 'board-card-actions' });
  if (board.id !== 'status') {
    const pin = iconButton('star', pinned ? 'Unpin' : 'Pin to Home', (e) => {
      e.stopPropagation();
      post({ type: 'pin', boardId: board.id, pinned: !pinned });
    });
    pin.setAttribute('aria-pressed', String(pinned));
    actions.append(pin);
  }
  const more = iconButton('more', `Actions for ${board.name}`, (e) => {
    e.stopPropagation();
    menuAt(e, boardMenu(board), 'Board actions');
  });
  actions.append(more);
  card.append(actions);
  card.querySelector('a.open')!.addEventListener('click', (e) => {
    e.preventDefault();
    openBoard(board.id);
  });
  card.addEventListener('contextmenu', (e) => menuAt(e, boardMenu(board), 'Board actions'));
  return card;
}

export function boardsView(): HTMLElement {
  const boards = S().boards;
  const active = boards.filter((b) => !b.archived);
  const archived = boards.filter((b) => b.archived);
  const pinned = P()
    .pinned.map((id) => active.find((b) => b.id === id))
    .filter((b): b is BoardDto => !!b);
  const wrap = h('div', { class: 'boards-view' });
  wrap.append(
    h(
      'div',
      { class: 'section-head' },
      h('h2', { text: 'Boards' }),
      h('span', { class: 'spacer' }),
      button('New board', () => createBoardDialog(), 'btn primary', 'plus'),
    ),
  );
  if (pinned.length)
    wrap.append(
      h('h3', { class: 'sub-head', text: 'Pinned' }),
      h('div', { class: 'board-grid' }, ...pinned.map(boardCard)),
    );
  wrap.append(
    h('h3', { class: 'sub-head', text: pinned.length ? 'All boards' : 'Your boards' }),
    h(
      'div',
      { class: 'board-grid' },
      ...active.filter((b) => !P().pinned.includes(b.id)).map(boardCard),
      boardCard(S().statusBoard),
    ),
  );
  if (!active.length)
    wrap.append(
      emptyState(
        'Create a board for a project, a team or a routine. Each board is a Markdown file with its own columns; tasks from any page can join it.',
        button('New board', () => createBoardDialog(), 'btn primary', 'plus'),
      ),
    );
  if (archived.length)
    wrap.append(
      h(
        'details',
        { class: 'archived-boards' },
        h('summary', { text: `Archived (${archived.length})` }),
        h('div', { class: 'board-grid' }, ...archived.map(boardCard)),
      ),
    );
  return wrap;
}

// ---------------------------------------------------------------------------------------------
// One board
// ---------------------------------------------------------------------------------------------
let dragged: { kind: 'card' | 'column'; key: string } | undefined;

function columnOfTask(task: TaskDto, board: AnyBoard) {
  return board.id === 'status' ? (task.checked ? 'done' : task.status) : task.boards[board.id];
}

function deleteColumnDialog(board: AnyBoard, column: BoardColumn, cards: TaskDto[]) {
  const others = board.columns.filter((c) => c.id !== column.id);
  if (!cards.length) {
    dialog(
      `Delete column “${column.title}”?`,
      [h('p', { text: 'The column is empty. Its settings are removed from the board file.' })],
      'Delete column',
      () => {
        post({ type: 'removeColumn', boardId: board.id, id: column.id });
      },
    );
    return;
  }
  const target = h('select', { class: 'field' });
  for (const c of others) target.append(h('option', { value: c.id, text: c.title }));
  dialog(
    `Delete column “${column.title}”?`,
    [
      h('p', {
        text: `It has ${cards.length} card${cards.length === 1 ? '' : 's'}. ${cards.length === 1 ? 'It moves' : 'They move'} to the column you choose; no task is deleted.`,
      }),
      field('Move cards to', target),
    ],
    'Move cards and delete',
    () => post({ type: 'removeColumn', boardId: board.id, id: column.id, moveTo: target.value }),
  );
}

function columnMenu(
  board: AnyBoard,
  column: BoardColumn,
  cards: TaskDto[],
  titleEl: HTMLElement,
): MenuItem[] {
  const index = board.columns.findIndex((c) => c.id === column.id);
  const move = (delta: number) => {
    const ids = board.columns.map((c) => c.id);
    ids.splice(index, 1);
    ids.splice(index + delta, 0, column.id);
    reorderColumns(board, ids);
  };
  const items: MenuItem[] = [];
  if (board.id !== 'status')
    items.push(
      { label: 'Rename', icon: 'edit', run: () => renameColumn(board, column, titleEl) },
      {
        label: 'Color',
        items: [
          {
            label: 'Default',
            run: () =>
              post({
                type: 'updateColumn',
                boardId: board.id,
                id: column.id,
                change: { color: null },
              }),
          },
          ...boardColors.map((c) => ({
            label: c[0].toUpperCase() + c.slice(1),
            checked: column.color === c,
            run: () =>
              post({
                type: 'updateColumn',
                boardId: board.id,
                id: column.id,
                change: { color: c },
              }),
          })),
        ],
      },
      {
        label: 'Icon',
        items: [
          {
            label: 'None',
            run: () =>
              post({
                type: 'updateColumn',
                boardId: board.id,
                id: column.id,
                change: { icon: null },
              }),
          },
          ...boardIcons.map((i) => ({
            label: i,
            icon: i as IconName,
            checked: column.icon === i,
            run: () =>
              post({ type: 'updateColumn', boardId: board.id, id: column.id, change: { icon: i } }),
          })),
        ],
      },
      {
        label: 'Default column for new cards',
        checked: board.defaultColumn === column.id,
        disabled: !!column.completed,
        run: () =>
          post({
            type: 'updateColumn',
            boardId: board.id,
            id: column.id,
            change: { isDefault: true },
          }),
      },
      {
        label: 'Cards here are completed',
        checked: !!column.completed,
        run: () =>
          post({
            type: 'updateColumn',
            boardId: board.id,
            id: column.id,
            change: { completed: !column.completed },
          }),
      },
    );
  items.push(
    { label: 'Move left', disabled: index === 0, run: () => move(-1) },
    { label: 'Move right', disabled: index === board.columns.length - 1, run: () => move(1) },
  );
  if (board.id !== 'status')
    items.push(
      { separator: true, label: '' },
      {
        label: 'Delete column…',
        icon: 'trash',
        danger: true,
        disabled: board.columns.length < 2,
        run: () => deleteColumnDialog(board, column, cards),
      },
    );
  return items;
}

function reorderColumns(board: AnyBoard, ids: string[]) {
  optimistic(
    (s) => {
      const b = board.id === 'status' ? s.statusBoard : s.boards.find((x) => x.id === board.id);
      if (b) b.columns = ids.map((id) => b.columns.find((c) => c.id === id)!).filter(Boolean);
      if (board.id === 'status') P().statusColumns = ids as never;
    },
    { type: 'reorderColumns', boardId: board.id, ids },
  );
}

function renameColumn(board: AnyBoard, column: BoardColumn, titleEl: HTMLElement) {
  if (board.id === 'status') return;
  const input = h('input', {
    class: 'field inline-edit',
    type: 'text',
    value: column.title,
    'aria-label': 'Column title',
  });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const end = beginEdit();
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    end();
    const title = input.value.trim();
    if (commit && title && title !== column.title)
      optimistic(
        (s) => {
          const c = s.boards
            .find((b) => b.id === board.id)
            ?.columns.find((x) => x.id === column.id);
          if (c) c.title = title;
        },
        { type: 'updateColumn', boardId: board.id, id: column.id, change: { title } },
      );
    else render();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function sortCards(board: AnyBoard, cards: TaskDto[]) {
  const sort = board.sort || 'manual';
  return cards.sort(
    sort === 'due'
      ? byDue
      : sort === 'priority'
        ? byPriority
        : (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || byDue(a, b),
  );
}

function card(task: TaskDto, board: AnyBoard, columnId: string, cards: TaskDto[]): HTMLElement {
  const compact = board.density === 'compact';
  const title = h('span', { class: 'card-title', text: shownTitle(task), title: 'Click to edit' });
  const check = h('input', {
    type: 'checkbox',
    'aria-label': `Complete ${task.title}`,
    checked: task.checked,
  });
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    const completed = board.columns.find((c) => c.completed);
    if (board.id !== 'status' && completed && check.checked)
      moveCardTo(task, board.id, completed.id);
    else if (
      board.id !== 'status' &&
      !check.checked &&
      board.columns.find((c) => c.id === columnId)?.completed
    )
      moveCardTo(task, board.id, board.defaultColumn);
    else completeTask(task, check.checked);
  });
  const quick = h(
    'div',
    { class: 'card-quick' },
    iconButton('alert', 'Priority', (e) => {
      e.stopPropagation();
      menuAt(
        e,
        (['high', 'medium', 'low', ''] as const).map((p) => ({
          label: p ? p[0].toUpperCase() + p.slice(1) : 'None',
          checked: (task.priority || '') === p,
          run: () => updateTask(task, { priority: p || null }),
        })),
        'Priority',
      );
    }),
    iconButton('calendar', 'Due date', (e) => {
      e.stopPropagation();
      menuAt(e, taskMenu(task).find((i) => i.label === 'Due date')?.items || [], 'Due date');
    }),
    iconButton('more', `Actions for ${task.title}`, (e) => {
      e.stopPropagation();
      menuAt(e, taskMenu(task, { boardId: board.id }), 'Card actions');
    }),
  );
  const el = h(
    'article',
    {
      class: `card${task.checked ? ' done' : ''}${compact ? ' compact' : ''}`,
      role: 'listitem',
      draggable: 'true',
      tabindex: '0',
      'data-key': task.key,
      'aria-current': ui.selected === task.key ? 'true' : undefined,
      'aria-label': task.title,
    },
    h('div', { class: 'card-top' }, check, title, quick),
    !compact && task.description
      ? h('p', { class: 'card-desc', text: task.description.split('\n')[0].slice(0, 140) })
      : undefined,
    chips(task, {
      compact,
      page: board.id === 'status' || !board.pagePath || task.pagePath !== board.pagePath,
    }),
  );
  title.addEventListener('click', (e) => {
    e.stopPropagation();
    editTitle(title, task);
  });
  el.addEventListener('click', () => select(task.key));
  el.addEventListener('contextmenu', (e) =>
    menuAt(e, taskMenu(task, { boardId: board.id }), 'Card actions'),
  );
  el.addEventListener('keydown', (event) => {
    if (event.target !== el) return;
    const index = board.columns.findIndex((c) => c.id === columnId);
    if (event.key === 'Enter') select(task.key);
    else if (event.key === 'F2') editTitle(title, task);
    else if (event.key === ' ') {
      event.preventDefault();
      check.click();
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      menuAt(event, taskMenu(task, { boardId: board.id }), 'Card actions');
    // Keyboard alternatives to dragging: Alt+←/→ between columns, Alt+↑/↓ within a column.
    else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const target = board.columns[index + (event.key === 'ArrowRight' ? 1 : -1)];
      if (target) {
        moveCardTo(task, board.id, target.id);
        refocus(task.key);
      }
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const order = cards.map((c) => c.key);
      const at = order.indexOf(task.key);
      const to = at + (event.key === 'ArrowDown' ? 1 : -1);
      if (to < 0 || to >= order.length) return;
      order.splice(at, 1);
      order.splice(to, 0, task.key);
      moveCardTo(task, board.id, columnId, order);
      refocus(task.key);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const siblings = Array.from(el.parentElement!.querySelectorAll<HTMLElement>('.card'));
      siblings[siblings.indexOf(el) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  });
  // Dragging starts only from the card body, never while editing a title.
  el.addEventListener('dragstart', (event) => {
    if ((event.target as HTMLElement).closest('input')) return event.preventDefault();
    dragged = { kind: 'card', key: task.key };
    el.classList.add('dragging');
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('text/plain', task.key);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    document
      .querySelectorAll('.drop-before,.drop-after,.column.drop')
      .forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop'));
  });
  return el;
}
const refocus = (key: string) =>
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`.card[data-key="${CSS.escape(key)}"]`)?.focus(),
  );

function column(board: AnyBoard, col: BoardColumn, cards: TaskDto[], lane: string): HTMLElement {
  const titleEl = h('span', {
    class: 'col-title',
    text: col.title,
    title: board.id === 'status' ? col.title : 'Click to rename',
  });
  if (board.id !== 'status')
    titleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      renameColumn(board, col, titleEl);
    });
  const grip = h(
    'span',
    { class: 'grip', draggable: 'true', title: 'Drag to reorder columns', 'aria-hidden': 'true' },
    svg('grip', 12),
  );
  const menu = iconButton('more', `Column ${col.title} actions`, (e) =>
    menuAt(e, columnMenu(board, col, cards, titleEl), 'Column actions'),
  );
  const header = h(
    'header',
    {
      tabindex: '0',
      'aria-label': `${col.title}, ${cards.length} card${cards.length === 1 ? '' : 's'}${col.completed ? ', completed column' : ''}`,
    },
    grip,
    h('span', { class: 'col-dot', style: `--c:${columnColor(col)}` }),
    col.icon ? svg(col.icon as IconName, 13) : undefined,
    titleEl,
    h('span', { class: 'count', text: String(cards.length) }),
    col.completed
      ? h('span', { class: 'done-mark', title: 'Completed column' }, svg('check', 12))
      : undefined,
    board.defaultColumn === col.id && board.id !== 'status'
      ? h('span', { class: 'default-mark', title: 'New cards start here', text: 'default' })
      : undefined,
    h('span', { class: 'spacer' }),
    menu,
  );
  header.addEventListener('keydown', (e) => {
    if (e.target !== header) return;
    const index = board.columns.findIndex((c) => c.id === col.id);
    if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const to = index + (e.key === 'ArrowRight' ? 1 : -1);
      if (to < 0 || to >= board.columns.length) return;
      const ids = board.columns.map((c) => c.id);
      ids.splice(index, 1);
      ids.splice(to, 0, col.id);
      reorderColumns(board, ids);
    } else if (e.key === 'F2') renameColumn(board, col, titleEl);
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
      menuAt(e, columnMenu(board, col, cards, titleEl), 'Column actions');
  });
  const list = h('div', {
    class: 'cards',
    role: cards.length ? 'list' : undefined,
    'aria-label': `${col.title} cards`,
  });
  const section = h(
    'section',
    {
      class: `column${col.completed ? ' completed' : ''}`,
      'data-column': col.id,
      style: `--c:${columnColor(col)}`,
    },
    header,
    list,
  );
  grip.addEventListener('dragstart', (event) => {
    dragged = { kind: 'column', key: col.id };
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('text/plain', col.id);
  });
  for (const task of cards) list.append(card(task, board, col.id, cards));
  if (!cards.length)
    list.append(h('p', { class: 'col-empty', text: 'Drop a task here or add a new card.' }));
  const add = h('input', {
    id: `add-${board.id}-${col.id}${lane ? `-${lane}` : ''}`,
    class: 'field add',
    type: 'text',
    placeholder: '+ Add a card',
    'aria-label': `Add a card to ${col.title}`,
  });
  add.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !add.value.trim()) return;
    const text =
      lane && P().swimlane === 'project' && lane !== 'No project'
        ? `${add.value} project:${lane.replace(/\s+/g, '_')}`
        : lane && P().swimlane === 'priority' && lane !== 'No priority'
          ? `${add.value} priority:${lane}`
          : add.value;
    post({ type: 'add', target: 'board', boardId: board.id, column: col.id, text });
    add.value = '';
  });
  section.append(add);
  section.addEventListener('dragover', (event) => {
    if (!dragged) return;
    event.preventDefault();
    section.classList.add('drop');
    section
      .querySelectorAll('.drop-before,.drop-after')
      .forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    if (dragged.kind === 'card') {
      const items = Array.from(list.querySelectorAll<HTMLElement>('.card'));
      const target = items.find(
        (c) => event.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2,
      );
      if (target) target.classList.add('drop-before');
      else items[items.length - 1]?.classList.add('drop-after');
    }
  });
  section.addEventListener('dragleave', (event) => {
    if (!section.contains(event.relatedTarget as Node)) {
      section.classList.remove('drop');
      section
        .querySelectorAll('.drop-before,.drop-after')
        .forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    }
  });
  section.addEventListener('drop', (event) => {
    event.preventDefault();
    section.classList.remove('drop');
    const current = dragged;
    dragged = undefined;
    if (!current) return;
    if (current.kind === 'column') {
      if (current.key === col.id) return;
      const ids = board.columns.map((c) => c.id).filter((c) => c !== current.key);
      ids.splice(
        ids.indexOf(col.id) +
          (board.columns.findIndex((c) => c.id === current.key) <
          board.columns.findIndex((c) => c.id === col.id)
            ? 1
            : 0),
        0,
        current.key,
      );
      reorderColumns(board, ids);
      return;
    }
    const before = list.querySelector<HTMLElement>('.drop-before')?.dataset.key;
    section
      .querySelectorAll('.drop-before,.drop-after')
      .forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    const moved = S().tasks.find((t) => t.key === current.key);
    if (!moved) return;
    const order = cards.filter((c) => c.key !== moved.key).map((c) => c.key);
    const at = before ? order.indexOf(before) : order.length;
    order.splice(at < 0 ? order.length : at, 0, moved.key);
    const manual = (board.sort || 'manual') === 'manual';
    moveCardTo(moved, board.id, col.id, manual ? order : undefined);
  });
  return section;
}

export function boardView(): HTMLElement {
  const boards = S().boards;
  const board: AnyBoard | undefined = boardById(P().board);
  const wrap = h('div', { class: 'board-view' });
  const switcher = h('select', { class: 'field board-switcher', 'aria-label': 'Board' });
  for (const b of boards.filter((x) => !x.archived || x.id === board?.id))
    switcher.append(h('option', { value: b.id, text: b.name, selected: b.id === board?.id }));
  switcher.append(
    h('option', {
      value: 'status',
      text: 'Status board (all tasks)',
      selected: board?.id === 'status',
    }),
    h('option', { value: '__all', text: 'All boards…' }),
    h('option', { value: '__new', text: 'New board…' }),
  );
  switcher.addEventListener('change', () => {
    if (switcher.value === '__all') setPrefs({ destination: 'boards' });
    else if (switcher.value === '__new') {
      switcher.value = board?.id || 'status';
      createBoardDialog();
    } else openBoard(switcher.value);
  });
  if (!board) {
    wrap.append(
      h('div', { class: 'bar' }, switcher),
      emptyState(
        'This board no longer exists. It may have been deleted or archived.',
        button('All boards', () => setPrefs({ destination: 'boards' })),
      ),
    );
    return wrap;
  }
  const isStatus = board.id === 'status';
  const members = filtered(S().tasks).filter((t) => (isStatus ? true : board.id in t.boards));
  const density = h('select', { class: 'field', 'aria-label': 'Card density', disabled: isStatus });
  for (const [v, t] of [
    ['comfortable', 'Comfortable cards'],
    ['compact', 'Compact cards'],
  ])
    density.append(
      h('option', { value: v, text: t, selected: (board.density || 'comfortable') === v }),
    );
  density.addEventListener('change', () =>
    post({ type: 'updateBoard', boardId: board.id, change: { density: density.value } }),
  );
  const sort = h('select', { class: 'field', 'aria-label': 'Card order', disabled: isStatus });
  for (const [v, t] of [
    ['manual', 'Manual order'],
    ['due', 'By due date'],
    ['priority', 'By priority'],
  ])
    sort.append(h('option', { value: v, text: t, selected: (board.sort || 'manual') === v }));
  sort.addEventListener('change', () =>
    post({ type: 'updateBoard', boardId: board.id, change: { sort: sort.value } }),
  );
  const swim = h('select', { class: 'field', 'aria-label': 'Swimlanes' });
  for (const [v, t] of [
    ['none', 'No swimlanes'],
    ['project', 'Lanes by project'],
    ['priority', 'Lanes by priority'],
  ])
    swim.append(h('option', { value: v, text: t, selected: P().swimlane === v }));
  swim.addEventListener('change', () => setPrefs({ swimlane: swim.value as never }));
  const filter = h('input', {
    class: 'field',
    type: 'search',
    placeholder: 'Filter cards',
    'aria-label': 'Filter cards',
    value: ui.filter?.text || '',
  });
  filter.addEventListener('input', () => {
    (ui.filter ||= {}).text = filter.value || undefined;
    render();
  });
  const addColumn = button(
    'Column',
    () => {
      const name = h('input', {
        class: 'field',
        type: 'text',
        placeholder: 'Review',
        required: true,
      });
      const done = h('input', { type: 'checkbox' });
      dialog(
        'Add column',
        [
          field('Title', name),
          h('label', { class: 'check' }, done, ' Cards in this column are completed'),
        ],
        'Add column',
        () => {
          if (!name.value.trim()) return false;
          post({
            type: 'addColumn',
            boardId: board.id,
            title: name.value,
            completed: done.checked,
          });
        },
      );
    },
    'btn',
    'plus',
    { title: 'Add a column' },
  );
  if (isStatus) addColumn.setAttribute('disabled', '');
  const menu = iconButton('more', 'Board actions', (e) =>
    menuAt(e, boardMenu(board), 'Board actions'),
  );
  wrap.append(
    h(
      'div',
      { class: 'board-head', style: `--c:var(--bc-${board.color || 'gray'})` },
      h('span', { class: 'board-icon' }, svg(iconOf(board.icon), 16)),
      switcher,
      h('span', {
        class: 'board-meta',
        text: isStatus
          ? 'Every task of the wiki by status'
          : `${board.description ? `${board.description} · ` : ''}${board.pagePath}`,
      }),
      h('span', { class: 'spacer' }),
      filter,
      swim,
      density,
      sort,
      addColumn,
      menu,
    ),
  );
  if (board.archived)
    wrap.append(
      h(
        'p',
        { class: 'notice', text: 'This board is archived. ' },
        button(
          'Restore',
          () => post({ type: 'updateBoard', boardId: board.id, change: { archived: false } }),
          'btn ghost',
        ),
      ),
    );
  const lanes =
    P().swimlane === 'none'
      ? [['', members] as const]
      : [
          ...new Set(
            members.map((t) =>
              P().swimlane === 'project' ? t.project || 'No project' : t.priority || 'No priority',
            ),
          ),
        ]
          .sort()
          .map(
            (lane) =>
              [
                lane,
                members.filter(
                  (t) =>
                    (P().swimlane === 'project'
                      ? t.project || 'No project'
                      : t.priority || 'No priority') === lane,
                ),
              ] as const,
          );
  for (const [lane, laneTasks] of lanes) {
    if (lane) wrap.append(h('div', { class: 'lane-title', text: lane }));
    const grid = h('div', {
      class: 'board',
      'aria-label': lane ? `${board.name}, ${lane}` : board.name,
    });
    for (const col of board.columns)
      grid.append(
        column(
          board,
          col,
          sortCards(
            board,
            laneTasks.filter((t) => columnOfTask(t, board) === col.id),
          ),
          lane,
        ),
      );
    wrap.append(grid);
  }
  if (!members.length && !ui.filter?.text)
    wrap.append(
      h('p', {
        class: 'board-hint',
        text: isStatus
          ? 'No tasks yet. Add a card in any column.'
          : 'Your board is ready. Create your first task in a column, or add tasks from any page with “Add to board”.',
      }),
    );
  return wrap;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Board,
  boardFileName,
  boardTemplates,
  checkBoard,
  columnId,
  columnOf,
  isMember,
  moveChange,
  newBoardText,
  parseBoard,
  statusBoard,
  writeBoardConfig,
} from '../../core/boards';
import { parseTasks, updateTaskLine } from '../../core/tasks';

const config = {
  id: 'board-dev',
  name: 'Development',
  columns: boardTemplates[1].columns.map((c) => ({ ...c })),
  defaultColumn: 'backlog',
};

test('board files round-trip and keep other front matter and the body', () => {
  const text = newBoardText(config);
  assert.match(text, /^---\nwiki_studio:\n {2}type: board\n {2}id: board-dev\n/);
  assert.deepEqual(parseBoard(text), config);
  const edited = `---\ntitle: Dev work # keep this comment\ntags: [team]\n${text.slice(4)}\nNotes stay.\n`;
  const renamed = writeBoardConfig(edited, {
    ...config,
    name: 'Dev',
    columns: [...config.columns].reverse(),
  });
  assert.match(renamed, /title: Dev work # keep this comment/);
  assert.match(renamed, /tags: \[team\]/);
  assert.match(renamed, /\nNotes stay\.\n$/);
  assert.equal(parseBoard(renamed)!.name, 'Dev');
  assert.equal(parseBoard(renamed)!.columns[0].id, 'released');
  assert.equal(parseBoard('# Not a board\n'), undefined);
  assert.equal(parseBoard('---\nwiki_studio:\n  type: note\n---\n'), undefined);
  // CRLF files stay CRLF.
  assert.match(writeBoardConfig(text.replace(/\n/g, '\r\n'), config), /^---\r\nwiki_studio:\r\n/);
});

test('invalid configurations are refused; bad files fall back safely', () => {
  assert.throws(() => checkBoard({ ...config, columns: [] }), /at least one column/);
  assert.throws(() => checkBoard({ ...config, defaultColumn: 'nope' }), /default column/);
  assert.throws(
    () => checkBoard({ ...config, columns: [config.columns[0], { ...config.columns[0] }] }),
    /used twice/,
  );
  const loose = parseBoard(
    '---\nwiki_studio:\n  type: board\n  id: b1\n  columns:\n    - {id: a, title: A, color: neon}\n    - {id: a, title: Again}\n    - {title: no id}\n---\n',
  )!;
  assert.deepEqual(
    loose.columns,
    [{ id: 'a', title: 'A' }],
    'unknown colors and duplicate or missing ids are dropped',
  );
  assert.equal(loose.defaultColumn, 'a');
});

test('names, file names and column ids', () => {
  assert.equal(boardFileName('NoteSpace Development'), 'boards/notespace-development.md');
  assert.equal(boardFileName('Café & Co.', 'plans/'), 'plans/cafe-co.md');
  assert.equal(boardFileName('!!!'), 'boards/board.md');
  assert.equal(columnId('In review', ['todo']), 'in-review');
  assert.equal(columnId('To do', ['todo']), 'to-do');
  assert.equal(columnId('Todo', ['todo', 'todo-2']), 'todo-3');
});

test('membership, columns and moves use stable ids', () => {
  const page = (path: string, text: string) => ({ id: `r\0${path}`, path, title: path, text });
  const boardPage = page(
    'boards/dev.md',
    `${newBoardText(config)}- [ ] In file\n- [ ] Started col:developing\n- [x] Shipped\n- [ ] Stale col:released\n- [x] Checked but open col:testing\n- [ ] Doing status:doing\n`,
  );
  const note = page(
    'notes/ideas.md',
    '- [ ] Linked from a note board:board-dev col:planned\n- [ ] Other board board:board-x\n- [ ] Plain note task\n',
  );
  const board: Board = { ...config, pageId: boardPage.id, pagePath: boardPage.path, root: 'r' };
  const tasks = [...parseTasks(boardPage), ...parseTasks(note)];
  const members = tasks.filter((t) => isMember(t, board));
  assert.deepEqual(
    members.map((t) => t.title),
    ['In file', 'Started', 'Shipped', 'Stale', 'Checked but open', 'Doing', 'Linked from a note'],
  );
  assert.deepEqual(
    members.map((t) => columnOf(t, board)),
    ['backlog', 'developing', 'released', 'backlog', 'released', 'developing', 'planned'],
  );
  const line = '- [ ] Ship it due:2026-10-20 #release ^t-abc123';
  const done = updateTaskLine(line, moveChange(board, 'released'));
  assert.equal(done, '- [x] Ship it due:2026-10-20 #release col:released ^t-abc123');
  const back = updateTaskLine(done, moveChange(board, 'testing'));
  assert.equal(back, '- [ ] Ship it due:2026-10-20 #release col:testing ^t-abc123');
  assert.equal(
    updateTaskLine(back, { board: 'board-x' }),
    '- [ ] Ship it due:2026-10-20 #release col:testing board:board-x ^t-abc123',
  );
  assert.equal(
    updateTaskLine(back, { column: null }),
    '- [ ] Ship it due:2026-10-20 #release ^t-abc123',
  );
  assert.throws(() => updateTaskLine(line, { column: 'bad id!' }), /not a valid/);
  assert.throws(() => moveChange(board, 'gone'), /no longer/);
  // Tokens do not leak into titles.
  assert.equal(parseTasks(page('x.md', '- [ ] Title board:b col:c'))[0].title, 'Title');
  // The status board keeps the legacy behaviour.
  assert.deepEqual(
    statusBoard().columns.map((c) => c.id),
    ['todo', 'doing', 'blocked', 'done'],
  );
});

test('subtasks are the checklist of their parent, not cards of their own', async () => {
  const { subtaskKeys } = await import('../../core/boards');
  const page = {
    id: 'r\0p.md',
    path: 'p.md',
    title: 'P',
    text: '- [ ] Parent\n  Notes.\n  - [x] Child one\n  - [ ] Child two\n    - [ ] Grandchild\n- [ ] Sibling\n  - [ ] Linked child board:b1\n',
  };
  const tasks = parseTasks(page);
  const keys = subtaskKeys(tasks);
  assert.deepEqual(
    tasks.filter((t) => keys.has(t.key)).map((t) => t.title),
    ['Child one', 'Child two', 'Grandchild', 'Linked child'],
  );
});

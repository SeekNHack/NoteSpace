import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  completeTaskLine,
  inList,
  journalStreak,
  matchesFilter,
  newTaskLine,
  nextOccurrence,
  parseTasks,
  startOfWeek,
  todayIn,
  updateTaskLine,
} from '../../core/tasks';

const page = (text: string, path = 'notes/plan.md') => ({
  id: `w\0${path}`,
  path,
  title: 'Plan',
  text,
});

test('task lines parse metadata without losing the readable title', () => {
  const [task] = parseTasks(
    page(
      '- [ ] Write the [[Guide]] notes due:2026-10-20 priority:high status:doing #docs @alice project:Launch_Plan ^t-ab12cd\n  Explain the API.\n  Keep it short.',
    ),
  );
  assert.equal(task.title, 'Write the [[Guide]] notes #docs');
  assert.equal(task.status, 'doing');
  assert.equal(task.priority, 'high');
  assert.equal(task.due, '2026-10-20');
  assert.equal(task.assignee, 'alice');
  assert.equal(task.project, 'Launch Plan');
  assert.equal(task.id, 't-ab12cd');
  assert.deepEqual(task.tags, ['docs']);
  assert.deepEqual(task.links, ['Guide']);
  assert.equal(task.description, 'Explain the API.\nKeep it short.');
  assert.equal(task.key, 'w\0notes/plan.md#t-ab12cd');
});

test('fences, frontmatter and invalid metadata are ignored; checked items are done', () => {
  const tasks = parseTasks(
    page(
      '---\ntitle: X\n---\n```md\n- [ ] not a task\n```\n- [x] Done thing status:doing\n- [ ] Bad due:tomorrow priority:urgent',
    ),
  );
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].status, 'done');
  assert.equal(tasks[0].line, 6);
  assert.equal(tasks[1].due, undefined);
  assert.equal(tasks[1].priority, undefined);
});

test('updates touch only the affected tokens and keep the block id last', () => {
  const line = '  - [ ] Ship #release see [[Plan]] due:2026-10-20 ^t-1';
  assert.equal(
    updateTaskLine(line, { due: '2026-10-22' }),
    '  - [ ] Ship #release see [[Plan]] due:2026-10-22 ^t-1',
  );
  assert.equal(
    updateTaskLine(line, { status: 'doing' }),
    '  - [ ] Ship #release see [[Plan]] due:2026-10-20 status:doing ^t-1',
  );
  assert.equal(
    updateTaskLine(line, { status: 'done' }),
    '  - [x] Ship #release see [[Plan]] due:2026-10-20 ^t-1',
  );
  assert.equal(
    updateTaskLine(line, { due: null, priority: 'low' }),
    '  - [ ] Ship #release see [[Plan]] priority:low ^t-1',
  );
  assert.equal(updateTaskLine(line, { title: 'Ship it' }), '  - [ ] Ship it due:2026-10-20 ^t-1');
  assert.equal(updateTaskLine('- [ ] A', { id: 't-x' }), '- [ ] A ^t-x');
  assert.equal(
    newTaskLine('Call Bob', { due: '2026-10-21', assignee: 'Bob Smith' }),
    '- [ ] Call Bob due:2026-10-21 @Bob-Smith',
  );
  assert.throws(() => updateTaskLine('plain text', { due: '2026-10-21' }));
});

test('today follows the configured time zone across the day boundary', () => {
  const instant = new Date('2026-10-14T23:30:00Z');
  assert.equal(todayIn('UTC', instant), '2026-10-14');
  assert.equal(todayIn('Europe/Rome', instant), '2026-10-15');
  assert.equal(todayIn('America/Los_Angeles', instant), '2026-10-14');
  // DST transitions do not skip or repeat calendar days.
  assert.equal(todayIn('Europe/Rome', new Date('2026-10-25T00:30:00Z')), '2026-10-25');
});

test('recurrence computes the next occurrence, clamping month ends', () => {
  assert.equal(nextOccurrence('2026-10-14', 'daily'), '2026-10-15');
  assert.equal(nextOccurrence('2026-10-16', 'weekdays'), '2026-10-19');
  assert.equal(nextOccurrence('2026-10-14', 'weekly'), '2026-10-21');
  assert.equal(nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextOccurrence('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(nextOccurrence('2026-10-14T09:00', 'every-2-weeks'), '2026-10-28T09:00');
  assert.equal(nextOccurrence('2026-10-14', 'sometimes'), undefined);
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(startOfWeek('2026-10-14'), '2026-10-12');
});

test('completing a recurring task keeps history and creates the next occurrence', () => {
  const result = completeTaskLine(
    '- [ ] Water plants due:2026-10-14 start:2026-10-13 repeat:weekly ^t-aaaaaa',
    '2026-10-15',
  );
  assert.equal(
    result.line,
    '- [x] Water plants due:2026-10-14 start:2026-10-13 repeat:weekly done:2026-10-15 ^t-aaaaaa',
  );
  assert.match(
    result.next!,
    /^- \[ \] Water plants due:2026-10-21 start:2026-10-20 repeat:weekly \^t-[a-z0-9]{6}$/,
  );
  assert.doesNotMatch(result.next!, /t-aaaaaa/);
  assert.deepEqual(completeTaskLine('- [ ] Once', '2026-10-15'), {
    line: '- [x] Once done:2026-10-15',
  });
});

test('planner lists and filters share one task set', () => {
  const tasks = parseTasks(
    page(
      [
        '- [ ] Inbox item',
        '- [ ] Late due:2026-10-10',
        '- [ ] Now due:2026-10-14 #ops',
        '- [ ] Soon due:2026-10-20 @bo',
        '- [ ] Started start:2026-10-12 due:2026-10-16',
        '- [x] Finished due:2026-10-01',
        '- [ ] Far due:2027-01-01',
        '- [ ] In a project project:Launch',
      ].join('\n'),
    ),
  );
  const titles = (list: Parameters<typeof inList>[1]) =>
    tasks.filter((t) => inList(t, list, '2026-10-14')).map((t) => t.title);
  assert.deepEqual(titles('inbox'), ['Inbox item']);
  assert.deepEqual(titles('overdue'), ['Late']);
  assert.deepEqual(titles('today'), ['Late', 'Now #ops', 'Started']);
  assert.deepEqual(titles('upcoming'), ['Soon', 'Started']);
  assert.deepEqual(titles('completed'), ['Finished']);
  assert.deepEqual(
    tasks.filter((t) => matchesFilter(t, { tag: '#ops' })).map((t) => t.title),
    ['Now #ops'],
  );
  assert.deepEqual(
    tasks.filter((t) => matchesFilter(t, { assignee: '@bo', status: 'open' })).map((t) => t.title),
    ['Soon'],
  );
  const journal = parseTasks(page('- [ ] Journal item', 'daily/2026-10-14.md'));
  assert.equal(journal[0].journal, '2026-10-14');
  assert.equal(inList(journal[0], 'today', '2026-10-14'), true);
});

test('journal streak counts consecutive daily notes', () => {
  assert.equal(journalStreak(['2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-14'), 3);
  assert.equal(journalStreak(['2026-10-12', '2026-10-13'], '2026-10-14'), 2);
  assert.equal(journalStreak(['2026-10-10'], '2026-10-14'), 0);
});

test('quick add resolves relative dates and keeps other words', async () => {
  const { quickAddLine, resolveDate } = await import('../../core/tasks');
  // 2026-10-14 is a Wednesday.
  assert.equal(resolveDate('tomorrow', '2026-10-14'), '2026-10-15');
  assert.equal(resolveDate('+2w', '2026-10-14'), '2026-10-28');
  assert.equal(resolveDate('fri', '2026-10-14'), '2026-10-16');
  assert.equal(resolveDate('wednesday', '2026-10-14'), '2026-10-21');
  assert.equal(resolveDate('soon', '2026-10-14'), undefined);
  assert.equal(
    quickAddLine('Call Bob due:tomorrow #sales', '2026-10-14'),
    '- [ ] Call Bob due:2026-10-15 #sales',
  );
  assert.equal(quickAddLine('Plan due:someday', '2026-10-14'), '- [ ] Plan due:someday');
});

test('parsing 1,000 pages with 5 tasks each stays fast', () => {
  const body = Array.from(
    { length: 5 },
    (_, i) => `- [ ] Task ${i} due:2026-10-${10 + i} priority:high #tag @me ^t-${i}`,
  ).join('\n');
  const start = performance.now();
  let count = 0;
  for (let i = 0; i < 1000; i++)
    count += parseTasks(page(`# Page ${i}\n\nText.\n\n${body}\n`, `p/${i}.md`)).length;
  const elapsed = performance.now() - start;
  assert.equal(count, 5000);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)} ms`);
});

test('boards embedded in pages are draggable only when rendered interactively', async () => {
  const { renderCollection } = await import('../../core/collections');
  const p = page('- [ ] Draft <spec> status:doing\n- [x] Ship it done:2026-10-01\n');
  const ctx = {
    tasks: parseTasks(p),
    pages: [],
    page: p as never,
    today: '2026-10-16',
    pageHref: () => '#',
    showTasks: true,
  };
  const still = renderCollection('tasks', 'page: this\nview: board', ctx);
  assert.doesNotMatch(still, /draggable|data-task/);
  const live = renderCollection('tasks', 'page: this\nview: board', { ...ctx, interactive: true });
  const cards = [
    ...live.matchAll(/<section class="collection-column" data-status="(\w+)"[\s\S]*?<\/section>/g),
  ].map((m) => [m[1], (m[0].match(/draggable="true"/g) || []).length]);
  assert.deepEqual(cards, [
    ['todo', 0],
    ['doing', 1],
    ['blocked', 0],
    ['done', 1],
  ]);
  assert.match(live, /data-title="Draft &lt;spec&gt;"/, 'titles are escaped');
  assert.match(live, /aria-keyshortcuts="Alt\+ArrowLeft Alt\+ArrowRight"/);
  assert.match(live, /role="status"/);
  assert.equal((live.match(/data-task="/g) || []).length, 2);
});

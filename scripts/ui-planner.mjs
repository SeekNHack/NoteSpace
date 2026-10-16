// Phase 03 browser journey: planner views, board, calendar, daily notes and task embeds.
// Every assertion about data checks the Markdown files on disk.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const day = (offset) => {
  const t = new Date(Date.now() + offset * 86400000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const today = day(0);
const launch = `# Launch

- [ ] Write release notes due:${today} priority:high #docs @alice project:Launch
- [ ] Record the demo video due:${day(2)} status:doing project:Launch
- [ ] Fix flaky test due:${day(-2)} priority:medium #ci project:Launch
- [ ] Weekly sync due:${today} repeat:weekly ^t-sync01

\`\`\`tasks
project: Launch
view: list
\`\`\`
`;
const files = {
  'wiki/Home.md': '# Home\n\n[[Launch]]\n',
  'wiki/Launch.md': launch,
  'wiki/Inbox.md': '# Inbox\n\n- [ ] Read the docs\n',
  [`wiki/daily/${day(-1)}.md`]: `# ${day(-1)}\n\nYesterday.\n`,
};

async function axe(frame, label) {
  await frame.evaluate(axeSource);
  const violations = await frame.evaluate(async () =>
    // eslint-disable-next-line no-undef
    (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
  );
  for (const v of violations) console.log(`  ${v.impact} ${v.id} ${v.nodes.join(' | ')}`);
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(
    `axe ${label}: ${violations.length} violation type(s), ${serious.length} serious/critical`,
  );
  assert.deepEqual(serious, [], `accessibility violations in ${label}`);
}

const { page, close, workspace } = await launchCodeServer({
  files,
  settings: { 'files.autoSave': 'off' },
});
const file = (name) => readFile(path.join(workspace, 'wiki', name), 'utf8');
const lineOf = async (name, needle) =>
  (await file(name)).split('\n').find((l) => l.includes(needle));
const plannerFrame = () => frameWith(page, '.nav', 'workspace panel');
try {
  await runCommand(page, 'NoteSpace: Refresh Index');
  await runCommand(page, 'NoteSpace: Open Planner');
  let planner = await plannerFrame();
  await poll(async () => (await planner.locator('.row').count()) >= 3, 'today list');
  assert.deepEqual(
    await planner
      .locator('.group h2')
      .allInnerTexts()
      .then((t) => t.map((x) => x.split('\n')[0])),
    ['OVERDUE', 'DUE TODAY'],
  );
  await axe(planner, 'planner today');

  // Quick add resolves relative dates and appends to the inbox page.
  await planner.locator('#quick-add').fill('Call Bob due:tomorrow #sales');
  await planner.locator('#quick-add').press('Enter');
  await poll(
    async () =>
      (await file('Inbox.md')) ===
      `# Inbox\n\n- [ ] Read the docs\n- [ ] Call Bob due:${day(1)} #sales\n`,
    'quick add written',
  );
  console.log('PASS planner: quick add writes a readable task line to the inbox page');

  // Completing a task from the list.
  await planner.locator('.row', { hasText: 'Write release notes' }).getByRole('checkbox').click();
  await poll(
    async () =>
      (await lineOf('Launch.md', 'Write release notes')).startsWith(
        `- [x] Write release notes due:${today} priority:high #docs @alice project:Launch done:${today}`,
      ),
    'completion written',
  );
  // Completing a recurring task keeps history and adds the next occurrence.
  await planner.locator('.row', { hasText: 'Weekly sync' }).getByRole('checkbox').click();
  await poll(async () => {
    const text = await file('Launch.md');
    return (
      text.includes(`- [x] Weekly sync due:${today} repeat:weekly done:${today} ^t-sync01`) &&
      new RegExp(`- \\[ \\] Weekly sync due:${day(7)} repeat:weekly \\^t-[a-z0-9]{6}`).test(text)
    );
  }, 'recurring completion');
  console.log('PASS planner: completion and recurrence persist with history');

  // Detail editor.
  // Clicking a title edits it inline; Enter (or a click beside it) opens the details.
  await planner.locator('.row', { hasText: 'Fix flaky test' }).press('Enter');
  await planner.locator('#f-priority').selectOption('low');
  await poll(
    async () => (await lineOf('Launch.md', 'Fix flaky test')).includes('priority:low'),
    'detail edit',
  );
  await planner.locator('.layout').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await poll(
    async () => (await planner.locator('.detail').count()) === 0,
    'details closed with Escape',
  );

  // Board: drag between columns and keyboard moves.
  await runCommand(page, 'NoteSpace: Open Kanban Board');
  planner = await plannerFrame();
  await planner.locator('.board-switcher').selectOption('status');
  const card = planner.locator('.card', { hasText: 'Record the demo video' });
  await card.dragTo(planner.locator('.column[data-column="blocked"]'));
  await poll(
    async () => (await lineOf('Launch.md', 'Record the demo video')).includes('status:blocked'),
    'drag to Blocked',
  );
  await planner.locator('.card', { hasText: 'Fix flaky test' }).focus();
  await planner.locator('.card', { hasText: 'Fix flaky test' }).press('Alt+ArrowRight');
  await poll(
    async () => (await lineOf('Launch.md', 'Fix flaky test')).includes('status:doing'),
    'keyboard move',
  );
  await poll(
    async () =>
      (await planner
        .locator('.column[data-column="doing"] .card', { hasText: 'Fix flaky test' })
        .count()) === 1,
    'board updates',
  );
  await axe(planner, 'planner board');
  console.log('PASS planner: board drag and keyboard moves change status in the page');

  // Calendar: month grid, keyboard navigation, drag to reschedule.
  await planner.locator('.nav [data-nav=calendar]').click();
  await planner.locator(`.day[data-date="${today}"]`).waitFor();
  assert.equal(
    await planner.locator(`.day[data-date="${day(-1)}"] .note`).count(),
    1,
    'daily note dot',
  );
  const target = day(3);
  await planner.locator(`.day[data-date="${today}"]`).focus();
  await planner.locator(`.day[data-date="${today}"]`).press('ArrowRight');
  assert.equal(
    await planner.evaluate(() => document.activeElement?.getAttribute('data-date')),
    day(1),
  );
  // Let refreshes from the keyboard navigation settle before dragging.
  await page.waitForTimeout(600);
  await planner
    .locator('.day .item', { hasText: 'Call Bob' })
    .dragTo(planner.locator(`.day[data-date="${target}"]`));
  await poll(
    async () => (await lineOf('Inbox.md', 'Call Bob')) === `- [ ] Call Bob due:${target} #sales`,
    'calendar reschedule',
  );
  await planner.getByRole('button', { name: 'Week', exact: true }).click();
  await planner.locator('.week .col').first().waitFor();
  await axe(planner, 'planner calendar');
  console.log('PASS planner: calendar shows notes, navigates by keyboard and reschedules by drag');

  // External edits appear in every view.
  await writeFile(
    path.join(workspace, 'wiki/Launch.md'),
    (await file('Launch.md')) + `\n- [ ] Added outside due:${today}\n`,
  );
  await planner.locator('.nav [data-nav=tasks]').click();
  await planner.locator('#list-today').click();
  await poll(
    async () => (await planner.locator('.row', { hasText: 'Added outside' }).count()) === 1,
    'external edit',
  );
  console.log('PASS planner: external file edits refresh the planner');

  // View preference survives closing the panel.
  await planner.locator('#list-all').click();
  await planner.getByRole('button', { name: 'Table', exact: true }).click();
  await page.waitForTimeout(400);
  await runCommand(page, 'View: Close All Editors');
  await runCommand(page, 'NoteSpace: Open Planner');
  planner = await plannerFrame();
  await poll(
    async () =>
      (await planner
        .getByRole('button', { name: 'Table', exact: true })
        .getAttribute('aria-pressed')) === 'true',
    'view persisted',
  );
  assert.ok((await planner.locator('tbody tr').count()) >= 5);

  // Daily notes: today's note from the planner, previous note command.
  await planner.locator('.nav [data-nav=home]').click();
  await planner
    .getByRole('button', { name: /today's note/i })
    .first()
    .click();
  await poll(
    async () => (await file(`daily/${today}.md`)).startsWith(`# ${today}`),
    "today's note created",
  );
  await poll(
    async () => (await page.locator('.tab.active', { hasText: `${today}.md` }).count()) > 0,
    "today's note opens",
  );
  await runCommand(page, 'NoteSpace: Previous Daily Note');
  await poll(
    async () => (await page.locator('.tab.active', { hasText: `${day(-1)}.md` }).count()) > 0,
    'previous note',
  );
  console.log('PASS planner: daily notes open from the planner and navigate by date');

  // Studio shows task metadata as chips; the reader renders the task embed.
  await runCommand(page, 'NoteSpace: Search Pages');
  await page.locator('.quick-input-widget input[type=text]').fill('Launch');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Launch.md' })
    .first()
    .click();
  const studio = await frameWith(page, '.ProseMirror .task-token', 'studio task chips');
  assert.ok((await studio.locator('.task-token.task-due').count()) >= 3);
  // `status: open` is the default: the two open Launch tasks, not the completed one.
  await poll(
    async () => (await studio.locator('.code-view .collection li').count()) === 2,
    'collection preview in Studio',
  );
  assert.match(
    await studio.locator('.code-view .collection').innerText(),
    /Record the demo video[\s\S]*Fix flaky test|Fix flaky test[\s\S]*Record the demo video/,
  );
  await runCommand(page, 'NoteSpace: Open Reader Preview');
  const reader = await frameWith(page, '.reader-layout .collection', 'reader collection');
  assert.match(await reader.locator('.collection').innerText(), /Fix flaky test/);
  // Search surfaces tasks.
  await runCommand(page, 'NoteSpace: Search Pages');
  await page.locator('.quick-input-widget input[type=text]').fill('Call Bob');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Call Bob' })
    .first()
    .waitFor();
  await page.keyboard.press('Escape');
  // Dashboard Today section.
  // Home Today section.
  await runCommand(page, 'NoteSpace: Open Home');
  const dash = await frameWith(page, '.home-grid', 'home today');
  assert.match(
    await dash.locator('.home-card', { hasText: 'Today' }).first().innerText(),
    /Added outside/,
  );
  console.log('PASS planner: Studio chips, task embeds, search and Home share the same tasks');
  console.log('NoteSpace planner journey passed on code-server.');
} catch (error) {
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/failure-planner.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

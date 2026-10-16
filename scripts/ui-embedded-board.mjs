// Boards embedded in pages (```tasks view: board) on code-server: drag a card and move one with
// Alt+arrows in the reader and in Studio; the task lines in the page change, nothing else does.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/embedded-board';
await mkdir(shots, { recursive: true });

const page = `# Launch\n\n- [ ] Write announcement\n- [ ] Book venue status:doing\n- [ ] Order badges\n\n\`\`\`tasks\npage: this\nview: board\n\`\`\`\n\nNotes stay as they are.\n`;
const files = {
  'docs/wiki.yaml': 'schemaVersion: 1\nwiki:\n  title: Team Wiki\ncontent:\n  root: pages\n',
  'docs/pages/index.md': page,
};
const {
  page: ui,
  close,
  workspace,
} = await launchCodeServer({ files, settings: { 'files.autoSave': 'off' } });
const file = () => readFile(path.join(workspace, 'docs/pages/index.md'), 'utf8');
const column = (f, status) =>
  f.locator(`.collection-board.interactive .collection-column[data-status="${status}"]`);
const cardIn = (f, status, title) =>
  column(f, status).locator('.collection-card', { hasText: title });

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

try {
  // 1. Reader: drag "Write announcement" from To do to In progress.
  await ui.locator('.explorer-folders-view .monaco-list-row[aria-label="docs"]').click();
  await ui.locator('.explorer-folders-view .monaco-list-row[aria-label="pages"]').click();
  await ui.locator('.explorer-folders-view .monaco-list-row[aria-label="index.md"]').click();
  await poll(
    async () => (await ui.locator('.tab.active', { hasText: 'index.md' }).count()) > 0,
    'page open',
  );
  await runCommand(ui, 'NoteSpace: Open Reader Preview');
  let reader = await frameWith(ui, '.collection-board.interactive', 'reader board');
  await cardIn(reader, 'todo', 'Write announcement').dragTo(column(reader, 'doing'));
  await poll(
    async () => /^- \[ \] Write announcement status:doing$/m.test(await file()),
    'drag writes the status',
  );
  await poll(
    async () => (await cardIn(reader, 'doing', 'Write announcement').count()) === 1,
    'card in In progress',
  );
  console.log('PASS board: dragging a card in the reader changes the task status in the page');

  // 2. Reader keyboard: Alt+→ moves the focused card, focus survives the refresh.
  // Saving re-renders the page (sometimes twice); start from the settled page.
  await ui.waitForTimeout(1500);
  reader = await frameWith(ui, '.collection-board.interactive', 'reader board');
  await cardIn(reader, 'todo', 'Order badges').focus();
  await ui.keyboard.press('Alt+ArrowRight');
  await poll(
    async () => /^- \[ \] Order badges status:doing$/m.test(await file()),
    'keyboard move',
  );
  // The page is rendered again after the edit; focus comes back to the moved card.
  const focused = async (status) => {
    reader = await frameWith(ui, '.collection-board.interactive', 'reader board');
    return reader.evaluate(
      (s) =>
        document.activeElement?.dataset?.title === 'Order badges' &&
        document.activeElement.closest('.collection-column')?.dataset.status === s,
      status,
    );
  };
  await poll(() => focused('doing'), 'focus kept on the moved card');
  // Saving can render the page a second time; focus follows the card through it.
  await ui.waitForTimeout(1200);
  await poll(() => focused('doing'), 'focus still on the moved card');
  await ui.keyboard.press('Alt+ArrowRight');
  await poll(
    async () => /^- \[ \] Order badges status:blocked$/m.test(await file()),
    'second keyboard move',
  );
  await poll(() => focused('blocked'), 'focus kept after the second move');
  await ui.waitForTimeout(1200);
  await poll(() => focused('blocked'), 'focus still on the card after the second move');
  await ui.keyboard.press('Alt+ArrowRight');
  await poll(
    async () => /^- \[x\] Order badges done:\d{4}-\d{2}-\d{2}$/m.test(await file()),
    'moved to Done',
  );
  await ui.screenshot({ path: `${shots}/reader.png` });
  await axe(reader, 'reader board');
  console.log('PASS board: Alt+arrows move the focused card and keep focus on it');

  // 3. Studio: dragging works inside the editor too and only task lines change.
  await runCommand(ui, 'View: Close All Editors');
  await ui.locator('.explorer-folders-view .monaco-list-row[aria-label="index.md"]').click();
  await runCommand(ui, 'NoteSpace: Open in Studio');
  const studio = await frameWith(ui, '.collection-board.interactive', 'studio board');
  await cardIn(studio, 'done', 'Order badges').dragTo(column(studio, 'todo'));
  await poll(
    async () => /^- \[ \] Order badges$/m.test(await file()),
    'Studio drag writes the status',
  );
  const text = await file();
  assert.equal(
    text.replace(/^- \[[ x]\] .*$/gm, '- task'),
    page.replace(/^- \[[ x]\] .*$/gm, '- task'),
    'only task lines change',
  );
  await poll(
    async () => (await cardIn(studio, 'todo', 'Order badges').count()) === 1,
    'Studio card in To do',
  );
  await ui.screenshot({ path: `${shots}/studio.png` });
  console.log('PASS board: dragging a card in Studio changes only the task line');
  console.log('NoteSpace embedded board journey passed on code-server.');
} catch (error) {
  await ui.screenshot({ path: 'docs/screenshots/failure-embedded-board.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

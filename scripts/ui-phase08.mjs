// Phase 08 browser journey (workspace navigation): readable labels, index first, folder order,
// .gitignore, following the active editor, and where pages open — checked in the real UI.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, poll, frameWith } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/phase08';
await mkdir(shots, { recursive: true });

const files = {
  'wiki/index.md': '# Home\n',
  'wiki/guides/README.md': 'Guides overview.\n',
  'wiki/guides/getting-started.md': 'Start here.\n',
  'wiki/guides/api_reference.md': 'Reference.\n',
  'wiki/guides/advanced/deep-dive.md': '# Deep Dive\n',
  'wiki/guides/drafts/secret-plan.md': '# Secret plan\n',
  '.gitignore': 'wiki/guides/drafts/\n',
};

const { page, close, workspace } = await launchCodeServer({
  files,
  settings: { 'files.autoSave': 'off' },
});
const settingsFile = path.join(workspace, '.vscode/settings.json');
const setSettings = async (values) => {
  await mkdir(path.dirname(settingsFile), { recursive: true });
  await writeFile(settingsFile, JSON.stringify(values, null, 2));
};
const pages = page
  .locator('.pane', { has: page.locator('.pane-header', { hasText: 'Pages' }) })
  .first();
const rows = () => pages.locator('.monaco-list-row').allInnerTexts();
try {
  await page.locator('.activitybar [aria-label*="NoteSpace"]').first().click();
  await pages.locator('.monaco-list-row', { hasText: 'Guides' }).waitFor();
  await pages.locator('.monaco-list-row', { hasText: 'Guides' }).click();
  await poll(
    async () => (await rows()).some((r) => r.includes('Getting Started')),
    'guides expanded',
  );
  // Readable names; README first; folders before pages; ignored drafts listed (the setting is off).
  let labels = (await rows()).map((r) => r.trim());
  let guides = labels.slice(labels.indexOf('Guides') + 1);
  assert.deepEqual(guides.slice(0, 5), [
    'README',
    'Advanced',
    'Drafts',
    'API Reference',
    'Getting Started',
  ]);
  console.log('PASS phase08: readable names, README first and folders first');

  // Follow .gitignore and list pages first.
  await setSettings({
    'wikiStudio.respectGitignore': true,
    'wikiStudio.explorer.directorySort': 'files-first',
  });
  await poll(
    async () => !(await rows()).some((r) => r.includes('Drafts')),
    'ignored folder hidden',
    20000,
  );
  labels = (await rows()).map((r) => r.trim());
  guides = labels.slice(labels.indexOf('Guides') + 1);
  assert.deepEqual(guides.slice(0, 4), ['README', 'API Reference', 'Getting Started', 'Advanced']);
  // The workspace Insights numbers follow the same index.
  await runCommand(page, 'NoteSpace: Open Insights');
  const ws = await frameWith(page, '.nav', 'workspace panel');
  await poll(
    async () =>
      (await ws
        .locator('.tile', { hasText: /^\d+\s*Pages$/ })
        .locator('strong')
        .innerText()
        .catch(() => '')) === '5',
    'insights page count',
  );
  await page.screenshot({ path: `${shots}/pages-view.png` });
  console.log('PASS phase08: .gitignore and directory order apply without reloading');

  // The Pages view follows the active editor.
  await runCommand(page, 'Go to File...');
  await page.keyboard.type('deep-dive.md');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await poll(
    async () =>
      /Deep Dive/.test(
        await pages
          .locator('.monaco-list-row.selected')
          .innerText()
          .catch(() => ''),
      ),
    'active page revealed',
  );
  // Turned off, the selection stays where it was.
  await setSettings({
    'wikiStudio.respectGitignore': true,
    'wikiStudio.explorer.autoReveal': false,
  });
  await page.waitForTimeout(1500);
  await runCommand(page, 'Go to File...');
  await page.keyboard.type('index.md');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  assert.match(await pages.locator('.monaco-list-row.selected').innerText(), /Deep Dive/);
  console.log('PASS phase08: the Pages view follows the active page unless autoReveal is off');

  // Where pages open from the Pages view.
  await setSettings({ 'wikiStudio.openPagesIn': 'code' });
  await page.waitForTimeout(1500);
  await runCommand(page, 'View: Close All Editors');
  await pages.locator('.monaco-list-row', { hasText: 'Getting Started' }).click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: 'getting-started.md' }).count()) > 0,
    'opened',
  );
  await poll(
    async () => (await page.locator('.monaco-editor .view-lines').count()) > 0,
    'text editor',
  );
  await setSettings({ 'wikiStudio.openPagesIn': 'preview' });
  await page.waitForTimeout(1500);
  await pages.locator('.monaco-list-row', { hasText: 'API Reference' }).click();
  await poll(
    async () => (await page.locator('.tab', { hasText: /Preview/ }).count()) > 0,
    'preview opened',
  );
  console.log('PASS phase08: wikiStudio.openPagesIn opens pages in Code or the preview');

  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    (
      await axe.run(document.querySelector('.pane-body'), { runOnly: ['wcag2a', 'wcag2aa'] })
    ).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id),
  );
  console.log(`axe pages view: ${violations.length} serious/critical`);
  assert.deepEqual(violations, []);
  console.log('NoteSpace phase 08 journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase08.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

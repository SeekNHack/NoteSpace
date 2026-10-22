// Phase 08 browser journey (workspace navigation): the NoteSpace icon opens the workspace tab,
// the Wiki page tree shows readable labels, a folder's README as the folder's page, folder order
// and .gitignore, and pages open from the tree as configured — checked in the real UI.
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
try {
  // The activity bar icon opens the NoteSpace tab and gives the sidebar space back.
  await page.locator('.activitybar [aria-label*="NoteSpace"]').first().click();
  const ws = await frameWith(page, '.nav', 'workspace panel');
  await poll(async () => !(await page.locator('.part.sidebar').isVisible()), 'sidebar closed');
  await ws.locator('.nav [data-nav=wiki]').click();
  const tree = ws.locator('.wiki-nav');
  const guides = tree.locator('.wiki-node.section', { hasText: 'Guides' });
  await guides.waitFor();
  await guides.locator('.twisty').click();
  // Only Guides is expanded: its direct children.
  const children = async () =>
    (await tree.locator('li[aria-expanded=true] > ul > li > .wiki-node').allInnerTexts()).map((t) =>
      t.trim(),
    );
  await poll(async () => (await children()).includes('Getting Started'), 'guides expanded');
  // Readable names; README is the folder's own page; folders before pages; ignored drafts
  // listed (the setting is off).
  assert.deepEqual(await children(), ['Advanced', 'Drafts', 'API Reference', 'Getting Started']);
  await guides.locator('.wiki-link').click();
  await poll(
    async () => /Guides overview/.test(await ws.locator('.wiki-article').innerText()),
    'the folder opens its README',
  );
  console.log('PASS phase08: readable names, README as the folder page and folders first');

  // Follow .gitignore and list pages first.
  await setSettings({
    'notespace.respectGitignore': true,
    'notespace.explorer.directorySort': 'files-first',
  });
  await poll(async () => !(await children()).includes('Drafts'), 'ignored folder hidden', 20000);
  assert.deepEqual(await children(), ['API Reference', 'Getting Started', 'Advanced']);
  // The workspace Insights numbers follow the same index.
  await runCommand(page, 'NoteSpace: Open Insights');
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

  // Where pages open from the tree's Edit.
  await setSettings({ 'notespace.respectGitignore': true, 'notespace.openPagesIn': 'code' });
  await page.waitForTimeout(1500);
  await ws.locator('.nav [data-nav=wiki]').click();
  await tree.locator('.wiki-node.page', { hasText: 'Getting Started' }).click({ button: 'right' });
  await ws.locator('.menu .item', { hasText: 'Edit' }).first().click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: 'getting-started.md' }).count()) > 0,
    'opened',
  );
  await poll(
    async () => (await page.locator('.monaco-editor .view-lines').count()) > 0,
    'text editor',
  );
  console.log('PASS phase08: Edit from the Wiki tree opens pages as notespace.openPagesIn says');

  await page.locator('.tab', { hasText: 'NoteSpace' }).first().click();
  await ws.evaluate(axeSource);
  const violations = await ws.evaluate(async () =>
    // eslint-disable-next-line no-undef
    (
      await axe.run(document.querySelector('.wiki-nav'), { runOnly: ['wcag2a', 'wcag2aa'] })
    ).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id),
  );
  console.log(`axe wiki tree: ${violations.length} serious/critical`);
  assert.deepEqual(violations, []);
  console.log('NoteSpace phase 08 journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase08.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

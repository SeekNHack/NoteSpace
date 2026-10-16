// Phase 02 browser journey: rich documentation content in Studio, reader, export and import.
// Runs the packaged VSIX in an isolated code-server profile.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const rich = `# Rich content

Press ++Ctrl+K++ to search. Version {badge:Beta} with $E = mc^2$ and ==highlighted text==.

:::warning "Collapsed by default" collapsed
Hidden details.
:::

:::tabs "Platforms"
:::tab "Linux"
Use apt.
:::
:::tab "macOS"
Use brew.
:::
:::

:::stepper "Setup"
:::step "Install"
Run the installer.
:::
:::step "Configure"
Edit the settings.
:::
:::

Term
: Definition of the term.

A note[^1] here.

{{ include "snippet.md" who="Reader" }}

![Listen](clip.mp3)

[^1]: The footnote text.
`;
const files = {
  'wiki/Home.md': '# Home\n\n[Rich content](Rich.md)\n',
  'wiki/Rich.md': rich,
  'wiki/snippet.md': 'Hello {{who}} from the snippet.\n',
  'wiki/clip.mp3': Buffer.from('49443303000000000000', 'hex'),
  'mkdocs-site/mkdocs.yml': 'site_name: Legacy Docs\nsite_description: Imported\n',
  'mkdocs-site/docs/index.md': '# Legacy\n\n!!! note "Old admonition"\n    Body text.\n',
};

/** Runs axe in a frame and fails on serious or critical WCAG 2 A/AA violations. */
async function axe(frame, label, exclude = []) {
  await frame.evaluate(axeSource);
  const result = await frame.evaluate(
    async (exclude) =>
      // eslint-disable-next-line no-undef
      (
        await axe.run({ exclude: exclude.map((s) => [s]) }, { runOnly: ['wcag2a', 'wcag2aa'] })
      ).violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      })),
    exclude,
  );
  const serious = result.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(
    `axe ${label}: ${result.length} violation type(s), ${serious.length} serious/critical`,
  );
  for (const v of result) console.log(`  ${v.impact} ${v.id} ${v.nodes.join(' | ')}`);
  assert.deepEqual(serious, [], `accessibility violations in ${label}`);
}

const { page, close, workspace, browser } = await launchCodeServer({
  files,
  settings: { 'files.autoSave': 'off' },
});
const richFile = path.join(workspace, 'wiki/Rich.md');
let studioFrame;
/** Saves like a user: Ctrl/Cmd+S in Studio flushes pending edits, then saves. */
const save = async () => {
  await studioFrame.locator('.ProseMirror').press('ControlOrMeta+s');
  await poll(
    async () => (await studioFrame.locator('#state').innerText()) === 'Saved to disk',
    'Studio saved',
  ).catch(async (e) => {
    console.log(
      'STATE',
      await studioFrame.locator('#state').innerText(),
      await studioFrame
        .locator('.notice')
        .innerText()
        .catch(() => ''),
    );
    throw e;
  });
};
try {
  await runCommand(page, 'NoteSpace: Refresh Index');
  await runCommand(page, 'NoteSpace: Search Pages');
  await page.locator('.quick-input-widget input[type=text]').fill('Rich content');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Rich.md' })
    .first()
    .click();
  const studio = await frameWith(
    page,
    '.ProseMirror[contenteditable="true"] .island',
    'rich page opens editable in Studio',
  );
  studioFrame = studio;
  // Islands render with the reader's renderer.
  await poll(
    async () =>
      (await studio.locator('.island[data-island=badge] .doc-badge').innerText()) === 'Beta',
    'badge chip',
  );
  assert.equal(await studio.locator('.island[data-island=keys] kbd').count(), 1);
  await poll(
    async () => (await studio.locator('.island[data-island=math] math').count()) === 1,
    'math chip',
  );
  assert.equal(await studio.locator('.ProseMirror mark').innerText(), 'highlighted text');
  await poll(
    async () => (await studio.locator('.island-block[data-island=deflist] dl').count()) === 1,
    'definition list preview',
  );
  await poll(
    async () =>
      (await studio.locator('.island-block[data-island=include]').innerText()).includes(
        'Hello Reader from the snippet.',
      ),
    'include preview',
  );
  assert.equal(await studio.locator('section[data-rich=tabs] section[data-rich=tab]').count(), 2);
  assert.equal(
    await studio.locator('section[data-rich=stepper] section[data-rich=step]').count(),
    2,
  );
  await axe(studio, 'Studio');
  console.log('PASS rich: nested containers, inline and block islands render editable in Studio');

  // Edit an inline island in place; only that source changes.
  await studio.locator('.island[data-island=badge]').dblclick();
  const sourceInput = studio.locator('.sourcebox input');
  await sourceInput.waitFor();
  assert.equal(await sourceInput.inputValue(), '{badge:Beta}');
  await sourceInput.fill('{badge:Stable}');
  await sourceInput.press('Enter');
  await poll(
    async () => (await studio.locator('.island[data-island=badge]').innerText()) === 'Stable',
    'badge updated',
  );
  await save();
  await poll(
    async () =>
      (await readFile(richFile, 'utf8')) === rich.replace('{badge:Beta}', '{badge:Stable}'),
    'inline island edit is byte-exact',
  ).catch(async (e) => {
    console.log('ACTUAL FILE:\n' + JSON.stringify(await readFile(richFile, 'utf8')));
    throw e;
  });

  // Edit a block island's source.
  const deflist = studio.locator('.island-block[data-island=deflist]');
  await deflist.getByRole('button', { name: 'Edit source' }).click();
  await deflist.locator('textarea').fill('Term\n: Updated definition.');
  await deflist.locator('textarea').press('ControlOrMeta+Enter');
  await poll(
    async () => (await deflist.innerText()).includes('Updated definition.'),
    'definition updated',
  );
  await save();
  const afterBlockEdit = rich
    .replace('{badge:Beta}', '{badge:Stable}')
    .replace(': Definition of the term.', ': Updated definition.');
  await poll(
    async () => (await readFile(richFile, 'utf8')) === afterBlockEdit,
    'block island edit is byte-exact',
  );
  console.log('PASS rich: island source edits persist byte-exactly');

  // Slash commands insert group containers with children and inline components.
  const anchor = studio.locator('.ProseMirror p', { hasText: 'A note' });
  await anchor.click();
  await studio.locator('.ProseMirror').press('End');
  await studio.locator('.ProseMirror').press('Enter');
  await studio.locator('.ProseMirror').type('/tabs');
  await studio.locator('#menu .item[aria-selected="true"]', { hasText: 'Tabs' }).waitFor();
  await studio.locator('.ProseMirror').press('Enter');
  await poll(
    async () => (await studio.locator('section[data-rich=tabs]').count()) === 2,
    'tabs inserted',
  );
  await anchor.click();
  await studio.locator('.ProseMirror').press('End');
  await studio.locator('.ProseMirror').type(' Status: ');
  await studio.locator('.ProseMirror').type('/badge');
  await studio.locator('#menu .item[aria-selected="true"]', { hasText: 'Badge' }).waitFor();
  await studio.locator('.ProseMirror').press('Enter');
  await sourceInput.waitFor();
  await sourceInput.fill('{badge:Inserted}');
  await sourceInput.press('Enter');
  await save();
  const [head, tail] = afterBlockEdit.split('A note[^1] here.\n\n');
  await poll(async () => {
    const text = await readFile(richFile, 'utf8');
    return (
      text.startsWith(head) &&
      text.endsWith(tail) &&
      text.includes('A note[^1] here. Status: {badge:Inserted}\n\n') &&
      /:::tabs\n:::tab "Tab 1"\nTab 1 content\n:::\n\n:::tab "Tab 2"\nTab 2 content\n:::\n:::/.test(
        text,
      )
    );
  }, 'inserted tabs and badge persist; untouched source stays byte-identical').catch(async (e) => {
    console.log('ACTUAL FILE:\n' + JSON.stringify(await readFile(richFile, 'utf8')));
    throw e;
  });
  console.log('PASS rich: slash commands insert tabs with children and inline components');

  // Reader: semantics shared with export.
  await runCommand(page, 'NoteSpace: Open Reader Preview');
  const reader = await frameWith(page, '.reader-layout .rich-stepper', 'reader');
  assert.equal(await reader.locator('.rich-stepper ol.rich-content > li.rich-step').count(), 2);
  assert.equal(await reader.locator('details.callout.rich-warning:not([open])').count(), 1);
  assert.equal(await reader.getByRole('tablist', { name: 'Platforms' }).count(), 1);
  assert.equal(await reader.locator('dl').count(), 1);
  assert.equal(await reader.locator('.footnotes li').count(), 1);
  assert.equal(await reader.locator('audio[controls]').count(), 1);
  assert.match(await reader.locator('article').innerText(), /Hello Reader from the snippet\./);
  await axe(reader, 'reader');
  console.log(
    'PASS rich: reader renders ordered steps, collapsed callouts, tabs, footnotes, media and includes',
  );

  // Static export with the same semantics.
  const exportParent = path.join(workspace, 'wiki/export-target');
  await mkdir(exportParent);
  await runCommand(page, 'NoteSpace: Export Wiki to HTML');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'export-target' })
    .first()
    .click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  const exportDir = await poll(async () => {
    const entries = await readdir(exportParent);
    if (!entries.length) return undefined;
    const dir = path.join(exportParent, entries[0]);
    return (await readdir(dir)).includes('export-report.json') ? dir : undefined;
  }, 'export written');
  const site = await browser.newPage();
  await site.goto(pathToFileURL(path.join(exportDir, 'pages/Rich.html')).toString());
  assert.equal(await site.locator('.rich-stepper ol.rich-content > li.rich-step').count(), 2);
  assert.equal(await site.locator('details.callout.rich-warning:not([open])').count(), 1);
  await site.getByRole('tablist', { name: 'Platforms' }).waitFor();
  assert.equal(await site.locator('.doc-badge', { hasText: 'Stable' }).count(), 1);
  assert.match(await site.locator('main').innerText(), /Hello Reader from the snippet\./);
  await axe(site.mainFrame(), 'exported page');
  await site.close();
  console.log('PASS rich: export keeps the same semantics and passes accessibility checks');

  // MkDocs import through the real command and dialog.
  await runCommand(page, 'NoteSpace: Import Markdown or MkDocs Project');
  const dialogInput = page.locator('.quick-input-widget input[type=text]');
  await dialogInput.waitFor();
  await dialogInput.fill(path.join(workspace, 'mkdocs-site') + '/');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await poll(
    async () =>
      (await readFile(path.join(workspace, 'mkdocs-site/wiki.yaml'), 'utf8')).includes(
        'Legacy Docs',
      ),
    'import writes wiki.yaml',
  );
  assert.equal(
    await readFile(path.join(workspace, 'mkdocs-site/docs/index.md'), 'utf8'),
    files['mkdocs-site/docs/index.md'],
  );
  await page
    .getByText(/Imported 1 Markdown pages with 1 compatibility note/)
    .first()
    .waitFor();
  console.log('PASS rich: MkDocs import command preserves sources and reports unsupported syntax');
  console.log('NoteSpace rich content journey passed on code-server.');
} catch (error) {
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/failure-rich.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}
void chromium;
void writeFile;

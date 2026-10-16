// Phase 06.5 browser journey: contextual block colors and the circular color picker.
// Acceptance scenario: insert a Details block (purple), pick amber, keep it through save,
// reopen and Studio/Code/Split, reset to default, theme changes, keyboard use and export.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/phase065';
await mkdir(shots, { recursive: true });

const files = {
  'wiki.yaml':
    'schemaVersion: 1\nwiki:\n  title: Colors\ncontent:\n  root: docs\n  homepage: index.md\n',
  'docs/index.md':
    '# Colors\n\nIntro paragraph.\n\n:::note "Nested parent"\nOuter text.\n\n:::tip "Nested child"\nInner text.\n:::\n:::\n',
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

const { page, close, workspace, browser } = await launchCodeServer({
  files,
  settings: { 'files.autoSave': 'off' },
});
const file = path.join(workspace, 'docs/index.md');
const disk = () => readFile(file, 'utf8');
const studioFrame = () =>
  frameWith(page, '.ProseMirror', 'Studio', async (f) =>
    /Intro paragraph/.test(await f.locator('.ProseMirror').innerText()),
  );
// Resolved accent of a block, compared with the theme token it should use.
const blockColor = (frame, selector) =>
  frame
    .locator(selector)
    .first()
    .evaluate((el) => {
      const probe = (token) => {
        const p = document.createElement('span');
        p.style.color = `var(${token})`;
        el.append(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      };
      return {
        border: getComputedStyle(el).borderLeftColor,
        purple: probe('--ws-purple'),
        amber: probe('--ws-orange'),
      };
    });
const openIndex = async () => {
  await page.keyboard.press('Control+P');
  const input = page.locator('.quick-input-widget input[type=text]');
  await input.waitFor();
  await input.fill('docs/index.md');
  await page.locator('.quick-input-list .monaco-list-row').first().click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: 'index.md' }).count()) > 0,
    'opened',
  );
  await runCommand(page, 'NoteSpace: Open in Studio');
};
// Studio sends edits to VS Code shortly after they happen: wait for the tab to be dirty first.
const save = async () => {
  await poll(
    async () => (await page.locator('.tab.active.dirty').count()) > 0,
    'edit reached VS Code',
  );
  await page.keyboard.press('Control+S');
  await poll(async () => (await page.locator('.tab.dirty').count()) === 0, 'saved');
};
try {
  await runCommand(page, 'NoteSpace: Refresh Index');
  await openIndex();
  let studio = await studioFrame();
  // Insert a Details block from the slash menu: default purple. Studio restores the caret
  // from Code mode right after loading, so place it once the editor has settled.
  await page.waitForTimeout(1500);
  await studio.locator('.ProseMirror p', { hasText: 'Intro paragraph' }).click();
  await poll(
    async () =>
      (await studio.evaluate(() => getSelection()?.anchorNode?.textContent || '')).includes(
        'Intro paragraph',
      ),
    'caret in the intro',
  );
  await studio.locator('.ProseMirror').press('End');
  await studio.locator('.ProseMirror').press('Enter');
  await studio.locator('.ProseMirror').type('/details');
  await studio.locator('#menu .item[aria-selected="true"]', { hasText: 'Details' }).waitFor();
  await studio.locator('.ProseMirror').press('Enter');
  const details = 'section[data-rich="details"]';
  await studio.locator(details).waitFor();
  let colors = await blockColor(studio, details);
  assert.equal(colors.border, colors.purple, 'Details defaults to purple');
  const dot = studio.locator(`${details} .color-dot`);
  assert.match(await dot.getAttribute('aria-label'), /Purple \(default\)/);
  // Pick amber with the mouse.
  await dot.click();
  const popover = () => studio.locator('.color-popover');
  await popover().waitFor();
  assert.equal(
    await popover().locator('[role="radio"][aria-checked="true"]').getAttribute('data-color'),
    'purple',
  );
  await page.screenshot({ path: `${shots}/picker-open.png` });
  await axe(studio, 'Studio with the color picker open');
  await popover().locator('[data-color="amber"]').click();
  await poll(
    async () =>
      (await popover().isHidden()) &&
      (await studio.locator(`${details}[data-color="amber"]`).count()) === 1,
    'amber applied',
  );
  colors = await blockColor(studio, details);
  assert.equal(colors.border, colors.amber, 'the block turns amber immediately');
  // Undo and redo.
  await studio.locator(`${details} .rich-content p`).first().click();
  await page.keyboard.press('Control+Z');
  await poll(
    async () => (await studio.locator(`${details}:not([data-color])`).count()) === 1,
    'undo restores the default',
  );
  await page.keyboard.press('Control+Shift+Z');
  await poll(
    async () => (await studio.locator(`${details}[data-color="amber"]`).count()) === 1,
    'redo applies amber again',
  );
  await save();
  assert.match(await disk(), /\n:::details \{color=amber\}\n/);
  assert.ok(
    (await disk()).includes(
      files['docs/index.md'].split('\n\n:::note')[1].split('\n')[0].slice(0, 5),
    ),
    'other blocks untouched',
  );
  assert.match(
    await disk(),
    /:::note "Nested parent"\nOuter text\.\n\n:::tip "Nested child"\nInner text\.\n:::\n:::/,
  );
  console.log(
    'PASS phase06.5: a Details block defaults to purple, turns amber from the picker, saves and undoes',
  );

  // Close, reopen; Code; Split.
  await runCommand(page, 'View: Close All Editors');
  await openIndex();
  studio = await studioFrame();
  assert.equal(
    await studio.locator(`${details}[data-color="amber"]`).count(),
    1,
    'kept after reopening',
  );
  await runCommand(page, 'NoteSpace: Open in Code (Markdown Source)');
  await poll(
    async () => (await page.locator('.view-lines').innerText()).includes('{color=amber}'),
    'visible in Code mode',
  );
  await runCommand(page, 'NoteSpace: Open in Studio');
  studio = await studioFrame();
  assert.equal(
    await studio.locator(`${details}[data-color="amber"]`).count(),
    1,
    'kept after Code → Studio',
  );
  await runCommand(page, 'NoteSpace: Open Split View');
  await poll(async () => (await page.locator('.view-lines').count()) > 0, 'split');
  studio = await studioFrame();
  assert.equal(
    await studio.locator(`${details}[data-color="amber"]`).count(),
    1,
    'kept in Split mode',
  );
  console.log('PASS phase06.5: the override survives reopening and Studio/Code/Split switches');

  // External change: another tool sets the nested tip to red.
  await runCommand(page, 'View: Close All Editors');
  await writeFile(
    file,
    (await disk()).replace(':::tip "Nested child"', ':::tip "Nested child" {color=red}'),
  );
  await openIndex();
  studio = await studioFrame();
  await poll(
    async () => (await studio.locator('aside[data-callout="tip"][data-color="red"]').count()) === 1,
    'external change shown on the nested block',
  );

  // Keyboard: open the picker on the nested callout, move with arrows, Escape, then choose.
  const tipDot = studio.locator('aside[data-callout="tip"] .color-dot');
  // Give the webview keyboard focus first (as a user clicking into the page would).
  await studio.locator('aside[data-callout="tip"] .rich-content p').first().click();
  await tipDot.focus();
  await page.keyboard.press('Enter');
  await popover().waitFor();
  assert.equal(
    await studio.evaluate(() => document.activeElement?.getAttribute('data-color')),
    'red',
    'focus starts on the current color',
  );
  await page.keyboard.press('Escape');
  await poll(
    async () =>
      (await popover().isHidden()) &&
      (await studio.evaluate(() => document.activeElement?.classList.contains('color-dot'))),
    'Escape closes and returns focus',
  );
  await page.keyboard.press('Enter');
  await popover().waitFor();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await studio.evaluate(() => document.activeElement?.getAttribute('data-color')),
    'pink',
  );
  await page.keyboard.press('Enter');
  await poll(
    async () =>
      (await studio.locator('aside[data-callout="tip"][data-color="pink"]').count()) === 1,
    'keyboard selection applied',
  );
  // Reset to default on the Details block.
  await studio.locator(`${details} .color-dot`).click();
  await popover()
    .getByRole('button', { name: /Use default color \(Purple\)/ })
    .click();
  await poll(
    async () => (await studio.locator(`${details}:not([data-color])`).count()) === 1,
    'reset',
  );
  colors = await blockColor(studio, details);
  assert.equal(colors.border, colors.purple, 'back to the semantic purple');
  await save();
  const text = await disk();
  assert.match(text, /\n:::details\n/);
  assert.match(text, /:::tip "Nested child" \{color=pink\}/);
  console.log('PASS phase06.5: external changes, keyboard selection and reset to default work');

  // Theme change: the same override follows the light theme's tokens.
  await studio.locator('aside[data-callout="tip"] .color-dot').click();
  await popover().locator('[data-color="amber"]').click();
  const darkAmber = (await blockColor(studio, 'aside[data-callout="tip"]')).border;
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Control+T');
  await page.locator('.quick-input-widget input[type=text]').fill('Light Modern');
  await page
    .locator('.quick-input-list .monaco-list-row', { hasText: 'Light Modern' })
    .first()
    .waitFor();
  await page.keyboard.press('Enter');
  await poll(
    async () => (await blockColor(studio, 'aside[data-callout="tip"]')).border !== darkAmber,
    'theme switch',
  );
  colors = await blockColor(studio, 'aside[data-callout="tip"]');
  assert.equal(colors.border, colors.amber, 'amber in the light theme');
  await page.screenshot({ path: `${shots}/light-theme.png` });
  await axe(studio, 'Studio in the light theme');
  await save();
  console.log('PASS phase06.5: overrides follow theme tokens in light and dark themes');

  // Export: the site keeps the override with the same preset id.
  await runCommand(page, 'NoteSpace: Build Wiki');
  const built = path.join(workspace, 'dist/pages/index.html');
  await poll(
    async () =>
      (await stat(built).catch(() => undefined)) &&
      /data-color="amber"/.test(await readFile(built, 'utf8')),
    'site built',
  );
  const site = await browser.newPage();
  await site.goto(`file://${built}`);
  const exported = await site.locator('aside.rich-tip').evaluate((el) => {
    const p = document.createElement('span');
    p.style.color = 'var(--ws-orange)';
    el.append(p);
    return [getComputedStyle(el).borderLeftColor, getComputedStyle(p).color];
  });
  assert.equal(exported[0], exported[1], 'exported block uses the amber token');
  await site.screenshot({ path: `${shots}/export.png` });
  await site.close();
  console.log('PASS phase06.5: the static export renders the same color');
  console.log('NoteSpace phase 06.5 journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase065.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

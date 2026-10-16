// Captures review screenshots of the real extension in an isolated code-server.
// Usage: node scripts/visual-review.mjs [outDir] [--light]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const light = process.argv.includes('--light');
const themeArg = process.argv.find((a) => a.startsWith('--theme='))?.slice(8);
const suffix = themeArg ? `-${themeArg.replace(/\W+/g, '-').toLowerCase()}` : light ? '-light' : '';
const out = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'out/review');
await mkdir(out, { recursive: true });
const sample = `---
title: Deployment guide
tags: [ops]
---
# Deployment guide

Ship a release with confidence. This page links to [Home](Home.md) and uses \`inline code\`.

:::warning "Before you deploy"
Back up the **database** and confirm the release notes.
:::

:::tip
Use the staging environment first.
:::

## Pipeline

\`\`\`mermaid
flowchart LR
  A[Commit] --> B{Tests pass?}
  B -->|yes| C[Build]
  B -->|no| D[Fix]
  C --> E[Deploy]
\`\`\`

## Commands

\`\`\`bash
npm run build && npm run package
code-server --install-extension notespace.vsix --force
\`\`\`

| Stage | Owner | Duration |
| --- | --- | --- |
| Build | CI | 3 min |
| Deploy | Ops | 5 min |

- [x] Tag the release
- [ ] Announce it

> Releases happen every second Tuesday.
`;
const richPage = `# Platform notes

Press ++Ctrl+K++ to search. Status {badge:Beta}, formula $E = mc^2$ and ==highlighted text==. Read {tip:SLA|Service level agreement} terms[^1].

:::tabs "Install"
:::tab "Linux"
Use \`apt install notespace\`.
:::
:::tab "macOS"
Use Homebrew.
:::
:::

:::stepper "Release"
:::step "Build"
Run the build.
:::
:::step "Ship"
Publish the VSIX.
:::
:::

Term
: A definition shown in Studio as a rendered island.

$$
a^2 + b^2 = c^2
$$

[^1]: The SLA lives in the contract.
`;
const files = {
  'wiki/Platform.md': richPage,
  'wiki/Home.md':
    '# Home\n\nWelcome to the **team wiki**.\n\n- [Deployment guide](Deployment.md)\n- [Onboarding](guides/Onboarding.md)\n',
  'wiki/Deployment.md': sample,
  'wiki/guides/Onboarding.md': '# Onboarding\n\nRead [[Home]] first.\n',
  'wiki/guides/Style.md': '# Style guide\n\nWrite short sentences.\n',
};
const { page, close } = await launchCodeServer({
  files,
  settings: themeArg
    ? { 'workbench.colorTheme': themeArg }
    : light
      ? { 'workbench.colorTheme': 'Default Light Modern' }
      : {},
});
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${name}${suffix}.png`) });
  console.log('shot', name);
};
const step = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    console.error(`FAILED ${label}: ${e.message}`);
    await shot(`failed-${label}`);
  }
};
try {
  await step('explorer', async () => {
    await runCommand(page, 'NoteSpace: Refresh Index');
    await page.locator('.activitybar [aria-label^="NoteSpace"]').first().click();
    await page.waitForTimeout(1500);
    await shot('01-explorer-home');
  });
  await step('studio', async () => {
    await runCommand(page, 'NoteSpace: Search Pages');
    await page.locator('.quick-input-widget input[type=text]').fill('Deployment');
    await page.keyboard.press('Enter');
    await frameWith(page, '.ProseMirror', 'studio editor');
    await shot('02-studio');
  });
  await step('studio-scrolled', async () => {
    const frame = await frameWith(page, '.ProseMirror', 'studio editor');
    await frame.locator('.ProseMirror .code-view').first().scrollIntoViewIfNeeded();
    await shot('03-studio-blocks');
  });
  await step('studio-bottom', async () => {
    const frame = await frameWith(page, '.ProseMirror', 'studio editor');
    await frame.locator('.ProseMirror table').first().scrollIntoViewIfNeeded();
    await frame.locator('.ProseMirror blockquote').first().scrollIntoViewIfNeeded();
    await shot('03b-studio-table-tasks');
  });
  await step('slash', async () => {
    const frame = await frameWith(page, '.ProseMirror', 'studio editor');
    await frame.locator('.ProseMirror h1').first().click();
    await frame.locator('.ProseMirror').press('End');
    await frame.locator('.ProseMirror').press('Enter');
    await frame.locator('.ProseMirror').type('/');
    await shot('04-slash-menu');
    await frame.locator('.ProseMirror').press('Escape');
    await frame.locator('.ProseMirror').press('Backspace');
    await frame.locator('.ProseMirror').press('Backspace');
  });
  await step('split', async () => {
    await runCommand(page, 'NoteSpace: Open Split View');
    await shot('05-split');
  });
  await step('preview', async () => {
    await runCommand(page, 'NoteSpace: Open Reader Preview');
    await frameWith(page, '.reader-layout, .wiki-reader', 'preview');
    await shot('06-preview');
  });
  await step('home', async () => {
    await runCommand(page, 'View: Close All Editors');
    await runCommand(page, 'NoteSpace: Open Dashboard');
    await frameWith(page, 'main', 'home');
    await shot('07-dashboard');
  });
  await step('code-mode', async () => {
    await runCommand(page, 'View: Close All Editors');
    await runCommand(page, 'NoteSpace: Search Pages');
    await page.locator('.quick-input-widget input[type=text]').fill('Deployment');
    await page.keyboard.press('Enter');
    await frameWith(page, '.ProseMirror', 'studio editor');
    await runCommand(page, 'NoteSpace: Open in Code (Markdown Source)');
    await page.locator('.monaco-editor').filter({ hasText: 'Deployment guide' }).first().waitFor();
    await shot('09-code-mode');
  });
  await step('context-view', async () => {
    await runCommand(page, 'NoteSpace: Show Page Outline and Backlinks');
    await page.locator('.pane-body .monaco-list-row', { hasText: 'Outline' }).first().waitFor();
    await shot('10-page-context');
  });
  await step('explorer-menu', async () => {
    await page.locator('.monaco-list-row', { hasText: 'Home' }).first().click({ button: 'right' });
    await page.locator('.context-view .monaco-menu').waitFor();
    await shot('11-explorer-menu');
    await page.keyboard.press('Escape');
  });
  await step('insert-callout', async () => {
    await runCommand(page, 'NoteSpace: Open in Studio');
    const frame = await frameWith(page, '.ProseMirror', 'studio editor');
    await frame.locator('.ProseMirror h1').first().click();
    await frame.locator('.ProseMirror').press('End');
    await frame.locator('.ProseMirror').press('Enter');
    await frame.locator('.ProseMirror').type('/danger');
    await frame.locator('.ProseMirror').press('Enter');
    await frame.locator('.ProseMirror').type('Never deploy on Fridays.');
    await frame.locator('.ProseMirror').press('ControlOrMeta+a');
    await frame.locator('.ProseMirror p', { hasText: 'Ship a release' }).first().dblclick();
    await shot('12-callout-and-bubble');
    await page.mouse.move(5, 5);
    await frame.locator('.ProseMirror').press('ControlOrMeta+k');
    await shot('13-link-popover');
    await frame.locator('.ProseMirror').press('Escape');
  });
  await step('rich-studio', async () => {
    await runCommand(page, 'View: Close All Editors');
    await runCommand(page, 'NoteSpace: Search Pages');
    await page.locator('.quick-input-widget input[type=text]').fill('Platform notes');
    await page
      .locator('.quick-input-list .monaco-list-row')
      .filter({ hasText: 'Platform.md' })
      .first()
      .click();
    const frame = await frameWith(page, '.ProseMirror .island', 'rich studio');
    await poll(async () => (await frame.locator('.island math').count()) > 0, 'math rendered');
    await shot('14-rich-studio');
    await frame.locator('.island-block').first().scrollIntoViewIfNeeded();
    await shot('15-rich-studio-blocks');
    await runCommand(page, 'NoteSpace: Open Reader Preview');
    await frameWith(page, '.reader-layout .rich-stepper', 'rich reader');
    await shot('16-rich-reader');
  });
  await step('narrow', async () => {
    await page.setViewportSize({ width: 760, height: 900 });
    await runCommand(page, 'NoteSpace: Search Pages');
    await page.locator('.quick-input-widget input[type=text]').fill('Deployment');
    await page.keyboard.press('Enter');
    await poll(async () => page.frames().length > 2, 'frames');
    await shot('08-narrow');
  });
} finally {
  await close();
}

import { chromium } from 'playwright-core';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const tmp = await mkdtemp(path.join(os.tmpdir(), 'notespace-ui-'));
let app, browser, page;
const codeServer = process.argv.includes('--code-server');
const extensionPackage = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const serverEnv = { ...process.env };
delete serverEnv.VSCODE_IPC_HOOK_CLI;
delete serverEnv.VSCODE_PROXY_URI;
let serverOutput = '';
const poll = async (fn, label) => {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
try {
  await mkdir(path.join(tmp, 'workspace/wiki'), { recursive: true });
  await mkdir(path.join(tmp, 'user/User'), { recursive: true });
  await writeFile(
    path.join(tmp, 'user/User/settings.json'),
    JSON.stringify({
      'workbench.startupEditor': 'none',
      'security.workspace.trust.enabled': false,
      'window.dialogStyle': 'custom',
      'files.simpleDialog.enable': true,
      'files.autoSave': 'afterDelay',
      'files.autoSaveDelay': 1000,
      'workbench.colorTheme': 'Default Dark Modern',
      'window.newWindowDimensions': 'maximized',
    }),
  );
  await writeFile(
    path.join(tmp, 'workspace/wiki/Home.md'),
    '# Home\n\nWelcome to **NoteSpace**.\n\n[[Guide|Read the guide]]\n\n![Pixel](dot.png)\n\n:::tabs "Examples"\n:::tab "First"\nAlpha content\n:::\n:::tab "Second"\nBeta content\n:::\n:::\n\n:::caption "One pixel"\n![Pixel](dot.png)\n:::\n\n![Listen](clip.mp3)\n',
  );
  await writeFile(
    path.join(tmp, 'workspace/wiki/Guide.md'),
    // A wiki link inside bold text is the remaining construct Studio cannot edit safely.
    '# Guide\n\n## Getting started\n\n**[[Home]]**\n\n<script>window.pwned = true</script>\n',
  );
  await writeFile(
    path.join(tmp, 'workspace/wiki/dot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await writeFile(
    path.join(tmp, 'workspace/wiki/clip.mp3'),
    Buffer.from('49443303000000000000', 'hex'),
  );
  const port = 19000 + Math.floor(Math.random() * 10000);
  if (codeServer) {
    const config = path.join(tmp, 'config.yaml');
    await writeFile(config, '{}\n');
    const args = [
      '--config',
      config,
      '--user-data-dir',
      path.join(tmp, 'user'),
      '--extensions-dir',
      path.join(tmp, 'extensions'),
    ];
    execFileSync(
      'code-server',
      [
        ...args,
        '--install-extension',
        path.resolve(`${extensionPackage.name}-${extensionPackage.version}.vsix`),
        '--force',
      ],
      { stdio: 'inherit', env: serverEnv },
    );
    app = spawn(
      'code-server',
      [
        ...args,
        '--bind-addr',
        `127.0.0.1:${port}`,
        '--auth',
        'none',
        '--disable-telemetry',
        '--disable-update-check',
        '--disable-workspace-trust',
        path.join(tmp, 'workspace'),
      ],
      { stdio: 'pipe', env: serverEnv },
    );
    app.stdout.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });
    app.stderr.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });
    await poll(async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).ok, 'code-server');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage();
    await page.goto(
      `http://127.0.0.1:${port}/?folder=${encodeURIComponent(path.join(tmp, 'workspace'))}`,
    );
  } else {
    const executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || '1.96.4');
    app = spawn(
      executable,
      [
        path.join(tmp, 'workspace'),
        `--extensionDevelopmentPath=${process.cwd()}`,
        `--user-data-dir=${path.join(tmp, 'user')}`,
        `--extensions-dir=${path.join(tmp, 'extensions')}`,
        `--remote-debugging-port=${port}`,
        '--no-sandbox',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
      ],
      { stdio: 'ignore' },
    );
    const endpoint = await poll(
      async () =>
        (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl,
      'debugging endpoint',
    );
    browser = await chromium.connectOverCDP(endpoint);
    page = await poll(
      async () =>
        browser
          .contexts()
          .flatMap((c) => c.pages())
          .find((p) => p.url().includes('workbench')),
      'workbench',
    );
  }
  page.setDefaultTimeout(15000);
  // Device-metrics emulation desynchronises pointer input for Electron's out-of-process
  // webview frames, so only the browser-hosted code-server page gets a fixed viewport.
  if (codeServer) await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.monaco-workbench').waitFor();
  // Check the rendered Markdown inside the workbench's Monaco editor. code-server
  // can render source lines without a visible .inputarea or .view-lines element.
  const nativeCodeEditor = (content) =>
    page.locator('.monaco-editor').filter({ hasText: content }).first();
  const command = async (name) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.waitForTimeout(350);
      await page.keyboard.press('F1');
      const input = page.locator('.quick-input-widget input[type=text]');
      await input.waitFor({ state: 'visible' });
      await input.focus();
      await input.fill(`>NoteSpace: ${name}`);
      const row = page
        .locator('.quick-input-list .monaco-list-row')
        .filter({ hasText: `NoteSpace: ${name}` })
        .first();
      if (
        await row
          .waitFor({ timeout: 3000 })
          .then(() => true)
          .catch(() => false)
      ) {
        await page.keyboard.press('Enter');
        return;
      }
      await page.keyboard.press('Escape');
    }
    throw new Error(`Command not visible in palette: ${name}`);
  };
  // Desktop startup toasts (root user, disabled extensions) can cover webview content.
  const clearToasts = async () => {
    if (codeServer) return;
    await page.keyboard.press('F1');
    await page
      .locator('.quick-input-widget input[type=text]')
      .fill('>Notifications: Clear All Notifications');
    await page.locator('.quick-input-list .monaco-list-row').first().waitFor();
    await page.keyboard.press('Enter');
  };
  await clearToasts();
  await command('Initialize Wiki');
  await page
    .getByRole('tab', { name: /Home.md/ })
    .first()
    .waitFor();
  await page
    .getByRole('tab', { name: /Home.md/ })
    .first()
    .click();
  // Wiki links, nested tabs, captions, images and media embeds are all editable in Studio.
  const homeStudio = await poll(async () => {
    for (const frame of page.frames())
      if (
        (await frame
          .locator('.ProseMirror[contenteditable="true"] section[data-rich="tabs"]')
          .count()) &&
        (await frame.locator('.ProseMirror .island[data-island="media"]').count())
      )
        return frame;
  }, 'rich wiki-link page opens editable in Studio');
  assert.equal(await homeStudio.locator('.ProseMirror a.wiki-link').count(), 1);
  await command('Open Reader Preview');
  let preview = await poll(async () => {
    for (const frame of page.frames())
      if (
        (await frame.locator('.reader-layout').count()) &&
        (await frame
          .locator('h1')
          .filter({ hasText: /^Home\s*#$/ })
          .count())
      )
        return frame;
  }, 'preview DOM');
  assert.equal(await preview.locator('a', { hasText: 'Read the guide' }).count(), 1);
  const tabs = preview.getByRole('tablist', { name: 'Examples' });
  await tabs.waitFor();
  const firstTab = tabs.getByRole('tab', { name: 'First' });
  const secondTab = tabs.getByRole('tab', { name: 'Second' });
  assert.equal(await firstTab.getAttribute('aria-selected'), 'true');
  await firstTab.focus();
  await firstTab.press('ArrowRight');
  assert.equal(await secondTab.getAttribute('aria-selected'), 'true');
  await secondTab.press('ArrowLeft');
  assert.equal(await firstTab.getAttribute('aria-selected'), 'true');
  await secondTab.click();
  assert.equal(await secondTab.getAttribute('aria-selected'), 'true');
  assert.equal(await preview.getByRole('tabpanel', { name: 'First' }).isVisible(), false);
  assert.equal(await preview.getByRole('tabpanel', { name: 'Second' }).isVisible(), true);
  assert.equal(await preview.locator('figcaption').innerText(), 'One pixel');
  assert.equal(await preview.locator('audio[controls]').count(), 1);
  await preview.getByRole('searchbox', { name: 'Search pages' }).fill('Welcome');
  await preview.locator('#wiki-results a', { hasText: 'Home' }).waitFor();
  await preview.getByRole('searchbox', { name: 'Search pages' }).fill('');
  await preview.getByRole('button', { name: 'Focus Mode' }).click();
  assert.equal(await preview.locator('.reader-layout.focus').count(), 1);
  await preview.getByRole('button', { name: 'Focus Mode' }).click();
  await poll(
    async () =>
      preview
        .getByAltText('Pixel')
        .first()
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    'local image resource',
  );
  await preview.getByRole('link', { name: 'Read the guide' }).click();
  preview = await poll(async () => {
    for (const frame of page.frames())
      if (
        (await frame.locator('.reader-layout').count()) &&
        (await frame
          .locator('h1')
          .filter({ hasText: /^Guide\s*#$/ })
          .count())
      )
        return frame;
  }, 'preview follows link');
  assert.equal(await preview.evaluate(() => window.pwned), undefined);
  assert.ok(
    (await preview.locator('main').innerText()).includes('<script>window.pwned = true</script>'),
  );
  await preview.getByRole('link', { name: 'Home', exact: true }).first().click();
  await poll(async () => {
    for (const frame of page.frames())
      if (
        (await frame.locator('.reader-layout').count()) &&
        (await frame
          .locator('h1')
          .filter({ hasText: /^Home\s*#$/ })
          .count())
      )
        return true;
  }, 'home preview');
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({
    path: `docs/screenshots/${codeServer ? 'code-server-' : ''}preview.png`,
  });
  console.log('PASS UI: initialize, live preview, navigation and HTML escaping');
  await clearToasts();
  await command('Explore Link Graph');
  const graph = await poll(async () => {
    for (const frame of page.frames()) if (await frame.locator('svg.graph').count()) return frame;
  }, 'graph DOM');
  await graph.locator('.page-list button').first().waitFor();
  assert.equal(await graph.locator('.page-list button').count(), 2);
  await graph.getByLabel('Find a page').fill('Guide');
  assert.equal(await graph.locator('.page-list button').count(), 1);
  await graph.getByLabel('Find a page').fill('');
  await page.screenshot({ path: `docs/screenshots/${codeServer ? 'code-server-' : ''}graph.png` });
  await graph.getByRole('button', { name: 'Guide', exact: true }).click();
  await command('Open in Studio');
  const readonlyVisual = await poll(async () => {
    for (const frame of page.frames())
      if (
        (await frame.locator('#state').count()) &&
        (await frame.locator('#state').textContent()) === 'Source editing required'
      )
        return frame;
  }, 'unsafe Markdown stays read-only in Studio');
  assert.equal(await readonlyVisual.getByRole('button', { name: 'Save' }).isDisabled(), true);
  assert.equal(
    await readonlyVisual.getByRole('button', { name: 'Bold', exact: true }).first().isDisabled(),
    true,
  );
  assert.equal(await readonlyVisual.locator('#source').isEnabled(), true);
  // Read-only Studio shows the faithful reader rendering, never a lossy editable copy.
  assert.equal(
    await readonlyVisual.locator('.readonly-view h2', { hasText: 'Getting started' }).count(),
    1,
  );
  assert.match(
    await readonlyVisual.locator('.readonly-view').innerText(),
    /<script>window\.pwned = true<\/script>/,
  );
  assert.equal(await readonlyVisual.evaluate(() => window.pwned), undefined);
  await readonlyVisual.locator('#source').click();
  console.log('PASS UI: graph renders, filters and opens pages');
  await command('Toggle Favorite');
  await command('Open Home');
  const wikiHome = await poll(async () => {
    for (const frame of page.frames()) if (await frame.locator('.home-grid').count()) return frame;
  }, 'NoteSpace Home DOM');
  // The Home is an application view; it opens the wiki's homepage instead of embedding it.
  assert.equal(await wikiHome.locator('.home-document, .ProseMirror').count(), 0);
  assert.match(
    await wikiHome.locator('.home-card', { hasText: 'Continue working' }).innerText(),
    /Favorites[\s\S]*Guide/i,
  );
  // Insights: the same health numbers the dashboard used to show.
  await wikiHome.locator('.nav [data-nav=insights]').click();
  await poll(
    async () =>
      (await wikiHome
        .locator('.tile', { hasText: 'Broken links' })
        .locator('strong')
        .innerText()
        .catch(() => '')) === '0' &&
      (await wikiHome
        .locator('.tile', { hasText: /^\d+\s*Pages$/ })
        .locator('strong')
        .innerText()
        .catch(() => '')) === '2',
    'insights numbers',
  );
  await wikiHome.locator('.nav [data-nav=wiki]').click();
  await poll(
    async () =>
      (await page.locator('.tab.active', { hasText: 'Home.md' }).count()) > 0 &&
      (await page.locator('.tab', { hasText: 'Home.md' }).count()) === 1 &&
      (await Promise.all(
        page.frames().map((frame) =>
          frame
            .locator('.ProseMirror', { hasText: 'Welcome' })
            .count()
            .catch(() => 0),
        ),
      ).then((counts) => counts.some(Boolean))),
    'Wiki reveals the already open homepage instead of duplicating it',
  );
  console.log('PASS UI: Home, favorites, Insights health numbers and the Wiki homepage action');
  await command('New Page');
  const input = page.locator('.quick-input-widget input[type=text]');
  await input.fill('projects/Launch');
  await page.keyboard.press('Enter');
  await page
    .getByRole('tab', { name: /launch\.md/i })
    .first()
    .waitFor();
  await command('Rename Page and Update Links');
  await input.fill('projects/Release');
  await page.keyboard.press('Enter');
  await page
    .getByRole('tab', { name: /Release.md/ })
    .first()
    .waitFor();
  await page
    .getByText(
      'Page renamed and links updated. Use Save All to persist the link edits; Undo can revert the operation.',
      { exact: true },
    )
    .waitFor();
  await command('New Folder');
  await input.fill('projects/Design Notes');
  await page.keyboard.press('Enter');
  await poll(
    async () =>
      (
        await readFile(path.join(tmp, 'workspace/wiki/projects/design-notes/index.md'), 'utf8')
      ).includes('# Design Notes'),
    'folder created in active section',
  );
  await command('New Page from Template');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Meeting' })
    .first()
    .click();
  await input.fill('projects/Planning');
  await page.keyboard.press('Enter');
  await poll(
    async () =>
      (await readFile(path.join(tmp, 'workspace/wiki/projects/planning.md'), 'utf8')).includes(
        '## Agenda',
      ),
    'template page created',
  );
  await command('Search Pages');
  await input.fill('Release');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'projects/Release.md' })
    .first()
    .click();
  await command('Open in Studio');
  const visual = await poll(async () => {
    for (const frame of page.frames())
      if (
        await frame
          .locator('.ProseMirror[contenteditable="true"]')
          .filter({ hasText: 'Launch' })
          .count()
      )
        return frame;
  }, 'visual editor DOM');
  const initialVisualText = await poll(
    async () => (await visual.locator('.ProseMirror').innerText()).trim(),
    'visual document load',
  );
  const initialMarkdown = await readFile(
    path.join(tmp, 'workspace/wiki/projects/Release.md'),
    'utf8',
  );
  // Nothing to undo right after opening: the button is disabled and Ctrl+Z is a no-op.
  assert.equal(await visual.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
  await visual.locator('.ProseMirror').click();
  await visual.locator('.ProseMirror').press('ControlOrMeta+z');
  await page.waitForTimeout(600);
  assert.equal((await visual.locator('.ProseMirror').innerText()).trim(), initialVisualText);
  assert.equal(
    await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8'),
    initialMarkdown,
  );
  await visual.locator('.ProseMirror').click();
  await visual.locator('.ProseMirror').press('ControlOrMeta+End');
  await visual.locator('.ProseMirror').press('Enter');
  await visual.locator('.ProseMirror').type('Visual edit persisted');
  await visual.getByRole('button', { name: 'Undo', exact: true }).click();
  await poll(
    async () =>
      !(await visual.locator('.ProseMirror').innerText()).includes('Visual edit persisted'),
    'visual undo',
  );
  await visual.getByRole('button', { name: 'Redo', exact: true }).click();
  await poll(
    async () =>
      (await visual.locator('.ProseMirror').innerText()).includes('Visual edit persisted'),
    'visual redo',
  );
  await poll(
    async () =>
      (await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8')).includes(
        'Visual edit persisted',
      ),
    'visual Auto Save',
  );
  await visual.locator('.ProseMirror').press('ControlOrMeta+End');
  await visual.locator('.ProseMirror').press('Enter');
  await visual.locator('.ProseMirror').type('[[Gui');
  await visual.locator('#menu .item', { hasText: 'Guide' }).first().waitFor();
  await visual.getByRole('button', { name: 'Save', exact: true }).press('Enter');
  await poll(
    async () => (await visual.locator('#state').innerText()).includes('Saved to disk'),
    'toolbar keyboard action with page suggestions visible',
  );
  await visual.locator('.ProseMirror').focus();
  await visual.locator('.ProseMirror').press('ControlOrMeta+End');
  for (let i = 0; i < '[[Gui'.length; i++) await visual.locator('.ProseMirror').press('Backspace');
  await visual.locator('.ProseMirror').type('[[Gui');
  await visual.locator('#menu .item', { hasText: 'Guide' }).first().waitFor();
  await visual.locator('.ProseMirror').press('Enter');
  await poll(
    async () => (await visual.locator('.ProseMirror a').allTextContents()).includes('Guide'),
    'visual page link completion',
  );
  await visual.locator('.ProseMirror').press('Enter');
  // Slash command: filter by typing, confirm with Enter.
  await visual.locator('.ProseMirror').type('/card');
  await visual.locator('#menu .item[aria-selected="true"]', { hasText: 'Card' }).waitFor();
  await visual.locator('.ProseMirror').press('Enter');
  const richCard = visual.locator('.ProseMirror section[data-rich="card"]').last();
  await richCard.waitFor();
  // Block titles are edited inline in the block header.
  await richCard.getByLabel('Block title').fill('Release card');
  await poll(
    async () => (await richCard.getAttribute('data-title')) === 'Release card',
    'rich card title in Studio',
  );
  await visual.locator('.ProseMirror').press('ControlOrMeta+End');
  await visual.locator('.ProseMirror').type('/warn');
  await visual.locator('#menu .item[aria-selected="true"]', { hasText: 'Warning' }).waitFor();
  await visual.locator('.ProseMirror').press('Enter');
  await visual.locator('.ProseMirror aside[data-callout="warning"]').waitFor();
  await visual.locator('.ProseMirror').press('ControlOrMeta+End');
  // The "+" insert menu works at every editor width (narrow layouts hide the shortcut buttons).
  const insertFromMenu = async (label) => {
    await visual.getByRole('button', { name: 'Insert block', exact: true }).click();
    await visual.locator('#menu .item', { hasText: label }).first().click();
  };
  await insertFromMenu('Table');
  await visual.locator('.ProseMirror table').waitFor();
  await visual.locator('.ProseMirror').press('ControlOrMeta+End');
  await insertFromMenu('Mermaid diagram');
  await visual.locator('.ProseMirror .code-view.mermaid').last().waitFor();
  // The diagram preview renders from the host and follows the theme (no white canvas).
  await poll(
    async () => (await visual.locator('.ProseMirror .code-view.mermaid .diagram svg').count()) > 0,
    'Mermaid preview in Studio',
  );
  assert.notEqual(
    await visual
      .locator('.ProseMirror .code-view.mermaid .diagram')
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(255, 255, 255)',
  );
  await visual.getByRole('button', { name: 'Save', exact: true }).click();
  await visual.locator('#source').click();
  await poll(async () => nativeCodeEditor('Visual edit persisted').isVisible(), 'Code mode');
  await poll(
    async () =>
      (await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8')).includes(
        ':::warning',
      ),
    'visual edit saved before Code mode',
  );
  assert.match(
    await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8'),
    /:::warning/,
  );
  assert.match(
    await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8'),
    /\|.*\|/,
  );
  assert.match(
    await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8'),
    /```mermaid/,
  );
  assert.match(
    await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8'),
    /\[Guide\]\(\.\.\/Guide\.md\)/,
  );
  assert.match(
    await readFile(path.join(tmp, 'workspace/wiki/projects/Release.md'), 'utf8'),
    /:::card "Release card"/,
  );
  await command('Open in Studio');
  const reopenedVisual = await poll(async () => {
    for (const frame of page.frames())
      if (await frame.locator('.ProseMirror').filter({ hasText: 'Visual edit persisted' }).count())
        return frame;
  }, 'visual content restored after Code switch');
  assert.equal(await reopenedVisual.locator('aside[data-callout="warning"]').count(), 1);
  assert.equal(
    await reopenedVisual.locator('section[data-rich="card"][data-title="Release card"]').count(),
    1,
  );
  await reopenedVisual.getByRole('button', { name: 'Split', exact: true }).click();
  // Split keeps Studio and opens the same document's native editor in a neighbouring group.
  await poll(
    async () =>
      (await page.locator('.tab', { hasText: 'Release.md' }).count()) >= 2 &&
      ((await nativeCodeEditor('Visual edit persisted').isVisible()) ||
        (await nativeCodeEditor('flowchart').isVisible())),
    'native Markdown in Split mode',
  );
  await poll(
    async () =>
      (await reopenedVisual
        .getByRole('button', { name: 'Split', exact: true })
        .getAttribute('aria-pressed')) === 'true',
    'Split mode is shown as active in Studio',
  );
  await command("Open Today's Daily Note");
  await poll(
    async () =>
      page
        .getByRole('tab')
        .filter({ hasText: /\d{4}-\d{2}-\d{2}\.md/ })
        .count(),
    'daily note',
  );
  console.log('PASS UI: page and folder creation, rename, visual persistence and daily note');
  await command('Search Pages');
  await input.fill('Release');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'projects/Release.md' })
    .first()
    .click();
  await command('Delete Page');
  await page.getByRole('button', { name: 'Delete Page', exact: true }).click();
  await poll(
    async () => !(await page.getByRole('tab', { name: /Release.md/ }).count()),
    'delete closes page',
  );
  await command('Restore Deleted Page');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'projects/Release.md' })
    .first()
    .click();
  await page
    .getByRole('tab', { name: /Release.md/ })
    .first()
    .waitFor();
  console.log('PASS UI: full-text search, confirmed delete and restore');
  const exportParent = path.join(tmp, 'workspace/wiki/projects/export-target');
  await mkdir(exportParent);
  await command('Export Wiki to HTML');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'export-target' })
    .first()
    .click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Open Export Report', exact: true }).click();
  await page
    .getByRole('tab', { name: /export-report.json/ })
    .first()
    .waitFor();
  const exports = await readdir(exportParent);
  assert.equal(exports.length, 1);
  const exportDir = path.join(exportParent, exports[0]);
  const report = JSON.parse(await readFile(path.join(exportDir, 'export-report.json'), 'utf8'));
  // Six pages exist; today's daily note is private by default and not exported.
  assert.equal(report.pages, 5);
  assert.deepEqual(report.warnings, []);
  assert.equal((await readdir(path.join(exportDir, 'pages'))).includes('daily'), false);
  const releaseHtml = await readFile(path.join(exportDir, 'pages/projects/Release.html'), 'utf8');
  assert.match(releaseHtml, /class="rich-block rich-card"/);
  assert.match(releaseHtml, /Release card/);
  const homeHtml = await readFile(path.join(exportDir, 'pages/Home.html'), 'utf8');
  assert.match(homeHtml, /rich-tabs/);
  assert.match(homeHtml, /<figcaption>One pixel<\/figcaption>/);
  assert.match(homeHtml, /<audio controls preload="metadata"/);
  assert.equal(
    (await readFile(path.join(exportDir, 'assets/clip.mp3'))).toString('hex'),
    '49443303000000000000',
  );
  if (codeServer) {
    const exportedPage = await browser.newPage();
    await exportedPage.goto(pathToFileURL(path.join(exportDir, 'index.html')).toString());
    await exportedPage.getByRole('link', { name: 'Home', exact: true }).click();
    const exportedTabs = exportedPage.getByRole('tablist', { name: 'Examples' });
    await exportedTabs.waitFor();
    await exportedTabs.getByRole('tab', { name: 'Second' }).click();
    assert.equal(
      await exportedTabs.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected'),
      'true',
    );
    await poll(
      async () =>
        exportedPage
          .getByAltText('Pixel')
          .first()
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      'exported image',
    );
    await exportedPage.getByRole('link', { name: 'Read the guide' }).click();
    assert.match(await exportedPage.locator('h1').innerText(), /^Guide\s*#$/);
    assert.equal(await exportedPage.evaluate(() => window.pwned), undefined);
    await exportedPage.close();
  }
  console.log('PASS UI: HTML export, report, portable links and images');
  await writeFile(
    path.join(tmp, 'workspace/wiki/Links.md'),
    '# Links\n\nSee [[Guide]] and [[Home|the home page]].\n',
  );
  await poll(async () => {
    await command('Search Pages');
    await input.fill('Links');
    const row = page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Links.md' });
    if (!(await row.count())) {
      await page.keyboard.press('Escape');
      return false;
    }
    await row.first().click();
    return true;
  }, 'new page indexed');
  const linksStudio = await poll(async () => {
    for (const frame of page.frames())
      if ((await frame.locator('.ProseMirror a.wiki-link').count()) === 2) return frame;
  }, 'wiki-link page opens in Studio');
  assert.equal(await linksStudio.locator('.ProseMirror[contenteditable="true"]').count(), 1);
  await linksStudio
    .locator('.ProseMirror a.wiki-link', { hasText: 'Guide' })
    .click({ modifiers: ['ControlOrMeta'] });
  await poll(
    async () =>
      (await page.locator('.tab.active', { hasText: 'Guide.md' }).count()) > 0 &&
      nativeCodeEditor('window.pwned').isVisible(),
    'Ctrl+Click on a wiki link opens the target page (Code mode for unsafe syntax)',
  );
  assert.equal(
    await readFile(path.join(tmp, 'workspace/wiki/Links.md'), 'utf8'),
    '# Links\n\nSee [[Guide]] and [[Home|the home page]].\n',
  );
  console.log('PASS UI: wiki links edit in Studio and navigate with Ctrl+Click');
  await command('Create Wiki');
  for (const [title, value] of [
    ['Name', 'Studio Demo'],
    ['Description', 'Demo docs'],
    ['Directory', 'studio-demo'],
    ['Language', 'en'],
  ]) {
    // The quick-input title is stable across VS Code versions; its input aria-label is not.
    await page
      .locator('.quick-input-widget .quick-input-title', { hasText: `Create Wiki · ${title}` })
      .waitFor({ state: 'visible' });
    const field = page.locator('.quick-input-widget input[type=text]');
    await field.fill(value);
    await field.press('Enter');
  }
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'system' })
    .first()
    .click();
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Starter documentation' })
    .first()
    .click();
  const project = path.join(tmp, 'workspace', 'studio-demo');
  await poll(
    async () => (await readFile(path.join(project, 'wiki.yaml'), 'utf8')).includes('Studio Demo'),
    'create wiki config',
  );
  assert.match(
    await readFile(path.join(project, 'docs/index.md'), 'utf8'),
    /:::hero "Welcome to Studio Demo"/,
  );
  const newHome = await poll(async () => {
    for (const frame of page.frames())
      if (await frame.locator('.ProseMirror section[data-rich="hero"]').count()) return frame;
  }, 'new wiki index page opens in Studio with its hero');
  assert.match(await newHome.locator('section[data-rich="hero"]').innerText(), /Demo docs/);
  await page
    .getByRole('tab', { name: /index.md/ })
    .first()
    .waitFor();
  await command('Build Wiki');
  // Build runs asynchronously after the command returns; wait for it instead of racing it.
  await poll(
    async () =>
      /class="rich-block rich-hero"/.test(
        await readFile(path.join(project, 'dist/pages/index.html'), 'utf8'),
      ),
    'built hero page',
  );
  await poll(
    async () =>
      (await readFile(path.join(project, 'dist', 'index.html'), 'utf8')).includes('Studio Demo'),
    'configured static build',
  );
  const staticServer = createServer(async (req, res) => {
    const file = path.join(
      project,
      'dist',
      decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html',
    );
    if (!file.startsWith(path.join(project, 'dist') + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      const type = file.endsWith('.json')
        ? 'application/json'
        : file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html';
      res.writeHead(200, { 'Content-Type': type });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
  // Electron's CDP endpoint cannot open browser contexts; desktop runs use a separate browser.
  const siteBrowser = codeServer
    ? browser
    : await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const sitePage = await siteBrowser.newPage();
    await sitePage.goto(`http://127.0.0.1:${staticServer.address().port}/`);
    await sitePage.getByRole('searchbox', { name: 'Search docs' }).fill('getting started');
    await sitePage.locator('.search-results a', { hasText: 'Getting started' }).waitFor();
    await sitePage.close();
  } finally {
    if (siteBrowser !== browser) await siteBrowser.close();
    await new Promise((resolve) => staticServer.close(resolve));
  }
  console.log('PASS UI: wiki creation, configured build and offline static search');
  await rm('docs/screenshots/failure.png', { force: true });
  console.log(`NoteSpace UI smoke passed on ${codeServer ? 'code-server' : 'VS Code desktop'}.`);
} catch (error) {
  if (codeServer) console.error(serverOutput.slice(-5000));
  if (page)
    console.error(
      'VISIBLE INPUTS:',
      await page
        .locator('input:visible')
        .evaluateAll((inputs) => inputs.map((i) => ({ outer: i.outerHTML.slice(0, 350) })))
        .catch(() => []),
    );
  await cp(path.join(tmp, 'user/logs'), 'out/ui-logs', { recursive: true }).catch(() => {});
  if (page) {
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/failure.png' }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(-6000));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (app) {
    app.kill();
    if (app.exitCode === null) await new Promise((r) => app.once('exit', r));
  }
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

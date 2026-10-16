// Phase 06 browser journey: theme builder, the built static site served over HTTP (navigation,
// search, languages, versions, planner/calendar snapshots, mobile layout, print, analytics),
// and PDF/EPUB exports through the real commands, checked with pypdf and epubcheck.
import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/phase06';
await mkdir(shots, { recursive: true });
const tools = path.join(os.homedir(), '.cache', 'wiki-studio-tools');

// Receives analytics beacons; also serves the built site.
const hits = [];
let siteRoot = '';
const server = createServer(async (req, res) => {
  if (req.url === '/hit' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push(JSON.parse(body));
      res.writeHead(204, { 'access-control-allow-origin': '*' }).end();
    });
    return;
  }
  const file = path.join(siteRoot, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const data = await readFile(file.endsWith('/') ? path.join(file, 'index.html') : file);
    const type =
      {
        html: 'text/html',
        css: 'text/css',
        js: 'text/javascript',
        json: 'application/json',
        png: 'image/png',
        svg: 'image/svg+xml',
      }[file.split('.').pop()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }).end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// The local date, as the extension uses it (UTC differs around midnight).
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const files = {
  'wiki.yaml': `schemaVersion: 1\nwiki:\n  title: Handbook\n  description: Team handbook\n  language: en\ncontent:\n  root: docs\n  homepage: index.md\nfeatures:\n  plannerExport: true\ni18n:\n  languages: [it]\nversions:\n  current: "2.0"\n  archived: ["1.0"]\nanalytics:\n  provider: beacon\n  endpoint: http://127.0.0.1:${port}/hit\n`,
  'docs/index.md': '# Handbook\n\nStart with the [[Guide]].\n',
  'docs/Guide.md': `# Guide\n\nRead the setup notes.\n\n:::warning "Before you start" collapsed\nBack up your data first.\n:::\n\n:::tabs\n:::tab "macOS"\nUse brew.\n:::\n:::tab "Linux"\nUse apt.\n:::\n:::\n\n$$\na^2+b^2=c^2\n$$\n\n\`\`\`mermaid\ngraph LR\n  Plan-->Ship\n\`\`\`\n\n\`\`\`chart\ntype: bar\ntitle: Releases\nx: q\ny: n\n---\nq,n\nQ1,3\nQ2,5\n\`\`\`\n\n- [ ] Write the release notes due:${today} #docs\n- [ ] Plan Q3 status:doing\n`,
  'docs/Board.md': '# Board\n\n```tasks\nview: board\n```\n',
  'docs/it/index.md': '# Manuale\n\nInizia dalla [[Guide]].\n',
  'docs/it/Guide.md': '# Guida\n\nLeggi le note.\n',
  'docs/_versions/1.0/index.md': '# Handbook 1.0\n',
  'docs/_versions/1.0/Guide.md': '# Guide\n\nOld setup notes.\n',
  [`docs/daily/${today}.md`]: `# ${today}\n\nToday's notes.\n`,
};

async function axe(target, label) {
  await target.evaluate(axeSource);
  const violations = await target.evaluate(async () =>
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
  settings: { 'files.autoSave': 'off', 'wikiStudio.export.browserPath': chromium.executablePath() },
});
const saveAs = async (file) => {
  const input = page.locator('.quick-input-widget input[type=text]');
  await input.waitFor();
  await input.fill(file);
  await page.getByRole('button', { name: 'OK', exact: true }).click();
};
try {
  await runCommand(page, 'NoteSpace: Refresh Index');

  // Theme builder: preset, live preview with contrast, saved to wiki.yaml.
  await runCommand(page, 'NoteSpace: Customize Site Theme');
  const theme = await frameWith(page, '.presets [data-preset]', 'theme builder');
  await theme.locator('[data-preset="paper"]').click();
  await poll(
    async () =>
      /Iowan Old Style/.test(
        await theme.locator('.pane.light .doc h1').evaluate((h) => getComputedStyle(h).fontFamily),
      ),
    'serif preview',
  );
  assert.match(
    await theme.locator('#contrast').innerText(),
    /Link contrast: \d+\.\d:1 light, \d+\.\d:1 dark/,
  );
  await page.screenshot({ path: `${shots}/theme-builder.png` });
  await axe(theme, 'theme builder');
  await theme.locator('#save').click();
  await poll(
    async () =>
      /preset: paper[\s\S]*font: serif[\s\S]*width: narrow|preset: paper/.test(
        await readFile(path.join(workspace, 'wiki.yaml'), 'utf8'),
      ),
    'theme saved',
  );
  const yaml = await readFile(path.join(workspace, 'wiki.yaml'), 'utf8');
  assert.match(yaml, /accent: "?#b4572d"?/);
  assert.match(yaml, /font: serif/);
  console.log(
    'PASS phase06: the theme builder previews presets with contrast and saves them to wiki.yaml',
  );

  // Build the site and browse it over HTTP.
  await runCommand(page, 'NoteSpace: Build Wiki');
  siteRoot = path.join(workspace, 'dist');
  await poll(
    async () =>
      (await stat(path.join(siteRoot, 'index.html')).catch(() => undefined)) &&
      (await stat(path.join(siteRoot, '.wiki-studio-build')).catch(() => undefined)),
    'site built',
  );
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const site = await context.newPage();
  await site.goto(`http://127.0.0.1:${port}/pages/Guide.html`);
  assert.equal(await site.locator('details.callout.rich-warning:not([open])').count(), 1);
  await site.getByRole('tablist').waitFor();
  assert.equal(await site.locator('figure.chart svg').count(), 1);
  assert.equal(await site.locator('.doc math').count(), 1);
  assert.equal(
    await site.locator('figure.mermaid:not(.diagram-invalid) img[alt="Mermaid diagram"]').count(),
    1,
  );
  // Both nodes of `Plan-->Ship` are drawn (edges without spaces are valid Mermaid).
  const diagram = Buffer.from(
    (await site.locator('figure.mermaid img').getAttribute('src')).split(',')[1],
    'base64',
  ).toString();
  assert.match(diagram, />Plan<[\s\S]*>Ship</);
  assert.match(
    await site.evaluate(() => getComputedStyle(document.body).fontFamily),
    /Iowan Old Style/,
  );
  // Search, scoped to the language.
  await site.locator('.site-search').fill('setup');
  await poll(async () => (await site.locator('.search-results a').count()) === 1, 'search result');
  assert.equal(await site.locator('.search-results a').innerText(), 'Guide');
  // Language and version switchers.
  await site.locator('nav[aria-label="Language"] a', { hasText: 'it' }).click();
  await site.waitForURL(/\/pages\/it\/Guide\.html$/);
  assert.equal(await site.evaluate(() => document.documentElement.lang), 'it');
  await site.goto(`http://127.0.0.1:${port}/pages/Guide.html`);
  await site.locator('nav[aria-label="Version"] a', { hasText: '1.0' }).click();
  await site.waitForURL(/_versions\/1\.0\/Guide\.html$/);
  assert.match(await site.locator('.archived-banner').innerText(), /archived version/);
  await axe(site, 'exported archived page');
  // Planner snapshots (opted in): lists, calendar and board, read-only.
  await site.goto(`http://127.0.0.1:${port}/planner.html`);
  assert.match(
    await site.locator('table.snapshot-calendar td[aria-current="date"]').innerText(),
    /Write the release notes/,
  );
  assert.equal(
    await site.locator('table.snapshot-calendar td[aria-current="date"] a').count(),
    1,
    "today's daily note is linked",
  );
  assert.match(await site.locator('.collection-board').innerText(), /Plan Q3/);
  assert.equal(
    await site.locator('input[type=checkbox]:not([disabled])').count(),
    0,
    'snapshots are not editable',
  );
  assert.ok(
    (await site.locator('main').boundingBox()).width > 600,
    'pages without navigation use the full width',
  );
  await site.screenshot({ path: `${shots}/planner-snapshot.png`, fullPage: true });
  await axe(site, 'planner snapshot');
  // Analytics: one beacon per page view with the path only; none with Do Not Track.
  await poll(async () => hits.length >= 3, 'beacons received');
  assert.deepEqual(Object.keys(hits[0]).sort(), ['lang', 'path']);
  assert.ok(hits.some((h) => h.path === '/pages/Guide.html'));
  const count = hits.length;
  const dnt = await browser.newContext();
  await dnt.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }),
  );
  const private_ = await dnt.newPage();
  await private_.goto(`http://127.0.0.1:${port}/pages/Guide.html`);
  await private_.waitForTimeout(1000);
  assert.equal(hits.length, count, 'Do Not Track is respected');
  await dnt.close();
  console.log(
    'PASS phase06: the built site navigates, searches, switches language/version, shows planner snapshots and counts views only as configured',
  );

  // Mobile read mode and print layout.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const phone = await mobile.newPage();
  await phone.goto(`http://127.0.0.1:${port}/pages/Guide.html`);
  assert.ok(
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'no horizontal scrolling on phones',
  );
  await phone.screenshot({ path: `${shots}/site-mobile.png` });
  await axe(phone, 'exported page on a phone');
  await phone.emulateMedia({ media: 'print' });
  assert.equal(
    await phone.locator('.site-nav').isVisible(),
    false,
    'navigation is hidden in print',
  );
  await mobile.close();
  await context.close();
  console.log('PASS phase06: the site reads well on phones and prints without navigation');

  // PDF of the whole wiki through the command, then EPUB.
  const pdfPath = path.join(workspace, 'Handbook.pdf');
  await runCommand(page, 'NoteSpace: Export PDF (Page, Section or Wiki)');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Whole wiki' })
    .first()
    .click();
  await saveAs(pdfPath);
  await poll(
    async () =>
      (await readFile(pdfPath).catch(() => Buffer.alloc(0))).subarray(0, 5).toString() === '%PDF-',
    'PDF written',
    120000,
  );
  // NFKC folds typographic ligatures (ﬁ) that PDF text extraction returns.
  const raw = execFileSync(path.join(tools, 'venv/bin/python'), [
    '-c',
    'import sys,pypdf;print("\\n".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))',
    pdfPath,
  ]).toString();
  const text = raw.normalize('NFKC');
  assert.match(text, /Contents\n1\. Handbook\n/, 'the homepage comes first');
  for (const expected of ['Handbook', 'Contents', 'Back up your data first', 'Use brew', 'Use apt'])
    assert.ok(text.includes(expected), `PDF contains “${expected}”`);
  assert.ok(!text.includes('Old setup notes'), 'archived versions are not in the wiki PDF');
  const epubPath = path.join(workspace, 'Handbook.epub');
  await runCommand(page, 'NoteSpace: Export EPUB');
  await saveAs(epubPath);
  await poll(
    async () => (await stat(epubPath).catch(() => undefined))?.size > 0,
    'EPUB written',
    120000,
  );
  const report = execFileSync('java', [
    '-jar',
    path.join(tools, 'epubcheck-5.1.0/epubcheck.jar'),
    epubPath,
  ]).toString();
  assert.match(report, /No errors or warnings detected/);
  await page.screenshot({ path: `${shots}/exports-done.png` });
  console.log(
    'PASS phase06: PDF and EPUB exports from the commands contain the content and validate',
  );
  console.log('NoteSpace phase 06 journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase06.png' }).catch(() => {});
  throw error;
} finally {
  await close();
  server.close();
}

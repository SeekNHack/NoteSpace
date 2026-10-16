// Phase 07 browser journey (knowledge): advanced search with filters, highlighted previews,
// keyboard navigation and recent searches; the content health report with the quality score,
// accessibility findings and wiki.yaml rules.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/phase07';
await mkdir(shots, { recursive: true });

const files = {
  'wiki.yaml':
    'schemaVersion: 1\nwiki:\n  title: Agent Docs\ncontent:\n  root: docs\n  homepage: index.md\nquality:\n  rules:\n    - folder: guides\n      fields: [owner]\n      sections: [Overview]\n',
  'docs/index.md':
    '# Agent Docs\n\nStart with the [install guide](guides/install.md) and [configuration](guides/configuration.md). The [API](reference/api.md) is a draft.\n',
  'docs/guides/install.md':
    '---\ntags: [setup, ops]\nowner: Alice\n---\n# Install the agent\n\n## Overview\n\nInstall the agent with pip on every host.\n\n```python\nimport agent\nagent.init()\n```\n\n![](images/install-flow.png)\n\n#### Troubleshooting\n\nIf the agent does not start, check the logs.\n',
  'docs/guides/configuration.md':
    '---\ntags: [setup]\n---\n# Configuration\n\nConfigure the agent in `agent.yaml`.\n\n```yaml\nport: 8080\n```\n',
  'docs/specs/shop.yaml':
    'openapi: 3.0.3\ninfo: {title: Shop API, version: "1.0"}\nservers: [{url: "https://shop.example.com/v1"}]\npaths:\n  /orders:\n    get: {operationId: listOrders, tags: [Orders], summary: List orders, responses: {"200": {description: Orders, content: {application/json: {schema: {type: array, items: {$ref: "#/components/schemas/Order"}}}}}}}\n    post: {operationId: createOrder, tags: [Orders], summary: Create an order, requestBody: {content: {application/json: {schema: {$ref: "#/components/schemas/Order"}}}}, responses: {"201": {description: Created}}}\n  /customers/{id}:\n    get: {operationId: getCustomer, tags: [Customers], summary: Get a customer, parameters: [{name: id, in: path, required: true, schema: {type: string}}], responses: {"200": {description: Customer}}}\ncomponents:\n  schemas:\n    Order: {type: object, required: [id], properties: {id: {type: string, description: Order number}, total: {type: number}, status: {type: string, enum: [open, paid]}}}\n',
  'docs/reference/api.md':
    '---\ndraft: true\ntags: [api]\n---\n# Agent API\n\nThe agent exposes a local HTTP API.\n',
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
try {
  // 1. Advanced search: words plus a tag filter, highlighted previews.
  await runCommand(page, 'NoteSpace: Advanced Search');
  const search = await frameWith(page, '#q', 'search panel');
  await search.locator('#q').fill('agent tag:setup');
  await poll(
    async () => /2 pages/.test(await search.locator('#status').innerText()),
    'two setup pages',
  );
  assert.ok((await search.locator('.hit mark').count()) >= 2, 'matched words are highlighted');
  assert.deepEqual(
    await search
      .locator('.chip')
      .allInnerTexts()
      .then((t) => t.map((x) => x.replace('×', '').trim())),
    ['tag:setup'],
  );
  // A picker adds a filter to the query text (what you see is what is searched).
  await search.locator('[data-filter=code]').selectOption('python');
  await poll(
    async () => /1 page\b/.test(await search.locator('#status').innerText()),
    'code filter applied',
  );
  assert.equal(await search.locator('#q').inputValue(), 'agent tag:setup code:python');
  assert.equal(await search.locator('.hit .t').innerText(), 'Install the agent');
  assert.match(await search.locator('.hit .x').innerText(), /Install the agent with pip/);
  await page.screenshot({ path: `${shots}/search-filters.png` });
  await axe(search, 'advanced search');
  // Unknown filters are reported, not silently ignored.
  await search.locator('#q').fill('agent colour:red');
  await poll(
    async () => /Unknown filter: colour:/.test(await search.locator('#status').innerText()),
    'unknown filter warning',
  );
  // heading: opens the page at that section, with the keyboard.
  await search.locator('#q').fill('heading:troubleshooting');
  await poll(async () => (await search.locator('.hit .h').count()) === 1, 'heading hit');
  assert.match(await search.locator('.hit .h').innerText(), /Troubleshooting/);
  await search.locator('#q').press('Enter');
  await poll(
    async () => (await page.locator('.tab.active', { hasText: 'install.md' }).count()) > 0,
    'result opened',
  );
  console.log(
    'PASS phase07: advanced search filters, highlights and opens results at the matching heading',
  );

  // 2. Recent searches survive reopening the panel.
  await runCommand(page, 'NoteSpace: Advanced Search');
  const again = await frameWith(page, '#recent button', 'recent searches');
  assert.equal(
    await again.locator('#recent button').first().innerText(),
    'heading:troubleshooting',
  );
  await again.locator('#recent button').first().click();
  await poll(
    async () => (await again.locator('#q').inputValue()) === 'heading:troubleshooting',
    'recent search reused',
  );
  await again.locator('#clear').click();
  await poll(
    async () => (await again.locator('#recent button').count()) === 0,
    'recent searches cleared',
  );
  console.log('PASS phase07: recent searches are remembered per workspace and can be cleared');

  // 3. Content health: transparent score, accessibility findings, wiki.yaml rules.
  await runCommand(page, 'NoteSpace: Open Content Health Report');
  const health = await frameWith(page, '.dash.health', 'health report');
  const tile = (label) => health.locator('.tile', { hasText: label }).locator('strong');
  await poll(async () => (await health.locator('#h-structure').count()) === 1, 'structure section');
  // install.md: missing alt text and a skipped heading level; configuration.md: rule violations.
  assert.equal(await tile('Accessibility').innerText(), '1');
  assert.equal(await tile('Rule violations').innerText(), '1');
  const report = await health.locator('main').innerText();
  assert.match(report, /no alternative text/);
  assert.match(report, /jumps from 2 to 4/);
  assert.match(report, /“owner” is missing/);
  assert.match(report, /“Overview” is missing/);
  // 4 pages, 2 with findings → 50%.
  assert.equal(await tile('Health score').innerText(), '50%');
  assert.match(report, /2 of 4/);
  await page.screenshot({ path: `${shots}/content-health.png` });
  await axe(health, 'content health');
  console.log(
    'PASS phase07: the content health report explains its score and lists accessibility and rule findings',
  );

  // 4. API playground: searchable catalog, schema models, refresh when the description changes.
  await runCommand(page, 'NoteSpace: Open API Playground');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'shop.yaml' })
    .first()
    .click();
  const api = await frameWith(page, 'nav input.search', 'API playground');
  await api.locator('nav input.search').fill('orders');
  await poll(
    async () => /2 of 3 endpoints/.test(await api.locator('nav .count').innerText()),
    'catalog filtered',
  );
  assert.equal(await api.locator('nav button[data-op]').count(), 2);
  await api.locator('nav button[data-op="createOrder"]').click();
  assert.match(await api.locator('main .note').first().innerText(), /every POST is confirmed/);
  await api.locator('details.models summary').click();
  assert.match(await api.locator('details.models').innerText(), /id\s+required\s+string/);
  await api.locator('nav input.search').fill('order');
  await api.locator('nav button[data-schema="Order"]').click();
  await poll(async () => /Order number/.test(await api.locator('main').innerText()), 'schema view');
  assert.match(await api.locator('main').innerText(), /status\s+string: "open", "paid"/);
  assert.match(
    await api.locator('main').innerText(),
    /POST \/orders/,
    'schema lists the operations that use it',
  );
  await page.screenshot({ path: `${shots}/api-schemas.png` });
  await axe(api, 'API playground');
  const specFile = path.join(workspace, 'docs/specs/shop.yaml');
  await writeFile(
    specFile,
    (await readFile(specFile, 'utf8')).replace(
      '  /customers/{id}:',
      '  /orders/{id}:\n    delete: {operationId: deleteOrder, tags: [Orders], summary: Cancel an order, parameters: [{name: id, in: path, required: true, schema: {type: string}}], responses: {"204": {description: Cancelled}}}\n  /customers/{id}:',
    ),
  );
  await poll(
    async () => (await api.locator('nav .banner').count()) === 1,
    'playground refreshed',
    20000,
  );
  await api.locator('nav input.search').fill('orders');
  await poll(
    async () => /3 of 4 endpoints/.test(await api.locator('nav .count').innerText()),
    'new operation listed',
  );
  console.log(
    'PASS phase07: the API playground has a searchable catalog and schema models, and follows description changes',
  );

  // 5. Block gallery: live previews, search, keyboard insertion of exactly what the preview shows.
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="index.md"]').click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: 'index.md' }).count()) > 0,
    'index opened',
  );
  await runCommand(page, 'NoteSpace: Open in Studio');
  const studio = await frameWith(page, '.ProseMirror', 'Studio', async (f) =>
    /Start with/.test(await f.locator('.ProseMirror').innerText()),
  );
  await page.waitForTimeout(1200);
  await studio
    .locator('.ProseMirror p', { hasText: 'Start with' })
    .click({ position: { x: 4, y: 4 } });
  await studio.locator('.ProseMirror').press('Control+End');
  await studio.locator('.ProseMirror').press('Enter');
  await studio.locator('button[aria-label="Block gallery"]').click();
  const gallery = studio.locator('.gallery[role=dialog]');
  await gallery.waitFor();
  await poll(
    async () => (await studio.locator('.gallery-preview.pending').count()) === 0,
    'previews rendered',
  );
  assert.ok((await studio.locator('.gallery-card').count()) >= 20, 'all blocks listed');
  assert.match(
    await studio.locator('#gallery-callout-warning .gallery-preview').innerText(),
    /Before you continue/,
  );
  await page.screenshot({ path: `${shots}/block-gallery.png` });
  await axe(studio, 'block gallery');
  await studio.locator('.gallery-cat', { hasText: 'Steps & time' }).click();
  assert.deepEqual(await studio.locator('.gallery-card .gallery-label').allInnerTexts(), [
    'Steps',
    'Timeline',
  ]);
  await studio.locator('.gallery-cat', { hasText: 'All blocks' }).click();
  await studio.locator('.gallery-search').fill('faq');
  await poll(async () => (await studio.locator('.gallery-card').count()) === 1, 'search narrowed');
  await poll(
    async () =>
      /Does it work offline/.test(
        await studio.locator('.gallery-card .gallery-preview').innerText(),
      ),
    'faq preview',
  );
  await studio.locator('.gallery-search').press('Enter');
  // Titles are editable fields in the block header; the body is document text.
  await poll(
    async () =>
      /Yes, everything stays in your files/.test(await studio.locator('.ProseMirror').innerText()),
    'faq inserted',
  );
  assert.ok(
    (await studio.locator('.ProseMirror input[value="Does it work offline?"]').count()) ||
      (await studio
        .locator('.ProseMirror .callout-head input')
        .evaluateAll((els) => els.some((e) => e.value === 'Does it work offline?'))),
    'question title inserted',
  );
  assert.ok(await gallery.isHidden(), 'gallery closes after inserting');
  // Arrow keys move through the grid; Enter inserts the selected block.
  await studio.locator('button[aria-label="Block gallery"]').click();
  await studio.locator('.gallery-search').fill('bar line');
  await poll(async () => (await studio.locator('.gallery-card').count()) === 1, 'chart entry');
  await studio.locator('.gallery-search').press('ArrowDown');
  await studio.locator('.gallery-search').press('Enter');
  await poll(
    async () => (await studio.locator('.code-view.collection-view').count()) === 1,
    'chart inserted',
  );
  await poll(
    async () => (await page.locator('.tab.active.dirty').count()) > 0,
    'edit reached VS Code',
  );
  await page.keyboard.press('Control+S');
  const indexFile = path.join(workspace, 'docs/index.md');
  await poll(
    async () =>
      /:::accordion "FAQ"\n:::details "Does it work offline\?"\n/.test(
        await readFile(indexFile, 'utf8'),
      ),
    'faq saved as Markdown',
  );
  console.log(
    'PASS phase07: the block gallery previews blocks with the real renderer and inserts them by keyboard',
  );

  // 6. Inspector: edit the chart's options in a small form; data and other lines are kept.
  const chart = studio.locator('.code-view.collection-view');
  await chart.hover();
  await chart.locator('button[aria-label="Block properties"]').click();
  const inspector = studio.locator('.inspector');
  await inspector.waitFor();
  assert.equal(await inspector.locator('[data-key=type]').inputValue(), 'bar');
  await inspector.locator('[data-key=type]').selectOption('line');
  await inspector.locator('[data-key=title]').fill('Visits per week');
  await page.screenshot({ path: `${shots}/block-inspector.png` });
  await axe(studio, 'block inspector');
  await inspector.locator('button[type=submit]').click();
  await poll(
    async () => (await page.locator('.tab.active.dirty').count()) > 0,
    'inspector edit reached VS Code',
  );
  await page.keyboard.press('Control+S');
  await poll(
    async () =>
      /```chart\ntype: line\ntitle: Visits per week\nx: week\ny: visits\n---\nweek,visits\nW1,120/.test(
        await readFile(indexFile, 'utf8'),
      ),
    'chart options saved',
  );
  console.log('PASS phase07: the block inspector edits component options and keeps the data');

  // 7. Versions from Git: a tag is browsed as a read-only snapshot; nothing is checked out.
  const gitRun = (...args) =>
    execFileSync('git', args, {
      cwd: workspace,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ann',
        GIT_AUTHOR_EMAIL: 'a@x',
        GIT_COMMITTER_NAME: 'Ann',
        GIT_COMMITTER_EMAIL: 'a@x',
      },
    }).toString();
  gitRun('init', '-q', '-b', 'main');
  gitRun('add', '-A');
  gitRun('commit', '-q', '-m', 'Docs 1.0');
  gitRun('tag', 'v1.0');
  const installFile = path.join(workspace, 'docs/guides/install.md');
  await writeFile(
    installFile,
    (await readFile(installFile, 'utf8')).replace(
      'Install the agent with pip on every host.',
      'Install the agent with the new installer.',
    ),
  );
  const statusBefore = gitRun('status', '--porcelain');
  await runCommand(page, 'NoteSpace: Browse Wiki at Git Tag or Branch');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'v1.0' })
    .first()
    .click();
  const snap = await frameWith(page, '.snapshot-banner', 'version snapshot');
  assert.match(await snap.locator('.snapshot-banner').innerText(), /Read-only snapshot of v1\.0/);
  await snap.locator('#q').fill('pip');
  await poll(
    async () => (await snap.locator('#pages li').count()) === 1,
    'version-specific search',
  );
  await snap.locator('#pages a', { hasText: 'Install the agent' }).click();
  // Opening a page re-renders the view (a new frame).
  const opened = await frameWith(page, '.snapshot-banner', 'old page', async (f) =>
    /pip on every host/.test(
      await f
        .locator('main')
        .innerText()
        .catch(() => ''),
    ),
  );
  assert.match(await opened.locator('#pages').innerText(), /changed since/);
  assert.equal(await opened.locator('#q').inputValue(), 'pip', 'the search is kept');
  await opened.locator('[data-action=compare]').click();
  const compared = await frameWith(page, 'table.diff tr.add', 'comparison');
  assert.match(await compared.locator('table.diff').innerText(), /new installer/);
  await page.screenshot({ path: `${shots}/git-version.png` });
  await axe(compared, 'git version snapshot');
  assert.equal(gitRun('status', '--porcelain'), statusBefore, 'working tree untouched');
  assert.match(gitRun('rev-parse', '--abbrev-ref', 'HEAD'), /^main/);
  console.log('PASS phase07: a Git tag is browsed, searched and compared as a read-only snapshot');
  console.log('NoteSpace phase 07 knowledge journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase07-knowledge.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

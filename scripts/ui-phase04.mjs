// Phase 04 browser journey: charts, notebooks, canvases, OpenAPI references and the API
// playground against a real local HTTP server. Data assertions check files and requests.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/phase04';
await mkdir(shots, { recursive: true });

const received = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    res.writeHead(req.method === 'POST' ? 201 : 200, {
      'content-type': 'application/json',
      'x-request-id': String(received.length),
    });
    res.end(
      JSON.stringify(
        req.method === 'POST' ? { id: 3, ...JSON.parse(body || '{}') } : [{ id: 1, name: 'Rex' }],
      ),
    );
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const token = `tok-${Math.random().toString(36).slice(2)}`;

const notebook = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['## Revenue analysis'] },
    {
      cell_type: 'code',
      metadata: {},
      execution_count: 1,
      source: ['total = 6 * 7\n', 'print(total)'],
      outputs: [{ output_type: 'stream', name: 'stdout', text: ['42\n'] }],
    },
  ],
});
const files = {
  'wiki/Home.md': '# Home\n\n[[Visuals]]\n',
  'wiki/Visuals.md': `# Visuals

\`\`\`chart
type: line
title: Weekly visits
data: data/visits.csv
x: week
y: visits, signups
\`\`\`

\`\`\`notebook
path: notebooks/Analysis.ipynb
\`\`\`

\`\`\`canvas
path: canvases/Map.canvas
\`\`\`

\`\`\`openapi
path: api/pets.yaml
\`\`\`

\`\`\`javascript
console.log(1 + 1)
\`\`\`
`,
  'wiki/data/visits.csv': 'week,visits,signups\nW1,120,8\nW2,180,14\nW3,150,11\nW4,210,19\n',
  'wiki/notebooks/Analysis.ipynb': notebook,
  'wiki/canvases/Map.canvas': JSON.stringify(
    {
      nodes: [
        { id: 'a', type: 'text', text: 'Roadmap', x: 0, y: 0, width: 220, height: 70 },
        { id: 'b', type: 'file', file: 'Home.md', x: 320, y: 0, width: 220, height: 70 },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
      appData: { keep: true },
    },
    null,
    '\t',
  ),
  'wiki/api/pets.yaml': `openapi: 3.0.3
info: {title: Pet Store, version: "1.0"}
servers: [{url: "http://127.0.0.1:${port}/v1"}]
components:
  securitySchemes:
    bearerAuth: {type: http, scheme: bearer}
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      tags: [Pets]
      parameters: [{name: limit, in: query, schema: {type: integer}, example: 10}]
      responses: {"200": {description: A list of pets}}
    post:
      operationId: createPet
      summary: Create a pet
      tags: [Pets]
      security: [{bearerAuth: []}]
      requestBody: {required: true, content: {application/json: {schema: {type: object, properties: {name: {type: string, example: Fido}}}}}}
      responses: {"201": {description: Created}}
`,
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

const { page, close, workspace, tmp } = await launchCodeServer({
  files,
  settings: { 'files.autoSave': 'off' },
});
const scanForToken = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await scanForToken(full);
    else assert.ok(!(await readFile(full, 'utf8')).includes(token), `secret leaked into ${full}`);
  }
};
try {
  await runCommand(page, 'NoteSpace: Refresh Index');
  await runCommand(page, 'NoteSpace: Search Pages');
  await page.locator('.quick-input-widget input[type=text]').fill('Visuals');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Visuals.md' })
    .first()
    .click();
  let studio = await frameWith(page, '.ProseMirror .code-view figure.chart svg', 'studio chart');
  await poll(
    async () => (await studio.locator('.code-view .nb-output').count()) > 0,
    'notebook embed',
  );
  assert.match(await studio.locator('.code-view .nb-output').first().innerText(), /42/);
  await poll(
    async () => (await studio.locator('.code-view .canvas-preview svg').count()) > 0,
    'canvas embed',
  );
  await poll(async () => (await studio.locator('.code-view .api-op').count()) === 2, 'api embed');
  // Code execution is off by default: no Run button on the JavaScript block.
  const runButtons = studio.locator('button.run:visible');
  assert.equal(await runButtons.count(), 0, 'Run is hidden unless notespace.codeRunner.enabled');
  await page.screenshot({ path: `${shots}/studio-visuals.png` });
  await axe(studio, 'studio visuals');
  console.log(
    'PASS phase04: Studio renders chart, notebook, canvas and API embeds; Run is off by default',
  );

  // Enabling the runner shows Run; running needs a confirmation and shows real output.
  await runCommand(page, 'Preferences: Open Settings (UI)');
  // The settings search box is focused when the editor opens.
  await page.locator('.settings-editor .settings-header').waitFor();
  await page.waitForTimeout(500);
  await page.keyboard.type('notespace.codeRunner.enabled');
  const row = page
    .locator('.settings-editor .setting-item-bool', { hasText: 'Code Runner' })
    .first();
  await row.waitFor();
  const checkbox = row.locator('.setting-value-checkbox');
  await checkbox.click();
  await poll(
    async () => (await checkbox.getAttribute('aria-checked')) === 'true',
    'setting enabled',
  );
  await poll(
    async () =>
      /"notespace.codeRunner.enabled": ?true/.test(
        await readFile(path.join(tmp, 'user/User/settings.json'), 'utf8'),
      ),
    'setting saved',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await poll(async () => !(await page.locator('.settings-editor').isVisible()), 'settings closed');
  // The modal settings editor may have hidden (and recreated) the Studio webview.
  studio = await frameWith(
    page,
    '.ProseMirror .code-view button.run:not([hidden])',
    'Run button after enabling',
  );
  await studio.locator('button.run:visible').click();
  const confirm = page.locator('.monaco-dialog-box');
  await confirm.waitFor();
  assert.match(await confirm.innerText(), /Run this javascript block with node/);
  await confirm.getByRole('button', { name: 'Run', exact: true }).click();
  await poll(
    async () => /Exit 0/.test(await studio.locator('.run-output:not([hidden])').innerText()),
    'run result',
  );
  assert.equal(
    (await studio.locator('.run-output:not([hidden]) .run-stdout').innerText()).trim(),
    '2',
  );
  await studio.getByRole('button', { name: 'Insert output' }).click();
  await page.keyboard.press('Control+S');
  await poll(
    async () =>
      (await readFile(path.join(workspace, 'wiki/Visuals.md'), 'utf8')).includes(
        '```javascript\nconsole.log(1 + 1)\n```\n\n```text\n2\n```',
      ),
    'output inserted as a text block',
  );
  await page.screenshot({ path: `${shots}/code-runner.png` });
  console.log(
    'PASS phase04: an enabled runner asks once, runs node for real and inserts its output',
  );

  await runCommand(page, 'NoteSpace: Open Reader Preview');
  const reader = await frameWith(page, '.reader-layout figure.chart svg', 'reader chart');
  assert.ok((await reader.locator('.api-op').count()) === 2);
  assert.ok((await reader.locator('.nb-cell').count()) === 2);
  await page.screenshot({ path: `${shots}/reader-visuals.png` });
  await axe(reader, 'reader visuals');
  console.log('PASS phase04: reader shows the same static embeds');

  // Canvas editor: add a card, save, unknown fields survive.
  await page.keyboard.press('Control+P');
  await page.locator('.quick-input-widget input[type=text]').fill('Map.canvas');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Map.canvas' })
    .first()
    .click();
  const canvas = await frameWith(page, '.viewport .node', 'canvas editor');
  assert.equal(await canvas.locator('.node').count(), 2);
  await canvas.locator('.viewport').dblclick({ position: { x: 200, y: 330 } });
  await poll(
    async () => (await canvas.locator('.node textarea').count()) === 1,
    'new card editing',
  );
  await canvas.locator('.node textarea').fill('Launch checklist');
  await canvas.locator('.viewport').click({ position: { x: 480, y: 420 } });
  await page.keyboard.press('Control+S');
  await poll(async () => {
    const saved = JSON.parse(
      await readFile(path.join(workspace, 'wiki/canvases/Map.canvas'), 'utf8'),
    );
    return (
      saved.nodes.length === 3 &&
      saved.nodes.some((n) => n.text === 'Launch checklist') &&
      saved.appData?.keep === true &&
      saved.edges.length === 1
    );
  }, 'canvas saved with unknown fields preserved');
  await page.screenshot({ path: `${shots}/canvas-editor.png` });
  await axe(canvas, 'canvas editor');
  console.log(
    'PASS phase04: canvas editor adds a card and saves JSON Canvas, keeping unknown fields',
  );

  // API playground: real requests, per-origin approval, secret storage.
  await runCommand(page, 'NoteSpace: Open API Playground');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'pets.yaml' })
    .first()
    .click();
  const api = await frameWith(
    page,
    'nav[aria-label="Operations"] button[data-op]',
    'api playground',
  );
  assert.equal(await api.locator('nav button[data-op]').count(), 2);
  await api.locator('#p-query-limit').fill('5');
  await api.getByRole('button', { name: 'Send request' }).click();
  const dialog = page.locator('.monaco-dialog-box');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), new RegExp(`127\\.0\\.0\\.1:${port}`));
  assert.equal(received.length, 0, 'nothing is sent before approval');
  await dialog.getByRole('button', { name: 'Allow' }).click();
  await poll(
    async () => /200 OK/.test(await api.locator('#response').innerText()),
    'GET response shown',
  );
  assert.equal(received[0].url, '/v1/pets?limit=5');
  assert.match(
    await api.locator('#response pre[aria-label="Response body"]').innerText(),
    /"name": "Rex"/,
  );
  console.log('PASS phase04: playground asks once per origin and shows a real response');

  await api.locator('nav button[data-op="createPet"]').click();
  assert.match(
    await api.locator('textarea[aria-label="Request body"]').inputValue(),
    /"name": "Fido"/,
  );
  await api.getByRole('button', { name: 'Set…' }).click();
  const input = page.locator('.quick-input-widget input[type=password]');
  await input.waitFor();
  await input.fill(token);
  await page.keyboard.press('Enter');
  await poll(
    async () =>
      /Stored in VS Code secret storage/.test(
        await api.locator('fieldset', { hasText: 'Authorization' }).innerText(),
      ),
    'credential stored',
  );
  assert.ok(
    !(await api.locator('body').innerHTML()).includes(token),
    'the webview never receives the secret',
  );
  await api.getByRole('button', { name: 'Send request' }).click();
  // The origin is already approved; a POST may change data, so it is confirmed every time.
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Send POST http:\/\/127\.0\.0\.1:\d+\/v1\/pets\?/);
  assert.doesNotMatch(await dialog.innerText(), /Allow NoteSpace/, 'no second origin approval');
  assert.equal(received.length, 1, 'nothing is sent before the POST is confirmed');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await poll(
    async () => /201 Created/.test(await api.locator('#response').innerText()),
    'POST response shown',
  );
  assert.equal(received.length, 2);
  assert.equal(received[1].auth, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(received[1].body), { name: 'Fido' });
  await page.screenshot({ path: `${shots}/api-playground.png` });
  await axe(api, 'api playground');
  await scanForToken(workspace);
  console.log(
    'PASS phase04: credentials live in secret storage, are sent only with the request and never written to files',
  );
  console.log('NoteSpace phase 04 journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase04.png' }).catch(() => {});
  throw error;
} finally {
  await close();
  server.close();
}

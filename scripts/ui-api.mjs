// API client journey on code-server: paste curl, send to a local server, Python code, save to a
// collection, environments, interactive ```http blocks in the reader and Studio, and wiki
// management (remove from NoteSpace, restore) from the Pages view.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/api';
await mkdir(shots, { recursive: true });

const received = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    res.writeHead(req.method === 'POST' ? 201 : 200, {
      'content-type': 'application/json',
      'set-cookie': 'sid=1; HttpOnly',
    });
    res.end(
      JSON.stringify({
        ok: true,
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      }),
    );
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

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

const page_md = `# Users API\n\nCreate a user from the docs:\n\n\`\`\`http\n# @name Create user\n# @test status == 201\nPOST ${base}/api/users\nContent-Type: application/json\n\n{\n  "name": "Mario"\n}\n\`\`\`\n`;
const files = {
  'docs/wiki.yaml': 'schemaVersion: 1\nwiki:\n  title: Docs Wiki\ncontent:\n  root: pages\n',
  'docs/pages/index.md': page_md,
  'notes/wiki.yaml': 'schemaVersion: 1\nwiki:\n  title: Notes Wiki\ncontent:\n  root: pages\n',
  'notes/pages/index.md': '# Notes\n',
};
const { page, close, workspace } = await launchCodeServer({
  files,
  settings: { 'files.autoSave': 'off' },
});
const dialog = page.locator('.monaco-dialog-box');
try {
  // 1. Paste a curl command: every part of the request is filled in; Send returns the response.
  await runCommand(page, 'NoteSpace: Open API Client');
  let f = await frameWith(page, '.app', 'API Client');
  await f
    .locator('#curl-paste')
    .fill(
      `curl '${base}/v1/users?page=2&sort=name' -H 'Accept: application/json' -b 'theme=dark' --data-raw '{"name":"Luigi"}'`,
    );
  await f.getByRole('button', { name: 'Import curl' }).click();
  await poll(
    async () => (await f.locator('#url').inputValue()) === `${base}/v1/users`,
    'URL from curl',
  );
  assert.equal(await f.locator('#method').inputValue(), 'POST');
  assert.match(await f.locator('#sub-params').innerText(), /2/);
  await f.getByRole('button', { name: 'Send', exact: true }).click();
  await poll(
    async () =>
      /201 Created/.test(
        await f
          .locator('.response-head')
          .innerText()
          .catch(() => ''),
      ),
    'response',
  );
  assert.equal(received.at(-1).url, '/v1/users?page=2&sort=name');
  assert.deepEqual(JSON.parse(received.at(-1).body), { name: 'Luigi' });
  assert.match(await f.locator('.response-body pre').innerText(), /"ok": true/);
  // A credential typed as a plain header value is flagged before it is saved to a file.
  await f.locator('#sub-headers').click();
  await f.locator('input[placeholder="Header"]').last().fill('Authorization');
  await f.locator('input[placeholder="Value"]').nth(1).fill('Bearer abc123');
  await f.locator('#sub-params').click();
  await f.locator('#sub-headers').click();
  await poll(
    async () =>
      /credential written as plain text/.test(
        await f
          .locator('.notice')
          .innerText()
          .catch(() => ''),
      ),
    'plain credential warning',
  );
  await f.locator('input[placeholder="Value"]').nth(1).fill('Bearer {{token}}');
  await f.locator('#sub-params').click();
  await f.locator('#sub-headers').click();
  assert.equal(await f.locator('.notice', { hasText: 'credential' }).count(), 0);
  await f.locator('#sub-code').click();
  await f.locator('select[aria-label=Language]').selectOption('python');
  const python = await f.locator('pre.code').first().innerText();
  assert.match(python, /params = \{\n {4}"page": "2",\n {4}"sort": "name",\n\}/);
  assert.match(python, /cookies = \{\n {4}"theme": "dark",\n\}/);
  assert.match(python, /requests\.post\(/);
  await page.screenshot({ path: `${shots}/client.png` });
  await axe(f, 'API client');
  console.log(
    'PASS api: a pasted curl command fills the request, sends for real and converts to Python requests',
  );

  // 2. Save it into a new collection (a folder of JSON files under api/).
  await f.getByRole('button', { name: /Save to collection/ }).click();
  await page.locator('.quick-input-list .monaco-list-row', { hasText: 'New collection' }).click();
  await page.locator('.quick-input-widget input[type=text]').fill('My APIs');
  await page.keyboard.press('Enter');
  const saved = path.join(workspace, 'api/my-apis');
  await poll(
    async () => (await readdir(saved).catch(() => [])).some((n) => n.endsWith('.request.json')),
    'request file',
  );
  const requestFile = (await readdir(saved)).find((n) => n.endsWith('.request.json'));
  const json = JSON.parse(await readFile(path.join(saved, requestFile), 'utf8'));
  assert.equal(json.method, 'POST');
  assert.deepEqual(json.params, [
    { key: 'page', value: '2' },
    { key: 'sort', value: 'name' },
  ]);
  f = await frameWith(page, '.app', 'API Client');
  await poll(
    async () => (await f.locator('.node .name', { hasText: 'POST users' }).count()) === 1,
    'collection tree',
  );
  console.log('PASS api: requests are saved as readable files in a collection');

  // 3. Environments hold variables; secrets go to VS Code secret storage.
  await f.getByRole('tab', { name: 'Environments' }).click();
  await f.getByRole('button', { name: 'New environment' }).click();
  await page.locator('.quick-input-widget input[type=text]').fill('Local');
  await page.keyboard.press('Enter');
  const envFile = path.join(workspace, 'api/environments/local.env.json');
  await poll(
    async () => /"baseUrl"/.test(await readFile(envFile, 'utf8').catch(() => '')),
    'environment file',
  );
  f = await frameWith(page, '.app', 'API Client');
  await f.locator('.env-row input[aria-label="Value of baseUrl"]').fill(base);
  await f.getByRole('button', { name: 'Save environment Local' }).click();
  await poll(async () => (await readFile(envFile, 'utf8')).includes(base), 'environment saved');
  console.log('PASS api: environments are files with variables');

  // Globals apply to every request in the workspace.
  await f.getByRole('button', { name: 'Add global variable' }).click();
  await f.locator('input[aria-label="Global variable"]').last().fill('who');
  await f.locator('input[aria-label="Value of global "]').last().fill('Toad');
  await f.getByRole('button', { name: 'Save globals' }).click();
  await f.locator('.tabs').getByRole('button', { name: 'New request' }).click();
  await f.locator('#url').fill(`${base}/greet/{{who}}`);
  await f.getByRole('button', { name: 'Send', exact: true }).click();
  await poll(async () => received.at(-1).url === '/greet/Toad', 'global variable in the URL');
  console.log('PASS api: global variables are applied to requests');

  // 4. A ```http block in the reader sends only on Send, after approving the origin.
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="docs"]').click();
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="pages"]').first().click();
  await page
    .locator('.explorer-folders-view .monaco-list-row[aria-label="index.md"]')
    .first()
    .click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: 'index.md' }).count()) > 0,
    'page open',
  );
  const before = received.length;
  await runCommand(page, 'NoteSpace: Open Reader Preview');
  const reader = await frameWith(page, '.http-block.interactive', 'reader http block');
  await page.waitForTimeout(800);
  assert.equal(received.length, before, 'opening the page sends nothing');
  await reader.locator('textarea.http-body').fill('{\n  "name": "Peach"\n}');
  await reader.locator('.http-send').click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Allow requests from documentation pages/);
  await dialog.getByRole('button', { name: 'Allow' }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Send POST/);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await poll(
    async () =>
      /201/.test(
        await reader
          .locator('.http-response')
          .innerText()
          .catch(() => ''),
      ),
    'reader response',
  );
  assert.deepEqual(JSON.parse(received.at(-1).body), { name: 'Peach' });
  assert.match(await reader.locator('.http-response').innerText(), /✓ status == 201/);
  await page.screenshot({ path: `${shots}/reader-block.png` });
  console.log(
    'PASS api: ```http blocks in the reader send only on Send, with approval and the edited body',
  );

  // 4b. The same block in the workspace panel's Wiki sends too, without leaving the panel.
  await runCommand(page, 'NoteSpace: Open NoteSpace');
  const ws = await frameWith(page, '.nav', 'workspace panel');
  await ws.locator('.nav [data-nav=wiki]').click();
  await poll(
    async () => (await ws.locator('.wiki-article .http-block.interactive').count()) === 1,
    'http block in the panel',
  );
  const sent = received.length;
  await ws.locator('.wiki-article .http-send').click();
  await dialog.waitFor();
  if (/Allow requests/.test(await dialog.innerText())) {
    await dialog.getByRole('button', { name: 'Allow' }).click();
    await dialog.waitFor();
  }
  assert.match(await dialog.innerText(), /Send POST/);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await poll(
    async () =>
      /201/.test(
        await ws
          .locator('.wiki-article .http-response')
          .innerText()
          .catch(() => ''),
      ),
    'panel response',
  );
  assert.equal(received.length, sent + 1);
  console.log('PASS api: ```http blocks send from the Wiki in the workspace panel');

  // 5. The same block is interactive in Studio.
  await runCommand(page, 'View: Close All Editors');
  await page
    .locator('.explorer-folders-view .monaco-list-row[aria-label="index.md"]')
    .first()
    .click();
  await runCommand(page, 'NoteSpace: Open in Studio');
  const studio = await frameWith(page, '.http-block.interactive', 'studio http block');
  await page.waitForTimeout(800);
  await studio.locator('.http-send').click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await poll(
    async () =>
      /201/.test(
        await studio
          .locator('.http-response')
          .innerText()
          .catch(() => ''),
      ),
    'studio response',
  );
  await page.screenshot({ path: `${shots}/studio-block.png` });
  console.log('PASS api: ```http blocks are interactive in Studio');

  // 6. Wiki management from the Wiki's menu: remove from NoteSpace keeps the files; restore.
  await runCommand(page, 'NoteSpace: Open NoteSpace');
  const home = await frameWith(page, '.nav', 'workspace panel');
  const wikis = () => home.locator('.nav select[aria-label=Wiki] option').allInnerTexts();
  await poll(async () => (await wikis()).includes('Notes Wiki'), 'two wikis');
  await home.locator('.nav select[aria-label=Wiki]').selectOption({ label: 'Notes Wiki' });
  await home.locator('.nav [data-nav=wiki]').click();
  await poll(
    async () => (await home.locator('.wiki-name').textContent()) === 'Notes Wiki',
    'Notes Wiki shown',
  );
  await home.locator('.wiki-side-head [aria-label="Wiki actions"]').click();
  const items = await home.locator('.menu .item').allInnerTexts();
  for (const label of [
    'Remove from NoteSpace…',
    'Delete Wiki Files…',
    'Rename Wiki…',
    'Set as Default Wiki',
    'Wiki Settings',
  ])
    assert.ok(
      items.some((i) => i.includes(label)),
      `${label} in ${items.join(', ')}`,
    );
  await home.locator('.menu .item', { hasText: 'Remove from NoteSpace' }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Remove from NoteSpace' }).click();
  await poll(async () => !(await wikis()).includes('Notes Wiki'), 'wiki removed');
  assert.match(await readFile(path.join(workspace, 'notes/pages/index.md'), 'utf8'), /# Notes/);
  await runCommand(page, 'NoteSpace: Restore Removed Wikis');
  await page.locator('.quick-input-widget').waitFor();
  await page.keyboard.press('Enter');
  await poll(async () => (await wikis()).includes('Notes Wiki'), 'wiki restored');
  console.log('PASS api: wikis are removed from NoteSpace without touching files and restored');
  console.log('NoteSpace API journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-api.png' }).catch(() => {});
  throw error;
} finally {
  await close();
  server.close();
}

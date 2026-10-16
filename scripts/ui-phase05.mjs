// Phase 05 browser journey: content health, translations, versions, local graph, Git page
// history, AI proposals and semantic search against a real local OpenAI-compatible server.
// Every data assertion checks files on disk, Git state or the requests the server received.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/phase05';
await mkdir(shots, { recursive: true });

// A real HTTP server speaking the OpenAI-compatible API used by local model servers. It is a
// deterministic stand-in for a model so the journey can verify what NoteSpace sends.
const received = [];
const words = ['docker', 'kernel', 'planner', 'install'];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    received.push({ url: req.url, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/v1/embeddings')
      res.end(
        JSON.stringify({
          data: body.input.map((t, index) => ({
            index,
            embedding: words.map((w) => t.toLowerCase().split(w).length - 1 + 0.01),
          })),
        }),
      );
    else
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '# Guide\n\nInstall the tool, then run it. See [[Setup]].\n\npassword: [REDACTED]\n',
              },
            },
          ],
        }),
      );
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const files = {
  'wiki.yaml':
    'schemaVersion: 1\nwiki:\n  title: Phase Five Docs\n  language: en\ncontent:\n  root: docs\n  homepage: index.md\ni18n:\n  languages: [it]\nversions:\n  current: "2.0"\n  archived: ["1.0"]\n',
  'docs/index.md': '# Home\n\nStart with the [[Guide]] and [[Setup]].\n',
  'docs/Guide.md':
    '# Guide\n\ninstall teh tool an run it. See [[Setup]] and [[Missing page]].\n\npassword: hunter2secret\n',
  'docs/Setup.md': '# Setup\n\n## Steps\n\nOne.\n\n## Steps\n\nTwo.\n',
  'docs/Containers.md': '# Containers\n\nDocker images and docker compose.\n',
  'docs/Orphan.md': '# Orphan\n\nNobody links here.\n',
  'docs/it/index.md': '# Inizio\n\n[[Guide]]\n',
  'docs/_versions/1.0/Guide.md': '# Guide\n\nOld instructions.\n',
  'docs/_versions/1.0/index.md': '# Home\n',
  'docs/api/pets.yaml':
    'openapi: 3.0.3\ninfo: {title: Pets, version: "1"}\npaths:\n  /pets:\n    get: {operationId: listPets, responses: {"200": {description: ok}}}\n    post: {operationId: createPet, responses: {"201": {description: ok}}}\n',
  'docs/Pets.md': '# Pets\n\nUse `GET /pets` to list pets.\n',
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
  settings: {
    'files.autoSave': 'off',
    'notespace.ai.provider': 'endpoint',
    'notespace.ai.endpoint': `http://127.0.0.1:${port}/v1`,
    'notespace.ai.model': 'local-test',
    'notespace.semanticSearch.model': 'embed-test',
  },
});
const git = (...args) =>
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
const disk = (name) => readFile(path.join(workspace, name), 'utf8');
const openPage = async (name) => {
  // The Explorer row of docs/<name>.md (level 2), not a translation or an archived copy.
  const row = page.locator(
    `.explorer-folders-view .monaco-list-row[aria-level="2"][aria-label="${name}.md"]`,
  );
  await row.click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: `${name}.md` }).count()) > 0,
    `${name} opened`,
  );
};
try {
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'Initial docs');
  // A later revision of Setup, committed before any page is opened.
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(path.join(workspace, 'docs/Setup.md'), '# Setup\n\n## Steps\n\nOne, revised.\n'),
  );
  git('commit', '-q', '-am', 'Revise setup');
  await runCommand(page, 'NoteSpace: Refresh Index');

  // Content health: computed numbers, translation coverage and API coverage; actions work.
  await runCommand(page, 'NoteSpace: Open Content Health Report');
  const health = await frameWith(page, 'main.health .tiles', 'health report');
  const tile = async (label) =>
    Number(
      (await health.locator('.tile', { hasText: label }).locator('strong').innerText()).trim(),
    );
  assert.equal(await tile('Broken links'), 1);
  assert.equal(await tile('Duplicate headings'), 0, 'the revised Setup page has one Steps heading');
  assert.equal(await tile('Without incoming links'), 3, 'Orphan, Containers and Pets');
  assert.match(
    await health.locator('#h-i18n').locator('..').innerText(),
    /it · 1\/6 translated · 0 outdated[\s\S]*1 translation has no translated_from marker/,
  );
  assert.match(
    await health.locator('#h-api').locator('..').innerText(),
    /1\/2 documented[\s\S]*POST \/pets[\s\S]*Not documented/,
  );
  await page.screenshot({ path: `${shots}/content-health.png` });
  await axe(health, 'content health');
  await health
    .locator('li', { hasText: 'Guide.md' })
    .getByRole('button', { name: 'Create translation' })
    .click();
  await poll(
    async () =>
      /^---\ntranslated_from: [0-9a-f]{16}\n---\n# Guide/.test(
        await disk('docs/it/Guide.md').catch(() => ''),
      ),
    'translation created',
  );
  console.log('PASS phase05: content health reports real problems and creates translations');

  // Reader: language and version switchers, archived banner.
  await openPage('Guide');
  await runCommand(page, 'NoteSpace: Open Reader Preview');
  let reader = await frameWith(page, '.reader-bar nav[aria-label="Version"]', 'reader switchers');
  assert.equal(await reader.locator('nav[aria-label="Language"] a', { hasText: 'it' }).count(), 1);
  await reader.locator('nav[aria-label="Version"] a', { hasText: '1.0' }).click();
  reader = await frameWith(page, '.archived-banner', 'archived page');
  assert.match(await reader.locator('article').innerText(), /Old instructions/);
  await page.screenshot({ path: `${shots}/reader-archived.png` });
  await axe(reader, 'reader archived version');
  console.log('PASS phase05: the reader switches languages and versions and marks archived pages');

  // Local graph around the active page.
  await openPage('Setup');
  await runCommand(page, 'NoteSpace: Explore Link Graph');
  const graph = await frameWith(page, 'svg.graph .graph-node', 'graph');
  const all = await graph.locator('svg.graph .graph-node').count();
  await graph.getByLabel(/Around/).check();
  await poll(
    async () => (await graph.locator('svg.graph .graph-node').count()) < all,
    'local graph',
  );
  assert.equal(await graph.locator('svg.graph .graph-node.center').count(), 1);
  await page.screenshot({ path: `${shots}/graph-local.png` });
  await axe(graph, 'local graph');
  console.log('PASS phase05: the link graph shows the active page’s neighborhood');

  // Git page history: compare and restore without touching Git.
  const head = git('rev-parse', 'HEAD');
  await openPage('Setup');
  await runCommand(page, 'NoteSpace: Show Page History');
  const history = await frameWith(
    page,
    'nav[aria-label="Commits"] button[data-index]',
    'page history',
  );
  assert.equal(await history.locator('button[data-index]').count(), 2);
  await history.locator('button[data-index="1"]').click();
  let historyFrame = await frameWith(
    page,
    'button[data-index="1"][aria-current="true"]',
    'older commit selected',
  );
  assert.match(
    await historyFrame.locator('section[aria-label="Differences"]').innerText(),
    /\+\t## Steps/,
    'the first commit added the page',
  );
  await historyFrame.getByRole('button', { name: 'From this version to now' }).click();
  historyFrame = await frameWith(
    page,
    'button[data-mode="current"][aria-pressed="true"]',
    'compare with now',
  );
  assert.match(
    await historyFrame.locator('section[aria-label="Differences"]').innerText(),
    /−\tTwo\.[\s\S]*\+\tOne, revised\./,
  );
  await page.screenshot({ path: `${shots}/page-history.png` });
  await axe(historyFrame, 'page history');
  await historyFrame.getByRole('button', { name: 'Restore this version…' }).click();
  const dialog = page.locator('.monaco-dialog-box');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await poll(
    async () => (await disk('docs/Setup.md')) === files['docs/Setup.md'],
    'restored text saved',
  );
  assert.equal(git('rev-parse', 'HEAD'), head, 'no Git commit, reset or checkout');
  console.log('PASS phase05: page history restores an older version as a normal edit');

  // AI: consent, redaction, diff review and explicit Apply.
  await openPage('Guide');
  await runCommand(page, 'NoteSpace: AI: Improve Page or Selection');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Fix grammar and clarity' })
    .click();
  const consent = page.locator('.monaco-dialog-box');
  await consent.waitFor();
  assert.match(await consent.innerText(), new RegExp(`local-test at 127\\.0\\.0\\.1:${port}`));
  assert.match(await consent.innerText(), /1 credential-like value/);
  await consent.getByRole('button', { name: 'Send' }).click();
  await poll(
    async () => (await page.locator('.tab', { hasText: 'AI proposal' }).count()) > 0,
    'proposal diff',
  );
  const chat = received.find((r) => r.url === '/v1/chat/completions');
  assert.ok(
    !JSON.stringify(chat.body).includes('hunter2secret'),
    'secrets are redacted before sending',
  );
  assert.equal(await disk('docs/Guide.md'), files['docs/Guide.md'], 'nothing changes before Apply');
  await page.screenshot({ path: `${shots}/ai-proposal.png` });
  await page.locator('.editor-actions [aria-label="Apply AI Proposal"]').first().click();
  await poll(
    async () =>
      (await disk('docs/Guide.md')).startsWith('# Guide\n\nInstall the tool, then run it.'),
    'proposal applied and saved',
  );
  console.log(
    'PASS phase05: AI suggestions are redacted, reviewed in a diff and applied only on request',
  );

  // Semantic search with the configured local embedding model.
  await runCommand(page, 'NoteSpace: Semantic Search (Local Model)');
  const build = page.locator('.monaco-dialog-box');
  await build.waitFor();
  assert.match(await build.innerText(), /The endpoint is on this machine/);
  await build.getByRole('button', { name: 'Build Index' }).click();
  await page.locator('.quick-input-widget input[type=text]').fill('docker images');
  await page.keyboard.press('Enter');
  const first = page.locator('.quick-input-list .monaco-list-row').first();
  await first.waitFor();
  assert.match(await first.innerText(), /Containers/);
  assert.ok(received.some((r) => r.url === '/v1/embeddings'));
  assert.ok(
    !received
      .filter((r) => r.url === '/v1/embeddings')
      .some((r) => JSON.stringify(r.body).includes('Old instructions')),
    'archived versions are not embedded',
  );
  await page.screenshot({ path: `${shots}/semantic-search.png` });
  await page.keyboard.press('Escape');
  console.log(
    'PASS phase05: semantic search embeds current pages with the user’s model and ranks by meaning',
  );
  // Pasting a screenshot into Studio stores it with the wiki and shows it at once.
  await openPage('Containers');
  if (
    !(
      await page
        .locator('.tab.active', { hasText: 'Containers.md' })
        .getAttribute('aria-label')
        .catch(() => '')
    )?.includes('Studio')
  )
    await runCommand(page, 'NoteSpace: Open in Studio');
  const studio = await frameWith(page, '.ProseMirror', 'Containers in Studio', async (f) =>
    /Docker images/.test(await f.locator('.ProseMirror').innerText()),
  );
  await studio.locator('.ProseMirror p').first().click();
  await studio.locator('.ProseMirror').press('End');
  await studio.evaluate(() => {
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
      ),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([png], 'image.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  await poll(
    async () =>
      studio
        .locator('.ProseMirror img[alt="image.png"]')
        .evaluate((img) => img.complete && img.naturalWidth === 8),
    'pasted image visible',
  );
  // Embeds point at existing files chosen from a list.
  await studio.locator('.ProseMirror').press('End');
  await studio.locator('.ProseMirror').press('Enter');
  await studio.locator('.ProseMirror').type('/API reference');
  await studio.locator('#menu .item[aria-selected="true"]', { hasText: 'API reference' }).waitFor();
  await studio.locator('.ProseMirror').press('Enter');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'pets.yaml' })
    .first()
    .click();
  await poll(
    async () => (await studio.locator('.code-view .api-op').count()) === 2,
    'API reference embedded',
  );
  // The code block language menu lists readable options.
  const optionColors = await studio
    .locator('.code-view select')
    .first()
    .evaluate((select) => {
      const option = getComputedStyle(select.options[1]);
      return [option.color, option.backgroundColor];
    });
  assert.notEqual(
    optionColors[0],
    optionColors[1],
    'options have distinct text and background colors',
  );
  await page.keyboard.press('Control+S');
  await poll(async () => {
    const text = await disk('docs/Containers.md');
    return (
      text.includes('![image.png](../assets/images/image.png)') &&
      text.includes('```openapi\npath: api/pets.yaml\n```')
    );
  }, 'image and embed saved');
  assert.equal((await readFile(path.join(workspace, 'assets/images/image.png'))).length > 0, true);
  await page.screenshot({ path: `${shots}/paste-image.png` });
  await axe(studio, 'studio with pasted image');
  console.log(
    'PASS phase05: pasted images are stored and shown at once; embeds pick existing files',
  );
  console.log('NoteSpace phase 05 journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase05.png' }).catch(() => {});
  throw error;
} finally {
  await close();
  server.close();
}

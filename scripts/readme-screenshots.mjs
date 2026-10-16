// Captures the README screenshots (docs/images) from the packaged VSIX on code-server, with a
// small demo workspace. Usage: npm run package && node scripts/readme-screenshots.mjs
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const out = 'docs/images';
await mkdir(out, { recursive: true });
const day = (offset) => {
  const t = new Date(Date.now() + offset * 86400000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

const server = createServer((req, res) => {
  res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 42,
      name: 'Mario Rossi',
      email: 'mario@example.com',
      roles: ['admin', 'editor'],
      active: true,
    }),
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const notebook = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
  cells: [
    {
      cell_type: 'markdown',
      metadata: {},
      source: ['## Weekly signups\n', 'A quick look at the last four weeks.'],
    },
    {
      cell_type: 'code',
      metadata: {},
      execution_count: 1,
      source: [
        'import statistics\n',
        'signups = [8, 14, 11, 19]\n',
        'print("mean:", statistics.mean(signups))',
      ],
      outputs: [{ output_type: 'stream', name: 'stdout', text: ['mean: 13\n'] }],
    },
    {
      cell_type: 'code',
      metadata: {},
      execution_count: 2,
      source: [
        'import pandas as pd\n',
        'pd.DataFrame({"week": ["W1", "W2", "W3", "W4"], "signups": signups})',
      ],
      outputs: [
        {
          output_type: 'execute_result',
          execution_count: 2,
          metadata: {},
          data: {
            'text/html': [
              '<table><tr><th></th><th>week</th><th>signups</th></tr><tr><th>0</th><td>W1</td><td>8</td></tr><tr><th>1</th><td>W2</td><td>14</td></tr><tr><th>2</th><td>W3</td><td>11</td></tr><tr><th>3</th><td>W4</td><td>19</td></tr></table>',
            ],
            'text/plain': ['…'],
          },
        },
      ],
    },
  ],
});

const files = {
  'wiki.yaml':
    'schemaVersion: 1\nwiki:\n  title: Acme Team\n  description: Docs, plans and notes of the product team\ncontent:\n  root: docs\n  homepage: index.md\n',
  'docs/index.md': `# Acme Team

Welcome! Everything here is plain Markdown in this repository.

:::grid
:::card "Guides"
[Deployment guide](guides/Deployment.md)
:::
:::card "Launch"
[Launch plan](projects/Launch.md)
:::
:::
`,
  'docs/guides/Deployment.md': `---
title: Deployment guide
tags: [ops]
---
# Deployment guide

Ship a release with confidence.

:::warning "Before you deploy"
Back up the **database** and confirm the release notes.
:::

\`\`\`mermaid
flowchart LR
  A[Commit] --> B{Tests pass?}
  B -->|yes| C[Build]
  B -->|no| D[Fix]
  C --> E[Deploy]
\`\`\`

\`\`\`chart
type: bar
title: Deploys per week
x: week
y: deploys
---
week,deploys
W1,4
W2,7
W3,5
W4,9
\`\`\`

| Stage | Owner | Duration |
| --- | --- | --- |
| Build | CI | 3 min |
| Deploy | Ops | 5 min |
`,
  'docs/projects/Launch.md': `# Launch plan

- [ ] Write the announcement due:${day(1)} priority:high #marketing
- [ ] Book the venue status:doing due:${day(3)} @giulia
- [ ] Order badges status:blocked
- [x] Pick the date done:${day(-2)}
- [ ] Record the demo video due:${day(5)} #video

\`\`\`tasks
page: this
view: board
title: Launch board
\`\`\`
`,
  'docs/api/Users.md': `# Users API

\`\`\`http
# @name Get user
# @test status == 200
GET ${base}/api/users/42
Accept: application/json
\`\`\`
`,
  'docs/boards/development.md': `---
notespace:
  type: board
  id: b-dev001
  name: Development
  color: blue
  default_column: backlog
  columns:
    - { id: backlog, title: Backlog, color: gray }
    - { id: developing, title: Developing, color: blue }
    - { id: review, title: In review, color: purple }
    - { id: released, title: Released, color: green, completed: true }
---

# Development

- [ ] New homepage col:developing priority:high due:${day(2)} #web
- [ ] Task filtering col:backlog #planner
- [ ] Dark mode polish col:review @luca
- [ ] Export to PDF col:developing due:${day(6)}
- [ ] Search shortcuts col:backlog priority:low
- [x] Login with SSO col:released done:${day(-1)}
`,
  [`docs/journal/${day(0)}.md`]: `# ${day(0)}\n\n- [ ] Review pull requests due:${day(0)} priority:medium\n- [ ] 1:1 with Sara due:${day(0)}\n- [x] Standup notes done:${day(0)}\n`,
  'docs/notebooks/Signups.ipynb': notebook,
};

const { page, close } = await launchCodeServer({ files, settings: { 'files.autoSave': 'off' } });
const shot = async (name) => {
  await page.mouse.move(24, 520);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
};
const open = async (label) => {
  await runCommand(page, 'NoteSpace: Search Pages');
  await page.locator('.quick-input-widget input[type=text]').fill(label);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
};
try {
  await runCommand(page, 'NoteSpace: Open Home');
  const panel = await frameWith(page, '.nav', 'workspace panel');
  await page.locator('.activitybar [aria-label^="NoteSpace"]').first().click();
  await panel.locator('.home-card', { hasText: 'Today' }).waitFor();
  await shot('home');

  await panel.locator('.nav button, .nav a', { hasText: 'Boards' }).first().click();
  await page.waitForTimeout(800);
  await panel
    .locator('.board-card, .card, [data-board]', { hasText: 'Development' })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(800);
  await shot('kanban');

  await panel.locator('.nav button, .nav a', { hasText: 'Calendar' }).first().click();
  await shot('calendar');

  await panel.locator('.nav button, .nav a', { hasText: 'Tasks' }).first().click();
  await shot('tasks');

  await runCommand(page, 'View: Close All Editors');
  await open('Deployment guide');
  await frameWith(page, '.ProseMirror', 'studio');
  await shot('studio');

  await runCommand(page, 'NoteSpace: Open Reader Preview');
  await page.waitForTimeout(800);
  await runCommand(page, 'View: Close Editors in Other Groups');
  const reader = await frameWith(page, '.reader', 'reader');
  await reader
    .locator('.chart, svg')
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await shot('reader');

  await runCommand(page, 'View: Close All Editors');
  await open('Launch plan');
  const studio = await frameWith(page, '.collection-board.interactive', 'embedded board');
  await studio.locator('.collection-board').scrollIntoViewIfNeeded();
  await shot('page-kanban');

  await runCommand(page, 'View: Close All Editors');
  await page.locator('.activitybar [aria-label^="Explorer"]').first().click();
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="docs"]').click();
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="notebooks"]').click();
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="Signups.ipynb"]').click();
  await page.waitForTimeout(1500);
  await runCommand(page, 'NoteSpace: Preview Notebook (Saved Outputs)');
  await frameWith(page, 'table', 'notebook preview');
  await shot('jupyter');

  await runCommand(page, 'View: Close All Editors');
  await runCommand(page, 'NoteSpace: Open API Client');
  const api = await frameWith(page, '.app', 'API client');
  await api
    .locator('#curl-paste')
    .fill(`curl '${base}/api/users/42?expand=roles' -H 'Accept: application/json'`);
  await api.getByRole('button', { name: 'Import curl' }).click();
  await poll(
    async () => (await api.locator('#url').inputValue()).startsWith(base),
    'curl imported',
  );
  await api.getByRole('button', { name: 'Send', exact: true }).click();
  await poll(
    async () =>
      /200/.test(
        await api
          .locator('.response-head')
          .innerText()
          .catch(() => ''),
      ),
    'response',
  );
  // Save it in a collection so the sidebar looks like a real project.
  await api.getByRole('button', { name: /Save to collection/ }).click();
  await page.locator('.quick-input-list .monaco-list-row', { hasText: 'New collection' }).click();
  await page.locator('.quick-input-widget input[type=text]').fill('Acme API');
  await page.keyboard.press('Enter');
  await poll(async () => (await api.locator('.node .name').count()) > 0, 'collection saved');
  await api.locator('#sub-code').click();
  await api.locator('select[aria-label=Language]').selectOption('python');
  await page.waitForTimeout(5000); // let the "Saved." toast fade
  await shot('api-client');

  // An interactive ```http block in a documentation page.
  await runCommand(page, 'View: Close All Editors');
  await open('Users API');
  await runCommand(page, 'NoteSpace: Open Reader Preview');
  await page.waitForTimeout(800);
  await runCommand(page, 'View: Close Editors in Other Groups');
  const doc = await frameWith(page, '.http-block.interactive', 'http block');
  await doc.locator('.http-send').click();
  const dialog = page.locator('.monaco-dialog-box');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Allow' }).click();
  await poll(
    async () =>
      /200/.test(
        await doc
          .locator('.http-response')
          .innerText()
          .catch(() => ''),
      ),
    'block response',
  );
  await shot('http-block');
} finally {
  await close();
  server.close();
}

// Unified workspace journey on code-server: Home, navigation, the Wiki reader, quick create,
// multiple boards with custom columns, inline editing, keyboard moves, the task panel, the
// calendar and responsive layouts — every change checked in the Markdown files.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/workspace';
await mkdir(shots, { recursive: true });
// The local date, as the extension uses it (UTC differs around midnight).
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const files = {
  'wiki.yaml':
    'schemaVersion: 1\nwiki:\n  title: Acme Docs\n  description: Product and team notes\ncontent:\n  root: docs\n  homepage: index.md\n',
  'docs/index.md':
    '# Acme Docs\n\nWelcome to the docs. Start with [[Setup]].\n\n## Overview\n\n:::tabs\n:::tab "Mac"\nUse brew.\n:::\n:::tab "Linux"\nUse apt.\n:::\n:::\n\n## More\n\n- [ ] Draft welcome\n\n```tasks\npage: this\nview: board\n```\n',
  'docs/projects/index.md': '# Projects\n\nAll projects.\n',
  'docs/projects/apollo.md':
    '---\nstatus: active\nowner: Ana\npoints: 8\n---\n# Apollo\n\nGo to the moon.\n\n[New meeting](template:Meeting)\n',
  'docs/projects/gemini.md':
    '---\nstatus: done\nowner: Bo\npoints: 5\n---\n# Gemini\n\nTwo seats.\n',
  'docs/guide/deploy.md':
    '---\nstatus: deprecated\nicon: rocket\ntags: [ops]\n---\n# Deploy\n\nFinish the setup before you ship.\n',
  'docs/guide/setup.md': `# Setup\n\n- [ ] Write install guide due:${today} priority:high #docs\n- [ ] Review API page\n- [ ] Check links\n`,
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
const file = (p) => readFile(path.join(workspace, 'docs', p), 'utf8').catch(() => '');
const panel = () => frameWith(page, '.nav', 'workspace panel');
try {
  // 1. Home is the entry point; navigation between destinations keeps one tab.
  await runCommand(page, 'NoteSpace: Open NoteSpace');
  let f = await panel();
  await poll(
    async () => /Acme Docs/.test(await f.locator('.home-title h1').innerText()),
    'home header',
  );
  assert.equal(await f.locator('.nav [aria-current=page]').innerText(), 'Home');
  assert.match(
    await f.locator('.home-card', { hasText: 'Today' }).innerText(),
    /Write install guide/,
  );
  // Inline completion from Home writes the Markdown line.
  await f
    .locator('.home-card .row', { hasText: 'Write install guide' })
    .locator('input[type=checkbox]')
    .click();
  await poll(
    async () => /- \[x\] Write install guide/.test(await file('guide/setup.md')),
    'completed from home',
  );
  // Quick add on Home: today's due date, written to the inbox (global capture).
  await f.locator('#home-add').fill('Call the printer');
  await f.locator('#home-add').press('Enter');
  await poll(
    async () => new RegExp(`- \\[ \\] Call the printer due:${today}`).test(await file('Inbox.md')),
    'quick add to inbox',
  );
  await page.screenshot({ path: `${shots}/home.png` });
  await axe(f, 'home');
  console.log('PASS workspace: Home shows today, completes and captures tasks into Markdown');

  // The guide (?) has its own search; Find (/) does not list its topics.
  await f.locator('.header-bar [aria-label="Guide (?)"]').click();
  await f.locator('.help').waitFor();
  await f.locator('.help-search').fill('pdf');
  await poll(
    async () => (await f.locator('.help-topic').first().textContent()) === 'Export to PDF',
    'guide search',
  );
  await axe(f, 'guide');
  await f.locator('.help-search').press('Escape');
  await poll(async () => (await f.locator('.help').count()) === 0, 'guide closed');
  // Clicking the wiki's name renames it (wiki.title in wiki.yaml).
  const wikiName = await f.locator('.brand-name').textContent();
  await f.locator('.brand').click();
  await f.locator('.brand-input').fill('Renamed wiki');
  await f.locator('.brand-input').press('Enter');
  await poll(
    async () =>
      /title: Renamed wiki/.test(await readFile(path.join(workspace, 'wiki.yaml'), 'utf8')),
    'wiki renamed',
  );
  await f.locator('.brand').click();
  await f.locator('.brand-input').fill(wikiName);
  await f.locator('.brand-input').press('Enter');
  await poll(
    async () =>
      new RegExp(`title: ${wikiName}`).test(
        await readFile(path.join(workspace, 'wiki.yaml'), 'utf8'),
      ),
    'name restored',
  );
  await poll(async () => (await f.locator('.brand-name').textContent()) === wikiName, 'name shown');
  console.log('PASS workspace: guide with its own search; renaming the wiki from its name');

  // 2. Wiki reads pages inside the panel: a page tree, the page and its outline; links, Back
  // and Forward stay in the panel, Edit opens the real document.
  await f.locator('.nav [data-nav=wiki]').click();
  await poll(
    async () => /Welcome to the docs/.test(await f.locator('.wiki-article').innerText()),
    'wiki homepage rendered in the panel',
  );
  assert.equal(await f.locator('.nav [aria-current=page]').innerText(), 'Wiki');
  assert.match(await f.locator('.wiki-nav').innerText(), /Guide/);
  assert.match(await f.locator('.wiki-toc').innerText(), /Overview/);
  // Interactive blocks work in the panel as in the Reader: tabs and an embedded board.
  assert.equal(await f.locator('.wiki-article .rich-tab-button').count(), 2);
  await f.locator('.wiki-article .rich-tab-button', { hasText: 'Linux' }).click();
  assert.ok(await f.locator('.wiki-article .rich-tab-panel', { hasText: 'Use apt' }).isVisible());
  await f.locator('.wiki-article .collection-card', { hasText: 'Draft welcome' }).first().focus();
  await page.keyboard.press('Alt+ArrowRight');
  await poll(
    async () => /^- \[ \] Draft welcome status:doing$/m.test(await file('index.md')),
    'embedded board move from the panel',
  );
  assert.match(
    await f.locator('.wiki-article').innerText(),
    /Welcome to the docs/,
    'no navigation',
  );
  await f.locator('.wiki-article a', { hasText: 'Setup' }).click();
  await poll(
    async () => /Write install guide/.test(await f.locator('.wiki-article').innerText()),
    'wiki link followed in the panel',
  );
  assert.match(await f.locator('.wiki-node.current').innerText(), /Setup/);
  // Tasks read as checkboxes with badges; ticking one writes the line.
  assert.ok(!/priority:|due:/.test(await f.locator('.wiki-article').innerText()));
  assert.equal(await f.locator('.wiki-article .task-badge.priority.high').count(), 1);
  await f.locator('.wiki-article li', { hasText: 'Check links' }).locator('.task-check').click();
  await poll(
    async () => /^- \[x\] Check links/m.test(await file('guide/setup.md')),
    'task checked from the wiki page',
  );
  await poll(
    async () =>
      (await f.locator('.wiki-article li.done', { hasText: 'Check links' }).count()) === 1,
    'page re-rendered with the task done',
  );
  await page.screenshot({ path: `${shots}/wiki.png` });
  await axe(f, 'wiki');
  await f.locator('.history button[aria-label^=Back]').click();
  await poll(
    async () => /Welcome to the docs/.test(await f.locator('.wiki-article').innerText()),
    'back to the homepage',
  );
  await f.locator('.history button[aria-label^=Forward]').click();
  await poll(
    async () => /Write install guide/.test(await f.locator('.wiki-article').innerText()),
    'forward to setup',
  );
  await f.locator('.wiki-head [aria-label="Edit this page"]').click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: /setup/i }).count()) > 0,
    'edit opens the page',
  );
  await page.locator('.tab', { hasText: 'NoteSpace' }).first().click();
  f = await panel();
  // API is a destination of the panel too: same navigation, and Back returns to the page.
  await f.locator('.nav [data-nav=api]').click();
  const api = await frameWith(page, '.app .side-tabs', 'API Client in the panel');
  assert.ok(await api.locator('.side-tabs').isVisible());
  assert.equal(await f.locator('.nav [aria-current=page]').innerText(), 'API');
  await page.screenshot({ path: `${shots}/api.png` });
  await f.locator('.history button[aria-label^=Back]').click();
  await poll(
    async () =>
      (await f.locator('.api-host').isHidden()) &&
      /Setup/.test(await f.locator('.wiki-article').innerText()),
    'back from API to the wiki page',
  );
  // Status badges and icons from the front matter; unlinked mentions become links on request.
  assert.match(
    await f.locator('.wiki-node.page', { hasText: 'Deploy' }).locator('.status-badge').innerText(),
    /Deprecated/,
  );
  assert.equal(await f.locator('.wiki-node.page', { hasText: 'Deploy' }).locator('svg').count(), 1);
  await poll(
    async () =>
      /Deploy/.test(
        await f
          .locator('.wiki-mentions')
          .innerText()
          .catch(() => ''),
      ),
    'unlinked mention of Setup in Deploy',
  );
  await f
    .locator('.wiki-mentions li', { hasText: 'Deploy' })
    .locator('button', { hasText: 'Link' })
    .click();
  await poll(
    async () =>
      /Finish the \[\[Setup\|setup\]\] before you ship\./.test(await file('guide/deploy.md')),
    'mention linked in the Markdown file',
  );
  await poll(
    async () =>
      (await f.locator('.wiki-mentions').count()) === 0 &&
      /Deploy/.test(await f.locator('.wiki-backlinks').innerText()),
    'the mention is now a backlink',
  );
  // Hovering a link previews the page; tags open the tag index.
  await f.locator('.wiki-backlinks button', { hasText: 'Deploy' }).click();
  await poll(
    async () => /Finish the/.test(await f.locator('.wiki-article').innerText()),
    'deploy page',
  );
  await f.locator('.wiki-article a', { hasText: 'setup' }).hover();
  await poll(
    async () =>
      /Setup[\s\S]*guide\/setup\.md/.test(
        await f
          .locator('.wiki-preview')
          .innerText()
          .catch(() => ''),
      ),
    'link preview',
  );
  await f.locator('.wiki-article .tags .tag', { hasText: 'ops' }).click();
  await poll(
    async () => /#ops[\s\S]*Deploy/.test(await f.locator('.wiki-content').innerText()),
    'tag index for ops',
  );
  await axe(f, 'tag index');
  await f.locator('.history button[aria-label^=Back]').click();
  await poll(
    async () => /Finish the/.test(await f.locator('.wiki-article').innerText()),
    'back from the tag index',
  );
  console.log('PASS workspace: status, icons, link previews, unlinked mentions and tags');

  // A folder as a database: cells edit each page's front matter; a new row is a new page.
  await f.locator('.wiki-node.section', { hasText: 'Projects' }).locator('.wiki-link').click();
  await f.locator('.wiki-head button', { hasText: 'Database' }).click();
  await poll(async () => (await f.locator('.db-table tbody tr').count()) === 2, 'database rows');
  assert.match(await f.locator('.db-table thead').innerText(), /owner[\s\S]*points[\s\S]*status/);
  await f
    .locator('.db-table tr', { hasText: 'Gemini' })
    .locator('.prop-value[aria-label^="Gemini owner"]')
    .click();
  await f.locator('.db-table .prop-input').fill('Cy');
  await f.locator('.db-table .prop-input').press('Enter');
  await poll(
    async () => /^owner: Cy$/m.test(await file('projects/gemini.md')),
    'database cell written to the front matter',
  );
  await poll(
    async () => /Cy/.test(await f.locator('.db-table tr', { hasText: 'Gemini' }).innerText()),
    'row refreshed',
  );
  await axe(f, 'database');
  await f.locator('.db-toolbar button', { hasText: 'Board' }).click();
  assert.match(
    await f.locator('.db-board').innerText(),
    /active[\s\S]*Apollo[\s\S]*done[\s\S]*Gemini/,
  );
  await f.locator('.db-toolbar button', { hasText: 'New page' }).click();
  await f.locator('.modal input').fill('Mercury');
  await f.locator('.modal button[type=submit]').click();
  await poll(async () => /# Mercury/.test(await file('projects/mercury.md')), 'new database page');
  await f.locator('.db-toolbar button', { hasText: 'Table' }).click();
  // Page properties under the title edit the same front matter.
  await f.locator('.db-title', { hasText: 'Apollo' }).click();
  await poll(
    async () => (await f.locator('.wiki-article .wiki-props').count()) === 1,
    'properties panel',
  );
  await f.locator('.wiki-props .prop-value[aria-label^="points"]').click();
  await f.locator('.wiki-props .prop-input').fill('13');
  await f.locator('.wiki-props .prop-input').press('Enter');
  await poll(async () => /^points: 13$/m.test(await file('projects/apollo.md')), 'property edited');
  // A template button in the page and the template gallery create pages from templates.
  await f.locator('.wiki-article a.template-button', { hasText: 'New meeting' }).click();
  const input = page.locator('.quick-input-widget input');
  await input.waitFor();
  await input.fill('projects/Kickoff');
  await input.press('Enter');
  await poll(
    async () => /## Agenda/.test(await file('projects/kickoff.md')),
    'page from template button',
  );
  await page.locator('.tab', { hasText: 'NoteSpace' }).first().click();
  f = await panel();
  // The webview takes focus a moment after the tab click, and focus changes close open menus.
  await poll(async () => {
    await f.locator('.nav [aria-label=Create]').click();
    return f
      .locator('.menu .item', { hasText: 'Page from template' })
      .click({ timeout: 2000 })
      .then(
        () => true,
        () => false,
      );
  }, 'Create menu');
  await f.locator('.template-item', { hasText: 'Project' }).click();
  assert.match(await f.locator('.template-preview').innerText(), /Goals/);
  await f.locator('.modal input.field').fill('Roadmap');
  await f.locator('.modal button[type=submit]').click();
  await poll(
    async () => /## Goals/.test((await file('projects/roadmap.md')) || (await file('roadmap.md'))),
    'page from the gallery',
  );
  // The new pages opened in editors beside the tab: close them and come back.
  await runCommand(page, 'View: Close All Editors');
  await runCommand(page, 'NoteSpace: Open NoteSpace');
  f = await panel();
  console.log('PASS workspace: databases, page properties and templates');
  await f.locator('.nav [data-nav=home]').click();
  console.log('PASS workspace: Wiki reads pages in the panel with tree, outline, Back and Forward');
  console.log('PASS workspace: API opens inside the panel and Back returns to the page');

  // 3. Quick Create → Kanban board: name, file and template, written as a board page.
  await f.locator('.home-head .btn.primary', { hasText: 'Create' }).click();
  await f.locator('.menu .item', { hasText: 'Kanban board' }).click();
  await f.locator('.modal input').first().fill('Content Plan');
  assert.equal(await f.locator('.modal input').nth(1).inputValue(), 'boards/content-plan.md');
  await f.locator('.modal select').first().selectOption('content');
  await f.locator('.modal button[type=submit]').click();
  await poll(async () => /type: board/.test(await file('boards/content-plan.md')), 'board file');
  f = await panel();
  await poll(
    async () => (await f.locator('.board-view .column').count()) === 5,
    'board opened with five columns',
  );
  assert.deepEqual(await f.locator('.column .col-title').allInnerTexts(), [
    'Ideas',
    'Script',
    'Recording',
    'Editing',
    'Published',
  ]);
  console.log('PASS workspace: a board is created from Quick Create with its own file and columns');

  // 4. Columns: add, rename inline, and cards in a specific column go to the board's file.
  await f.locator('.board-head button', { hasText: 'Column' }).click();
  await f.locator('.modal input[type=text]').fill('Review');
  await f.locator('.modal button[type=submit]').click();
  await poll(
    async () => /id: review\n\s+title: Review/.test(await file('boards/content-plan.md')),
    'column added',
  );
  f = await panel();
  await f.locator('.column[data-column=script] .col-title').click();
  await f.locator('.column[data-column=script] input.inline-edit').fill('Draft');
  await f.locator('.column[data-column=script] input.inline-edit').press('Enter');
  await poll(
    async () => /id: script\n\s+title: Draft/.test(await file('boards/content-plan.md')),
    'column renamed (id kept)',
  );
  f = await panel();
  await f.locator('.column[data-column=ideas] input.add').fill('Launch video');
  await f.locator('.column[data-column=ideas] input.add').press('Enter');
  await f.locator('.column[data-column=ideas] input.add').fill('Blog post');
  await f.locator('.column[data-column=ideas] input.add').press('Enter');
  await poll(
    async () =>
      /- \[ \] Launch video col:ideas\n- \[ \] Blog post col:ideas/.test(
        await file('boards/content-plan.md'),
      ),
    'cards in board file',
  ).catch(async (e) => {
    throw new Error(`${e.message}\n${await file('boards/content-plan.md')}`);
  });
  assert.doesNotMatch(await file('Inbox.md'), /Launch video/, 'board cards are not in the inbox');
  console.log('PASS workspace: columns are added and renamed inline; cards go to the board file');

  // 5. Inline title editing on a card: Escape cancels, Enter saves.
  f = await panel();
  const cardTitle = () => f.locator('.card', { hasText: 'Launch video' }).locator('.card-title');
  await poll(async () => (await cardTitle().count()) === 1, 'card rendered');
  await cardTitle().click();
  await f.locator('.card input.inline-edit').fill('Ignored');
  await f.locator('.card input.inline-edit').press('Escape');
  await poll(
    async () => (await f.locator('.card .card-title', { hasText: 'Launch video' }).count()) === 1,
    'escape cancels',
  );
  await cardTitle().click();
  await f.locator('.card input.inline-edit').fill('Launch video teaser');
  await f.locator('.card input.inline-edit').press('Enter');
  await poll(
    async () => /- \[ \] Launch video teaser col:ideas/.test(await file('boards/content-plan.md')),
    'title saved',
  );
  console.log('PASS workspace: card titles edit inline (Enter saves, Escape cancels)');

  // 6. Keyboard moves (Alt+→ between columns), context menu, and a completed column.
  f = await panel();
  await poll(
    async () => (await f.locator('.card', { hasText: 'Launch video teaser' }).count()) === 1,
    'renamed card',
  );
  await page.waitForTimeout(600);
  await f.locator('.card', { hasText: 'Launch video teaser' }).press('Alt+ArrowRight');
  await poll(
    async () => /Launch video teaser col:script/.test(await file('boards/content-plan.md')),
    'keyboard move',
  );
  f = await panel();
  await f.locator('.card', { hasText: 'Blog post' }).click({ button: 'right' });
  await f.locator('.menu .item', { hasText: 'Move to column' }).click();
  await f.locator('.menu .item', { hasText: 'Published' }).click();
  await poll(
    async () =>
      /- \[x\] Blog post col:published done:\d{4}-\d{2}-\d{2}/.test(
        await file('boards/content-plan.md'),
      ),
    'completed column checks the box',
  );
  await page.screenshot({ path: `${shots}/board.png` });
  f = await panel();
  await axe(f, 'board');
  console.log(
    'PASS workspace: cards move by keyboard and context menu; completed columns check the box',
  );

  // 7. Deleting a column with cards requires moving them.
  await f.locator('.column[data-column=script] header button[aria-label$="actions"]').click();
  await f.locator('.menu .item', { hasText: 'Delete column' }).click();
  await f.locator('.modal select').selectOption('editing');
  await f.locator('.modal button[type=submit]').click();
  await poll(async () => {
    const text = await file('boards/content-plan.md');
    return /Launch video teaser col:editing/.test(text) && !/id: script/.test(text);
  }, 'column removed after moving its card');
  console.log('PASS workspace: a column with cards is removed only after moving them');

  // 8. The task panel edits details; a note task joins the board without moving.
  f = await panel();
  await f.locator('.card', { hasText: 'Launch video teaser' }).click({ position: { x: 4, y: 30 } });
  await f.locator('.detail').waitFor();
  // Let refreshes from the previous steps settle, then set the date in one step.
  await page.waitForTimeout(800);
  await f.locator('.detail #f-due').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, today);
  await poll(
    async () =>
      new RegExp(`Launch video teaser col:editing due:${today}`).test(
        await file('boards/content-plan.md'),
      ),
    'due from details',
  ).catch(async (e) => {
    throw new Error(
      `${e.message}\n${await file('boards/content-plan.md')}\n${await f
        .locator('.toast')
        .innerText()
        .catch(() => 'no toast')}`.slice(0, 3000),
    );
  });
  await f.locator('.detail button[aria-label="Close details"]').click();
  await f.locator('.nav [data-nav=tasks]').click();
  f = await panel();
  await f.locator('.tabs button', { hasText: 'All open' }).click();
  await f.locator('.row', { hasText: 'Review API page' }).click({ button: 'right' });
  await f.locator('.menu .item', { hasText: 'Add to board' }).click();
  await f.locator('.menu .item', { hasText: 'Content Plan' }).click();
  await poll(
    async () =>
      /- \[ \] Review API page board:b-[a-z0-9]+ col:ideas/.test(await file('guide/setup.md')),
    'note task linked to board',
  );
  await page.screenshot({ path: `${shots}/tasks.png` });
  console.log('PASS workspace: the task panel edits details; note tasks join boards in place');

  // 9. A second board is independent; the switcher moves between boards.
  await f.locator('.subnav [data-nav=boards]').click();
  f = await panel();
  await f.locator('.section-head button', { hasText: 'New board' }).click();
  await f.locator('.modal input').first().fill('Dev');
  await f.locator('.modal button[type=submit]').click();
  await poll(async () => /name: Dev/.test(await file('boards/dev.md')), 'second board');
  f = await panel();
  await poll(
    async () => (await f.locator('.board-switcher').inputValue()).startsWith('b-'),
    'switcher',
  );
  assert.deepEqual(await f.locator('.column .col-title').allInnerTexts(), [
    'To do',
    'Doing',
    'Done',
  ]);
  assert.equal(await f.locator('.card').count(), 0, 'cards of the other board are not shown');
  assert.match(await f.locator('.board-hint').innerText(), /Your board is ready/);
  const options = await f.locator('.board-switcher option').allInnerTexts();
  assert.ok(options.includes('Content Plan') && options.includes('Dev'));
  await f.locator('.board-switcher').selectOption({ label: 'Content Plan' });
  await poll(async () => (await f.locator('.card').count()) >= 3, 'switched back');
  console.log('PASS workspace: boards are independent and the switcher changes board');

  // 10. Calendar shows the same task (a page of Tasks); keyboard navigation between sections.
  await f.locator('.subnav [data-nav=calendar]').click();
  f = await panel();
  await poll(
    async () => (await f.locator('.subnav [aria-current=page]').innerText()) === 'Calendar',
    'calendar under Tasks',
  );
  assert.match(await f.locator('.nav [aria-current=page]').innerText(), /^Tasks/);
  assert.ok(
    (await f
      .locator(`.day[data-date="${today}"] .item`, { hasText: 'Launch video teaser' })
      .count()) === 1,
    'board task on the calendar',
  );
  await page.screenshot({ path: `${shots}/calendar.png` });
  await page.keyboard.press('Alt+1');
  await poll(
    async () => (await f.locator('.nav [aria-current=page]').innerText()) === 'Home',
    'Alt+1 home',
  );
  assert.match(await f.locator('.home-card', { hasText: 'My boards' }).innerText(), /Content Plan/);
  // A section reopens on the page last shown in it.
  await page.keyboard.press('Alt+3');
  await poll(
    async () => (await f.locator('.subnav [aria-current=page]').innerText()) === 'Calendar',
    'Alt+3 back to the calendar',
  );
  // Find (/ or the Search button) goes to pages, tasks and boards.
  await f.locator('.nav .finder-button').click();
  await f.locator('.finder input').fill('content plan');
  await f.locator('.finder-item', { hasText: 'Content Plan' }).first().waitFor();
  await page.keyboard.press('Enter');
  await poll(
    async () =>
      (await f
        .locator('.board-switcher')
        .inputValue()
        .catch(() => '')) !== '',
    'board opened from Find',
  );
  console.log('PASS workspace: calendar and keyboard navigation use the same tasks');

  // 11. Narrow editor: secondary controls collapse, content stays usable.
  await page.setViewportSize({ width: 760, height: 900 });
  await page.waitForTimeout(800);
  f = await panel();
  const overflow = await f.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflow <= 1, `no horizontal page scroll at 760 px (${overflow})`);
  await page.screenshot({ path: `${shots}/narrow.png` });
  console.log('PASS workspace: narrow layout without horizontal scrolling');
  console.log('NoteSpace workspace journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-workspace.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

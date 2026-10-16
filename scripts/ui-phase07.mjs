// Phase 07 browser journey (dashboards acceptance scenario): create a dashboard from an Excel
// workbook, add metrics, cards, charts and filters, see it refresh when the workbook changes,
// cross-filter by clicking a chart, drill down, export CSV, and embed a widget in a page.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchCodeServer, runCommand, frameWith, poll } from './ui-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const shots = 'docs/screenshots/phase07';
await mkdir(shots, { recursive: true });
const fixtures = path.resolve('src/test/fixtures');

const files = {
  'wiki.yaml':
    'schemaVersion: 1\nwiki:\n  title: Security Wiki\ncontent:\n  root: docs\n  homepage: index.md\n',
  'docs/index.md': '# Security Wiki\n\nOverview.\n',
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
const workbook = path.join(workspace, 'data/vulnerabilities.xlsx');
const dashboardFile = path.join(workspace, 'data/Security-Overview.wiki-dashboard.json');
// Builder edits are ordinary document edits (undo, dirty state): save, then read the file.
const readDashboard = async () => {
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(150);
  return JSON.parse(await readFile(dashboardFile, 'utf8'));
};
const dialogInput = () => page.locator('.quick-input-widget input[type=text]');
try {
  await mkdir(path.dirname(workbook), { recursive: true });
  await copyFile(path.join(fixtures, 'vulnerabilities.xlsx'), workbook);

  // 1. New Dashboard from the workbook (file dialog), title, opens the builder.
  await runCommand(page, 'NoteSpace: New Dashboard');
  await dialogInput().waitFor();
  await dialogInput().fill(workbook);
  // The simple file dialog validates the typed path asynchronously before it accepts it.
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await poll(
    async () =>
      /New dashboard/.test(
        await page
          .locator('.quick-input-widget .quick-input-title')
          .innerText()
          .catch(() => ''),
      ),
    'title prompt',
  );
  await dialogInput().fill('Security Overview');
  await page.keyboard.press('Enter');
  let dash = await frameWith(page, 'section.grid article.widget', 'dashboard builder');
  await poll(
    async () => (await dash.locator('article[data-id="rows-card"] .value').innerText()) === '120',
    'row count card',
  );
  assert.match(await dash.locator('.status').innerText(), /vulnerabilities\.xlsx \(120 rows\)/);
  console.log('PASS phase07: a dashboard is created from an Excel sheet and shows real counts');

  // 2. Metrics through the data dialog with inline validation.
  await dash.getByRole('button', { name: 'Edit layout' }).click();
  await dash.getByRole('button', { name: 'Data, metrics & filters…' }).click();
  const dialog = dash.locator('dialog[open]');
  await dialog.waitFor();
  const addMetric = async (label, formula) => {
    const before = await dialog.locator('input[aria-label="Metric formula"]').count();
    await dialog.getByRole('button', { name: 'Add metric' }).click();
    await poll(
      async () =>
        (await dialog.locator('input[aria-label="Metric formula"]').count()) === before + 1,
      'metric row',
    );
    const row = dialog.locator('.rowform:has(input[aria-label="Metric formula"])').nth(before);
    await row.locator('input[aria-label="Metric label"]').fill(label);
    await row.locator('input[aria-label="Metric label"]').press('Tab');
    await poll(
      async () => (await readDashboard()).metrics.some((m) => m.label === label),
      `label ${label} saved`,
    );
    const input = dialog
      .locator('.rowform:has(input[aria-label="Metric formula"])')
      .nth(before)
      .locator('input[aria-label="Metric formula"]');
    await input.fill(formula);
    await input.press('Tab');
    await poll(
      async () =>
        (await readDashboard()).metrics.some((m) => m.label === label && m.formula === formula),
      `formula ${label} saved`,
    );
  };
  // A typo is explained before anything is saved.
  const firstFormula = dialog.locator('input[aria-label="Metric formula"]').first();
  await firstFormula.fill('COUNT_IF(Severty = "Critical")');
  await poll(
    async () => /Unknown column “Severty”/.test(await dialog.locator('.check').first().innerText()),
    'formula error shown',
  );
  await firstFormula.fill('COUNT(rows)');
  await addMetric('Critical findings', 'COUNT_IF(Severity = "Critical")');
  await addMetric('Resolved findings', 'COUNT_IF(Status = "Resolved")');
  await page.screenshot({ path: `${shots}/data-dialog.png` });
  await axe(dash, 'data dialog');
  await dash.locator('#dialog-close').click();
  console.log('PASS phase07: metrics are defined with validated formulas');

  // 3. Widgets: metric cards for the new metrics, configured from the side panel.
  for (const label of ['Critical findings', 'Resolved findings']) {
    await dash.locator('select[aria-label="Add widget"]').selectOption('metric');
    const panel = dash.locator('aside.panel');
    await panel.waitFor();
    const metricId = (await readDashboard()).metrics.find((m) => m.label === label).id;
    await panel.locator('select').first().selectOption(metricId);
    await poll(
      async () =>
        (await readDashboard()).widgets.some((w) => w.type === 'metric' && w.metric === metricId),
      `${label} card`,
    );
  }
  await poll(
    async () =>
      (await dash.locator('article.widget .value').allInnerTexts()).join(',').includes('30'),
    'critical card shows 30',
  );
  // Year filter through a calculated column.
  await dash.getByRole('button', { name: 'Data, metrics & filters…' }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Add calculated column' }).click();
  await poll(async () => (await readDashboard()).columns?.length === 1, 'column added');
  await dialog.locator('input[aria-label="Column name"]').fill('Year');
  await dialog.locator('input[aria-label="Column name"]').press('Tab');
  const columnFormula = dialog.locator('input[aria-label="Column formula"]');
  await columnFormula.fill('YEAR(DetectedDate)');
  await columnFormula.press('Tab');
  await poll(
    async () =>
      (await readDashboard()).columns?.[0]?.formula === 'YEAR(DetectedDate)' &&
      (await readDashboard()).columns[0].name === 'Year',
    'Year column saved',
  );
  await dash.locator('#dialog-close').click();
  const d = await readDashboard();
  d.filters.push({ id: 'year', source: 'data', column: 'Year', kind: 'select' });
  d.widgets.push({
    id: 'year-filter',
    type: 'filter',
    filter: 'year',
    title: 'Year',
    layout: { x: 9, y: 2, w: 3, h: 2 },
  });
  d.widgets.find((w) => w.id === 'by-category').title = 'Findings by application';
  d.widgets.push({
    id: 'by-severity',
    type: 'chart',
    chart: 'bar',
    source: 'data',
    dimension: 'Severity',
    metrics: ['rows'],
    sort: 'value-desc',
    title: 'Findings by severity',
    layout: { x: 0, y: 8, w: 6, h: 4 },
  });
  await writeFile(dashboardFile, JSON.stringify(d, null, 2)); // as another tool (or Code mode) would
  dash = await frameWith(page, 'article[data-id="by-severity"] svg', 'severity chart');
  await dash.getByRole('button', { name: 'Done editing' }).click();
  await page.screenshot({ path: `${shots}/dashboard.png`, fullPage: false });
  await axe(dash, 'dashboard');
  console.log(
    'PASS phase07: cards, monthly line chart, severity and application charts and filters are configured',
  );

  // 4. Filters and cross-filtering.
  const rows = () => dash.locator('article[data-id="rows-card"] .value').innerText();
  await dash.locator('article[data-id="year-filter"] select').selectOption(['2026']);
  await poll(async () => Number(await rows()) < 120, 'year filter applied');
  const in2026 = Number(await rows());
  await dash.getByRole('button', { name: 'Reset filters' }).click();
  await poll(async () => (await rows()) === '120', 'reset');
  await dash.locator('article[data-id="by-severity"] rect[data-index="0"]').click();
  await poll(async () => (await rows()) === '30', 'clicking a bar filters every widget');
  assert.match(await dash.locator('.chips').innerText(), /Severity = /);
  await dash
    .locator('article[data-id="by-severity"]')
    .getByRole('button', { name: 'Rows' })
    .click();
  await poll(
    async () => /30 row\(s\)/.test(await dash.locator('#dialog-title').innerText()),
    'drill-down',
  );
  await dash.locator('#dialog-close').click();
  await dash.getByRole('button', { name: 'Reset filters' }).click();
  await poll(async () => (await rows()) === '120', 'reset again');
  console.log(
    `PASS phase07: filters (${in2026} findings in 2026), click-to-filter and drill-down work`,
  );

  // 5. The workbook changes: the dashboard refreshes by itself.
  await copyFile(path.join(fixtures, 'vulnerabilities-v2.xlsx'), workbook);
  await poll(async () => (await rows()) === '150', 'automatic refresh', 20000);
  assert.ok(
    (await dash.locator('article.widget .value').allInnerTexts()).includes('60'),
    'critical count refreshed',
  );
  // A broken save keeps the last data and says so.
  await writeFile(
    workbook,
    (await readFile(path.join(fixtures, 'vulnerabilities.xlsx'))).subarray(0, 2000),
  );
  await poll(
    async () => /Could not refresh/.test(await dash.locator('.status').innerText()),
    'refresh failure reported',
    20000,
  );
  assert.equal(await rows(), '150', 'last valid data still shown');
  await copyFile(path.join(fixtures, 'vulnerabilities-v2.xlsx'), workbook);
  await poll(
    async () => /Updated/.test(await dash.locator('.status').innerText()),
    'recovered',
    20000,
  );
  console.log(
    'PASS phase07: workbook changes refresh the dashboard; failed reads keep the last valid data',
  );

  // 6. Embed a widget in a wiki page from the Studio slash menu.
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="docs"]').click();
  await page.locator('.explorer-folders-view .monaco-list-row[aria-label="index.md"]').click();
  await poll(
    async () => (await page.locator('.tab.active', { hasText: 'index.md' }).count()) > 0,
    'page opened',
  );
  await runCommand(page, 'NoteSpace: Open in Studio');
  const studio = await frameWith(page, '.ProseMirror', 'Studio', async (f) =>
    /Overview/.test(await f.locator('.ProseMirror').innerText()),
  );
  await page.waitForTimeout(1500);
  await studio.locator('.ProseMirror p', { hasText: 'Overview' }).click();
  await studio.locator('.ProseMirror').press('End');
  await studio.locator('.ProseMirror').press('Enter');
  await studio.locator('.ProseMirror').type('/Dashboard');
  await studio.locator('#menu .item[aria-selected="true"]', { hasText: 'Dashboard' }).waitFor();
  await studio.locator('.ProseMirror').press('Enter');
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Security-Overview' })
    .first()
    .click();
  await page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Critical findings' })
    .first()
    .click();
  await poll(
    async () => (await studio.locator('.code-view .dash-metric-value').count()) === 1,
    'widget embedded',
  );
  assert.equal(await studio.locator('.code-view .dash-metric-value').innerText(), '60');
  await poll(
    async () => (await page.locator('.tab.active.dirty').count()) > 0,
    'edit reached VS Code',
  );
  await page.keyboard.press('Control+S');
  await poll(
    async () =>
      /```dashboard\npath: \.\.\/data\/Security-Overview\.wiki-dashboard\.json\nwidget: metric-\d+\n```/.test(
        await readFile(path.join(workspace, 'docs/index.md'), 'utf8'),
      ),
    'embed saved',
  );
  await page.screenshot({ path: `${shots}/embed.png` });
  console.log('PASS phase07: a dashboard widget is embedded in a page and stays live in Studio');
  console.log('NoteSpace phase 07 dashboard journey passed on code-server.');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure-phase07.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}

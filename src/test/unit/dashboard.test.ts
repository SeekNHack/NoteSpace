import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadDataset } from '../../core/dataset';
import {
  Dashboard,
  filterRows,
  formatValue,
  groupSeries,
  histogram,
  metricValue,
  parseDashboard,
  prepareSource,
} from '../../core/dashboard';

const fixture = readFileSync(path.join(__dirname, '../fixtures/vulnerabilities.xlsx'));
const definition = {
  schemaVersion: 1,
  title: 'Security Overview',
  sources: [{ id: 'vulns', type: 'xlsx', path: './data/vulnerabilities.xlsx', sheet: 'Export' }],
  columns: [
    { source: 'vulns', name: 'DaysOpen', formula: 'DAYS_BETWEEN(DetectedDate, ResolvedDate)' },
  ],
  metrics: [
    { id: 'total', source: 'vulns', formula: 'COUNT(rows)', label: 'Total findings' },
    { id: 'critical', source: 'vulns', formula: 'COUNT_IF(Severity = "Critical")' },
    { id: 'resolved', source: 'vulns', formula: 'COUNT_IF(Status = "Resolved")' },
    { id: 'mttr', source: 'vulns', formula: 'AVG(DaysOpen)', format: 'days' },
  ],
  filters: [
    { id: 'app', source: 'vulns', column: 'Application', kind: 'select' },
    { id: 'when', source: 'vulns', column: 'DetectedDate', kind: 'dateRange' },
  ],
  widgets: [
    { id: 'total-card', type: 'metric', metric: 'total', title: 'Total Findings' },
    {
      id: 'trend',
      type: 'chart',
      chart: 'line',
      source: 'vulns',
      dimension: 'DetectedDate',
      bucket: 'month',
      metrics: ['total'],
    },
    {
      id: 'by-severity',
      type: 'chart',
      chart: 'bar',
      source: 'vulns',
      dimension: 'Severity',
      metrics: ['total'],
      sort: 'value-desc',
    },
    { id: 'app-filter', type: 'filter', filter: 'app' },
  ],
};

test('dashboard files validate references, ids, paths and versions', () => {
  const { dashboard, errors } = parseDashboard(JSON.stringify(definition));
  assert.deepEqual(errors, []);
  assert.equal(dashboard.widgets.length, 4);
  const bad = parseDashboard(
    JSON.stringify({
      ...definition,
      sources: [{ id: 'vulns', type: 'xls', path: '../secret.xlsx' }],
      metrics: [
        { id: 'total', source: 'nope', formula: '' },
        { id: 'total', source: 'vulns', formula: 'COUNT(rows)' },
      ],
      widgets: [
        { id: '1bad', type: 'chart', chart: 'radar', source: 'vulns', metrics: ['missing'] },
      ],
    }),
  );
  assert.deepEqual(bad.errors, [
    'sources[0]: type must be one of csv, tsv, json, jsonl, xlsx.',
    'sources[0]: path must be a relative path inside the workspace (no “..”).',
    'metrics[0]: unknown source “nope”.',
    'metrics[0]: a formula is required.',
    'metrics[1]: the id “total” is used twice.',
    'widgets[0]: “id” must start with a letter and use letters, digits, - or _.',
    'widgets[0]: chart must be one of bar, line, area, pie, donut, scatter, histogram, timeseries.',
    'widgets[0]: unknown metric “missing”.',
  ]);
  assert.throws(() => parseDashboard('{"schemaVersion": 7}'), /schemaVersion 7/);
  assert.equal(
    parseDashboard('{"title":"Old"}').dashboard.schemaVersion,
    1,
    'files without a version are upgraded',
  );
});

test('metrics, filters, monthly trends, sorted categories and histograms come from the data', () => {
  const { dashboard } = parseDashboard(JSON.stringify(definition)) as { dashboard: Dashboard };
  const source = prepareSource(
    loadDataset('xlsx', fixture, { sheet: 'Export' }),
    dashboard.columns!,
    'vulns',
  );
  const metric = (id: string) => dashboard.metrics.find((m) => m.id === id)!;
  const all = filterRows(source, 'vulns', dashboard, {});
  assert.equal(metricValue(source, metric('total'), all), 120);
  assert.equal(metricValue(source, metric('critical'), all), 30);
  const mobile = filterRows(source, 'vulns', dashboard, { values: { app: ['Mobile'] } });
  assert.equal(mobile.length, 40);
  assert.equal(
    filterRows(source, 'vulns', dashboard, { values: { app: ['Mobile'] } }),
    mobile,
    'results are cached per filter state',
  );
  const in2025 = filterRows(source, 'vulns', dashboard, {
    ranges: { when: { from: Date.UTC(2025, 0, 1), to: Date.UTC(2025, 11, 31) } },
  });
  assert.ok(in2025.length > 0 && in2025.length < 120);
  const trend = groupSeries(source, all, 'DetectedDate', [metric('total')], 'month');
  assert.equal(trend.labels[0], '2025-01');
  assert.equal(
    trend.values[0].reduce<number>((s, v) => s + Number(v), 0),
    120,
  );
  assert.deepEqual(trend.counts, trend.values[0]);
  const bySeverity = groupSeries(
    source,
    all,
    'Severity',
    [metric('total')],
    undefined,
    'value-desc',
  );
  assert.deepEqual(bySeverity.values[0], [30, 30, 30, 30]);
  const top2 = groupSeries(source, all, 'ID', [metric('total')], undefined, 'value-desc', 3);
  assert.deepEqual(
    top2.labels.slice(-1),
    ['Other'],
    'groups beyond the limit are folded, not dropped',
  );
  assert.equal(
    top2.counts.reduce((s, n) => s + n, 0),
    120,
  );
  const clicked = filterRows(source, 'vulns', dashboard, {
    clicks: [{ source: 'vulns', column: 'DetectedDate', values: ['2025-01'], bucket: 'month' }],
  });
  assert.equal(clicked.length, trend.counts[0], 'clicking a chart segment filters to its rows');
  const hist = histogram(source, all, 'Cost', 5);
  assert.equal(
    hist.counts.reduce((s, n) => s + n, 0),
    120,
  );
  assert.equal(
    formatValue(metricValue(source, metric('mttr'), all), metric('mttr')),
    `${(Math.round((metricValue(source, metric('mttr'), all) as number) * 10) / 10).toLocaleString('en')} d`,
  );
  assert.equal(formatValue(null), '—');
  assert.throws(
    () => metricValue(source, { id: 'x', source: 'vulns', formula: 'Severity' }, all),
    /must summarize rows/,
  );
});

import {
  addCalculatedColumn,
  accessOf,
  ColumnType,
  Dataset,
  SourceOptions,
  SourceType,
} from './dataset';
import { checkFormula, evaluateAggregate, parseFormula, Value } from './formula';

/**
 * `.wiki-dashboard.json` — a portable, versioned dashboard definition. It stores sources (by
 * relative path), formulas, filters and layout; never the data itself.
 */
export const DASHBOARD_SCHEMA = 1;
export interface DashboardSource extends SourceOptions {
  id: string;
  type: SourceType;
  /** Path relative to the dashboard file. */
  path: string;
}
export interface DashboardMetric {
  id: string;
  source: string;
  formula: string;
  label?: string;
  format?: 'number' | 'percent' | 'currency' | 'days';
  decimals?: number;
}
export interface DashboardFilter {
  id: string;
  source: string;
  column: string;
  kind: 'select' | 'dateRange' | 'search';
  label?: string;
}
export type WidgetType = 'metric' | 'chart' | 'table' | 'progress' | 'text' | 'filter';
export type ChartKind =
  'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'histogram' | 'timeseries';
export type Bucket = 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface Widget {
  id: string;
  type: WidgetType;
  title?: string;
  /** Grid position in a 12-column layout. */
  layout?: { x: number; y: number; w: number; h: number };
  metric?: string;
  /** Progress: target value or metric id. */
  target?: number | string;
  chart?: ChartKind;
  source?: string;
  dimension?: string;
  bucket?: Bucket;
  metrics?: string[];
  /** Scatter: y column. */
  y?: string;
  bins?: number;
  sort?: 'label' | 'value-desc' | 'value-asc';
  limit?: number;
  columns?: string[];
  pageSize?: number;
  text?: string;
  filter?: string;
}
export interface Dashboard {
  schemaVersion: typeof DASHBOARD_SCHEMA;
  title: string;
  description?: string;
  sources: DashboardSource[];
  columns?: Array<{ source: string; name: string; formula: string; type?: ColumnType }>;
  metrics: DashboardMetric[];
  filters?: DashboardFilter[];
  widgets: Widget[];
  /** Allows aggregated snapshots of this dashboard in static exports (off by default). */
  export?: { snapshots?: boolean; tables?: boolean };
  refresh?: { auto?: boolean };
}

const ID = /^[A-Za-z][\w-]{0,63}$/;
const sourceTypes: SourceType[] = ['csv', 'tsv', 'json', 'jsonl', 'xlsx'];
const widgetTypes: WidgetType[] = ['metric', 'chart', 'table', 'progress', 'text', 'filter'];
const chartKinds: ChartKind[] = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'histogram',
  'timeseries',
];

/** Upgrades older schema versions; unknown future versions are refused rather than guessed. */
export function migrateDashboard(raw: Record<string, unknown>): Record<string, unknown> {
  const version = raw.schemaVersion;
  if (version === DASHBOARD_SCHEMA) return raw;
  if (version === undefined) return { ...raw, schemaVersion: DASHBOARD_SCHEMA };
  throw new Error(
    `This dashboard uses schemaVersion ${String(version)}, which this version of NoteSpace does not understand.`,
  );
}

/** Parses and validates a dashboard file; every problem is reported with its location. */
export function parseDashboard(text: string): { dashboard: Dashboard; errors: string[] } {
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('A dashboard must be a JSON object.');
  const d = migrateDashboard(raw as Record<string, unknown>) as Partial<Dashboard>;
  const errors: string[] = [];
  const list = <T>(v: unknown, name: string): T[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errors.push(`${name} must be a list.`);
      return [];
    }
    return v as T[];
  };
  const dashboard: Dashboard = {
    schemaVersion: DASHBOARD_SCHEMA,
    title: typeof d.title === 'string' && d.title.trim() ? d.title : 'Dashboard',
    ...(typeof d.description === 'string' ? { description: d.description } : {}),
    sources: list<DashboardSource>(d.sources, 'sources'),
    columns: list<NonNullable<Dashboard['columns']>[number]>(d.columns, 'columns'),
    metrics: list<DashboardMetric>(d.metrics, 'metrics'),
    filters: list<DashboardFilter>(d.filters, 'filters'),
    widgets: list<Widget>(d.widgets, 'widgets'),
    ...(d.export && typeof d.export === 'object'
      ? { export: { snapshots: d.export.snapshots === true, tables: d.export.tables === true } }
      : {}),
    ...(d.refresh && typeof d.refresh === 'object'
      ? { refresh: { auto: d.refresh.auto !== false } }
      : {}),
  };
  const ids = new Set<string>();
  const unique = (id: unknown, where: string) => {
    if (typeof id !== 'string' || !ID.test(id))
      errors.push(`${where}: “id” must start with a letter and use letters, digits, - or _.`);
    else if (ids.has(id)) errors.push(`${where}: the id “${id}” is used twice.`);
    else ids.add(id);
  };
  dashboard.sources.forEach((s, i) => {
    const where = `sources[${i}]`;
    unique(s?.id, where);
    if (!sourceTypes.includes(s?.type))
      errors.push(`${where}: type must be one of ${sourceTypes.join(', ')}.`);
    if (
      typeof s?.path !== 'string' ||
      !s.path ||
      /^([a-z]+:|\/|\\)/i.test(s.path) ||
      s.path.split(/[\\/]/).includes('..')
    )
      errors.push(`${where}: path must be a relative path inside the workspace (no “..”).`);
  });
  const sourceIds = new Set(dashboard.sources.map((s) => s?.id));
  const needSource = (id: unknown, where: string) => {
    if (!sourceIds.has(id as string)) errors.push(`${where}: unknown source “${String(id)}”.`);
  };
  dashboard.columns!.forEach((c, i) => {
    needSource(c?.source, `columns[${i}]`);
    if (typeof c?.name !== 'string' || !c.name.trim())
      errors.push(`columns[${i}]: a name is required.`);
    if (typeof c?.formula !== 'string') errors.push(`columns[${i}]: a formula is required.`);
  });
  dashboard.metrics.forEach((m, i) => {
    unique(m?.id, `metrics[${i}]`);
    needSource(m?.source, `metrics[${i}]`);
    if (typeof m?.formula !== 'string' || !m.formula.trim())
      errors.push(`metrics[${i}]: a formula is required.`);
  });
  dashboard.filters!.forEach((f, i) => {
    unique(f?.id, `filters[${i}]`);
    needSource(f?.source, `filters[${i}]`);
    if (!['select', 'dateRange', 'search'].includes(f?.kind))
      errors.push(`filters[${i}]: kind must be select, dateRange or search.`);
  });
  const metricIds = new Set(dashboard.metrics.map((m) => m?.id));
  dashboard.widgets.forEach((w, i) => {
    const where = `widgets[${i}]`;
    unique(w?.id, where);
    if (!widgetTypes.includes(w?.type))
      return void errors.push(`${where}: type must be one of ${widgetTypes.join(', ')}.`);
    if ((w.type === 'metric' || w.type === 'progress') && !metricIds.has(w.metric!))
      errors.push(`${where}: unknown metric “${String(w.metric)}”.`);
    if (w.type === 'progress' && typeof w.target === 'string' && !metricIds.has(w.target))
      errors.push(`${where}: unknown target metric “${w.target}”.`);
    if (w.type === 'chart') {
      if (!chartKinds.includes(w.chart!))
        errors.push(`${where}: chart must be one of ${chartKinds.join(', ')}.`);
      needSource(w.source, where);
      for (const m of w.metrics || [])
        if (!metricIds.has(m)) errors.push(`${where}: unknown metric “${m}”.`);
    }
    if (w.type === 'table') needSource(w.source, where);
    if (w.type === 'filter' && !(dashboard.filters || []).some((f) => f.id === w.filter))
      errors.push(`${where}: unknown filter “${String(w.filter)}”.`);
    if (
      w.layout &&
      !['x', 'y', 'w', 'h'].every((k) => Number.isInteger((w.layout as Record<string, number>)[k]))
    )
      errors.push(`${where}: layout needs whole numbers x, y, w and h.`);
  });
  return { dashboard, errors };
}

export const serializeDashboard = (d: Dashboard) => `${JSON.stringify(d, null, 2)}\n`;

// ---------------------------------------------------------------------------------------------
// Query engine
// ---------------------------------------------------------------------------------------------
export interface FilterState {
  /** Selected values for select filters (or chart click filters), by filter id. */
  values?: Record<string, string[]>;
  ranges?: Record<string, { from?: number; to?: number }>;
  search?: Record<string, string>;
  /** Cross-filters from clicked chart segments: source → column → values. */
  clicks?: Array<{ source: string; column: string; values: string[]; bucket?: Bucket }>;
}

export function bucketKey(value: Value, bucket?: Bucket): string {
  if (value === null || value === '') return '(empty)';
  if (!bucket || typeof value !== 'number') return String(value);
  const d = new Date(value);
  const iso = d.toISOString();
  switch (bucket) {
    case 'day':
      return iso.slice(0, 10);
    case 'week': {
      const monday = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)),
      );
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
      return iso.slice(0, 7);
    case 'quarter':
      return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case 'year':
      return String(d.getUTCFullYear());
  }
}

/** A prepared source: the dataset with calculated columns, plus cached query results. */
export class PreparedSource {
  private cache = new Map<string, unknown>();
  readonly access;
  constructor(
    readonly dataset: Dataset,
    readonly loadedAt: number,
  ) {
    this.access = accessOf(dataset);
  }
  column(name: string): number {
    const i = this.dataset.columns.findIndex((c) => c.name === name);
    if (i < 0) throw new Error(`The source has no column “${name}”.`);
    return i;
  }
  memo<T>(key: string, compute: () => T): T {
    if (!this.cache.has(key)) {
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(key, compute());
    }
    return this.cache.get(key) as T;
  }
}

export function prepareSource(
  dataset: Dataset,
  columns: NonNullable<Dashboard['columns']>,
  sourceId: string,
): PreparedSource {
  let data = dataset;
  for (const c of columns.filter((c) => c.source === sourceId)) {
    const check = checkFormula(
      c.formula,
      data.columns.map((x) => x.name),
      'row',
    );
    if (!check.ok) throw new Error(`Calculated column “${c.name}”: ${check.error}`);
    data = addCalculatedColumn(data, c.name, c.formula, c.type);
  }
  return new PreparedSource(data, Date.now());
}

/** Row indexes that pass the dashboard filters for one source. */
export function filterRows(
  source: PreparedSource,
  sourceId: string,
  dashboard: Dashboard,
  state: FilterState,
): Uint32Array {
  return source.memo(`rows:${sourceId}:${JSON.stringify(state)}`, () => {
    const tests: Array<(r: number) => boolean> = [];
    for (const f of dashboard.filters || []) {
      if (f.source !== sourceId) continue;
      const col = source.column(f.column);
      const values = source.dataset.columns[col].values;
      const selected = state.values?.[f.id];
      if (f.kind === 'select' && selected?.length) {
        const set = new Set(selected.map((v) => v.toLowerCase()));
        tests.push((r) => set.has(String(values[r] ?? '(empty)').toLowerCase()));
      }
      const range = state.ranges?.[f.id];
      if (f.kind === 'dateRange' && range && (range.from !== undefined || range.to !== undefined))
        tests.push((r) => {
          const v = values[r];
          if (typeof v !== 'number') return false;
          return (
            (range.from === undefined || v >= range.from) &&
            (range.to === undefined || v <= range.to)
          );
        });
      const search = state.search?.[f.id]?.trim().toLowerCase();
      if (f.kind === 'search' && search)
        tests.push((r) =>
          String(values[r] ?? '')
            .toLowerCase()
            .includes(search),
        );
    }
    for (const click of state.clicks || []) {
      if (click.source !== sourceId) continue;
      const col = source.column(click.column);
      const values = source.dataset.columns[col].values;
      const set = new Set(click.values);
      tests.push((r) => set.has(bucketKey(values[r], click.bucket)));
    }
    const out: number[] = [];
    for (let r = 0; r < source.dataset.rowCount; r++) if (tests.every((t) => t(r))) out.push(r);
    return Uint32Array.from(out);
  });
}

export function metricValue(
  source: PreparedSource,
  metric: DashboardMetric,
  rows: Uint32Array,
): Value {
  const check = checkFormula(metric.formula, source.access.names, 'aggregate');
  if (!check.ok) throw new Error(`Metric “${metric.label || metric.id}”: ${check.error}`);
  return evaluateAggregate(parseFormula(metric.formula, source.access.names), source.access, rows);
}

export interface Series {
  /** Category labels (bucketed dimension values or histogram bins). */
  labels: string[];
  /** One list of values per metric, aligned with labels. */
  values: Value[][];
  /** Row count per label (for drill-down). */
  counts: number[];
}

/** Groups rows by a dimension (optionally bucketed by date) and evaluates metrics per group. */
export function groupSeries(
  source: PreparedSource,
  rows: Uint32Array,
  dimension: string,
  metrics: DashboardMetric[],
  bucket?: Bucket,
  sort: Widget['sort'] = 'label',
  limit = 50,
): Series {
  const col = source.column(dimension);
  const values = source.dataset.columns[col].values;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const key = bucketKey(
      values[rows[i]],
      source.dataset.columns[col].type === 'date' ? bucket || 'month' : undefined,
    );
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(rows[i]);
  }
  let entries = [...groups.entries()].map(([label, members]) => ({
    label,
    count: members.length,
    values: metrics.map((m) => metricValue(source, m, Uint32Array.from(members))),
  }));
  if (sort === 'label')
    entries.sort((a, b) =>
      a.label === '(empty)'
        ? 1
        : b.label === '(empty)'
          ? -1
          : a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  else
    entries.sort(
      (a, b) =>
        ((Number(b.values[0]) || 0) - (Number(a.values[0]) || 0)) * (sort === 'value-asc' ? -1 : 1),
    );
  if (entries.length > limit) {
    // Keep the largest groups and fold the rest into “Other” so nothing is silently dropped.
    const kept = sort === 'label' ? entries.slice(0, limit) : entries.slice(0, limit - 1);
    if (sort !== 'label') {
      const rest = entries.slice(limit - 1).flatMap((e) => groups.get(e.label)!);
      kept.push({
        label: 'Other',
        count: rest.length,
        values: metrics.map((m) => metricValue(source, m, Uint32Array.from(rest))),
      });
    }
    entries = kept;
  }
  return {
    labels: entries.map((e) => e.label),
    values: metrics.map((_, k) => entries.map((e) => e.values[k])),
    counts: entries.map((e) => e.count),
  };
}

/** Equal-width histogram of a numeric column. */
export function histogram(
  source: PreparedSource,
  rows: Uint32Array,
  column: string,
  bins?: number,
): Series & { edges: number[] } {
  const col = source.column(column);
  const values: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = source.dataset.columns[col].values[rows[i]];
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
  }
  if (!values.length) return { labels: [], values: [[]], counts: [], edges: [] };
  let min = Infinity,
    max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const n = Math.max(1, Math.min(60, bins || Math.ceil(Math.log2(values.length) + 1)));
  const width = (max - min) / n || 1;
  const counts = new Array(n).fill(0);
  for (const v of values) counts[Math.min(n - 1, Math.floor((v - min) / width))]++;
  const edges = Array.from({ length: n + 1 }, (_, i) => min + i * width);
  const fmt = (v: number) =>
    Math.abs(v) >= 100 ? Math.round(v).toString() : Number(v.toFixed(2)).toString();
  return {
    labels: counts.map((_, i) => `${fmt(edges[i])}–${fmt(edges[i + 1])}`),
    values: [counts],
    counts,
    edges,
  };
}

export function formatValue(
  value: Value,
  metric?: Pick<DashboardMetric, 'format' | 'decimals'>,
  locale = 'en',
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  const decimals = metric?.decimals ?? (Number.isInteger(value) ? 0 : 1);
  if (metric?.format === 'percent')
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value)}%`;
  if (metric?.format === 'days')
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value)} d`;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: metric?.format === 'currency' ? 2 : 0,
  }).format(value);
}

export const dashboardCss = `.doc .dashboard-snapshot{margin:1.2em 0;padding:12px 14px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
.doc .dashboard-snapshot figcaption{color:var(--ws-muted);font-size:.8em;margin-top:6px}
.doc .dash-metric{display:inline-flex;flex-direction:column;min-width:140px;margin:4px 12px 4px 0}
.doc .dash-metric-value{font-size:1.9em;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums}
.doc .dash-metric-label{color:var(--ws-muted);font-size:.85em}
.doc .dash-metric progress{width:100%;margin-top:6px;accent-color:var(--ws-accent)}
.doc .dashboard-private{color:var(--ws-muted);font-style:italic}`;

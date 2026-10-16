import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { loadDataset } from './core/dataset';
import {
  Dashboard,
  DashboardMetric,
  FilterState,
  filterRows,
  formatValue,
  groupSeries,
  histogram,
  metricValue,
  parseDashboard,
  PreparedSource,
  prepareSource,
  Widget,
} from './core/dashboard';
export { dashboardCss } from './core/dashboard';
import { renderChart, Row } from './core/charts';
import { escapeHtml } from './core/render';
import { checkFormula, functions, Value } from './core/formula';
import { posix } from './core/paths';

const inert = new MarkdownIt({ html: false, linkify: true });
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export interface SourceState {
  id: string;
  path: string;
  status: 'ok' | 'error' | 'loading';
  rows?: number;
  columns?: Array<{ name: string; type: string; formulas?: { cached: number; uncached: number } }>;
  loadedAt?: number;
  error?: string;
  warnings: string[];
  /** True when the last refresh failed and older data is still shown. */
  stale?: boolean;
}
export interface WidgetResult {
  id: string;
  error?: string;
  html?: string;
  value?: string;
  label?: string;
  progress?: { value: number; target: number; percent: number };
  labels?: string[];
  options?: string[];
  range?: { min?: number; max?: number };
  table?: { columns: string[]; rows: string[][]; total: number; page: number; pageSize: number };
  dimension?: string;
  bucket?: string;
  source?: string;
}

/** Resolves a source path relative to the dashboard file, refusing paths that leave the folder tree. */
export function sourceUri(dashboardUri: vscode.Uri, path: string): vscode.Uri {
  const folder = vscode.workspace.getWorkspaceFolder(dashboardUri);
  const target = vscode.Uri.joinPath(dashboardUri, '..', path);
  if (
    folder &&
    !(
      target.path === folder.uri.path ||
      target.path.startsWith(folder.uri.path.replace(/\/$/, '') + '/')
    )
  )
    throw new Error(`“${path}” is outside the workspace folder.`);
  return target;
}

/**
 * Loads and caches the data sources of open dashboards, watches them, and computes widget
 * results. Raw rows never leave the extension host except as the page of a table or drill-down.
 */
export class DashboardService implements vscode.Disposable {
  private readonly sources = new Map<
    string,
    { prepared?: PreparedSource; state: SourceState; key: string }
  >();
  private readonly watchers = new Map<string, vscode.Disposable>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly emitter = new vscode.EventEmitter<string>();
  /** Fires with a source URI when its data changed (or failed to reload). */
  readonly onDidChangeSource = this.emitter.event;

  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.timers.forEach((t) => clearTimeout(t));
    this.emitter.dispose();
  }

  /** Loads (or returns cached) sources for a dashboard. */
  async load(
    dashboardUri: vscode.Uri,
    dashboard: Dashboard,
  ): Promise<Map<string, { prepared?: PreparedSource; state: SourceState }>> {
    const out = new Map<string, { prepared?: PreparedSource; state: SourceState }>();
    for (const source of dashboard.sources) {
      let uri: vscode.Uri;
      try {
        uri = sourceUri(dashboardUri, source.path);
      } catch (e) {
        out.set(source.id, {
          state: {
            id: source.id,
            path: source.path,
            status: 'error',
            error: String(e instanceof Error ? e.message : e),
            warnings: [],
          },
        });
        continue;
      }
      // The cache key covers options and calculated columns, so edits to either reload it.
      const key = JSON.stringify([
        source,
        (dashboard.columns || []).filter((c) => c.source === source.id),
      ]);
      const cacheKey = `${uri.toString()}#${source.id}`;
      let entry = this.sources.get(cacheKey);
      if (!entry || entry.key !== key) {
        entry = await this.read(uri, source, dashboard, key, entry);
        this.sources.set(cacheKey, entry);
      }
      this.watch(uri, dashboardUri, cacheKey);
      out.set(source.id, entry);
    }
    return out;
  }

  private async read(
    uri: vscode.Uri,
    source: Dashboard['sources'][number],
    dashboard: Dashboard,
    key: string,
    previous?: { prepared?: PreparedSource; state: SourceState },
  ): Promise<{ prepared?: PreparedSource; state: SourceState; key: string }> {
    // Spreadsheet programs write in several steps: retry a few times before reporting a failure.
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_SOURCE_BYTES)
          throw new Error(
            `The file is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB; filter or split it first.`,
          );
        const bytes = await vscode.workspace.fs.readFile(uri);
        const dataset = loadDataset(source.type, bytes, source);
        const prepared = prepareSource(dataset, dashboard.columns || [], source.id);
        return {
          key,
          prepared,
          state: {
            id: source.id,
            path: source.path,
            status: 'ok',
            rows: prepared.dataset.rowCount,
            columns: prepared.dataset.columns.map((c) => ({
              name: c.name,
              type: c.type,
              ...(c.formulas ? { formulas: c.formulas } : {}),
            })),
            loadedAt: prepared.loadedAt,
            warnings: dataset.warnings,
          },
        };
      } catch (e) {
        lastError = e;
        const notFound = e instanceof vscode.FileSystemError && e.code === 'FileNotFound';
        if (notFound || attempt === 3) break;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    const message =
      lastError instanceof vscode.FileSystemError && lastError.code === 'FileNotFound'
        ? `“${source.path}” was not found (moved or deleted?).`
        : lastError instanceof Error
          ? lastError.message
          : String(lastError);
    // Keep showing the last valid data, clearly marked as not current.
    if (previous?.prepared)
      return {
        key,
        prepared: previous.prepared,
        state: { ...previous.state, status: 'error', error: message, stale: true },
      };
    return {
      key,
      state: { id: source.id, path: source.path, status: 'error', error: message, warnings: [] },
    };
  }

  private watch(uri: vscode.Uri, dashboardUri: vscode.Uri, cacheKey: string) {
    if (this.watchers.has(cacheKey)) return;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), posix.basename(uri.path)),
    );
    const changed = () => {
      clearTimeout(this.timers.get(cacheKey));
      // Debounce bursts of events from a save.
      this.timers.set(
        cacheKey,
        setTimeout(() => {
          const entry = this.sources.get(cacheKey);
          if (entry) entry.key = `${entry.key}#changed`;
          this.emitter.fire(dashboardUri.toString());
        }, 600),
      );
    };
    this.watchers.set(
      cacheKey,
      vscode.Disposable.from(
        watcher,
        watcher.onDidChange(changed),
        watcher.onDidCreate(changed),
        watcher.onDidDelete(changed),
      ),
    );
  }

  /** Forces the next load to read every source again (manual refresh). */
  invalidate(): void {
    for (const entry of this.sources.values()) entry.key += '#manual';
  }

  /** Computes every widget for the current filters. */
  async compute(
    dashboardUri: vscode.Uri,
    dashboard: Dashboard,
    state: FilterState,
    pages: Record<string, number> = {},
    locale = vscode.env.language,
  ) {
    const loaded = await this.load(dashboardUri, dashboard);
    const results: WidgetResult[] = [];
    const metricById = new Map(dashboard.metrics.map((m) => [m.id, m]));
    const rowsFor = (sourceId: string) => {
      const prepared = loaded.get(sourceId)?.prepared;
      if (!prepared)
        throw new Error(
          loaded.get(sourceId)?.state.error || `Source “${sourceId}” is not available.`,
        );
      return { prepared, rows: filterRows(prepared, sourceId, dashboard, state) };
    };
    const metric = (id: string) => {
      const m = metricById.get(id);
      if (!m) throw new Error(`Unknown metric “${id}”.`);
      const { prepared, rows } = rowsFor(m.source);
      return { m, value: metricValue(prepared, m, rows) };
    };
    for (const w of dashboard.widgets) {
      try {
        results.push(
          this.widget(w, dashboard, metric, rowsFor, metricById, state, pages[w.id] || 0, locale),
        );
      } catch (e) {
        results.push({ id: w.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results, sources: [...loaded.values()].map((s) => s.state) };
  }

  private widget(
    w: Widget,
    dashboard: Dashboard,
    metric: (id: string) => { m: DashboardMetric; value: Value },
    rowsFor: (sourceId: string) => { prepared: PreparedSource; rows: Uint32Array },
    metricById: Map<string, DashboardMetric>,
    state: FilterState,
    page: number,
    locale: string,
  ): WidgetResult {
    switch (w.type) {
      case 'metric': {
        const { m, value } = metric(w.metric!);
        return {
          id: w.id,
          value: formatValue(value, m, locale),
          label: w.title || m.label || m.id,
        };
      }
      case 'progress': {
        const { m, value } = metric(w.metric!);
        const target =
          typeof w.target === 'string' ? Number(metric(w.target).value) : Number(w.target);
        const v = Number(value) || 0;
        const percent = target ? Math.max(0, Math.min(100, (v / target) * 100)) : 0;
        return {
          id: w.id,
          label: w.title || m.label || m.id,
          value: formatValue(value, m, locale),
          progress: { value: v, target: target || 0, percent },
        };
      }
      case 'text':
        return { id: w.id, html: inert.render(w.text || '') };
      case 'filter': {
        const f = (dashboard.filters || []).find((x) => x.id === w.filter);
        if (!f) throw new Error(`Unknown filter “${w.filter}”.`);
        const { prepared } = rowsFor(f.source);
        const col = prepared.column(f.column);
        const values = prepared.dataset.columns[col].values;
        if (f.kind === 'dateRange') {
          let min: number | undefined, max: number | undefined;
          for (const v of values)
            if (typeof v === 'number')
              ((min = min === undefined || v < min ? v : min),
                (max = max === undefined || v > max ? v : max));
          return { id: w.id, label: w.title || f.label || f.column, range: { min, max } };
        }
        const options = [
          ...new Set(values.map((v) => (v === null || v === '' ? '(empty)' : String(v)))),
        ]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .slice(0, 300);
        return { id: w.id, label: w.title || f.label || f.column, options };
      }
      case 'table': {
        const { prepared, rows } = rowsFor(w.source!);
        const columns = (
          w.columns?.length ? w.columns : prepared.dataset.columns.map((c) => c.name).slice(0, 8)
        ).filter((c) => prepared.dataset.columns.some((x) => x.name === c));
        const size = Math.min(Math.max(w.pageSize || 25, 5), 200);
        const start = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1)) * size;
        const cells = columns.map((c) => prepared.dataset.columns[prepared.column(c)]);
        const body: string[][] = [];
        for (let i = start; i < Math.min(rows.length, start + size); i++)
          body.push(
            cells.map((col) => {
              const v = col.values[rows[i]];
              return v === null
                ? ''
                : col.type === 'date' && typeof v === 'number'
                  ? new Date(v).toISOString().slice(0, 10)
                  : typeof v === 'number'
                    ? formatValue(v, undefined, locale)
                    : String(v);
            }),
          );
        return {
          id: w.id,
          label: w.title || 'Records',
          table: { columns, rows: body, total: rows.length, page: start / size, pageSize: size },
        };
      }
      case 'chart': {
        const { prepared, rows } = rowsFor(w.source!);
        const metrics = (w.metrics || []).map((id) => metricById.get(id)!).filter(Boolean);
        const title = w.title || metrics.map((m) => m.label || m.id).join(', ') || 'Chart';
        if (w.chart === 'histogram') {
          const h = histogram(prepared, rows, w.dimension!, w.bins);
          const data: Row[] = h.labels.map((label, i) => ({
            [w.dimension!]: label,
            Rows: h.counts[i],
          }));
          return {
            id: w.id,
            html: renderChart(
              { type: 'bar', title, x: w.dimension!, y: ['Rows'], height: 240 },
              data,
            ),
            labels: h.labels,
          };
        }
        if (w.chart === 'scatter') {
          const x = prepared.column(w.dimension!),
            y = prepared.column(w.y!);
          const data: Row[] = [];
          for (let i = 0; i < Math.min(rows.length, 2000); i++) {
            const a = prepared.dataset.columns[x].values[rows[i]],
              b = prepared.dataset.columns[y].values[rows[i]];
            if (typeof a === 'number' && typeof b === 'number')
              data.push({ [w.dimension!]: a, [w.y!]: b });
          }
          return {
            id: w.id,
            html:
              renderChart(
                { type: 'scatter', title, x: w.dimension!, y: [w.y!], height: 240 },
                data,
              ) + (rows.length > 2000 ? '<p class="note">Showing the first 2,000 points.</p>' : ''),
          };
        }
        if (!metrics.length) throw new Error('Choose at least one metric for this chart.');
        const isDate = prepared.dataset.columns[prepared.column(w.dimension!)].type === 'date';
        const bucket = isDate ? w.bucket || 'month' : undefined;
        const series = groupSeries(
          prepared,
          rows,
          w.dimension!,
          metrics,
          bucket,
          w.chart === 'line' || w.chart === 'area' || w.chart === 'timeseries'
            ? 'label'
            : w.sort || 'label',
          w.limit || 50,
        );
        const names = metrics.map((m) => m.label || m.id);
        const data: Row[] = series.labels.map((label, i) => {
          const row: Row = { [w.dimension!]: label };
          names.forEach((n, k) => (row[n] = Number(series.values[k][i]) || 0));
          return row;
        });
        const type = w.chart === 'timeseries' ? 'line' : (w.chart as 'bar');
        return {
          id: w.id,
          html: renderChart({ type, title, x: w.dimension!, y: names, height: 240 }, data),
          labels: series.labels,
          dimension: w.dimension,
          bucket,
          source: w.source,
        };
      }
    }
    void state;
    return { id: w.id, error: 'Unknown widget type.' };
  }

  /** Records behind a filter state (for drill-down and CSV export), as text cells. */
  async records(
    dashboardUri: vscode.Uri,
    dashboard: Dashboard,
    sourceId: string,
    state: FilterState,
    limit = 100_000,
  ) {
    const loaded = await this.load(dashboardUri, dashboard);
    const prepared = loaded.get(sourceId)?.prepared;
    if (!prepared) throw new Error(`Source “${sourceId}” is not available.`);
    const rows = filterRows(prepared, sourceId, dashboard, state);
    const columns = prepared.dataset.columns;
    const out: string[][] = [];
    for (let i = 0; i < Math.min(rows.length, limit); i++)
      out.push(
        columns.map((c) => {
          const v = c.values[rows[i]];
          return v === null
            ? ''
            : c.type === 'date' && typeof v === 'number'
              ? new Date(v).toISOString().slice(0, 10)
              : String(v);
        }),
      );
    return { columns: columns.map((c) => c.name), rows: out, total: rows.length };
  }

  /** Formula validation and completion data for the builder. */
  checkFormula(columns: string[], formula: string, kind: 'row' | 'aggregate') {
    return { ...checkFormula(formula, columns, kind), functions: Object.keys(functions) };
  }
}

/** CSV with spreadsheet formula injection neutralised (cells starting with = + @ or a non-numeric -). */
export const toCsv = (columns: string[], rows: string[][]) =>
  [columns, ...rows]
    .map((r) =>
      r
        .map((c) => {
          const risky = /^[=+@\t\r]|^-(?![\d.])/.test(c);
          const value = risky ? `'${c}` : c;
          return risky || /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\r\n') + '\r\n';

/** Static snapshot of one widget or a whole dashboard, for pages and exports. */
export async function dashboardSnapshot(
  service: DashboardService,
  dashboardUri: vscode.Uri,
  widgetId: string | undefined,
  options: { forExport?: boolean } = {},
): Promise<string> {
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(dashboardUri));
  const { dashboard, errors } = parseDashboard(text);
  if (errors.length) throw new Error(errors[0]);
  if (options.forExport && !dashboard.export?.snapshots)
    return `<p class="dashboard-private">Dashboard “${escapeHtml(dashboard.title)}” is not included in exports. Set <code>"export": { "snapshots": true }</code> in the dashboard file to publish aggregated snapshots.</p>`;
  const widgets = widgetId
    ? dashboard.widgets.filter((w) => w.id === widgetId)
    : dashboard.widgets.filter((w) => w.type !== 'filter');
  if (!widgets.length) throw new Error(`The dashboard has no widget “${widgetId}”.`);
  const { results, sources } = await service.compute(dashboardUri, { ...dashboard, widgets }, {});
  const time = Math.max(...sources.map((s) => s.loadedAt || 0));
  const body = results
    .map((r) => {
      if (r.error) return `<p class="diagram-error">${escapeHtml(r.error)}</p>`;
      if (r.value !== undefined && !r.progress)
        return `<div class="dash-metric"><span class="dash-metric-value">${escapeHtml(r.value)}</span><span class="dash-metric-label">${escapeHtml(r.label || '')}</span></div>`;
      if (r.progress)
        return `<div class="dash-metric"><span class="dash-metric-value">${escapeHtml(r.value || '')}</span><span class="dash-metric-label">${escapeHtml(r.label || '')}</span><progress max="100" value="${r.progress.percent.toFixed(1)}" aria-label="${escapeHtml(r.label || '')}">${r.progress.percent.toFixed(0)}%</progress></div>`;
      if (r.table) {
        if (options.forExport && !dashboard.export?.tables)
          return `<p class="dashboard-private">Record tables are not exported (set <code>"tables": true</code> to include them).</p>`;
        return `<table><thead><tr>${r.table.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${r.table.rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${r.table.total > r.table.rows.length ? `<p class="note">${r.table.rows.length} of ${r.table.total} rows.</p>` : ''}`;
      }
      return r.html || '';
    })
    .join('');
  const stale = sources.some((s) => s.status === 'error');
  return `<figure class="dashboard-snapshot" aria-label="${escapeHtml(dashboard.title)}">${body}<figcaption>${escapeHtml(dashboard.title)} · snapshot${time ? ` of data loaded ${new Date(time).toISOString().replace('T', ' ').slice(0, 16)} UTC` : ''}${stale ? ' · <strong>some data could not be refreshed</strong>' : ''}</figcaption></figure>`;
}

/** One service per extension host: dashboards, embeds and exports share loaded data. */
export const sharedDashboards = new DashboardService();

/**
 * ```dashboard embeds:
 *
 *   path: ../reports/security.wiki-dashboard.json
 *   widget: critical-card        (optional; the whole dashboard without filter controls otherwise)
 */
export async function dashboardRenderer(
  pageUri: vscode.Uri,
  text: string,
  options: { forExport?: boolean } = {},
): Promise<(source: string) => string> {
  const loaded = new Map<string, string>();
  for (const match of text.matchAll(/^```dashboard[^\n]*\n([\s\S]*?)^```/gm)) {
    const key = match[1];
    if (loaded.has(key)) continue;
    const path = /^\s*path\s*:\s*(.+?)\s*$/m.exec(key)?.[1];
    const widget = /^\s*widget\s*:\s*(.+?)\s*$/m.exec(key)?.[1];
    try {
      if (!path || !/\.wiki-dashboard\.json$/i.test(path))
        throw new Error('Add “path: name.wiki-dashboard.json”.');
      const uri = sourceUri(pageUri, path);
      loaded.set(key, await dashboardSnapshot(sharedDashboards, uri, widget, options));
    } catch (e) {
      const message =
        e instanceof vscode.FileSystemError && e.code === 'FileNotFound'
          ? `“${path}” was not found.`
          : e instanceof Error
            ? e.message
            : String(e);
      loaded.set(key, `<p class="diagram-error">Dashboard unavailable: ${escapeHtml(message)}</p>`);
    }
  }
  return (source) =>
    loaded.get(source) ||
    '<p class="diagram-error">Dashboard unavailable: add “path: name.wiki-dashboard.json”.</p>';
}

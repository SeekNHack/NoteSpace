import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { DashboardService, dashboardCss, toCsv, sourceUri } from './dashboards';
import { Dashboard, FilterState, parseDashboard, serializeDashboard } from './core/dashboard';
import { tokensCss } from './core/design';
import { chartCss } from './core/charts';
import { loadDataset, SourceType } from './core/dataset';
import { readXlsx } from './core/xlsx';
import { posix } from './core/paths';

const sourceTypeOf = (path: string): SourceType | undefined =>
  ({
    csv: 'csv',
    tsv: 'tsv',
    tab: 'tsv',
    json: 'json',
    jsonl: 'jsonl',
    ndjson: 'jsonl',
    xlsx: 'xlsx',
  })[path.split('.').pop()!.toLowerCase()] as SourceType | undefined;

/**
 * Dashboard builder for `*.wiki-dashboard.json`. The file is the source of truth: layout and
 * configuration edits are written back to it as ordinary edits (undo, dirty state and Save
 * work as usual). Data stays in the extension host; the webview gets computed results.
 */
export class DashboardEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'wikiStudio.dashboard';
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: DashboardService,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const nonce = randomBytes(18).toString('base64');
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    const script = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'dashboard.js'),
    );
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'"><title>Dashboard</title><style>${tokensCss}${chartCss.replace(/\.doc /g, '')}${dashboardCss.replace(/\.doc /g, '')}</style></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    let state: FilterState = {};
    let pages: Record<string, number> = {};
    let expected: string | undefined;
    let revision = 0;
    const post = async () => {
      const current = ++revision;
      let parsed: ReturnType<typeof parseDashboard>;
      try {
        parsed = parseDashboard(document.getText());
      } catch (e) {
        return void panel.webview.postMessage({
          type: 'invalid',
          message: e instanceof Error ? e.message : String(e),
        });
      }
      await panel.webview.postMessage({ type: 'loading' });
      const { results, sources } = await this.service.compute(
        document.uri,
        parsed.dashboard,
        state,
        pages,
      );
      if (current !== revision) return;
      await panel.webview.postMessage({
        type: 'model',
        dashboard: parsed.dashboard,
        errors: parsed.errors,
        results,
        sources,
        state,
        file: posix.basename(document.uri.path),
      });
    };
    const write = async (dashboard: Dashboard) => {
      const { errors } = parseDashboard(JSON.stringify(dashboard));
      const text = serializeDashboard(dashboard);
      if (text === document.getText()) return post();
      expected = text;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        text,
      );
      await vscode.workspace.applyEdit(edit);
      if (errors.length) void panel.webview.postMessage({ type: 'notice', message: errors[0] });
      await post();
    };
    const current = () => parseDashboard(document.getText()).dashboard;
    const subscriptions = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === document && e.contentChanges.length && document.getText() !== expected)
          void post();
      }),
      this.service.onDidChangeSource((uri) => {
        if (uri !== document.uri.toString()) return;
        // "refresh": { "auto": false } keeps the numbers still until Refresh is pressed.
        if (current().refresh?.auto === false)
          return void panel.webview.postMessage({
            type: 'notice',
            message: 'A source file changed. Press Refresh to load the new data.',
          });
        void post().then(() => panel.webview.postMessage({ type: 'refreshed', at: Date.now() }));
      }),
    ];
    panel.onDidDispose(() => subscriptions.forEach((s) => s.dispose()));
    panel.webview.onDidReceiveMessage(async (m: Record<string, unknown>) => {
      try {
        switch (m.type) {
          case 'ready':
            return void (await post());
          case 'filters':
            state = (m.state as FilterState) || {};
            pages = (m.pages as Record<string, number>) || {};
            return void (await post());
          case 'refresh':
            this.service.invalidate();
            await post();
            return void panel.webview.postMessage({ type: 'refreshed', at: Date.now() });
          case 'update':
            if (m.dashboard && typeof m.dashboard === 'object')
              await write(m.dashboard as Dashboard);
            return;
          case 'save':
            return void (await document.save());
          case 'addSource': {
            const picked = await vscode.window.showOpenDialog({
              canSelectMany: false,
              defaultUri: vscode.Uri.joinPath(document.uri, '..'),
              filters: { 'Data files': ['csv', 'tsv', 'xlsx', 'json', 'jsonl', 'ndjson'] },
              title:
                'Choose a data file (it stays where it is; the dashboard stores its relative path)',
            });
            const file = picked?.[0];
            if (!file) return;
            const type = sourceTypeOf(file.path);
            if (!type) throw new Error('Choose a CSV, TSV, XLSX, JSON or JSONL file.');
            const path = posix.relative(posix.dirname(document.uri.path), file.path);
            sourceUri(document.uri, path);
            let sheet: string | undefined;
            if (type === 'xlsx') {
              const book = readXlsx(await vscode.workspace.fs.readFile(file));
              sheet =
                book.sheets.length === 1
                  ? book.sheets[0].name
                  : await vscode.window.showQuickPick(
                      book.sheets.map((s) => s.name),
                      { title: 'Choose the sheet' },
                    );
              if (!sheet) return;
            }
            const dashboard = current();
            let id =
              posix
                .basename(path)
                .replace(/\.[^.]+$/, '')
                .replace(/[^\w-]+/g, '-')
                .replace(/^[^A-Za-z]+/, '') || 'data';
            for (let i = 2; dashboard.sources.some((s) => s.id === id); i++)
              id = `${id.replace(/-\d+$/, '')}-${i}`;
            dashboard.sources.push({ id, type, path, ...(sheet ? { sheet } : {}) });
            if (!dashboard.metrics.some((x) => x.source === id))
              dashboard.metrics.push({
                id: `${id}-rows`,
                source: id,
                formula: 'COUNT(rows)',
                label: 'Rows',
              });
            return void (await write(dashboard));
          }
          case 'check': {
            const dashboard = current();
            const loaded = await this.service.load(document.uri, dashboard);
            const columns = loaded.get(String(m.source))?.state.columns?.map((c) => c.name) || [];
            const result = this.service.checkFormula(
              columns,
              String(m.formula || ''),
              m.kind === 'row' ? 'row' : 'aggregate',
            );
            return void panel.webview.postMessage({ type: 'checked', id: m.id, result, columns });
          }
          case 'records': {
            const records = await this.service.records(
              document.uri,
              current(),
              String(m.source),
              (m.state as FilterState) || {},
              500,
            );
            return void panel.webview.postMessage({ type: 'records', title: m.title, ...records });
          }
          case 'exportCsv': {
            const records = await this.service.records(
              document.uri,
              current(),
              String(m.source),
              (m.state as FilterState) || {},
            );
            const target = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.joinPath(
                document.uri,
                '..',
                `${String(m.source)}-filtered.csv`,
              ),
              filters: { CSV: ['csv'] },
              title: 'Export filtered rows as CSV',
            });
            if (!target) return;
            await vscode.workspace.fs.writeFile(
              target,
              new TextEncoder().encode(toCsv(records.columns, records.rows)),
            );
            return void vscode.window.showInformationMessage(
              `Exported ${records.rows.length} row(s).`,
            );
          }
          case 'saveImage': {
            if (typeof m.data !== 'string' || !['svg', 'png'].includes(String(m.format))) return;
            const target = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.joinPath(
                document.uri,
                '..',
                `${String(m.name || 'chart').replace(/[^\w-]+/g, '-')}.${m.format}`,
              ),
              filters: { Image: [String(m.format)] },
            });
            if (!target) return;
            const bytes =
              m.format === 'svg'
                ? new TextEncoder().encode(m.data)
                : Buffer.from(m.data.replace(/^data:image\/png;base64,/, ''), 'base64');
            await vscode.workspace.fs.writeFile(target, bytes);
            return;
          }
        }
      } catch (e) {
        void panel.webview.postMessage({
          type: 'notice',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }
}

/** Creates a dashboard file for a data file, with a row count, a table and the first chart. */
export async function newDashboard(
  folder: vscode.Uri,
  data: vscode.Uri | undefined,
  title: string,
): Promise<vscode.Uri> {
  const name =
    title
      .trim()
      .replace(/[^\p{L}\p{N} ._-]+/gu, '-')
      .replace(/\s+/g, '-') || 'dashboard';
  let target = vscode.Uri.joinPath(folder, `${name}.wiki-dashboard.json`);
  for (let i = 2; ; i++) {
    try {
      await vscode.workspace.fs.stat(target);
      target = vscode.Uri.joinPath(folder, `${name}-${i}.wiki-dashboard.json`);
    } catch {
      break;
    }
  }
  const dashboard: Dashboard = {
    schemaVersion: 1,
    title: title.trim() || 'Dashboard',
    sources: [],
    metrics: [],
    widgets: [],
    filters: [],
  };
  if (data) {
    const type = sourceTypeOf(data.path);
    if (!type) throw new Error('Choose a CSV, TSV, XLSX, JSON or JSONL file.');
    const path = posix.relative(folder.path, data.path);
    const bytes = await vscode.workspace.fs.readFile(data);
    const sheet = type === 'xlsx' ? readXlsx(bytes).sheets[0].name : undefined;
    const dataset = loadDataset(type, bytes, sheet ? { sheet } : {});
    dashboard.sources.push({ id: 'data', type, path, ...(sheet ? { sheet } : {}) });
    dashboard.metrics.push({ id: 'rows', source: 'data', formula: 'COUNT(rows)', label: 'Rows' });
    dashboard.widgets.push({
      id: 'rows-card',
      type: 'metric',
      metric: 'rows',
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    const category = dataset.columns.find(
      (c) => c.type === 'string' && new Set(c.values).size <= 20 && new Set(c.values).size > 1,
    );
    const when = dataset.columns.find((c) => c.type === 'date');
    if (when)
      dashboard.widgets.push({
        id: 'trend',
        type: 'chart',
        chart: 'line',
        source: 'data',
        dimension: when.name,
        bucket: 'month',
        metrics: ['rows'],
        title: `Rows by month (${when.name})`,
        layout: { x: 3, y: 0, w: 9, h: 4 },
      });
    if (category) {
      dashboard.filters!.push({
        id: 'category',
        source: 'data',
        column: category.name,
        kind: 'select',
      });
      dashboard.widgets.push({
        id: 'by-category',
        type: 'chart',
        chart: 'bar',
        source: 'data',
        dimension: category.name,
        metrics: ['rows'],
        sort: 'value-desc',
        title: `Rows by ${category.name}`,
        layout: { x: 0, y: 4, w: 6, h: 4 },
      });
      dashboard.widgets.push({
        id: 'category-filter',
        type: 'filter',
        filter: 'category',
        layout: { x: 0, y: 2, w: 3, h: 2 },
      });
    }
    dashboard.widgets.push({
      id: 'records',
      type: 'table',
      source: 'data',
      title: 'Records',
      layout: { x: 6, y: 4, w: 6, h: 4 },
    });
  }
  await vscode.workspace.fs.writeFile(
    target,
    new TextEncoder().encode(serializeDashboard(dashboard)),
  );
  return target;
}

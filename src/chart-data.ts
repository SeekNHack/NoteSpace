import * as vscode from 'vscode';
import { embedError } from './embed-errors';
import { WikiWorkspace } from './workspace';
import { Page } from './core/model';
import { insidePath, posix, splitTarget } from './core/paths';
import { parseChartSpec, parseCsv, parseJsonRows, renderChart, Row } from './core/charts';
import type { PlannerService } from './planner';
import { escapeHtml } from './core/render';

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Prepares ```chart rendering for `page`: data files referenced by its charts are read once,
 * inside the wiki and without following symlinks, so the synchronous renderer can use them.
 */
export async function chartRenderer(
  workspace: WikiWorkspace,
  page: Page,
  planner?: PlannerService,
  includeTasks = true,
): Promise<(source: string) => string> {
  const root = workspace.rootFor(page);
  const files = new Map<string, Row[] | string>();
  for (const match of page.text.matchAll(/^```chart[^\n]*\n([\s\S]*?)^```/gm)) {
    const spec = parseChartSpec(match[1]);
    if (!spec.data || files.has(spec.data)) continue;
    files.set(
      spec.data,
      await load(workspace, page, spec.data).catch((e: unknown) => embedError(e, spec.data!)),
    );
  }
  return (source) => {
    const spec = parseChartSpec(source);
    let rows: Row[] = [];
    try {
      if (spec.inline) rows = parseCsv(spec.inline);
      else if (spec.data) {
        const loaded = files.get(spec.data);
        if (typeof loaded === 'string') return error(spec.title, loaded);
        rows = loaded || [];
      } else if (spec.source && spec.source !== 'tasks')
        return error(
          spec.title,
          `Unknown source “${spec.source}”. Use “data: file.csv” for a file or “source: tasks” for planner tasks.`,
        );
      else if (spec.source === 'tasks') {
        if (!planner || !includeTasks)
          return error(spec.title, 'Planner data is not included here.');
        // Wiki collection data: task counts grouped by a field.
        const group = (spec.group || 'status') as 'status' | 'priority' | 'project' | 'assignee';
        const counts = new Map<string, number>();
        for (const task of planner.tasks(root.id)) {
          const key = String(task[group] || `No ${group}`);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        rows = [...counts]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, count]) => ({ [group]: name, tasks: count }));
        spec.x ||= group;
        if (!spec.y.length) spec.y = ['tasks'];
      }
    } catch (e) {
      return error(spec.title, e instanceof Error ? e.message : String(e));
    }
    return renderChart(spec, rows);
  };
}

const error = (title: string | undefined, message: string) =>
  `<figure class="chart chart-error"><figcaption>${escapeHtml(title || 'Chart')}</figcaption><p class="diagram-error">Chart data unavailable: ${escapeHtml(message)}</p></figure>`;

async function load(workspace: WikiWorkspace, page: Page, target: string): Promise<Row[]> {
  const root = workspace.rootFor(page);
  const path = splitTarget(target).path;
  if (/^(?:[a-z]+:|\/\/)/i.test(path)) throw new Error('Remote data is not loaded.');
  if (!/\.(csv|json)$/i.test(path)) throw new Error('Use a .csv or .json file.');
  const file = posix.normalize(
    path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(page.path), path),
  );
  if (!insidePath(file)) throw new Error('The data file must be inside the wiki.');
  const uri = vscode.Uri.joinPath(root.uri, file);
  await workspace.assertNoSymlink(root, uri);
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > MAX_BYTES) throw new Error('The data file is larger than 2 MiB.');
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  return /\.json$/i.test(file) ? parseJsonRows(text) : parseCsv(text);
}

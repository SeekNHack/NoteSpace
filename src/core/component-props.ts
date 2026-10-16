/**
 * Properties of fenced components (```chart, ```tasks, ```dashboard …) for Studio's block
 * inspector. A component's options are `key: value` lines at the top of the block; charts may
 * continue with inline data after a `---` line. Editing a property rewrites only that line (or
 * appends it to the options); unknown lines, comments and data are kept as written.
 */
export interface ComponentField {
  key: string;
  label: string;
  kind: 'text' | 'select' | 'number' | 'path';
  options?: string[];
  placeholder?: string;
  help?: string;
  /** File extensions offered for `path` fields. */
  extensions?: string[];
}

const taskFilters: ComponentField[] = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'view', label: 'View', kind: 'select', options: ['list', 'board', 'table'] },
  {
    key: 'status',
    label: 'Status',
    kind: 'select',
    options: ['open', 'all', 'todo', 'doing', 'blocked', 'done'],
  },
  {
    key: 'page',
    label: 'Page',
    kind: 'text',
    placeholder: 'this, or a page path',
    help: '“this” limits the view to tasks on this page.',
  },
  { key: 'project', label: 'Project', kind: 'text' },
  { key: 'tag', label: 'Tag', kind: 'text' },
  { key: 'assignee', label: 'Assignee', kind: 'text' },
  { key: 'priority', label: 'Priority', kind: 'select', options: ['high', 'medium', 'low'] },
  { key: 'search', label: 'Text contains', kind: 'text' },
  { key: 'limit', label: 'Limit', kind: 'number' },
];

export const componentFields: Record<string, ComponentField[]> = {
  chart: [
    {
      key: 'type',
      label: 'Chart type',
      kind: 'select',
      options: ['bar', 'line', 'area', 'scatter', 'pie', 'donut'],
    },
    { key: 'title', label: 'Title', kind: 'text' },
    {
      key: 'data',
      label: 'Data file',
      kind: 'path',
      extensions: ['csv', 'tsv', 'json'],
      help: 'Leave empty to use the inline data after ---.',
    },
    { key: 'x', label: 'X column', kind: 'text' },
    { key: 'y', label: 'Y columns', kind: 'text', placeholder: 'visits, signups' },
    { key: 'group', label: 'Group by', kind: 'text' },
    { key: 'height', label: 'Height (px)', kind: 'number', placeholder: '280' },
  ],
  tasks: taskFilters,
  collection: [
    { key: 'source', label: 'Source', kind: 'select', options: ['tasks', 'pages'] },
    ...taskFilters,
  ],
  dashboard: [
    { key: 'path', label: 'Dashboard', kind: 'path', extensions: ['wiki-dashboard.json'] },
    { key: 'widget', label: 'Widget id', kind: 'text', help: 'Empty shows the whole dashboard.' },
  ],
  openapi: [
    { key: 'path', label: 'API description', kind: 'path', extensions: ['yaml', 'yml', 'json'] },
  ],
  notebook: [{ key: 'path', label: 'Notebook', kind: 'path', extensions: ['ipynb'] }],
  canvas: [{ key: 'path', label: 'Canvas', kind: 'path', extensions: ['canvas'] }],
};

const OPTION = /^(\s*)([A-Za-z][\w-]*)(\s*:\s*)(.*?)\s*$/;

/** The options part of a component's source (before a `---` data separator). */
function split(source: string): { head: string[]; rest: string } {
  const lines = source.split('\n');
  const sep = lines.findIndex((l) => l.trim() === '---');
  return sep < 0
    ? { head: lines, rest: '' }
    : { head: lines.slice(0, sep), rest: `\n${lines.slice(sep).join('\n')}` };
}

export function readProps(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of split(source).head) {
    const m = OPTION.exec(line);
    if (m && !(m[2].toLowerCase() in out)) out[m[2].toLowerCase()] = m[4];
  }
  return out;
}

/**
 * Applies `values` (key → new value; '' removes the option) and returns the new source.
 * Keys keep their position and spelling; new keys are appended after the last option.
 */
export function writeProps(source: string, values: Record<string, string>): string {
  const split_ = split(source.replace(/\n$/, ''));
  const rest = split_.rest;
  const head = split_.head.length === 1 && !split_.head[0].trim() ? [] : split_.head;
  const pending = new Map(
    Object.entries(values).map(([k, v]) => [k.toLowerCase(), v.replace(/[\r\n]+/g, ' ').trim()]),
  );
  const out: string[] = [];
  let lastOption = -1;
  for (const line of head) {
    const m = OPTION.exec(line);
    const key = m?.[2].toLowerCase();
    if (m && key && pending.has(key)) {
      const value = pending.get(key)!;
      pending.delete(key);
      if (value) {
        out.push(`${m[1]}${m[2]}${m[3]}${value}`);
        lastOption = out.length - 1;
      }
      continue;
    }
    out.push(line);
    if (m) lastOption = out.length - 1;
  }
  const added = [...pending].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  // Trailing empty lines of the options part stay after the inserted options.
  if (lastOption < 0) {
    const firstContent = out.findIndex((l) => l.trim());
    out.splice(firstContent < 0 ? 0 : firstContent, 0, ...added);
  } else out.splice(lastOption + 1, 0, ...added);
  const text = out.join('\n').replace(/^\n+/, '');
  return text + rest + (source.endsWith('\n') ? '\n' : '');
}

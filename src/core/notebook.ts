/**
 * Read-only Jupyter support for the reader, page embeds and static export. Notebooks are never
 * executed here; saved outputs are shown as they are in the file, after sanitising.
 */
export interface NotebookOutput {
  kind: 'stream' | 'error' | 'data';
  name?: string;
  text?: string;
  data?: Record<string, string>;
  executionCount?: number | null;
}
export interface NotebookCell {
  type: 'markdown' | 'code' | 'raw';
  source: string;
  executionCount?: number | null;
  outputs: NotebookOutput[];
  attachments?: Record<string, Record<string, string>>;
}
export interface Notebook {
  language: string;
  cells: NotebookCell[];
  nbformat: number;
}

const text = (value: unknown): string =>
  Array.isArray(value)
    ? value.filter((v) => typeof v === 'string').join('')
    : typeof value === 'string'
      ? value
      : '';

/** Parses nbformat 4 JSON. Throws a readable error for anything else. */
export function parseNotebook(json: string, maxBytes = 50 * 1024 * 1024): Notebook {
  if (json.length > maxBytes) throw new Error('Notebook is larger than 50 MiB.');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid notebook JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!value || typeof value !== 'object') throw new Error('A notebook must be a JSON object.');
  const nb = value as Record<string, unknown>;
  if (nb.nbformat !== 4)
    throw new Error(
      `Unsupported notebook format ${String(nb.nbformat)}; only nbformat 4 is supported.`,
    );
  if (!Array.isArray(nb.cells)) throw new Error('The notebook has no cells array.');
  const metadata = (nb.metadata && typeof nb.metadata === 'object' ? nb.metadata : {}) as Record<
    string,
    any
  >;
  const language = String(
    metadata.language_info?.name || metadata.kernelspec?.language || 'python',
  ).toLowerCase();
  const cells: NotebookCell[] = [];
  for (const raw of nb.cells.slice(0, 5000)) {
    if (!raw || typeof raw !== 'object') continue;
    const cell = raw as Record<string, unknown>;
    const type =
      cell.cell_type === 'markdown' || cell.cell_type === 'code' || cell.cell_type === 'raw'
        ? cell.cell_type
        : undefined;
    if (!type) continue;
    const outputs: NotebookOutput[] = [];
    for (const output of Array.isArray(cell.outputs) ? cell.outputs.slice(0, 200) : []) {
      if (!output || typeof output !== 'object') continue;
      const o = output as Record<string, unknown>;
      if (o.output_type === 'stream')
        outputs.push({ kind: 'stream', name: String(o.name || 'stdout'), text: text(o.text) });
      else if (o.output_type === 'error')
        outputs.push({
          kind: 'error',
          name: String(o.ename || 'Error'),
          text: [
            `${String(o.ename || 'Error')}: ${String(o.evalue || '')}`,
            ...(Array.isArray(o.traceback) ? o.traceback.map(String) : []),
          ].join('\n'),
        });
      else if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
        const data: Record<string, string> = {};
        for (const [mime, v] of Object.entries((o.data || {}) as Record<string, unknown>))
          data[mime] =
            typeof v === 'string' || Array.isArray(v) ? text(v) : JSON.stringify(v, null, 2);
        outputs.push({
          kind: 'data',
          data,
          executionCount: typeof o.execution_count === 'number' ? o.execution_count : null,
        });
      }
    }
    cells.push({
      type,
      source: text(cell.source),
      executionCount: typeof cell.execution_count === 'number' ? cell.execution_count : null,
      outputs,
      attachments:
        cell.attachments && typeof cell.attachments === 'object'
          ? (cell.attachments as Record<string, Record<string, string>>)
          : undefined,
    });
  }
  return { language, cells, nbformat: 4 };
}

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Strips ANSI escape sequences from tracebacks and terminal output. */
export const stripAnsi = (s: string): string =>
  s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

const allowedTags = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'b',
  'strong',
  'i',
  'em',
  'br',
  'code',
  'pre',
  'span',
  'div',
  'p',
  'sub',
  'sup',
]);
/**
 * Keeps only inert table/text markup from HTML outputs (pandas DataFrames, styled text). Every
 * attribute except colspan/rowspan is dropped; scripts, styles and their content are removed.
 */
export function sanitizeHtml(html: string): string {
  const cleaned = html
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  let out = '';
  let last = 0;
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>/g;
  for (let m = tag.exec(cleaned); m; m = tag.exec(cleaned)) {
    out += escape(decodeEntities(cleaned.slice(last, m.index)));
    last = m.index + m[0].length;
    const name = m[1].toLowerCase();
    if (!allowedTags.has(name)) continue;
    if (m[0].startsWith('</')) out += `</${name}>`;
    else {
      const attrs = [...m[2].matchAll(/\b(colspan|rowspan)\s*=\s*["']?(\d{1,3})["']?/gi)]
        .map((a) => ` ${a[1].toLowerCase()}="${a[2]}"`)
        .join('');
      out += `<${name}${attrs}>`;
    }
  }
  return out + escape(decodeEntities(cleaned.slice(last)));
}
const decodeEntities = (s: string) =>
  s.replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    (_m, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[e]!,
  );

const MAX_TEXT = 100_000;
const clip = (s: string) =>
  s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n… (${s.length - MAX_TEXT} more characters)` : s;
const base64 = /^[A-Za-z0-9+/\s]+=*\s*$/;

export interface NotebookRenderOptions {
  renderMarkdown: (markdown: string) => string;
  highlight: (code: string, language: string) => string;
  /** Inclusive 1-based cell range to show. */
  cells?: [number, number];
  showInput?: boolean;
}

function renderOutput(output: NotebookOutput, options: NotebookRenderOptions): string {
  if (output.kind === 'stream')
    return `<pre class="nb-output nb-stream${output.name === 'stderr' ? ' nb-stderr' : ''}">${escape(clip(stripAnsi(output.text || '')))}</pre>`;
  if (output.kind === 'error')
    return `<pre class="nb-output nb-error" role="alert">${escape(clip(stripAnsi(output.text || '')))}</pre>`;
  const data = output.data || {};
  for (const mime of ['image/png', 'image/jpeg', 'image/gif']) {
    const value = data[mime]?.replace(/\s+/g, '');
    if (value && base64.test(value) && value.length < 20 * 1024 * 1024)
      return `<div class="nb-output"><img alt="${escape(data['text/plain']?.slice(0, 200) || 'Notebook output image')}" src="data:${mime};base64,${value}"></div>`;
  }
  if (data['image/svg+xml'] && data['image/svg+xml'].length < 5 * 1024 * 1024)
    // Rendered as an image so scripts and external references inside the SVG never run.
    return `<div class="nb-output"><img alt="Notebook output image" src="data:image/svg+xml;base64,${Buffer.from(data['image/svg+xml']).toString('base64')}"></div>`;
  if (data['text/html'])
    return `<div class="nb-output nb-html">${sanitizeHtml(clip(data['text/html']))}</div>`;
  if (data['text/markdown'])
    return `<div class="nb-output">${options.renderMarkdown(clip(data['text/markdown']))}</div>`;
  if (data['application/json'])
    return `<pre class="nb-output">${escape(clip(data['application/json']))}</pre>`;
  if (data['text/plain'])
    return `<pre class="nb-output">${escape(clip(stripAnsi(data['text/plain'])))}</pre>`;
  const kinds = Object.keys(data);
  return kinds.length
    ? `<p class="nb-output muted">Output not shown (${escape(kinds.join(', '))}).</p>`
    : '';
}

/** Static HTML for a notebook or a cell range. Markdown attachments become data URIs. */
export function renderNotebook(notebook: Notebook, options: NotebookRenderOptions): string {
  const [from, to] = options.cells || [1, notebook.cells.length];
  const parts: string[] = [];
  notebook.cells.forEach((cell, index) => {
    const n = index + 1;
    if (n < from || n > to) return;
    if (cell.type === 'markdown') {
      let source = cell.source;
      for (const [name, files] of Object.entries(cell.attachments || {})) {
        const mime = Object.keys(files).find((m) => /^image\/(png|jpeg|gif)$/.test(m));
        if (mime && base64.test(files[mime]))
          source = source
            .split(`attachment:${name}`)
            .join(`data:${mime};base64,${files[mime].replace(/\s+/g, '')}`);
      }
      parts.push(
        `<section class="nb-cell nb-markdown" aria-label="Markdown cell ${n}">${options.renderMarkdown(source)}</section>`,
      );
    } else if (cell.type === 'raw')
      parts.push(`<section class="nb-cell nb-raw"><pre>${escape(cell.source)}</pre></section>`);
    else {
      const prompt = `<span class="nb-prompt" aria-hidden="true">[${cell.executionCount ?? ' '}]</span>`;
      const input =
        options.showInput === false
          ? ''
          : `<div class="nb-input">${prompt}<pre><code class="hljs">${options.highlight(cell.source, notebook.language)}</code></pre></div>`;
      parts.push(
        `<section class="nb-cell nb-code" aria-label="Code cell ${n}${cell.executionCount ? `, execution ${cell.executionCount}` : ''}">${input}${cell.outputs.map((o) => renderOutput(o, options)).join('')}</section>`,
      );
    }
  });
  return `<div class="notebook">${parts.join('')}</div>`;
}

/** Converts a notebook to a Markdown page; images are returned separately for asset import. */
export function notebookToMarkdown(
  notebook: Notebook,
  title: string,
): { markdown: string; images: Array<{ name: string; mime: string; data: string }> } {
  const images: Array<{ name: string; mime: string; data: string }> = [];
  const parts = [`# ${title}`];
  notebook.cells.forEach((cell, index) => {
    if (cell.type === 'markdown') parts.push(cell.source.trim());
    else if (cell.type === 'raw')
      parts.push(`\`\`\`text\n${cell.source.replace(/\n$/, '')}\n\`\`\``);
    else {
      const fence = '`'.repeat(
        Math.max(3, ...[...cell.source.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)),
      );
      parts.push(`${fence}${notebook.language}\n${cell.source.replace(/\n$/, '')}\n${fence}`);
      cell.outputs.forEach((output, k) => {
        const image = output.data && ['image/png', 'image/jpeg'].find((m) => output.data![m]);
        if (image) {
          const name = `cell-${index + 1}-output-${k + 1}.${image === 'image/png' ? 'png' : 'jpg'}`;
          images.push({ name, mime: image, data: output.data![image].replace(/\s+/g, '') });
          parts.push(`![Output of cell ${index + 1}](${name})`);
          return;
        }
        const value = output.kind === 'data' ? output.data?.['text/plain'] : output.text;
        if (value) parts.push(`\`\`\`text\n${stripAnsi(value).replace(/\n$/, '')}\n\`\`\``);
      });
    }
  });
  return { markdown: `${parts.join('\n\n')}\n`, images };
}

export const notebookCss = `.doc .notebook{margin:1em 0}
.doc .nb-cell{margin:.8em 0}
.doc .nb-input{display:flex;gap:8px;align-items:flex-start}
.doc .nb-input pre{flex:1;margin:0;min-width:0}
.doc .nb-prompt{font:12px var(--ws-mono);color:var(--ws-muted);padding-top:12px;min-width:3.5ch;text-align:right}
.doc .nb-output{margin:.4em 0 .4em calc(3.5ch + 8px);overflow-x:auto}
.doc pre.nb-output{background:none;border:0;border-left:2px solid var(--ws-hairline);border-radius:0;padding:4px 12px;font-size:12.5px}
.doc .nb-stderr{color:var(--ws-orange)}
.doc .nb-error{color:var(--ws-error);border-left-color:var(--ws-error)!important}
.doc .nb-html table{font-size:.85em}
.doc .nb-markdown{padding:0 0 0 calc(3.5ch + 8px)}
.doc .notebook-error{color:var(--ws-error)}`;

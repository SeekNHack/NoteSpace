import * as vscode from 'vscode';
import { embedError } from './embed-errors';
import { randomBytes } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import { WikiRoot, WikiWorkspace } from './workspace';
import { Page } from './core/model';
import { insidePath, posix, splitTarget } from './core/paths';
import { notebookCss, notebookToMarkdown, parseNotebook, renderNotebook } from './core/notebook';
import { contentCss, escapeHtml } from './core/render';
import { storeImage } from './assets';

export interface NotebookFile {
  root: string;
  path: string;
  uri: vscode.Uri;
}

const inert = new MarkdownIt({ html: false, linkify: true });
const highlight = (code: string, language: string) =>
  hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : escapeHtml(code);
const renderOptions = { renderMarkdown: (md: string) => inert.render(md), highlight };

/** Notebooks inside wiki roots. Opening uses VS Code's notebook editor; reading needs no kernel. */
export class NotebookCatalog implements vscode.Disposable {
  private files: NotebookFile[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly glob = '**/*.ipynb',
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    this.subscriptions = [
      watcher,
      watcher.onDidCreate(() => this.schedule()),
      watcher.onDidDelete(() => this.schedule()),
      workspace.onDidChange(() => this.schedule()),
    ];
    this.schedule();
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 150);
  }
  async refresh(): Promise<void> {
    const files: NotebookFile[] = [];
    for (const root of this.workspace.roots) {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root.uri, this.glob),
        '**/{node_modules,.git,.notespace-trash,.ipynb_checkpoints}/**',
        2000,
      );
      for (const uri of found)
        files.push({ root: root.id, path: posix.relative(root.uri.path, uri.path), uri });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const changed =
      JSON.stringify(files.map((f) => f.uri.toString())) !==
      JSON.stringify(this.files.map((f) => f.uri.toString()));
    this.files = files;
    if (changed) this.emitter.fire();
  }
  all(rootId?: string): NotebookFile[] {
    return this.files.filter((f) => !rootId || f.root === rootId);
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.subscriptions.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}

export async function readNotebook(uri: vscode.Uri) {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > 50 * 1024 * 1024) throw new Error('Notebook is larger than 50 MiB.');
  // An open notebook editor may hold unsaved cells; reading the file shows the saved state.
  return parseNotebook(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
}

/** Prepares ```notebook embeds of `page` (path, optional cell range, input on/off). */
export async function notebookRenderer(
  workspace: WikiWorkspace,
  page: Page,
): Promise<(source: string) => string> {
  const root = workspace.rootFor(page);
  const loaded = new Map<string, string>();
  for (const match of page.text.matchAll(/^```notebook[^\n]*\n([\s\S]*?)^```/gm)) {
    const spec = spec_(match[1]);
    if (!spec.path || loaded.has(spec.path)) continue;
    try {
      const uri = await resolveNotebook(workspace, root, page, spec.path);
      loaded.set(spec.path, JSON.stringify(await readNotebook(uri)));
    } catch (e) {
      loaded.set(spec.path, `ERROR:${embedError(e, spec.path)}`);
    }
  }
  return (source) => {
    const spec = spec_(source);
    const data = spec.path ? loaded.get(spec.path) : undefined;
    if (!data || data.startsWith('ERROR:'))
      return `<div class="notebook notebook-error"><p>Notebook unavailable: ${escapeHtml(data ? data.slice(6) : 'add "path: file.ipynb"')}</p></div>`;
    const range = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(spec.cells || '');
    return renderNotebook(JSON.parse(data), {
      ...renderOptions,
      cells: range ? [Number(range[1]), Number(range[2] || range[1])] : undefined,
      showInput: spec.input !== 'false',
    });
  };
}
const spec_ = (source: string) => {
  const spec: Record<string, string> = {};
  for (const line of source.split('\n')) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m) spec[m[1].toLowerCase()] = m[2];
  }
  return spec;
};

async function resolveNotebook(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  target: string,
): Promise<vscode.Uri> {
  const path = splitTarget(target).path;
  if (/^(?:[a-z]+:|\/\/)/i.test(path) || !/\.ipynb$/i.test(path))
    throw new Error('Use a local .ipynb path.');
  const file = posix.normalize(
    path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(page.path), path),
  );
  if (!insidePath(file)) throw new Error('The notebook must be inside the wiki.');
  const uri = vscode.Uri.joinPath(root.uri, file);
  await workspace.assertNoSymlink(root, uri);
  return uri;
}

export const renderNotebookHtml = (notebook: ReturnType<typeof parseNotebook>) =>
  renderNotebook(notebook, renderOptions);

/** Static HTML for a whole notebook, shared by the preview panel and export. */
export function notebookPageHtml(title: string, html: string): string {
  return `<h1>${escapeHtml(title)}</h1>${html}`;
}

let preview: vscode.WebviewPanel | undefined;
/** Read-only notebook preview; works without any kernel or Jupyter extension. */
export async function showNotebookPreview(
  uri: vscode.Uri,
  extensionUri: vscode.Uri,
): Promise<void> {
  const notebook = await readNotebook(uri);
  const title = posix.basename(uri.path);
  if (!preview) {
    preview = vscode.window.createWebviewPanel(
      'notespace.notebookPreview',
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
        localResourceRoots: [extensionUri],
      },
    );
    preview.onDidDispose(() => (preview = undefined));
  }
  preview.title = `Preview: ${title}`;
  const kernel = vscode.extensions.getExtension('ms-toolsai.jupyter')
    ? 'Run cells in the notebook editor with the Jupyter extension.'
    : vscode.workspace.isTrusted
      ? 'Run Python cells in the notebook editor with the NoteSpace Python kernel, or install the Jupyter extension.'
      : 'Running cells requires a trusted workspace.';
  const nonce = randomBytes(12).toString('base64');
  preview.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'"><style nonce="${nonce}">${contentCss}${notebookCss}main{max-width:900px;margin:0 auto;padding:24px 32px}.banner{font-size:12px;color:var(--ws-muted);margin-bottom:16px}</style></head><body><main class="doc"><p class="banner">Saved outputs · read-only preview. ${escapeHtml(kernel)}</p>${notebookPageHtml(title, renderNotebook(notebook, renderOptions))}</main></body></html>`;
  preview.reveal(vscode.ViewColumn.Beside, true);
}

/** Copies a validated notebook into the wiki's notebooks folder; never overwrites. */
export async function importNotebook(
  workspace: WikiWorkspace,
  root: WikiRoot,
  source: vscode.Uri,
): Promise<vscode.Uri> {
  if (!/\.ipynb$/i.test(source.path)) throw new Error('Choose a .ipynb notebook.');
  const bytes = await vscode.workspace.fs.readFile(source);
  parseNotebook(new TextDecoder().decode(bytes));
  const directory = vscode.Uri.joinPath(root.uri, 'notebooks');
  await workspace.assertNoSymlink(root, directory);
  await vscode.workspace.fs.createDirectory(directory);
  const base =
    posix.basename(source.path, '.ipynb').replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'notebook';
  for (let i = 0; i < 1000; i++) {
    const uri = vscode.Uri.joinPath(directory, `${base}${i ? `-${i}` : ''}.ipynb`);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.writeFile(uri, bytes);
      return uri;
    }
  }
  throw new Error('Could not find a free notebook filename.');
}

/** Writes a Markdown page beside the notebook; output images go to wiki assets. */
export async function convertNotebook(
  workspace: WikiWorkspace,
  root: WikiRoot,
  uri: vscode.Uri,
): Promise<vscode.Uri> {
  const notebook = await readNotebook(uri);
  const relative = posix.relative(root.uri.path, uri.path);
  const title = posix.basename(relative, '.ipynb');
  const { markdown, images } = notebookToMarkdown(notebook, title);
  const target = relative.replace(/\.ipynb$/i, '.md');
  if (workspace.index.all(root.id).some((p) => p.path.toLowerCase() === target.toLowerCase()))
    throw new Error(`${target} already exists.`);
  let text = markdown;
  const placeholder = { root: root.id, path: target } as Page;
  for (const image of images) {
    const stored = await storeImage(
      workspace,
      root,
      placeholder,
      posix.basename(image.name, posix.extname(image.name)),
      image.mime === 'image/png' ? '.png' : '.jpg',
      Buffer.from(image.data, 'base64'),
    );
    text = text.split(`](${image.name})`).join(`](${stored})`);
  }
  return workspace.createPage(root, target, text);
}

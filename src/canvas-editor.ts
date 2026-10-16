import * as vscode from 'vscode';
import { embedError } from './embed-errors';
import { randomBytes } from 'node:crypto';
import { WikiWorkspace } from './workspace';
import { parseCanvas, renderCanvasSvg, serializeCanvas } from './core/canvas';
import { Page } from './core/model';
import { encodePath, insidePath, splitTarget, uriPath } from './core/paths';
import { escapeHtml } from './core/render';
import { tokensCss } from './core/design';
import { posix } from './core/paths';

/**
 * Visual editor for JSON Canvas files. The webview edits a copy and sends the whole canvas;
 * the host replaces the document text (VS Code keeps undo, dirty state and Save).
 */
export class CanvasEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'notespace.canvas';
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly extensionUri: vscode.Uri,
    private readonly openPage: (uri: vscode.Uri) => Promise<void>,
  ) {}
  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const nonce = randomBytes(18).toString('base64');
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    const script = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'canvas.js'),
    );
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'"><title>Canvas</title><style>${tokensCss}html,body{margin:0;height:100%;background:var(--ws-bg);color:var(--ws-fg);font:13px var(--ws-font);overflow:hidden}</style></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    let expected: string | undefined;
    const post = () => {
      const text = document.getText();
      try {
        void panel.webview.postMessage({ type: 'document', canvas: parseCanvas(text) });
      } catch (error) {
        void panel.webview.postMessage({
          type: 'invalid',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    const pageRoot = () =>
      this.workspace.roots.find((r) =>
        uriPath(document.uri).startsWith(uriPath(r.uri).replace(/\/$/, '') + '/'),
      );
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document || !event.contentChanges.length) return;
      if (document.getText() === expected) return;
      post();
    });
    panel.onDidDispose(() => subscription.dispose());
    panel.webview.onDidReceiveMessage(async (m: Record<string, unknown>) => {
      if (m?.type === 'ready') return post();
      if (m?.type === 'save') return void (await document.save());
      if (m?.type === 'change' && m.canvas && typeof m.canvas === 'object') {
        // Re-validate everything coming from the webview before it reaches the file.
        const text = serializeCanvas(parseCanvas(JSON.stringify(m.canvas)));
        if (text === document.getText()) return;
        expected = text;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          text,
        );
        await vscode.workspace.applyEdit(edit);
        return;
      }
      if (m?.type === 'pickPage') {
        const root = pageRoot();
        const pages = root ? this.workspace.index.all(root.id) : this.workspace.index.all();
        const picked = await vscode.window.showQuickPick(
          pages.map((p) => ({ label: p.title, description: p.path, path: p.path })),
          { title: 'Add a wiki page to the canvas' },
        );
        if (picked)
          void panel.webview.postMessage({
            type: 'pagePicked',
            file: picked.path,
            title: picked.label,
          });
        return;
      }
      if (m?.type === 'openFile' && typeof m.file === 'string') {
        const root = pageRoot();
        const page = root && this.workspace.index.all(root.id).find((p) => p.path === m.file);
        if (page) await this.openPage(vscode.Uri.parse(page.uri));
        else void vscode.window.showWarningMessage(`“${m.file}” is not a page of this wiki.`);
        return;
      }
      if (m?.type === 'openLink' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url))
        await vscode.env.openExternal(vscode.Uri.parse(m.url));
    });
  }
}

/** Creates an empty canvas in the wiki's canvases folder. */
export async function newCanvas(
  workspace: WikiWorkspace,
  rootId: string,
  name: string,
): Promise<vscode.Uri> {
  const root = workspace.roots.find((r) => r.id === rootId);
  if (!root) throw new Error('This wiki is no longer open.');
  const safe =
    name
      .trim()
      .replace(/[^\p{L}\p{N} ._-]+/gu, '-')
      .replace(/\s+/g, '-') || 'Canvas';
  const directory = vscode.Uri.joinPath(root.uri, 'canvases');
  await workspace.assertNoSymlink(root, directory);
  await vscode.workspace.fs.createDirectory(directory);
  for (let i = 0; i < 1000; i++) {
    const uri = vscode.Uri.joinPath(directory, `${safe}${i ? `-${i}` : ''}.canvas`);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.writeFile(
        uri,
        new TextEncoder().encode(serializeCanvas({ nodes: [], edges: [] })),
      );
      return uri;
    }
  }
  throw new Error(`Could not find a free name in ${posix.join(root.uri.path, 'canvases')}.`);
}

/** Prepares ```canvas embeds (`path: maps/overview.canvas`) as static SVG previews. */
export async function canvasRenderer(
  workspace: WikiWorkspace,
  page: Page,
  pageHref?: (path: string) => string | undefined,
): Promise<(source: string) => string> {
  const root = workspace.rootFor(page);
  const loaded = new Map<string, string>();
  for (const match of page.text.matchAll(/^```canvas[^\n]*\n([\s\S]*?)^```/gm)) {
    const path = /^\s*path\s*:\s*(.+?)\s*$/m.exec(match[1])?.[1];
    if (!path || loaded.has(path)) continue;
    try {
      const target = splitTarget(path).path;
      const file = posix.normalize(
        target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(page.path), target),
      );
      if (!insidePath(file) || !/\.canvas$/i.test(file))
        throw new Error('Use a .canvas file inside the wiki.');
      const uri = vscode.Uri.joinPath(root.uri, file);
      await workspace.assertNoSymlink(root, uri);
      loaded.set(
        path,
        renderCanvasSvg(
          parseCanvas(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))),
          posix.basename(file, '.canvas'),
          pageHref,
        ),
      );
    } catch (e) {
      loaded.set(
        path,
        `<p class="diagram-error">Canvas unavailable: ${escapeHtml(embedError(e, path))}</p>`,
      );
    }
  }
  return (source) => {
    const path = /^\s*path\s*:\s*(.+?)\s*$/m.exec(source)?.[1];
    return (
      (path && loaded.get(path)) ||
      '<p class="diagram-error">Canvas unavailable: add "path: file.canvas".</p>'
    );
  };
}
void encodePath;

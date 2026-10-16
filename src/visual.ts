import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WikiWorkspace } from './workspace';
import { escapeHtml, renderPage, safeExternal } from './core/render';
import { markdown, parsePage } from './core/markdown';
import { pageWithIncludes } from './core/includes';
import { planVisualBodyEdit, splitFrontmatter, visualSafety } from './core/visual-safety';
import {
  importImage,
  resolveImage,
  resolveMedia,
  storeImage,
  browseImages,
  importAttachment,
  importMedia,
} from './assets';
import { encodePath, isExternal, posix, uriPath } from './core/paths';
import { mermaidSvg, renderDiagrams } from './diagrams';
import { locateText, plainLine } from './core/source-map';
import { closeCompanion, modeOf, showCode, showSplit, showStudio, studioColumn } from './modes';
import { visualShellCss } from './visual-css';
import { Page } from './core/model';
import { chartRenderer } from './chart-data';
import { importNotebook, notebookRenderer } from './notebooks';
import { canvasRenderer, newCanvas } from './canvas-editor';
import { looksLikeOpenApi, openApiRenderer } from './api-playground';
import { dashboardRenderer } from './dashboards';
import { parseCodeRef } from './core/code-refs';
import type { PlannerService } from './planner';
import type { CodeRunner } from './code-runner';
import { applyChange as applyEdit, rebaseEdit } from './core/rebase';

const nonce = () => randomBytes(18).toString('base64');

/** Shared with the extension so link navigation from Studio keeps the right editor. */
export interface StudioHost {
  planner?: PlannerService;
  runner?: CodeRunner;
  collection?(page: Page): ((kind: 'tasks' | 'collection', source: string) => string) | undefined;
  openPage(page: Page, options?: { anchor?: string; from?: 'studio' }): Promise<void>;
  createPage(name: string, root: string): Promise<void>;
  /** Interactive ```http blocks (rendering and Send). */
  http?: import('./http-blocks').HttpBlocks;
}

export class VisualEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'notespace.visual';
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.emitter.event;
  /** Studio panels keyed by document URI with their sync state for the status bar. */
  readonly states = new Map<string, string>();
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly extensionUri: vscode.Uri,
    private readonly host?: StudioHost,
  ) {}

  /** Asks every Studio panel for `uri` to flush pending edits and resolves when they are applied. */
  async flush(uri: vscode.Uri): Promise<void> {
    const panels = [...(this.panels.get(uri.toString()) || [])];
    await Promise.all(
      panels.map(
        (panel) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              sub.dispose();
              resolve();
            }, 2000);
            const sub = panel.webview.onDidReceiveMessage((m) => {
              if (m?.type === 'flushed') {
                clearTimeout(timer);
                sub.dispose();
                resolve();
              }
            });
            void panel.webview.postMessage({ type: 'flush' });
          }),
      ),
    );
  }

  /** Moves the Studio caret near a source offset (Split mode follow, or Code → Studio). */
  reveal(uri: vscode.Uri, text: string, ratio: number): void {
    for (const panel of this.panels.get(uri.toString()) || [])
      void panel.webview.postMessage({ type: 'reveal', text, ratio });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const key = document.uri.toString();
    const pageOf = () => this.workspace.index.byUri(key);
    const initial = pageOf();
    if (!initial) throw new Error('Open a Markdown page inside a NoteSpace project.');
    if (!this.panels.has(key)) this.panels.set(key, new Set());
    this.panels.get(key)!.add(panel);
    const roots = this.workspace.roots.flatMap((r) =>
      r.projectUri ? [r.uri, r.projectUri] : [r.uri],
    );
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri, ...roots],
    };
    const n = nonce();
    const script = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'visual.js'),
    );
    const width = vscode.workspace
      .getConfiguration('notespace', document.uri)
      .get<string>('editor.width', 'normal');
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${n}'; style-src 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource}; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(initial.title)}</title><style>${visualShellCss}</style></head><body data-width="${escapeHtml(width)}"><div id="app"></div><script nonce="${n}" src="${script}"></script></body></html>`;

    /** Texts the webview may base an edit on, by id. `v<N>` are document versions. */
    const known = new Map<string, string>();
    let synthetic = 0;
    const remember = (id: string, text: string) => {
      known.set(id, text);
      while (known.size > 24) known.delete(known.keys().next().value!);
    };
    let expected: string | undefined;
    let lastReason: string | undefined;

    const context = () => {
      const page = pageOf() || initial;
      const root = this.workspace.rootFor(page);
      const folders = page.path.split('/').slice(0, -1);
      return {
        wiki: root.name,
        folders,
        title: page.title,
        path: page.path,
        backlinks: this.workspace.index.backlinks(page).filter((b) => b.page.id !== page.id).length,
        mode: modeOf(document.uri) === 'split' ? 'split' : 'studio',
        runners: this.host?.runner?.available() || {},
      };
    };
    const images = async (text: string) => {
      const page = pageOf() || initial;
      const current = parsePage(page.root, page.path, page.uri, text);
      const root = this.workspace.rootFor(page),
        map: Record<string, string> = {};
      for (const link of current.links.filter((l) => l.kind === 'image')) {
        if (isExternal(link.target)) continue;
        const uri = await resolveImage(this.workspace, root, current, link.target);
        if (uri) map[link.target] = panel.webview.asWebviewUri(uri).toString();
      }
      return map;
    };
    /** Faithful read-only rendering for pages Studio cannot edit without losing syntax. */
    const fallback = async (text: string): Promise<string | undefined> => {
      const page = pageOf() || initial;
      const current = parsePage(page.root, page.path, page.uri, text);
      const expanded = pageWithIncludes(current, this.workspace.index);
      const root = this.workspace.rootFor(page);
      const images = new Map<string, string>(),
        media = new Map<string, string>();
      for (const link of expanded.links.filter((l) => l.kind === 'image')) {
        if (isExternal(link.target)) continue;
        const isMedia = /\.(?:mp4|webm|mp3|ogg)(?:[#?].*)?$/i.test(link.target);
        const uri = isMedia
          ? await resolveMedia(this.workspace, root, current, link.target)
          : await resolveImage(this.workspace, root, current, link.target);
        if (uri)
          (isMedia ? media : images).set(
            markdown.normalizeLink(link.target),
            panel.webview.asWebviewUri(uri).toString(),
          );
      }
      try {
        return await renderDiagrams(
          renderPage(expanded, this.workspace.index, {
            pageHref: (target, anchor) =>
              target.id === page.id && anchor
                ? `#${anchor}`
                : encodePath(posix.relative(posix.dirname(page.path), target.path)) +
                  (anchor ? `#${encodeURIComponent(anchor)}` : ''),
            imageHref: (target) => images.get(target),
            mediaHref: (target) => media.get(target),
            collection: this.host?.collection?.(page),
            chart: await chartRenderer(this.workspace, { ...page, text }, this.host?.planner),
            notebook: await notebookRenderer(this.workspace, { ...page, text }),
            openapi: await openApiRenderer(this.workspace, { ...page, text }),
            dashboard: await dashboardRenderer(vscode.Uri.parse(page.uri), text),
            canvas: await canvasRenderer(this.workspace, { ...page, text }),
            http: this.host?.http ? await this.host.http.renderer(text) : undefined,
          }),
        );
      } catch {
        return undefined;
      }
    };
    const post = async (type: 'init' | 'document') => {
      const text = document.getText();
      const version = document.version;
      remember(`v${version}`, text);
      expected = text;
      lastReason = visualSafety(text);
      await panel.webview.postMessage({
        type,
        text,
        base: `v${version}`,
        reason: lastReason,
        fallback: lastReason ? await fallback(text) : undefined,
        dirty: document.isDirty,
        images: await images(text),
        context: context(),
      });
    };
    const postContext = () =>
      void panel.webview.postMessage({ type: 'context', context: context() });

    const subscriptions = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== key || !event.contentChanges.length) return;
        const text = document.getText();
        remember(`v${document.version}`, text);
        if (text === expected) return;
        void post('document');
      }),
      vscode.workspace.onDidSaveTextDocument((saved) => {
        if (saved === document) void panel.webview.postMessage({ type: 'dirty', dirty: false });
      }),
      vscode.window.tabGroups.onDidChangeTabs(postContext),
      vscode.window.tabGroups.onDidChangeTabGroups(postContext),
      this.workspace.onDidChange(postContext),
      vscode.window.onDidChangeActiveColorTheme(
        () => void panel.webview.postMessage({ type: 'theme' }),
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        // Enabling or disabling the code runner shows or hides Run buttons immediately.
        if (event.affectsConfiguration('notespace.codeRunner')) postContext();
        if (event.affectsConfiguration('notespace.editor.width', document.uri))
          void panel.webview.postMessage({
            type: 'width',
            width: vscode.workspace
              .getConfiguration('notespace', document.uri)
              .get<string>('editor.width', 'normal'),
          });
      }),
      panel.onDidChangeViewState(() => {
        if (panel.active) this.states.set(key, this.states.get(key) || 'Ready');
        this.emitter.fire();
      }),
    ];
    panel.onDidDispose(() => {
      subscriptions.forEach((s) => s.dispose());
      this.panels.get(key)?.delete(panel);
      if (!this.panels.get(key)?.size) {
        this.panels.delete(key);
        this.states.delete(key);
      }
      this.emitter.fire();
    });

    const applyStudioEdit = async (m: { base: string; body: string }) => {
      const current = document.getText();
      const baseText = known.get(m.base);
      const reason = visualSafety(current);
      const conflict = async (why: string) =>
        panel.webview.postMessage({ type: 'conflict', reason: why });
      if (baseText === undefined) return conflict('Studio lost track of the source version.');
      if (reason) return conflict(reason);
      const studio = planVisualBodyEdit(baseText, m.body);
      let edit = studio;
      let resync = false;
      if (baseText !== current && studio) {
        // The source changed under Studio (Split mode or an external tool). Rebase when the
        // two edits touch different text; otherwise stop and let the user decide.
        const rebased = rebaseEdit(baseText, current, studio);
        if ('conflict' in rebased)
          return conflict('The Markdown source changed in the same place you edited.');
        edit = rebased.change;
        resync = true;
      } else if (baseText !== current) resync = true;
      let believed = baseText;
      if (studio) believed = applyEdit(baseText, studio);
      if (edit) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.replace(
          document.uri,
          new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
          edit.text,
        );
        expected = applyEdit(current, edit);
        if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
          expected = undefined;
          return conflict('VS Code rejected the edit.');
        }
      }
      const version = `v${document.version}`;
      remember(version, document.getText());
      let base = version;
      if (resync || document.getText() !== believed) {
        base = `s${++synthetic}`;
        remember(base, believed);
      }
      await panel.webview.postMessage({
        type: 'ack',
        base,
        version,
        resync: base !== version ? document.getText() : undefined,
        dirty: document.isDirty,
        images: resync ? await images(document.getText()) : undefined,
      });
    };

    panel.webview.onDidReceiveMessage((message: unknown) =>
      handle(message).catch((error) =>
        this.workspace.log.appendLine(
          `[studio] ${error instanceof Error ? error.stack : String(error)}`,
        ),
      ),
    );
    const handle = async (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const m = message as Record<string, unknown>;
      const page = pageOf() || initial;
      const root = this.workspace.rootFor(page);
      if (
        this.host?.http &&
        (await this.host.http.handle(m, (reply) => panel.webview.postMessage(reply)))
      )
        return;
      if (
        this.host?.planner &&
        (await this.host.planner.handleMove(m, (reply) => panel.webview.postMessage(reply)))
      )
        return;
      switch (m.type) {
        case 'ready':
          await post('init');
          return;
        case 'state':
          if (typeof m.state === 'string') {
            this.states.set(key, m.state.slice(0, 60));
            this.emitter.fire();
          }
          return;
        case 'reload':
          await post('document');
          return;
        case 'edit':
          if (
            typeof m.body === 'string' &&
            typeof m.base === 'string' &&
            m.body.length <= 4 * 1024 * 1024
          )
            await applyStudioEdit(m as { base: string; body: string });
          return;
        case 'save': {
          const saved = await document.save();
          await panel.webview.postMessage({ type: 'saved', saved });
          return;
        }
        case 'mode': {
          const target = m.mode;
          const caret = typeof m.text === 'string' ? m.text.slice(0, 300) : '';
          const ratio = typeof m.ratio === 'number' ? m.ratio : 0;
          const text = document.getText();
          const offset = locateText(text, caret, ratio);
          const at = offset === undefined ? undefined : document.positionAt(offset);
          const selection = at && new vscode.Range(at, at);
          if (target === 'source')
            await showCode(document.uri, {
              column: studioColumn(document.uri) ?? panel.viewColumn,
              selection,
              replace: true,
            });
          else if (target === 'split') {
            if (modeOf(document.uri) === 'split') await closeCompanion(document.uri, 'studio');
            else await showSplit(document.uri, selection);
          } else if (target === 'studio' && modeOf(document.uri) === 'split')
            await closeCompanion(document.uri, 'studio');
          postContext();
          return;
        }
        case 'caret': {
          // Split mode: keep the source editor near the Studio caret without stealing focus.
          if (typeof m.text !== 'string' || modeOf(document.uri) !== 'split') return;
          const offset = locateText(document.getText(), m.text.slice(0, 300), Number(m.ratio) || 0);
          if (offset === undefined) return;
          const position = document.positionAt(offset);
          for (const editor of vscode.window.visibleTextEditors)
            if (editor.document === document)
              editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport,
              );
          return;
        }
        case 'copyDraft':
          if (typeof m.body === 'string' && m.body.length <= 4 * 1024 * 1024) {
            await vscode.env.clipboard.writeText(m.body);
            await panel.webview.postMessage({ type: 'draftCopied' });
          }
          return;
        case 'suggestPages': {
          if (typeof m.query !== 'string' || m.query.length > 100) return;
          const query = m.query.trim().toLocaleLowerCase();
          const pages = this.workspace.index
            .all(page.root)
            .filter((p) => p.id !== page.id)
            .filter((p) => `${p.title} ${p.path}`.toLocaleLowerCase().includes(query))
            .sort(
              (a, b) =>
                Number(!a.title.toLocaleLowerCase().startsWith(query)) -
                  Number(!b.title.toLocaleLowerCase().startsWith(query)) ||
                a.title.localeCompare(b.title),
            )
            .slice(0, 30)
            .map((p) => ({
              title: p.title,
              path: p.path,
              target: encodePath(
                posix.relative(posix.dirname(page.path), p.path) || posix.basename(p.path),
              ),
            }));
          await panel.webview.postMessage({
            type: 'pageSuggestions',
            query: m.query,
            purpose: m.purpose,
            pages,
          });
          return;
        }
        case 'previewLink': {
          if (typeof m.href !== 'string' || m.href.length > 512) return;
          const kind = m.kind === 'wiki' ? 'wiki' : 'markdown';
          if (isExternal(m.href)) {
            await panel.webview.postMessage({ type: 'linkPreview', href: m.href, external: true });
            return;
          }
          const target = this.workspace.index.resolve(page, m.href, kind);
          await panel.webview.postMessage({
            type: 'linkPreview',
            href: m.href,
            title: target.page?.title,
            path: target.page?.path,
            missing: !target.page,
            excerpt: target.page?.body
              .replace(/^#{1,6}\s+.*$/m, '')
              .replace(/^:::.*$/gm, '')
              .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
              .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
              .replace(/^\s*[-*+]\s+/gm, '')
              .replace(/[#*_`>[\]]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200),
          });
          return;
        }
        case 'openLink': {
          if (typeof m.href !== 'string' || m.href.length > 1024) return;
          const href = m.href;
          if (isExternal(href)) {
            if (safeExternal(href)) await vscode.env.openExternal(vscode.Uri.parse(href));
            return;
          }
          if (href.startsWith('#')) {
            await panel.webview.postMessage({ type: 'scrollToHeading', slug: href.slice(1) });
            return;
          }
          const kind = m.kind === 'wiki' ? 'wiki' : 'markdown';
          if (kind === 'markdown' && parseCodeRef(href)) {
            await vscode.commands.executeCommand('notespace.openCodeRef', page.uri, href);
            return;
          }
          const result = this.workspace.index.resolve(page, href, kind);
          if (result.page && !result.error)
            await this.host?.openPage(result.page, {
              anchor: result.heading?.slug,
              from: 'studio',
            });
          else if (result.error === 'missing' && kind === 'wiki') {
            const name = href.split('#')[0].replace(/^\//, '');
            const choice = await vscode.window.showInformationMessage(
              `“${name}” does not exist yet.`,
              'Create Page',
            );
            if (choice) await this.host?.createPage(name, page.root);
          } else
            void vscode.window.showWarningMessage(
              `Cannot open link “${href}”: ${result.error || 'target not found'}.`,
            );
          return;
        }
        case 'runCode': {
          if (
            typeof m.id !== 'string' ||
            typeof m.language !== 'string' ||
            typeof m.code !== 'string'
          )
            return;
          try {
            const cwd =
              document.uri.scheme === 'file' ? posix.dirname(document.uri.fsPath) : undefined;
            if (!cwd) throw new Error('Code can only run for files on disk.');
            const result = await this.host?.runner?.run(m.language, m.code, cwd);
            await panel.webview.postMessage({
              type: 'runResult',
              id: m.id,
              result,
              cancelled: !result,
            });
          } catch (error) {
            await panel.webview.postMessage({
              type: 'runResult',
              id: m.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        case 'exportDiagram': {
          if (typeof m.source !== 'string') return;
          const svg = await mermaidSvg(m.source, { mode: 'image', theme: 'light' });
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(
              document.uri,
              '..',
              `${posix.basename(document.uri.path, '.md')}-diagram.svg`,
            ),
            filters: { SVG: ['svg'] },
            title: 'Export diagram as SVG',
          });
          if (!target) return;
          await vscode.workspace.fs.writeFile(
            target,
            new TextEncoder().encode(
              svg.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'),
            ),
          );
          void vscode.window.showInformationMessage(
            `Diagram exported to ${posix.basename(target.path)}.`,
          );
          return;
        }
        case 'renderSnippet': {
          if (typeof m.key !== 'string' || typeof m.source !== 'string' || m.source.length > 65536)
            return;
          let html = (await fallback(m.source)) || '';
          if (m.inline) html = html.trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1');
          await panel.webview.postMessage({ type: 'snippet', key: m.key, html });
          return;
        }
        case 'renderDiagram':
          if (typeof m.id === 'string' && typeof m.source === 'string') {
            try {
              const svg = await mermaidSvg(m.source);
              await panel.webview.postMessage({ type: 'diagram', id: m.id, svg });
            } catch (error) {
              await panel.webview.postMessage({
                type: 'diagram',
                id: m.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          return;
        case 'command':
          if (
            typeof m.command === 'string' &&
            [
              'notespace.pageProperties',
              'notespace.toggleFavorite',
              'notespace.preview',
              'notespace.copyLink',
              'notespace.focusContext',
              'notespace.search',
            ].includes(m.command)
          )
            await vscode.commands.executeCommand(m.command, {
              page,
              root: page.root,
              label: page.title,
            });
          return;
        case 'requestBlockTitle':
          return;
        case 'imageAlt':
          if (typeof m.current === 'string') {
            const alt = await vscode.window.showInputBox({
              title: 'Image alt text',
              value: m.current,
            });
            if (alt !== undefined) await panel.webview.postMessage({ type: 'imageAltChosen', alt });
          }
          return;
        case 'browseImages': {
          const found = await browseImages(this.workspace, root, page);
          if (!found.length) {
            void vscode.window.showInformationMessage('No imported wiki images found.');
            return;
          }
          const picked = await vscode.window.showQuickPick(found, { title: 'Choose a wiki image' });
          if (!picked) return;
          const alt = await vscode.window.showInputBox({
            title: 'Image alt text',
            value: picked.label,
          });
          const uri = await resolveImage(this.workspace, root, page, picked.target);
          if (alt !== undefined)
            await panel.webview.postMessage({
              type: 'imageImported',
              target: picked.target,
              alt,
              url: uri ? panel.webview.asWebviewUri(uri).toString() : undefined,
            });
          return;
        }
        case 'importAttachment': {
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { Attachments: ['pdf', 'txt', 'csv', 'zip', 'docx', 'xlsx', 'pptx'] },
            title: 'Import wiki attachment',
          });
          if (!picked?.[0]) return;
          const target = await importAttachment(this.workspace, root, page, picked[0]);
          await panel.webview.postMessage({
            type: 'attachmentImported',
            target,
            label: picked[0].path.split('/').at(-1),
          });
          return;
        }
        case 'importMedia': {
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Audio and video': ['mp4', 'webm', 'mp3', 'ogg'] },
            title: 'Import audio or video into wiki assets',
          });
          if (!picked?.[0]) return;
          const target = await importMedia(this.workspace, root, page, picked[0]);
          const name = picked[0].path
            .split('/')
            .at(-1)!
            .replace(/\.[^.]+$/, '')
            .replace(/[[\]\r\n]/g, '');
          await panel.webview.postMessage({
            type: 'mediaImported',
            source: `![${name}](${target})`,
          });
          return;
        }
        case 'requestImagePath': {
          const target = await vscode.window.showInputBox({
            title: 'Relative image path',
            prompt: 'Import an image into wiki assets first',
            validateInput: (value) =>
              /^(?:[a-z]+:|\/\/)/i.test(value) ? 'Use a local relative path.' : undefined,
          });
          if (!target) return;
          const alt = await vscode.window.showInputBox({ title: 'Image alt text', value: 'Image' });
          const uri = await resolveImage(this.workspace, root, page, target);
          if (alt !== undefined)
            await panel.webview.postMessage({
              type: 'imageImported',
              target,
              alt,
              url: uri ? panel.webview.asWebviewUri(uri).toString() : undefined,
            });
          return;
        }
        case 'pickEmbed': {
          // Embeds point at real files: pick one of the wiki (or create/import one).
          const kinds: Record<string, { glob: string; noun: string }> = {
            notebook: { glob: '**/*.ipynb', noun: 'notebook' },
            canvas: { glob: '**/*.canvas', noun: 'canvas' },
            openapi: { glob: '**/*.{yaml,yml,json}', noun: 'OpenAPI description' },
            dashboard: { glob: '**/*.wiki-dashboard.json', noun: 'dashboard' },
          };
          const kind = typeof m.language === 'string' ? kinds[m.language] : undefined;
          if (!kind) return;
          const found = await vscode.workspace.findFiles(
            new vscode.RelativePattern(
              m.language === 'dashboard' ? root.projectUri || root.uri : root.uri,
              kind.glob,
            ),
            '**/{node_modules,.git,_versions,.ipynb_checkpoints}/**',
            500,
          );
          const files: vscode.Uri[] = [];
          for (const uri of found) {
            if (m.language === 'dashboard' || m.language !== 'openapi') files.push(uri);
            else {
              const head = new TextDecoder().decode(
                (await vscode.workspace.fs.readFile(uri)).subarray(0, 4096),
              );
              if (looksLikeOpenApi(head)) files.push(uri);
            }
          }
          const relative = (uri: vscode.Uri) => posix.relative(uriPath(root.uri), uriPath(uri));
          const items: Array<vscode.QuickPickItem & { uri?: vscode.Uri; action?: string }> = files
            .map((uri) => ({
              label: posix.basename(uriPath(uri)),
              description: relative(uri),
              uri,
            }))
            .sort((a, b) => a.description.localeCompare(b.description));
          if (m.language === 'notebook')
            items.push({ label: '$(add) Import a notebook…', action: 'import', alwaysShow: true });
          if (m.language === 'canvas')
            items.push({ label: '$(add) New canvas…', action: 'new', alwaysShow: true });
          if (!items.length) {
            void vscode.window.showInformationMessage(
              `This wiki has no ${kind.noun} yet. Add a YAML or JSON file that starts with “openapi: 3”.`,
            );
            return;
          }
          const picked = await vscode.window.showQuickPick(items, {
            title: `Embed a ${kind.noun}`,
            matchOnDescription: true,
          });
          let uri = picked?.uri;
          if (picked?.action === 'import') {
            const source = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              filters: { 'Jupyter notebooks': ['ipynb'] },
              title: 'Import Jupyter notebook into the wiki',
            });
            if (source?.[0]) uri = await importNotebook(this.workspace, root, source[0]);
          } else if (picked?.action === 'new') {
            const name = await vscode.window.showInputBox({
              title: 'New canvas',
              value: 'Overview',
              validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
            });
            if (name) uri = await newCanvas(this.workspace, root.id, name);
          }
          if (!uri) return;
          let path = posix.relative(posix.dirname(page.path), relative(uri));
          if (m.language === 'dashboard') {
            path = posix.relative(posix.dirname(uriPath(document.uri)), uriPath(uri));
            // Optionally embed a single widget.
            const { parseDashboard } = await import('./core/dashboard');
            const { dashboard } = parseDashboard(
              new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
            );
            const choice = await vscode.window.showQuickPick(
              [
                { label: 'Whole dashboard', id: '' },
                ...dashboard.widgets
                  .filter((w) => w.type !== 'filter')
                  .map((w) => ({
                    label:
                      w.title || dashboard.metrics.find((m) => m.id === w.metric)?.label || w.id,
                    description: `${w.type} · ${w.id}`,
                    id: w.id,
                  })),
              ],
              { title: 'Embed the whole dashboard or one widget' },
            );
            if (!choice) return;
            await panel.webview.postMessage({
              type: 'embedPicked',
              language: 'dashboard',
              path: choice.id ? `${path}\nwidget: ${choice.id}` : path,
            });
            return;
          }
          await panel.webview.postMessage({ type: 'embedPicked', language: m.language, path });
          return;
        }
        case 'pickComponentPath': {
          // Inspector “Browse…”: a file of the wiki, relative to this page.
          if (typeof m.requestId !== 'number' || !Array.isArray(m.extensions)) return;
          const extensions = (m.extensions as unknown[]).filter(
            (e): e is string => typeof e === 'string' && /^[\w.-]{1,30}$/.test(e),
          );
          if (!extensions.length) return;
          const glob = `**/*.{${extensions.join(',')}}`;
          const base = m.language === 'dashboard' ? root.projectUri || root.uri : root.uri;
          let files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(base, glob),
            '**/{node_modules,.git,_versions,.ipynb_checkpoints,.notespace-trash}/**',
            500,
          );
          if (m.language === 'openapi') {
            const kept: vscode.Uri[] = [];
            for (const uri of files) {
              const head = new TextDecoder().decode(
                (await vscode.workspace.fs.readFile(uri)).subarray(0, 4096),
              );
              if (looksLikeOpenApi(head)) kept.push(uri);
            }
            files = kept;
          }
          const pageDir = posix.dirname(document.uri.path);
          const picked = await vscode.window.showQuickPick(
            files
              .map((uri) => ({
                label: posix.basename(uri.path),
                description: posix.relative(pageDir, uriPath(uri)),
                uri,
              }))
              .sort((a, b) => a.description.localeCompare(b.description)),
            { title: `Choose a file (${extensions.join(', ')})`, matchOnDescription: true },
          );
          if (!picked) return;
          await panel.webview.postMessage({
            type: 'componentPath',
            requestId: m.requestId,
            path: posix.relative(pageDir, uriPath(picked.uri)),
          });
          return;
        }
        case 'importImage': {
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
            title: 'Import image into wiki assets',
          });
          if (!picked?.[0]) return;
          const target = await importImage(this.workspace, root, page, picked[0]);
          const uri = await resolveImage(this.workspace, root, page, target);
          const alt = await vscode.window.showInputBox({ title: 'Image alt text', value: 'Image' });
          if (alt !== undefined)
            await panel.webview.postMessage({
              type: 'imageImported',
              target,
              alt,
              url: uri ? panel.webview.asWebviewUri(uri).toString() : undefined,
            });
          return;
        }
        case 'pasteImage': {
          if (
            typeof m.base64 !== 'string' ||
            typeof m.mime !== 'string' ||
            m.base64.length >= 28 * 1024 * 1024
          )
            return;
          const ext = (
            {
              'image/png': '.png',
              'image/jpeg': '.jpg',
              'image/gif': '.gif',
              'image/webp': '.webp',
            } as Record<string, string>
          )[m.mime];
          if (!ext || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.base64)) return;
          // Keep the clipboard's file name (screenshots arrive as image.png); never overwrite.
          const base =
            typeof m.name === 'string' && m.name.trim()
              ? posix
                  .basename(m.name.trim().replace(/\\/g, '/'))
                  .replace(/\.[^.]+$/, '')
                  .slice(0, 80)
              : 'image';
          const target = await storeImage(
            this.workspace,
            root,
            page,
            base || 'image',
            ext,
            Buffer.from(m.base64, 'base64'),
          );
          const uri = await resolveImage(this.workspace, root, page, target);
          await panel.webview.postMessage({
            type: 'imageImported',
            target,
            alt: (() => {
              try {
                return decodeURIComponent(posix.basename(target));
              } catch {
                return posix.basename(target);
              }
            })(),
            url: uri ? panel.webview.asWebviewUri(uri).toString() : undefined,
          });
          return;
        }
      }
    };
    void lastReason;
  }
}

/** Code → Studio caret hand-off: the text of the source line under the cursor. */
export function caretContext(editor: vscode.TextEditor): { text: string; ratio: number } {
  const document = editor.document;
  const line = editor.selection.active.line;
  const { prefix } = splitFrontmatter(document.getText());
  const bodyStart = document.positionAt(prefix.length).line;
  let text = '';
  for (
    let at = Math.max(line, bodyStart);
    at < Math.min(document.lineCount, line + 6) && !text;
    at++
  )
    text = plainLine(document.lineAt(at).text);
  return {
    text,
    ratio: document.offsetAt(editor.selection.active) / Math.max(1, document.getText().length),
  };
}
export { showStudio };

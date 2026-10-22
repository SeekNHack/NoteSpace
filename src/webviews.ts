import { markdown } from './core/markdown';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WikiRoot, WikiWorkspace } from './workspace';
import { contentCss, escapeHtml, renderPage, safeExternal } from './core/render';
import { isExternal, posix, uriPath } from './core/paths';
import { Page } from './core/model';
import { showPage } from './views';
import { resolveImage, resolveAttachment, resolveMedia } from './assets';
import { renderDiagrams } from './diagrams';
import { readerInteractions } from './core/reader-interactions';
import { pageShowsPager } from './core/nav-tree';
import { WikiActivity } from './activity';
import { pageWithIncludes } from './core/includes';
import { icon, IconName } from './core/icons';
import type { PlannerService } from './planner';
import { chartRenderer } from './chart-data';
import { canvasRenderer } from './canvas-editor';
import { dashboardRenderer } from './dashboards';
import { openApiRenderer } from './api-playground';
import { notebookRenderer } from './notebooks';
import { contentHealth, rulesFor } from './core/quality';
import { lastCommitDates } from './git-history';
import { scopeOf, translationCoverage, variants } from './core/scopes';
import { apiCoverage } from './core/coverage';
import { parseOpenApi } from './core/openapi';
import { findApiDescriptions } from './api-playground';
import { fonts, resolveAppearance, widths } from './core/themes';

/** Reader, dashboard and graph chrome. Document typography comes from the shared design system. */
const panelCss = `
[hidden]{display:none!important}
main{max-width:1180px;margin:0 auto;padding:var(--ws-s5) var(--ws-s6) var(--ws-s7)}
.icon{display:inline-block;vertical-align:-3px;flex:none}
button,input,select{font:inherit;color:inherit}
.btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:var(--ws-r1);border:1px solid transparent;background:var(--vscode-button-secondaryBackground,var(--ws-surface-2));color:var(--vscode-button-secondaryForeground,var(--ws-fg));cursor:pointer;white-space:nowrap;text-decoration:none}
.btn:hover{background:var(--vscode-button-secondaryHoverBackground,var(--ws-hover));text-decoration:none}
.btn.primary{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff)}
.btn.primary:hover{background:var(--vscode-button-hoverBackground,var(--ws-accent))}
.btn.ghost{background:none;color:var(--ws-muted)}.btn.ghost:hover{background:var(--ws-hover);color:var(--ws-fg)}
:focus-visible{outline:1px solid var(--ws-focus);outline-offset:1px}
input[type=search]{height:28px;padding:0 10px;border-radius:var(--ws-r1);border:1px solid var(--vscode-input-border,var(--ws-border));background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));width:100%}
input[type=search]:focus{outline:1px solid var(--ws-focus);border-color:var(--ws-focus)}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--ws-muted)}
/* Reader */
main.reader{max-width:none;padding:0}
.reader-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:var(--ws-s2);height:40px;padding:0 var(--ws-s4);background:var(--ws-bg);border-bottom:1px solid var(--ws-hairline)}
.reader-bar .crumbs{flex:1;min-width:0;color:var(--ws-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.reader-bar .crumbs a{color:var(--ws-muted)}
.reader-bar .crumbs .current{color:var(--ws-fg)}
.variants{display:flex;gap:2px;font-size:12px}.variant{padding:2px 7px;border-radius:var(--ws-r1);color:var(--ws-muted)}a.variant:hover{background:var(--ws-hover);text-decoration:none;color:var(--ws-fg)}.variant[aria-current]{background:var(--ws-pressed);color:var(--ws-fg);font-weight:600}.variant.missing{text-decoration:line-through}
.archived-banner{padding:8px 12px;border:1px solid var(--ws-orange);border-radius:var(--ws-r2);background:color-mix(in srgb,var(--ws-orange) 10%,transparent);margin:0 0 var(--ws-s4)}
.reader-search{position:relative;width:220px}
.reader-search ul{position:absolute;z-index:6;top:calc(100% + 4px);left:0;right:0;max-height:300px;overflow:auto;margin:0;padding:4px;list-style:none;background:var(--ws-menu-bg);border:1px solid var(--ws-menu-border);border-radius:var(--ws-r2);box-shadow:var(--ws-shadow)}
.reader-search ul:empty{display:none}
.reader-search li a{display:block;padding:5px 8px;border-radius:var(--ws-r1);color:var(--ws-menu-fg)}
.reader-search li a:hover,.reader-search li a:focus{background:var(--ws-menu-active);color:var(--ws-menu-active-fg);text-decoration:none}
.toggle[aria-pressed=true]{background:var(--ws-pressed);color:var(--ws-fg)}
.reader-layout{display:grid;grid-template-columns:minmax(0,var(--ws-doc-width)) 200px;justify-content:center;gap:var(--ws-s7);padding:var(--ws-s6) var(--ws-s6) var(--ws-s7)}
.reader-layout article{min-width:0}
.reader-layout.no-outline,.reader-layout.focus{grid-template-columns:minmax(0,var(--ws-doc-width))}
.reader-layout.no-outline .reader-toc,.reader-layout.focus .reader-toc,.reader-layout.focus .reader-pager,.reader-layout.focus .reader-backlinks{display:none}
.reader-toc{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 90px);overflow:auto;font-size:12.5px}
.reader-toc strong{display:block;margin-bottom:8px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ws-muted)}
.reader-toc ul{list-style:none;margin:0;padding:0 0 0 10px;border-left:1px solid var(--ws-hairline)}
.reader-toc li{margin:0}.reader-toc a{display:block;padding:3px 0;color:var(--ws-muted)}
.reader-toc a:hover{color:var(--ws-fg);text-decoration:none}
.reader-toc .toc-3{padding-left:12px}.reader-toc .toc-4{padding-left:24px}
.tags{margin:-.4em 0 1.2em}
.reader-pager{display:grid;grid-template-columns:1fr 1fr;gap:var(--ws-s3);margin:var(--ws-s7) 0 var(--ws-s5)}
.reader-pager a{display:block;padding:10px 14px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);color:var(--ws-fg)}
.reader-pager a:hover{border-color:var(--ws-accent);text-decoration:none}
.reader-pager small{display:block;color:var(--ws-muted);font-size:11px}
.reader-pager .next{text-align:right;grid-column:2}
.reader-backlinks{border-top:1px solid var(--ws-hairline);padding-top:var(--ws-s4);font-size:13px}
.reader-backlinks h2{font-size:11px!important;letter-spacing:.07em;text-transform:uppercase;color:var(--ws-muted);margin:0 0 8px!important}
.reader-backlinks ul{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px}
.reader-backlinks li a{display:inline-block;padding:3px 10px;border:1px solid var(--ws-hairline);border-radius:999px;color:var(--ws-fg)}
@media(max-width:900px){.reader-layout{grid-template-columns:minmax(0,1fr)}.reader-toc{display:none}.reader-search{width:160px}.reader-bar .label{display:none}}
@media(max-width:600px){.reader-layout{padding:var(--ws-s4)}.reader-bar .crumbs{display:none}.reader-search{flex:1;width:auto}}
/* Dashboard */
.dash{max-width:1040px}
.dash-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:var(--ws-s4);padding-bottom:var(--ws-s4);border-bottom:1px solid var(--ws-hairline);margin-bottom:var(--ws-s5)}
.dash-head h1{margin:2px 0 2px;font-size:22px;font-weight:650;letter-spacing:-.01em}
.dash-head p{margin:0;color:var(--ws-muted)}
.dash-head .actions{display:flex;flex-wrap:wrap;gap:6px}
.dash-head select{height:26px;border-radius:var(--ws-r1);border:1px solid var(--ws-border);background:var(--vscode-dropdown-background,var(--ws-bg));padding:0 6px;margin-top:6px}
.empty{padding:10px 12px;border:1px dashed var(--ws-border);border-radius:var(--ws-r2);color:var(--ws-muted)}
.empty p{margin:0 0 8px}
/* Content health */
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:var(--ws-s5)}
.tile{padding:10px 12px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
.tile strong{display:block;font-size:20px;font-variant-numeric:tabular-nums}.tile span{color:var(--ws-muted);font-size:12px}
.issue-list{margin:2px 0 4px 18px;padding:0;font-size:12.5px;color:var(--ws-muted)}
.score-note{margin:-8px 0 var(--ws-s5);font-size:12px}
.tile.good strong{color:var(--ws-green)}.tile.warn strong{color:var(--ws-orange)}.tile.bad strong{color:var(--ws-red)}
.report{margin:0 0 var(--ws-s5)}
.report h2{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:13px;font-weight:600}
.report h2 .count{font-weight:600;font-size:12px;padding:0 6px;border-radius:999px;background:var(--ws-surface-2)}
.report h2 .count.warn{color:var(--ws-orange)}.report h2 .count.good{color:var(--ws-green)}
.report h3{font-size:12.5px;font-weight:600;margin:12px 0 6px}
.report-list{margin:0;padding-left:18px}.report-list li{margin:3px 0}
.report .ok{color:var(--ws-muted);display:flex;align-items:center;gap:6px;margin:4px 0}.report .ok .icon{color:var(--ws-green)}
.report .muted,.health .muted{color:var(--ws-muted)}
.btn.small{height:22px;padding:0 8px;font-size:12px}
.bar{height:6px;border-radius:3px;background:var(--ws-surface-2);overflow:hidden;margin:4px 0 8px;max-width:420px}.bar span{display:block;height:100%;background:var(--ws-accent)}
.report-table{border-collapse:collapse;width:100%;font-size:12.5px}.report-table th,.report-table td{border-bottom:1px solid var(--ws-hairline);padding:4px 8px;text-align:left;vertical-align:top}
.report .missing{color:var(--ws-orange)}
.welcome{max-width:560px;margin:10vh auto;text-align:center}
.welcome h1{font-size:22px;margin:8px 0}
.welcome p{color:var(--ws-muted)}
.welcome .actions{display:flex;justify-content:center;gap:8px;margin-top:16px}
@media(max-width:760px){main{padding:var(--ws-s4)}}
/* Graph */
.graph{width:100%;height:auto;min-height:220px;aspect-ratio:900/460;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
svg.graph text{fill:var(--ws-fg);font-size:11px}svg.graph line{stroke:var(--ws-fg);opacity:.18}svg.graph circle{fill:var(--ws-accent)}
.graph-node{cursor:pointer}.graph-node:focus circle{stroke:var(--ws-focus);stroke-width:3}
svg.graph .graph-node.center circle{fill:var(--ws-orange)}
.graph-mode{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;border:0;padding:0;margin:12px 0}.graph-mode legend{float:left;margin-right:8px}.graph-mode select{margin-left:6px;height:24px;border-radius:var(--ws-r1);border:1px solid var(--ws-border);background:var(--vscode-dropdown-background,var(--ws-bg))}
.page-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;list-style:none;padding:0}
.page-list button{width:100%;text-align:left;padding:6px 10px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r1);background:var(--ws-surface);cursor:pointer}
.page-list button:hover{border-color:var(--ws-accent)}
.stats{display:flex;flex-wrap:wrap;gap:var(--ws-s5);margin:var(--ws-s3) 0}.stat strong{font-size:18px;display:block}
#empty{padding:30px;text-align:center}`;

const svgIcon = (name: IconName, size = 16) => icon(name, size);
export class WikiPanels implements vscode.Disposable {
  private preview?: vscode.WebviewPanel;
  private healthRoot?: string;
  private previewUri?: string;
  private previewFingerprint?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private readonly subscriptions: vscode.Disposable[];
  /** Set by the extension once the planner exists; enables ```tasks blocks in the reader. */
  planner?: PlannerService;
  private focusPreviewUntil = 0;
  http?: import('./http-blocks').HttpBlocks;
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly extensionUri: vscode.Uri,
    private readonly activity?: WikiActivity,
  ) {
    this.subscriptions = [
      workspace.onDidChange(() => this.schedule()),
      ...(activity
        ? [
            activity.onDidChange(() => {
              if (activity.activeUri && this.workspace.index.byUri(activity.activeUri))
                this.previewUri = activity.activeUri;
              this.schedule();
            }),
          ]
        : []),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && workspace.index.byUri(editor.document.uri.toString())) {
          this.previewUri = editor.document.uri.toString();
          this.schedule();
        }
      }),
    ];
  }
  private icon(): { light: vscode.Uri; dark: vscode.Uri } {
    return {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'notespace-light.svg'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'notespace-dark.svg'),
    };
  }
  /** Re-renders the reader after a file it embeds changed (an API description, for example). */
  refreshEmbeds(): void {
    this.previewFingerprint = undefined;
    this.schedule();
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.refresh().catch((e) => this.workspace.log.appendLine(String(e)));
    }, 120);
  }
  private roots(): vscode.Uri[] {
    return [
      this.extensionUri,
      ...this.workspace.roots.flatMap((r) => (r.projectUri ? [r.uri, r.projectUri] : [r.uri])),
    ];
  }
  openPreview(page: Page): void {
    this.previewUri = page.uri;
    if (!this.preview) {
      this.preview = vscode.window.createWebviewPanel(
        'notespace.preview',
        'Wiki Preview',
        vscode.ViewColumn.Beside,
        { enableScripts: true, localResourceRoots: this.roots() },
      );
      this.preview.iconPath = this.icon();
      this.preview.onDidDispose(() => {
        this.preview = undefined;
        this.previewFingerprint = undefined;
      });
      this.preview.webview.onDidReceiveMessage((message) => {
        void this.onMessage(message).catch((e) => this.workspace.log.appendLine(String(e)));
      });
    }
    this.preview.reveal(vscode.ViewColumn.Beside, true);
    this.schedule();
  }
  private dashboardRoot(): WikiRoot | undefined {
    const active = this.activity?.activeUri && this.workspace.index.byUri(this.activity.activeUri);
    return active ? this.workspace.rootFor(active) : this.workspace.roots[0];
  }
  homepageOf(root: WikiRoot): Page | undefined {
    const pages = this.workspace.index.all(root.id);
    return (
      pages.find((page) => page.path === (root.config?.content.homepage || 'Home.md')) ||
      pages.find((page) => page.path === 'index.md') ||
      pages.find((page) => /^(home|readme)\.md$/i.test(page.path))
    );
  }
  private async onMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (
      this.http &&
      this.preview &&
      (await this.http.handle(m, (reply) => this.preview!.webview.postMessage(reply)))
    )
      return;
    if (
      this.planner &&
      this.preview &&
      (await this.planner.handleMove(m, (reply) => this.preview!.webview.postMessage(reply)))
    ) {
      // A keyboard move re-renders the page; give the preview focus back so the card can take it.
      if (m.keyboard === true) this.focusPreviewUntil = Date.now() + 4000;
      return;
    }
    if (
      m.type === 'action' &&
      [
        'newPage',
        'newFromTemplate',
        'search',
        'validate',
        'filterPages',
        'newSection',
        'createWiki',
        'importProject',
        'graph',
        'dailyNote',
        'openWiki',
        'planner',
        'addTask',
        'contentHealth',
      ].includes(String(m.name))
    ) {
      await vscode.commands.executeCommand(`notespace.${m.name}`);
      return;
    }
    if (
      m.type === 'command' &&
      ['createTranslation', 'markTranslationCurrent'].includes(String(m.name)) &&
      typeof m.page === 'string'
    ) {
      // Page ids contain a NUL separator, so the webview receives them URI-encoded.
      const page = this.workspace.index.pages.get(decodeURIComponent(m.page));
      if (page)
        await vscode.commands.executeCommand(
          `notespace.${m.name}`,
          vscode.Uri.parse(page.uri),
          typeof m.value === 'string' ? m.value : undefined,
        );
      return;
    }
    if (m.type === 'command' && m.name === 'createHomepage') {
      const root =
        this.workspace.roots.find((r) => r.id === this.healthRoot) || this.dashboardRoot();
      const home = root?.config?.content.homepage;
      if (root && home && !this.homepageOf(root))
        await vscode.commands.executeCommand(
          'notespace.newPage',
          home.replace(/\.md$/i, ''),
          root.id,
        );
      return;
    }
    if (m.type === 'complete' && typeof m.key === 'string' && this.planner) {
      await this.planner.complete(m.key, m.done !== false);
      return;
    }
    if (m.type === 'showLog') {
      this.workspace.log.show();
      return;
    }
    if (m.type === 'revealSection' && typeof m.root === 'string' && typeof m.prefix === 'string') {
      await vscode.commands.executeCommand('notespace.revealSection', m.root, m.prefix);
      return;
    }
    if (
      m.type === 'template' &&
      typeof m.name === 'string' &&
      m.name.length <= 120 &&
      this.previewUri
    ) {
      // A template button in the page: a new page from that template beside this one.
      const page = this.workspace.index.byUri(this.previewUri);
      if (!page) return;
      const folder = page.path.includes('/')
        ? page.path.slice(0, page.path.lastIndexOf('/') + 1)
        : '';
      await vscode.commands.executeCommand(
        'notespace.newFromTemplate',
        { label: '', root: page.root, prefix: folder },
        m.name,
      );
      return;
    }
    if (m.type === 'favorite' && typeof m.id === 'string' && this.activity) {
      const page = this.workspace.index.pages.get(m.id);
      if (page) await this.activity.toggleFavorite(page);
      return;
    }
    if (
      m.type === 'asset' &&
      typeof m.target === 'string' &&
      m.target.length <= 1024 &&
      this.previewUri
    ) {
      const page = this.workspace.index.byUri(this.previewUri);
      if (!page) return;
      const uri = await resolveAttachment(
        this.workspace,
        this.workspace.rootFor(page),
        page,
        m.target,
      );
      if (uri) await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }
    if (
      m.type === 'search' &&
      typeof m.query === 'string' &&
      m.query.length <= 200 &&
      this.preview &&
      this.previewUri
    ) {
      const current = this.workspace.index.byUri(this.previewUri);
      if (!current) return;
      const pages = this.workspace.index
        // Stay in the reader's language and version.
        .search(
          m.query,
          current.root,
          (p) =>
            (this.workspace.index.scope?.(p) ?? '') ===
            (this.workspace.index.scope?.(current) ?? ''),
        )
        .filter((r) => !r.page.draft)
        .slice(0, 30)
        .map((r) => ({
          id: r.page.id,
          title: r.page.title,
          path: r.page.path,
          excerpt: r.excerpt,
        }));
      await this.preview.webview.postMessage({ type: 'searchResults', query: m.query, pages });
      return;
    }
    if (m.type === 'navigate' && typeof m.id === 'string') {
      const page = this.workspace.index.pages.get(m.id);
      if (
        !page ||
        !this.preview ||
        (this.previewUri && this.workspace.index.byUri(this.previewUri)?.root !== page.root)
      )
        return;
      this.previewUri = page.uri;
      await this.activity?.opened(page);
      await this.refresh();
      return;
    }
    if (m.type === 'open' && typeof m.id === 'string') {
      const page = this.workspace.index.pages.get(m.id);
      if (!page) return;
      const heading =
        typeof m.anchor === 'string' ? page.headings.find((h) => h.slug === m.anchor) : undefined;
      if (typeof m.offset === 'number') {
        await showPage(page.uri, m.offset);
        return;
      }
      const column =
        vscode.window.visibleTextEditors.find((editor) =>
          this.workspace.index.byUri(editor.document.uri.toString()),
        )?.viewColumn ?? vscode.ViewColumn.Active;
      if (heading) await showPage(page.uri, heading.offset, column);
      else await vscode.commands.executeCommand('notespace.openPage', page.uri);
    }
    if (m.type === 'code' && typeof m.target === 'string' && this.previewUri) {
      const page = this.workspace.index.byUri(this.previewUri);
      if (page) await vscode.commands.executeCommand('notespace.openCodeRef', page.uri, m.target);
      return;
    }
    if (m.type === 'external' && typeof m.href === 'string' && safeExternal(m.href))
      await vscode.env.openExternal(vscode.Uri.parse(m.href));
  }
  private document(
    panel: vscode.WebviewPanel,
    title: string,
    content: string,
    data?: unknown,
    language = 'en',
  ): string {
    const nonce = randomBytes(18).toString('base64');
    const script = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js'),
    );
    const boards = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'task-board.js'),
    );
    const payload = JSON.stringify(data ?? {}).replace(/</g, '\\u003c');
    // Inline styles are allowed so theme-aware Mermaid SVG can style itself; scripts stay nonce-only.
    return `<!doctype html><html lang="${escapeHtml(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; media-src ${panel.webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${contentCss}\n${panelCss}</style></head><body>${content}<script nonce="${nonce}" id="wiki-data" type="application/json">${payload}</script><script nonce="${nonce}" src="${boards}"></script><script nonce="${nonce}" src="${script}"></script><script nonce="${nonce}">${readerInteractions}</script></body></html>`;
  }
  private currentPages(root: WikiRoot): { pages: Page[]; unlinkedOk: (page: Page) => boolean } {
    const pages = this.workspace.index
      .all(root.id)
      .filter((p) => !scopeOf(p.path, root.config).version);
    const plannerConfig = this.planner?.config(root);
    const journal = new RegExp(
      `^${(plannerConfig?.dailyFolder || 'daily').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d{4}-\\d{2}-\\d{2}\\.md$`,
    );
    return {
      pages,
      // Journals, the inbox and each language's homepage need no incoming links.
      unlinkedOk: (p) => {
        const logical = scopeOf(p.path, root.config).logical;
        return (
          journal.test(logical) ||
          p.path === plannerConfig?.inbox ||
          logical === (root.config?.content.homepage || 'index.md')
        );
      },
    };
  }
  private rulesOf(root: WikiRoot): (page: Page) => import('./core/config').QualityRule[] {
    const config = root.config;
    return (page) =>
      config?.quality.rules.length
        ? rulesFor(config.quality.rules, scopeOf(page.path, config).logical)
        : [];
  }
  private async healthReport(root: WikiRoot): Promise<string> {
    const index = this.workspace.index;
    const { pages, unlinkedOk } = this.currentPages(root);
    const homepage = this.homepageOf(root);
    const health = contentHealth(
      index,
      pages,
      homepage?.path ?? root.config?.content.homepage,
      (p) => index.scope?.(p) ?? '',
      this.rulesOf(root),
    );
    // Outdated pages: last commit older than quality.staleDays (Git only; off when 0).
    const staleDays = root.config?.quality.staleDays || 0;
    let stale: Array<{ page: Page; date: string }> = [];
    let staleNote = '';
    if (staleDays) {
      try {
        const history = await lastCommitDates(root.uri);
        if (!history) staleNote = 'This wiki is not in a Git repository, so page age is unknown.';
        else {
          const limit = new Date(Date.now() - staleDays * 86400000).toISOString();
          for (const page of pages) {
            const date = history.dates.get(vscode.Uri.parse(page.uri).fsPath);
            if (date && date < limit) stale.push({ page, date: date.slice(0, 10) });
          }
          stale = stale.sort((a, b) => a.date.localeCompare(b.date));
          staleNote = `Last committed more than ${staleDays} days ago (quality.staleDays). Uncommitted pages are not counted.`;
        }
      } catch (e) {
        staleNote = `Git history is unavailable: ${escapeHtml(e instanceof Error ? e.message : String(e))}`;
      }
    }
    const orphans = health.orphans.filter((p) => !unlinkedOk(p));
    const open = (page: Page, offset?: number) =>
      `#wiki:${encodeURIComponent(page.id)}${offset === undefined ? '' : `?offset=${offset}`}`;
    const pageLink = (page: Page, offset?: number, extra = '') =>
      `<a href="${open(page, offset)}">${escapeHtml(page.title)}</a> <span class="muted">${escapeHtml(page.path)}</span>${extra}`;
    const list = <T>(items: T[], render: (item: T) => string, emptyText: string) =>
      items.length
        ? `<ul class="report-list">${items
            .slice(0, 60)
            .map((i) => `<li>${render(i)}</li>`)
            .join(
              '',
            )}${items.length > 60 ? `<li class="muted">and ${items.length - 60} more</li>` : ''}</ul>`
        : `<p class="ok">${svgIcon('check')} ${emptyText}</p>`;
    const section = (id: string, title: string, count: number, body: string, note = '') =>
      `<section class="report" aria-labelledby="${id}"><h2 id="${id}">${title} <span class="count ${count ? 'warn' : 'good'}">${count}</span></h2>${note ? `<p class="muted">${note}</p>` : ''}${body}</section>`;
    const tiles = [
      [
        'Health score',
        `${health.score}%`,
        health.score >= 90 ? 'good' : health.score >= 60 ? 'warn' : 'bad',
      ],
      ['Pages', pages.length, ''],
      ['Broken links', health.broken.length, health.broken.length ? 'bad' : 'good'],
      ['Without incoming links', orphans.length, orphans.length ? 'warn' : 'good'],
      [
        'Duplicate headings',
        health.duplicateHeadings.length,
        health.duplicateHeadings.length ? 'warn' : 'good',
      ],
      [
        'Ambiguous titles',
        health.duplicateTitles.length,
        health.duplicateTitles.length ? 'warn' : 'good',
      ],
      ['Metadata problems', health.metadata.length, health.metadata.length ? 'warn' : 'good'],
      ['Empty pages', health.empty.length, health.empty.length ? 'warn' : 'good'],
      [
        'Accessibility & structure',
        health.structure.length,
        health.structure.length ? 'warn' : 'good',
      ],
      ...(root.config?.quality.rules.length
        ? [['Rule violations', health.rules.length, health.rules.length ? 'warn' : 'good']]
        : []),
      ...(staleDays ? [['Outdated', stale.length, stale.length ? 'warn' : 'good']] : []),
      ['Drafts', health.drafts.length, ''],
    ]
      .map(
        ([label, value, tone]) =>
          `<div class="tile ${tone}"><strong>${value}</strong><span>${label}</span></div>`,
      )
      .join('');
    let translations = '';
    if (root.config?.i18n.languages.length) {
      const coverage = translationCoverage(index.all(root.id), root.config);
      translations = `<section class="report" aria-labelledby="h-i18n"><h2 id="h-i18n">Translations <span class="count">${coverage.sources} source page${coverage.sources === 1 ? '' : 's'} in ${escapeHtml(root.config.wiki.language)}</span></h2>${coverage.languages
        .map((l) => {
          const percent = coverage.sources
            ? Math.round((l.translated / coverage.sources) * 100)
            : 100;
          return `<h3>${escapeHtml(l.language)} · ${l.translated}/${coverage.sources} translated · ${l.outdated.length} outdated</h3><div class="bar" role="progressbar" aria-label="${escapeHtml(l.language)} translation coverage" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>${list(
            l.missing,
            (p) =>
              `${pageLink(p)} <button class="btn ghost small" data-command="createTranslation" data-page="${encodeURIComponent(p.id)}" data-value="${escapeHtml(l.language)}">Create translation</button>`,
            'Every page is translated.',
          )}${
            l.outdated.length
              ? `<p class="muted">Changed since translated:</p>${list(
                  l.outdated,
                  (o) =>
                    `${pageLink(o.translation)} ← ${pageLink(o.source)} <button class="btn ghost small" data-command="markTranslationCurrent" data-page="${encodeURIComponent(o.translation.id)}">Mark as up to date</button>`,
                  '',
                )}`
              : ''
          }${l.unknown.length ? `<p class="muted">${l.unknown.length} translation${l.unknown.length === 1 ? ' has' : 's have'} no <code>translated_from</code> marker, so freshness is unknown.</p>` : ''}`;
        })
        .join('')}</section>`;
    }
    let api = '';
    const specs: Array<{ file: string; spec: ReturnType<typeof parseOpenApi> }> = [];
    for (const uri of await findApiDescriptions(this.workspace)) {
      if (!uriPath(uri).startsWith(uriPath(root.uri).replace(/\/$/, '') + '/')) continue;
      try {
        specs.push({
          file: posix.relative(uriPath(root.uri), uriPath(uri)),
          spec: parseOpenApi(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))),
        });
      } catch (e) {
        this.workspace.log.appendLine(`${uri.path}: ${String(e)}`);
      }
    }
    if (specs.length)
      api = `<section class="report" aria-labelledby="h-api"><h2 id="h-api">API coverage</h2><p class="muted">An operation counts as documented when a page embeds its description in an <code>openapi</code> block, names its operationId, or writes <code>METHOD /path</code>.</p>${apiCoverage(
        specs,
        pages,
      )
        .map(
          (c) =>
            `<h3>${escapeHtml(c.title)} <span class="muted">${escapeHtml(c.file)} · ${c.documented}/${c.operations.length} documented</span></h3><table class="report-table"><thead><tr><th scope="col">Operation</th><th scope="col">Documented in</th></tr></thead><tbody>${c.operations
              .map(
                (o) =>
                  `<tr><td><code>${escapeHtml(o.method)} ${escapeHtml(o.path)}</code> <span class="muted">${escapeHtml(o.id)}</span></td><td>${o.documentedBy.length ? o.documentedBy.map((p) => `<a href="${open(p)}">${escapeHtml(p.title)}</a>`).join(', ') : '<span class="missing">Not documented</span>'}</td></tr>`,
              )
              .join('')}</tbody></table>`,
        )
        .join('')}</section>`;
    return `<main class="dash health"><header class="dash-head"><div><div class="eyebrow">NoteSpace · Content health</div><h1>${escapeHtml(root.config?.wiki.title || root.name)}</h1><p>Computed from the Markdown files, front matter and OpenAPI descriptions in this wiki${root.config?.versions.archived.length ? '; archived versions are not included' : ''}.</p></div><div class="actions"><button class="btn" data-action="validate">${svgIcon('check')} Validate wiki</button><button class="btn" data-action="graph">${svgIcon('layout')} Link graph</button></div></header><div class="tiles">${tiles}</div><p class="muted score-note">The health score is the share of pages with no broken link and no content issue (${health.clean} of ${pages.length}). Pages without incoming links, drafts and outdated pages are reported but do not lower it.</p>${
      health.homepageMissing
        ? `<section class="report"><p class="missing">${svgIcon('alert')} The homepage <code>${escapeHtml(root.config?.content.homepage || 'index.md')}</code> does not exist. <button class="btn small" data-command="createHomepage">Create homepage</button></p></section>`
        : ''
    }${section(
      'h-broken',
      'Broken links',
      health.broken.length,
      list(
        health.broken,
        (b) => `${pageLink(b.page, b.offset)} → <code>${escapeHtml(b.target)}</code>`,
        'No broken links.',
      ),
    )}${section(
      'h-orphans',
      'Pages without incoming links',
      orphans.length,
      list(orphans, (p) => pageLink(p), 'Every page is linked from another page.'),
      'Daily notes, the inbox and the homepage are not expected to have incoming links.',
    )}${section(
      'h-dup',
      'Duplicate headings',
      health.duplicateHeadings.length,
      list(
        health.duplicateHeadings,
        (d) => `${pageLink(d.page)} · ${d.count} repeated heading${d.count === 1 ? '' : 's'}`,
        'Every heading anchor is unique.',
      ),
      'Links to a repeated heading always reach the first one.',
    )}${section(
      'h-titles',
      'Ambiguous titles',
      health.duplicateTitles.length,
      list(
        health.duplicateTitles,
        (group) => group.map((p) => pageLink(p)).join(' · '),
        'Every title is unique.',
      ),
      '[[Title]] links to these pages are ambiguous; link by path or rename one.',
    )}${section(
      'h-meta',
      'Metadata problems',
      health.metadata.length,
      list(
        health.metadata,
        (m) => `${pageLink(m.page, 0)} · ${escapeHtml(m.warnings.join('; '))}`,
        'Front matter fields have the expected types.',
      ),
    )}${section(
      'h-empty',
      'Empty pages',
      health.empty.length,
      list(health.empty, (p) => pageLink(p), 'Every page has content.'),
    )}${section(
      'h-structure',
      'Accessibility & structure',
      health.structure.length,
      list(
        health.structure,
        (s) =>
          `${pageLink(s.page, s.issues[0].offset)}<ul class="issue-list">${s.issues
            .slice(0, 8)
            .map((i) => `<li><a href="${open(s.page, i.offset)}">${escapeHtml(i.message)}</a></li>`)
            .join('')}</ul>`,
        'Images have alternative text and headings follow a clear outline.',
      ),
      'Each finding has a quick fix in Code mode (light bulb).',
    )}${
      root.config?.quality.rules.length
        ? section(
            'h-rules',
            'Rule violations',
            health.rules.length,
            list(
              health.rules,
              (r) =>
                `${pageLink(r.page, 0)}<ul class="issue-list">${r.issues.map((i) => `<li>${escapeHtml(i.message)}</li>`).join('')}</ul>`,
              'Every page follows the rules in wiki.yaml.',
            ),
            `Rules from <code>quality.rules</code> in wiki.yaml: ${root.config.quality.rules
              .map(
                (r) =>
                  `${escapeHtml(r.folder ? `${r.folder}/` : 'all pages')} → ${escapeHtml([...r.fields.map((f) => `field ${f}`), ...r.sections.map((x) => `section “${x}”`)].join(', ') || 'nothing')}`,
              )
              .join('; ')}.`,
          )
        : ''
    }${
      staleDays
        ? section(
            'h-stale',
            'Outdated pages',
            stale.length,
            list(
              stale,
              (x) => pageLink(x.page, undefined, ` · last changed ${escapeHtml(x.date)}`),
              'No page is older than the limit.',
            ),
            staleNote,
          )
        : ''
    }${translations}${api}</main>`;
  }
  /**
   * The rendered body of a page for a webview: includes expanded, images and media as webview
   * URIs, attachments as `#asset:` links, rich blocks and diagrams rendered.
   */
  async renderBody(
    page: Page,
    webview: vscode.Webview,
    href: (target: Page, anchor?: string) => string,
  ): Promise<string> {
    const root = this.workspace.rootFor(page),
      images = new Map<string, string>(),
      media = new Map<string, string>(),
      attachments = new Map<string, string>();
    const contentPage = pageWithIncludes(page, this.workspace.index);
    // Body lines map to page lines after the front matter; a line pulled in by an include does
    // not match its page line and stays read-only.
    const textLines = page.text.split('\n');
    const frontMatter =
      page.text.slice(0, page.text.length - page.body.length).split('\n').length - 1;
    const tasks = this.planner?.tasks(page.root).filter((t) => t.pageId === page.id) || [];
    const taskKey = (bodyLine: number, raw: string) => {
      const line = bodyLine + frontMatter;
      if ((textLines[line] || '').replace(/\r$/, '') !== raw) return undefined;
      return tasks.find((t) => t.line === line)?.key;
    };
    for (const l of contentPage.links.filter((l) => l.kind === 'image')) {
      if (isExternal(l.target)) continue;
      const isMedia = /\.(?:mp4|webm|mp3|ogg)(?:[#?].*)?$/i.test(l.target);
      const uri = isMedia
        ? await resolveMedia(this.workspace, root, page, l.target)
        : await resolveImage(this.workspace, root, page, l.target);
      if (uri)
        (isMedia ? media : images).set(
          markdown.normalizeLink(l.target),
          webview.asWebviewUri(uri).toString(),
        );
    }
    for (const link of contentPage.links.filter((l) => l.kind === 'markdown')) {
      const uri = await resolveAttachment(this.workspace, root, page, link.target);
      if (uri)
        attachments.set(
          markdown.normalizeLink(link.target),
          `#asset:${encodeURIComponent(link.target)}`,
        );
    }
    return renderDiagrams(
      renderPage(contentPage, this.workspace.index, {
        pageHref: href,
        today: this.planner?.today(root),
        taskKey,
        imageHref: (target) => images.get(target),
        mediaHref: (target) => media.get(target),
        assetHref: (target) => attachments.get(target),
        codeHref: (target) => `#code:${encodeURIComponent(target)}`,
        templates: true,
        collection: this.planner?.collection(page, (target) => href(target), true, true),
        chart: await chartRenderer(this.workspace, page, this.planner),
        notebook: await notebookRenderer(this.workspace, page),
        openapi: await openApiRenderer(this.workspace, page),
        dashboard: await dashboardRenderer(vscode.Uri.parse(page.uri), page.text),
        http: this.http ? await this.http.renderer(page.text) : undefined,
        canvas: await canvasRenderer(this.workspace, page, (file) => {
          const target = this.workspace.index.all(page.root).find((p) => p.path === file);
          return target ? href(target) : undefined;
        }),
      }),
    );
  }
  /**
   * Content health or the link graph as a page of the workspace panel, which shows it in a
   * same-origin frame: scripts are inlined there because frames cannot load webview files.
   */
  async frameDocument(
    kind: 'health' | 'graph',
    rootId?: string,
  ): Promise<{ title: string; css: string; body: string; scripts: string[] }> {
    const root = this.workspace.roots.find((r) => r.id === rootId) || this.dashboardRoot();
    let title = 'Link Graph',
      content: string,
      data: unknown;
    if (kind === 'health') {
      title = 'Content Health';
      if (root) this.healthRoot = root.id;
      content = root ? await this.healthReport(root) : '<main><p>No wiki is open.</p></main>';
      data = { mode: 'health', root: root?.id };
    } else ({ html: content, data } = this.graphView(root?.id));
    const payload = JSON.stringify(data ?? {}).replace(/</g, '\\u003c');
    this.frameScripts ??= Promise.all(
      [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'task-board.js'),
        vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js'),
      ].map(async (uri) => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))),
    ).then((code) => [...code, readerInteractions]);
    return {
      title,
      css: `${contentCss}\n${panelCss}`,
      body: `${content}<script id="wiki-data" type="application/json">${payload}</script>`,
      scripts: await this.frameScripts,
    };
  }
  private frameScripts?: Promise<string[]>;
  /** A message from a panel frame; opening a page shows it in the panel's Wiki. */
  async handleFrame(message: unknown, openInPanel: (page: Page) => Promise<void>): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (
      m.type === 'open' &&
      typeof m.id === 'string' &&
      typeof m.offset !== 'number' &&
      !m.anchor
    ) {
      const page = this.workspace.index.pages.get(m.id);
      if (page) return openInPanel(page);
    }
    await this.onMessage(m);
  }
  async refresh(): Promise<void> {
    const revision = ++this.revision;
    if (this.preview) {
      const panel = this.preview,
        page = this.previewUri && this.workspace.index.byUri(this.previewUri);
      if (!page) {
        this.previewFingerprint = undefined;
        panel.webview.html = this.document(
          panel,
          'Wiki Preview',
          '<main class="welcome"><h1>Nothing to preview</h1><p>Open a wiki page to read it here. The previous page may have been moved or deleted.</p></main>',
        );
      } else {
        const root = this.workspace.rootFor(page);
        const contentPage = pageWithIncludes(page, this.workspace.index);
        const fingerprint = JSON.stringify({
          page: page.text,
          expanded: contentPage.body,
          // Task embeds depend on other pages' tasks and on the current day.
          tasks: /```(?:tasks|collection)/.test(contentPage.body)
            ? JSON.stringify(this.planner?.tasks(page.root).map((t) => t.raw)) +
              this.planner?.today()
            : '',
          path: page.path,
          config: root.config,
          theme: vscode.window.activeColorTheme.kind,
          navigation: this.workspace.index
            .all(root.id)
            .map((p) => [p.path, p.title, p.order, p.draft]),
        });
        if (fingerprint !== this.previewFingerprint) {
          const href = (p: Page, anchor?: string) =>
            p.id === page.id && anchor
              ? `#${anchor}`
              : `#wiki:${encodeURIComponent(p.id)}${anchor ? `?anchor=${encodeURIComponent(anchor)}` : ''}`;
          const body = await this.renderBody(page, panel.webview, href);
          const backlinks = this.workspace.index
            .backlinks(page)
            .filter(
              (b, i, all) =>
                b.page.id !== page.id && all.findIndex((x) => x.page.id === b.page.id) === i,
            );
          const sort = root.config?.navigation.sort || 'filename';
          const ownScope = this.workspace.index.scope?.(page) ?? '';
          const pages = this.workspace.index
            .all(root.id)
            .filter((p) => !p.draft && (this.workspace.index.scope?.(p) ?? '') === ownScope)
            .sort(
              (a, b) =>
                (sort === 'order' ? (a.order ?? Infinity) - (b.order ?? Infinity) : 0) ||
                (sort === 'title' ? a.title.localeCompare(b.title) : a.path.localeCompare(b.path)),
            );
          const ix = pages.findIndex((p) => p.id === page.id);
          const crumbs = page.path
            .split('/')
            .slice(0, -1)
            .map((part, i, all) => {
              const target = pages.find(
                (p) => p.path === `${all.slice(0, i + 1).join('/')}/index.md`,
              );
              return target
                ? `<a href="${escapeHtml(href(target))}">${escapeHtml(part)}</a>`
                : `<span>${escapeHtml(part)}</span>`;
            });
          const toc =
            root.config?.features.tableOfContents === false || page.headings.length < 2
              ? ''
              : `<aside class="reader-toc" aria-label="On this page"><strong>On this page</strong><ul>${page.headings
                  .filter((h) => h.level > 1 && h.level < 5)
                  .map(
                    (h) =>
                      `<li class="toc-${h.level}"><a href="#${escapeHtml(h.slug)}">${escapeHtml(h.text)}</a></li>`,
                  )
                  .join('')}</ul></aside>`;
          const pager = !pageShowsPager(page)
            ? ''
            : `<nav class="reader-pager" aria-label="Pages">${ix > 0 ? `<a href="${escapeHtml(href(pages[ix - 1]))}"><small>Previous</small>${escapeHtml(pages[ix - 1].title)}</a>` : ''}${ix >= 0 && ix < pages.length - 1 ? `<a class="next" href="${escapeHtml(href(pages[ix + 1]))}"><small>Next</small>${escapeHtml(pages[ix + 1].title)}</a>` : ''}</nav>`;
          let switchers = '',
            banner = '',
            language = root.config?.wiki.language;
          if (
            root.config &&
            (root.config.i18n.languages.length || root.config.versions.archived.length)
          ) {
            const v = variants(page, this.workspace.index.all(root.id), root.config);
            language = v.scope.language || root.config.wiki.language;
            const pill = (
              label: string,
              target: Page | undefined,
              current: boolean,
              missing: string,
            ) =>
              current
                ? `<span class="variant" aria-current="true">${escapeHtml(label)}</span>`
                : target
                  ? `<a class="variant" href="${escapeHtml(href(target))}">${escapeHtml(label)}</a>`
                  : `<span class="variant missing" title="${escapeHtml(missing)}">${escapeHtml(label)}</span>`;
            if (root.config.i18n.languages.length)
              switchers += `<nav class="variants" aria-label="Language">${v.languages.map((l) => pill(l.language, l.page, l.current, 'Not translated yet')).join('')}</nav>`;
            if (root.config.versions.archived.length)
              switchers += `<nav class="variants" aria-label="Version">${v.versions.map((x) => pill(x.version, x.page, x.current, `This page does not exist in ${x.version}`)).join('')}</nav>`;
            if (v.scope.version) {
              const latest = v.versions.find((x) => !x.archived)?.page;
              banner = `<p class="archived-banner" role="note">You are reading version ${escapeHtml(v.scope.version)}, an archived version.${latest ? ` <a href="${escapeHtml(href(latest))}">Go to the latest version</a>.` : ''}</p>`;
            }
          }
          const bar = `<div class="reader-bar"><nav class="crumbs" aria-label="Breadcrumb">${[escapeHtml(root.name), ...crumbs, `<span class="current">${escapeHtml(page.title)}</span>`].join(' <span class="muted">/</span> ')}</nav>${root.config?.features.search === false ? '' : '<div class="reader-search"><input id="wiki-search" type="search" placeholder="Search pages" aria-label="Search pages"><ul id="wiki-results"></ul></div>'}<button class="btn ghost toggle" id="reader-focus" aria-pressed="false" aria-label="Focus Mode" title="Hide navigation and page extras">${svgIcon('eye')}<span class="label">Focus Mode</span></button>${toc ? `<button class="btn ghost toggle" id="reader-outline" aria-pressed="true" aria-label="Outline" title="Show or hide the page outline">${svgIcon('bullet')}<span class="label">Outline</span></button>` : ''}${switchers}</div>`;
          // The wiki's typeface and measure; colors keep following the VS Code theme.
          const look = resolveAppearance(root.config?.appearance);
          const readerStyle = root.config
            ? `<style>.reader{--ws-font:${fonts[look.font]};--ws-doc-width:${widths[look.width]}}</style>`
            : '';
          const content = `${readerStyle}<main class="reader">${bar}<div class="reader-layout"><article class="doc">${banner}${page.tags.length ? `<div class="tags">${page.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}${body}${pager}<footer class="reader-backlinks"><h2>Backlinks · ${backlinks.length}</h2>${backlinks.length ? `<ul>${backlinks.map((b) => `<li><a href="${escapeHtml(href(b.page))}">${escapeHtml(b.page.title)}</a></li>`).join('')}</ul>` : '<p class="muted">No pages link here yet.</p>'}</footer></article>${toc}</div></main>`;
          if (revision === this.revision && this.preview === panel) {
            panel.title = `Preview: ${page.title}`;
            panel.webview.html = this.document(
              panel,
              page.title,
              content,
              { mode: 'preview' },
              language,
            );
            this.previewFingerprint = fingerprint;
            if (Date.now() < this.focusPreviewUntil) panel.reveal(panel.viewColumn, false);
          }
        }
      }
    }
  }
  /** The link graph: pages and links of a wiki (or all), centred on the active page when shown. */
  private graphView(root?: string): { html: string; data: unknown } {
    const full = this.workspace.index.graph(root);
    const archived = new Set(
      [...this.workspace.index.pages.values()]
        .filter((p) => this.workspace.isArchived(p))
        .map((p) => p.id),
    );
    const active = this.activity?.activeUri
      ? this.workspace.index.byUri(this.activity.activeUri)
      : undefined;
    const graph = {
      nodes: full.nodes.filter((n) => !archived.has(n.id)),
      edges: full.edges.filter((e) => !archived.has(e.source) && !archived.has(e.target)),
      focus:
        active && !archived.has(active.id) && (!root || active.root === root)
          ? { id: active.id, title: active.title }
          : undefined,
    };
    const linked = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
    const controls = graph.focus
      ? `<fieldset class="graph-mode"><legend class="eyebrow">Show</legend><label><input type="radio" name="graph-mode" value="all"> All pages</label><label><input type="radio" name="graph-mode" value="local"> Around “${escapeHtml(graph.focus.title)}”</label><label>Distance <select id="graph-depth"><option value="1">1 link</option><option value="2">2 links</option></select></label></fieldset>`
      : '';
    return {
      html: `<main><div class="eyebrow">NoteSpace · Connections</div><h1 style="margin:4px 0 0;font-size:22px">Link graph</h1><div class="stats"><span class="stat"><strong>${graph.nodes.length}</strong>pages</span><span class="stat"><strong>${graph.edges.length}</strong>links</span><span class="stat"><strong>${graph.nodes.filter((n) => !linked.has(n.id)).length}</strong>unlinked</span></div>${controls}<label for="filter" class="eyebrow">Find a page</label><p><input id="filter" type="search" placeholder="Filter by title or path" autocomplete="off"></p><p class="muted">Select a page to open it. The diagram shows up to 150 matching pages; the list includes all matches.</p><svg class="graph" viewBox="0 0 900 460" role="group" aria-label="Wiki page connections"></svg><p id="empty" hidden>No matching pages.</p><ul class="page-list" aria-label="Pages"></ul></main>`,
      data: graph,
    };
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.revision++;
    this.preview?.dispose();
    this.subscriptions.forEach((s) => s.dispose());
  }
}
void posix;

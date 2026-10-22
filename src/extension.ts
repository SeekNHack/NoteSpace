import * as vscode from 'vscode';
import { WikiRoot, WikiWorkspace } from './workspace';
import { PageNode, registerLanguageFeatures, showPage } from './views';
import { WikiPanels } from './webviews';
import { listTemplates } from './template-files';
import { clipFromHtml, clipMarkdown } from './core/web-clip';
import { fillTemplate, homepageTemplate, templates } from './templates';
import {
  encodePath,
  namedPage,
  namedSection,
  pagePath,
  posix,
  safeRelative,
  slug,
  uriPath,
} from './core/paths';
import { Page } from './core/model';
import { withFrontMatter } from './core/frontmatter';
import { pageShowsPager } from './core/nav-tree';
import { exportWiki } from './export';
import { createConfig, defaultConfig, parseConfig, updateConfig, WikiConfig } from './core/config';
import { VisualEditorProvider, caretContext } from './visual';
import {
  closeCompanion,
  modeOf,
  showCode,
  showSplit,
  showStudio,
  studioColumn,
  STUDIO_VIEW_TYPE,
} from './modes';
import {
  importImage,
  resolveImage,
  browseImages,
  importAttachment,
  resolveAttachment,
  resolveMedia,
  importMedia,
} from './assets';
import { parseDocument, Document } from 'yaml';
import { WikiActivity } from './activity';
import { visualSafety } from './core/visual-safety';
import { importMarkdownProject } from './import-project';
import { PlannerService } from './planner';
import { PlannerPanel, PlannerView, plannerViews } from './planner-panel';
import { NotebookCatalog, convertNotebook, importNotebook, showNotebookPreview } from './notebooks';
import { registerPythonKernel } from './python-kernel';
import { CodeRunner } from './code-runner';
import { registerMermaidDiagnostics } from './mermaid-diagnostics';
import { CanvasEditorProvider, newCanvas } from './canvas-editor';
import {
  findApiDescriptions,
  generateApiReference,
  looksLikeOpenApi,
  openApiPlayground,
  refreshPlayground,
  staleGeneratedPages,
} from './api-playground';
import {
  git as gitRead,
  GitContentProvider,
  repositoryOfFolder,
  showPageHistory,
  repoRelative,
} from './git-history';
import { browseGitVersion, listRefs } from './git-versions';
import { boardFileName, boardTemplates, STATUS_BOARD } from './core/board-model';
import { emptyRequest as emptyApiRequest } from './core/http/model';
import { ReviewController } from './review';
import { exportEpub, exportPdf } from './publish';
import { DashboardEditorProvider, newDashboard } from './dashboard-editor';
import { sharedDashboards } from './dashboards';
import { openCodeRef, pagesReferencing, registerCodeReferences } from './code-references';
import { openThemeBuilder } from './theme-builder';
import { openSearchPanel } from './search-panel';
import { parseQuery } from './core/query';
import { ApiStore } from './api-store';
import { ApiClientPanel } from './api-client';
import { HttpBlocks } from './http-blocks';
import { parseCurl } from './core/http/curl';
import { findGenerated } from './core/api-pages';
import { SemanticSearch } from './semantic';
import { AiProposals, ask, prompts, unwrap, ENDPOINT_SECRET } from './ai';
import { scopeOf, scopedPath } from './core/scopes';
import { importObsidianVault, planObsidianImport } from './obsidian-import';
import { importReport } from './core/obsidian';
import {
  addLanguage,
  archiveVersion,
  createTranslation,
  markTranslationCurrent,
  updateWikiConfig,
} from './i18n';
import { wikiColors } from './core/config';
import { addDays, inList, resolveDate, Task } from './core/tasks';
export interface WikiStudioApi {
  workspace: WikiWorkspace;
  panels: WikiPanels;
  plannerPanel: PlannerPanel;
  activity: WikiActivity;
  planner: PlannerService;
  exportWiki: typeof exportWiki;
  /** Used by the integration tests for secret storage and per-workspace approvals. */
  context: vscode.ExtensionContext;
  review: ReviewController;
  proposals: AiProposals;
  semantic: SemanticSearch;
}
export async function activate(context: vscode.ExtensionContext): Promise<WikiStudioApi> {
  const log = vscode.window.createOutputChannel('NoteSpace');
  const workspace = new WikiWorkspace(log),
    activity = new WikiActivity(context, workspace),
    panels = new WikiPanels(workspace, context.extensionUri, activity);
  // Wikis removed from NoteSpace stay on disk but are not indexed; one may be the default.
  workspace.setHidden(context.workspaceState.get<string[]>('notespace.removedWikis', []));
  workspace.defaultRoot = context.workspaceState.get<string>('notespace.defaultWiki');
  context.subscriptions.push(log, workspace, panels, activity);
  let httpBlocks: HttpBlocks | undefined;
  const studio = new VisualEditorProvider(workspace, context.extensionUri, {
    get http() {
      return httpBlocks;
    },
    openPage: async (page, options) => {
      const heading = options?.anchor
        ? page.headings.find((h) => h.slug === options.anchor)
        : undefined;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(page.uri));
      await activity.opened(page);
      if (visualSafety(document.getText()) || (heading && options?.from !== 'studio'))
        await showPage(page.uri, heading?.offset);
      else {
        await showStudio(document.uri);
        if (heading)
          studio.reveal(document.uri, heading.text, heading.offset / Math.max(1, page.text.length));
      }
    },
    get planner() {
      return planner;
    },
    get runner() {
      return runner;
    },
    collection: (page) =>
      planner.collection(
        page,
        (target) => encodePath(posix.relative(posix.dirname(page.path), target.path)),
        true,
        true,
      ),
    createPage: async (name, rootId) => {
      await vscode.commands.executeCommand('notespace.newPage', name, rootId);
    },
  });
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VisualEditorProvider.viewType, studio, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
  const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  /** The wiki page in the active editor tab, whether Studio or native Code. */
  const activeTabPage = (): Page | undefined => {
    const input = activeTab();
    const uri =
      input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
        ? input.uri
        : undefined;
    return uri && workspace.index.byUri(uri.toString());
  };
  const planner = new PlannerService(workspace);
  context.subscriptions.push(planner);
  const runner = new CodeRunner();
  const notebooks = new NotebookCatalog(workspace);
  const canvases = new NotebookCatalog(workspace, '**/*.canvas');
  context.subscriptions.push(
    notebooks,
    canvases,
    vscode.window.registerCustomEditorProvider(
      CanvasEditorProvider.viewType,
      new CanvasEditorProvider(workspace, context.extensionUri, async (uri) =>
        openPreferredUri(uri),
      ),
      { supportsMultipleEditorsPerDocument: false },
    ),
  );
  registerPythonKernel(context);
  const plannerPanel = new PlannerPanel(
    workspace,
    planner,
    context.extensionUri,
    context.workspaceState,
    async (uri, offset) => {
      const page = workspace.index.byUri(uri.toString());
      if (offset !== undefined || !page) await showPage(uri, offset);
      else await openPreferred(page);
    },
    activity,
  );
  context.subscriptions.push(plannerPanel);
  panels.planner = planner;
  plannerPanel.reader = (page, webview, href) => panels.renderBody(page, webview, href);
  plannerPanel.pages = panels;
  plannerPanel.files = (rootId) => [
    ...notebooks
      .all(rootId)
      .map((f) => ({ path: f.path, uri: f.uri.toString(), file: 'notebook' as const })),
    ...canvases
      .all(rootId)
      .map((f) => ({ path: f.path, uri: f.uri.toString(), file: 'canvas' as const })),
  ];
  context.subscriptions.push(
    notebooks.onDidChange(() => plannerPanel.refresh()),
    canvases.onDidChange(() => plannerPanel.refresh()),
  );
  const plannerStatus = vscode.window.createStatusBarItem(
    'notespace.planner',
    vscode.StatusBarAlignment.Left,
    9,
  );
  plannerStatus.name = 'NoteSpace Planner';
  plannerStatus.command = {
    command: 'notespace.planner',
    title: 'Open Planner',
    arguments: ['today'],
  };
  context.subscriptions.push(plannerStatus);
  const updatePlannerStatus = () => {
    if (!workspace.roots.length) return plannerStatus.hide();
    const today = planner.today();
    const tasks = planner.tasks();
    const due = tasks.filter((t) => inList(t, 'today', today)).length;
    const overdue = tasks.filter((t) => inList(t, 'overdue', today)).length;
    plannerStatus.text = `$(checklist) ${due}${overdue ? ` $(warning) ${overdue}` : ''}`;
    plannerStatus.tooltip = `${due} task${due === 1 ? '' : 's'} for today${overdue ? `, ${overdue} overdue` : ''}. Open the Planner.`;
    plannerStatus.show();
  };
  context.subscriptions.push(planner.onDidChange(updatePlannerStatus));
  const status = vscode.window.createStatusBarItem(
    'notespace.wiki',
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.name = 'NoteSpace';
  status.command = 'notespace.home';
  const modeStatus = vscode.window.createStatusBarItem(
    'notespace.mode',
    vscode.StatusBarAlignment.Right,
    100,
  );
  modeStatus.name = 'NoteSpace Editor Mode';
  context.subscriptions.push(status, modeStatus);
  const updateStatus = () => {
    const page = activeTabPage();
    const root = page ? workspace.rootFor(page) : workspace.roots[0];
    const count = root ? workspace.index.all(root.id).length : workspace.index.pages.size;
    status.text = `$(book) ${root && workspace.roots.length > 1 ? `${root.name} · ` : ''}${count} page${count === 1 ? '' : 's'}${workspace.issues.length ? ' $(warning)' : ''}`;
    status.tooltip = workspace.issues.length
      ? `Index warnings (see NoteSpace output):\n${workspace.issues.slice(0, 5).join('\n')}`
      : 'Open the NoteSpace dashboard';
    if (vscode.workspace.workspaceFolders?.length && workspace.roots.length) status.show();
    else status.hide();
    const input = activeTab();
    if (page && (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText)) {
      const isStudio = input instanceof vscode.TabInputCustom;
      const split = modeOf(input.uri) === 'split';
      const state = isStudio ? studio.states.get(input.uri.toString()) : undefined;
      modeStatus.text = isStudio
        ? `$(edit) Studio${split ? ' · Split' : ''}${state && !/^(Saved|Ready)/.test(state) ? ` · ${state}` : ''}`
        : `$(file-code) Markdown${split ? ' · Split' : ''}`;
      modeStatus.tooltip = isStudio
        ? 'Switch to Markdown source (Code mode)'
        : 'Switch to Studio visual editing';
      modeStatus.command = isStudio ? 'notespace.source' : 'notespace.visual';
      modeStatus.show();
    } else modeStatus.hide();
    void vscode.commands.executeCommand('setContext', 'notespace.activeIsWikiPage', !!page);
    void vscode.commands.executeCommand(
      'setContext',
      'notespace.activeIsJournal',
      !!activeJournalDate(),
    );
    const doc = vscode.window.activeTextEditor?.document;
    void vscode.commands.executeCommand(
      'setContext',
      'notespace.activeIsOpenApi',
      !!doc &&
        /\.(ya?ml|json)$/i.test(doc.uri.path) &&
        looksLikeOpenApi(doc.getText(new vscode.Range(0, 0, 80, 0))),
    );
  };
  context.subscriptions.push(
    workspace.onDidChange(updateStatus),
    studio.onDidChangeState(updateStatus),
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      updateStatus();
      const page = activeTabPage();
      if (page && event.changed.some((tab) => tab.isActive) && activity.activeUri !== page.uri)
        void activity.opened(page);
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(updateStatus),
  );
  // The NoteSpace icon in the activity bar opens the workspace panel: pages, tasks and the API
  // client are all there, so the sidebar only launches it (and gives the space back).
  const launcher = vscode.window.createTreeView('notespace.start', {
    treeDataProvider: { getTreeItem: (item: vscode.TreeItem) => item, getChildren: () => [] },
  });
  context.subscriptions.push(
    launcher,
    launcher.onDidChangeVisibility((event) => {
      if (
        !event.visible ||
        !vscode.workspace.getConfiguration('notespace').get<boolean>('sidebar.openPanel', true)
      )
        return;
      plannerPanel.show();
      void vscode.commands.executeCommand('workbench.action.closeSidebar');
    }),
  );
  const command = (name: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(`notespace.${name}`, async (...args: unknown[]) => {
        try {
          return await fn(...args);
        } catch (e) {
          if (e instanceof vscode.CancellationError) return;
          const message = e instanceof Error ? e.message : String(e);
          log.appendLine(`[${name}] ${message}`);
          void vscode.window
            .showErrorMessage(`NoteSpace: ${message}`, 'Show Log')
            .then((choice) => {
              if (choice) log.show();
            });
        }
      }),
    );
  const activePage = (node?: PageNode): Page | undefined =>
    node?.page
      ? workspace.index.pages.get(node.page.id)
      : activeTabPage() ||
        workspace.index.byUri(vscode.window.activeTextEditor?.document.uri.toString() || '') ||
        workspace.index.byUri(activity.activeUri || '');
  const openStudio = async (page: Page, column?: vscode.ViewColumn): Promise<void> => {
    await activity.opened(page);
    const uri = vscode.Uri.parse(page.uri);
    // Reveal a Studio tab that is already open elsewhere; otherwise replace Code in this group.
    await showStudio(uri, { column, replace: column !== undefined || !studioColumn(uri) });
  };
  const openPreferred = async (page: Page): Promise<void> => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(page.uri));
    // notespace.openPagesIn: where pages open from the explorer, search and links.
    const where = vscode.workspace
      .getConfiguration('notespace', document.uri)
      .get<'studio' | 'code' | 'preview'>('openPagesIn', 'studio');
    if (where === 'preview') {
      await activity.opened(page);
      panels.openPreview(page);
      return;
    }
    if (where === 'code' || visualSafety(document.getText())) {
      await activity.opened(page);
      await showPage(document.uri);
    } else await openStudio(page);
  };
  const openPreferredUri = async (uri: vscode.Uri): Promise<void> => {
    const page = workspace.index.byUri(uri.toString());
    if (page) await openPreferred(page);
    else await showPage(uri);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const page = editor && workspace.index.byUri(editor.document.uri.toString());
      if (page) void activity.opened(page);
    }),
  );
  const chooseRoot = async (id?: string): Promise<WikiRoot | undefined> => {
    if (!workspace.roots.length) {
      if (!vscode.workspace.workspaceFolders?.length)
        throw new Error('Open a workspace folder to create or use a wiki.');
      throw new Error('Fix wiki.yaml or notespace.root. See Output → NoteSpace for details.');
    }
    if (id) {
      const found = workspace.roots.find((r) => r.id === id);
      if (!found) throw new Error('This wiki is no longer open.');
      return found;
    }
    if (workspace.roots.length === 1) return workspace.roots[0];
    const preferred = workspace.roots.find((r) => r.id === workspace.defaultRoot);
    if (preferred) return preferred;
    return (
      await vscode.window.showQuickPick(
        workspace.roots.map((root) => ({ label: root.name, description: root.uri.path, root })),
        { title: 'Choose a wiki' },
      )
    )?.root;
  };
  const getPage = (node?: PageNode): Page => {
    const page = activePage(node);
    if (!page) throw new Error('Open a Markdown page inside your configured wiki directory first.');
    return page;
  };
  const createNamedPage = async (
    root: WikiRoot,
    requested: string,
    body: string,
  ): Promise<void> => {
    const { path, title } = namedPage(requested);
    const uri = await workspace.createPage(root, path, fillTemplate(body, title));
    const page = workspace.index.byUri(uri.toString());
    if (page) await openPreferred(page);
  };
  const validateNamedPage = (root: WikiRoot, value: string): string | undefined => {
    try {
      const { path } = namedPage(value);
      if (
        workspace.index
          .all(root.id)
          .some((p) => p.path.toLocaleLowerCase() === path.toLocaleLowerCase())
      )
        return 'A page with this name already exists.';
      return undefined;
    } catch (e) {
      return (e as Error).message;
    }
  };
  command('initialize', async () => {
    const root = await chooseRoot();
    if (!root) return;
    const existing = workspace.index.all(root.id).find((p) => p.path.toLowerCase() === 'home.md');
    if (existing) {
      await openPreferred(existing);
      return;
    }
    const uri = await workspace.createPage(
      root,
      'Home',
      '# Welcome to NoteSpace\n\nYour wiki is a folder of Markdown files. Own it, version it, and take it anywhere.\n\n## Start writing\n\n- Run **NoteSpace: New Page** to create a page from a template.\n- Connect pages with `[[Page name]]` or `[[/folder/page|a label]]`.\n- Type `[[` to complete page names and `#` to choose a heading.\n- Use **NoteSpace: Search Pages** to search text or `#tags`.\n- Open **NoteSpace: Open Live Preview** to read and follow links.\n\n## Make it yours\n\nAdd YAML front matter with `title` and `tags`, create daily notes, explore the link graph, or export a portable HTML wiki.\n',
    );
    await openPreferredUri(uri);
  });
  command('createWiki', async () => {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) throw new Error('Open a workspace folder to create a wiki.');
    const chosen =
      folders.length === 1
        ? folders[0]
        : (
            await vscode.window.showQuickPick(
              folders.map((folder) => ({ label: folder.name, folder })),
              { title: 'Create Wiki · Workspace' },
            )
          )?.folder;
    if (!chosen) return;
    const title = await vscode.window.showInputBox({
      title: 'Create Wiki · Name',
      prompt: 'Documentation title',
      value: 'My Documentation',
      validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
    });
    if (title === undefined) return;
    const description = await vscode.window.showInputBox({
      title: 'Create Wiki · Description',
      value: 'Created with NoteSpace',
    });
    if (description === undefined) return;
    const destination = await vscode.window.showInputBox({
      title: 'Create Wiki · Directory',
      prompt: 'Path relative to workspace folder',
      value: 'my-wiki',
      validateInput: (v) => {
        try {
          safeRelative(v);
          return undefined;
        } catch (e) {
          return (e as Error).message;
        }
      },
    });
    if (!destination) return;
    const language = await vscode.window.showInputBox({
      title: 'Create Wiki · Language',
      value: 'en',
      validateInput: (v) =>
        /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(v) ? undefined : 'Use a language code such as en or it.',
    });
    if (!language) return;
    const theme = await vscode.window.showQuickPick(['system', 'light', 'dark'], {
      title: 'Create Wiki · Theme',
    });
    if (!theme) return;
    const starter = await vscode.window.showQuickPick(
      [
        { label: 'Starter documentation', value: true },
        { label: 'Homepage only', value: false },
      ],
      { title: 'Create Wiki · Initial content' },
    );
    if (!starter) return;
    const projectUri = vscode.Uri.joinPath(chosen.uri, safeRelative(destination));
    const configUri = vscode.Uri.joinPath(projectUri, 'wiki.yaml');
    try {
      await vscode.workspace.fs.stat(projectUri);
      throw new Error(
        'The destination directory already exists. Choose a new directory for this wiki.',
      );
    } catch (e) {
      if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound')) throw e;
    }
    const root: WikiRoot = {
      id: configUri.toString(),
      name: title,
      folder: chosen,
      uri: vscode.Uri.joinPath(projectUri, 'docs'),
      projectUri,
    };
    await workspace.assertNoSymlink(root, projectUri);
    const config = defaultConfig(title);
    config.wiki.description = description;
    config.wiki.language = language;
    config.appearance.theme = theme as WikiConfig['appearance']['theme'];
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'docs'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'assets', 'images'));
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(projectUri, 'assets', 'attachments'),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(root.uri, 'index.md'),
      new TextEncoder().encode(homepageTemplate(title, description, starter.value)),
    );
    if (starter.value) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root.uri, 'guides'));
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(root.uri, 'guides', 'getting-started.md'),
        new TextEncoder().encode(
          '# Getting started\n\nWrite Markdown or open the visual editor. Link pages with [relative links](../index.md).\n',
        ),
      );
    }
    await vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(createConfig(config)));
    await workspace.refresh();
    await openPreferredUri(vscode.Uri.joinPath(root.uri, 'index.md'));
  });
  command('importProject', async () => {
    const selected = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Import Markdown or MkDocs project',
    });
    const projectUri = selected?.[0];
    if (!projectUri) return;
    const result = await importMarkdownProject(workspace, projectUri);
    for (const warning of result.warnings) log.appendLine(`[importProject] ${warning}`);
    const message = `Imported ${result.pages} Markdown pages${result.warnings.length ? ` with ${result.warnings.length} compatibility notes (NoteSpace output)` : ''}.`;
    const choice = await vscode.window.showInformationMessage(message, 'Show Log');
    if (choice) log.show();
    if (result.homepage) await openPreferred(result.homepage);
  });
  command('openWiki', async () => {
    const root = await chooseRoot(plannerPanel.root()?.id);
    if (root)
      await plannerPanel.showWiki({
        path: root.config?.content.homepage || 'index.md',
        root: root.id,
      });
  });
  /** Uri of the page shown in the active tab, when the command targets it. */
  const activeUriFor = (page: Page): vscode.Uri | undefined => {
    const input = activeTab();
    return (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) &&
      input.uri.toString() === page.uri
      ? input.uri
      : undefined;
  };
  command('visual', async (node?: PageNode) => {
    const page = getPage(node);
    const editor = vscode.window.activeTextEditor;
    const fromCode =
      editor && editor.document.uri.toString() === page.uri ? caretContext(editor) : undefined;
    await openStudio(page);
    if (fromCode?.text) studio.reveal(vscode.Uri.parse(page.uri), fromCode.text, fromCode.ratio);
  });
  command('source', async (node?: PageNode) => {
    const page = getPage(node);
    const uri = activeUriFor(page);
    if (uri && activeTab() instanceof vscode.TabInputCustom) {
      await studio.flush(uri);
      await showCode(uri, { replace: true });
    } else await showPage(page.uri);
    await activity.opened(page);
  });
  command('split', async (node?: PageNode) => {
    const page = getPage(node);
    const uri = vscode.Uri.parse(page.uri);
    await studio.flush(uri);
    await activity.opened(page);
    const editor = vscode.window.activeTextEditor;
    const caret =
      editor && editor.document.uri.toString() === page.uri ? editor.selection : undefined;
    // Split toggles: run it again to keep only the editor you are in.
    if (modeOf(uri) === 'split')
      await closeCompanion(uri, activeTab() instanceof vscode.TabInputText ? 'code' : 'studio');
    else await showSplit(uri, caret && new vscode.Range(caret.active, caret.active));
  });
  command('focusContext', async () => {
    // The page's outline and backlinks are shown with the page in the Wiki.
    const page = activeTabPage();
    await plannerPanel.showWiki(page ? { id: page.id } : {});
  });
  command('revealSection', async (rootId?: string, prefix?: string) => {
    if (typeof rootId !== 'string' || typeof prefix !== 'string') return;
    await plannerPanel.showWiki({ section: prefix, root: rootId });
  });
  command('revealInExplorer', async (node?: PageNode) => {
    const root = node?.root ? workspace.roots.find((r) => r.id === node.root) : undefined;
    const uri = node?.uri
      ? node.uri
      : node?.page
        ? vscode.Uri.parse(node.page.uri)
        : root && node?.prefix !== undefined
          ? vscode.Uri.joinPath(root.uri, node.prefix)
          : vscode.Uri.parse(getPage(node).uri);
    await vscode.commands.executeCommand('revealInExplorer', uri);
  });
  command('openToSide', async (node?: PageNode) => {
    const page = getPage(node);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(page.uri));
    await activity.opened(page);
    if (visualSafety(document.getText()))
      await showPage(page.uri, undefined, vscode.ViewColumn.Beside);
    else
      await vscode.commands.executeCommand('vscode.openWith', document.uri, STUDIO_VIEW_TYPE, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
      });
  });
  command('toggleFavorite', async (node?: PageNode) => activity.toggleFavorite(getPage(node)));
  command('addFavorite', async (node?: PageNode) => {
    const page = getPage(node);
    if (!activity.isFavorite(page)) await activity.toggleFavorite(page);
  });
  command('removeFavorite', async (node?: PageNode) => {
    const page = getPage(node);
    if (activity.isFavorite(page)) await activity.toggleFavorite(page);
  });
  command('home', () => plannerPanel.show('home'));
  command('filterPages', async () => {
    await plannerPanel.showWiki({ filter: true });
  });
  command('newSection', async (node?: PageNode) => {
    const active = activePage(node);
    const root = await chooseRoot(node?.root || active?.root);
    if (!root) return;
    const section =
      node?.prefix !== undefined
        ? node.prefix
        : active?.root === root.id
          ? posix.dirname(active.path).replace(/^\.$/, '')
          : '';
    const name = await vscode.window.showInputBox({
      title: 'New wiki section',
      value: section ? `${section}/` : '',
      validateInput: (v) => {
        try {
          namedSection(v);
          return undefined;
        } catch (e) {
          return (e as Error).message;
        }
      },
    });
    if (name) {
      const { path, title } = namedSection(name);
      await workspace.createSection(root, path, title);
    }
  });
  command('renameSection', async (node?: PageNode) => {
    if (!node?.prefix || node.page) throw new Error('Select a wiki section.');
    const root = await chooseRoot(node.root);
    if (!root) return;
    const name = await vscode.window.showInputBox({
      title: 'Rename or move section',
      value: node.prefix.slice(0, -1),
      validateInput: (v) => {
        try {
          safeRelative(v);
          return undefined;
        } catch (e) {
          return (e as Error).message;
        }
      },
    });
    if (!name || name === node.prefix.slice(0, -1)) return;
    const result = await workspace.moveSection(root, node.prefix, name);
    if (result.warnings.length)
      void vscode.window.showWarningMessage(
        `Section moved with ${result.warnings.length} link warning(s). See Output → NoteSpace.`,
      );
    result.warnings.forEach((warning) => log.appendLine(warning));
  });
  command('deleteSection', async (node?: PageNode) => {
    if (!node?.prefix || node.page) throw new Error('Select a wiki section.');
    const root = await chooseRoot(node.root);
    if (!root) return;
    const pages = workspace.index.all(root.id).filter((p) => p.path.startsWith(node.prefix!));
    const incoming = pages.reduce(
      (sum, p) =>
        sum +
        workspace.index.backlinks(p).filter((b) => !b.page.path.startsWith(node.prefix!)).length,
      0,
    );
    const choice = await vscode.window.showWarningMessage(
      `Delete section “${node.prefix.slice(0, -1)}” with ${pages.length} page(s)?${incoming ? ` ${incoming} incoming link(s) will break.` : ''}`,
      { modal: true, detail: 'The section moves to Wiki Trash and can be recovered page by page.' },
      'Delete Section',
    );
    if (choice === 'Delete Section') await workspace.trashSection(root, node.prefix);
  });
  // ---------------------------------------------------------------------------------------
  // Wiki management. “Remove from NoteSpace” never touches files; “Delete Wiki Files” is the
  // only destructive operation and asks for the wiki's name.
  // ---------------------------------------------------------------------------------------
  const wikiName = (root: WikiRoot) => root.config?.wiki.title || root.name;
  const removedWikis = () => context.workspaceState.get<string[]>('notespace.removedWikis', []);
  command('removeWiki', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    const choice = await vscode.window.showInformationMessage(
      `Remove “${wikiName(root)}” from NoteSpace?`,
      {
        modal: true,
        detail:
          'Its files stay on disk unchanged. NoteSpace stops showing and indexing it in this workspace; Restore Removed Wikis brings it back.',
      },
      'Remove from NoteSpace',
    );
    if (choice !== 'Remove from NoteSpace') return;
    const list = [...new Set([...removedWikis(), root.id])];
    await context.workspaceState.update('notespace.removedWikis', list);
    if (workspace.defaultRoot === root.id) {
      workspace.defaultRoot = undefined;
      await context.workspaceState.update('notespace.defaultWiki', undefined);
    }
    workspace.setHidden(list);
    await workspace.refresh();
    void vscode.window.showInformationMessage(
      `“${wikiName(root)}” was removed from NoteSpace. Its files were not changed.`,
    );
  });
  command('restoreWikis', async () => {
    const hidden = workspace.hiddenRoots;
    if (!hidden.length)
      return void vscode.window.showInformationMessage('No wiki has been removed from NoteSpace.');
    const picked = await vscode.window.showQuickPick(
      hidden.map((r) => ({
        label: wikiName(r),
        description: vscode.workspace.asRelativePath(r.projectUri || r.uri),
        id: r.id,
        picked: true,
      })),
      { title: 'Restore removed wikis', canPickMany: true },
    );
    if (!picked?.length) return;
    const list = removedWikis().filter((id) => !picked.some((p) => p.id === id));
    await context.workspaceState.update('notespace.removedWikis', list);
    workspace.setHidden(list);
    await workspace.refresh();
  });
  command('setDefaultWiki', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    workspace.defaultRoot = root.id;
    await context.workspaceState.update('notespace.defaultWiki', root.id);
    void vscode.window.showInformationMessage(
      `“${wikiName(root)}” is the default wiki when a command could apply to several.`,
    );
  });
  const requireConfig = (root: WikiRoot) => {
    if (!root.config)
      throw new Error(
        `“${root.name}” has no wiki.yaml, so its name and look come from its folder. Run Create Wiki or Import Project to give it settings.`,
      );
  };
  command('renameWiki', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    requireConfig(root);
    const title = await vscode.window.showInputBox({
      title: 'Rename wiki',
      value: root.config!.wiki.title,
      validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
    });
    if (title) await updateWikiConfig(workspace, root, (c) => void (c.wiki.title = title.trim()));
  });
  command('editWikiDescription', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    requireConfig(root);
    const description = await vscode.window.showInputBox({
      title: 'Wiki description',
      value: root.config!.wiki.description,
    });
    if (description !== undefined)
      await updateWikiConfig(
        workspace,
        root,
        (c) => void (c.wiki.description = description.trim()),
      );
  });
  command('setWikiIcon', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    requireConfig(root);
    const icons = [
      'book',
      'notebook',
      'library',
      'rocket',
      'beaker',
      'tools',
      'globe',
      'heart',
      'star',
      'organization',
      'project',
      'code',
      'database',
      'server',
      'shield',
      'lightbulb',
    ];
    const picked = await vscode.window.showQuickPick(
      [{ label: 'Default', id: '' }, ...icons.map((i) => ({ label: `$(${i}) ${i}`, id: i }))],
      { title: 'Wiki icon' },
    );
    if (picked)
      await updateWikiConfig(workspace, root, (c) => void (c.wiki.icon = picked.id || undefined));
  });
  command('setWikiColor', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    requireConfig(root);
    const picked = await vscode.window.showQuickPick(
      [{ label: 'Default', id: '' }, ...wikiColors.map((c) => ({ label: c, id: c }))],
      { title: 'Wiki color' },
    );
    if (picked)
      await updateWikiConfig(workspace, root, (c) => void (c.wiki.color = picked.id || undefined));
  });
  command('openWikiSettings', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    if (root.projectUri)
      await vscode.window.showTextDocument(vscode.Uri.joinPath(root.projectUri, 'wiki.yaml'));
    else await vscode.commands.executeCommand('workbench.action.openSettings', 'notespace.root');
  });
  command('deleteWiki', async (node?: PageNode) => {
    const root = await chooseRoot(node?.root);
    if (!root) return;
    const folder = root.folder.uri;
    const same = (a: vscode.Uri, b: vscode.Uri) =>
      a.toString().replace(/\/$/, '') === b.toString().replace(/\/$/, '');
    const inside = (a: vscode.Uri, b: vscode.Uri) =>
      a.toString().startsWith(b.toString().replace(/\/$/, '') + '/');
    // Only the verified wiki root is deleted: its project folder (with wiki.yaml), or its
    // content folder. A whole workspace folder is never deleted from here.
    let targets: vscode.Uri[];
    if (root.projectUri && !same(root.projectUri, folder) && inside(root.projectUri, folder))
      targets = [root.projectUri];
    else if (root.projectUri && same(root.projectUri, folder))
      targets = [vscode.Uri.joinPath(root.projectUri, 'wiki.yaml'), root.uri];
    else if (!root.projectUri && !same(root.uri, folder) && inside(root.uri, folder))
      targets = [root.uri];
    else
      throw new Error(
        `“${root.name}” is the whole workspace folder. Remove it from NoteSpace instead, or remove the folder from the workspace.`,
      );
    // Another wiki inside the folder would be deleted too: refuse instead of guessing.
    const nested = workspace.roots.filter(
      (r) =>
        r.id !== root.id &&
        targets.some((t) => inside(r.projectUri || r.uri, t) || same(r.projectUri || r.uri, t)),
    );
    if (nested.length)
      throw new Error(
        `This folder also contains the wiki “${wikiName(nested[0])}”. Delete or move that wiki first.`,
      );
    for (const t of targets) await workspace.assertNoSymlink(root, t);
    const name = wikiName(root);
    const pages = workspace.index.all(root.id).length;
    const where = targets.map((t) => vscode.workspace.asRelativePath(t, true)).join(' and ');
    const typed = await vscode.window.showInputBox({
      title: `Delete Wiki Files: ${name}`,
      prompt: `This deletes ${where} (${pages} page${pages === 1 ? '' : 's'}, images, boards and settings). Type the wiki's name to confirm.`,
      placeHolder: name,
      ignoreFocusOut: true,
      validateInput: (v) =>
        v === name ? undefined : `Type “${name}” exactly to delete the files.`,
    });
    if (typed !== name) return;
    // Open documents with unsaved changes in the wiki are discarded only with consent.
    const dirty = vscode.workspace.textDocuments.filter(
      (d) => d.isDirty && targets.some((t) => inside(d.uri, t) || same(d.uri, t)),
    );
    if (dirty.length) {
      const choice = await vscode.window.showWarningMessage(
        `${dirty.length} open document${dirty.length === 1 ? ' has' : 's have'} unsaved changes in this wiki.`,
        {
          modal: true,
          detail: dirty
            .map((d) => vscode.workspace.asRelativePath(d.uri))
            .slice(0, 10)
            .join('\n'),
        },
        'Discard Changes and Delete',
      );
      if (choice !== 'Discard Changes and Delete') return;
    }
    const tabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((tab) => {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        return input?.uri && targets.some((t) => inside(input.uri!, t) || same(input.uri!, t));
      });
    if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
    for (const d of dirty)
      await vscode.commands
        .executeCommand('workbench.action.revertFile', d.uri)
        .then(undefined, () => undefined);
    const failures: string[] = [];
    let trash = true;
    for (const target of targets) {
      try {
        await vscode.workspace.fs.delete(target, { recursive: true, useTrash: trash });
      } catch (e) {
        if (trash) {
          // Remote file systems (code-server, SSH, containers) may have no Trash.
          const permanent = await vscode.window.showWarningMessage(
            'The Trash is not available here.',
            {
              modal: true,
              detail: `${e instanceof Error ? e.message : String(e)}\n\nDelete ${where} permanently? This cannot be undone.`,
            },
            'Delete Permanently',
          );
          if (permanent !== 'Delete Permanently') {
            failures.push(`${vscode.workspace.asRelativePath(target)}: not deleted (cancelled)`);
            break;
          }
          trash = false;
          try {
            await vscode.workspace.fs.delete(target, { recursive: true, useTrash: false });
          } catch (err) {
            failures.push(
              `${vscode.workspace.asRelativePath(target)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else
          failures.push(
            `${vscode.workspace.asRelativePath(target)}: ${e instanceof Error ? e.message : String(e)}`,
          );
      }
    }
    await workspace.refresh();
    if (failures.length)
      void vscode.window.showErrorMessage(
        `Some files of “${name}” were not deleted: ${failures.join('; ')}`,
      );
    else
      void vscode.window.showInformationMessage(
        `Deleted the files of “${name}”${trash ? ' (moved to the Trash)' : ''}.`,
      );
  });
  command('duplicatePage', async (node?: PageNode) => {
    const page = getPage(node),
      root = workspace.rootFor(page);
    const name = await vscode.window.showInputBox({
      title: 'Duplicate page',
      value: page.path.replace(/\.md$/i, '-copy.md'),
      validateInput: (v) => {
        try {
          pagePath(v);
          return undefined;
        } catch (e) {
          return (e as Error).message;
        }
      },
    });
    if (name) await openPreferredUri(await workspace.createPage(root, name, page.text));
  });
  command('copyLink', async (node?: PageNode) => {
    const page = getPage(node);
    await vscode.env.clipboard.writeText(`[[/${page.path.replace(/\.md$/i, '')}]]`);
    vscode.window.setStatusBarMessage(`$(check) Copied link to “${page.title}”`, 2500);
  });
  command('movePage', async (node?: PageNode) => {
    const page = getPage(node),
      root = workspace.rootFor(page);
    const directories = new Set(['']);
    for (const p of workspace.index.all(root.id)) {
      let dir = posix.dirname(p.path);
      while (dir !== '.') {
        directories.add(dir);
        dir = posix.dirname(dir);
      }
    }
    const chosen = await vscode.window.showQuickPick(
      [...directories].sort().map((dir) => ({ label: dir || 'Wiki root', dir })),
      { title: `Move ${page.title} to section` },
    );
    if (!chosen) return;
    const target = posix.join(chosen.dir, posix.basename(page.path));
    if (target === page.path) return;
    await openPreferredUri(await workspace.renamePage(page, target));
  });
  command('importImage', async (node?: PageNode) => {
    const page = getPage(node),
      root = workspace.rootFor(page);
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      title: 'Import image into wiki assets',
    });
    if (!picked?.[0]) return;
    const target = await importImage(workspace, root, page, picked[0]);
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() === page.uri) {
      const alt = await vscode.window.showInputBox({ title: 'Image alt text', value: 'Image' });
      if (alt !== undefined)
        await editor.edit((edit) =>
          edit.replace(editor.selection, `![${alt.replace(/[\]\r\n]/g, '')}](${target})`),
        );
    } else await vscode.env.clipboard.writeText(`![Image](${target})`);
  });
  command('browseImages', async (node?: PageNode) => {
    const page = getPage(node),
      root = workspace.rootFor(page);
    const images = await browseImages(workspace, root, page);
    if (!images.length) {
      void vscode.window.showInformationMessage('No imported wiki images found.');
      return;
    }
    const picked = await vscode.window.showQuickPick(images, { title: 'Choose a wiki image' });
    if (!picked) return;
    const markdown = `![${picked.label.replace(/[\]\r\n]/g, '')}](${picked.target})`;
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() === page.uri)
      await editor.edit((edit) => edit.replace(editor.selection, markdown));
    else await vscode.env.clipboard.writeText(markdown);
  });
  command('importAttachment', async (node?: PageNode) => {
    const page = getPage(node),
      root = workspace.rootFor(page);
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { Attachments: ['pdf', 'txt', 'csv', 'zip', 'docx', 'xlsx', 'pptx'] },
      title: 'Import attachment into wiki assets',
    });
    if (!picked?.[0]) return;
    const target = await importAttachment(workspace, root, page, picked[0]);
    const label = posix.basename(picked[0].path).replace(/[\]\r\n]/g, '');
    const markdown = `[${label}](${target})`;
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() === page.uri)
      await editor.edit((edit) => edit.replace(editor.selection, markdown));
    else await vscode.env.clipboard.writeText(markdown);
  });
  command('importMedia', async (node?: PageNode) => {
    const page = getPage(node),
      root = workspace.rootFor(page);
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Audio and video': ['mp4', 'webm', 'mp3', 'ogg'] },
      title: 'Import audio or video into wiki assets',
    });
    if (!picked?.[0]) return;
    const target = await importMedia(workspace, root, page, picked[0]);
    const label = posix
      .basename(picked[0].path)
      .replace(/\.[^.]+$/, '')
      .replace(/[\]\r\n]/g, '');
    const markdown = `![${label}](${target})`;
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() === page.uri)
      await editor.edit((edit) => edit.replace(editor.selection, markdown));
    else await vscode.env.clipboard.writeText(markdown);
  });
  command('togglePager', async (node?: PageNode) => {
    const page = getPage(node);
    const on = !pageShowsPager(page);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(page.uri));
    const text = withFrontMatter(doc.getText(), { pager: on ? true : null });
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
      text,
    );
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('Could not update the page.');
    await doc.save();
    void vscode.window.setStatusBarMessage(
      on
        ? `Previous / next links added to ${page.title}`
        : `Previous / next links removed from ${page.title}`,
      3000,
    );
  });
  command('pageProperties', async (node?: PageNode) => {
    const page = getPage(node);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(page.uri));
    const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(doc.getText());
    const yaml = match ? parseDocument(match[1], { uniqueKeys: true }) : new Document({});
    if (yaml.errors.length)
      throw new Error(
        `Fix invalid frontmatter before editing properties: ${yaml.errors[0].message}`,
      );
    const fields = ['title', 'description', 'order', 'icon', 'draft'] as const;
    const choice = await vscode.window.showQuickPick(
      fields.map((key) => ({ label: key, description: String(yaml.get(key) ?? '') })),
      { title: 'Page properties · Select field' },
    );
    if (!choice) return;
    let value: string | number | boolean | null | undefined;
    if (choice.label === 'draft') {
      const picked = await vscode.window.showQuickPick(['true', 'false'], { title: 'Draft page' });
      if (picked === undefined) return;
      value = picked === 'true';
    } else {
      const entered = await vscode.window.showInputBox({
        title: `Page properties · ${choice.label}`,
        value: choice.description,
      });
      if (entered === undefined) return;
      if (choice.label === 'order') {
        if (entered && (!Number.isSafeInteger(Number(entered)) || Number(entered) < 0))
          throw new Error('Order must be a nonnegative integer.');
        value = entered ? Number(entered) : null;
      } else value = entered || null;
    }
    if (value === null) yaml.delete(choice.label);
    else yaml.set(choice.label, value);
    const prefix = `---\n${String(yaml).trimEnd()}\n---\n`;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(match?.[0].length ?? 0)),
      prefix,
    );
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('Could not update page properties.');
    await doc.save();
  });
  command('settings', async () => {
    const root = await chooseRoot();
    if (!root || !root.projectUri)
      throw new Error('This wiki has no wiki.yaml. Create or import a versioned wiki first.');
    const uri = vscode.Uri.joinPath(root.projectUri, 'wiki.yaml');
    const doc = await vscode.workspace.openTextDocument(uri);
    const current = parseConfig(doc.getText());
    const fields: Array<[string, string, string]> = [
      ['wiki.title', 'Wiki title', current.wiki.title],
      ['wiki.description', 'Description', current.wiki.description],
      ['wiki.language', 'Language', current.wiki.language],
      ['content.homepage', 'Homepage', current.content.homepage],
      ['appearance.accent', 'Accent color', current.appearance.accent],
      ['build.basePath', 'Base path', current.build.basePath],
      ['build.output', 'Output directory', current.build.output],
    ];
    const choice = await vscode.window.showQuickPick(
      [
        ...fields.map(([key, label, value]) => ({ label, description: value, key })),
        { label: 'Theme', description: current.appearance.theme, key: 'appearance.theme' },
        { label: 'Navigation sort', description: current.navigation.sort, key: 'navigation.sort' },
        ...(['search', 'tableOfContents', 'breadcrumbs'] as const).map((key) => ({
          label: key,
          description: String(current.features[key]),
          key: `features.${key}`,
        })),
      ],
      { title: 'Wiki Settings · Choose property' },
    );
    if (!choice) return;
    let value: string | boolean | undefined;
    if (choice.key === 'appearance.theme')
      value = await vscode.window.showQuickPick(['system', 'light', 'dark']);
    else if (choice.key === 'navigation.sort')
      value = await vscode.window.showQuickPick(['filename', 'title', 'order']);
    else if (choice.key.startsWith('features.'))
      value = (await vscode.window.showQuickPick(['true', 'false'])) === 'true';
    else
      value = await vscode.window.showInputBox({
        title: `Wiki Settings · ${choice.label}`,
        value: choice.description,
      });
    if (value === undefined) return;
    const changed = structuredClone(current) as any;
    const [section, key] = choice.key.split('.');
    changed[section][key] = value;
    const output = updateConfig(doc.getText(), changed);
    parseConfig(output);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
      output,
    );
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('Could not update wiki.yaml.');
    await doc.save();
    await workspace.refresh();
  });
  command('newPage', async (name?: unknown, rootId?: string) => {
    const folderNode =
      name && typeof name === 'object' && 'prefix' in name ? (name as PageNode) : undefined;
    if (folderNode) rootId = folderNode.root;
    const active = activePage();
    if (!rootId && active) rootId = active.root;
    const root = await chooseRoot(rootId);
    if (!root) return;
    const section =
      folderNode?.prefix !== undefined
        ? folderNode.prefix
        : active?.root === root.id
          ? posix.dirname(active.path).replace(/^\.$/, '')
          : '';
    const value =
      typeof name === 'string'
        ? name
        : await vscode.window.showInputBox({
            title: 'New wiki page',
            prompt:
              'Type a title. NoteSpace creates a URL-safe Markdown filename in the active section.',
            value: section ? `${section}/` : '',
            validateInput: (value) => validateNamedPage(root, value),
          });
    if (!value) return;
    if (typeof name === 'string') {
      const uri = await workspace.createPage(
        root,
        value,
        fillTemplate(templates[0].body, posix.basename(value.replace(/\.md$/i, ''))),
      );
      const page = workspace.index.byUri(uri.toString());
      if (page) await openPreferred(page);
    } else await createNamedPage(root, value, templates[0].body);
  });
  // Clip a web page: its title, summary and first paragraphs become a page in clips/.
  command('clipWebPage', async (rootId?: string) => {
    const root = await chooseRoot(typeof rootId === 'string' ? rootId : activePage()?.root);
    if (!root) return;
    const copied = (await vscode.env.clipboard.readText()).trim();
    const url = await vscode.window.showInputBox({
      title: 'Clip a web page',
      prompt: 'The address of the page. NoteSpace downloads it once and keeps a summary.',
      value: /^https?:\/\/\S+$/.test(copied) ? copied : '',
      validateInput: (v) =>
        /^https?:\/\/[^\s/]+\S*$/.test(v.trim()) ? undefined : 'Type an http(s) address.',
    });
    if (!url?.trim()) return;
    try {
      const clip = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Clipping the page…',
          cancellable: true,
        },
        async (_, cancel) => {
          const controller = new AbortController();
          cancel.onCancellationRequested(() => controller.abort());
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const response = await fetch(url.trim(), {
              signal: controller.signal,
              headers: { accept: 'text/html,application/xhtml+xml' },
              redirect: 'follow',
            });
            if (!response.ok) throw new Error(`The page answered ${response.status}.`);
            if (!/html/i.test(response.headers.get('content-type') || ''))
              throw new Error('That address is not a web page (HTML).');
            const reader = response.body?.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (reader) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 3 * 1024 * 1024) {
                await reader.cancel();
                break;
              }
              chunks.push(value);
            }
            return clipFromHtml(
              new TextDecoder().decode(Buffer.concat(chunks)),
              response.url || url.trim(),
            );
          } finally {
            clearTimeout(timer);
          }
        },
      );
      const folder = 'clips';
      let name =
        slug(clip.title.replace(/\./g, '-'))
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60) || 'clip';
      const taken = new Set(workspace.index.all(root.id).map((p) => p.path.toLowerCase()));
      for (let n = 2; taken.has(`${folder}/${name}.md`); n++)
        name = `${name.replace(/-\d+$/, '')}-${n}`;
      const uri = await workspace.createPage(
        root,
        `${folder}/${name}`,
        clipMarkdown(clip, planner.today(root)),
      );
      const page = workspace.index.byUri(uri.toString());
      if (page) await openPreferred(page);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Could not clip the page: ${error instanceof Error ? (error.name === 'AbortError' ? 'it took too long or was cancelled' : error.message) : String(error)}`,
      );
    }
  });
  // Blog posts live in blog/ (newest first on blog/index.md, created with the first post).
  command('newBlogPost', async (rootId?: string) => {
    const root = await chooseRoot(typeof rootId === 'string' ? rootId : activePage()?.root);
    if (!root) return;
    const title = await vscode.window.showInputBox({
      title: 'New blog post',
      prompt: 'The post title. It is saved in blog/ with today’s date.',
      validateInput: (v) => (v.trim() ? undefined : 'Type a title.'),
    });
    if (!title?.trim()) return;
    const date = planner.today(root);
    const name =
      slug(title.replace(/\./g, '-')).replace(/-+/g, '-').replace(/^-|-$/g, '') || 'post';
    try {
      if (!workspace.index.all(root.id).some((p) => p.path === 'blog/index.md'))
        await workspace.createPage(
          root,
          'blog/index',
          '# Blog\n\n```collection\nsource: pages\nfolder: blog\nview: posts\n```\n',
        );
      const uri = await workspace.createPage(
        root,
        `blog/${date}-${name}`,
        `---\ndate: ${date}\nauthors: []\ntags: []\n---\n\n# ${title.trim()}\n\n`,
      );
      const page = workspace.index.byUri(uri.toString());
      if (page) await openPreferred(page);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });
  // From the Command Palette both are asked; the tab's template gallery and template buttons
  // in pages pass the template (by name) and, from the gallery, the title.
  command('newFromTemplate', async (node?: PageNode, templateName?: string, title?: string) => {
    const active = activePage(node);
    const root = await chooseRoot(node?.root || active?.root);
    if (!root) return;
    const all = await listTemplates(workspace, root, (m) => log.appendLine(m));
    const template =
      typeof templateName === 'string'
        ? all.find((t) => t.label.toLocaleLowerCase() === templateName.toLocaleLowerCase())
        : await vscode.window.showQuickPick(all, { title: 'New page from template' });
    if (!template) {
      if (typeof templateName === 'string')
        void vscode.window.showWarningMessage(`There is no template named “${templateName}”.`);
      return;
    }
    const section =
      node?.prefix !== undefined
        ? node.prefix.replace(/\/$/, '')
        : active?.root === root.id
          ? posix.dirname(active.path).replace(/^\.$/, '')
          : '';
    const name =
      typeof title === 'string' && title.trim()
        ? `${section ? `${section}/` : ''}${title.trim().replace(/\//g, '-')}`
        : await vscode.window.showInputBox({
            title: `New ${template.label.toLowerCase()}`,
            value: section ? `${section}/` : '',
            prompt: 'Page title or section/title',
            validateInput: (value) => validateNamedPage(root, value),
          });
    if (!name) return;
    const problem = validateNamedPage(root, name);
    if (problem) {
      void vscode.window.showErrorMessage(problem);
      return;
    }
    await createNamedPage(root, name, template.body);
  });
  /** The date of the daily note in the active tab, if any. */
  const activeJournalDate = (): string | undefined => {
    const page = activeTabPage();
    if (!page) return undefined;
    const folder = planner.config(workspace.rootFor(page)).dailyFolder;
    return new RegExp(
      `^${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d{4}-\\d{2}-\\d{2})\\.md$`,
    ).exec(page.path)?.[1];
  };
  const openDaily = async (date: string, rootId?: string) => {
    const page = activeTabPage();
    const root = await chooseRoot(rootId || page?.root);
    if (!root) return;
    await openPreferredUri(await planner.ensureDaily(root, date));
  };
  command('dailyNote', async (date?: unknown) => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    await openDaily(typeof date === 'string' ? date : planner.today(root), root.id);
  });
  command('dailyNotePrevious', async () => {
    const current = activeJournalDate() || planner.today();
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    // Jump to the previous existing note; create yesterday's when there is none before.
    const earlier = [...planner.dailyNotes(root).keys()]
      .filter((d) => d < current)
      .sort()
      .at(-1);
    await openDaily(earlier || addDays(current, -1), root.id);
  });
  command('dailyNoteNext', async () => {
    const current = activeJournalDate() || planner.today();
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const later = [...planner.dailyNotes(root).keys()].filter((d) => d > current).sort()[0];
    await openDaily(later || addDays(current, 1), root.id);
  });
  command('dailyNoteForDate', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const today = planner.today(root);
    const value = await vscode.window.showInputBox({
      title: 'Open daily note',
      prompt: 'A date (YYYY-MM-DD) or today, yesterday, tomorrow, mon…sun, +3d, -2d',
      value: today,
      validateInput: (v) =>
        resolveJournalDate(v, today) ? undefined : 'Use a date such as 2026-10-14.',
    });
    if (value) await openDaily(resolveJournalDate(value, today)!, root.id);
  });
  const apiStore = new ApiStore(context);
  const apiClient = new ApiClientPanel(context, apiStore);
  context.subscriptions.push(apiStore, apiClient);
  httpBlocks = new HttpBlocks(apiStore, apiClient, context.workspaceState);
  panels.http = httpBlocks;
  plannerPanel.http = httpBlocks;
  // The API Client is a destination of the workspace panel, with its navigation and history.
  plannerPanel.api = apiClient;
  apiClient.host = {
    reveal: () => plannerPanel.show('api'),
    post: (message) => plannerPanel.postApi(message),
  };
  command('apiClient', () => apiClient.show());
  command('apiNewRequest', () =>
    apiClient.show({ request: { ...emptyApiRequest('new', 'New request') } }),
  );
  command('apiImportCurl', async () => {
    // From the clipboard when it holds a curl command, otherwise from an input box.
    const clip = (await vscode.env.clipboard.readText()).trim();
    const text = /^(\$\s+)?curl(\.exe)?\s/i.test(clip)
      ? clip
      : await vscode.window.showInputBox({
          title: 'Import curl',
          prompt: 'Paste a curl command',
          ignoreFocusOut: true,
        });
    if (!text) return;
    const { request, warnings } = parseCurl(text);
    await apiClient.show({ request });
    for (const w of warnings) void vscode.window.showWarningMessage(`curl import: ${w}`);
  });
  command('apiImportOpenApi', async (target?: unknown) => {
    await apiClient.show();
    await apiClient.importFile(target instanceof vscode.Uri ? target : undefined);
  });
  command('kanban', () => plannerPanel.show('board'));
  command('boards', () => plannerPanel.show('boards'));
  command('tasks', () => plannerPanel.show('tasks'));
  command('calendar', () => plannerPanel.show('calendar'));
  command('insights', () => plannerPanel.show('insights'));
  command('openBoard', async (id?: unknown) => {
    const root = plannerPanel.root();
    const boards = plannerPanel.boards.boards(root?.id).filter((b) => !b.archived);
    let boardId = typeof id === 'string' ? id : undefined;
    if (!boardId) {
      const picked = await vscode.window.showQuickPick(
        [
          ...boards.map((b) => ({ label: b.name, description: b.pagePath, id: b.id })),
          { label: 'Status board', description: 'Every task by status', id: STATUS_BOARD },
          { label: '$(add) New board…', description: '', id: '__new' },
        ],
        { title: 'Open Board' },
      );
      if (!picked) return;
      boardId = picked.id;
    }
    if (boardId === '__new') return vscode.commands.executeCommand('notespace.newBoard');
    plannerPanel.show('board', boardId);
  });
  command('newBoard', async () => {
    const root = await chooseRoot(plannerPanel.root()?.id);
    if (!root) return;
    const name = await vscode.window.showInputBox({
      title: 'New Board',
      prompt: 'Board name',
      placeHolder: 'Product roadmap',
      validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
    });
    if (!name) return;
    const folder = vscode.workspace
      .getConfiguration('notespace', root.folder.uri)
      .get<string>('boards.folder', 'boards');
    const path = await vscode.window.showInputBox({
      title: 'New Board',
      prompt: 'Markdown file for the board (cards created on it are written there)',
      value: boardFileName(name, folder),
      validateInput: (v) => (/\.md$/i.test(v.trim()) ? undefined : 'Use a .md file.'),
    });
    if (!path) return;
    const template = await vscode.window.showQuickPick(
      boardTemplates.map((t) => ({
        label: t.label,
        description: t.columns.map((c) => c.title).join(' → '),
        id: t.id,
      })),
      { title: 'Starting columns' },
    );
    if (!template) return;
    const board = await plannerPanel.boards.create(root, { name, path, template: template.id });
    plannerPanel.show('board', board.id);
  });
  command('addTaskToBoard', async () => {
    // The task on the cursor line of the active editor joins a board; the line stays in place.
    const editor = vscode.window.activeTextEditor;
    const page = editor && workspace.index.byUri(editor.document.uri.toString());
    if (!editor || !page) throw new Error('Put the cursor on a task line in a wiki page.');
    const line = editor.selection.active.line;
    const task = planner.tasks(page.root).find((t) => t.pageId === page.id && t.line === line);
    if (!task) throw new Error('The cursor is not on a task line (- [ ] …).');
    const boards = plannerPanel.boards.boards(page.root).filter((b) => !b.archived);
    if (!boards.length) throw new Error('Create a board first (NoteSpace: New Board).');
    const picked = await vscode.window.showQuickPick(
      boards.map((b) => ({ label: b.name, description: b.pagePath, id: b.id })),
      { title: `Add “${task.title}” to board` },
    );
    if (picked) await plannerPanel.boards.assign(task.key, picked.id);
  });
  command('openWikiHome', async (rootId?: unknown) => {
    // The wiki's real homepage document (never a generated copy).
    const root = await chooseRoot(typeof rootId === 'string' ? rootId : plannerPanel.root()?.id);
    if (!root) return;
    const home = panels.homepageOf(root);
    if (home) return openPreferred(home);
    const file = root.config?.content.homepage || 'index.md';
    const choice = await vscode.window.showInformationMessage(
      `${root.name} has no homepage (${file}) yet.`,
      'Create Homepage',
    );
    if (choice)
      await openPreferredUri(
        await workspace.createPage(root, file, `# ${root.config?.wiki.title || root.name}\n\n`),
      );
  });
  command('newNote', async () => {
    const root = await chooseRoot(activeTabPage()?.root || plannerPanel.root()?.id);
    if (!root) return;
    const folder = vscode.workspace
      .getConfiguration('notespace', root.folder.uri)
      .get<string>('notes.folder', 'notes')
      .replace(/^\/+|\/+$/g, '');
    const title = await vscode.window.showInputBox({
      title: 'New Note',
      prompt: `Note title (saved in ${folder || 'the wiki root'}/)`,
      validateInput: (v) => (v.trim() ? undefined : 'Enter a title.'),
    });
    if (!title) return;
    const name = title.trim().replace(/[\\/:*?"<>|#%[\]]+/g, '-');
    await openPreferredUri(
      await workspace.createPage(
        root,
        folder ? `${folder}/${name}` : name,
        `# ${title.trim()}\n\n`,
      ),
    );
  });
  command('planner', (view?: unknown) =>
    plannerPanel.show(plannerViews.includes(view as PlannerView) ? (view as PlannerView) : 'tasks'),
  );
  const notebookUri = (node?: unknown): vscode.Uri | undefined => {
    if (node instanceof vscode.Uri) return node;
    if (
      node &&
      typeof node === 'object' &&
      'uri' in node &&
      (node as { uri?: unknown }).uri instanceof vscode.Uri
    )
      return (node as { uri: vscode.Uri }).uri;
    const active = vscode.window.activeNotebookEditor?.notebook.uri;
    return active && /\.ipynb$/i.test(active.path) ? active : undefined;
  };
  command('openNotebook', async (node?: unknown) => {
    const uri = notebookUri(node);
    if (!uri) throw new Error('Choose a notebook in the Wiki.');
    // VS Code's notebook editor provides cell editing, saved outputs and kernels.
    await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook');
  });
  command('notebookPreview', async (node?: unknown) => {
    const uri = notebookUri(node);
    if (!uri) throw new Error('Open or select a notebook first.');
    await showNotebookPreview(uri, context.extensionUri);
  });
  command('notebookToMarkdown', async (node?: unknown) => {
    const uri = notebookUri(node);
    if (!uri) throw new Error('Open or select a notebook first.');
    const root = workspace.roots.find((r) =>
      uriPath(uri).startsWith(uriPath(r.uri).replace(/\/$/, '') + '/'),
    );
    if (!root) throw new Error('The notebook is not inside a wiki.');
    await openPreferredUri(await convertNotebook(workspace, root, uri));
  });
  command('newCanvas', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const name = await vscode.window.showInputBox({
      title: 'New canvas',
      value: 'Overview',
      validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
    });
    if (!name) return;
    const uri = await newCanvas(workspace, root.id, name);
    await canvases.refresh();
    await vscode.commands.executeCommand('vscode.openWith', uri, CanvasEditorProvider.viewType);
  });
  const pageFrom = (target?: unknown): Page | undefined =>
    target instanceof vscode.Uri
      ? workspace.index.byUri(target.toString())
      : target && typeof target === 'object' && 'page' in target
        ? (target as { page: Page }).page
        : activeTabPage();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      GitContentProvider.scheme,
      new GitContentProvider(),
    ),
  );
  command('pageHistory', async (target?: unknown) => {
    const page = pageFrom(target);
    if (!page) throw new Error('Open a wiki page to see its history.');
    await showPageHistory(vscode.Uri.parse(page.uri), page.title);
  });
  const pickRef = async (root: WikiRoot, title: string): Promise<string | undefined> => {
    const repo = await repositoryOfFolder(root.uri);
    if (!repo) throw new Error('This wiki is not inside a Git repository.');
    const refs = await listRefs(repo);
    if (!refs.length) throw new Error('This repository has no tags or branches yet.');
    const picked = await vscode.window.showQuickPick(
      [
        ...refs
          .filter((r) => r.kind === 'tag')
          .map((r) => ({ label: `$(tag) ${r.name}`, description: r.date, ref: r.name })),
        ...refs
          .filter((r) => r.kind === 'branch')
          .map((r) => ({ label: `$(git-branch) ${r.name}`, description: r.date, ref: r.name })),
      ],
      { title, placeHolder: 'Read-only: nothing is checked out', matchOnDescription: true },
    );
    return picked?.ref;
  };
  command('browseGitVersion', async (refArg?: unknown) => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const ref =
      typeof refArg === 'string' ? refArg : await pickRef(root, 'Browse Wiki at Git Tag or Branch');
    if (ref) await browseGitVersion(workspace, root, ref);
  });
  command('compareWithGitVersion', async (target?: unknown, refArg?: unknown) => {
    const page = pageFrom(target);
    if (!page) throw new Error('Open a wiki page to compare it with a tag or branch.');
    const root = workspace.rootFor(page);
    const ref =
      typeof refArg === 'string' ? refArg : await pickRef(root, `Compare “${page.title}” with`);
    if (!ref) return;
    const repo = (await repositoryOfFolder(root.uri))!;
    const file = vscode.Uri.parse(page.uri);
    const relative = await repoRelative(repo, file.fsPath);
    const sha = (
      await gitRead(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).catch(() => '')
    ).trim();
    if (!/^[0-9a-f]{40}$/.test(sha) || !/^(?!-)[\w][\w./@+-]{0,199}$/.test(ref))
      throw new Error(`${ref} does not name a commit.`);
    try {
      await gitRead(['show', `${sha}:${relative}`], repo);
    } catch {
      void vscode.window.showInformationMessage(
        `“${page.title}” does not exist in ${ref} (${relative}).`,
      );
      return;
    }
    await vscode.commands.executeCommand(
      'vscode.diff',
      GitContentProvider.uri(repo, sha, relative),
      file,
      `${posix.basename(relative)} (${ref} ↔ working tree)`,
    );
  });
  const review = new ReviewController(workspace);
  context.subscriptions.push(review);
  review.register(command);
  command('importObsidian', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('Open a workspace folder first.');
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      title: 'Choose the Obsidian vault to import (it is only read)',
    });
    const vault = picked?.[0];
    if (!vault) return;
    const plan = await planObsidianImport(vault);
    const name = await vscode.window.showInputBox({
      title: 'Import Obsidian vault',
      prompt: `New wiki folder inside ${folder.name}. The vault is not modified.`,
      value: `${posix.basename(vault.path)}-wiki`,
      validateInput: (v) =>
        /^[\p{L}\p{N} ._-]+$/u.test(v.trim())
          ? undefined
          : 'Use letters, digits, spaces, dots, dashes or underscores.',
    });
    if (!name) return;
    const target = vscode.Uri.joinPath(folder.uri, name.trim());
    // Preview: the full conversion report, before anything is written.
    const preview = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: importReport(plan, vault.fsPath, target.fsPath),
    });
    await vscode.window.showTextDocument(preview, { preview: true });
    const ok = await vscode.window.showInformationMessage(
      `Import ${plan.notes.length} pages and ${plan.attachments.length} attachments into ${name.trim()}?`,
      {
        modal: true,
        detail: `${plan.warnings.length} warning(s) are listed in the preview. The vault is only read; a new wiki folder is created.`,
      },
      'Import',
    );
    if (ok !== 'Import') return;
    const result = await importObsidianVault(workspace, vault, target, plan);
    await vscode.window.showTextDocument(result.report);
    void vscode.window.showInformationMessage(
      `Imported ${result.pages} pages and ${result.attachments} attachments.`,
    );
  });
  command('copyMcpConfig', async () => {
    if (!vscode.workspace.isTrusted)
      throw new Error('The MCP server configuration is available in trusted workspaces only.');
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const access = await vscode.window.showQuickPick(
      [
        { label: 'Read only', description: 'list, read, search pages and backlinks', write: false },
        {
          label: 'Read and write',
          description: 'also create pages and update pages the client has read',
          write: true,
        },
      ],
      { title: 'MCP server access for this wiki' },
    );
    if (!access) return;
    if (access.write) {
      const ok = await vscode.window.showWarningMessage(
        'Allow MCP clients to write pages in this wiki?',
        {
          modal: true,
          detail:
            'Writes are limited to Markdown pages inside the content root and refuse stale overwrites. Review changes with Git or Page History.',
        },
        'Allow Writing',
      );
      if (ok !== 'Allow Writing') return;
    }
    const server = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-server.js').fsPath;
    const wikiPath = (root.projectUri || root.uri).fsPath;
    const args = [server, '--wiki', wikiPath, ...(access.write ? ['--allow-write'] : [])];
    const name = `notespace-${
      (root.config?.wiki.title || root.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'wiki'
    }`;
    const text = JSON.stringify({ mcpServers: { [name]: { command: 'node', args } } }, null, 2);
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(
      `MCP server configuration for “${root.name}” copied. Paste it into your MCP client's settings; it runs with Node.js 20+ over stdio and opens no network port.`,
    );
  });
  const proposals = new AiProposals();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(AiProposals.scheme, proposals),
  );
  const pageDocument = async (target?: unknown) => {
    const page = pageFrom(target);
    if (!page) throw new Error('Open a wiki page first.');
    const uri = vscode.Uri.parse(page.uri);
    return { page, document: await vscode.workspace.openTextDocument(uri) };
  };
  command('ai.improve', async (target?: unknown) => {
    const { page, document } = await pageDocument(target);
    const editor =
      vscode.window.activeTextEditor?.document === document
        ? vscode.window.activeTextEditor
        : undefined;
    const range =
      editor && !editor.selection.isEmpty
        ? new vscode.Range(editor.selection.start, editor.selection.end)
        : undefined;
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: 'Fix grammar and clarity',
          instruction: 'Fix grammar, spelling and unclear sentences.',
        },
        {
          label: 'Make it more concise',
          instruction: 'Make the text more concise without dropping information.',
        },
        {
          label: 'Improve structure',
          instruction: 'Improve headings, lists and paragraph structure for scanning.',
        },
        { label: 'Custom instruction…', instruction: '' },
      ],
      { title: `Improve ${range ? 'the selection' : `“${page.title}”`} with AI` },
    );
    if (!pick) return;
    const instruction =
      pick.instruction ||
      (await vscode.window.showInputBox({
        title: 'Instruction for the AI',
        placeHolder: 'Explain the setup steps for Windows users',
      }));
    if (!instruction) return;
    const original = document.getText(range);
    const answer = await ask(
      context,
      range ? 'the selected text' : `the page “${page.title}”`,
      prompts.improve(instruction),
      original,
    );
    if (answer === undefined) return;
    await proposals.propose(
      { target: document.uri, version: document.version, original, text: unwrap(answer), range },
      page.title,
    );
  });
  command('ai.translate', async (target?: unknown, language?: unknown) => {
    const page = pageFrom(target);
    if (!page) throw new Error('Open the page to translate.');
    const root = workspace.rootFor(page);
    const scope = scopeOf(page.path, root.config);
    let code = typeof language === 'string' ? language : scope.language;
    if (!code) {
      if (!root.config?.i18n.languages.length)
        throw new Error('Add a language first (NoteSpace: Add Language).');
      code = await vscode.window.showQuickPick(root.config.i18n.languages, {
        title: `Translate “${page.title}” into`,
      });
      if (!code) return;
    }
    const sourcePath = scopedPath(scope.logical, scope.version);
    const source = workspace.index.all(root.id).find((p) => p.path === sourcePath);
    if (!source) throw new Error('The source page of this translation was not found.');
    const targetPath = scopedPath(scope.logical, scope.version, code);
    const existing = workspace.index.all(root.id).find((p) => p.path === targetPath);
    const answer = await ask(
      context,
      `the page “${source.title}”`,
      prompts.translate(code),
      source.text,
    );
    if (answer === undefined) return;
    const { contentHash } = await import('./core/scopes');
    const text = withFrontMatter(unwrap(answer), { translated_from: contentHash(source.body) });
    if (existing) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(existing.uri));
      await proposals.propose(
        { target: document.uri, version: document.version, original: document.getText(), text },
        existing.title,
      );
    } else
      await proposals.propose(
        {
          target: vscode.Uri.joinPath(root.uri, targetPath),
          version: 0,
          original: '',
          text,
          create: true,
        },
        `${source.title} (${code})`,
      );
  });
  command('ai.docsFromCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId === 'markdown')
      throw new Error('Open a source code file to document.');
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const name = posix.basename(editor.document.uri.path).replace(/\.[^.]+$/, '');
    const path = await vscode.window.showInputBox({
      title: 'New documentation page',
      value: `reference/${name}.md`,
      validateInput: (v) => (/\.md$/i.test(v.trim()) ? undefined : 'End the path with .md'),
    });
    if (!path) return;
    const code = editor.selection.isEmpty
      ? editor.document.getText()
      : editor.document.getText(editor.selection);
    const answer = await ask(
      context,
      `${posix.basename(editor.document.uri.path)}${editor.selection.isEmpty ? '' : ' (selection)'}`,
      prompts.docsFromCode(editor.document.languageId),
      code,
    );
    if (answer === undefined) return;
    await proposals.propose(
      {
        target: vscode.Uri.joinPath(root.uri, path.trim()),
        version: 0,
        original: '',
        text: unwrap(answer),
        create: true,
      },
      path.trim(),
    );
  });
  command('ai.review', async (target?: unknown) => {
    const { page, document } = await pageDocument(target);
    const answer = await ask(
      context,
      `the page “${page.title}”`,
      prompts.review(),
      document.getText(),
    );
    if (answer === undefined) return;
    const report = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: `# AI review: ${page.title}\n\n_Suggestions only. Nothing was changed._\n\n${answer.trim()}\n`,
    });
    await vscode.window.showTextDocument(report, { viewColumn: vscode.ViewColumn.Beside });
  });
  const proposalUri = (target?: unknown) => {
    if (target instanceof vscode.Uri && target.scheme === AiProposals.scheme) return target;
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active?.scheme === AiProposals.scheme) return active;
    throw new Error('Open an AI proposal first.');
  };
  command('ai.apply', async (target?: unknown) => {
    const uri = proposalUri(target);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const applied = await proposals.apply(uri, workspace);
    await vscode.window.showTextDocument(applied);
    vscode.window.setStatusBarMessage(
      '$(check) AI proposal applied and saved — Undo reverts it',
      4000,
    );
  });
  command('ai.discard', async (target?: unknown) => {
    proposals.discard(proposalUri(target));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
  command('ai.setEndpointKey', async () => {
    const key = await vscode.window.showInputBox({
      title: 'API key for the AI endpoint (stored in VS Code secret storage)',
      password: true,
      ignoreFocusOut: true,
      prompt: 'Leave empty to remove the stored key.',
    });
    if (key === undefined) return;
    if (key) await context.secrets.store(ENDPOINT_SECRET, key);
    else await context.secrets.delete(ENDPOINT_SECRET);
  });
  const semantic = new SemanticSearch(context, workspace);
  command('semanticSearch', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root || !(await semantic.authorized())) return;
    const query = await vscode.window.showInputBox({
      title: 'Semantic search',
      prompt: 'Describe what you are looking for in your own words',
    });
    if (!query) return;
    const hits = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Semantic search',
        cancellable: true,
      },
      async (progress, token) => {
        await semantic.update(
          root,
          (done, total) => progress.report({ message: `Indexing ${done}/${total} sections` }),
          token,
        );
        progress.report({ message: 'Searching…' });
        return semantic.query(root, query, 20, token);
      },
    );
    const picked = await vscode.window.showQuickPick(
      hits.map((h) => ({
        label: h.page.title,
        description: `${(h.score * 100).toFixed(0)}% · ${h.page.path}${h.heading && h.heading.level > 1 ? ` › ${h.heading.text}` : ''}`,
        detail: h.text.split('\n').slice(1).join(' ').trim().slice(0, 160),
        hit: h,
      })),
      { title: `Pages related to “${query}”`, matchOnDescription: true },
    );
    if (picked)
      await showPage(
        picked.hit.page.uri,
        picked.hit.heading && picked.hit.heading.level > 1 ? picked.hit.heading.offset : undefined,
      );
  });
  command('exportPdf', async (target?: unknown) => {
    const active = pageFrom(target);
    const root = active ? workspace.rootFor(active) : await chooseRoot();
    if (!root) return;
    const folder =
      active && posix.dirname(active.path) !== '.' ? posix.dirname(active.path) : undefined;
    const scope = await vscode.window.showQuickPick(
      [
        ...(active
          ? [
              {
                label: `This page: ${active.title}`,
                include: (p: Page) => p.id === active.id,
                name: active.title,
              },
            ]
          : []),
        ...(folder
          ? [
              {
                label: `This section: ${folder}/`,
                include: (p: Page) => p.path.startsWith(`${folder}/`),
                name: folder,
              },
            ]
          : []),
        {
          label: `Whole wiki: ${root.config?.wiki.title || root.name}`,
          include: (p: Page) => !workspace.index.scope?.(p),
          name: root.config?.wiki.title || root.name,
        },
      ],
      { title: 'Export PDF' },
    );
    if (!scope) return;
    const output = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(
        root.projectUri || root.uri,
        `${scope.name.replace(/[^\p{L}\p{N} ._-]+/gu, '-')}.pdf`,
      ),
      filters: { PDF: ['pdf'] },
      title: 'Save PDF',
    });
    if (!output) return;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Exporting PDF…' },
      () => exportPdf(workspace, root, output, scope.include, scope.name, planner),
    );
    if (result.pdf) {
      const open = await vscode.window.showInformationMessage(
        `PDF with ${result.pages} page(s) saved${result.warnings.length ? ` (${result.warnings.length} warning(s) in the log)` : ''}.`,
        'Open',
      );
      result.warnings.forEach((w) => log.appendLine(`[pdf] ${w}`));
      if (open) await vscode.env.openExternal(output);
    } else if (result.printHtml) {
      const open = await vscode.window.showWarningMessage(
        'No Chrome, Edge, Chromium or Brave browser was found to create the PDF. A print-ready page was saved instead: open it and choose Print → Save as PDF, or set notespace.export.browserPath.',
        'Open Print Page',
      );
      if (open) await vscode.env.openExternal(result.printHtml);
    }
  });
  command('exportEpub', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const output = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(
        root.projectUri || root.uri,
        `${(root.config?.wiki.title || root.name).replace(/[^\p{L}\p{N} ._-]+/gu, '-')}.epub`,
      ),
      filters: { EPUB: ['epub'] },
      title: 'Save EPUB',
    });
    if (!output) return;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Exporting EPUB…' },
      () => exportEpub(workspace, root, output, planner),
    );
    result.warnings.forEach((w) => log.appendLine(`[epub] ${w}`));
    void vscode.window.showInformationMessage(
      `EPUB with ${result.pages} chapter(s) saved.${result.fallbacks ? ` ${result.fallbacks} audio/video element(s) are shown as text.` : ''}`,
    );
  });
  context.subscriptions.push(
    sharedDashboards,
    vscode.window.registerCustomEditorProvider(
      DashboardEditorProvider.viewType,
      new DashboardEditorProvider(context.extensionUri, sharedDashboards),
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );
  registerCodeReferences(context, workspace);
  command('openCodeRef', async (pageUri?: unknown, target?: unknown) => {
    const page = typeof pageUri === 'string' ? workspace.index.byUri(pageUri) : undefined;
    if (!page || typeof target !== 'string') return;
    await openCodeRef(page, target);
  });
  command('insertCodeReference', async () => {
    const editor = vscode.window.activeTextEditor;
    const page = editor && workspace.index.byUri(editor.document.uri.toString());
    if (!editor || !page)
      throw new Error('Open a wiki page in Code mode to insert a code reference.');
    const query = await vscode.window.showInputBox({
      title: 'Insert code reference',
      prompt: 'Symbol name to search in the workspace (function, class, method…)',
    });
    if (!query) return;
    const symbols =
      (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        query,
      )) || [];
    if (!symbols.length)
      throw new Error(
        `No symbol matches “${query}”. Symbol search needs the language's extension; you can also link a file directly, for example [name](../src/file.ts#name).`,
      );
    const picked = await vscode.window.showQuickPick(
      symbols.slice(0, 200).map((s) => ({
        label: s.name,
        description: `${s.containerName ? `${s.containerName} · ` : ''}${vscode.workspace.asRelativePath(s.location.uri)}`,
        symbol: s,
      })),
      { title: 'Choose the symbol', matchOnDescription: true },
    );
    if (!picked) return;
    const s = picked.symbol;
    const relative = posix.relative(
      posix.dirname(uriPath(editor.document.uri)),
      uriPath(s.location.uri),
    );
    const fragment =
      s.containerName &&
      /^[\w$]+$/.test(s.containerName) &&
      ![vscode.SymbolKind.File, vscode.SymbolKind.Module, vscode.SymbolKind.Namespace].includes(
        s.kind,
      )
        ? `${s.containerName}.${s.name}`
        : s.name;
    const label = editor.document.getText(editor.selection) || s.name;
    await editor.edit((edit) =>
      edit.replace(
        editor.selection,
        `[${label}](${encodeURI(relative)}#${fragment.replace(/\(.*$/, '')})`,
      ),
    );
  });
  command('showDocsForFile', async () => {
    const file = vscode.window.activeTextEditor?.document.uri;
    if (!file) throw new Error('Open a source file first.');
    const refs = pagesReferencing(workspace, file);
    if (!refs.length)
      return void vscode.window.showInformationMessage(
        `No wiki page references ${posix.basename(file.path)} yet.`,
      );
    const picked = await vscode.window.showQuickPick(
      refs.map((r) => ({
        label: r.page.title,
        description: `${r.page.path} → ${r.target}`,
        page: r.page,
      })),
      { title: `Documentation for ${posix.basename(file.path)}` },
    );
    if (picked) await openPreferred(picked.page);
  });
  command('newDashboard', async (target?: unknown) => {
    let data =
      target instanceof vscode.Uri && /\.(csv|tsv|xlsx|json|jsonl|ndjson)$/i.test(target.path)
        ? target
        : undefined;
    if (!data) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Data files': ['csv', 'tsv', 'xlsx', 'json', 'jsonl', 'ndjson'] },
        title: 'Choose the data file for the new dashboard (it is only read)',
        openLabel: 'Use this data',
      });
      data = picked?.[0];
      if (!data) return;
    }
    if (!vscode.workspace.getWorkspaceFolder(data))
      throw new Error('Choose a data file inside an open workspace folder.');
    const title = await vscode.window.showInputBox({
      title: 'New dashboard',
      value: `${posix.basename(data.path).replace(/\.[^.]+$/, '')} dashboard`,
    });
    if (!title) return;
    const uri = await newDashboard(vscode.Uri.joinPath(data, '..'), data, title);
    await vscode.commands.executeCommand('vscode.openWith', uri, DashboardEditorProvider.viewType);
  });
  command('themeBuilder', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (root) openThemeBuilder(workspace, root);
  });
  command('contentHealth', () => plannerPanel.show('health'));
  command('addLanguage', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const code = await vscode.window.showInputBox({
      title: 'Add language',
      prompt: `Translations are stored in a folder named after the language code, next to the ${root.config?.wiki.language || 'default'} pages.`,
      placeHolder: 'it, de, pt-BR',
      validateInput: (v) =>
        /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(v.trim())
          ? v.trim() === root.config?.wiki.language
            ? 'This is already the default language.'
            : undefined
          : 'Use a language code such as it, de or pt-BR.',
    });
    if (!code) return;
    await addLanguage(workspace, root, code.trim());
    void vscode.window.showInformationMessage(
      `Added ${code.trim()}. Create translations from a page's menu or the Content Health report.`,
    );
  });
  command('createTranslation', async (target?: unknown, language?: unknown) => {
    const page = pageFrom(target);
    if (!page) throw new Error('Open the page to translate.');
    const root = workspace.rootFor(page);
    let code = typeof language === 'string' ? language : undefined;
    if (!code) {
      const languages = root.config?.i18n.languages || [];
      if (!languages.length) {
        const add = await vscode.window.showInformationMessage(
          'This wiki has no other languages yet.',
          'Add Language…',
        );
        if (add) await vscode.commands.executeCommand('notespace.addLanguage');
        return;
      }
      code =
        (await vscode.window.showQuickPick(languages, {
          title: `Translate “${page.title}” into`,
        })) || undefined;
      if (!code) return;
    }
    await openPreferredUri(await createTranslation(workspace, page, code));
  });
  command('markTranslationCurrent', async (target?: unknown) => {
    const page = pageFrom(target);
    if (!page) throw new Error('Open the translated page.');
    await markTranslationCurrent(workspace, page);
    vscode.window.setStatusBarMessage('$(check) Translation marked as up to date', 2500);
  });
  command('archiveVersion', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    if (!root.config) throw new Error('Versions need a wiki with a wiki.yaml file.');
    const id = await vscode.window.showInputBox({
      title: 'Archive current version (1/2)',
      prompt: 'Version id for the snapshot of the current docs',
      value: root.config.versions.current || '1.0',
      validateInput: (v) =>
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(v)
          ? 'Use letters, digits, dots, dashes or underscores.'
          : root.config!.versions.archived.includes(v)
            ? 'This version is already archived.'
            : undefined,
    });
    if (!id) return;
    const next = await vscode.window.showInputBox({
      title: 'Archive current version (2/2)',
      prompt: 'Label for the docs you keep editing (optional, for example 2.0)',
      value: '',
    });
    if (next === undefined) return;
    const ok = await vscode.window.showWarningMessage(
      `Copy the current docs to _versions/${id}/?`,
      {
        modal: true,
        detail:
          'Pages, images and other files under the content root are copied. Nothing is moved or deleted, and wiki.yaml lists the new version.',
      },
      'Archive',
    );
    if (ok !== 'Archive') return;
    await archiveVersion(workspace, root, id, next.trim() || undefined);
    void vscode.window.showInformationMessage(
      `Archived version ${id}. The reader and the static site show a version switcher.`,
    );
  });
  const pickApiDescription = async (
    target: unknown,
    title: string,
  ): Promise<vscode.Uri | undefined> => {
    let uri = target instanceof vscode.Uri ? target : undefined;
    const active = vscode.window.activeTextEditor?.document;
    if (
      !uri &&
      active &&
      /\.(ya?ml|json)$/i.test(active.uri.path) &&
      looksLikeOpenApi(active.getText())
    )
      uri = active.uri;
    if (uri) return uri;
    const found = await findApiDescriptions(workspace);
    if (!found.length)
      throw new Error('No OpenAPI 3 description (YAML or JSON) was found in the open wikis.');
    const picked = await vscode.window.showQuickPick(
      found.map((u) => ({
        label: posix.basename(u.path),
        description: vscode.workspace.asRelativePath(u),
        uri: u,
      })),
      { title },
    );
    return picked?.uri;
  };
  command('generateApiReference', async (target?: unknown) => {
    const specUri = await pickApiDescription(target, 'Generate API Reference Pages');
    if (!specUri) return;
    const owner =
      workspace.roots.find((r) =>
        uriPath(specUri).startsWith(uriPath(r.projectUri || r.uri).replace(/\/$/, '') + '/'),
      ) || (await chooseRoot(activeTabPage()?.root));
    if (!owner) return;
    const name = posix
      .basename(specUri.path)
      .replace(/\.(ya?ml|json)$/i, '')
      .replace(/[^\w-]+/g, '-');
    // Regenerating defaults to where the pages were generated before.
    const previous = workspace.index.all(owner.id).find((p) => {
      const part = findGenerated(p.text);
      return (
        part &&
        vscode.Uri.joinPath(vscode.Uri.parse(p.uri), '..', part.source).path === specUri.path
      );
    });
    const folderName = await vscode.window.showInputBox({
      title: 'Generate API Reference Pages',
      prompt: `Folder inside ${owner.name} for the generated pages. Existing pages keep everything outside their generated section.`,
      value: previous ? posix.dirname(previous.path) : `api/${name}`,
      validateInput: (v) => {
        try {
          safeRelative(v, false);
          return undefined;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      },
    });
    if (!folderName) return;
    const folder = vscode.Uri.joinPath(owner.uri, safeRelative(folderName));
    const summary = await generateApiReference(
      workspace,
      specUri,
      folder,
      async (file, replacement) => {
        for (;;) {
          const choice = await vscode.window.showWarningMessage(
            `${vscode.workspace.asRelativePath(file)} was edited inside its generated section.`,
            {
              modal: true,
              detail:
                'Replacing it applies the current API description and discards those edits. Keeping it leaves the page as it is; text outside the generated section is never changed.',
            },
            'Replace Generated Section',
            'Keep My Edits',
            'Compare',
          );
          if (choice === 'Replace Generated Section') return 'replace';
          if (choice !== 'Compare') return 'keep';
          const proposed = await vscode.workspace.openTextDocument({
            content: replacement,
            language: 'markdown',
          });
          await vscode.commands.executeCommand(
            'vscode.diff',
            file,
            proposed.uri,
            `${posix.basename(file.path)} ↔ regenerated`,
          );
        }
      },
    );
    const parts = [
      summary.created.length && `${summary.created.length} created`,
      summary.updated.length && `${summary.updated.length} updated`,
      summary.unchanged.length && `${summary.unchanged.length} unchanged`,
      summary.kept.length && `${summary.kept.length} kept with your edits`,
      summary.skipped.length &&
        `${summary.skipped.length} skipped (not generated: ${summary.skipped.join(', ')})`,
    ].filter(Boolean);
    const index = workspace.index.byUri(vscode.Uri.joinPath(folder, 'index.md').toString());
    const open = await vscode.window.showInformationMessage(
      `API reference: ${parts.join(', ')}.`,
      ...(index ? ['Open'] : []),
    );
    if (open && index) await openPreferred(index);
  });
  // API descriptions are not pages: watch them to refresh views and flag outdated pages.
  const apiTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const apiWatcher = vscode.workspace.createFileSystemWatcher('**/*.{yaml,yml,json}');
  const apiChanged = (uri: vscode.Uri) => {
    if (
      !workspace.roots.some((r) =>
        uriPath(uri).startsWith(uriPath(r.projectUri || r.uri).replace(/\/$/, '') + '/'),
      )
    )
      return;
    clearTimeout(apiTimers.get(uri.toString()));
    apiTimers.set(
      uri.toString(),
      setTimeout(async () => {
        apiTimers.delete(uri.toString());
        try {
          const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          if (!looksLikeOpenApi(text)) return;
          await refreshPlayground(uri);
          panels.refreshEmbeds();
          const stale = await staleGeneratedPages(workspace, uri);
          if (!stale.length) return;
          const choice = await vscode.window.showInformationMessage(
            `${posix.basename(uriPath(uri))} changed: ${stale.length} generated reference page${stale.length === 1 ? ' is' : 's are'} out of date.`,
            'Regenerate…',
          );
          if (choice) await vscode.commands.executeCommand('notespace.generateApiReference', uri);
        } catch (e) {
          log.appendLine(`[openapi] ${uri.path}: ${String(e)}`);
        }
      }, 700),
    );
  };
  context.subscriptions.push(
    apiWatcher,
    apiWatcher.onDidChange(apiChanged),
    apiWatcher.onDidCreate(apiChanged),
  );
  command('openApiPlayground', async (target?: unknown) => {
    let uri = target instanceof vscode.Uri ? target : undefined;
    const active = vscode.window.activeTextEditor?.document;
    if (
      !uri &&
      active &&
      /\.(ya?ml|json)$/i.test(active.uri.path) &&
      looksLikeOpenApi(active.getText())
    )
      uri = active.uri;
    if (!uri) {
      const found = await findApiDescriptions(workspace);
      if (!found.length)
        throw new Error('No OpenAPI 3 description (YAML or JSON) was found in the open wikis.');
      const picked = await vscode.window.showQuickPick(
        found.map((u) => ({
          label: posix.basename(u.path),
          description: vscode.workspace.asRelativePath(u),
          uri: u,
        })),
        { title: 'Open API Playground' },
      );
      uri = picked?.uri;
    }
    if (uri) await openApiPlayground(context, uri);
  });
  command('importNotebook', async () => {
    const root = await chooseRoot(activeTabPage()?.root);
    if (!root) return;
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: { 'Jupyter notebooks': ['ipynb'] },
      title: 'Import Jupyter notebook into the wiki',
    });
    if (!picked?.[0]) return;
    const uri = await importNotebook(workspace, root, picked[0]);
    await notebooks.refresh();
    await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook');
  });
  command('addTask', async () => {
    const page = activeTabPage();
    const root = await chooseRoot(page?.root);
    if (!root) return;
    const text = await vscode.window.showInputBox({
      title: 'Add task',
      prompt: `Saved to ${planner.config(root).inbox}. Optional: due:tomorrow start:fri priority:high repeat:weekly project:Name @person #tag`,
      placeHolder: 'Call Bob due:tomorrow #sales',
    });
    if (!text?.trim()) return;
    await planner.add(root, text, { kind: 'inbox' });
    vscode.window.setStatusBarMessage('$(check) Task added', 2500);
  });
  command('search', () => {
    const picker = vscode.window.createQuickPick<
      vscode.QuickPickItem & { page: Page; line?: number; offset?: number }
    >();
    picker.title = 'NoteSpace · Search';
    picker.placeholder = 'Search pages · filters: tag: path: heading: prop: link: code: type:';
    const advanced = {
      iconPath: new vscode.ThemeIcon('filter'),
      tooltip: 'Open Advanced Search (filters, recent searches, previews)',
    };
    picker.buttons = [advanced];
    picker.matchOnDescription = false;
    picker.matchOnDetail = false;
    const update = () => {
      const seen = new Set<string>();
      const ranked = picker.value.trim()
        ? workspace.index.search(
            picker.value,
            undefined,
            (p) => /(?:^|\s)version:/i.test(picker.value) || !workspace.isArchived(p),
          )
        : [...activity.favoritePages(), ...activity.recentPages(), ...workspace.index.all()]
            .filter((page) => {
              if (seen.has(page.id)) return false;
              seen.add(page.id);
              return true;
            })
            .map((page) => ({ page, excerpt: page.path, score: 0, heading: undefined }));
      const pageItems = ranked.slice(0, 200).map((r) => ({
        label: r.page.title,
        description: `${activity.isFavorite(r.page) ? '★ ' : ''}${workspace.rootFor(r.page).name} / ${r.page.path}${r.heading && r.heading.level > 1 ? ` › ${r.heading.text}` : ''}`,
        detail: r.excerpt,
        page: r.page,
        // Deep link to the matching section (not the page's title heading).
        offset: r.heading && r.heading.level > 1 ? r.heading.offset : undefined,
        alwaysShow: true,
      }));
      // Tasks and journal content are searchable too.
      const query = picker.value.trim().toLowerCase();
      const taskItems = query
        ? planner
            .tasks()
            .filter((t) =>
              `${t.title} ${t.description} ${t.project || ''}`.toLowerCase().includes(query),
            )
            .slice(0, 30)
            .flatMap((t) => {
              const page = workspace.index.pages.get(t.pageId);
              return page
                ? [
                    {
                      label: `$(${t.status === 'done' ? 'pass-filled' : 'circle-large-outline'}) ${t.title}`,
                      description: `${t.due ? `due ${t.due} · ` : ''}${page.path}`,
                      page,
                      line: t.line,
                      alwaysShow: true,
                    },
                  ]
                : [];
            })
        : [];
      const unknown = parseQuery(picker.value).unknown;
      picker.title = unknown.length
        ? `NoteSpace · Search — unknown filter: ${unknown.join(', ')}`
        : 'NoteSpace · Search';
      picker.items = [
        ...pageItems,
        ...(taskItems.length
          ? [{ label: 'Tasks', kind: vscode.QuickPickItemKind.Separator } as never]
          : []),
        ...taskItems,
      ];
    };
    const subscriptions = [
      picker.onDidChangeValue(update),
      picker.onDidTriggerButton((button) => {
        if (button !== advanced) return;
        const value = picker.value;
        picker.hide();
        openSearchPanel(context, workspace, value);
      }),
      picker.onDidAccept(() => {
        const selected = picker.selectedItems[0];
        if (selected) {
          picker.hide();
          const line = selected.line;
          if (line !== undefined)
            void showPage(
              selected.page.uri,
              selected.page.text.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0),
            ).catch((e) => log.appendLine(String(e)));
          else if (selected.offset !== undefined)
            void showPage(selected.page.uri, selected.offset).catch((e) =>
              log.appendLine(String(e)),
            );
          else void openPreferred(selected.page).catch((e) => log.appendLine(String(e)));
        }
      }),
      picker.onDidHide(() => {
        subscriptions.forEach((s) => s.dispose());
        picker.dispose();
      }),
    ];
    update();
    picker.show();
  });
  command('advancedSearch', (query?: unknown) =>
    openSearchPanel(context, workspace, typeof query === 'string' ? query : ''),
  );
  command('openPage', async (uri: unknown, offset?: number) => {
    if (typeof uri !== 'string' || !workspace.index.byUri(uri))
      throw new Error('The selected page is no longer indexed.');
    const page = workspace.index.byUri(uri)!;
    if (typeof offset === 'number') await showPage(uri, offset);
    else await openPreferred(page);
  });
  command('preview', (node?: PageNode) => panels.openPreview(getPage(node)));
  command('graph', () => plannerPanel.show('graph'));
  command('renamePage', async (node?: PageNode) => {
    const page = getPage(node);
    const name = await vscode.window.showInputBox({
      title: 'Rename wiki page and update links',
      value: page.path,
      prompt:
        'New path relative to the wiki root. Link edits stay in editor buffers; use Save All to persist them.',
      validateInput: (value) => {
        try {
          pagePath(value);
          return undefined;
        } catch (e) {
          return (e as Error).message;
        }
      },
    });
    if (!name || name === page.path) return;
    await openPreferredUri(await workspace.renamePage(page, name));
    void vscode.window.showInformationMessage(
      'Page renamed and links updated. Use Save All to persist the link edits; Undo can revert the operation.',
    );
  });
  command('deletePage', async (node?: PageNode) => {
    const page = getPage(node),
      count = workspace.index.backlinks(page).filter((b) => b.page.id !== page.id).length;
    const choice = await vscode.window.showWarningMessage(
      `Delete “${page.title}”?${count ? ` ${count} incoming link(s) will become broken.` : ''}`,
      {
        modal: true,
        detail:
          'The page moves to .notespace-trash inside your wiki. Use Restore Deleted Page to recover it. Unsaved changes are saved first.',
      },
      'Delete Page',
    );
    if (choice !== 'Delete Page') return;
    const trashed = await workspace.trashPage(page);
    const tabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter(
        (t) =>
          t.input instanceof vscode.TabInputText && t.input.uri.toString() === trashed.toString(),
      );
    if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
  });
  command('restorePage', async () => {
    const root = await chooseRoot();
    if (!root) return;
    const pages = await workspace.deletedPages(root);
    if (!pages.length) {
      void vscode.window.showInformationMessage('Wiki Trash is empty.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      pages.map((p) => ({ label: p.path, description: 'Restore to original path', uri: p.uri })),
      { title: 'Restore deleted page' },
    );
    if (picked) await openPreferredUri(await workspace.restorePage(root, picked.uri));
  });
  command('insertLink', async () => {
    const editor = vscode.window.activeTextEditor,
      source = getPage();
    if (!editor) return;
    const picked = await vscode.window.showQuickPick(
      workspace.index
        .all(source.root)
        .map((page) => ({ label: page.title, description: page.path, page })),
      { title: 'Link to a wiki page' },
    );
    if (!picked) return;
    const label = editor.document.getText(editor.selection),
      path = picked.page.path.replace(/\.md$/i, '');
    await editor.edit((edit) =>
      edit.replace(
        editor.selection,
        `[[/${path}${label && !/[\]|\n\r]/.test(label) ? `|${label}` : ''}]]`,
      ),
    );
  });
  command('export', async () => {
    const root = await chooseRoot();
    if (!root) return;
    const selected = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Choose a parent folder for a new HTML export',
    });
    if (!selected?.length) return;
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting NoteSpace',
        cancellable: true,
      },
      (_progress, token) => exportWiki(workspace, root, selected[0], token, { planner }),
    );
    const choice = await vscode.window.showInformationMessage(
      `Exported ${result.pages} pages${result.warnings.length ? ` with ${result.warnings.length} warnings (see export-report.json)` : ''}.`,
      'Open Export Report',
      'Copy Export Path',
    );
    if (choice === 'Open Export Report')
      await showPage(vscode.Uri.joinPath(result.uri, 'export-report.json'));
    if (choice === 'Copy Export Path') await vscode.env.clipboard.writeText(result.uri.fsPath);
  });
  command('buildWiki', async () => {
    const root = await chooseRoot();
    if (!root || !root.projectUri || !root.config)
      throw new Error('Build requires a wiki.yaml project.');
    const destination = vscode.Uri.joinPath(root.projectUri, root.config.build.output);
    await workspace.assertNoSymlink(root, destination);
    let oldExists = false;
    try {
      await vscode.workspace.fs.stat(destination);
      oldExists = true;
    } catch (e) {
      if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound')) throw e;
    }
    if (oldExists) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(destination, '.notespace-build'));
      } catch {
        throw new Error(
          'Configured build directory already exists and is not a NoteSpace build. Choose another build.output.',
        );
      }
    }
    const result = await exportWiki(workspace, root, root.projectUri, undefined, { planner });
    const backup = vscode.Uri.joinPath(root.projectUri, `.notespace-build-backup-${Date.now()}`);
    try {
      if (oldExists) await vscode.workspace.fs.rename(destination, backup, { overwrite: false });
      await vscode.workspace.fs.rename(result.uri, destination, { overwrite: false });
      if (oldExists) await vscode.workspace.fs.delete(backup, { recursive: true });
    } catch (e) {
      try {
        if (oldExists) await vscode.workspace.fs.rename(backup, destination, { overwrite: false });
      } catch {
        /* Preserve original failure. */
      }
      throw e;
    }
    void vscode.window.showInformationMessage(
      `Built ${result.pages} pages at ${destination.path}.`,
    );
  });
  command('refresh', async () => {
    await workspace.refresh();
    if (workspace.issues.length) {
      log.show();
      void vscode.window.showWarningMessage(
        `NoteSpace indexed ${workspace.index.pages.size} pages with ${workspace.issues.length} warnings. See output for details.`,
      );
    }
  });
  command('validate', async () => {
    await workspace.refresh();
    const issues = [...workspace.issues];
    for (const page of workspace.index.all()) {
      if (page.metadataError)
        issues.push(`${page.path}: Invalid frontmatter: ${page.metadataError}`);
      for (const link of page.links) {
        if (link.kind === 'image') {
          const isMedia = /\.(?:mp4|webm|mp3|ogg)(?:[#?].*)?$/i.test(link.target);
          if (
            !/^(?:[a-z]+:|\/\/)/i.test(link.target) &&
            !(await (isMedia ? resolveMedia : resolveImage)(
              workspace,
              workspace.rootFor(page),
              page,
              link.target,
            ))
          )
            issues.push(
              `${page.path}: Missing or unsupported local ${isMedia ? 'media' : 'image'}: ${link.target}`,
            );
          continue;
        }
        if (
          link.kind === 'markdown' &&
          /\.[a-z\d]+(?:#.*)?$/i.test(link.target) &&
          !/\.md(?:#.*)?$/i.test(link.target)
        ) {
          if (
            /\.(?:pdf|txt|csv|zip|docx|xlsx|pptx)(?:#.*)?$/i.test(link.target) &&
            !(await resolveAttachment(workspace, workspace.rootFor(page), page, link.target))
          )
            issues.push(`${page.path}: Missing local attachment: ${link.target}`);
          continue;
        }
        const result = workspace.index.resolve(page, link.target, link.kind);
        if (result.error) issues.push(`${page.path}: ${result.error} link: ${link.target}`);
      }
    }
    if (!issues.length) {
      void vscode.window.showInformationMessage('NoteSpace: no validation issues found.');
      return;
    }
    log.clear();
    issues.forEach((issue) => log.appendLine(issue));
    log.show();
    void vscode.window.showWarningMessage(
      `NoteSpace found ${issues.length} validation issue(s). See Output → NoteSpace.`,
    );
  });
  await workspace.refresh();
  context.subscriptions.push(
    registerLanguageFeatures(workspace),
    registerMermaidDiagnostics(workspace),
  );
  updateStatus();
  updatePlannerStatus();
  startReminders(context, planner, () => plannerPanel.show('today'));
  return {
    workspace,
    panels,
    plannerPanel,
    activity,
    planner,
    exportWiki,
    context,
    review,
    proposals,
    semantic,
  };
}

/** Date words for daily notes: ISO dates, relative words and signed day offsets. */
function resolveJournalDate(value: string, today: string): string | undefined {
  const word = value.trim().toLowerCase();
  const offset = /^([+-])(\d{1,4})d?$/.exec(word);
  if (offset) return addDays(today, (offset[1] === '-' ? -1 : 1) * Number(offset[2]));
  return resolveDate(word === value.trim().toLowerCase() ? value.trim() : value, today);
}

/**
 * Optional reminders while VS Code runs: at most one notification per day for tasks due today or
 * overdue. Nothing is scheduled outside the extension host, so nothing fires while it is closed.
 */
function startReminders(
  context: vscode.ExtensionContext,
  planner: PlannerService,
  open: () => void,
): void {
  const check = () => {
    if (!vscode.workspace.getConfiguration('notespace').get<boolean>('planner.reminders', false))
      return;
    const today = planner.today();
    if (context.workspaceState.get<string>('planner.remindedOn') === today) return;
    const tasks: Task[] = planner.tasks();
    const due = tasks.filter((t) => inList(t, 'today', today)).length;
    if (!due) return;
    void context.workspaceState.update('planner.remindedOn', today);
    void vscode.window
      .showInformationMessage(
        `NoteSpace: ${due} task${due === 1 ? '' : 's'} due today or overdue.`,
        'Open Planner',
      )
      .then((choice) => choice && open());
  };
  const timer = setInterval(check, 10 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  setTimeout(check, 5000);
}

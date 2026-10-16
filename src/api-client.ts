import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ApiStore } from './api-store';
import { ApiRequest, emptyRequest, HTTP_METHODS } from './core/http/model';
import { CollectionItem, Environment, parseRequest } from './core/http/collection';
import { parseCurl } from './core/http/curl';
import { collectionFromOpenApi } from './core/http/openapi-import';
import { parseOpenApi } from './core/openapi';
import { tokensCss } from './core/design';
import { apiClientCss } from './api-client-css';
import { ApiResponse } from './api-http';

interface TreeNode {
  kind: 'folder' | 'request';
  path: string;
  name: string;
  method?: string;
  children?: TreeNode[];
}
const toTree = (items: CollectionItem[]): TreeNode[] =>
  items.map((i) =>
    i.kind === 'folder'
      ? { kind: 'folder', path: i.path, name: i.name, children: toTree(i.items) }
      : { kind: 'request', path: i.path, name: i.request.name, method: i.request.method },
  );

/** Only plausible request data from the webview reaches the store and the network. */
function cleanRequest(raw: unknown): ApiRequest {
  const parsed = parseRequest(
    JSON.stringify(raw ?? {}),
    typeof (raw as { id?: unknown })?.id === 'string'
      ? String((raw as { id: string }).id).slice(0, 300)
      : 'new',
  );
  return parsed;
}

/**
 * The API Client editor tab. All network access, files and secrets stay in the extension host;
 * the webview edits plain request data and shows responses.
 */
export class ApiClientPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly running = new Map<string, AbortController>();
  private readonly responses = new Map<string, ApiResponse>();
  private readonly subscriptions: vscode.Disposable[];
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly store: ApiStore,
  ) {
    this.subscriptions = [store.onDidChange(() => this.schedule())];
  }
  private timer?: ReturnType<typeof setTimeout>;
  private schedule() {
    if (!this.panel) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.postState(), 120);
  }

  /** Opens the client; with `open`, a stored request or a new one prefilled from curl/text. */
  async show(open?: { collection?: string; path?: string; request?: ApiRequest }) {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'wikiStudio.apiClient',
        'API Client',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.context.extensionUri],
        },
      );
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wiki-light.svg'),
        dark: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wiki-dark.svg'),
      };
      const nonce = randomBytes(18).toString('base64');
      const script = this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'api-client.js'),
      );
      this.panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>API Client</title><style>${tokensCss}${apiClientCss}</style></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        for (const c of this.running.values()) c.abort();
      });
      this.panel.webview.onDidReceiveMessage((m) => {
        this.queue = this.queue.then(() =>
          this.onMessage(m).then(
            () => undefined,
            (e) => {
              void this.panel?.webview.postMessage({
                type: 'error',
                message: e instanceof Error ? e.message : String(e),
                tab: m?.tab,
              });
            },
          ),
        );
      });
    } else this.panel.reveal();
    if (open) {
      const request =
        open.request ||
        (open.collection && open.path
          ? await this.store.request(open.collection, open.path)
          : undefined);
      if (request)
        void this.panel.webview.postMessage({ type: 'open', request, collection: open.collection });
    }
  }

  private async postState() {
    if (!this.panel) return;
    const collections = await this.store.collections();
    const environments = await this.store.environments();
    void this.panel.webview.postMessage({
      type: 'state',
      collections: collections.map((c) => ({
        id: c.id,
        name: c.meta.name,
        description: c.meta.description,
        variables: c.meta.variables,
        auth: c.meta.auth,
        tree: toTree(c.items),
        problems: c.problems,
      })),
      environments: await Promise.all(
        environments.map(async (e) => ({
          id: e.id,
          name: e.name,
          variables: await Promise.all(
            e.variables.map(async (v) =>
              v.secret ? { ...v, value: '', hasValue: await this.store.hasSecret(e.id, v.key) } : v,
            ),
          ),
        })),
      ),
      environment: this.store.activeEnvironment(),
      globals: this.store.globals(),
      runtime: Object.keys(this.store.runtime),
      history: this.store.history().slice(0, 200),
      tabs: this.context.workspaceState.get('wikiStudio.api.tabs', null),
      trusted: vscode.workspace.isTrusted,
    });
  }

  private async pickCollection(title: string): Promise<string | undefined> {
    const collections = await this.store.collections();
    const picked = await vscode.window.showQuickPick(
      [
        ...collections.map((c) => ({ label: c.meta.name, id: c.id })),
        { label: '$(add) New collection…', id: '__new' },
      ],
      { title },
    );
    if (!picked) return undefined;
    if (picked.id !== '__new') return picked.id;
    const name = await vscode.window.showInputBox({
      title: 'New collection',
      prompt: 'Collection name',
      validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
    });
    return name ? this.store.createCollection(name) : undefined;
  }

  private async onMessage(m: Record<string, unknown>) {
    const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
    const tab = str(m.tab, 80);
    const collection = str(m.collection, 120) || undefined;
    const path = str(m.path, 400);
    switch (m.type) {
      case 'ready':
        return this.postState();
      case 'tabs':
        // Open tabs and drafts survive reloads (requests hold no secret values).
        return void this.context.workspaceState.update('wikiStudio.api.tabs', m.tabs ?? null);
      case 'open': {
        if (!collection || !path) return;
        const request = await this.store.request(collection, path);
        return void this.panel?.webview.postMessage({ type: 'open', request, collection });
      }
      case 'send': {
        const request = cleanRequest(m.request);
        const controller = new AbortController();
        this.running.get(tab)?.abort();
        this.running.set(tab, controller);
        try {
          const result = await this.store.send(request, {
            collection,
            origin: 'client',
            ref:
              collection && request.id && !['new', 'imported'].includes(request.id)
                ? `${collection}/${request.id}`
                : undefined,
            signal: controller.signal,
          });
          if (result.response) this.responses.set(tab, result.response);
          void this.panel?.webview.postMessage({ type: 'response', tab, ...result });
        } finally {
          this.running.delete(tab);
        }
        return;
      }
      case 'cancel':
        this.running.get(tab)?.abort();
        return;
      case 'save': {
        const request = cleanRequest(m.request);
        const target = collection || (await this.pickCollection(`Save “${request.name}” to`));
        if (!target) return;
        const parent = m.parent === undefined ? undefined : str(m.parent, 400);
        const savedPath = await this.store.saveRequest(target, request, collection ? parent : '');
        void this.panel?.webview.postMessage({
          type: 'saved',
          tab,
          collection: target,
          path: savedPath,
        });
        return;
      }
      case 'download': {
        const response = this.responses.get(tab);
        if (!response) throw new Error('Send the request first.');
        const ext = /json/.test(response.contentType)
          ? 'json'
          : /xml/.test(response.contentType)
            ? 'xml'
            : /html/.test(response.contentType)
              ? 'html'
              : /image\/(\w+)/.exec(response.contentType)?.[1] ||
                (response.text !== undefined ? 'txt' : 'bin');
        const uri = await vscode.window.showSaveDialog({
          title: 'Save response body',
          defaultUri: vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file('/'),
            `response.${ext}`,
          ),
        });
        if (!uri) return;
        await vscode.workspace.fs.writeFile(
          uri,
          response.text !== undefined
            ? new TextEncoder().encode(response.text)
            : Buffer.from(response.base64 || '', 'base64'),
        );
        void vscode.window.showInformationMessage(
          `Saved ${vscode.workspace.asRelativePath(uri)}${response.truncated ? ' (truncated at the size limit)' : ''}.`,
        );
        return;
      }
      case 'createCollection': {
        const name = await vscode.window.showInputBox({
          title: 'New collection',
          prompt: 'Collection name',
          validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
        });
        if (name) await this.store.createCollection(name);
        return;
      }
      case 'updateCollection':
        if (collection && m.change && typeof m.change === 'object')
          await this.store.updateCollection(collection, m.change as never);
        return;
      case 'renameCollection': {
        if (!collection) return;
        const current = (await this.store.collections()).find((c) => c.id === collection);
        const name = await vscode.window.showInputBox({
          title: 'Rename collection',
          value: current?.meta.name,
          validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
        });
        if (name) await this.store.updateCollection(collection, { name });
        return;
      }
      case 'deleteCollection': {
        if (!collection) return;
        const current = (await this.store.collections()).find((c) => c.id === collection);
        const choice = await vscode.window.showWarningMessage(
          `Delete the collection “${current?.meta.name || collection}”?`,
          { modal: true, detail: 'Its folder moves to the system Trash where available.' },
          'Delete Collection',
        );
        if (choice) await this.store.deleteCollection(collection);
        return;
      }
      case 'createFolder': {
        if (!collection) return;
        const name = await vscode.window.showInputBox({
          title: 'New folder',
          validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
        });
        if (name) await this.store.createFolder(collection, path, name);
        return;
      }
      case 'newRequest': {
        if (!collection) return;
        const savedPath = await this.store.saveRequest(
          collection,
          emptyRequest('new', 'New request'),
          path,
        );
        void this.panel?.webview.postMessage({
          type: 'open',
          request: await this.store.request(collection, savedPath),
          collection,
        });
        return;
      }
      case 'duplicate':
        if (collection && path) await this.store.duplicateRequest(collection, path);
        return;
      case 'rename': {
        if (!collection || !path) return;
        const name = await vscode.window.showInputBox({
          title: 'Rename',
          value: str(m.name, 200),
          validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
        });
        if (name) await this.store.renameItem(collection, path, m.folder === true, name);
        return;
      }
      case 'deleteItem': {
        if (!collection || !path) return;
        const choice = await vscode.window.showWarningMessage(
          `Delete “${str(m.name, 200) || path}”?`,
          {
            modal: true,
            detail: m.folder
              ? 'The folder and its requests move to the system Trash where available.'
              : 'The request file moves to the system Trash where available.',
          },
          'Delete',
        );
        if (choice) await this.store.deleteItem(collection, path, m.folder === true);
        return;
      }
      case 'move':
        if (collection && path)
          await this.store.move(
            collection,
            path,
            m.folder === true,
            str(m.to, 400),
            typeof m.index === 'number' ? m.index : undefined,
          );
        return;
      case 'export': {
        if (!collection) return;
        const text = await this.store.exportCollection(collection);
        const uri = await vscode.window.showSaveDialog({
          title: 'Export collection',
          filters: { JSON: ['json'] },
          defaultUri: vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file('/'),
            `${collection}.collection.json`,
          ),
        });
        if (uri) await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
        if (uri)
          void vscode.window.showInformationMessage(
            'Collection exported. Secret values are not included.',
          );
        return;
      }
      case 'importCurl': {
        const text = str(m.text, 200000);
        const { request, warnings } = parseCurl(text);
        void this.panel?.webview.postMessage({
          type: 'open',
          request,
          tab: tab || undefined,
          warnings,
        });
        return;
      }
      case 'importFile':
        return this.importFile();
      case 'setEnvironment':
        return this.store.setActiveEnvironment(str(m.id, 120) || undefined);
      case 'saveEnvironment': {
        const env = m.env as Environment;
        if (!env || typeof env.name !== 'string' || !Array.isArray(env.variables)) return;
        const id = await this.store.saveEnvironment(str(m.id, 120) || undefined, {
          schemaVersion: 1,
          name: env.name.slice(0, 200),
          variables: env.variables.slice(0, 500).map((v) => ({
            key: String(v.key).slice(0, 200),
            value: v.secret ? '' : String(v.value ?? '').slice(0, 100000),
            ...(v.secret ? { secret: true } : {}),
            ...(v.enabled === false ? { enabled: false } : {}),
          })),
        });
        if (!m.id) await this.store.setActiveEnvironment(id);
        return;
      }
      case 'newEnvironment': {
        const name = await vscode.window.showInputBox({
          title: 'New environment',
          placeHolder: 'Local, Staging, Production…',
          validateInput: (v) => (v.trim() ? undefined : 'Enter a name.'),
        });
        if (!name) return;
        const id = await this.store.saveEnvironment(undefined, {
          schemaVersion: 1,
          name,
          variables: [{ key: 'baseUrl', value: '' }],
        });
        await this.store.setActiveEnvironment(id);
        return;
      }
      case 'deleteEnvironment': {
        const id = str(m.id, 120);
        const choice = await vscode.window.showWarningMessage(
          'Delete this environment?',
          {
            modal: true,
            detail:
              'Its file is deleted and its secret values are removed from VS Code secret storage.',
          },
          'Delete Environment',
        );
        if (choice) await this.store.deleteEnvironment(id);
        return;
      }
      case 'setSecret': {
        // Secret values are typed into VS Code's masked input, never into the webview.
        const id = str(m.id, 120);
        const name = str(m.name, 200);
        const envs = await this.store.environments();
        const env = envs.find((e) => e.id === id);
        if (!env || !name) return;
        const value = await vscode.window.showInputBox({
          title: `Secret value for ${name} (${env.name})`,
          password: true,
          ignoreFocusOut: true,
        });
        if (value === undefined) return;
        const variables = env.variables.some((v) => v.key === name)
          ? env.variables.map((v) => (v.key === name ? { ...v, value: '', secret: true } : v))
          : [...env.variables, { key: name, value: '', secret: true }];
        await this.store.saveEnvironment(id, {
          ...env,
          variables,
          secretValues: { [name]: value },
        });
        return;
      }
      case 'setGlobals':
        if (Array.isArray(m.globals))
          await this.store.setGlobals(
            (m.globals as Array<{ key: unknown; value: unknown }>).slice(0, 500).map((g) => ({
              key: String(g.key ?? '').slice(0, 200),
              value: String(g.value ?? '').slice(0, 100000),
            })),
          );
        return;
      case 'clearRuntime':
        for (const k of Object.keys(this.store.runtime)) delete this.store.runtime[k];
        return this.postState();
      case 'clearHistory': {
        const choice = await vscode.window.showWarningMessage(
          'Clear the request history?',
          { modal: true },
          'Clear History',
        );
        if (choice) await this.store.clearHistory();
        return;
      }
      case 'runCollection':
        if (collection) await this.runCollection(collection, path);
        return;
    }
  }

  /** Runs every request of a collection (or folder) in order; extracted values chain forward. */
  async runCollection(collection: string, folder = '') {
    const c = await this.store.collection(collection);
    const requests: ApiRequest[] = [];
    const walk = (items: CollectionItem[]) => {
      for (const i of items) {
        if (i.kind === 'request') {
          if (!folder || i.path.startsWith(`${folder}/`)) requests.push(i.request);
        } else walk(i.items);
      }
    };
    walk(c.items);
    const results: Array<{
      name: string;
      path: string;
      status?: number;
      ms?: number;
      error?: string;
      tests: Array<{ pass: boolean; source: string; message: string }>;
    }> = [];
    void this.panel?.webview.postMessage({
      type: 'run',
      collection,
      results,
      done: false,
      total: requests.length,
    });
    const controller = new AbortController();
    this.running.set('__run', controller);
    try {
      for (const request of requests) {
        if (controller.signal.aborted) break;
        const r = await this.store.send(request, {
          collection,
          origin: 'client',
          ref: `${collection}/${request.id}`,
          signal: controller.signal,
        });
        results.push({
          name: request.name,
          path: request.id,
          status: r.response?.status,
          ms: r.response?.ms,
          error: r.error,
          tests: r.tests.results,
        });
        void this.panel?.webview.postMessage({
          type: 'run',
          collection,
          results,
          done: false,
          total: requests.length,
        });
      }
    } finally {
      this.running.delete('__run');
    }
    void this.panel?.webview.postMessage({
      type: 'run',
      collection,
      results,
      done: true,
      total: requests.length,
    });
    return results;
  }

  /** Imports an OpenAPI description or a collection export, with a preview first. */
  async importFile(uri?: vscode.Uri) {
    const picked =
      uri ||
      (
        await vscode.window.showOpenDialog({
          title: 'Import OpenAPI description or collection',
          canSelectMany: false,
          filters: { 'OpenAPI / collection': ['yaml', 'yml', 'json'] },
        })
      )?.[0];
    if (!picked) return;
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(picked));
    if (/"format"\s*:\s*"wiki-studio\.collection-bundle"/.test(text)) {
      const id = await this.store.importBundle(text);
      void vscode.window.showInformationMessage(
        `Imported the collection into ${vscode.workspace.asRelativePath(vscode.Uri.joinPath(this.store.root(), id))}.`,
      );
      return id;
    }
    const spec = parseOpenApi(text);
    const preview = collectionFromOpenApi(spec);
    const detail = [
      `${preview.requests.length} request${preview.requests.length === 1 ? '' : 's'} in ${new Set(preview.requests.map((r) => r.path.split('/')[0])).size} folder(s)`,
      ...preview.requests
        .slice(0, 12)
        .map((r) => `${r.method} ${r.url.replace('{{baseUrl}}', '')}`),
      ...(preview.requests.length > 12 ? [`… and ${preview.requests.length - 12} more`] : []),
      ...preview.warnings,
      'A new collection folder is created; nothing existing is overwritten.',
    ].join('\n');
    const choice = await vscode.window.showInformationMessage(
      `Import “${spec.title}” as a collection?`,
      { modal: true, detail },
      'Import',
    );
    if (choice !== 'Import') return;
    const id = await this.store.importFiles(spec.title, preview.files);
    void vscode.window.showInformationMessage(
      `Imported ${preview.requests.length} requests into ${vscode.workspace.asRelativePath(vscode.Uri.joinPath(this.store.root(), id))}.`,
    );
    return id;
  }

  dispose() {
    clearTimeout(this.timer);
    this.panel?.dispose();
    this.subscriptions.forEach((s) => s.dispose());
  }
}

export const httpMethods = HTTP_METHODS;

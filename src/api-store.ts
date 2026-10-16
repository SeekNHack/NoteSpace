import * as vscode from 'vscode';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  buildCollection,
  bundleCollection,
  Collection,
  CollectionItem,
  CollectionMeta,
  COLLECTION_SCHEMA,
  Environment,
  parseCollectionMeta,
  parseEnvironment,
  parseRequest,
  readBundle,
  REQUEST_SUFFIX,
  serializeCollectionMeta,
  serializeEnvironment,
  serializeRequest,
  slug,
} from './core/http/collection';
import {
  ApiRequest,
  AuthConfig,
  interpolate,
  KeyValue,
  mergeVariables,
  redactUrl,
  resolveRequest,
} from './core/http/model';
import { runTests, TestRun } from './core/http/tests';
import { ApiResponse, send } from './api-http';
import { TargetKind } from './core/net-safety';

export interface HistoryEntry {
  id: string;
  at: number;
  name: string;
  method: string;
  /** URL with sensitive query values and user info redacted. */
  url: string;
  status?: number;
  ms?: number;
  size?: number;
  error?: string;
  /** collection/request path when the request came from a collection. */
  ref?: string;
}

export interface SendContext {
  /** collection id of the request (variables and inherited auth). */
  collection?: string;
  environment?: string;
  /** Where the request comes from: the API client (user-authored) or a documentation page. */
  origin: 'client' | 'document';
  ref?: string;
  signal?: AbortSignal;
}

const HISTORY_KEY = 'notespace.api.history';
const GLOBALS_KEY = 'notespace.api.globals';
const ENV_KEY = 'notespace.api.environment';

/**
 * Collections, environments, history and sending for the API client. Files live under
 * `<workspace folder>/<notespace.api.folder>` (default `api/`); secret variable values and OAuth
 * tokens live in VS Code SecretStorage or memory, never in files, logs or the history.
 */
export class ApiStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  /** Values extracted by tests during this session (not saved). */
  readonly runtime: Record<string, string> = {};
  private readonly tokens = new Map<string, { token: string; expires: number }>();
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly subscriptions: vscode.Disposable[];
  constructor(private readonly context: vscode.ExtensionContext) {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{request.json,env.json}');
    const fire = () => this.emitter.fire();
    this.subscriptions = [
      this.watcher,
      this.watcher.onDidChange(fire),
      this.watcher.onDidCreate(fire),
      this.watcher.onDidDelete(fire),
    ];
  }

  // -------------------------------------------------------------------------------------------
  // Locations
  // -------------------------------------------------------------------------------------------
  root(): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('Open a workspace folder to keep API collections.');
    const name =
      vscode.workspace
        .getConfiguration('notespace', folder.uri)
        .get<string>('api.folder', 'api')
        .replace(/^\/+|\/+$/g, '') || 'api';
    if (name.split('/').includes('..'))
      throw new Error('notespace.api.folder must stay inside the workspace.');
    return vscode.Uri.joinPath(folder.uri, name);
  }
  private safeSegment(segment: string): string {
    if (!/^[\w.-]+$/.test(segment) || segment.startsWith('.') || segment === '..')
      throw new Error(`“${segment}” is not a valid name for a file.`);
    return segment;
  }
  private collectionUri(id: string) {
    return vscode.Uri.joinPath(this.root(), this.safeSegment(id));
  }
  private pathUri(collection: string, relative: string) {
    const parts = relative
      .split('/')
      .filter(Boolean)
      .map((p) => this.safeSegment(p));
    return vscode.Uri.joinPath(this.collectionUri(collection), ...parts);
  }
  private async exists(uri: vscode.Uri) {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
  private async write(uri: vscode.Uri, text: string) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    this.emitter.fire();
  }
  private async read(uri: vscode.Uri) {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  }
  private async unique(dir: vscode.Uri, base: string, suffix: string) {
    let name = base;
    for (let n = 2; await this.exists(vscode.Uri.joinPath(dir, `${name}${suffix}`)); n++)
      name = `${base}-${n}`;
    return name;
  }

  // -------------------------------------------------------------------------------------------
  // Collections
  // -------------------------------------------------------------------------------------------
  async collections(): Promise<Collection[]> {
    let root: vscode.Uri;
    try {
      root = this.root();
    } catch {
      return [];
    }
    if (!(await this.exists(root))) return [];
    const out: Collection[] = [];
    for (const [name, type] of await vscode.workspace.fs.readDirectory(root)) {
      if (type !== vscode.FileType.Directory || name === 'environments' || name.startsWith('.'))
        continue;
      if (!(await this.exists(vscode.Uri.joinPath(root, name, 'collection.json')))) continue;
      out.push(await this.collection(name));
    }
    return out.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  }

  async collection(id: string): Promise<Collection> {
    const base = this.collectionUri(id);
    const files = new Map<string, string>();
    const walk = async (dir: vscode.Uri, prefix: string, depth: number) => {
      if (depth > 8 || files.size > 2000) return;
      for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
        if (name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (type === vscode.FileType.Directory)
          await walk(vscode.Uri.joinPath(dir, name), rel, depth + 1);
        else if (
          type === vscode.FileType.File &&
          (name.endsWith(REQUEST_SUFFIX) ||
            name === 'folder.json' ||
            (name === 'collection.json' && !prefix))
        )
          files.set(rel, await this.read(vscode.Uri.joinPath(dir, name)));
      }
    };
    await walk(base, '', 0);
    return buildCollection(id, files);
  }

  async createCollection(name: string, description?: string): Promise<string> {
    const clean = name.trim();
    if (!clean) throw new Error('A collection needs a name.');
    const root = this.root();
    await vscode.workspace.fs.createDirectory(root);
    const id = await this.unique(root, slug(clean), '');
    const meta: CollectionMeta = {
      schemaVersion: COLLECTION_SCHEMA,
      type: 'notespace.collection',
      name: clean,
      ...(description ? { description } : {}),
      variables: [],
      auth: { type: 'none' },
      order: [],
    };
    await this.write(
      vscode.Uri.joinPath(root, id, 'collection.json'),
      serializeCollectionMeta(meta),
    );
    return id;
  }

  async updateCollection(
    id: string,
    change: Partial<Pick<CollectionMeta, 'name' | 'description' | 'variables' | 'auth'>>,
  ) {
    const uri = vscode.Uri.joinPath(this.collectionUri(id), 'collection.json');
    const meta = parseCollectionMeta(await this.read(uri));
    if (change.name !== undefined) {
      if (!change.name.trim()) throw new Error('A collection needs a name.');
      meta.name = change.name.trim();
    }
    if (change.description !== undefined) meta.description = change.description || undefined;
    if (change.variables) meta.variables = change.variables.filter((v) => v.key);
    if (change.auth) meta.auth = change.auth;
    await this.write(uri, serializeCollectionMeta(meta));
  }

  /** Moves the collection folder to the system Trash (or deletes it where there is none). */
  async deleteCollection(id: string) {
    const uri = this.collectionUri(id);
    try {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
    } catch {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    }
    this.emitter.fire();
  }

  private async orderOf(
    collection: string,
    parent: string,
  ): Promise<{ uri: vscode.Uri; order: string[]; meta: Record<string, unknown> }> {
    const uri = parent
      ? vscode.Uri.joinPath(this.pathUri(collection, parent), 'folder.json')
      : vscode.Uri.joinPath(this.collectionUri(collection), 'collection.json');
    let meta: Record<string, unknown> = parent ? { name: parent.split('/').pop() } : {};
    try {
      meta = JSON.parse(await this.read(uri));
    } catch {
      /* a folder without folder.json */
    }
    return { uri, order: Array.isArray(meta.order) ? (meta.order as string[]) : [], meta };
  }
  private async setOrder(collection: string, parent: string, order: string[]) {
    const { uri, meta } = await this.orderOf(collection, parent);
    await this.write(uri, `${JSON.stringify({ ...meta, order: [...new Set(order)] }, null, 2)}\n`);
  }

  async createFolder(collection: string, parent: string, name: string): Promise<string> {
    const clean = name.trim();
    if (!clean) throw new Error('A folder needs a name.');
    const dir = parent ? this.pathUri(collection, parent) : this.collectionUri(collection);
    const id = await this.unique(dir, slug(clean), '');
    const path = parent ? `${parent}/${id}` : id;
    await this.write(
      vscode.Uri.joinPath(dir, id, 'folder.json'),
      `${JSON.stringify({ name: clean, order: [] }, null, 2)}\n`,
    );
    const { order } = await this.orderOf(collection, parent);
    await this.setOrder(collection, parent, [...order, id]);
    return path;
  }

  /** Saves a request at `path` (collection-relative id); a new path gets a unique file name. */
  async saveRequest(collection: string, request: ApiRequest, parent?: string): Promise<string> {
    let path = request.id;
    if (
      parent !== undefined ||
      !path ||
      path === 'new' ||
      path === 'imported' ||
      path === 'block'
    ) {
      const dir = parent ? this.pathUri(collection, parent) : this.collectionUri(collection);
      await vscode.workspace.fs.createDirectory(dir);
      const name = await this.unique(dir, slug(request.name), REQUEST_SUFFIX);
      path = parent ? `${parent}/${name}` : name;
      const { order } = await this.orderOf(collection, parent || '');
      await this.write(
        vscode.Uri.joinPath(dir, `${name}${REQUEST_SUFFIX}`),
        serializeRequest({ ...request, id: path }),
      );
      await this.setOrder(collection, parent || '', [...order, name]);
      return path;
    }
    await this.write(
      this.pathUri(collection, `${path}${REQUEST_SUFFIX}`),
      serializeRequest({ ...request, id: path }),
    );
    return path;
  }

  async request(collection: string, path: string): Promise<ApiRequest> {
    return parseRequest(
      await this.read(this.pathUri(collection, `${path}${REQUEST_SUFFIX}`)),
      path,
    );
  }

  async duplicateRequest(collection: string, path: string): Promise<string> {
    const req = await this.request(collection, path);
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    return this.saveRequest(collection, { ...req, id: 'new', name: `${req.name} copy` }, parent);
  }

  async deleteItem(collection: string, path: string, folder: boolean) {
    const uri = folder
      ? this.pathUri(collection, path)
      : this.pathUri(collection, `${path}${REQUEST_SUFFIX}`);
    try {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
    } catch {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    }
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const name = path.split('/').pop()!;
    const { order } = await this.orderOf(collection, parent);
    await this.setOrder(
      collection,
      parent,
      order.filter((o) => o !== name),
    );
  }

  /** Moves a request or folder to another folder (`''` = top level) at `index`. */
  async move(collection: string, path: string, folder: boolean, toParent: string, index?: number) {
    const name = path.split('/').pop()!;
    const fromParent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder && (toParent === path || toParent.startsWith(`${path}/`)))
      throw new Error('A folder cannot move into itself.');
    let target = name;
    if (fromParent !== toParent) {
      const dir = toParent ? this.pathUri(collection, toParent) : this.collectionUri(collection);
      target = await this.unique(dir, name, folder ? '' : REQUEST_SUFFIX);
      const from = folder
        ? this.pathUri(collection, path)
        : this.pathUri(collection, `${path}${REQUEST_SUFFIX}`);
      const to = vscode.Uri.joinPath(dir, folder ? target : `${target}${REQUEST_SUFFIX}`);
      await vscode.workspace.fs.rename(from, to, { overwrite: false });
      const { order } = await this.orderOf(collection, fromParent);
      await this.setOrder(
        collection,
        fromParent,
        order.filter((o) => o !== name),
      );
    }
    const { order } = await this.orderOf(collection, toParent);
    const next = order.filter((o) => o !== target);
    next.splice(
      index === undefined ? next.length : Math.max(0, Math.min(index, next.length)),
      0,
      target,
    );
    await this.setOrder(collection, toParent, next);
    this.emitter.fire();
  }

  async renameItem(collection: string, path: string, folder: boolean, name: string) {
    const clean = name.trim();
    if (!clean) throw new Error('Enter a name.');
    if (folder) {
      const { uri, meta } = await this.orderOf(collection, path);
      await this.write(uri, `${JSON.stringify({ ...meta, name: clean }, null, 2)}\n`);
    } else {
      const req = await this.request(collection, path);
      await this.saveRequest(collection, { ...req, name: clean });
    }
  }

  async exportCollection(id: string): Promise<string> {
    const base = this.collectionUri(id);
    const files = new Map<string, string>();
    const walk = async (dir: vscode.Uri, prefix: string) => {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (type === vscode.FileType.Directory) await walk(vscode.Uri.joinPath(dir, name), rel);
        else if (name.endsWith(REQUEST_SUFFIX) || name === 'folder.json')
          files.set(rel, await this.read(vscode.Uri.joinPath(dir, name)));
      }
    };
    await walk(base, '');
    const meta = parseCollectionMeta(await this.read(vscode.Uri.joinPath(base, 'collection.json')));
    // Collection variables marked secret are exported without values.
    meta.variables = meta.variables.map((v) =>
      v.secret ? { key: v.key, value: '', secret: true } : v,
    );
    return `${JSON.stringify(bundleCollection(meta, files), null, 2)}\n`;
  }

  async importFiles(name: string, files: Map<string, string>): Promise<string> {
    const root = this.root();
    await vscode.workspace.fs.createDirectory(root);
    const id = await this.unique(root, slug(name), '');
    for (const [rel, text] of files) {
      if (
        !/^[\w./-]+$/.test(rel) ||
        rel.split('/').some((p) => !p || p === '..' || p.startsWith('.'))
      )
        throw new Error(`Unsafe path: ${rel}`);
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(root, id, ...rel.split('/').slice(0, -1)),
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(root, id, ...rel.split('/')),
        new TextEncoder().encode(text),
      );
    }
    this.emitter.fire();
    return id;
  }

  async importBundle(text: string): Promise<string> {
    const bundle = readBundle(text);
    const files = new Map(Object.entries(bundle.files));
    files.set('collection.json', serializeCollectionMeta(bundle.meta));
    return this.importFiles(bundle.meta.name, files);
  }

  // -------------------------------------------------------------------------------------------
  // Environments and variables
  // -------------------------------------------------------------------------------------------
  private envDir() {
    return vscode.Uri.joinPath(this.root(), 'environments');
  }
  async environments(): Promise<Array<Environment & { id: string }>> {
    let dir: vscode.Uri;
    try {
      dir = this.envDir();
    } catch {
      return [];
    }
    if (!(await this.exists(dir))) return [];
    const out: Array<Environment & { id: string }> = [];
    for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
      if (type !== vscode.FileType.File || !name.endsWith('.env.json')) continue;
      const id = name.slice(0, -'.env.json'.length);
      try {
        out.push({ id, ...parseEnvironment(await this.read(vscode.Uri.joinPath(dir, name)), id) });
      } catch {
        /* an unreadable environment is skipped */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  private secretKey(scope: string, name: string) {
    return `notespace.api.secret:${this.root().toString()}:${scope}:${name}`;
  }
  /** Saves an environment; secret values go to SecretStorage and are never written to disk. */
  async saveEnvironment(
    id: string | undefined,
    env: Environment & { secretValues?: Record<string, string> },
  ): Promise<string> {
    if (!env.name.trim()) throw new Error('An environment needs a name.');
    const dir = this.envDir();
    await vscode.workspace.fs.createDirectory(dir);
    const envId = id || (await this.unique(dir, slug(env.name), '.env.json'));
    this.safeSegment(envId);
    for (const [name, value] of Object.entries(env.secretValues || {}))
      if (env.variables.some((v) => v.key === name && v.secret))
        await this.context.secrets.store(this.secretKey(envId, name), value);
    await this.write(vscode.Uri.joinPath(dir, `${envId}.env.json`), serializeEnvironment(env));
    return envId;
  }
  async deleteEnvironment(id: string) {
    const env = (await this.environments()).find((e) => e.id === id);
    for (const v of env?.variables || [])
      if (v.secret) await this.context.secrets.delete(this.secretKey(id, v.key));
    await vscode.workspace.fs.delete(
      vscode.Uri.joinPath(this.envDir(), `${this.safeSegment(id)}.env.json`),
      { useTrash: false },
    );
    this.emitter.fire();
  }
  async hasSecret(envId: string, name: string) {
    return !!(await this.context.secrets.get(this.secretKey(envId, name)));
  }
  activeEnvironment(): string | undefined {
    return this.context.workspaceState.get<string>(ENV_KEY);
  }
  async setActiveEnvironment(id: string | undefined) {
    await this.context.workspaceState.update(ENV_KEY, id);
    this.emitter.fire();
  }
  globals(): KeyValue[] {
    return this.context.workspaceState.get<KeyValue[]>(GLOBALS_KEY, []);
  }
  async setGlobals(vars: KeyValue[]) {
    await this.context.workspaceState.update(
      GLOBALS_KEY,
      vars.filter((v) => v.key && !v.secret),
    );
    this.emitter.fire();
  }

  private static map(rows: KeyValue[] | undefined) {
    return Object.fromEntries(
      (rows || []).filter((r) => r.key && r.enabled !== false).map((r) => [r.key, r.value]),
    );
  }
  /** All variables for a send, by precedence; also returns the secret values to redact. */
  async variables(collection?: string, environment?: string, request?: ApiRequest) {
    const secrets: string[] = [];
    let collectionVars: Record<string, string> = {};
    let inherited: AuthConfig = { type: 'none' };
    if (collection) {
      try {
        const meta = parseCollectionMeta(
          await this.read(vscode.Uri.joinPath(this.collectionUri(collection), 'collection.json')),
        );
        collectionVars = ApiStore.map(meta.variables);
        inherited = meta.auth;
      } catch {
        /* a missing collection.json */
      }
    }
    let envVars: Record<string, string> = {};
    const envId = environment ?? this.activeEnvironment();
    if (envId) {
      const env = (await this.environments()).find((e) => e.id === envId);
      for (const v of env?.variables || []) {
        if (!v.key || v.enabled === false) continue;
        if (v.secret) {
          const value = await this.context.secrets.get(this.secretKey(envId, v.key));
          if (value !== undefined) {
            envVars[v.key] = value;
            secrets.push(value);
          }
        } else envVars[v.key] = v.value;
      }
    }
    const vars = mergeVariables({
      global: ApiStore.map(this.globals()),
      collection: collectionVars,
      environment: envVars,
      runtime: this.runtime,
      request: ApiStore.map(request?.variables),
    });
    return { vars, secrets, inherited };
  }

  // -------------------------------------------------------------------------------------------
  // OAuth 2.0 (client credentials; authorization code with PKCE)
  // -------------------------------------------------------------------------------------------
  private async oauthToken(
    auth: Extract<AuthConfig, { type: 'oauth2' }>,
    vars: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const v = (s?: string) => (s ? interpolate(s, vars) : '');
    const cacheKey = createHash('sha256')
      .update(JSON.stringify([auth.grant, v(auth.tokenUrl), v(auth.clientId), v(auth.scope)]))
      .digest('hex');
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expires > Date.now() + 10000) return cached.token;
    const tokenUrl = v(auth.tokenUrl);
    if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(tokenUrl))
      throw new Error('The OAuth token URL must use https (http only for localhost).');
    const form = new URLSearchParams();
    if (auth.grant === 'client_credentials') {
      form.set('grant_type', 'client_credentials');
      if (auth.scope) form.set('scope', v(auth.scope));
    } else {
      const authUrl = v(auth.authUrl);
      if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(authUrl))
        throw new Error('The OAuth authorization URL must use https.');
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const state = randomBytes(16).toString('base64url');
      // A loopback listener receives the redirect (RFC 8252); it accepts one request.
      const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
        (resolve, reject) => {
          let port = 0;
          const server = createServer((req, res) => {
            const url = new URL(req.url || '/', 'http://127.0.0.1');
            const ok =
              url.pathname === '/callback' &&
              url.searchParams.get('state') === state &&
              url.searchParams.get('code');
            res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
            res.end(
              ok
                ? '<p>Signed in. You can close this tab and return to VS Code.</p>'
                : '<p>The sign-in response was not valid.</p>',
            );
            server.close();
            if (ok)
              resolve({
                code: url.searchParams.get('code')!,
                redirectUri: `http://127.0.0.1:${port}/callback`,
              });
            else
              reject(
                new Error(
                  url.searchParams.get('error_description') ||
                    url.searchParams.get('error') ||
                    'Sign-in failed.',
                ),
              );
          });
          const timer = setTimeout(() => {
            server.close();
            reject(new Error('Sign-in timed out after 5 minutes.'));
          }, 300000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            server.close();
            reject(new Error('Sign-in cancelled.'));
          });
          server.listen(0, '127.0.0.1', () => {
            port = (server.address() as { port: number }).port;
            const target = new URL(authUrl);
            target.searchParams.set('response_type', 'code');
            target.searchParams.set('client_id', v(auth.clientId));
            target.searchParams.set('redirect_uri', `http://127.0.0.1:${port}/callback`);
            target.searchParams.set('code_challenge', challenge);
            target.searchParams.set('code_challenge_method', 'S256');
            target.searchParams.set('state', state);
            if (auth.scope) target.searchParams.set('scope', v(auth.scope));
            void vscode.env.openExternal(vscode.Uri.parse(target.toString()));
          });
        },
      );
      form.set('grant_type', 'authorization_code');
      form.set('code', code);
      form.set('redirect_uri', redirectUri);
      form.set('code_verifier', verifier);
    }
    form.set('client_id', v(auth.clientId));
    const headers: Array<[string, string]> = [
      ['Content-Type', 'application/x-www-form-urlencoded'],
      ['Accept', 'application/json'],
    ];
    if (auth.clientSecret)
      headers.push([
        'Authorization',
        `Basic ${Buffer.from(`${encodeURIComponent(v(auth.clientId))}:${encodeURIComponent(v(auth.clientSecret))}`).toString('base64')}`,
      ]);
    const response = await send(
      {
        method: 'POST',
        url: tokenUrl,
        headers,
        body: { kind: 'text', text: form.toString() },
        timeoutMs: 30000,
        followRedirects: false,
        missing: [],
      },
      { signal },
    );
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(response.text || '{}');
    } catch {
      /* reported below */
    }
    if (response.status >= 400 || typeof body.access_token !== 'string')
      throw new Error(
        `The token request failed (${response.status}): ${String(body.error_description || body.error || 'no access_token in the response')}`,
      );
    const expires =
      Date.now() + (typeof body.expires_in === 'number' ? body.expires_in * 1000 : 3600000);
    this.tokens.set(cacheKey, { token: body.access_token, expires });
    return body.access_token;
  }

  // -------------------------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------------------------
  async send(
    request: ApiRequest,
    ctx: SendContext,
    check?: (url: URL, kind: TargetKind) => Promise<void>,
  ): Promise<{
    response?: ApiResponse;
    error?: string;
    tests: TestRun;
    missing: string[];
    historyId: string;
  }> {
    if (!vscode.workspace.isTrusted)
      throw new Error('Sending requests needs a trusted workspace (Manage Workspace Trust).');
    const { vars, secrets, inherited } = await this.variables(
      ctx.collection,
      ctx.environment,
      request,
    );
    let auth: AuthConfig = request.auth.type === 'inherit' ? inherited : request.auth;
    if (auth.type === 'oauth2') {
      const token = await this.oauthToken(auth, vars, ctx.signal);
      secrets.push(token);
      auth = { type: 'bearer', token };
    }
    const resolved = resolveRequest(request, vars, auth);
    const entry: HistoryEntry = {
      id: randomUUID(),
      at: Date.now(),
      name: request.name,
      method: resolved.method,
      url: this.redact(redactUrl(resolved.url), secrets),
      ...(ctx.ref ? { ref: ctx.ref } : {}),
    };
    const maxMb = vscode.workspace
      .getConfiguration('notespace')
      .get<number>('api.maxResponseMB', 10);
    try {
      const response = await send(resolved, {
        signal: ctx.signal,
        maxBytes: Math.max(1, Math.min(200, maxMb)) * 1024 * 1024,
        check,
      });
      const tests = runTests(
        // Expected values may use {{variables}} (for example extracted by an earlier request).
        request.tests ? interpolate(request.tests, vars) : undefined,
        {
          status: response.status,
          headers: response.headers,
          body: response.text || '',
          ms: response.ms,
          size: response.size,
        },
        request.responseSchema,
      );
      // Extracted values are session variables; they are never written to files.
      Object.assign(this.runtime, tests.variables);
      Object.assign(entry, { status: response.status, ms: response.ms, size: response.size });
      await this.addHistory(entry);
      return { response, tests, missing: resolved.missing, historyId: entry.id };
    } catch (e) {
      entry.error = this.redact(e instanceof Error ? e.message : String(e), secrets);
      await this.addHistory(entry);
      return {
        error: entry.error,
        tests: { results: [], variables: {} },
        missing: resolved.missing,
        historyId: entry.id,
      };
    }
  }

  private redact(text: string, secrets: string[]) {
    let out = text;
    for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('***');
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // History (no bodies, no credentials)
  // -------------------------------------------------------------------------------------------
  history(): HistoryEntry[] {
    return this.context.workspaceState.get<HistoryEntry[]>(HISTORY_KEY, []);
  }
  private async addHistory(entry: HistoryEntry) {
    const limit = Math.max(
      0,
      Math.min(
        5000,
        vscode.workspace.getConfiguration('notespace').get<number>('api.historyLimit', 200),
      ),
    );
    await this.context.workspaceState.update(
      HISTORY_KEY,
      limit ? [entry, ...this.history()].slice(0, limit) : [],
    );
    this.emitter.fire();
  }
  async clearHistory() {
    await this.context.workspaceState.update(HISTORY_KEY, []);
    this.emitter.fire();
  }

  dispose() {
    this.subscriptions.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}

export type { Collection, CollectionItem };

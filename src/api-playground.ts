import * as vscode from 'vscode';
import { embedError } from './embed-errors';
import { randomBytes } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { WikiWorkspace } from './workspace';
import {
  ApiSpec,
  buildRequest,
  Credential,
  parseOpenApi,
  RequestInput,
  renderApiReference,
} from './core/openapi';
import { Page } from './core/model';
import { findGenerated, generateApiPages, planRegeneration } from './core/api-pages';
import { insidePath, posix, splitTarget } from './core/paths';
import { escapeHtml, highlightCode } from './core/render';
import { tokensCss } from './core/design';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  changesData,
  classifyAddress,
  classifyHost,
  TargetKind,
  worstKind,
} from './core/net-safety';

const inert = new MarkdownIt({ html: false, linkify: true });
const MAX_RESPONSE = 1024 * 1024;

/** True when the first bytes of a YAML/JSON file declare OpenAPI 3. */
export const looksLikeOpenApi = (text: string) =>
  /^\s*["']?openapi["']?\s*:\s*["']?3\./m.test(text.slice(0, 4096));

export async function findApiDescriptions(workspace: WikiWorkspace): Promise<vscode.Uri[]> {
  const found: vscode.Uri[] = [];
  for (const root of workspace.roots) {
    const base = root.projectUri || root.uri;
    for (const uri of await vscode.workspace.findFiles(
      new vscode.RelativePattern(base, '**/*.{yaml,yml,json}'),
      '**/{node_modules,.git,dist}/**',
      500,
    )) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (looksLikeOpenApi(new TextDecoder().decode(bytes.subarray(0, 4096)))) found.push(uri);
      } catch {
        /* unreadable files are skipped */
      }
    }
  }
  return found;
}

/** Prepares ```openapi embeds (`path: api/pets.yaml`) as static references. */
export async function openApiRenderer(
  workspace: WikiWorkspace,
  page: Page,
): Promise<(source: string) => string> {
  const root = workspace.rootFor(page);
  const loaded = new Map<string, string>();
  for (const match of page.text.matchAll(/^```openapi[^\n]*\n([\s\S]*?)^```/gm)) {
    const path = /^\s*path\s*:\s*(.+?)\s*$/m.exec(match[1])?.[1];
    if (!path || loaded.has(path)) continue;
    try {
      const target = splitTarget(path).path;
      const file = posix.normalize(
        target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(page.path), target),
      );
      if (!insidePath(file) || !/\.(ya?ml|json)$/i.test(file))
        throw new Error('Use a YAML or JSON file inside the wiki.');
      const uri = vscode.Uri.joinPath(root.uri, file);
      await workspace.assertNoSymlink(root, uri);
      const spec = parseOpenApi(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
      loaded.set(
        path,
        renderApiReference(spec, (md) => inert.render(md), highlightCode),
      );
    } catch (e) {
      loaded.set(
        path,
        `<p class="diagram-error">API description unavailable: ${escapeHtml(embedError(e, path))}</p>`,
      );
    }
  }
  return (source) => {
    const path = /^\s*path\s*:\s*(.+?)\s*$/m.exec(source)?.[1];
    return (
      (path && loaded.get(path)) ||
      '<p class="diagram-error">API description unavailable: add "path: file.yaml".</p>'
    );
  };
}

interface Response {
  status: number;
  statusText: string;
  ms: number;
  headers: Array<[string, string]>;
  body: string;
  truncated: boolean;
}

export interface Question {
  message: string;
  detail: string;
  button: string;
}
export type Confirm = (question: Question) => Promise<boolean>;
const modal: Confirm = async (q) =>
  (await vscode.window.showWarningMessage(
    q.message,
    { modal: true, detail: q.detail },
    q.button,
  )) === q.button;

/** Where the request would go, after DNS: the most sensitive address of the host. */
async function targetKind(url: URL): Promise<TargetKind> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const named = classifyHost(host);
  if (named !== 'public' || isIP(host)) return named;
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return worstKind(addresses.map((a) => classifyAddress(a.address)));
  } catch {
    return 'public'; // the request itself will report the DNS failure
  }
}

/**
 * Sends one request. Credentials come from SecretStorage only and never reach the webview,
 * Markdown, logs or exports. Nothing is sent without explicit approval: the first request to
 * each origin, every request to this machine or the local network (approved separately, so a
 * name that starts resolving to a private address asks again), and every request that may
 * change data (POST, PUT, PATCH, DELETE…). Cloud metadata services are refused.
 */
export async function sendApiRequest(
  context: vscode.ExtensionContext,
  specUri: vscode.Uri,
  spec: ApiSpec,
  operationId: string,
  input: RequestInput,
  confirm: Confirm = modal,
): Promise<Response | undefined> {
  // An untrusted repository's description could point requests at internal services.
  if (!vscode.workspace.isTrusted)
    throw new Error('Sending requests needs a trusted workspace (Manage Workspace Trust).');
  const operation = spec.operations.find((o) => o.id === operationId);
  if (!operation) throw new Error('Unknown operation.');
  const credentials: Credential[] = [];
  for (const name of operation.security) {
    const scheme = spec.schemes.find((s) => s.name === name);
    const value = scheme && (await context.secrets.get(secretKey(specUri, name)));
    if (scheme && value) credentials.push({ scheme, value });
  }
  const request = buildRequest(operation, input, credentials);
  const url = new URL(request.url);
  const origin = url.origin;
  const kind = await targetKind(url);
  if (kind === 'metadata')
    throw new Error(
      `${url.hostname} is a cloud metadata service; the playground never sends requests there.`,
    );
  const local = kind !== 'public';
  const key = local ? 'api.allowedLocalOrigins' : 'api.allowedOrigins';
  const allowed = context.workspaceState.get<string[]>(key, []);
  const from = vscode.env.remoteName ? 'the remote host' : 'this machine';
  if (!allowed.includes(origin)) {
    const where =
      kind === 'loopback'
        ? `${origin} is on ${from} (loopback).`
        : kind === 'link-local'
          ? `${origin} is a link-local address.`
          : kind === 'private'
            ? `${origin} is on your local or private network.`
            : '';
    const ok = await confirm({
      message: `Allow NoteSpace to send requests to ${origin}?`,
      detail: `${where ? `${where} Only allow it if you trust this API description: it could reach services that are not exposed to the internet. ` : ''}${credentials.length ? 'Stored credentials for this API will be included. ' : ''}Requests are sent from ${from} only when you press Send.`,
      button: 'Allow',
    });
    if (!ok) return undefined;
    await context.workspaceState.update(key, [...allowed, origin]);
  }
  if (changesData(request.method)) {
    const ok = await confirm({
      message: `Send ${request.method} ${url.origin}${url.pathname}?`,
      detail: `${request.method} requests may create, change or delete data on the server.${credentials.length ? ' Stored credentials are included.' : ''}`,
      button: 'Send',
    });
    if (!ok) return undefined;
  }
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30000);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: abort.signal,
      redirect: 'manual',
    });
    const buffer = new Uint8Array(await response.arrayBuffer());
    let body = new TextDecoder().decode(buffer.subarray(0, MAX_RESPONSE));
    if (/json/.test(response.headers.get('content-type') || ''))
      try {
        body = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        /* keep the raw body */
      }
    const headers: Array<[string, string]> = [];
    response.headers.forEach((value, key) => {
      if (!/^set-cookie$/i.test(key)) headers.push([key, value]);
    });
    return {
      status: response.status,
      statusText: response.statusText,
      ms: Date.now() - started,
      headers,
      body,
      truncated: buffer.length > MAX_RESPONSE,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'The request timed out after 30 s.'
          : (error.cause as Error | undefined)?.message || error.message
        : String(error);
    throw new Error(`Request failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

export const secretKey = (specUri: vscode.Uri, scheme: string) =>
  `notespace.api:${specUri.toString()}:${scheme}`;

let panel: vscode.WebviewPanel | undefined;
let panelSpec: { uri: vscode.Uri; reload: () => Promise<void> } | undefined;
/** Shows the new version of an API description in the open playground. */
export async function refreshPlayground(uri: vscode.Uri): Promise<void> {
  if (panel && panelSpec?.uri.toString() === uri.toString()) await panelSpec.reload();
}
export async function openApiPlayground(
  context: vscode.ExtensionContext,
  specUri: vscode.Uri,
): Promise<void> {
  let spec = parseOpenApi(new TextDecoder().decode(await vscode.workspace.fs.readFile(specUri)));
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'notespace.api',
      'API Playground',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      panelSpec = undefined;
    });
  }
  const current = panel;
  current.title = `API: ${spec.title}`;
  const nonce = randomBytes(18).toString('base64');
  const script = current.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'api.js'),
  );
  current.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'"><title>API Playground</title><style>${tokensCss}</style></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  const presence = async () =>
    Object.fromEntries(
      await Promise.all(
        spec.schemes.map(async (s) => [
          s.name,
          !!(await context.secrets.get(secretKey(specUri, s.name))),
        ]),
      ),
    );
  panelSpec = {
    uri: specUri,
    reload: async () => {
      try {
        spec = parseOpenApi(new TextDecoder().decode(await vscode.workspace.fs.readFile(specUri)));
        current.title = `API: ${spec.title}`;
        await current.webview.postMessage({
          type: 'spec',
          spec,
          file: posix.basename(specUri.path),
          credentials: await presence(),
          updated: true,
        });
      } catch (e) {
        // A half-saved description keeps the last valid one on screen.
        await current.webview.postMessage({
          type: 'specError',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
  const listener = current.webview.onDidReceiveMessage(async (m: Record<string, unknown>) => {
    try {
      if (m.type === 'ready')
        await current.webview.postMessage({
          type: 'spec',
          spec,
          file: posix.basename(specUri.path),
          credentials: await presence(),
        });
      else if (m.type === 'setCredential' && typeof m.scheme === 'string') {
        const scheme = spec.schemes.find((s) => s.name === m.scheme);
        if (!scheme) return;
        const value = await vscode.window.showInputBox({
          title: `Credential for ${scheme.name}`,
          prompt:
            scheme.type === 'http' && scheme.scheme === 'basic'
              ? 'user:password'
              : scheme.type === 'apiKey'
                ? `Value for ${scheme.parameter}`
                : 'Token',
          password: true,
          ignoreFocusOut: true,
        });
        if (value) await context.secrets.store(secretKey(specUri, scheme.name), value);
        await current.webview.postMessage({ type: 'credentials', credentials: await presence() });
      } else if (m.type === 'clearCredential' && typeof m.scheme === 'string') {
        await context.secrets.delete(secretKey(specUri, m.scheme));
        await current.webview.postMessage({ type: 'credentials', credentials: await presence() });
      } else if (
        m.type === 'send' &&
        typeof m.operationId === 'string' &&
        m.input &&
        typeof m.input === 'object'
      ) {
        const response = await sendApiRequest(
          context,
          specUri,
          spec,
          m.operationId,
          m.input as RequestInput,
        );
        await current.webview.postMessage({ type: 'response', response, cancelled: !response });
      }
    } catch (error) {
      await current.webview.postMessage({
        type: 'response',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  current.onDidDispose(() => listener.dispose());
  current.reveal();
}

export interface GenerationSummary {
  folder: vscode.Uri;
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Pages whose generated part was edited and kept as is. */
  kept: string[];
  /** Files without generation markers, never replaced. */
  skipped: string[];
}

/**
 * Writes reference pages for an API description into `folder`. Generated parts that were
 * edited by hand are conflicts: `resolve` decides (the command asks; tests answer directly).
 */
export async function generateApiReference(
  workspace: WikiWorkspace,
  specUri: vscode.Uri,
  folder: vscode.Uri,
  resolve: (file: vscode.Uri, replacement: string) => Promise<'replace' | 'keep'>,
): Promise<GenerationSummary> {
  const root = workspace.roots.find(
    (r) =>
      folder.path === r.uri.path || folder.path.startsWith(r.uri.path.replace(/\/$/, '') + '/'),
  );
  if (!root) throw new Error('Choose a folder inside a wiki.');
  const spec = parseOpenApi(new TextDecoder().decode(await vscode.workspace.fs.readFile(specUri)));
  const summary: GenerationSummary = {
    folder,
    created: [],
    updated: [],
    unchanged: [],
    kept: [],
    skipped: [],
  };
  await vscode.workspace.fs.createDirectory(folder);
  for (const page of generateApiPages(spec)) {
    const file = vscode.Uri.joinPath(folder, page.file);
    await workspace.assertNoSymlink(root, file);
    const source = posix.relative(posix.dirname(file.path), specUri.path);
    let existing: string | undefined;
    try {
      existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    } catch {
      existing = undefined;
    }
    const plan = planRegeneration(existing, source, page.body);
    const write = (text: string) =>
      vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
    if (plan.action === 'create') {
      await write(plan.text);
      summary.created.push(page.file);
    } else if (plan.action === 'update') {
      await write(plan.text);
      summary.updated.push(page.file);
    } else if (plan.action === 'unchanged') summary.unchanged.push(page.file);
    else if (plan.action === 'unmanaged') summary.skipped.push(page.file);
    else if ((await resolve(file, plan.text)) === 'replace') {
      await write(plan.text);
      summary.updated.push(page.file);
    } else summary.kept.push(page.file);
  }
  await workspace.refresh();
  return summary;
}

/** Pages generated from `specUri` whose generated part no longer matches the description. */
export async function staleGeneratedPages(
  workspace: WikiWorkspace,
  specUri: vscode.Uri,
): Promise<Page[]> {
  const spec = parseOpenApi(new TextDecoder().decode(await vscode.workspace.fs.readFile(specUri)));
  const bodies = new Map(generateApiPages(spec).map((p) => [p.file, p.body]));
  const out: Page[] = [];
  for (const page of workspace.index.all()) {
    const part = findGenerated(page.text);
    if (!part) continue;
    const pageUri = vscode.Uri.parse(page.uri);
    if (vscode.Uri.joinPath(pageUri, '..', part.source).path !== specUri.path) continue;
    const body = bodies.get(posix.basename(pageUri.path));
    const plan = planRegeneration(page.text, part.source, body ?? '');
    if (body === undefined || plan.action !== 'unchanged') out.push(page);
  }
  return out;
}

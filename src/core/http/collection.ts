import { ApiRequest, AuthConfig, BodyType, HTTP_METHODS, HttpMethod, KeyValue } from './model';

/**
 * Collections are folders of small JSON files, readable and diff-friendly in Git:
 *
 *   api/
 *     my-apis/
 *       collection.json            name, variables, default auth, order of top-level items
 *       authentication/
 *         folder.json              name and order of the folder's items
 *         login.request.json       one request
 *       get-users.request.json
 *     environments/
 *       local.env.json             variables; secret values live in VS Code SecretStorage
 *
 * A request's id is its path in the collection without the suffix (`authentication/login`);
 * Markdown blocks reference `collection: my-apis/authentication/login`.
 */
export const COLLECTION_SCHEMA = 1;
export const REQUEST_SUFFIX = '.request.json';

export interface CollectionMeta {
  schemaVersion: number;
  type: 'wiki-studio.collection';
  name: string;
  description?: string;
  variables: KeyValue[];
  auth: AuthConfig;
  order: string[];
}
export interface FolderMeta {
  name: string;
  order: string[];
}
export type CollectionItem =
  | { kind: 'folder'; path: string; name: string; items: CollectionItem[] }
  | { kind: 'request'; path: string; request: ApiRequest };
export interface Collection {
  id: string;
  meta: CollectionMeta;
  items: CollectionItem[];
  /** Files that could not be read, with the reason. */
  problems: string[];
}

export interface Environment {
  schemaVersion: number;
  name: string;
  /** `secret` variables have no value here: the value is in SecretStorage. */
  variables: Array<KeyValue & { secret?: boolean }>;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown, max = 10000) => (typeof v === 'string' ? v.slice(0, max) : '');
const rows = (v: unknown): KeyValue[] =>
  (Array.isArray(v) ? v : [])
    .map((r) => obj(r))
    .filter((r) => typeof r.key === 'string')
    .slice(0, 500)
    .map((r) => ({
      key: str(r.key, 500),
      value: str(r.value, 100000),
      ...(r.enabled === false ? { enabled: false } : {}),
      ...(r.file === true ? { file: true } : {}),
      ...(r.secret === true ? { secret: true } : {}),
    }));

export function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

export function parseAuth(raw: unknown): AuthConfig {
  const a = obj(raw);
  switch (a.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: str(a.token) };
    case 'basic':
      return { type: 'basic', username: str(a.username), password: str(a.password) };
    case 'apikey':
      return {
        type: 'apikey',
        key: str(a.key),
        value: str(a.value),
        in: a.in === 'query' ? 'query' : 'header',
      };
    case 'oauth2':
      return {
        type: 'oauth2',
        grant: a.grant === 'authorization_code' ? 'authorization_code' : 'client_credentials',
        tokenUrl: str(a.tokenUrl),
        ...(a.authUrl ? { authUrl: str(a.authUrl) } : {}),
        clientId: str(a.clientId),
        ...(a.clientSecret ? { clientSecret: str(a.clientSecret) } : {}),
        ...(a.scope ? { scope: str(a.scope) } : {}),
      };
    default:
      return { type: 'inherit' };
  }
}

export function parseRequest(text: string, id: string): ApiRequest {
  let raw: Record<string, unknown>;
  try {
    raw = obj(JSON.parse(text));
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const version = raw.schemaVersion ?? 1;
  if (typeof version !== 'number' || version > COLLECTION_SCHEMA)
    throw new Error(
      `schemaVersion ${String(version)} is newer than this version of NoteSpace understands.`,
    );
  const method = String(raw.method || 'GET').toUpperCase();
  const body = obj(raw.body);
  const types: BodyType[] = ['none', 'json', 'text', 'xml', 'form', 'multipart', 'binary'];
  return {
    id,
    name: str(raw.name, 200) || id.split('/').pop()!,
    method: ((HTTP_METHODS as readonly string[]).includes(method) ? method : 'GET') as HttpMethod,
    url: str(raw.url, 8000),
    params: rows(raw.params),
    headers: rows(raw.headers),
    ...(Array.isArray(raw.cookies) ? { cookies: rows(raw.cookies) } : {}),
    body: {
      type: types.includes(body.type as BodyType) ? (body.type as BodyType) : 'none',
      ...(typeof body.text === 'string' ? { text: body.text } : {}),
      ...(Array.isArray(body.fields) ? { fields: rows(body.fields) } : {}),
    },
    auth: parseAuth(raw.auth),
    ...(Array.isArray(raw.variables) ? { variables: rows(raw.variables) } : {}),
    ...(typeof raw.tests === 'string' ? { tests: raw.tests } : {}),
    ...(typeof raw.timeoutMs === 'number' ? { timeoutMs: raw.timeoutMs } : {}),
    ...(typeof raw.followRedirects === 'boolean' ? { followRedirects: raw.followRedirects } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(raw.responseSchema && typeof raw.responseSchema === 'object'
      ? { responseSchema: obj(raw.responseSchema) }
      : {}),
  };
}

/** Stable, readable JSON for a request file (no id: the file path is the id). */
export function serializeRequest(req: ApiRequest): string {
  const out: Record<string, unknown> = {
    schemaVersion: COLLECTION_SCHEMA,
    name: req.name,
    method: req.method,
    url: req.url,
  };
  if (req.description) out.description = req.description;
  if (req.params.length) out.params = req.params;
  if (req.headers.length) out.headers = req.headers;
  if (req.cookies?.length) out.cookies = req.cookies;
  if (req.body.type !== 'none') out.body = req.body;
  if (req.auth.type !== 'inherit') out.auth = req.auth;
  if (req.variables?.length) out.variables = req.variables;
  if (req.tests?.trim()) out.tests = req.tests;
  if (req.timeoutMs !== undefined) out.timeoutMs = req.timeoutMs;
  if (req.followRedirects === false) out.followRedirects = false;
  if (req.responseSchema) out.responseSchema = req.responseSchema;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function parseCollectionMeta(text: string): CollectionMeta {
  const raw = obj(JSON.parse(text));
  const version = raw.schemaVersion ?? 1;
  if (typeof version !== 'number' || version > COLLECTION_SCHEMA)
    throw new Error(
      `schemaVersion ${String(version)} is newer than this version of NoteSpace understands.`,
    );
  return {
    schemaVersion: COLLECTION_SCHEMA,
    type: 'wiki-studio.collection',
    name: str(raw.name, 200) || 'Collection',
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    variables: rows(raw.variables),
    auth: raw.auth ? parseAuth(raw.auth) : { type: 'none' },
    order: Array.isArray(raw.order)
      ? raw.order.filter((x): x is string => typeof x === 'string')
      : [],
  };
}
export const serializeCollectionMeta = (meta: CollectionMeta) =>
  `${JSON.stringify({ ...meta, schemaVersion: COLLECTION_SCHEMA, type: 'wiki-studio.collection' }, null, 2)}\n`;

export function parseEnvironment(text: string, fallbackName: string): Environment {
  const raw = obj(JSON.parse(text));
  return {
    schemaVersion: COLLECTION_SCHEMA,
    name: str(raw.name, 200) || fallbackName,
    variables: rows(raw.variables).map((v) =>
      v.secret ? { key: v.key, value: '', secret: true } : v,
    ),
  };
}
/** Secret values are never written to the file. */
export const serializeEnvironment = (env: Environment) =>
  `${JSON.stringify({ schemaVersion: COLLECTION_SCHEMA, name: env.name, variables: env.variables.map((v) => (v.secret ? { key: v.key, value: '', secret: true } : v)) }, null, 2)}\n`;

/**
 * Builds the tree from the files of one collection folder (`files`: path relative to the
 * collection → text). Order follows `order` lists; other items follow alphabetically.
 */
export function buildCollection(id: string, files: Map<string, string>): Collection {
  const problems: string[] = [];
  let meta: CollectionMeta;
  try {
    meta = parseCollectionMeta(files.get('collection.json') || '{}');
  } catch (e) {
    problems.push(`collection.json: ${e instanceof Error ? e.message : String(e)}`);
    meta = {
      schemaVersion: COLLECTION_SCHEMA,
      type: 'wiki-studio.collection',
      name: id,
      variables: [],
      auth: { type: 'none' },
      order: [],
    };
  }
  const build = (dir: string, order: string[]): CollectionItem[] => {
    const prefix = dir ? `${dir}/` : '';
    const children = new Map<string, CollectionItem>();
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) {
        const name = rest.slice(0, slash);
        if (children.has(name)) continue;
        const folderPath = `${prefix}${name}`;
        let folder: FolderMeta = { name, order: [] };
        const metaText = files.get(`${folderPath}/folder.json`);
        if (metaText)
          try {
            const raw = obj(JSON.parse(metaText));
            folder = {
              name: str(raw.name, 200) || name,
              order: Array.isArray(raw.order)
                ? raw.order.filter((x): x is string => typeof x === 'string')
                : [],
            };
          } catch (e) {
            problems.push(
              `${folderPath}/folder.json: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        children.set(name, {
          kind: 'folder',
          path: folderPath,
          name: folder.name,
          items: build(folderPath, folder.order),
        });
      } else if (rest.endsWith(REQUEST_SUFFIX)) {
        const reqId = `${prefix}${rest.slice(0, -REQUEST_SUFFIX.length)}`;
        try {
          children.set(rest, {
            kind: 'request',
            path: reqId,
            request: parseRequest(files.get(path)!, reqId),
          });
        } catch (e) {
          problems.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    const ordered: CollectionItem[] = [];
    for (const key of order) {
      const item = children.get(key) || children.get(`${key}${REQUEST_SUFFIX}`);
      if (item && !ordered.includes(item)) ordered.push(item);
    }
    const rest = [...children.entries()]
      .filter(([, item]) => !ordered.includes(item))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, item]) => item);
    return [...ordered, ...rest];
  };
  return { id, meta, items: build('', meta.order), problems };
}

export function* walkRequests(items: CollectionItem[]): Generator<ApiRequest> {
  for (const item of items) {
    if (item.kind === 'request') yield item.request;
    else yield* walkRequests(item.items);
  }
}

/** A single-file bundle for export/import. Secret values are never included. */
export interface CollectionBundle {
  format: 'wiki-studio.collection-bundle';
  schemaVersion: number;
  meta: CollectionMeta;
  files: Record<string, string>;
}
export function bundleCollection(
  meta: CollectionMeta,
  files: Map<string, string>,
): CollectionBundle {
  return {
    format: 'wiki-studio.collection-bundle',
    schemaVersion: COLLECTION_SCHEMA,
    meta,
    files: Object.fromEntries(
      [...files].filter(
        ([p]) => p !== 'collection.json' && /^[\w./-]+$/.test(p) && !p.split('/').includes('..'),
      ),
    ),
  };
}
export function readBundle(text: string): CollectionBundle {
  const raw = obj(JSON.parse(text));
  if (raw.format !== 'wiki-studio.collection-bundle')
    throw new Error('This is not a NoteSpace collection export.');
  const files = obj(raw.files);
  const safe: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (
      !/^[\w./-]+$/.test(path) ||
      path.split('/').some((p) => p === '..' || p === '' || p.startsWith('.'))
    )
      throw new Error(`Unsafe path in the export: ${path}`);
    if (typeof content !== 'string') throw new Error(`${path}: content must be text.`);
    if (!path.endsWith(REQUEST_SUFFIX) && !path.endsWith('/folder.json'))
      throw new Error(`Unexpected file in the export: ${path}`);
    safe[path] = content;
  }
  return {
    format: 'wiki-studio.collection-bundle',
    schemaVersion: COLLECTION_SCHEMA,
    meta: parseCollectionMeta(JSON.stringify(raw.meta || {})),
    files: safe,
  };
}

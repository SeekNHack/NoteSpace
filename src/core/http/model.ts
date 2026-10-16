/**
 * API client request model, shared by the API Client, collections, ```http blocks, the curl
 * importer and the code generators. Everything is plain data (no functions) so it can be stored
 * as JSON and sent to webviews; credentials are never part of it (see `AuthConfig`).
 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface KeyValue {
  key: string;
  value: string;
  /** Unchecked rows stay in the request but are not sent. */
  enabled?: boolean;
  /** Form fields: a file path (relative to the workspace) instead of text. */
  file?: boolean;
  /** Environment variables: the value lives in SecretStorage, not in the file. */
  secret?: boolean;
}

export type BodyType = 'none' | 'json' | 'text' | 'xml' | 'form' | 'multipart' | 'binary';
export interface RequestBody {
  type: BodyType;
  /** json, text, xml: the text. binary: a workspace-relative file path. */
  text?: string;
  /** form, multipart */
  fields?: KeyValue[];
}

/**
 * Authentication settings. Secret values are not stored here: `secret` names an entry in VS Code
 * SecretStorage, and `{{variables}}` (including secret variables) are resolved at send time.
 */
export type AuthConfig =
  | { type: 'none' }
  | { type: 'inherit' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }
  | {
      type: 'oauth2';
      grant: 'client_credentials' | 'authorization_code';
      tokenUrl: string;
      authUrl?: string;
      clientId: string;
      clientSecret?: string;
      scope?: string;
    };

export interface ApiRequest {
  /** Stable id within a collection. */
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  cookies?: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  /** Request-local variables (highest precedence). */
  variables?: KeyValue[];
  /** Assertions and extractions, one per line (see core/http/tests.ts). */
  tests?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
  description?: string;
  /** Expected JSON response (from OpenAPI), used by the `schema` test. */
  responseSchema?: Record<string, unknown>;
}

export const emptyRequest = (id = 'new', name = 'New request'): ApiRequest => ({
  id,
  name,
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  body: { type: 'none' },
  auth: { type: 'inherit' },
});

const enabled = (rows: KeyValue[] | undefined) =>
  (rows || []).filter((r) => r.enabled !== false && r.key);

// ---------------------------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------------------------

/**
 * Variable scopes, from lowest to highest precedence: global < collection < environment <
 * runtime (values extracted by tests in this session) < request. A later scope overrides an
 * earlier one; unknown variables are left as written and reported.
 */
export interface VariableScopes {
  global?: Record<string, string>;
  collection?: Record<string, string>;
  environment?: Record<string, string>;
  runtime?: Record<string, string>;
  request?: Record<string, string>;
}
export function mergeVariables(scopes: VariableScopes): Record<string, string> {
  return {
    ...scopes.global,
    ...scopes.collection,
    ...scopes.environment,
    ...scopes.runtime,
    ...scopes.request,
  };
}

const VAR = /\{\{\s*([A-Za-z_$][\w.$-]{0,99})\s*\}\}/g;
/** Replaces `{{name}}`; values may themselves contain variables (resolved up to 5 levels). */
export function interpolate(
  text: string,
  vars: Record<string, string>,
  missing?: Set<string>,
): string {
  let out = text;
  for (let depth = 0; depth < 5 && VAR.test(out); depth++) {
    VAR.lastIndex = 0;
    out = out.replace(VAR, (whole, name: string) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
      missing?.add(name);
      return whole;
    });
  }
  VAR.lastIndex = 0;
  return out;
}
export const variablesIn = (text: string): string[] => [
  ...new Set([...text.matchAll(VAR)].map((m) => m[1])),
];

// ---------------------------------------------------------------------------------------------
// Resolution into a concrete request
// ---------------------------------------------------------------------------------------------
export interface ResolvedRequest {
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body?:
    | { kind: 'text'; text: string }
    | { kind: 'form'; fields: Array<[string, string]> }
    | { kind: 'multipart'; fields: Array<{ name: string; value: string; file?: boolean }> }
    | { kind: 'file'; path: string };
  timeoutMs: number;
  followRedirects: boolean;
  /** Variables that had no value. */
  missing: string[];
}

const contentTypes: Partial<Record<BodyType, string>> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  form: 'application/x-www-form-urlencoded',
};

/**
 * Applies variables, query parameters, cookies, body and (already resolved) authentication.
 * `auth` must have its variables and secrets resolved by the caller.
 */
export function resolveRequest(
  req: ApiRequest,
  vars: Record<string, string>,
  auth?: AuthConfig,
): ResolvedRequest {
  const missing = new Set<string>();
  const v = (s: string) => interpolate(s, vars, missing);
  const raw = v(req.url.trim());
  if (!raw) throw new Error('Enter a URL.');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(
      `“${raw}” is not a valid URL${missing.size ? ` (missing variables: ${[...missing].join(', ')})` : ''}.`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Only http and https URLs can be requested.');
  for (const p of enabled(req.params)) url.searchParams.append(v(p.key), v(p.value));
  const headers: Array<[string, string]> = [];
  const hasHeader = (name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());
  for (const h of enabled(req.headers)) {
    const name = v(h.key).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
      throw new Error(`“${name}” is not a valid header name.`);
    headers.push([name, v(h.value).replace(/[\r\n]+/g, ' ')]);
  }
  const cookies = enabled(req.cookies).map((c) => `${v(c.key)}=${v(c.value)}`);
  if (cookies.length) {
    const existing = headers.findIndex(([k]) => k.toLowerCase() === 'cookie');
    if (existing >= 0) headers[existing][1] += `; ${cookies.join('; ')}`;
    else headers.push(['Cookie', cookies.join('; ')]);
  }
  const a = auth || req.auth;
  if (a.type === 'bearer' && a.token) headers.push(['Authorization', `Bearer ${v(a.token)}`]);
  else if (a.type === 'basic' && (a.username || a.password))
    headers.push(['Authorization', `Basic ${toBase64(`${v(a.username)}:${v(a.password)}`)}`]);
  else if (a.type === 'apikey' && a.key) {
    if (a.in === 'query') url.searchParams.set(v(a.key), v(a.value));
    else headers.push([v(a.key), v(a.value)]);
  }
  let body: ResolvedRequest['body'];
  const noBody = req.method === 'GET' || req.method === 'HEAD';
  if (!noBody && req.body.type !== 'none') {
    const b = req.body;
    if (b.type === 'json' || b.type === 'text' || b.type === 'xml') {
      const text = v(b.text || '');
      if (b.type === 'json' && text.trim()) {
        try {
          JSON.parse(text);
        } catch (e) {
          throw new Error(
            `The JSON body is not valid: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      body = { kind: 'text', text };
    } else if (b.type === 'form')
      body = { kind: 'form', fields: enabled(b.fields).map((f) => [v(f.key), v(f.value)]) };
    else if (b.type === 'multipart')
      body = {
        kind: 'multipart',
        fields: enabled(b.fields).map((f) => ({ name: v(f.key), value: v(f.value), file: f.file })),
      };
    else if (b.type === 'binary' && b.text) body = { kind: 'file', path: v(b.text) };
    const type = contentTypes[b.type];
    if (type && !hasHeader('content-type')) headers.push(['Content-Type', type]);
  }
  return {
    method: req.method,
    url: url.toString(),
    headers,
    body,
    timeoutMs: Math.min(Math.max(req.timeoutMs ?? 30000, 100), 600000),
    followRedirects: req.followRedirects !== false,
    missing: [...missing],
  };
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ---------------------------------------------------------------------------------------------
// Redaction (history, logs, exports)
// ---------------------------------------------------------------------------------------------
const SENSITIVE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|x-auth-token|x-access-token|token|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|passwd|secret|signature|sig|session|sessionid|key)$/i;
export const isSensitiveName = (name: string) => SENSITIVE.test(name.trim());

/** A URL safe to store: sensitive query values and user info replaced by `***`. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = url.username ? '***' : '';
      url.password = url.password ? '***' : '';
    }
    for (const key of [...new Set(url.searchParams.keys())])
      if (isSensitiveName(key)) url.searchParams.set(key, '***');
    return url.toString().replace(/%2A%2A%2A/g, '***');
  } catch {
    return raw.replace(/([?&](?:token|access_token|api_key|key|password)=)[^&#]*/gi, '$1***');
  }
}
export const redactHeaders = (headers: Array<[string, string]>): Array<[string, string]> =>
  headers.map(([k, v]) => [k, isSensitiveName(k) ? '***' : v]);

import { parse as parseYaml } from 'yaml';
import { schemaRows, typeName } from './api-schema';
export { schemaRows, typeName } from './api-schema';
export type { SchemaRow } from './api-schema';

/** OpenAPI 3.x reference model. Only local `#/...` references are resolved; nothing is fetched. */
export interface ApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  description?: string;
  schema?: Record<string, unknown>;
  example?: unknown;
}
export interface ApiOperation {
  id: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  parameters: ApiParameter[];
  requestBody?: {
    contentType: string;
    required: boolean;
    schema?: Record<string, unknown>;
    /** Name in components.schemas when the body is a `$ref` to one. */
    schemaName?: string;
    example?: unknown;
  };
  responses: Array<{
    status: string;
    description?: string;
    contentType?: string;
    schema?: Record<string, unknown>;
    schemaName?: string;
    example?: unknown;
  }>;
  security: string[];
}
export interface ApiScheme {
  name: string;
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS';
  scheme?: string;
  in?: 'header' | 'query' | 'cookie';
  parameter?: string;
  description?: string;
}
export interface ApiSpec {
  title: string;
  version: string;
  description?: string;
  servers: Array<{ url: string; description?: string }>;
  operations: ApiOperation[];
  schemes: ApiScheme[];
  /** components.schemas, references resolved (recursion cut). */
  schemas: Array<{ name: string; description?: string; schema: Record<string, unknown> }>;
}

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};

export function parseOpenApi(text: string): ApiSpec {
  if (text.length > 10 * 1024 * 1024) throw new Error('The API description is larger than 10 MiB.');
  let doc: Obj;
  try {
    doc = obj(
      text.trimStart().startsWith('{') ? JSON.parse(text) : parseYaml(text, { maxAliasCount: 100 }),
    );
  } catch (e) {
    throw new Error(`Invalid OpenAPI document: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!/^3\.\d+\.\d+$/.test(String(doc.openapi || '')))
    throw new Error('Only OpenAPI 3.x documents are supported (missing "openapi: 3.x.y").');
  const resolve = (value: unknown, seen = new Set<string>()): unknown => {
    const ref = obj(value).$ref;
    if (typeof ref !== 'string') return value;
    if (!ref.startsWith('#/') || seen.has(ref) || seen.size > 32) return {};
    let target: unknown = doc;
    for (const part of ref.slice(2).split('/'))
      target = obj(target)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    return resolve(target, new Set([...seen, ref]));
  };
  const deep = (value: unknown, depth = 0, seen = new Set<string>()): unknown => {
    if (depth > 12) return {};
    const ref = obj(value).$ref;
    if (typeof ref === 'string') {
      if (seen.has(ref)) return { description: `(recursive ${ref.split('/').pop()})` };
      return deep(resolve(value), depth + 1, new Set([...seen, ref]));
    }
    if (Array.isArray(value)) return value.map((v) => deep(v, depth + 1, seen));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, deep(v, depth + 1, seen)]),
      );
    return value;
  };
  // `{ $ref: '#/components/schemas/Pet' }` (also as array items) names the model.
  const modelName = (schema: unknown): string | undefined => {
    const s = obj(schema);
    const ref =
      typeof s.$ref === 'string'
        ? s.$ref
        : typeof obj(s.items).$ref === 'string'
          ? String(obj(s.items).$ref)
          : '';
    const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
    return m ? `${m[1].replace(/~1/g, '/').replace(/~0/g, '~')}${s.items ? '[]' : ''}` : undefined;
  };
  const info = obj(doc.info);
  const components = obj(doc.components);
  const schemes: ApiScheme[] = Object.entries(obj(components.securitySchemes)).map(
    ([name, raw]) => {
      const s = obj(resolve(raw));
      return {
        name,
        type: (String(s.type) as ApiScheme['type']) || 'http',
        scheme: typeof s.scheme === 'string' ? s.scheme.toLowerCase() : undefined,
        in: s.in as ApiScheme['in'],
        parameter: typeof s.name === 'string' ? s.name : undefined,
        description: typeof s.description === 'string' ? s.description : undefined,
      };
    },
  );
  const globalSecurity = Array.isArray(doc.security)
    ? doc.security.flatMap((r) => Object.keys(obj(r)))
    : [];
  const operations: ApiOperation[] = [];
  for (const [path, rawItem] of Object.entries(obj(doc.paths))) {
    const item = obj(resolve(rawItem));
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of methods) {
      if (!item[method]) continue;
      const op = obj(item[method]);
      const parameters = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]
        .map((p) => obj(deep(p)))
        .filter(
          (p) =>
            typeof p.name === 'string' &&
            ['path', 'query', 'header', 'cookie'].includes(String(p.in)),
        )
        .map<ApiParameter>((p) => ({
          name: String(p.name),
          in: p.in as ApiParameter['in'],
          required: p.in === 'path' || p.required === true,
          description: typeof p.description === 'string' ? p.description : undefined,
          schema: obj(p.schema),
          example: p.example ?? obj(p.schema).example,
        }));
      const rawBody = obj(resolve(op.requestBody));
      const body = obj(deep(op.requestBody));
      const content = obj(body.content);
      const contentType =
        Object.keys(content).find((t) => /json/.test(t)) || Object.keys(content)[0];
      const media = obj(content[contentType || '']);
      const rawMedia = obj(obj(rawBody.content)[contentType || '']);
      operations.push({
        id: typeof op.operationId === 'string' ? op.operationId : `${method}-${path}`,
        method: method.toUpperCase(),
        path,
        summary: typeof op.summary === 'string' ? op.summary : undefined,
        description: typeof op.description === 'string' ? op.description : undefined,
        tags: Array.isArray(op.tags) ? op.tags.map(String) : ['Endpoints'],
        parameters,
        requestBody: contentType
          ? {
              contentType,
              required: body.required === true,
              schema: obj(media.schema),
              schemaName: modelName(rawMedia.schema),
              example:
                media.example ?? firstExample(media.examples) ?? exampleFor(obj(media.schema)),
            }
          : undefined,
        responses: Object.entries(obj(op.responses)).map(([status, raw]) => {
          const response = obj(deep(raw));
          const rc = obj(response.content);
          const rtype = Object.keys(rc).find((t) => /json/.test(t)) || Object.keys(rc)[0];
          const rmedia = obj(rc[rtype || '']);
          const rawMedia = obj(obj(obj(resolve(raw)).content)[rtype || '']);
          return {
            status,
            description:
              typeof response.description === 'string' ? response.description : undefined,
            contentType: rtype,
            schema:
              rtype && Object.keys(obj(rmedia.schema)).length ? obj(rmedia.schema) : undefined,
            schemaName: modelName(rawMedia.schema),
            example: rtype
              ? (rmedia.example ?? firstExample(rmedia.examples) ?? exampleFor(obj(rmedia.schema)))
              : undefined,
          };
        }),
        security: Array.isArray(op.security)
          ? op.security.flatMap((r) => Object.keys(obj(r)))
          : globalSecurity,
      });
    }
  }
  return {
    title: String(info.title || 'API'),
    version: String(info.version || ''),
    description: typeof info.description === 'string' ? info.description : undefined,
    servers: (Array.isArray(doc.servers) ? doc.servers : [])
      .map((s) => obj(s))
      .filter((s) => typeof s.url === 'string')
      .map((s) => ({
        url: String(s.url),
        description: typeof s.description === 'string' ? s.description : undefined,
      })),
    operations,
    schemes,
    schemas: Object.entries(obj(components.schemas)).map(([name, raw]) => {
      const schema = obj(deep(raw, 0, new Set([`#/components/schemas/${name}`])));
      return {
        name,
        description: typeof schema.description === 'string' ? schema.description : undefined,
        schema,
      };
    }),
  };
}

/** A curl command for an operation with example values; credentials appear as placeholders. */
export function curlSample(spec: ApiSpec, op: ApiOperation): string {
  const server = (spec.servers[0]?.url || 'https://api.example.com').replace(/\/+$/, '');
  let path = op.path;
  for (const p of op.parameters.filter((p) => p.in === 'path'))
    path = path.split(`{${p.name}}`).join(encodeURIComponent(String(p.example ?? `{${p.name}}`)));
  const query = op.parameters
    .filter((p) => p.in === 'query' && (p.required || p.example !== undefined))
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(String(p.example ?? ''))}`);
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [
    `curl -X ${op.method} ${quote(`${server}${path}${query.length ? `?${query.join('&')}` : ''}`)}`,
  ];
  for (const name of op.security) {
    const scheme = spec.schemes.find((s) => s.name === name);
    if (scheme?.type === 'http' && scheme.scheme === 'bearer')
      lines.push(`--oauth2-bearer "$TOKEN"`);
    else if (scheme?.type === 'http' && scheme.scheme === 'basic')
      lines.push(`-u "$USER:$PASSWORD"`);
    else if (scheme?.type === 'apiKey' && scheme.in === 'header' && scheme.parameter)
      lines.push(`-H ${quote(`${scheme.parameter}: $API_KEY`)}`);
  }
  for (const p of op.parameters.filter((p) => p.in === 'header' && p.required))
    lines.push(`-H ${quote(`${p.name}: ${String(p.example ?? '')}`)}`);
  if (
    op.requestBody &&
    op.requestBody.example !== undefined &&
    !['GET', 'HEAD'].includes(op.method)
  ) {
    lines.push(`-H ${quote(`Content-Type: ${op.requestBody.contentType}`)}`);
    lines.push(
      `--data ${quote(typeof op.requestBody.example === 'string' ? op.requestBody.example : JSON.stringify(op.requestBody.example))}`,
    );
  }
  return lines.join(' \\\n  ');
}

const firstExample = (examples: unknown) => {
  const first = Object.values(obj(examples))[0];
  return first ? obj(first).value : undefined;
};

/** A plausible example value for a JSON schema (depth-limited). */
export function exampleFor(schema: Obj, depth = 0): unknown {
  if (depth > 6 || !schema || !Object.keys(schema).length) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const variant =
    (Array.isArray(schema.oneOf) && schema.oneOf[0]) ||
    (Array.isArray(schema.anyOf) && schema.anyOf[0]);
  if (variant) return exampleFor(obj(variant), depth + 1);
  if (Array.isArray(schema.allOf))
    return Object.assign({}, ...schema.allOf.map((s) => obj(exampleFor(obj(s), depth + 1))));
  switch (schema.type) {
    case 'object':
    case undefined:
      if (!schema.properties) return schema.type === 'object' ? {} : undefined;
      return Object.fromEntries(
        Object.entries(obj(schema.properties)).map(([k, v]) => [k, exampleFor(obj(v), depth + 1)]),
      );
    case 'array':
      return [exampleFor(obj(schema.items), depth + 1)].filter((v) => v !== undefined);
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return true;
    case 'string':
      return schema.format === 'date-time'
        ? '2026-01-01T00:00:00Z'
        : schema.format === 'date'
          ? '2026-01-01'
          : schema.format === 'email'
            ? 'user@example.com'
            : 'string';
    default:
      return undefined;
  }
}

export interface RequestInput {
  server: string;
  path: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: string;
}
export interface Credential {
  scheme: ApiScheme;
  value: string;
}
/** Builds the HTTP request for an operation; credentials are applied as their scheme says. */
export function buildRequest(
  operation: ApiOperation,
  input: RequestInput,
  credentials: Credential[] = [],
) {
  let path = operation.path;
  for (const p of operation.parameters.filter((p) => p.in === 'path')) {
    const value = input.path[p.name];
    if (value === undefined || value === '')
      throw new Error(`Path parameter “${p.name}” is required.`);
    path = path.split(`{${p.name}}`).join(encodeURIComponent(value));
  }
  const base = input.server.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Choose an http(s) server URL.');
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(input.query)) if (v !== '') url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers))
    if (v !== '' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) headers[k] = v;
  for (const { scheme, value } of credentials) {
    if (scheme.type === 'http' && scheme.scheme === 'bearer')
      headers.Authorization = `Bearer ${value}`;
    else if (scheme.type === 'http' && scheme.scheme === 'basic')
      headers.Authorization = `Basic ${Buffer.from(value).toString('base64')}`;
    else if (scheme.type === 'apiKey' && scheme.parameter) {
      if (scheme.in === 'query') url.searchParams.set(scheme.parameter, value);
      else if (scheme.in === 'header') headers[scheme.parameter] = value;
      else if (scheme.in === 'cookie')
        headers.Cookie = `${scheme.parameter}=${encodeURIComponent(value)}`;
    }
  }
  let body: string | undefined;
  if (
    input.body !== undefined &&
    input.body.trim() &&
    !['GET', 'HEAD'].includes(operation.method)
  ) {
    body = input.body;
    headers['Content-Type'] ||= operation.requestBody?.contentType || 'application/json';
  }
  return { method: operation.method, url: url.toString(), headers, body };
}

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const modelTable = (schema: Obj | undefined) => {
  const rows = schema ? schemaRows(schema) : [];
  return rows.length
    ? `<table class="api-model"><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td><code>${escape(r.name)}</code>${r.required ? ' <span class="api-required">required</span>' : ''}</td><td><code>${escape(r.type)}</code></td><td>${escape(r.description || '')}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '';
};
const modelLink = (name: string | undefined) =>
  name
    ? ` <a class="api-model-link" href="#schema-${escape(name.replace(/\[\]$/, '').replace(/[^\w-]/g, '-'))}">${escape(name)}</a>`
    : '';

/** Static API reference (reader, page embeds, export). No requests, no credentials. */
export function renderApiReference(
  spec: ApiSpec,
  renderMarkdown: (md: string) => string,
  highlight?: (language: string, code: string) => string,
): string {
  const groups = new Map<string, ApiOperation[]>();
  for (const op of spec.operations)
    for (const tag of op.tags.slice(0, 1)) groups.set(tag, [...(groups.get(tag) || []), op]);
  const code = (lang: string, value: string) =>
    `<pre><code${highlight ? ` class="hljs language-${lang}"` : ''}>${highlight ? highlight(lang, value) : escape(value)}</code></pre>`;
  const sample = (v: unknown) =>
    code('json', typeof v === 'string' ? v : (JSON.stringify(v, null, 2) ?? ''));
  const operation = (op: ApiOperation) => {
    const params = op.parameters.length
      ? `<table class="api-params"><thead><tr><th scope="col">Parameter</th><th scope="col">In</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${op.parameters
          .map(
            (p) =>
              `<tr><td><code>${escape(p.name)}</code>${p.required ? ' <span class="api-required">required</span>' : ''}</td><td>${p.in}</td><td>${escape(typeName(p.schema || {}))}</td><td>${escape(p.description || '')}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '';
    const body = op.requestBody
      ? `<h5>Request body <code>${escape(op.requestBody.contentType)}</code>${modelLink(op.requestBody.schemaName)}</h5>${op.requestBody.schemaName ? '' : modelTable(op.requestBody.schema)}${op.requestBody.example !== undefined ? sample(op.requestBody.example) : ''}`
      : '';
    const responses = op.responses
      .map(
        (r) =>
          `<li><span class="api-status s${escape(r.status[0])}">${escape(r.status)}</span> ${escape(r.description || '')}${modelLink(r.schemaName)}${r.schemaName ? '' : modelTable(r.schema)}${r.example !== undefined ? sample(r.example) : ''}</li>`,
      )
      .join('');
    const security = op.security.length
      ? `<p class="muted">Auth: ${op.security.map((s) => `<code>${escape(s)}</code>`).join(', ')}</p>`
      : '';
    return `<section class="api-op" id="op-${escape(op.id.replace(/[^\w-]/g, '-'))}"><h4><span class="api-method m-${op.method.toLowerCase()}">${op.method}</span> <code>${escape(op.path)}</code>${op.summary ? ` — ${escape(op.summary)}` : ''}</h4>${op.description ? renderMarkdown(op.description) : ''}${security}${params}${body}${responses ? `<h5>Responses</h5><ul class="api-responses">${responses}</ul>` : ''}<details class="api-sample"><summary>curl</summary>${code('bash', curlSample(spec, op))}</details></section>`;
  };
  const schemes = spec.schemes.length
    ? `<h3>Authentication</h3><ul class="api-schemes">${spec.schemes
        .map(
          (s) =>
            `<li><code>${escape(s.name)}</code> — ${escape(s.type === 'apiKey' ? `API key in ${s.in} “${s.parameter}”` : s.type === 'http' ? `HTTP ${s.scheme}` : s.type)}${s.description ? `: ${escape(s.description)}` : ''}</li>`,
        )
        .join('')}</ul>`
    : '';
  const schemas = spec.schemas.length
    ? `<h3>Schemas</h3>${spec.schemas
        .map(
          (m) =>
            `<section class="api-schema" id="schema-${escape(m.name.replace(/[^\w-]/g, '-'))}"><h4><code>${escape(m.name)}</code> <small class="muted">${escape(typeName(m.schema))}</small></h4>${m.description ? renderMarkdown(m.description) : ''}${modelTable(m.schema)}</section>`,
        )
        .join('')}`
    : '';
  return `<div class="api-reference"><h2>${escape(spec.title)} <small class="muted">${escape(spec.version)}</small></h2>${spec.description ? renderMarkdown(spec.description) : ''}${spec.servers.length ? `<p class="muted">Servers: ${spec.servers.map((s) => `<code>${escape(s.url)}</code>`).join(', ')}</p>` : ''}${schemes}${[
    ...groups,
  ]
    .map(([tag, ops]) => `<h3>${escape(tag)}</h3>${ops.map(operation).join('')}`)
    .join('')}${schemas}</div>`;
}

export const apiCss = `.doc .api-reference{margin:1.2em 0}
.doc .api-op{border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);padding:8px 14px;margin:.8em 0;background:var(--ws-surface)}
.doc .api-op h4{margin:.2em 0 .4em;font-size:1em}
.doc .api-method{display:inline-block;min-width:4.2em;text-align:center;font:600 11px var(--ws-mono);padding:2px 6px;border-radius:4px;background:var(--ws-surface-2);color:var(--ws-fg);box-shadow:inset 3px 0 0 var(--m,var(--ws-muted))}
.doc .m-get{--m:var(--ws-blue)}.doc .m-post{--m:var(--ws-green)}.doc .m-put,.doc .m-patch{--m:var(--ws-orange)}.doc .m-delete{--m:var(--ws-red)}
.doc .api-params{font-size:.88em}
.doc .api-required{font-size:.8em;color:var(--ws-red)}
.doc .api-responses{list-style:none;padding:0}
.doc .api-status{font:600 12px var(--ws-mono);padding:1px 6px;border-radius:4px;background:var(--ws-surface-2)}
.doc .api-model{font-size:.86em;margin:.4em 0}
.doc .api-model-link{font:500 .85em var(--ws-mono);margin-left:.4em}
.doc .api-schema{border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);padding:6px 14px;margin:.6em 0}
.doc .api-sample summary{cursor:pointer;color:var(--ws-muted);font-size:.88em;margin:.4em 0}`;

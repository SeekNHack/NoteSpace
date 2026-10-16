import type { ApiSpec } from '../openapi';
import {
  COLLECTION_SCHEMA,
  CollectionMeta,
  serializeCollectionMeta,
  serializeRequest,
  slug,
} from './collection';
import { ApiRequest, AuthConfig } from './model';

/**
 * OpenAPI 3 → collection files. Operations become requests grouped in one folder per tag; path
 * parameters become `{{variables}}`, the first server becomes `{{baseUrl}}`, security schemes
 * become auth with `{{variables}}` for credentials (never values), JSON examples become bodies,
 * and the success response's schema is kept for the `schema` test. Nothing is fetched: only
 * local `#/` references are resolved (by core/openapi).
 */
export interface ImportPreview {
  name: string;
  baseUrl?: string;
  files: Map<string, string>;
  requests: Array<{ path: string; method: string; url: string; name: string }>;
  warnings: string[];
}

export function collectionFromOpenApi(spec: ApiSpec, name = spec.title): ImportPreview {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const requests: ImportPreview['requests'] = [];
  const baseUrl = spec.servers[0]?.url;
  if (spec.servers.length > 1)
    warnings.push(
      `${spec.servers.length} servers are declared; {{baseUrl}} is the first (${baseUrl}). Add an environment per server to switch.`,
    );
  if (!baseUrl) warnings.push('No server is declared: set {{baseUrl}} in an environment.');
  const authFor = (schemes: string[]): AuthConfig => {
    const scheme = spec.schemes.find((s) => schemes.includes(s.name));
    if (!scheme) return { type: schemes.length ? 'inherit' : 'none' };
    if (scheme.type === 'http' && scheme.scheme === 'bearer')
      return { type: 'bearer', token: '{{accessToken}}' };
    if (scheme.type === 'http' && scheme.scheme === 'basic')
      return { type: 'basic', username: '{{username}}', password: '{{password}}' };
    if (
      scheme.type === 'apiKey' &&
      scheme.parameter &&
      (scheme.in === 'header' || scheme.in === 'query')
    )
      return { type: 'apikey', key: scheme.parameter, value: '{{apiKey}}', in: scheme.in };
    warnings.push(
      `Security scheme “${scheme.name}” (${scheme.type}) is not applied automatically; set up authentication by hand.`,
    );
    return { type: 'inherit' };
  };
  const folders = new Map<string, string[]>();
  const used = new Set<string>();
  for (const op of spec.operations) {
    const tag = op.tags[0] || 'Endpoints';
    const folder = slug(tag);
    const order = folders.get(folder) || [];
    let base = slug(op.summary || op.id || `${op.method}-${op.path}`);
    let file = `${folder}/${base}`;
    for (let n = 2; used.has(file); n++) file = `${folder}/${base}-${n}`;
    used.add(file);
    base = file.slice(folder.length + 1);
    const path = op.path.replace(/\{([^}]+)\}/g, '{{$1}}');
    const success = op.responses.find((r) => /^2/.test(r.status));
    const req: ApiRequest = {
      id: file,
      name: op.summary || `${op.method} ${op.path}`,
      method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(op.method)
        ? op.method
        : 'GET') as ApiRequest['method'],
      url: `{{baseUrl}}${path}`,
      params: op.parameters
        .filter((p) => p.in === 'query')
        .map((p) => ({
          key: p.name,
          value: p.example !== undefined ? String(p.example) : '',
          ...(p.required ? {} : { enabled: false }),
        })),
      headers: op.parameters
        .filter((p) => p.in === 'header')
        .map((p) => ({
          key: p.name,
          value: p.example !== undefined ? String(p.example) : '',
          ...(p.required ? {} : { enabled: false }),
        })),
      body: op.requestBody
        ? /json/.test(op.requestBody.contentType)
          ? { type: 'json', text: JSON.stringify(op.requestBody.example ?? {}, null, 2) }
          : /x-www-form-urlencoded/.test(op.requestBody.contentType)
            ? { type: 'form', fields: [] }
            : /multipart/.test(op.requestBody.contentType)
              ? { type: 'multipart', fields: [] }
              : { type: 'text', text: '' }
        : { type: 'none' },
      auth: authFor(op.security),
      tests: success
        ? `status == ${/^\d{3}$/.test(success.status) ? success.status : '200'}${success.schema ? '\nschema' : ''}`
        : 'status in 200..299',
      ...(op.description || op.summary
        ? { description: [op.summary, op.description].filter(Boolean).join('\n\n') }
        : {}),
      ...(success?.schema ? { responseSchema: success.schema } : {}),
    };
    files.set(`${file}.request.json`, serializeRequest(req));
    order.push(base);
    folders.set(folder, order);
    requests.push({ path: file, method: req.method, url: req.url, name: req.name });
  }
  for (const [folder, order] of folders) {
    const tag =
      spec.operations.find((o) => slug(o.tags[0] || 'Endpoints') === folder)?.tags[0] ||
      'Endpoints';
    files.set(`${folder}/folder.json`, `${JSON.stringify({ name: tag, order }, null, 2)}\n`);
  }
  const meta: CollectionMeta = {
    schemaVersion: COLLECTION_SCHEMA,
    type: 'notespace.collection',
    name,
    ...(spec.description ? { description: spec.description.slice(0, 2000) } : {}),
    variables: baseUrl ? [{ key: 'baseUrl', value: baseUrl }] : [{ key: 'baseUrl', value: '' }],
    auth: { type: 'none' },
    order: [...folders.keys()],
  };
  files.set('collection.json', serializeCollectionMeta(meta));
  return { name, baseUrl, files, requests, warnings };
}

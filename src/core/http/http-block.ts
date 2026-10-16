import { ApiRequest, emptyRequest, HTTP_METHODS, HttpMethod } from './model';

/**
 * ```http blocks in Markdown pages, in the widely used “HTTP file” layout:
 *
 *   ```http
 *   # @name Create user
 *   POST {{baseUrl}}/api/users
 *   Content-Type: application/json
 *
 *   { "name": "Mario" }
 *   ```
 *
 * Comment lines before the request line may carry `@name <name>`, `@test <assertion>` (one per
 * line) and `@collection <collection>/<request path>`, which links the block to a stored
 * request: the block then shows and sends that request instead of repeating it.
 */
export interface HttpBlock {
  request: ApiRequest;
  /** `collection/request/path` when the block links to a collection request. */
  collection?: string;
}

export function parseHttpBlock(source: string): HttpBlock {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const req = emptyRequest('block', 'Request');
  const tests: string[] = [];
  let collection: string | undefined;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comment = /^(?:#|\/\/)\s*(.*)$/.exec(line);
    if (!comment) break;
    const directive =
      /^@(name|test|collection)\s+(.+)$/i.exec(comment[1].trim()) ||
      /^(collection):\s*(.+)$/i.exec(comment[1].trim());
    if (directive) {
      const kind = directive[1].toLowerCase();
      if (kind === 'name') req.name = directive[2].trim().slice(0, 200);
      else if (kind === 'test') tests.push(directive[2].trim());
      else collection = directive[2].trim();
    }
  }
  // `collection: path` alone (without comment marker) is accepted as well.
  if (i < lines.length && /^collection:\s*\S/i.test(lines[i].trim())) {
    collection = lines[i].trim().replace(/^collection:\s*/i, '');
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
  }
  if (tests.length) req.tests = tests.join('\n');
  if (i >= lines.length) {
    if (collection) return { request: req, collection };
    throw new Error('Write a request line such as “GET https://api.example.com/users”.');
  }
  const first = lines[i].trim();
  const m = /^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/.exec(first);
  if (m && (HTTP_METHODS as readonly string[]).includes(m[1].toUpperCase())) {
    req.method = m[1].toUpperCase() as HttpMethod;
    req.url = m[2];
  } else if (/^(https?:\/\/|\{\{)\S+$/.test(first)) {
    // A bare URL is a GET.
    req.url = first;
  } else if (m) throw new Error(`${m[1]} is not a supported method (${HTTP_METHODS.join(', ')}).`);
  else throw new Error(`The first line must be “METHOD URL” (got “${first}”).`);
  i++;
  // Query continuation lines (`?a=1`, `&b=2`) right after the request line.
  while (i < lines.length && /^\s*[?&]\S/.test(lines[i])) req.url += lines[i++].trim();
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      break;
    }
    if (/^\s*(#|\/\/)/.test(line)) continue;
    const colon = line.indexOf(':');
    if (colon <= 0)
      throw new Error(`Line ${i + 1} is not a header (“Name: value”): ${line.trim()}`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key.toLowerCase() === 'cookie') {
      for (const part of value.split(';')) {
        const eq = part.indexOf('=');
        if (part.trim())
          (req.cookies ||= []).push(
            eq < 0
              ? { key: part.trim(), value: '' }
              : { key: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() },
          );
      }
    } else req.headers.push({ key, value });
  }
  const body = lines.slice(i).join('\n').replace(/\s+$/, '');
  if (body.trim()) {
    const type =
      req.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
    if (/json/.test(type) || (!type && /^\s*[[{]/.test(body)))
      req.body = { type: 'json', text: body };
    else if (/xml/.test(type)) req.body = { type: 'xml', text: body };
    else if (/x-www-form-urlencoded/.test(type))
      req.body = {
        type: 'form',
        fields: body
          .replace(/\n/g, '')
          .split('&')
          .filter(Boolean)
          .map((p) => {
            const eq = p.indexOf('=');
            const dec = (x: string) => {
              try {
                return decodeURIComponent(x.replace(/\+/g, ' '));
              } catch {
                return x;
              }
            };
            return eq < 0
              ? { key: dec(p), value: '' }
              : { key: dec(p.slice(0, eq)), value: dec(p.slice(eq + 1)) };
          }),
      };
    else req.body = { type: 'text', text: body };
    // The body type sets Content-Type when sending; keep only specific ones.
    if (req.body.type === 'json' && /^application\/json\s*(;\s*charset=utf-8)?$/i.test(type))
      req.headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
    if (req.body.type === 'form')
      req.headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
  }
  if (req.name === 'Request')
    req.name = `${req.method} ${req.url.replace(/^\{\{[^}]+\}\}/, '').split('?')[0] || req.url}`;
  return { request: req, collection };
}

/** Writes a request as an ```http block body (used when a page is edited from the block). */
export function serializeHttpBlock(block: HttpBlock): string {
  const r = block.request;
  const out: string[] = [];
  if (block.collection) out.push(`# @collection ${block.collection}`);
  if (r.name && r.name !== `${r.method} ${r.url}`) out.push(`# @name ${r.name}`);
  for (const t of (r.tests || '').split('\n').filter((x) => x.trim()))
    out.push(`# @test ${t.trim()}`);
  if (block.collection && !r.url) return `${out.join('\n')}\n`;
  let url = r.url;
  const params = r.params.filter((p) => p.enabled !== false && p.key);
  if (params.length)
    url +=
      (url.includes('?') ? '&' : '?') +
      params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  out.push(`${r.method} ${url}`);
  for (const h of r.headers.filter((x) => x.enabled !== false && x.key))
    out.push(`${h.key}: ${h.value}`);
  const cookies = (r.cookies || []).filter((c) => c.enabled !== false && c.key);
  if (cookies.length) out.push(`Cookie: ${cookies.map((c) => `${c.key}=${c.value}`).join('; ')}`);
  const b = r.body;
  if (b.type === 'json' && !r.headers.some((h) => h.key.toLowerCase() === 'content-type'))
    out.push('Content-Type: application/json');
  if (b.type === 'form') out.push('Content-Type: application/x-www-form-urlencoded');
  if ((b.type === 'json' || b.type === 'text' || b.type === 'xml') && b.text?.trim())
    out.push('', b.text.replace(/\s+$/, ''));
  else if (b.type === 'form' && b.fields?.length)
    out.push(
      '',
      b.fields
        .filter((f) => f.enabled !== false)
        .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
        .join('&'),
    );
  return `${out.join('\n')}\n`;
}

import { ApiRequest, interpolate, KeyValue } from './model';

/**
 * Code snippets from a request: curl and Python `requests`. Variables are resolved with `vars`
 * when given (unresolved ones stay as `{{name}}`); secrets are never inlined — authentication
 * values that come from variables appear as variables or placeholders.
 */
const on = (rows?: KeyValue[]) => (rows || []).filter((r) => r.enabled !== false && r.key);

const shellQuote = (s: string) =>
  /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(req: ApiRequest, vars: Record<string, string> = {}): string {
  const v = (s: string) => interpolate(s, vars);
  const url = new URLish(v(req.url));
  for (const p of on(req.params)) url.add(v(p.key), v(p.value));
  const parts = [`curl -X ${req.method} ${shellQuote(url.toString())}`];
  for (const h of on(req.headers)) parts.push(`-H ${shellQuote(`${v(h.key)}: ${v(h.value)}`)}`);
  const cookies = on(req.cookies).map((c) => `${v(c.key)}=${v(c.value)}`);
  if (cookies.length) parts.push(`-b ${shellQuote(cookies.join('; '))}`);
  const a = req.auth;
  if (a.type === 'basic') parts.push(`-u ${shellQuote(`${v(a.username)}:${v(a.password)}`)}`);
  else if (a.type === 'bearer')
    parts.push(`-H ${shellQuote(`Authorization: Bearer ${v(a.token)}`)}`);
  else if (a.type === 'apikey' && a.in === 'header')
    parts.push(`-H ${shellQuote(`${v(a.key)}: ${v(a.value)}`)}`);
  const b = req.body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (b.type === 'json' || b.type === 'text' || b.type === 'xml') {
      if (b.type === 'json' && !on(req.headers).some((h) => h.key.toLowerCase() === 'content-type'))
        parts.push(`-H 'Content-Type: application/json'`);
      parts.push(`--data-raw ${shellQuote(compactJson(v(b.text || ''), b.type))}`);
    } else if (b.type === 'form')
      for (const f of on(b.fields))
        parts.push(`--data-urlencode ${shellQuote(`${v(f.key)}=${v(f.value)}`)}`);
    else if (b.type === 'multipart')
      for (const f of on(b.fields))
        parts.push(`-F ${shellQuote(`${v(f.key)}=${f.file ? '@' : ''}${v(f.value)}`)}`);
    else if (b.type === 'binary' && b.text)
      parts.push(`--data-binary ${shellQuote(`@${v(b.text)}`)}`);
  }
  if (a.type === 'apikey' && a.in === 'query')
    parts[0] = `curl -X ${req.method} ${shellQuote(url.with(v(a.key), v(a.value)))}`;
  return parts.join(' \\\n  ');
}

const compactJson = (text: string, type: string) => {
  if (type !== 'json') return text;
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
};

/** URL with parameters appended, tolerant of `{{variables}}` in the address. */
class URLish {
  private readonly extra: Array<[string, string]> = [];
  constructor(private readonly base: string) {}
  add(k: string, v: string) {
    this.extra.push([k, v]);
  }
  with(k: string, v: string) {
    return this.render([...this.extra, [k, v]]);
  }
  toString() {
    return this.render(this.extra);
  }
  private render(extra: Array<[string, string]>) {
    if (!extra.length) return this.base;
    const q = extra.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return `${this.base}${this.base.includes('?') ? '&' : '?'}${q}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Python requests
// ---------------------------------------------------------------------------------------------
const py = (s: string) => JSON.stringify(s).replace(/\\u2028/g, '\\u2028');
function pyValue(value: unknown, indent: string): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return py(value);
  const inner = `${indent}    `;
  if (Array.isArray(value))
    return value.length
      ? `[\n${value.map((x) => `${inner}${pyValue(x, inner)},`).join('\n')}\n${indent}]`
      : '[]';
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length
    ? `{\n${entries.map(([k, x]) => `${inner}${py(k)}: ${pyValue(x, inner)},`).join('\n')}\n${indent}}`
    : '{}';
}
const dict = (rows: Array<[string, string]>) =>
  rows.length ? `{\n${rows.map(([k, v]) => `    ${py(k)}: ${py(v)},`).join('\n')}\n}` : '{}';

/**
 * Python `requests` code: the URL without its query, `params`, `headers`, `cookies` and the
 * body as `json=`, `data=` or `files=` dicts, `auth=` for Basic, and a timeout.
 */
export function toPython(req: ApiRequest, vars: Record<string, string> = {}): string {
  const v = (s: string) => interpolate(s, vars);
  const lines = ['import requests', ''];
  let address = v(req.url);
  const params: Array<[string, string]> = [];
  const q = address.indexOf('?');
  if (q >= 0) {
    for (const part of address.slice(q + 1).split('&')) {
      if (!part) continue;
      const [k, ...rest] = part.split('=');
      params.push([safeDecode(k), safeDecode(rest.join('='))]);
    }
    address = address.slice(0, q);
  }
  for (const p of on(req.params)) params.push([v(p.key), v(p.value)]);
  const a = req.auth;
  if (a.type === 'apikey' && a.in === 'query') params.push([v(a.key), v(a.value)]);
  const headers: Array<[string, string]> = [];
  const cookies: Array<[string, string]> = [];
  for (const h of on(req.headers)) {
    if (h.key.toLowerCase() === 'cookie')
      for (const c of v(h.value).split(';')) {
        const [k, ...rest] = c.trim().split('=');
        if (k) cookies.push([k, rest.join('=')]);
      }
    else headers.push([v(h.key), v(h.value)]);
  }
  for (const c of on(req.cookies)) cookies.push([v(c.key), v(c.value)]);
  if (a.type === 'bearer') headers.push(['Authorization', `Bearer ${v(a.token)}`]);
  if (a.type === 'apikey' && a.in === 'header') headers.push([v(a.key), v(a.value)]);
  lines.push(`url = ${py(address)}`);
  const args = ['url'];
  if (params.length) {
    lines.push('', `params = ${dict(params)}`);
    args.push('params=params');
  }
  const b = req.body;
  const sendsBody = req.method !== 'GET' && req.method !== 'HEAD';
  let jsonBody = false;
  if (sendsBody && b.type === 'json' && b.text?.trim()) {
    try {
      const value = JSON.parse(v(b.text));
      lines.push('', `payload = ${pyValue(value, '')}`);
      args.push('json=payload');
      jsonBody = true;
    } catch {
      lines.push('', `payload = ${py(v(b.text))}`);
      args.push('data=payload');
    }
  } else if (sendsBody && (b.type === 'text' || b.type === 'xml') && b.text) {
    lines.push('', `payload = ${py(v(b.text))}`);
    args.push('data=payload');
  } else if (sendsBody && b.type === 'form') {
    lines.push('', `data = ${dict(on(b.fields).map((f) => [v(f.key), v(f.value)]))}`);
    args.push('data=data');
  } else if (sendsBody && b.type === 'multipart') {
    const files = on(b.fields).filter((f) => f.file);
    const fields = on(b.fields).filter((f) => !f.file);
    if (fields.length) {
      lines.push('', `data = ${dict(fields.map((f) => [v(f.key), v(f.value)]))}`);
      args.push('data=data');
    }
    if (files.length) {
      lines.push(
        '',
        `files = {\n${files.map((f) => `    ${py(v(f.key))}: open(${py(v(f.value))}, "rb"),`).join('\n')}\n}`,
      );
      args.push('files=files');
    }
  } else if (sendsBody && b.type === 'binary' && b.text) {
    lines.push('', `with open(${py(v(b.text))}, "rb") as f:`, '    payload = f.read()');
    args.push('data=payload');
  }
  // requests sets Content-Type for json=, data= dicts and files=; keep only specific ones.
  const filtered = headers.filter(([k, val]) => {
    if (k.toLowerCase() !== 'content-type') return true;
    if (jsonBody) return !/^application\/json\s*(;\s*charset=utf-8)?$/i.test(val);
    if (b.type === 'multipart') return false;
    if (b.type === 'form') return !/^application\/x-www-form-urlencoded/i.test(val);
    return true;
  });
  if (filtered.length) {
    lines.push('', `headers = ${dict(filtered)}`);
    args.push('headers=headers');
  }
  if (cookies.length) {
    lines.push('', `cookies = ${dict(cookies)}`);
    args.push('cookies=cookies');
  }
  if (a.type === 'basic') args.push(`auth=(${py(v(a.username))}, ${py(v(a.password))})`);
  args.push(`timeout=${Math.round((req.timeoutMs ?? 30000) / 100) / 10}`);
  if (req.followRedirects === false) args.push('allow_redirects=False');
  const call = `requests.${req.method === 'DELETE' ? 'delete' : req.method.toLowerCase()}`;
  lines.push(
    '',
    `response = ${call}(\n${args.map((x) => `    ${x},`).join('\n')}\n)`,
    '',
    'print(response.status_code)',
    jsonBody || /json/i.test(headers.find(([k]) => k.toLowerCase() === 'accept')?.[1] || '')
      ? 'print(response.json())'
      : 'print(response.text)',
  );
  return lines.join('\n') + '\n';
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

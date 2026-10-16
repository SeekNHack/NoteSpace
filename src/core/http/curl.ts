import { ApiRequest, emptyRequest, HTTP_METHODS, HttpMethod, KeyValue } from './model';

/**
 * curl import: turns a pasted command (as copied from browser DevTools, documentation or a
 * terminal) into a request. Nothing is executed; the command is only tokenized like a POSIX
 * shell would (quotes, `$'…'`, escapes, line continuations; also Windows `^` continuations).
 */
export interface CurlImport {
  request: ApiRequest;
  /** Options that were understood but not applied, and options that were ignored. */
  warnings: string[];
}

export function tokenize(command: string): string[] {
  const text = command
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .trim();
  const out: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
      i++;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new Error('Unclosed single quote in the curl command.');
      cur += text.slice(i + 1, end);
      has = true;
      i = end + 1;
    } else if (c === '$' && text[i + 1] === "'") {
      // ANSI-C quoting, as Chrome writes for bodies with special characters.
      i += 2;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const n = text[i + 1];
          const map: Record<string, string> = {
            n: '\n',
            t: '\t',
            r: '\r',
            '\\': '\\',
            "'": "'",
            '"': '"',
            '0': '\0',
          };
          if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            cur += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
            i += 6;
          } else if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
            cur += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16));
            i += 4;
          } else {
            cur += map[n] ?? n;
            i += 2;
          }
        } else cur += text[i++];
      }
      if (text[i] !== "'") throw new Error("Unclosed $'…' quote in the curl command.");
      i++;
      has = true;
    } else if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) {
          cur += text[i + 1];
          i += 2;
        } else cur += text[i++];
      }
      if (text[i] !== '"') throw new Error('Unclosed double quote in the curl command.');
      i++;
      has = true;
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text[i + 1];
      has = true;
      i += 2;
    } else {
      cur += c;
      has = true;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}

const withValue = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '-F',
  '--form',
  '--form-string',
  '-u',
  '--user',
  '-b',
  '--cookie',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '--url',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-o',
  '--output',
  '-x',
  '--proxy',
  '--json',
  '-T',
  '--upload-file',
  '--oauth2-bearer',
  '-c',
  '--cookie-jar',
  '--retry',
  '-w',
  '--write-out',
  '--cacert',
  '--cert',
  '--key',
  '-E',
]);

/** Splits `name=value` (form fields, cookies). */
const pair = (text: string, sep = '='): KeyValue => {
  const i = text.indexOf(sep);
  return i < 0
    ? { key: text.trim(), value: '' }
    : { key: text.slice(0, i).trim(), value: text.slice(i + 1).trim() };
};

export function parseCurl(command: string): CurlImport {
  const tokens = tokenize(command.trim().replace(/^\$\s+/, ''));
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0].split(/[\\/]/).pop()!))
    throw new Error('Paste a command that starts with curl.');
  const req = emptyRequest('imported', 'Imported request');
  const warnings: string[] = [];
  let method: string | undefined;
  let url: string | undefined;
  const data: string[] = [];
  const urlencoded: string[] = [];
  const form: KeyValue[] = [];
  let binaryFile: string | undefined;
  let get = false;
  let json = false;
  let head = false;
  for (let i = 1; i < tokens.length; i++) {
    let t = tokens[i];
    let value: string | undefined;
    // --opt=value and -Xvalue forms.
    const eq = /^(--[a-z0-9-]+)=(.*)$/i.exec(t);
    if (eq && withValue.has(eq[1])) {
      t = eq[1];
      value = eq[2];
    } else if (/^-[A-Za-z]./.test(t) && withValue.has(t.slice(0, 2)) && !t.startsWith('--')) {
      value = t.slice(2);
      t = t.slice(0, 2);
    }
    const next = () => {
      if (value !== undefined) return value;
      if (i + 1 >= tokens.length) throw new Error(`${t} needs a value.`);
      return tokens[++i];
    };
    if (!t.startsWith('-') || t === '-') {
      if (!url) url = t;
      else warnings.push(`Extra argument ignored: ${t}`);
      continue;
    }
    switch (t) {
      case '-X':
      case '--request':
        method = next().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const h = next();
        const colon = h.indexOf(':');
        if (colon <= 0) {
          warnings.push(`Header ignored: ${h}`);
          break;
        }
        const name = h.slice(0, colon).trim();
        const val = h.slice(colon + 1).trim();
        if (name.toLowerCase() === 'cookie')
          for (const c of val.split(';')) c.trim() && (req.cookies ||= []).push(pair(c));
        else req.headers.push({ key: name, value: val });
        break;
      }
      case '-d':
      case '--data':
      case '--data-ascii':
      case '--data-raw':
      case '--data-binary': {
        const d = next();
        if (d.startsWith('@') && t !== '--data-raw') {
          binaryFile = d.slice(1);
          warnings.push(
            `The body is read from the file “${d.slice(1)}”; choose it in the Body tab.`,
          );
        } else data.push(d);
        break;
      }
      case '--json':
        json = true;
        data.push(next());
        break;
      case '--data-urlencode':
        urlencoded.push(next());
        break;
      case '-F':
      case '--form':
      case '--form-string': {
        const f = pair(next());
        if (t !== '--form-string' && f.value.startsWith('@'))
          form.push({ key: f.key, value: f.value.slice(1).replace(/;type=.*$/, ''), file: true });
        else form.push({ key: f.key, value: f.value.replace(/^"(.*)"$/, '$1') });
        break;
      }
      case '-u':
      case '--user': {
        const u = pair(next(), ':');
        req.auth = { type: 'basic', username: u.key, password: u.value };
        break;
      }
      case '--oauth2-bearer':
        req.auth = { type: 'bearer', token: next() };
        break;
      case '-b':
      case '--cookie': {
        const c = next();
        if (!c.includes('='))
          warnings.push(`Cookie file “${c}” is not read; add the cookies by hand.`);
        else for (const part of c.split(';')) part.trim() && (req.cookies ||= []).push(pair(part));
        break;
      }
      case '-A':
      case '--user-agent':
        req.headers.push({ key: 'User-Agent', value: next() });
        break;
      case '-e':
      case '--referer':
        req.headers.push({ key: 'Referer', value: next() });
        break;
      case '--url':
        url = next();
        break;
      case '-G':
      case '--get':
        get = true;
        break;
      case '-I':
      case '--head':
        head = true;
        break;
      case '-L':
      case '--location':
        req.followRedirects = true;
        break;
      case '-m':
      case '--max-time': {
        const s = Number(next());
        if (s > 0) req.timeoutMs = Math.round(s * 1000);
        break;
      }
      case '-k':
      case '--insecure':
        warnings.push('-k/--insecure is ignored: certificates are always verified.');
        break;
      case '--compressed':
        break;
      case '-T':
      case '--upload-file':
        binaryFile = next();
        method ||= 'PUT';
        warnings.push(`The body is read from the file “${binaryFile}”; choose it in the Body tab.`);
        break;
      case '-x':
      case '--proxy':
        warnings.push(`Proxy “${next()}” is ignored; requests use VS Code's network settings.`);
        break;
      default:
        if (withValue.has(t)) {
          next();
          warnings.push(`${t} is ignored.`);
        } else if (
          ![
            '-s',
            '--silent',
            '-S',
            '--show-error',
            '-v',
            '--verbose',
            '-i',
            '--include',
            '-f',
            '--fail',
            '-#',
            '--progress-bar',
            '-N',
            '--no-buffer',
            '--http1.1',
            '--http2',
            '--globoff',
            '-g',
          ].includes(t)
        )
          warnings.push(`${t} is ignored.`);
    }
  }
  if (!url) throw new Error('The curl command has no URL.');
  // Query parameters become editable rows; the URL keeps only the address.
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`);
    for (const [k, v] of parsed.searchParams) req.params.push({ key: k, value: v });
    parsed.search = '';
    req.url = /^[a-z]+:\/\//i.test(url)
      ? parsed.toString()
      : parsed.toString().replace(/^http:\/\//, '');
    if (parsed.username || parsed.password) {
      if (req.auth.type !== 'basic')
        req.auth = {
          type: 'basic',
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password),
        };
      parsed.username = parsed.password = '';
      req.url = parsed.toString();
    }
  } catch {
    req.url = url;
  }
  const contentType =
    req.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
  if (get) {
    for (const d of [...data, ...urlencoded])
      for (const part of d.split('&')) if (part) req.params.push(pair(decodeForm(part)));
  } else if (form.length) req.body = { type: 'multipart', fields: form };
  else if (urlencoded.length && !data.length)
    req.body = {
      type: 'form',
      fields: urlencoded.map((u) => pair(u.startsWith('=') ? u.slice(1) : u)),
    };
  else if (data.length || urlencoded.length) {
    const text = [...data, ...urlencoded.map((u) => encodeUrlencodeArg(u))].join('&');
    if (json || /json/.test(contentType) || (/^\s*[[{]/.test(text) && isJson(text))) {
      req.body = { type: 'json', text: prettyJson(text) };
      if (json && !contentType)
        req.headers.push({ key: 'Content-Type', value: 'application/json' });
    } else if (/xml/.test(contentType)) req.body = { type: 'xml', text };
    else if (!contentType || /x-www-form-urlencoded/.test(contentType))
      req.body = {
        type: 'form',
        fields: text
          .split('&')
          .filter(Boolean)
          .map((p) => pair(decodeForm(p))),
      };
    else req.body = { type: 'text', text };
  } else if (binaryFile) req.body = { type: 'binary', text: binaryFile };
  // Content-Type comes from the body type unless the command chose something specific:
  // multipart needs its generated boundary, and plain JSON/form types are added when sending.
  const plain = (v: string) =>
    (req.body.type === 'json' && /^application\/json\s*(;\s*charset=utf-8)?$/i.test(v)) ||
    (req.body.type === 'form' && /^application\/x-www-form-urlencoded\b/i.test(v)) ||
    req.body.type === 'multipart';
  req.headers = req.headers.filter(
    (h) => h.key.toLowerCase() !== 'content-type' || !plain(h.value),
  );
  const m = (
    method ||
    (head
      ? 'HEAD'
      : data.length || urlencoded.length || form.length || binaryFile
        ? get
          ? 'GET'
          : 'POST'
        : 'GET')
  ).toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(m))
    throw new Error(`The method ${m} is not supported.`);
  req.method = m as HttpMethod;
  try {
    const u = new URL(req.url.includes('://') ? req.url : `http://${req.url}`);
    req.name = `${req.method} ${u.pathname === '/' ? u.host : u.pathname.split('/').filter(Boolean).pop()}`;
  } catch {
    /* keep the default name */
  }
  return { request: req, warnings };
}

const isJson = (s: string) => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};
const prettyJson = (s: string) => (isJson(s) ? JSON.stringify(JSON.parse(s), null, 2) : s);
const decodeForm = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};
/** curl's --data-urlencode rules: `content`, `=content`, `name=content`. */
function encodeUrlencodeArg(arg: string): string {
  if (arg.startsWith('=')) return encodeURIComponent(arg.slice(1));
  const i = arg.indexOf('=');
  if (i < 0) return encodeURIComponent(arg);
  return `${arg.slice(0, i)}=${encodeURIComponent(arg.slice(i + 1))}`;
}

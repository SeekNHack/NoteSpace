// API Client webview: collections, environments and history on the left; request tabs with
// params, auth, headers, body, cookies, tests and code; the response below.
import { prettyXml } from './core/http/format';
import {
  ApiRequest,
  AuthConfig,
  BodyType,
  emptyRequest,
  HTTP_METHODS,
  isSensitiveName,
  KeyValue,
  variablesIn,
} from './core/http/model';
import { toCurl, toPython } from './core/http/codegen';
import { icon, IconName } from './core/icons';

declare function acquireVsCodeApi(): {
  postMessage(m: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
};
const vscode = acquireVsCodeApi();
const post = (m: unknown) => vscode.postMessage(m);

interface TreeNode {
  kind: 'folder' | 'request';
  path: string;
  name: string;
  method?: string;
  children?: TreeNode[];
}
interface CollectionDto {
  id: string;
  name: string;
  description?: string;
  variables: KeyValue[];
  auth: AuthConfig;
  tree: TreeNode[];
  problems: string[];
}
interface EnvDto {
  id: string;
  name: string;
  variables: Array<KeyValue & { secret?: boolean; hasValue?: boolean }>;
}
interface History {
  id: string;
  at: number;
  name: string;
  method: string;
  url: string;
  status?: number;
  ms?: number;
  size?: number;
  error?: string;
  ref?: string;
}
interface ResponseDto {
  status: number;
  statusText: string;
  url: string;
  headers: Array<[string, string]>;
  cookies: Array<{ name: string; value: string; attributes: string }>;
  ms: number;
  size: number;
  contentType: string;
  text?: string;
  base64?: string;
  truncated: boolean;
  redirects: Array<{ status: number; url: string }>;
}
interface TestResult {
  line: number;
  source: string;
  pass: boolean;
  message: string;
}
type Sub = 'params' | 'auth' | 'headers' | 'body' | 'cookies' | 'tests' | 'settings' | 'code';
interface Tab {
  id: string;
  collection?: string;
  request: ApiRequest;
  saved: string;
  sub: Sub;
  sending?: boolean;
  response?: ResponseDto;
  error?: string;
  tests?: TestResult[];
  missing?: string[];
  warnings?: string[];
  respTab?: 'body' | 'headers' | 'cookies' | 'tests';
  view?: 'pretty' | 'raw';
  search?: string;
  code?: 'curl' | 'python';
}
interface State {
  collections: CollectionDto[];
  environments: EnvDto[];
  environment?: string;
  globals: KeyValue[];
  runtime: string[];
  history: History[];
  tabs: { tabs: Tab[]; active?: string } | null;
  trusted: boolean;
}

let state: State | undefined;
let tabs: Tab[] = [];
let active: string | undefined;
let side: 'collections' | 'environments' | 'history' = 'collections';
let filter = '';
let envDraft: EnvDto | undefined;
/** Unsaved edits of the global variables; survives re-renders until saved. */
let globalsDraft: KeyValue[] | undefined;
let runResults:
  | {
      collection: string;
      results: Array<{
        name: string;
        status?: number;
        ms?: number;
        error?: string;
        tests: TestResult[];
      }>;
      done: boolean;
      total: number;
    }
  | undefined;
const app = document.getElementById('app')!;

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string | undefined | false | null>
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== undefined && c !== false && c !== null) el.append(c);
  return el;
};
const svg = (name: IconName, size = 14) => {
  const s = document.createElement('span');
  s.innerHTML = icon(name, size);
  return s.firstElementChild as SVGElement;
};
const button = (
  label: string,
  run: (e: MouseEvent) => void,
  cls = 'btn',
  iconName?: IconName,
  extra: Record<string, string> = {},
) => {
  const b = h(
    'button',
    { type: 'button', class: cls, ...extra },
    iconName ? svg(iconName) : undefined,
    label || undefined,
  );
  b.addEventListener('click', run);
  return b;
};
let toastTimer: number | undefined;
/** A warning when credentials are typed as plain values (they would be saved in the request file). */
function literalSecrets(rows: KeyValue[]): HTMLElement[] {
  const names = rows
    .filter(
      (r) =>
        r.enabled !== false && r.value && !/\{\{[^}]+\}\}/.test(r.value) && isSensitiveName(r.key),
    )
    .map((r) => r.key);
  if (!names.length) return [];
  return [
    h('p', {
      class: 'notice small',
      role: 'note',
      text: `${names.join(', ')} ${names.length === 1 ? 'holds' : 'hold'} a credential written as plain text; saving stores it in the request file. Use a secret environment variable such as {{token}} instead.`,
    }),
  ];
}

function toast(text: string, error = false) {
  document.querySelector('.toast')?.remove();
  const el = h('div', {
    class: `toast${error ? ' error' : ''}`,
    role: error ? 'alert' : 'status',
    text,
  });
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 4500);
}
function menu(e: MouseEvent, items: Array<[string, () => void, boolean?]>) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelector('.menu')?.remove();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const [label, run, danger] of items) {
    const b = h('button', {
      type: 'button',
      role: 'menuitem',
      class: danger ? 'danger' : undefined,
      text: label,
    });
    b.addEventListener('click', () => {
      m.remove();
      run();
    });
    m.append(b);
  }
  document.body.append(m);
  m.style.left = `${Math.min(e.clientX, window.innerWidth - m.offsetWidth - 4)}px`;
  m.style.top = `${Math.min(e.clientY, window.innerHeight - m.offsetHeight - 4)}px`;
  (m.querySelector('button') as HTMLElement | null)?.focus();
  m.addEventListener('keydown', (ev) => {
    const items = Array.from(m.querySelectorAll<HTMLElement>('button'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'Escape') m.remove();
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
}
document.addEventListener('mousedown', (e) => {
  const m = document.querySelector('.menu');
  if (m && !m.contains(e.target as Node)) m.remove();
});
const formatSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------
const current = () => tabs.find((t) => t.id === active);
const isDirty = (t: Tab) => JSON.stringify(t.request) !== t.saved;
let persistTimer: number | undefined;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    post({
      type: 'tabs',
      tabs: {
        tabs: tabs.map((t) => ({
          id: t.id,
          collection: t.collection,
          request: t.request,
          saved: t.saved,
          sub: t.sub,
        })),
        active,
      },
    });
  }, 400);
}
function openTab(request: ApiRequest, collection?: string, replace?: string, warnings?: string[]) {
  const existing =
    !replace && collection
      ? tabs.find((t) => t.collection === collection && t.request.id === request.id)
      : undefined;
  if (existing) {
    active = existing.id;
  } else {
    const tab: Tab = {
      id: replace || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      collection,
      request,
      saved: collection ? JSON.stringify(request) : '',
      sub: 'params',
      warnings,
    };
    const at = tabs.findIndex((t) => t.id === replace);
    if (at >= 0) tabs[at] = tab;
    else tabs.push(tab);
    active = tab.id;
  }
  persist();
  render();
}
function closeTab(id: string) {
  const t = tabs.find((x) => x.id === id);
  if (t && isDirty(t) && !confirmClose(t)) return;
  tabs = tabs.filter((x) => x.id !== id);
  if (active === id) active = tabs[tabs.length - 1]?.id;
  persist();
  render();
}
// The webview cannot show modal dialogs: closing a modified tab needs a second click.
let closeArmed: string | undefined;
function confirmClose(t: Tab) {
  if (closeArmed === t.id) return true;
  closeArmed = t.id;
  toast(`“${t.request.name}” has unsaved changes. Click × again to close it without saving.`);
  setTimeout(() => (closeArmed = undefined), 4000);
  return false;
}
function markDirty() {
  const t = current();
  if (!t) return;
  document.querySelector(`.tab[data-id="${t.id}"] .dirty`)?.toggleAttribute('hidden', !isDirty(t));
  persist();
}

// ---------------------------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------------------------
function kvEditor(
  rows: KeyValue[],
  onChange: () => void,
  options: { files?: boolean; placeholder?: [string, string] } = {},
): HTMLElement {
  const table = h('table', { class: 'kv' });
  const draw = () => {
    table.replaceChildren();
    const all = [...rows, { key: '', value: '' } as KeyValue];
    all.forEach((row, i) => {
      const isNew = i === rows.length;
      const on = h('input', {
        type: 'checkbox',
        'aria-label': 'Send this row',
        checked: row.enabled !== false,
        disabled: isNew,
      });
      on.addEventListener('change', () => {
        row.enabled = on.checked ? undefined : false;
        if (row.enabled === undefined) delete row.enabled;
        onChange();
      });
      const key = h('input', {
        class: 'field',
        type: 'text',
        value: row.key,
        placeholder: options.placeholder?.[0] || 'Key',
        'aria-label': 'Key',
        spellcheck: 'false',
      });
      const value = h('input', {
        class: 'field',
        type: 'text',
        value: row.value,
        placeholder: row.file ? 'path/in/workspace' : options.placeholder?.[1] || 'Value',
        'aria-label': 'Value',
        spellcheck: 'false',
      });
      const update = () => {
        if (isNew && (key.value || value.value)) {
          rows.push({ key: key.value, value: value.value });
          onChange();
          draw();
          (
            table
              .querySelectorAll<HTMLInputElement>('tr')
              [rows.length - 1]?.querySelector(
                document.activeElement === value
                  ? 'td:nth-child(3) input'
                  : 'td:nth-child(2) input',
              ) as HTMLInputElement | null
          )?.focus();
          return;
        }
        row.key = key.value;
        row.value = value.value;
        onChange();
      };
      key.addEventListener('input', update);
      value.addEventListener('input', update);
      const cells: Array<HTMLElement | undefined> = [
        h('td', {}, on),
        h('td', {}, key),
        h('td', {}, value),
      ];
      if (options.files) {
        const file = h('input', {
          type: 'checkbox',
          'aria-label': 'Value is a file path',
          title: 'File',
          checked: !!row.file,
          disabled: isNew,
        });
        file.addEventListener('change', () => {
          if (file.checked) row.file = true;
          else delete row.file;
          onChange();
          draw();
        });
        cells.push(h('td', { class: 'small muted' }, h('label', {}, file, ' file')));
      }
      const del = button(
        '',
        () => {
          rows.splice(i, 1);
          onChange();
          draw();
        },
        'btn ghost del',
        'trash',
        { 'aria-label': 'Remove row', title: 'Remove' },
      );
      if (isNew) del.setAttribute('disabled', '');
      cells.push(h('td', {}, del));
      table.append(h('tr', {}, ...cells));
    });
  };
  draw();
  return table;
}

function secretHint(text: string): HTMLElement | undefined {
  return text && !/\{\{[^}]+\}\}/.test(text)
    ? h('p', {
        class: 'notice small',
        text: 'This value is saved in the request file. For credentials use a secret environment variable, e.g. {{accessToken}}.',
      })
    : undefined;
}

function authEditor(t: Tab): HTMLElement {
  const a = t.request.auth;
  const wrap = h('div', { class: 'form-grid' });
  const type = h('select', {
    class: 'field',
    id: 'auth-type',
    'aria-label': 'Authentication type',
  });
  for (const [v, label] of [
    ['inherit', 'Inherit from collection'],
    ['none', 'No auth'],
    ['bearer', 'Bearer token'],
    ['basic', 'Basic auth'],
    ['apikey', 'API key'],
    ['oauth2', 'OAuth 2.0'],
  ])
    type.append(h('option', { value: v, text: label, selected: a.type === v }));
  type.addEventListener('change', () => {
    const v = type.value;
    t.request.auth =
      v === 'bearer'
        ? { type: 'bearer', token: '{{accessToken}}' }
        : v === 'basic'
          ? { type: 'basic', username: '', password: '{{password}}' }
          : v === 'apikey'
            ? { type: 'apikey', key: 'X-API-Key', value: '{{apiKey}}', in: 'header' }
            : v === 'oauth2'
              ? {
                  type: 'oauth2',
                  grant: 'client_credentials',
                  tokenUrl: '',
                  clientId: '',
                  clientSecret: '{{clientSecret}}',
                }
              : { type: v as 'none' | 'inherit' };
    markDirty();
    render();
  });
  wrap.append(h('label', { for: 'auth-type', text: 'Type' }), type);
  const input = (label: string, value: string, set: (v: string) => void, secret = false) => {
    const id = `auth-${label.toLowerCase().replace(/\W+/g, '-')}`;
    const el = h('input', { class: 'field', id, type: 'text', value, spellcheck: 'false' });
    const hint = h('div', {});
    const refresh = () =>
      hint.replaceChildren(...(secret && secretHint(el.value) ? [secretHint(el.value)!] : []));
    el.addEventListener('input', () => {
      set(el.value);
      refresh();
      markDirty();
    });
    refresh();
    wrap.append(h('label', { for: id, text: label }), h('div', {}, el, hint));
  };
  if (a.type === 'bearer') input('Token', a.token, (v) => (a.token = v), true);
  if (a.type === 'basic') {
    input('Username', a.username, (v) => (a.username = v));
    input('Password', a.password, (v) => (a.password = v), true);
  }
  if (a.type === 'apikey') {
    input('Key', a.key, (v) => (a.key = v));
    input('Value', a.value, (v) => (a.value = v), true);
    const where = h(
      'select',
      { class: 'field', id: 'auth-in' },
      h('option', { value: 'header', text: 'Header', selected: a.in === 'header' }),
      h('option', { value: 'query', text: 'Query parameter', selected: a.in === 'query' }),
    );
    where.addEventListener('change', () => {
      a.in = where.value as 'header' | 'query';
      markDirty();
    });
    wrap.append(h('label', { for: 'auth-in', text: 'Add to' }), where);
  }
  if (a.type === 'oauth2') {
    const grant = h(
      'select',
      { class: 'field', id: 'auth-grant' },
      h('option', {
        value: 'client_credentials',
        text: 'Client credentials',
        selected: a.grant === 'client_credentials',
      }),
      h('option', {
        value: 'authorization_code',
        text: 'Authorization code with PKCE',
        selected: a.grant === 'authorization_code',
      }),
    );
    grant.addEventListener('change', () => {
      a.grant = grant.value as typeof a.grant;
      markDirty();
      render();
    });
    wrap.append(h('label', { for: 'auth-grant', text: 'Grant' }), grant);
    if (a.grant === 'authorization_code')
      input('Authorization URL', a.authUrl || '', (v) => (a.authUrl = v));
    input('Token URL', a.tokenUrl, (v) => (a.tokenUrl = v));
    input('Client ID', a.clientId, (v) => (a.clientId = v));
    input('Client secret', a.clientSecret || '', (v) => (a.clientSecret = v || undefined), true);
    input('Scope', a.scope || '', (v) => (a.scope = v || undefined));
    wrap.append(
      h('span', {}),
      h('p', {
        class: 'muted small',
        text:
          a.grant === 'authorization_code'
            ? 'Opens the sign-in page in your browser and receives the code on a loopback address (127.0.0.1). In code-server the browser must be able to reach the server on that port. Tokens are kept in memory for this session.'
            : 'The token is requested when you send and kept in memory for this session.',
      }),
    );
  }
  if (a.type === 'inherit')
    wrap.append(
      h('span', {}),
      h('p', {
        class: 'muted small',
        text: 'Uses the collection’s authentication (none for requests outside a collection).',
      }),
    );
  return wrap;
}

function bodyEditor(t: Tab): HTMLElement {
  const b = t.request.body;
  const wrap = h('div', {});
  const type = h('select', { class: 'field', 'aria-label': 'Body type' });
  for (const [v, label] of [
    ['none', 'No body'],
    ['json', 'JSON'],
    ['text', 'Text'],
    ['xml', 'XML'],
    ['form', 'Form URL encoded'],
    ['multipart', 'Multipart form'],
    ['binary', 'Binary file'],
  ])
    type.append(h('option', { value: v, text: label, selected: b.type === v }));
  type.addEventListener('change', () => {
    b.type = type.value as BodyType;
    if ((b.type === 'form' || b.type === 'multipart') && !b.fields) b.fields = [];
    markDirty();
    render();
  });
  const bar = h('div', { class: 'urlbar' }, type);
  wrap.append(bar);
  if (t.request.method === 'GET' || t.request.method === 'HEAD')
    wrap.append(
      h('p', {
        class: 'muted small',
        text: `${t.request.method} requests are sent without a body.`,
      }),
    );
  if (b.type === 'json' || b.type === 'text' || b.type === 'xml') {
    const area = h('textarea', {
      class: 'field',
      id: 'body-text',
      spellcheck: 'false',
      'aria-label': 'Body',
    });
    area.value = b.text || '';
    const status = h('p', { class: 'small', role: 'status' });
    const validate = () => {
      if (b.type !== 'json' || !area.value.trim()) return status.replaceChildren();
      try {
        // Variables may sit where values go; validate with them replaced.
        JSON.parse(area.value.replace(/\{\{[^}]+\}\}/g, '0'));
        status.className = 'small pass';
        status.textContent = 'Valid JSON';
      } catch (e) {
        status.className = 'small fail';
        status.textContent = e instanceof Error ? e.message : String(e);
      }
    };
    area.addEventListener('input', () => {
      b.text = area.value;
      validate();
      markDirty();
    });
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
        area.dispatchEvent(new Event('input'));
      }
    });
    if (b.type === 'json')
      bar.append(
        button(
          'Format JSON',
          () => {
            try {
              area.value = JSON.stringify(JSON.parse(area.value), null, 2);
              b.text = area.value;
              validate();
              markDirty();
            } catch (e) {
              toast(`Cannot format: ${e instanceof Error ? e.message : String(e)}`, true);
            }
          },
          'btn ghost small',
        ),
      );
    wrap.append(area, status);
    validate();
  } else if (b.type === 'form' || b.type === 'multipart')
    wrap.append(kvEditor((b.fields ||= []), markDirty, { files: b.type === 'multipart' }));
  else if (b.type === 'binary') {
    const path = h('input', {
      class: 'field',
      type: 'text',
      value: b.text || '',
      placeholder: 'path/in/workspace/file.bin',
      'aria-label': 'File path',
      spellcheck: 'false',
    });
    path.addEventListener('input', () => {
      b.text = path.value;
      markDirty();
    });
    wrap.append(
      path,
      h('p', { class: 'muted small', text: 'A file inside the workspace, sent as the body.' }),
    );
  }
  return wrap;
}

function codeView(t: Tab): HTMLElement {
  const lang = t.code || 'curl';
  const select = h(
    'select',
    { class: 'field', 'aria-label': 'Language' },
    h('option', { value: 'curl', text: 'curl', selected: lang === 'curl' }),
    h('option', { value: 'python', text: 'Python (requests)', selected: lang === 'python' }),
  );
  select.addEventListener('change', () => {
    t.code = select.value as 'curl' | 'python';
    render();
  });
  const code = lang === 'python' ? toPython(t.request) : toCurl(t.request);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'urlbar' },
      select,
      button(
        'Copy',
        () => void navigator.clipboard.writeText(code).then(() => toast('Copied.')),
        'btn ghost small',
        'copy',
      ),
    ),
    h('pre', { class: 'code', tabindex: '0', 'aria-label': `${lang} code` }, code),
    h('p', {
      class: 'muted small',
      text: '{{variables}} stay as written; secret values are never inserted.',
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------
function highlight(text: string, query: string): Node[] {
  if (!query) return [document.createTextNode(text)];
  const out: Node[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0 && out.length < 2000; i = lower.indexOf(q, i + q.length)) {
    out.push(
      document.createTextNode(text.slice(at, i)),
      h('mark', { text: text.slice(i, i + q.length) }),
    );
    at = i + q.length;
  }
  out.push(document.createTextNode(text.slice(at)));
  return out;
}

function responseView(t: Tab): HTMLElement {
  const box = h('section', { class: 'response', 'aria-label': 'Response' });
  if (t.sending) {
    box.append(
      h(
        'div',
        { class: 'response-head' },
        h('span', { class: 'muted', role: 'status', text: 'Sending…' }),
        button('Cancel', () => post({ type: 'cancel', tab: t.id }), 'btn small'),
      ),
    );
    return box;
  }
  if (t.error) {
    box.append(
      h('div', { class: 'response-head' }, h('span', { class: 'status err', text: 'Error' })),
      h('div', { class: 'response-body' }, h('p', { class: 'fail', role: 'alert', text: t.error })),
    );
    return box;
  }
  const r = t.response;
  if (!r) {
    box.append(
      h(
        'div',
        { class: 'response-body' },
        h('p', {
          class: 'muted small',
          text: 'Send the request (Ctrl/Cmd+Enter) to see the response here.',
        }),
      ),
    );
    return box;
  }
  const passed = (t.tests || []).filter((x) => x.pass).length;
  const head = h(
    'div',
    { class: 'response-head' },
    h('span', { class: `status s${String(r.status)[0]}`, text: `${r.status} ${r.statusText}` }),
    h('span', {
      class: 'muted small',
      text: `${r.ms} ms · ${formatSize(r.size)}${r.truncated ? ' (truncated)' : ''}${r.redirects.length ? ` · ${r.redirects.length} redirect${r.redirects.length === 1 ? '' : 's'}` : ''}`,
    }),
    t.tests?.length
      ? h('span', {
          class: passed === t.tests.length ? 'pass small' : 'fail small',
          text: `Tests ${passed}/${t.tests.length}`,
        })
      : undefined,
  );
  const tabsEl = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Response' });
  for (const [id, label, count] of [
    ['body', 'Body', 0],
    ['headers', 'Headers', r.headers.length],
    ['cookies', 'Cookies', r.cookies.length],
    ['tests', 'Tests', t.tests?.length || 0],
  ] as const) {
    const b = h(
      'button',
      { type: 'button', role: 'tab', 'aria-selected': String((t.respTab || 'body') === id) },
      label,
      count ? h('span', { class: 'count', text: String(count) }) : undefined,
    );
    b.addEventListener('click', () => {
      t.respTab = id;
      render();
    });
    tabsEl.append(b);
  }
  head.append(h('span', { style: 'flex:1' }), tabsEl);
  const body = h('div', { class: 'response-body' });
  const tab = t.respTab || 'body';
  if (tab === 'body') {
    const isJson = /json/.test(r.contentType) || (!r.contentType && /^\s*[[{]/.test(r.text || ''));
    let text = r.text ?? '';
    if (isJson && (t.view || 'pretty') === 'pretty')
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* show as received */
      }
    else if (/xml/.test(r.contentType) && (t.view || 'pretty') === 'pretty') text = prettyXml(text);
    const search = h('input', {
      class: 'field',
      type: 'search',
      placeholder: 'Search the response',
      'aria-label': 'Search the response',
      value: t.search || '',
      id: 'resp-search',
    });
    search.addEventListener('input', () => {
      t.search = search.value;
      pre.replaceChildren(...highlight(text, t.search));
      const n = t.search ? text.toLowerCase().split(t.search.toLowerCase()).length - 1 : 0;
      found.textContent = t.search ? `${n} match${n === 1 ? '' : 'es'}` : '';
    });
    const found = h('span', { class: 'muted small', role: 'status' });
    const views = h(
      'select',
      { class: 'field', 'aria-label': 'Body view' },
      h('option', { value: 'pretty', text: 'Pretty', selected: (t.view || 'pretty') === 'pretty' }),
      h('option', { value: 'raw', text: 'Raw', selected: t.view === 'raw' }),
    );
    views.addEventListener('change', () => {
      t.view = views.value as 'pretty' | 'raw';
      render();
    });
    body.append(
      h(
        'div',
        { class: 'urlbar' },
        r.text !== undefined ? views : undefined,
        r.text !== undefined ? search : undefined,
        found,
        h('span', { style: 'flex:1' }),
        r.text !== undefined
          ? button(
              'Copy',
              () => void navigator.clipboard.writeText(text).then(() => toast('Copied.')),
              'btn ghost small',
              'copy',
            )
          : undefined,
        button('Download', () => post({ type: 'download', tab: t.id }), 'btn ghost small'),
      ),
    );
    const pre = h('pre', { class: 'code', tabindex: '0', 'aria-label': 'Response body' });
    if (r.text !== undefined) {
      pre.append(...highlight(text || '(empty body)', t.search || ''));
      if (/html/.test(r.contentType))
        body.append(
          h('p', {
            class: 'muted small',
            text: 'HTML is shown as source; it is never rendered or run.',
          }),
        );
      body.append(pre);
    } else if (
      /^image\/(png|jpe?g|gif|webp|bmp|x-icon)$/i.test(r.contentType.split(';')[0]) &&
      r.base64 &&
      !r.truncated
    )
      body.append(
        h('img', {
          src: `data:${r.contentType.split(';')[0]};base64,${r.base64}`,
          alt: 'Response image',
        }),
      );
    else
      body.append(
        h('p', {
          class: 'muted small',
          text: `Binary response (${r.contentType || 'unknown type'}, ${formatSize(r.size)}). Use Download to save it.`,
        }),
      );
    if (search.value) search.dispatchEvent(new Event('input'));
  } else if (tab === 'headers') {
    body.append(
      h(
        'table',
        { class: 'kv' },
        ...r.headers.map(([k, v]) =>
          h(
            'tr',
            {},
            h('td', { class: 'small', text: k, style: 'width:30%;font-weight:600' }),
            h('td', { class: 'small', text: v }),
          ),
        ),
      ),
    );
    if (r.redirects.length)
      body.append(
        h('p', {
          class: 'muted small',
          text: `Redirects: ${r.redirects.map((x) => `${x.status} → ${x.url}`).join(', ')}. Credentials are not sent to other origins.`,
        }),
      );
  } else if (tab === 'cookies') {
    body.append(
      r.cookies.length
        ? h(
            'table',
            { class: 'kv' },
            ...r.cookies.map((c) =>
              h(
                'tr',
                {},
                h('td', { class: 'small', text: c.name, style: 'font-weight:600' }),
                h('td', { class: 'small', text: c.value }),
                h('td', { class: 'small muted', text: c.attributes }),
              ),
            ),
          )
        : h('p', { class: 'muted small', text: 'The response sets no cookies.' }),
    );
  } else {
    body.append(
      t.tests?.length
        ? h(
            'ul',
            { class: 'tests' },
            ...t.tests.map((x) =>
              h(
                'li',
                {},
                h('span', { class: x.pass ? 'pass' : 'fail', text: x.pass ? '✓ ' : '✗ ' }),
                h('code', { text: x.source }),
                h('span', { class: 'muted', text: ` — ${x.message}` }),
              ),
            ),
          )
        : h('p', {
            class: 'muted small',
            text: 'No tests. Add assertions in the Tests tab, e.g. status == 200.',
          }),
    );
  }
  box.append(head, body);
  return box;
}

// ---------------------------------------------------------------------------------------------
// Request editor
// ---------------------------------------------------------------------------------------------
function sendCurrent() {
  const t = current();
  if (!t || t.sending) return;
  if (!state?.trusted) return toast('Sending requests needs a trusted workspace.', true);
  t.sending = true;
  t.error = undefined;
  render();
  post({ type: 'send', tab: t.id, request: t.request, collection: t.collection });
}
function saveCurrent() {
  const t = current();
  if (t) post({ type: 'save', tab: t.id, request: t.request, collection: t.collection });
}

function requestView(t: Tab): HTMLElement {
  const r = t.request;
  const wrap = h('div', { class: 'request' });
  const method = h('select', { class: 'field method', 'aria-label': 'Method', id: 'method' });
  for (const m of HTTP_METHODS)
    method.append(h('option', { value: m, text: m, selected: r.method === m }));
  method.className = `field method m-${r.method}`;
  method.addEventListener('change', () => {
    r.method = method.value as ApiRequest['method'];
    method.className = `field method m-${r.method}`;
    markDirty();
    document
      .querySelector(`.tab[data-id="${t.id}"] .m`)
      ?.replaceWith(h('span', { class: `m m-${r.method}`, text: r.method }));
  });
  const url = h('input', {
    class: 'field url',
    id: 'url',
    type: 'text',
    value: r.url,
    placeholder: 'https://api.example.com/users — or paste a curl command',
    'aria-label': 'URL',
    spellcheck: 'false',
  });
  url.addEventListener('input', () => {
    r.url = url.value;
    markDirty();
  });
  // Pasting a curl command fills the whole request.
  url.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (/^\s*(\$\s+)?curl(\.exe)?\s/i.test(text)) {
      e.preventDefault();
      post({ type: 'importCurl', text, tab: t.id });
    }
  });
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendCurrent();
  });
  const envs = h('select', { class: 'field', 'aria-label': 'Environment', id: 'env-select' });
  envs.append(
    h('option', { value: '', text: 'No environment' }),
    ...(state?.environments || []).map((e) =>
      h('option', { value: e.id, text: e.name, selected: e.id === state?.environment }),
    ),
  );
  envs.addEventListener('change', () => post({ type: 'setEnvironment', id: envs.value }));
  const sendBtn = t.sending
    ? button('Cancel', () => post({ type: 'cancel', tab: t.id }), 'btn')
    : button('Send', sendCurrent, 'btn primary', undefined, { title: 'Send (Ctrl/Cmd+Enter)' });
  const name = h('input', {
    class: 'field',
    type: 'text',
    value: r.name,
    'aria-label': 'Request name',
    id: 'req-name',
  });
  name.addEventListener('input', () => {
    r.name = name.value;
    markDirty();
    const label = document.querySelector(`.tab[data-id="${t.id}"] .name`);
    if (label) label.textContent = r.name || 'Untitled';
  });
  wrap.append(
    h(
      'div',
      { class: 'name-row' },
      name,
      t.collection
        ? h('span', {
            class: 'muted small',
            text: `${state?.collections.find((c) => c.id === t.collection)?.name || t.collection} / ${r.id}`,
          })
        : h('span', { class: 'muted small', text: 'Not saved' }),
      button(t.collection ? 'Save' : 'Save to collection…', saveCurrent, 'btn', 'save', {
        title: 'Save (Ctrl/Cmd+S)',
      }),
    ),
    h('div', { class: 'urlbar' }, method, url, envs, sendBtn),
  );
  for (const w of t.warnings || []) wrap.append(h('p', { class: 'notice small', text: w }));
  const vars = variablesIn(JSON.stringify(r));
  if (t.missing?.length)
    wrap.append(
      h('p', {
        class: 'notice small',
        text: `No value for ${t.missing.map((m) => `{{${m}}}`).join(', ')} in the active environment, collection or globals.`,
      }),
    );
  else if (vars.length && !state?.environment)
    wrap.append(
      h('p', {
        class: 'muted small',
        text: `Uses ${vars
          .slice(0, 6)
          .map((v) => `{{${v}}}`)
          .join(', ')}; choose an environment to provide values.`,
      }),
    );
  const subs: Array<[Sub, string, number]> = [
    ['params', 'Params', r.params.length],
    ['auth', 'Auth', 0],
    ['headers', 'Headers', r.headers.length],
    ['body', 'Body', 0],
    ['cookies', 'Cookies', r.cookies?.length || 0],
    [
      'tests',
      'Tests',
      (r.tests || '').split('\n').filter((x) => x.trim() && !x.trim().startsWith('#')).length,
    ],
    ['settings', 'Settings', 0],
    ['code', 'Code', 0],
  ];
  const tabsEl = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Request' });
  for (const [id, label, count] of subs) {
    const b = h(
      'button',
      { type: 'button', role: 'tab', 'aria-selected': String(t.sub === id), id: `sub-${id}` },
      label,
      count ? h('span', { class: 'count', text: String(count) }) : undefined,
    );
    b.addEventListener('click', () => {
      t.sub = id;
      persist();
      render();
    });
    tabsEl.append(b);
  }
  wrap.append(tabsEl);
  const panel = h('div', { role: 'tabpanel', 'aria-labelledby': `sub-${t.sub}` });
  if (t.sub === 'params')
    panel.append(
      kvEditor(r.params, markDirty, { placeholder: ['Parameter', 'Value'] }),
      h('p', {
        class: 'muted small',
        text: 'Added to the URL’s query string when sending. Values may use {{variables}}.',
      }),
    );
  else if (t.sub === 'headers')
    panel.append(
      kvEditor(r.headers, markDirty, { placeholder: ['Header', 'Value'] }),
      h('p', {
        class: 'muted small',
        text: 'Content-Type is set from the body type unless you set it here.',
      }),
      ...literalSecrets(r.headers),
    );
  else if (t.sub === 'cookies')
    panel.append(
      kvEditor((r.cookies ||= []), markDirty, { placeholder: ['Cookie', 'Value'] }),
      h('p', {
        class: 'muted small',
        text: 'Sent as one Cookie header. Response cookies are shown in the response; they are not stored.',
      }),
      ...literalSecrets(r.cookies),
    );
  else if (t.sub === 'auth') panel.append(authEditor(t));
  else if (t.sub === 'body') panel.append(bodyEditor(t));
  else if (t.sub === 'tests') {
    const area = h('textarea', {
      class: 'field',
      spellcheck: 'false',
      'aria-label': 'Tests',
      placeholder: 'status == 200\njson $.id exists\nset token = json $.access_token',
    });
    area.value = r.tests || '';
    area.addEventListener('input', () => {
      r.tests = area.value;
      markDirty();
    });
    panel.append(
      area,
      h(
        'pre',
        { class: 'code small muted' },
        'status == 200 · status in 200..299 · time < 500 · size < 10000\nheader content-type contains json · header x-id exists\njson $.id exists · json $.items.length >= 1 · json $.name == "Mario" · json $.v matches ^v\\d+\nbody contains ok · schema (uses the OpenAPI response schema)\nset token = json $.access_token   → {{token}} for the next requests (not saved)',
      ),
    );
  } else if (t.sub === 'settings') {
    const timeout = h('input', {
      class: 'field',
      type: 'number',
      min: '1',
      max: '600',
      id: 'timeout',
      value: String(Math.round((r.timeoutMs ?? 30000) / 1000)),
    });
    timeout.addEventListener('input', () => {
      r.timeoutMs = Math.max(1, Math.min(600, Number(timeout.value) || 30)) * 1000;
      markDirty();
    });
    const follow = h('input', {
      type: 'checkbox',
      id: 'follow',
      checked: r.followRedirects !== false,
    });
    follow.addEventListener('change', () => {
      if (follow.checked) delete r.followRedirects;
      else r.followRedirects = false;
      markDirty();
    });
    const desc = h('textarea', {
      class: 'field',
      id: 'desc',
      style: 'min-height:70px;font-family:inherit',
    });
    desc.value = r.description || '';
    desc.addEventListener('input', () => {
      r.description = desc.value || undefined;
      markDirty();
    });
    panel.append(
      h(
        'div',
        { class: 'form-grid' },
        h('label', { for: 'timeout', text: 'Timeout (seconds)' }),
        timeout,
        h('label', { for: 'follow', text: 'Follow redirects' }),
        h(
          'div',
          {},
          follow,
          h('span', {
            class: 'muted small',
            text: ' Credentials are dropped when a redirect goes to another origin.',
          }),
        ),
        h('label', { for: 'desc', text: 'Description' }),
        desc,
        h('span', {}),
        h('p', {
          class: 'muted small',
          text: 'TLS certificates are always verified. Responses larger than notespace.api.maxResponseMB are truncated.',
        }),
      ),
    );
  } else panel.append(codeView(t));
  wrap.append(panel);
  return wrap;
}

// ---------------------------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------------------------
let dragged: { collection: string; path: string; folder: boolean } | undefined;
function treeView(c: CollectionDto, nodes: TreeNode[], parent: string): HTMLElement {
  const list = h('ul', { class: 'tree', role: 'group' });
  const q = filter.toLowerCase();
  const matches = (n: TreeNode): boolean =>
    !q ||
    n.name.toLowerCase().includes(q) ||
    (n.method || '').toLowerCase() === q ||
    !!n.children?.some(matches);
  nodes.filter(matches).forEach((n, index) => {
    const isOpen = tabs.some(
      (t) => t.id === active && t.collection === c.id && t.request.id === n.path,
    );
    const el = h(
      'button',
      {
        type: 'button',
        class: 'node',
        'aria-current': isOpen ? 'true' : undefined,
        draggable: 'true',
        title: n.path,
        role: 'treeitem',
      },
      n.kind === 'folder'
        ? svg('folder', 13)
        : h('span', { class: `m m-${n.method}`, text: n.method }),
      h('span', { class: 'name', text: n.name }),
    );
    if (n.kind === 'request')
      el.addEventListener('click', () => post({ type: 'open', collection: c.id, path: n.path }));
    el.addEventListener('contextmenu', (e) =>
      menu(
        e,
        n.kind === 'folder'
          ? [
              ['New request', () => post({ type: 'newRequest', collection: c.id, path: n.path })],
              ['New folder', () => post({ type: 'createFolder', collection: c.id, path: n.path })],
              ['Run folder', () => post({ type: 'runCollection', collection: c.id, path: n.path })],
              [
                'Rename…',
                () =>
                  post({
                    type: 'rename',
                    collection: c.id,
                    path: n.path,
                    folder: true,
                    name: n.name,
                  }),
              ],
              [
                'Delete…',
                () =>
                  post({
                    type: 'deleteItem',
                    collection: c.id,
                    path: n.path,
                    folder: true,
                    name: n.name,
                  }),
                true,
              ],
            ]
          : [
              ['Open', () => post({ type: 'open', collection: c.id, path: n.path })],
              ['Duplicate', () => post({ type: 'duplicate', collection: c.id, path: n.path })],
              [
                'Rename…',
                () => post({ type: 'rename', collection: c.id, path: n.path, name: n.name }),
              ],
              [
                'Move up',
                () =>
                  post({
                    type: 'move',
                    collection: c.id,
                    path: n.path,
                    to: parent,
                    index: Math.max(0, index - 1),
                  }),
              ],
              [
                'Move down',
                () =>
                  post({
                    type: 'move',
                    collection: c.id,
                    path: n.path,
                    to: parent,
                    index: index + 1,
                  }),
              ],
              [
                'Delete…',
                () => post({ type: 'deleteItem', collection: c.id, path: n.path, name: n.name }),
                true,
              ],
            ],
      ),
    );
    el.addEventListener(
      'dragstart',
      () => (dragged = { collection: c.id, path: n.path, folder: n.kind === 'folder' }),
    );
    el.addEventListener('dragover', (e) => {
      if (!dragged || dragged.collection !== c.id) return;
      e.preventDefault();
      el.classList.add('drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const d = dragged;
      dragged = undefined;
      if (!d || d.path === n.path) return;
      // Dropping on a folder moves into it; on a request, after it in the same folder.
      if (n.kind === 'folder')
        post({ type: 'move', collection: c.id, path: d.path, folder: d.folder, to: n.path });
      else
        post({
          type: 'move',
          collection: c.id,
          path: d.path,
          folder: d.folder,
          to: parent,
          index: index + 1,
        });
    });
    const li = h('li', {}, el);
    if (n.children) li.append(treeView(c, n.children, n.path));
    list.append(li);
  });
  return list;
}

function sidebar(): HTMLElement {
  const box = h('aside', { class: 'side', 'aria-label': 'API Client' });
  const tabsEl = h('div', { class: 'side-tabs', role: 'tablist' });
  for (const [id, label] of [
    ['collections', 'Collections'],
    ['environments', 'Environments'],
    ['history', 'History'],
  ] as const) {
    const b = h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(side === id),
      text: label,
    });
    b.addEventListener('click', () => {
      side = id;
      render();
    });
    tabsEl.append(b);
  }
  const body = h('div', { class: 'side-body' });
  const s = state!;
  if (side === 'collections') {
    const search = h('input', {
      class: 'field',
      type: 'search',
      placeholder: 'Search requests',
      'aria-label': 'Search requests',
      value: filter,
      id: 'tree-search',
      style: 'width:100%;margin:0 0 6px',
    });
    search.addEventListener('input', () => {
      filter = search.value;
      render();
    });
    body.append(
      h(
        'div',
        { class: 'side-actions' },
        button('Collection', () => post({ type: 'createCollection' }), 'btn small', 'plus', {
          title: 'New collection',
        }),
        button('Import', () => post({ type: 'importFile' }), 'btn ghost small', undefined, {
          title: 'Import an OpenAPI description or a collection export',
        }),
        button('New request', () => openTab(emptyRequest('new', 'New request')), 'btn ghost small'),
      ),
      search,
    );
    if (!s.collections.length)
      body.append(
        h(
          'div',
          { class: 'empty' },
          h('p', {
            text: 'Collections keep requests as JSON files in the api/ folder of your workspace, ready for Git.',
          }),
          button('New collection', () => post({ type: 'createCollection' }), 'btn small'),
        ),
      );
    for (const c of s.collections) {
      const head = h(
        'button',
        { type: 'button', class: 'node collection-head', title: c.description || c.name },
        svg('folder', 13),
        h('span', { class: 'name', text: c.name }),
      );
      const items: Array<[string, () => void, boolean?]> = [
        ['New request', () => post({ type: 'newRequest', collection: c.id, path: '' })],
        ['New folder', () => post({ type: 'createFolder', collection: c.id, path: '' })],
        ['Run collection', () => post({ type: 'runCollection', collection: c.id })],
        ['Rename…', () => post({ type: 'renameCollection', collection: c.id })],
        ['Export…', () => post({ type: 'export', collection: c.id })],
        ['Delete…', () => post({ type: 'deleteCollection', collection: c.id }), true],
      ];
      head.addEventListener('click', (e) => menu(e, items));
      head.addEventListener('contextmenu', (e) => menu(e, items));
      head.addEventListener('dragover', (e) => {
        if (dragged?.collection === c.id) e.preventDefault();
      });
      head.addEventListener('drop', (e) => {
        e.preventDefault();
        const d = dragged;
        dragged = undefined;
        if (d) post({ type: 'move', collection: c.id, path: d.path, folder: d.folder, to: '' });
      });
      body.append(head, treeView(c, c.tree, ''));
      for (const p of c.problems) body.append(h('p', { class: 'notice small', text: p }));
    }
    if (runResults) {
      const rr = runResults;
      const passed = rr.results.filter((x) => !x.error && x.tests.every((t) => t.pass)).length;
      body.append(
        h('h3', {
          class: 'small',
          text: `Run: ${rr.results.length}/${rr.total}${rr.done ? ` · ${passed} passed` : '…'}`,
        }),
        h(
          'ul',
          { class: 'tests' },
          ...rr.results.map((x) =>
            h(
              'li',
              {},
              h('span', {
                class: !x.error && x.tests.every((t) => t.pass) ? 'pass' : 'fail',
                text: !x.error && x.tests.every((t) => t.pass) ? '✓ ' : '✗ ',
              }),
              `${x.name} `,
              h('span', {
                class: 'muted',
                text:
                  x.error ||
                  `${x.status} · ${x.ms} ms · ${x.tests.filter((t) => t.pass).length}/${x.tests.length} tests`,
              }),
            ),
          ),
        ),
      );
    }
  } else if (side === 'environments') {
    const select = h('select', {
      class: 'field',
      'aria-label': 'Active environment',
      style: 'width:100%',
    });
    select.append(
      h('option', { value: '', text: 'No environment' }),
      ...s.environments.map((e) =>
        h('option', { value: e.id, text: e.name, selected: e.id === s.environment }),
      ),
    );
    select.addEventListener('change', () => {
      envDraft = undefined;
      post({ type: 'setEnvironment', id: select.value });
    });
    body.append(
      h(
        'div',
        { class: 'side-actions' },
        select,
        button('Environment', () => post({ type: 'newEnvironment' }), 'btn small', 'plus'),
      ),
    );
    const env = s.environments.find((e) => e.id === s.environment);
    if (env) {
      if (!envDraft || envDraft.id !== env.id) envDraft = JSON.parse(JSON.stringify(env));
      const d = envDraft!;
      const rows = h('div', {});
      const draw = () => {
        rows.replaceChildren();
        d.variables.forEach((v, i) => {
          const on = h('input', {
            type: 'checkbox',
            checked: v.enabled !== false,
            'aria-label': `Use ${v.key}`,
          });
          on.addEventListener('change', () => (v.enabled = on.checked ? undefined : false));
          const key = h('input', {
            class: 'field',
            value: v.key,
            'aria-label': 'Variable',
            spellcheck: 'false',
          });
          key.addEventListener('input', () => (v.key = key.value));
          const value = v.secret
            ? button(
                v.hasValue ? 'Change…' : 'Set value…',
                () => post({ type: 'setSecret', id: d.id, name: v.key }),
                'btn small',
                undefined,
                { title: 'Secret: stored in VS Code secret storage' },
              )
            : (() => {
                const el = h('input', {
                  class: 'field',
                  value: v.value,
                  'aria-label': `Value of ${v.key}`,
                  spellcheck: 'false',
                });
                el.addEventListener('input', () => (v.value = el.value));
                return el;
              })();
          const secret = h(
            'label',
            { class: 'small', title: 'Keep the value in VS Code secret storage, not in the file' },
            (() => {
              const c = h('input', { type: 'checkbox', checked: !!v.secret });
              c.addEventListener('change', () => {
                v.secret = c.checked || undefined;
                v.value = '';
                draw();
              });
              return c;
            })(),
            ' secret',
          );
          const del = button(
            '',
            () => {
              d.variables.splice(i, 1);
              draw();
            },
            'btn ghost',
            'trash',
            { 'aria-label': `Remove ${v.key}` },
          );
          rows.append(h('div', { class: 'env-row' }, on, key, value, secret, del));
        });
      };
      draw();
      body.append(
        h('h3', { class: 'small', text: env.name }),
        rows,
        h(
          'div',
          { class: 'side-actions' },
          button(
            'Variable',
            () => {
              d.variables.push({ key: '', value: '' });
              draw();
            },
            'btn ghost small',
            'plus',
          ),
          button(
            'Save',
            () =>
              post({
                type: 'saveEnvironment',
                id: d.id,
                env: { name: d.name, variables: d.variables },
              }),
            'btn primary small',
            undefined,
            { 'aria-label': `Save environment ${d.name}` },
          ),
          button(
            'Delete…',
            () => post({ type: 'deleteEnvironment', id: d.id }),
            'btn ghost small danger',
          ),
        ),
        h('p', {
          class: 'muted small',
          text: 'Precedence: request > runtime (extracted by tests) > environment > collection > globals. Secret values never leave VS Code secret storage.',
        }),
      );
    } else
      body.append(
        h(
          'div',
          { class: 'empty' },
          h('p', {
            text: 'Environments hold variables such as {{baseUrl}} per stage: Local, Staging, Production.',
          }),
          button('New environment', () => post({ type: 'newEnvironment' }), 'btn small'),
        ),
      );
    // Globals: plain values shared by every collection in this workspace (not secrets).
    if (!globalsDraft) globalsDraft = s.globals.map((g) => ({ ...g }));
    const globals = globalsDraft;
    const grows = h('div', {});
    const drawGlobals = () => {
      grows.replaceChildren(
        ...globals.map((g, i) => {
          const key = h('input', {
            class: 'field',
            value: g.key,
            'aria-label': 'Global variable',
            spellcheck: 'false',
          });
          key.addEventListener('input', () => (g.key = key.value));
          const value = h('input', {
            class: 'field',
            value: g.value,
            'aria-label': `Value of global ${g.key}`,
            spellcheck: 'false',
          });
          value.addEventListener('input', () => (g.value = value.value));
          const del = button(
            '',
            () => {
              globals.splice(i, 1);
              drawGlobals();
            },
            'btn ghost',
            'trash',
            { 'aria-label': `Remove global ${g.key}` },
          );
          return h('div', { class: 'env-row' }, key, value, del);
        }),
      );
    };
    drawGlobals();
    body.append(
      h('h3', { class: 'small', text: 'Globals' }),
      grows,
      h(
        'div',
        { class: 'side-actions' },
        button(
          'Global',
          () => {
            globals.push({ key: '', value: '' });
            drawGlobals();
          },
          'btn ghost small',
          'plus',
          { 'aria-label': 'Add global variable' },
        ),
        button(
          'Save',
          () => {
            const clean = globals.filter((g) => g.key.trim());
            s.globals = clean;
            globalsDraft = undefined;
            post({ type: 'setGlobals', globals: clean });
            toast('Globals saved.');
          },
          'btn small',
          undefined,
          { 'aria-label': 'Save globals' },
        ),
      ),
    );
    if (s.runtime.length)
      body.append(
        h(
          'p',
          { class: 'small', text: `Runtime variables: ${s.runtime.join(', ')} ` },
          button('Clear', () => post({ type: 'clearRuntime' }), 'btn ghost small'),
        ),
      );
  } else {
    body.append(
      h(
        'div',
        { class: 'side-actions' },
        button('Clear history…', () => post({ type: 'clearHistory' }), 'btn ghost small', 'trash'),
      ),
    );
    if (!s.history.length)
      body.append(
        h(
          'div',
          { class: 'empty' },
          h('p', {
            text: 'Sent requests appear here (method, address, status and timing; no bodies or credentials).',
          }),
        ),
      );
    for (const e of s.history) {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'hist',
          title: `${new Date(e.at).toLocaleString()}${e.error ? ` — ${e.error}` : ''}`,
        },
        h('span', { class: `m m-${e.method}`, text: e.method }),
        h('span', { class: 'url', text: e.url }),
        h('span', {
          class: e.error || (e.status || 0) >= 400 ? 'fail' : 'pass',
          text: e.error ? 'error' : String(e.status),
        }),
      );
      b.addEventListener('click', () => {
        if (e.ref) {
          const [collection, ...rest] = e.ref.split('/');
          post({ type: 'open', collection, path: rest.join('/') });
        } else
          openTab({
            ...emptyRequest('new', e.name),
            method: e.method as ApiRequest['method'],
            url: e.url,
          });
      });
      body.append(b);
    }
  }
  box.append(tabsEl, body);
  return box;
}

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------
function welcome(): HTMLElement {
  const area = h('textarea', {
    class: 'field',
    id: 'curl-paste',
    placeholder: "curl 'https://api.example.com/users' -H 'accept: application/json'",
    'aria-label': 'Paste a curl command',
  });
  return h(
    'div',
    { class: 'welcome' },
    h('h1', { text: 'API Client' }),
    h('p', {
      class: 'muted',
      text: 'Send requests from VS Code, keep them in Git-friendly collections, and document them in your wiki with ```http blocks.',
    }),
    h(
      'div',
      { class: 'side-actions' },
      button(
        'New request',
        () => openTab(emptyRequest('new', 'New request')),
        'btn primary',
        'plus',
      ),
      button('Import OpenAPI or collection…', () => post({ type: 'importFile' }), 'btn'),
    ),
    h('h2', { class: 'small', text: 'Import from curl' }),
    area,
    h(
      'div',
      { class: 'side-actions' },
      button(
        'Import curl',
        () => area.value.trim() && post({ type: 'importCurl', text: area.value }),
        'btn',
      ),
    ),
    !state?.trusted
      ? h('p', {
          class: 'notice',
          text: 'This workspace is not trusted: you can edit requests, but sending is disabled.',
        })
      : undefined,
  );
}

function render() {
  if (!state) return;
  const focusedId = document.activeElement?.id;
  const t = current();
  const main = h('main', { class: 'main' });
  const bar = h('div', { class: 'tabs' });
  const list = h('div', { class: 'tab-list', role: 'tablist', 'aria-label': 'Open requests' });
  for (const tab of tabs) {
    // The close button is for the mouse; keyboard users close the focused tab with Delete.
    const close = h('button', {
      type: 'button',
      class: 'close',
      tabindex: '-1',
      'aria-hidden': 'true',
      title: `Close ${tab.request.name}`,
      text: '×',
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    const select = () => {
      active = tab.id;
      persist();
      render();
    };
    const el = h(
      'button',
      {
        type: 'button',
        class: 'tab-main',
        role: 'tab',
        id: `tab-${tab.id}`,
        'aria-selected': String(tab.id === active),
        'aria-keyshortcuts': 'Delete',
        title: `${tab.request.name || 'Untitled'} (Delete closes the tab)`,
      },
      h('span', { class: `m m-${tab.request.method}`, text: tab.request.method }),
      h('span', { class: 'name', text: tab.request.name || 'Untitled' }),
      h('span', { class: 'dirty', hidden: !isDirty(tab), title: 'Unsaved changes' }),
    );
    el.addEventListener('click', select);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Delete') {
        e.preventDefault();
        closeTab(tab.id);
      }
    });
    list.append(
      h(
        'div',
        {
          class: 'tab',
          role: 'presentation',
          'data-id': tab.id,
          'data-selected': String(tab.id === active),
        },
        el,
        close,
      ),
    );
  }
  bar.append(list);
  const add = button('', () => openTab(emptyRequest('new', 'New request')), 'btn ghost', 'plus', {
    'aria-label': 'New request',
    title: 'New request',
  });
  bar.append(add);
  main.append(bar);
  if (t) main.append(requestView(t), responseView(t));
  else main.append(welcome());
  app.replaceChildren(h('div', { class: 'app' }, sidebar(), main));
  if (focusedId) document.getElementById(focusedId)?.focus();
}

window.addEventListener('message', (event) => {
  const m = event.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'state') {
    const first = !state;
    state = m as State;
    if (first && state.tabs?.tabs?.length) {
      tabs = state.tabs.tabs.map((x) => ({ ...x, sub: x.sub || 'params' }));
      active =
        state.tabs.active && tabs.some((x) => x.id === state!.tabs!.active)
          ? state.tabs.active
          : tabs[0]?.id;
    }
    if (envDraft && !state.environments.some((e) => e.id === envDraft!.id)) envDraft = undefined;
    else if (envDraft) {
      // Keep unsaved edits; pick up secret flags from the host.
      const fresh = state.environments.find((e) => e.id === envDraft!.id)!;
      for (const v of envDraft.variables) {
        const f = fresh.variables.find((x) => x.key === v.key);
        if (f?.secret) v.hasValue = f.hasValue;
      }
    }
    render();
  } else if (m.type === 'open') {
    openTab(m.request, m.collection, m.tab, m.warnings);
  } else if (m.type === 'response') {
    const t = tabs.find((x) => x.id === m.tab);
    if (!t) return;
    t.sending = false;
    t.response = m.response;
    t.error = m.error;
    t.tests = m.tests?.results;
    t.missing = m.missing;
    if (t.tests?.length && t.tests.some((x) => !x.pass)) t.respTab = 'tests';
    render();
  } else if (m.type === 'saved') {
    const t = tabs.find((x) => x.id === m.tab);
    if (!t) return;
    t.collection = m.collection;
    t.request.id = m.path;
    t.saved = JSON.stringify(t.request);
    persist();
    render();
    toast('Saved.');
  } else if (m.type === 'run') {
    runResults = m;
    render();
  } else if (m.type === 'error') {
    const t = tabs.find((x) => x.id === m.tab);
    if (t) t.sending = false;
    toast(String(m.message), true);
    render();
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    sendCurrent();
  } else if (mod && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    saveCurrent();
  } else if (e.key === 'Escape' && current()?.sending) post({ type: 'cancel', tab: active });
});
post({ type: 'ready' });

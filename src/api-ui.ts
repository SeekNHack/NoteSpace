import type { ApiOperation, ApiSpec } from './core/openapi';
import { schemaRows, typeName } from './core/api-schema';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { operation?: string; server?: string } | undefined;
  setState(state: { operation?: string; server?: string }): void;
};
const vscode = acquireVsCodeApi();
const state = vscode.getState() || {};
let spec: ApiSpec | undefined;
let credentials: Record<string, boolean> = {};
let current: ApiOperation | undefined;

const app = document.getElementById('app')!;
app.innerHTML = `<style>
html,body{margin:0;height:100%;background:var(--ws-bg);color:var(--ws-fg);font:13px var(--ws-font)}
.layout{display:grid;grid-template-columns:minmax(200px,280px) 1fr;height:100%}
nav{border-right:1px solid var(--ws-hairline);overflow:auto;padding:12px 8px}
nav h1{font-size:14px;margin:0 6px 2px}nav .file{margin:0 6px 10px;color:var(--ws-muted);font-size:12px}
nav h2{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ws-muted);margin:12px 6px 4px}
nav button{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:none;color:var(--ws-fg);padding:5px 6px;border-radius:4px;cursor:pointer;font:inherit}
nav button:hover{background:var(--ws-hover)}nav button[aria-current="true"]{background:var(--ws-selection)}
.m{display:inline-block;min-width:3.6em;font:600 10px var(--ws-mono);text-align:center;padding:1px 4px;border-radius:3px;background:var(--ws-surface-2);box-shadow:inset 3px 0 0 var(--mc,var(--ws-muted))}
.m-GET{--mc:var(--ws-blue)}.m-POST{--mc:var(--ws-green)}.m-PUT,.m-PATCH{--mc:var(--ws-orange)}.m-DELETE{--mc:var(--ws-red)}
main{overflow:auto;padding:16px 22px;max-width:980px}
main h2{font-size:16px;margin:0 0 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}main h2 code{font:500 14px var(--ws-mono)}
.muted{color:var(--ws-muted)}
fieldset{border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);margin:12px 0;padding:8px 12px}
legend{font-weight:600;padding:0 4px}
.row{display:grid;grid-template-columns:minmax(120px,200px) 1fr;gap:8px;align-items:center;margin:6px 0}
label small{display:block;color:var(--ws-muted);font-weight:400}
input,select,textarea{box-sizing:border-box;width:100%;background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));border:1px solid var(--vscode-input-border,var(--ws-border));border-radius:var(--ws-r1);padding:5px 7px;font:inherit}
textarea{font:12px var(--ws-mono);min-height:140px;resize:vertical}
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--ws-focus);outline-offset:1px}
.btn{height:28px;padding:0 12px;border-radius:4px;border:1px solid var(--ws-border);background:var(--ws-surface);color:var(--ws-fg);cursor:pointer;font:inherit}
.btn.primary{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff);border-color:transparent}.btn.primary:hover{background:var(--vscode-button-hoverBackground,var(--ws-accent-hover))}
.btn:disabled{opacity:.6;cursor:default}
.cred{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0}
.status{font:600 13px var(--ws-mono);padding:2px 8px;border-radius:4px;background:var(--ws-surface-2)}
.s2{box-shadow:inset 3px 0 0 var(--ws-green)}.s3{box-shadow:inset 3px 0 0 var(--ws-blue)}.s4,.s5{box-shadow:inset 3px 0 0 var(--ws-red)}
pre{background:var(--ws-code-bg);border:1px solid var(--ws-hairline);border-radius:4px;padding:10px;overflow:auto;max-height:480px;font:12px var(--ws-mono);white-space:pre-wrap;word-break:break-word}
.error{color:var(--ws-red)}
details summary{cursor:pointer;margin:6px 0}
.note{font-size:12px;color:var(--ws-muted);margin-top:4px}
.search{width:100%;margin:0 0 6px}
.banner{font-size:12px;padding:6px 8px;border-radius:4px;margin:0 0 10px;background:var(--ws-surface-2)}
.banner.error{color:var(--ws-red)}
table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}th,td{border-bottom:1px solid var(--ws-hairline);padding:4px 6px;text-align:left;vertical-align:top}th{color:var(--ws-muted);font-weight:600}
td code{font:11.5px var(--ws-mono)}.req{color:var(--ws-red);font-size:11px}
.models summary{font-weight:600}
nav .count{margin:0 6px 6px;font-size:11px;color:var(--ws-muted)}
@media (max-width:640px){.layout{grid-template-columns:1fr}nav{border-right:0;border-bottom:1px solid var(--ws-hairline);max-height:40vh}}
</style><div class="layout"><nav aria-label="Operations"><p class="muted">Loading API description…</p></nav><main id="main"></main></div>`;
const nav = app.querySelector('nav')!;
let filter = '';
let file = '';
const main = app.querySelector<HTMLElement>('#main')!;

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
};
const method = (m: string) => h('span', { class: `m m-${m}` }, m);

// The catalog filter matches method, path, summary, operationId and tag (every word).
const matches = (op: ApiOperation) => {
  const hay =
    `${op.method} ${op.path} ${op.summary || ''} ${op.id} ${op.tags.join(' ')}`.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};
function renderNav() {
  if (!spec) return;
  const search = h('input', {
    class: 'search',
    type: 'search',
    'aria-label': 'Filter endpoints',
    placeholder: 'Filter endpoints (method, path, tag…)',
  });
  search.value = filter;
  search.addEventListener('input', () => {
    filter = search.value;
    renderList();
  });
  const list = h('div', { id: 'catalog' });
  nav.replaceChildren(
    h('h1', {}, spec.title),
    h('p', { class: 'file' }, `${file}${spec.version ? ` · v${spec.version}` : ''}`),
    search,
    list,
  );
  renderList();
}
function renderList() {
  const list = nav.querySelector<HTMLElement>('#catalog');
  if (!spec || !list) return;
  list.replaceChildren();
  const shown = spec.operations.filter(matches);
  if (filter)
    list.append(
      h(
        'p',
        { class: 'count', role: 'status' },
        `${shown.length} of ${spec.operations.length} endpoints`,
      ),
    );
  const tags = new Map<string, ApiOperation[]>();
  for (const op of shown)
    tags.set(op.tags[0] || 'Endpoints', [...(tags.get(op.tags[0] || 'Endpoints') || []), op]);
  for (const [tag, ops] of tags) {
    list.append(h('h2', {}, tag));
    for (const op of ops) {
      const button = h(
        'button',
        { 'data-op': op.id, 'aria-current': String(op === current) },
        method(op.method),
        h('span', {}, op.summary || op.path),
      );
      button.title = `${op.method} ${op.path}`;
      button.addEventListener('click', () => select(op));
      list.append(button);
    }
  }
  if (!spec.operations.length)
    list.append(h('p', { class: 'muted' }, 'This description has no operations.'));
  const models = spec.schemas.filter(
    (m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()),
  );
  if (models.length) {
    list.append(h('h2', {}, 'Schemas'));
    for (const m of models) {
      const button = h(
        'button',
        { 'data-schema': m.name, 'aria-current': 'false' },
        h('span', { class: 'm' }, '{ }'),
        h('span', {}, m.name),
      );
      button.addEventListener('click', () => showSchema(m.name));
      list.append(button);
    }
  }
}

function modelTable(schema: Record<string, unknown> | undefined) {
  const rows = schema ? schemaRows(schema) : [];
  if (!rows.length)
    return h(
      'p',
      { class: 'muted' },
      schema && Object.keys(schema).length ? `Type: ${typeName(schema)}` : 'No schema.',
    );
  return h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Field'),
        h('th', { scope: 'col' }, 'Type'),
        h('th', { scope: 'col' }, 'Description'),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h(
          'tr',
          {},
          h(
            'td',
            {},
            h('code', {}, r.name),
            ...(r.required ? [' ', h('span', { class: 'req' }, 'required')] : []),
          ),
          h('td', {}, h('code', {}, r.type)),
          h('td', {}, r.description || ''),
        ),
      ),
    ),
  );
}

function showSchema(name: string) {
  const model = spec?.schemas.find((m) => m.name === name);
  if (!model) return;
  current = undefined;
  for (const b of Array.from(
    nav.querySelectorAll<HTMLButtonElement>('button[data-op],button[data-schema]'),
  ))
    b.setAttribute('aria-current', String(b.dataset.schema === name));
  vscode.setState({ ...vscode.getState(), operation: `schema:${name}` });
  const users = spec!.operations.filter(
    (op) =>
      op.requestBody?.schemaName?.replace(/\[\]$/, '') === name ||
      op.responses.some((r) => r.schemaName?.replace(/\[\]$/, '') === name),
  );
  main.replaceChildren(
    h('h2', {}, h('code', {}, model.name), h('span', { class: 'muted' }, typeName(model.schema))),
    ...(model.description ? [h('p', { class: 'muted' }, model.description)] : []),
    modelTable(model.schema),
    ...(users.length
      ? [
          h('h3', {}, 'Used by'),
          h(
            'ul',
            {},
            ...users.map((op) => {
              const b = h('button', { class: 'btn', type: 'button' }, `${op.method} ${op.path}`);
              b.addEventListener('click', () => select(op));
              return h('li', {}, b);
            }),
          ),
        ]
      : []),
  );
}

function credentialsFieldset(op: ApiOperation) {
  const box = h('fieldset', {}, h('legend', {}, 'Authorization'));
  const schemes = op.security
    .map((name) => spec!.schemes.find((s) => s.name === name))
    .filter((s) => !!s);
  if (!schemes.length) {
    box.append(h('p', { class: 'muted' }, 'This operation does not declare authentication.'));
    return box;
  }
  for (const scheme of schemes) {
    const supported =
      (scheme.type === 'http' && ['bearer', 'basic'].includes(scheme.scheme || '')) ||
      scheme.type === 'apiKey';
    const kind =
      scheme.type === 'apiKey'
        ? `API key in ${scheme.in} “${scheme.parameter}”`
        : scheme.type === 'http'
          ? `HTTP ${scheme.scheme}`
          : scheme.type;
    const row = h(
      'div',
      { class: 'cred' },
      h('strong', {}, scheme.name),
      h('span', { class: 'muted' }, kind),
    );
    if (!supported)
      row.append(
        h(
          'span',
          { class: 'muted' },
          '— not supported by the playground; requests are sent without it.',
        ),
      );
    else {
      row.append(
        h(
          'span',
          { 'data-cred': scheme.name },
          credentials[scheme.name] ? 'Stored in VS Code secret storage' : 'Not set',
        ),
      );
      const set = h(
        'button',
        { class: 'btn', type: 'button' },
        credentials[scheme.name] ? 'Replace…' : 'Set…',
      );
      set.addEventListener('click', () =>
        vscode.postMessage({ type: 'setCredential', scheme: scheme.name }),
      );
      row.append(set);
      if (credentials[scheme.name]) {
        const clear = h('button', { class: 'btn', type: 'button' }, 'Remove');
        clear.addEventListener('click', () =>
          vscode.postMessage({ type: 'clearCredential', scheme: scheme.name }),
        );
        row.append(clear);
      }
    }
    box.append(row);
  }
  box.append(
    h(
      'p',
      { class: 'note' },
      'Credentials stay in the VS Code secret store. They are never written to pages, exports or this view.',
    ),
  );
  return box;
}

const text = (v: unknown) =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);

function select(op: ApiOperation) {
  current = op;
  vscode.setState({ ...vscode.getState(), operation: op.id });
  for (const b of Array.from(
    nav.querySelectorAll<HTMLButtonElement>('button[data-op],button[data-schema]'),
  ))
    b.setAttribute('aria-current', String(b.dataset.op === op.id));
  const form = h('form', { 'aria-label': `${op.method} ${op.path}` });
  const servers = spec!.servers.length
    ? spec!.servers
    : [{ url: 'http://localhost', description: 'No server in the description' }];
  const serverInput = h('input', {
    name: 'server',
    list: 'servers',
    'aria-label': 'Server URL',
    value: state.server || servers[0].url,
  });
  const serverList = h(
    'datalist',
    { id: 'servers' },
    ...servers.map((s) => h('option', { value: s.url }, s.description || s.url)),
  );
  form.append(h('fieldset', {}, h('legend', {}, 'Server'), serverInput, serverList));
  const groups: Array<['path' | 'query' | 'header', string]> = [
    ['path', 'Path parameters'],
    ['query', 'Query parameters'],
    ['header', 'Headers'],
  ];
  for (const [where, title] of groups) {
    const params = op.parameters.filter((p) => p.in === where);
    if (!params.length) continue;
    const box = h('fieldset', {}, h('legend', {}, title));
    for (const p of params) {
      const id = `p-${where}-${p.name}`;
      const label = h('label', { for: id }, p.name, p.required ? ' *' : '');
      if (p.description) label.append(h('small', {}, p.description));
      const enumValues = Array.isArray(p.schema?.enum) ? (p.schema!.enum as unknown[]) : undefined;
      const field = enumValues
        ? h(
            'select',
            { id, 'data-in': where, 'data-name': p.name },
            ...(p.required ? [] : [h('option', { value: '' }, '—')]),
            ...enumValues.map((v) => h('option', { value: text(v) }, text(v))),
          )
        : h('input', {
            id,
            'data-in': where,
            'data-name': p.name,
            placeholder: text(p.example ?? p.schema?.type ?? ''),
            ...(p.required ? { required: '' } : {}),
          });
      box.append(h('div', { class: 'row' }, label, field));
    }
    form.append(box);
  }
  if (op.parameters.some((p) => p.in === 'cookie'))
    form.append(
      h('p', { class: 'note' }, 'Cookie parameters are documented but not sent by the playground.'),
    );
  let body: HTMLTextAreaElement | undefined;
  if (op.requestBody && !['GET', 'HEAD'].includes(op.method)) {
    body = h('textarea', { 'aria-label': 'Request body', spellcheck: 'false' });
    body.value =
      op.requestBody.example === undefined ? '' : JSON.stringify(op.requestBody.example, null, 2);
    form.append(
      h(
        'fieldset',
        {},
        h(
          'legend',
          {},
          `Body · ${op.requestBody.contentType}${op.requestBody.required ? ' *' : ''}`,
        ),
        body,
      ),
    );
  }
  form.append(credentialsFieldset(op));
  const send = h('button', { class: 'btn primary', type: 'submit' }, 'Send request');
  form.append(
    h('div', {}, send),
    h(
      'p',
      { class: 'note' },
      `Requests are sent by VS Code only when you press Send. The first request to each server asks for permission; servers on this machine or your network are confirmed separately${['GET', 'HEAD', 'OPTIONS'].includes(op.method) ? '' : `, and every ${op.method} is confirmed because it may change data`}.`,
    ),
  );
  // Response models from the description, before anything is sent.
  const models = h('details', { class: 'models' }, h('summary', {}, 'Request and response models'));
  if (op.requestBody)
    models.append(
      h(
        'h3',
        {},
        `Request body${op.requestBody.schemaName ? ` · ${op.requestBody.schemaName}` : ''}`,
      ),
      modelTable(op.requestBody.schema),
    );
  for (const r of op.responses)
    models.append(
      h(
        'h3',
        {},
        `${r.status}${r.description ? ` · ${r.description}` : ''}${r.schemaName ? ` · ${r.schemaName}` : ''}`,
      ),
      modelTable(r.schema),
    );
  if (op.requestBody || op.responses.length) form.append(models);
  const output = h('section', { 'aria-live': 'polite', 'aria-label': 'Response', id: 'response' });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const input = {
      server: serverInput.value.trim(),
      path: {} as Record<string, string>,
      query: {} as Record<string, string>,
      headers: {} as Record<string, string>,
      body: body?.value,
    };
    for (const el of Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-in]'),
    )) {
      const bucket =
        el.dataset.in === 'path'
          ? input.path
          : el.dataset.in === 'query'
            ? input.query
            : input.headers;
      bucket[el.dataset.name!] = el.value;
    }
    vscode.setState({ ...vscode.getState(), server: input.server });
    state.server = input.server;
    send.disabled = true;
    send.textContent = 'Sending…';
    output.replaceChildren(h('p', { class: 'muted' }, 'Waiting for the response…'));
    vscode.postMessage({ type: 'send', operationId: op.id, input });
  });
  main.replaceChildren(
    h('h2', {}, method(op.method), h('code', {}, op.path)),
    ...(op.summary ? [h('p', {}, op.summary)] : []),
    ...(op.description ? [h('p', { class: 'muted' }, op.description)] : []),
    form,
    output,
  );
}

function showResponse(m: {
  response?: {
    status: number;
    statusText: string;
    ms: number;
    headers: Array<[string, string]>;
    body: string;
    truncated: boolean;
  };
  error?: string;
  cancelled?: boolean;
}) {
  const output = main.querySelector('#response');
  const send = main.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (send) {
    send.disabled = false;
    send.textContent = 'Send request';
  }
  if (!output) return;
  if (m.error)
    return output.replaceChildren(
      h('h3', {}, 'Response'),
      h('p', { class: 'error', role: 'alert' }, m.error),
    );
  if (m.cancelled || !m.response)
    return output.replaceChildren(h('p', { class: 'muted' }, 'Request not sent.'));
  const r = m.response;
  const headers = h(
    'details',
    {},
    h('summary', {}, `Headers (${r.headers.length})`),
    h('pre', {}, r.headers.map(([k, v]) => `${k}: ${v}`).join('\n')),
  );
  output.replaceChildren(
    h('h3', {}, 'Response'),
    h(
      'p',
      {},
      h('span', { class: `status s${String(r.status)[0]}` }, `${r.status} ${r.statusText}`),
      h('span', { class: 'muted' }, ` · ${r.ms} ms`),
    ),
    headers,
    h('pre', { tabindex: '0', 'aria-label': 'Response body' }, r.body || '(empty body)'),
    ...(r.truncated
      ? [h('p', { class: 'note' }, 'Only the first 1 MiB of the body is shown.')]
      : []),
  );
}

window.addEventListener('message', (event) => {
  const m = event.data;
  if (m?.type === 'spec') {
    spec = m.spec as ApiSpec;
    credentials = m.credentials || {};
    file = m.file;
    const saved = vscode.getState()?.operation || state.operation || '';
    renderNav();
    if (saved.startsWith('schema:') && spec.schemas.some((s) => `schema:${s.name}` === saved))
      showSchema(saved.slice(7));
    else {
      current = spec.operations.find((o) => o.id === saved) || spec.operations[0];
      if (current) select(current);
      else
        main.replaceChildren(
          h('p', { class: 'muted' }, 'Nothing to try: the description has no operations.'),
        );
    }
    if (m.updated)
      nav.prepend(
        h('p', { class: 'banner', role: 'status' }, 'Updated from the changed description.'),
      );
  } else if (m?.type === 'specError') {
    nav.querySelector('.banner')?.remove();
    nav.prepend(
      h(
        'p',
        { class: 'banner error', role: 'alert' },
        `The description could not be read; showing the last valid version. ${m.error}`,
      ),
    );
  } else if (m?.type === 'credentials') {
    credentials = m.credentials || {};
    const existing = Array.from(main.querySelectorAll('fieldset')).find(
      (f) => f.querySelector('legend')?.textContent === 'Authorization',
    );
    if (current && existing) existing.replaceWith(credentialsFieldset(current));
  } else if (m?.type === 'response') showResponse(m);
});
vscode.postMessage({ type: 'ready' });

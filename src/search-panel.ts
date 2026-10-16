import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WikiWorkspace } from './workspace';
import { tokensCss } from './core/design';
import { escapeHtml } from './core/render';
import { hasFilters, pageFeatures, parseQuery, searchTypes } from './core/query';
import { posix } from './core/paths';

const RECENT_KEY = 'wikiStudio.recentSearches';
const MAX_RECENT = 15;

let panel: vscode.WebviewPanel | undefined;

/**
 * Advanced search: the query language of core/query.ts with filter pickers, sorting, recent
 * searches and highlighted previews. Everything runs on the in-memory index; nothing leaves
 * VS Code. Recent searches are kept in this workspace's state and can be cleared.
 */
export function openSearchPanel(
  context: vscode.ExtensionContext,
  workspace: WikiWorkspace,
  initial = '',
): void {
  if (panel) {
    panel.reveal();
    if (initial) void panel.webview.postMessage({ type: 'setQuery', query: initial });
    return;
  }
  const current = (panel = vscode.window.createWebviewPanel(
    'wikiStudio.search',
    'Search Wiki',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  ));
  const recent = () => context.workspaceState.get<string[]>(RECENT_KEY, []);
  const options = () => {
    const pages = workspace.index.all().filter((p) => !workspace.isArchived(p));
    const tags = new Map<string, number>();
    const folders = new Set<string>();
    const props = new Set<string>();
    const code = new Set<string>();
    for (const page of pages) {
      for (const tag of page.tags)
        tags.set(tag.toLocaleLowerCase(), (tags.get(tag.toLocaleLowerCase()) || 0) + 1);
      const dir = posix.dirname(page.path);
      if (dir !== '.') folders.add(`${dir}/`);
      for (const key of Object.keys(page.properties || {})) props.add(key);
      for (const lang of pageFeatures(page).code) code.add(lang);
    }
    return {
      roots: workspace.roots.map((r) => ({ id: r.id, name: r.name })),
      tags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t),
      folders: [...folders].sort(),
      props: [...props].sort(),
      code: [...code].sort(),
      types: [...searchTypes],
      recent: recent(),
    };
  };
  const run = (query: string, root: string) => {
    const start = performance.now();
    const q = parseQuery(query);
    const empty = !q.terms.length && !hasFilters(q);
    const results = empty
      ? []
      : // Archived versions are searched only when asked for with version:.
        workspace.index.search(
          q,
          root || undefined,
          (p) => q.versions.length > 0 || !workspace.isArchived(p),
        );
    const ms = Math.round((performance.now() - start) * 10) / 10;
    return {
      type: 'results',
      query,
      ms,
      total: results.length,
      unknown: q.unknown,
      results: results.slice(0, 200).map((r) => ({
        uri: r.page.uri,
        title: r.page.title,
        path: r.page.path,
        wiki: workspace.rootFor(r.page).name,
        heading: r.heading && r.heading.level > 1 ? r.heading.text : '',
        offset: r.heading && r.heading.level > 1 ? r.heading.offset : undefined,
        excerpt: r.excerpt,
        matches: r.matches,
        tags: r.page.tags.slice(0, 6),
        draft: !!r.page.draft,
      })),
    };
  };
  const nonce = randomBytes(16).toString('base64');
  current.webview.html = html(nonce, initial);
  const subscriptions = [
    current.webview.onDidReceiveMessage(async (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') {
        await current.webview.postMessage({ type: 'options', ...options() });
      } else if (m.type === 'search' && typeof m.query === 'string') {
        await current.webview.postMessage(run(m.query.slice(0, 2000), String(m.root || '')));
      } else if (m.type === 'open' && typeof m.uri === 'string') {
        const query = typeof m.query === 'string' ? m.query.trim() : '';
        if (query) {
          const list = [query, ...recent().filter((q) => q !== query)].slice(0, MAX_RECENT);
          await context.workspaceState.update(RECENT_KEY, list);
          await current.webview.postMessage({ type: 'recent', recent: list });
        }
        if (!workspace.index.byUri(m.uri)) return;
        await vscode.commands.executeCommand(
          'wikiStudio.openPage',
          m.uri,
          typeof m.offset === 'number' ? m.offset : undefined,
        );
      } else if (m.type === 'clearRecent') {
        await context.workspaceState.update(RECENT_KEY, []);
        await current.webview.postMessage({ type: 'recent', recent: [] });
      }
    }),
    // Results follow edits: the query is run again when the index changes.
    workspace.onDidChange(
      () => void current.webview.postMessage({ type: 'refresh', ...options() }),
    ),
  ];
  current.onDidDispose(() => {
    subscriptions.forEach((s) => s.dispose());
    panel = undefined;
  });
}

function html(nonce: string, initial: string): string {
  const css = `${tokensCss}
html,body{background:var(--ws-bg)}
body{margin:0;color:var(--ws-fg);font-family:var(--ws-font);font-size:var(--ws-ui-size);line-height:1.45}
main{max-width:980px;margin:0 auto;padding:20px 24px 40px}
h1{font-size:18px;margin:0 0 12px;font-weight:600}
.bar{display:flex;gap:8px;align-items:center}
#q{flex:1;min-width:0;font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--ws-border);border-radius:var(--ws-r2);background:var(--ws-surface);color:var(--ws-fg)}
#q:focus,select:focus,button:focus-visible,.hit:focus-visible{outline:2px solid var(--ws-accent);outline-offset:1px}
select,button{font:inherit;font-size:12.5px;padding:5px 8px;border:1px solid var(--ws-border);border-radius:var(--ws-r1);background:var(--ws-surface);color:var(--ws-fg)}
button{cursor:pointer}button.link{border:0;background:none;color:var(--ws-accent);padding:2px 4px}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
.filters label{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--ws-muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 8px;border-radius:999px;background:var(--ws-surface-2);font-size:12px}
.chip button{border:0;background:none;padding:0 4px;color:var(--ws-muted)}
.status{color:var(--ws-muted);font-size:12px;margin:6px 0 10px;min-height:1.4em}
.warn{color:var(--ws-orange)}
.hit{display:block;width:100%;text-align:left;padding:9px 12px;margin:0 0 4px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface);color:inherit;cursor:pointer}
.hit:hover,.hit[aria-selected=true]{border-color:var(--ws-accent)}
.hit .t{font-weight:600;font-size:13.5px}.hit .p{color:var(--ws-muted);font-size:12px;margin-left:6px}
.hit .h{color:var(--ws-accent);font-size:12px;margin-left:6px}
.hit .x{display:block;color:var(--ws-fg-2,var(--ws-fg));opacity:.85;margin-top:3px;font-size:12.5px}
.hit mark{background:color-mix(in srgb,var(--ws-accent) 30%,transparent);color:inherit;border-radius:2px;padding:0 1px}
.tag{font-size:11px;color:var(--ws-muted);margin-left:6px}
.side{display:grid;grid-template-columns:1fr 240px;gap:20px}
aside h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--ws-muted);margin:4px 0 6px}
aside ul{list-style:none;margin:0 0 14px;padding:0}
aside li button{border:0;background:none;padding:3px 0;text-align:left;color:var(--ws-accent);width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
aside code{font-size:11.5px}
aside dl{margin:0;font-size:12px}aside dt{font-family:var(--ws-mono);margin-top:6px}aside dd{margin:0;color:var(--ws-muted)}
@media (max-width:760px){.side{grid-template-columns:1fr}}
`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><title>Search Wiki</title><style>${css}</style></head><body><main>
<h1>Search wiki</h1>
<div class="bar" role="search"><input id="q" type="search" aria-label="Search query" placeholder="Words, &quot;phrases&quot;, -exclude, tag:, path:, heading:, prop:, link:, code:, type:" value="${escapeHtml(initial)}" autocomplete="off" spellcheck="false"><select id="root" aria-label="Wiki"><option value="">All wikis</option></select><select id="sort" aria-label="Sort"><option value="relevance">Relevance</option><option value="title">Title</option><option value="path">Path</option></select></div>
<div class="filters" aria-label="Add a filter">
<label>Tag <select data-filter="tag" aria-label="Add tag filter"><option value="">—</option></select></label>
<label>Folder <select data-filter="path" aria-label="Add folder filter"><option value="">—</option></select></label>
<label>Type <select data-filter="type" aria-label="Add type filter"><option value="">—</option></select></label>
<label>Code <select data-filter="code" aria-label="Add code language filter"><option value="">—</option></select></label>
<label>Property <select data-filter="prop" aria-label="Add property filter"><option value="">—</option></select></label>
</div>
<div class="chips" id="chips" aria-label="Active filters"></div>
<div class="side"><section><div class="status" id="status" role="status" aria-live="polite"></div><div id="results" role="listbox" aria-label="Results"></div></section>
<aside><h2>Recent searches</h2><ul id="recent"></ul><button class="link" id="clear" type="button">Clear recent searches</button>
<h2 style="margin-top:16px">Syntax</h2><dl>
<dt>"exact phrase"</dt><dd>words in this order</dd><dt>-word</dt><dd>without the word</dd>
<dt>tag:api  #api</dt><dd>tagged pages</dd><dt>path:guides/</dt><dd>path contains</dd>
<dt>heading:install</dt><dd>has a heading; opens there</dd><dt>prop:owner=alice</dt><dd>front matter (prop:x, prop:x!=y)</dd>
<dt>link:setup</dt><dd>links to a page or URL</dd><dt>code:python</dt><dd>has a code block</dd>
<dt>version:1.0</dt><dd>an archived version (version:latest is the live docs)</dd><dt>type:draft</dt><dd>${searchTypes.join(', ')}</dd><dt>sort:title</dt><dd>or path, relevance</dd></dl></aside></div>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const q = $('q'), list = $('results'), status = $('status');
let items = [], selected = -1, timer, last = '';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mark = (text, ranges) => { let out = '', at = 0; for (const [a, b] of ranges || []) { out += esc(text.slice(at, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; at = b; } return out + esc(text.slice(at)); };
// Filters live in the query text, so what you see is what is searched.
const tokens = () => q.value.match(/-?(?:[a-z]+:)?(?:"[^"]*"?|\\S+)/gi) || [];
const quote = (v) => (/\\s/.test(v) ? '"' + v + '"' : v);
function addToken(t) { const list = tokens().filter((x) => !/^sort:/i.test(x) || !/^sort:/i.test(t)); if (!list.includes(t)) list.push(t); q.value = list.join(' '); search(); }
function removeToken(i) { const list = tokens(); list.splice(i, 1); q.value = list.join(' '); search(); }
function chips() {
  const list = tokens();
  $('chips').innerHTML = list.map((t, i) => /^-?[a-z]+:|^#/i.test(t) ? '<span class="chip">' + esc(t) + '<button type="button" data-remove="' + i + '" aria-label="Remove ' + esc(t) + '">×</button></span>' : '').join('');
  const sort = list.find((t) => /^sort:/i.test(t));
  $('sort').value = sort ? sort.slice(5).toLowerCase() : 'relevance';
}
function search() {
  chips();
  clearTimeout(timer);
  timer = setTimeout(() => vscode.postMessage({ type: 'search', query: q.value, root: $('root').value }), 120);
}
function render(m) {
  items = m.results; selected = items.length ? 0 : -1;
  const warn = m.unknown.length ? ' <span class="warn">Unknown filter' + (m.unknown.length > 1 ? 's' : '') + ': ' + esc(m.unknown.join(', ')) + '</span>' : '';
  status.innerHTML = q.value.trim() ? (m.total ? m.total + ' page' + (m.total === 1 ? '' : 's') + (m.total > items.length ? ' (showing ' + items.length + ')' : '') : 'No pages match.') + ' · ' + m.ms + ' ms' + warn : 'Type words or add filters.' + warn;
  list.innerHTML = items.map((r, i) => '<button class="hit" type="button" role="option" id="hit-' + i + '" data-i="' + i + '" aria-selected="' + (i === selected) + '"><span class="t">' + esc(r.title) + '</span>' + (r.heading ? '<span class="h">› ' + esc(r.heading) + '</span>' : '') + '<span class="p">' + esc(r.wiki) + ' / ' + esc(r.path) + '</span>' + (r.draft ? '<span class="tag">draft</span>' : '') + r.tags.map((t) => '<span class="tag">#' + esc(t) + '</span>').join('') + (r.excerpt ? '<span class="x">' + mark(r.excerpt, r.matches) + '</span>' : '') + '</button>').join('');
}
function select(i) {
  if (!items.length) return;
  selected = Math.max(0, Math.min(items.length - 1, i));
  list.querySelectorAll('.hit').forEach((el, j) => el.setAttribute('aria-selected', String(j === selected)));
  const el = $('hit-' + selected); el && el.scrollIntoView({ block: 'nearest' });
}
function open(i) { const r = items[i]; if (r) vscode.postMessage({ type: 'open', uri: r.uri, offset: r.offset, query: q.value }); }
function recent(listOf) { $('recent').innerHTML = listOf.length ? listOf.map((r) => '<li><button type="button" data-recent="' + esc(r) + '" title="' + esc(r) + '">' + esc(r) + '</button></li>').join('') : '<li class="status">None yet.</li>'; $('clear').hidden = !listOf.length; }
function fill(m) {
  const set = (sel, values, label = (v) => v) => { const el = document.querySelector(sel); const keep = el.value; el.innerHTML = '<option value="">—</option>' + values.map((v) => '<option value="' + esc(v) + '">' + esc(label(v)) + '</option>').join(''); el.value = keep; };
  set('[data-filter=tag]', m.tags); set('[data-filter=path]', m.folders); set('[data-filter=type]', m.types); set('[data-filter=code]', m.code); set('[data-filter=prop]', m.props);
  const root = $('root'), keep = root.value; root.innerHTML = '<option value="">All wikis</option>' + m.roots.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join(''); root.value = keep; root.hidden = m.roots.length < 2;
  if (m.recent) recent(m.recent);
}
q.addEventListener('input', search);
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); select(selected + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(selected - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); open(selected); }
  else if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; search(); }
});
list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) open(Number(b.dataset.i)); });
list.addEventListener('keydown', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const i = Number(b.dataset.i); if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select(i + (e.key === 'ArrowDown' ? 1 : -1)); $('hit-' + selected).focus(); } });
$('chips').addEventListener('click', (e) => { const b = e.target.closest('[data-remove]'); if (b) removeToken(Number(b.dataset.remove)); });
$('recent').addEventListener('click', (e) => { const b = e.target.closest('[data-recent]'); if (b) { q.value = b.dataset.recent; search(); q.focus(); } });
$('clear').addEventListener('click', () => vscode.postMessage({ type: 'clearRecent' }));
$('root').addEventListener('change', search);
$('sort').addEventListener('change', () => { const v = $('sort').value; q.value = tokens().filter((t) => !/^sort:/i.test(t)).concat(v === 'relevance' ? [] : ['sort:' + v]).join(' '); search(); });
document.querySelectorAll('[data-filter]').forEach((sel) => sel.addEventListener('change', () => {
  const v = sel.value; if (!v) return; sel.value = '';
  const name = sel.dataset.filter;
  addToken(name === 'prop' ? 'prop:' + quote(v) : name + ':' + quote(v));
}));
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'results' && m.query === q.value) render(m);
  else if (m.type === 'options') { fill(m); search(); }
  else if (m.type === 'refresh') { fill(m); if (q.value.trim()) search(); }
  else if (m.type === 'recent') recent(m.recent);
  else if (m.type === 'setQuery') { q.value = m.query; search(); q.focus(); }
});
vscode.postMessage({ type: 'ready' });
q.focus();
</script></body></html>`;
}

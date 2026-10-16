import type {
  ChartKind,
  Dashboard,
  DashboardMetric,
  FilterState,
  Widget,
  WidgetType,
} from './core/dashboard';
import type { SourceState, WidgetResult } from './dashboards';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { filters?: FilterState; pages?: Record<string, number>; edit?: boolean } | undefined;
  setState(state: { filters?: FilterState; pages?: Record<string, number>; edit?: boolean }): void;
};
const vscode = acquireVsCodeApi();
const saved = vscode.getState() || {};
let dashboard: Dashboard | undefined;
let results = new Map<string, WidgetResult>();
let sources: SourceState[] = [];
let filters: FilterState = saved.filters || {};
let pages: Record<string, number> = saved.pages || {};
let editing = !!saved.edit;
let selected: string | undefined;
let updatedAt: number | undefined;

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
const button = (label: string, run: () => void, attrs: Record<string, string> = {}) => {
  const b = h('button', { type: 'button', class: 'btn', ...attrs }, label);
  b.addEventListener('click', run);
  return b;
};

const app = document.getElementById('app')!;
app.innerHTML = `<style>
html,body{margin:0;background:var(--ws-bg);color:var(--ws-fg);font:13px var(--ws-font)}
header.bar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 16px;background:var(--ws-bg);border-bottom:1px solid var(--ws-hairline)}
header.bar h1{font-size:15px;margin:0 8px 0 0}header.bar input.title{font:600 15px var(--ws-font);background:transparent;color:var(--ws-fg);border:1px solid var(--ws-border);border-radius:4px;padding:2px 6px}
.status{color:var(--ws-muted);font-size:12px;margin-right:auto}.status.flash{color:var(--ws-green)}.status.error{color:var(--ws-red)}
.btn{height:26px;padding:0 10px;border-radius:4px;border:1px solid transparent;background:var(--vscode-button-secondaryBackground,var(--ws-surface-2));color:var(--vscode-button-secondaryForeground,var(--ws-fg));cursor:pointer;font:inherit}
.btn.primary,.btn[aria-pressed="true"]{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff)}
.btn.ghost{background:none;color:var(--ws-fg)}.btn.ghost:hover{background:var(--ws-hover)}
.btn:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,article.widget:focus-visible{outline:2px solid var(--ws-focus);outline-offset:1px}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:6px 16px 0}.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 10px;border-radius:999px;background:var(--ws-surface-2);font-size:12px}.chip button{border:0;background:none;color:inherit;cursor:pointer;font:inherit}
.notice{margin:8px 16px 0;padding:8px 12px;border-left:3px solid var(--ws-orange);background:var(--ws-surface)}.notice.error{border-color:var(--ws-red)}
main{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:84px;gap:12px;padding:12px 16px 40px;position:relative}
.editing .grid{background-image:linear-gradient(to right,color-mix(in srgb,var(--ws-fg) 6%,transparent) 1px,transparent 1px);background-size:calc((100% - 32px) / 12) 100%;background-position:16px 0}
article.widget{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
article.widget.selected{outline:2px solid var(--ws-focus)}
article.widget>header{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--ws-hairline);font-weight:600;font-size:12px}
.editing article.widget>header{cursor:move}
article.widget>header .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
article.widget>header .tools{display:flex;gap:2px}article.widget>header .tools .btn{height:22px;padding:0 6px;font-size:11px}
.body{flex:1;min-height:0;overflow:auto;padding:8px 10px}
.metric{display:flex;flex-direction:column;justify-content:center;height:100%}.metric .value{font-size:30px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}.metric .label{color:var(--ws-muted)}
.metric progress{width:100%;margin-top:8px;accent-color:var(--ws-accent)}
.chart{margin:0;padding:0;border:0;background:none}.chart figcaption{display:none}.chart-svg{width:100%;height:auto;max-height:100%}
.chart [data-index]{cursor:pointer}.chart [data-index].active{stroke:var(--ws-fg);stroke-width:2}
.chart-data{display:none}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid var(--ws-hairline);white-space:nowrap}th{position:sticky;top:0;background:var(--ws-surface)}
.pager{display:flex;align-items:center;gap:6px;margin-top:6px;color:var(--ws-muted)}
.filter select,.filter input{width:100%;box-sizing:border-box;margin:2px 0;height:26px;background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));border:1px solid var(--vscode-input-border,var(--ws-border));border-radius:4px;font:inherit}
.filter select[multiple]{height:auto;min-height:60px}
.error{color:var(--ws-red)}.muted{color:var(--ws-muted)}
.resize{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--ws-muted) 50%)}
aside.panel{width:300px;border-left:1px solid var(--ws-hairline);padding:12px;overflow:auto;max-height:calc(100vh - 50px);position:sticky;top:50px}
aside.panel h2{font-size:13px;margin:0 0 8px}aside.panel label{display:block;font-weight:600;font-size:12px;margin:10px 0 3px}
aside.panel input,aside.panel select,aside.panel textarea,dialog input,dialog select{width:100%;box-sizing:border-box;background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));border:1px solid var(--vscode-input-border,var(--ws-border));border-radius:4px;padding:4px 6px;font:inherit}
aside.panel select[multiple]{min-height:80px}
.check{font-size:11.5px;margin-top:3px}.check.ok{color:var(--ws-green)}.check.bad{color:var(--ws-red)}
dialog{border:1px solid var(--ws-menu-border);border-radius:8px;background:var(--ws-bg);color:var(--ws-fg);max-width:min(1000px,94vw);width:900px;max-height:86vh;padding:0}
dialog::backdrop{background:rgba(0,0,0,.45)}dialog header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--ws-hairline)}dialog .content{padding:12px 14px;overflow:auto;max-height:70vh}
dialog h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ws-muted);margin:14px 0 6px}
.rowform{display:grid;grid-template-columns:110px 1fr 2fr 90px auto;gap:6px;align-items:start;margin:4px 0}
.empty{padding:40px;text-align:center;color:var(--ws-muted)}
@media (max-width:760px){.grid{grid-template-columns:1fr}article.widget{grid-column:1/-1!important}main{grid-template-columns:1fr}aside.panel{width:auto;position:static;border-left:0;border-top:1px solid var(--ws-hairline)}}
</style><header class="bar" role="toolbar" aria-label="Dashboard"></header><div class="chips" role="group" aria-label="Active filters"></div><div id="notices"></div><main><section class="grid" aria-label="Widgets"></section></main><dialog id="dialog" aria-labelledby="dialog-title"><header><strong id="dialog-title"></strong><button type="button" class="btn ghost" id="dialog-close">Close</button></header><div class="content"></div></dialog>`;
const bar = app.querySelector<HTMLElement>('header.bar')!;
const chips = app.querySelector<HTMLElement>('.chips')!;
const notices = app.querySelector<HTMLElement>('#notices')!;
const main = app.querySelector<HTMLElement>('main')!;
const grid = app.querySelector<HTMLElement>('.grid')!;
const dialog = app.querySelector<HTMLDialogElement>('#dialog')!;
dialog.querySelector('#dialog-close')!.addEventListener('click', () => dialog.close());
let transientNotice = '';

const persist = () => vscode.setState({ filters, pages, edit: editing });
const sendFilters = () => {
  persist();
  vscode.postMessage({ type: 'filters', state: filters, pages });
};
const update = (change: (d: Dashboard) => void) => {
  if (!dashboard) return;
  const next = JSON.parse(JSON.stringify(dashboard)) as Dashboard;
  change(next);
  dashboard = next;
  render();
  vscode.postMessage({ type: 'update', dashboard: next });
};
const uid = (prefix: string) => {
  const used = new Set([
    ...(dashboard?.widgets || []).map((w) => w.id),
    ...(dashboard?.metrics || []).map((m) => m.id),
    ...(dashboard?.filters || []).map((f) => f.id),
  ]);
  for (let i = 1; ; i++) if (!used.has(`${prefix}-${i}`)) return `${prefix}-${i}`;
};
const columnsOf = (sourceId?: string) => sources.find((s) => s.id === sourceId)?.columns || [];

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------
const defaults: Record<WidgetType, { w: number; h: number }> = {
  metric: { w: 3, h: 2 },
  progress: { w: 3, h: 2 },
  chart: { w: 6, h: 4 },
  table: { w: 6, h: 4 },
  text: { w: 4, h: 2 },
  filter: { w: 3, h: 2 },
};
function layoutOf(w: Widget, index: number) {
  return (
    w.layout || { x: (index * 3) % 12, y: Math.floor((index * 3) / 12) * 2, ...defaults[w.type] }
  );
}
/** Pushes overlapping widgets down so the grid never stacks two widgets. */
function resolve(widgets: Widget[], moved: string) {
  const placed = widgets.map((w, i) => ({ w, l: { ...layoutOf(w, i) } }));
  const order = [...placed].sort((a, b) =>
    a.w.id === moved ? -1 : b.w.id === moved ? 1 : a.l.y - b.l.y || a.l.x - b.l.x,
  );
  const done: typeof placed = [];
  for (const item of order) {
    const overlaps = () =>
      done.some(
        (d) =>
          d.l.x < item.l.x + item.l.w &&
          item.l.x < d.l.x + d.l.w &&
          d.l.y < item.l.y + item.l.h &&
          item.l.y < d.l.y + d.l.h,
      );
    while (overlaps()) item.l.y++;
    done.push(item);
    item.w.layout = item.l;
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
function renderBar() {
  bar.replaceChildren();
  if (!dashboard) return;
  if (editing) {
    const title = h('input', {
      class: 'title',
      'aria-label': 'Dashboard title',
      value: dashboard.title,
    });
    title.addEventListener('change', () =>
      update((d) => (d.title = title.value.trim() || 'Dashboard')),
    );
    bar.append(title);
  } else bar.append(h('h1', {}, dashboard.title));
  const failing = sources.filter((s) => s.status === 'error');
  const status = h('span', {
    class: `status${failing.length ? ' error' : ''}`,
    role: 'status',
    'aria-live': 'polite',
  });
  status.textContent = failing.length
    ? `Could not refresh ${failing.map((s) => s.path).join(', ')}${failing.some((s) => s.stale) ? ' — showing the last loaded data' : ''}`
    : updatedAt
      ? `Updated ${new Date(updatedAt).toLocaleTimeString()} · ${sources.map((s) => `${s.path} (${(s.rows ?? 0).toLocaleString()} rows)`).join(', ')}`
      : 'Loading…';
  bar.append(status);
  bar.append(
    button('Refresh', () => vscode.postMessage({ type: 'refresh' }), {
      title: 'Read the data files again',
    }),
  );
  if (filters.values || filters.ranges || filters.search || filters.clicks?.length)
    bar.append(
      button('Reset filters', () => {
        filters = {};
        pages = {};
        sendFilters();
      }),
    );
  if (editing) {
    const add = h('select', { 'aria-label': 'Add widget', class: 'btn' });
    add.append(h('option', { value: '' }, '+ Add widget'));
    for (const [type, label] of [
      ['metric', 'Metric card'],
      ['chart', 'Chart'],
      ['table', 'Table'],
      ['progress', 'Progress'],
      ['filter', 'Filter'],
      ['text', 'Text'],
    ])
      add.append(h('option', { value: type }, label));
    add.addEventListener('change', () => {
      const type = add.value as WidgetType;
      add.value = '';
      if (type) addWidget(type);
    });
    bar.append(add, button('Data, metrics & filters…', openData));
  }
  bar.append(
    button(
      editing ? 'Done editing' : 'Edit layout',
      () => {
        editing = !editing;
        selected = undefined;
        persist();
        render();
      },
      { 'aria-pressed': String(editing) },
    ),
  );
}

function renderChips() {
  chips.replaceChildren();
  for (const [i, click] of (filters.clicks || []).entries()) {
    const remove = h(
      'button',
      {
        type: 'button',
        'aria-label': `Remove filter ${click.column} = ${click.values.join(', ')}`,
      },
      '×',
    );
    remove.addEventListener('click', () => {
      filters.clicks!.splice(i, 1);
      sendFilters();
    });
    chips.append(
      h('span', { class: 'chip' }, `${click.column} = ${click.values.join(', ')}`, remove),
    );
  }
}

function renderNotices(errors: string[] = []) {
  notices.replaceChildren();
  const add = (text: string, error = false) =>
    notices.append(
      h('p', { class: `notice${error ? ' error' : ''}`, role: error ? 'alert' : 'note' }, text),
    );
  if (transientNotice) add(transientNotice, true);
  for (const e of errors) add(`Dashboard file: ${e}`, true);
  for (const s of sources) {
    if (s.status === 'error') add(`${s.path}: ${s.error}`, true);
    for (const w of s.warnings) add(`${s.path}: ${w}`);
  }
}

function widgetBody(w: Widget, r: WidgetResult | undefined): HTMLElement {
  const body = h('div', { class: 'body' });
  if (!r) return (body.append(h('p', { class: 'muted' }, 'Loading…')), body);
  if (r.error) return (body.append(h('p', { class: 'error' }, r.error)), body);
  if (w.type === 'metric' || w.type === 'progress') {
    const box = h(
      'div',
      { class: 'metric' },
      h('span', { class: 'value' }, r.value || '—'),
      h('span', { class: 'label' }, r.label || ''),
    );
    if (r.progress)
      box.append(
        h('progress', {
          max: '100',
          value: r.progress.percent.toFixed(1),
          'aria-label': `${r.label}: ${r.progress.percent.toFixed(0)}% of target`,
        }),
      );
    body.append(box);
  } else if (w.type === 'text') body.innerHTML = r.html || '';
  else if (w.type === 'chart') {
    body.innerHTML = r.html || '';
    const active = (filters.clicks || []).find(
      (c) => c.source === r.source && c.column === r.dimension,
    );
    body.querySelectorAll<SVGElement>('[data-index]').forEach((el) => {
      const label = r.labels?.[Number(el.getAttribute('data-index'))];
      if (label === undefined || !r.dimension) return;
      if (active?.values.includes(label)) el.classList.add('active');
      const toggle = () => {
        // Click-to-filter: every widget on the same source follows this selection.
        const clicks = filters.clicks || [];
        const existing = clicks.find((c) => c.source === r.source && c.column === r.dimension);
        if (existing) {
          existing.values = existing.values.includes(label)
            ? existing.values.filter((v) => v !== label)
            : [...existing.values, label];
          if (!existing.values.length) clicks.splice(clicks.indexOf(existing), 1);
        } else
          clicks.push({
            source: r.source!,
            column: r.dimension!,
            values: [label],
            ...(r.bucket ? { bucket: r.bucket as never } : {}),
          });
        filters.clicks = clicks;
        sendFilters();
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  } else if (w.type === 'table' && r.table) {
    const t = r.table;
    body.append(
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, ...t.columns.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, ...t.rows.map((row) => h('tr', {}, ...row.map((c) => h('td', {}, c))))),
      ),
    );
    const pager = h('div', { class: 'pager' });
    const pagesCount = Math.max(1, Math.ceil(t.total / t.pageSize));
    const go = (p: number) => {
      pages[w.id] = p;
      sendFilters();
    };
    const prev = button('Previous', () => go(t.page - 1), { 'aria-label': 'Previous page' }),
      next = button('Next', () => go(t.page + 1), { 'aria-label': 'Next page' });
    prev.toggleAttribute('disabled', t.page <= 0);
    next.toggleAttribute('disabled', t.page >= pagesCount - 1);
    pager.append(
      prev,
      h('span', {}, `Page ${t.page + 1} of ${pagesCount} · ${t.total.toLocaleString()} rows`),
      next,
    );
    body.append(pager);
  } else if (w.type === 'filter') body.append(filterControl(w, r));
  return body;
}

function filterControl(w: Widget, r: WidgetResult): HTMLElement {
  const f = dashboard!.filters?.find((x) => x.id === w.filter);
  const box = h('div', { class: 'filter' });
  if (!f) return box;
  if (f.kind === 'dateRange') {
    const day = (t?: number) => (t === undefined ? '' : new Date(t).toISOString().slice(0, 10));
    const current = filters.ranges?.[f.id] || {};
    const from = h('input', {
      type: 'date',
      'aria-label': `${r.label} from`,
      value: day(current.from),
      min: day(r.range?.min),
      max: day(r.range?.max),
    });
    const to = h('input', {
      type: 'date',
      'aria-label': `${r.label} to`,
      value: day(current.to),
      min: day(r.range?.min),
      max: day(r.range?.max),
    });
    const apply = () => {
      filters.ranges = {
        ...filters.ranges,
        [f.id]: {
          from: from.value ? Date.parse(`${from.value}T00:00:00Z`) : undefined,
          to: to.value ? Date.parse(`${to.value}T23:59:59Z`) : undefined,
        },
      };
      sendFilters();
    };
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);
    box.append(from, to);
  } else if (f.kind === 'search') {
    const input = h('input', {
      type: 'search',
      'aria-label': r.label || f.column,
      placeholder: `Search ${f.column}`,
      value: filters.search?.[f.id] || '',
    });
    let timer = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        filters.search = { ...filters.search, [f.id]: input.value };
        sendFilters();
      }, 250);
    });
    box.append(input);
  } else {
    const select = h('select', {
      multiple: '',
      'aria-label': r.label || f.column,
      size: String(Math.min(6, Math.max(3, (r.options || []).length))),
    });
    const chosen = new Set(filters.values?.[f.id] || []);
    for (const o of r.options || []) {
      const option = h('option', { value: o }, o);
      option.selected = chosen.has(o);
      select.append(option);
    }
    select.addEventListener('change', () => {
      filters.values = {
        ...filters.values,
        [f.id]: Array.from(select.selectedOptions).map((o) => o.value),
      };
      sendFilters();
    });
    box.append(select);
  }
  return box;
}

function render() {
  if (!dashboard) return;
  main.classList.toggle('editing', editing);
  app.classList.toggle('editing', editing);
  renderBar();
  renderChips();
  grid.replaceChildren();
  if (!dashboard.widgets.length)
    grid.append(
      h(
        'div',
        { class: 'empty', style: 'grid-column:1/-1' },
        dashboard.sources.length
          ? 'Choose “Edit layout” and add a widget.'
          : 'Choose “Edit layout”, then “Data, metrics & filters…” to add a data file.',
      ),
    );
  // Overlaps (for example from a hand-edited file) are resolved for display only.
  const shown = JSON.parse(JSON.stringify(dashboard.widgets)) as Widget[];
  resolve(shown, '');
  dashboard.widgets.forEach((w, i) => {
    const l = shown[i].layout || layoutOf(w, i);
    const r = results.get(w.id);
    const article = h('article', {
      class: `widget${selected === w.id ? ' selected' : ''}`,
      style: `grid-column:${l.x + 1} / span ${l.w};grid-row:${l.y + 1} / span ${l.h}`,
      'aria-label': w.title || r?.label || w.id,
      'data-id': w.id,
      ...(editing ? { tabindex: '0' } : {}),
    });
    const head = h('header', {}, h('span', { class: 'name' }, w.title || r?.label || label(w)));
    const tools = h('span', { class: 'tools' });
    if (w.type === 'chart' && r?.html) {
      tools.append(
        button(
          'Rows',
          () =>
            vscode.postMessage({
              type: 'records',
              source: w.source,
              state: filters,
              title: w.title || 'Records',
            }),
          { title: 'Show the records behind this chart (current filters)' },
        ),
        button('SVG', () => saveImage(article, w, 'svg'), { title: 'Save as SVG' }),
        button('PNG', () => saveImage(article, w, 'png'), { title: 'Save as PNG' }),
      );
    }
    if (w.type === 'table')
      tools.append(
        button(
          'CSV',
          () => vscode.postMessage({ type: 'exportCsv', source: w.source, state: filters }),
          { title: 'Export the filtered rows as CSV' },
        ),
      );
    head.append(tools);
    article.append(head, widgetBody(w, r));
    if (editing) {
      article.addEventListener('click', () => select(w.id));
      article.addEventListener('keydown', (e) => keyboardLayout(e, w));
      head.addEventListener('pointerdown', (e) => drag(e, article, w, 'move'));
      const handle = h('span', { class: 'resize', 'aria-hidden': 'true' });
      handle.addEventListener('pointerdown', (e) => drag(e, article, w, 'resize'));
      article.append(handle);
    }
    grid.append(article);
  });
  main.querySelector('aside.panel')?.remove();
  if (editing && selected)
    main.append(configPanel(dashboard.widgets.find((w) => w.id === selected)!));
}
const label = (w: Widget) =>
  ({
    metric: 'Metric',
    progress: 'Progress',
    chart: 'Chart',
    table: 'Table',
    text: 'Text',
    filter: 'Filter',
  })[w.type];
function select(id: string) {
  if (selected === id) return;
  selected = id;
  render();
  grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
}

// Drag to move and resize on the 12-column grid.
function drag(event: PointerEvent, article: HTMLElement, w: Widget, mode: 'move' | 'resize') {
  if ((event.target as HTMLElement).closest('button,select,input')) return;
  event.preventDefault();
  const rect = grid.getBoundingClientRect();
  const col = (rect.width - 32 + 12) / 12,
    row = 84 + 12;
  const start = {
    x: event.clientX,
    y: event.clientY,
    l: { ...layoutOf(w, dashboard!.widgets.indexOf(w)) },
  };
  let next = start.l;
  const move = (e: PointerEvent) => {
    const dx = Math.round((e.clientX - start.x) / col),
      dy = Math.round((e.clientY - start.y) / row);
    next =
      mode === 'move'
        ? {
            ...start.l,
            x: Math.max(0, Math.min(12 - start.l.w, start.l.x + dx)),
            y: Math.max(0, start.l.y + dy),
          }
        : {
            ...start.l,
            w: Math.max(2, Math.min(12 - start.l.x, start.l.w + dx)),
            h: Math.max(1, start.l.h + dy),
          };
    article.style.gridColumn = `${next.x + 1} / span ${next.w}`;
    article.style.gridRow = `${next.y + 1} / span ${next.h}`;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (JSON.stringify(next) === JSON.stringify(start.l)) return select(w.id);
    update((d) => {
      d.widgets.find((x) => x.id === w.id)!.layout = next;
      resolve(d.widgets, w.id);
    });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function keyboardLayout(e: KeyboardEvent, w: Widget) {
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    return update((d) => {
      d.widgets = d.widgets.filter((x) => x.id !== w.id);
      selected = undefined;
    });
  }
  const step = arrows[e.key];
  if (!step) return;
  e.preventDefault();
  update((d) => {
    const target = d.widgets.find((x) => x.id === w.id)!;
    const l = { ...layoutOf(target, d.widgets.indexOf(target)) };
    if (e.shiftKey)
      ((l.w = Math.max(2, Math.min(12 - l.x, l.w + step[0]))), (l.h = Math.max(1, l.h + step[1])));
    else
      ((l.x = Math.max(0, Math.min(12 - l.w, l.x + step[0]))), (l.y = Math.max(0, l.y + step[1])));
    target.layout = l;
    resolve(d.widgets, w.id);
  });
  requestAnimationFrame(() =>
    grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(w.id)}"]`)?.focus(),
  );
}

function addWidget(type: WidgetType) {
  update((d) => {
    const id = uid(type);
    const source = d.sources[0]?.id;
    const metric = d.metrics[0]?.id;
    const bottom = Math.max(0, ...d.widgets.map((w, i) => layoutOf(w, i).y + layoutOf(w, i).h));
    const w: Widget = { id, type, layout: { x: 0, y: bottom, ...defaults[type] } };
    if (type === 'metric' || type === 'progress') w.metric = metric;
    if (type === 'progress') w.target = 100;
    if (type === 'chart')
      Object.assign(w, {
        chart: 'bar',
        source,
        dimension:
          columnsOf(source).find((c) => c.type === 'string')?.name || columnsOf(source)[0]?.name,
        metrics: metric ? [metric] : [],
      });
    if (type === 'table') w.source = source;
    if (type === 'text') w.text = 'Notes about this dashboard.';
    if (type === 'filter') {
      const column = columnsOf(source).find((c) => c.type === 'string')?.name;
      if (source && column) {
        const fid = uid('filter');
        d.filters = [...(d.filters || []), { id: fid, source, column, kind: 'select' }];
        w.filter = fid;
      }
    }
    d.widgets.push(w);
    selected = id;
  });
}

// ---------------------------------------------------------------------------------------------
// Widget configuration (edit mode)
// ---------------------------------------------------------------------------------------------
function field(labelText: string, control: HTMLElement) {
  const id = `f-${Math.random().toString(36).slice(2)}`;
  control.id = id;
  return [h('label', { for: id }, labelText), control];
}
function selectOf(
  options: Array<[string, string]>,
  value: string | undefined,
  onChange: (v: string) => void,
  multiple = false,
  values: string[] = [],
) {
  const s = h('select', multiple ? { multiple: '' } : {});
  for (const [v, text] of options) {
    const o = h('option', { value: v }, text);
    o.selected = multiple ? values.includes(v) : v === value;
    s.append(o);
  }
  s.addEventListener('change', () =>
    onChange(
      multiple ? JSON.stringify(Array.from(s.selectedOptions).map((o) => o.value)) : s.value,
    ),
  );
  return s;
}
function configPanel(w: Widget): HTMLElement {
  const panel = h(
    'aside',
    { class: 'panel', 'aria-label': 'Widget settings' },
    h('h2', {}, `${label(w)} settings`),
  );
  const set = (change: (x: Widget) => void) =>
    update((d) => change(d.widgets.find((x) => x.id === w.id)!));
  const title = h('input', { value: w.title || '' });
  title.addEventListener('change', () => set((x) => (x.title = title.value || undefined)));
  panel.append(...field('Title', title));
  const metrics = (dashboard!.metrics || []).map(
    (m) => [m.id, m.label || m.id] as [string, string],
  );
  const sourcesList = dashboard!.sources.map(
    (s) => [s.id, `${s.id} (${s.path})`] as [string, string],
  );
  if (w.type === 'metric' || w.type === 'progress')
    panel.append(
      ...field(
        'Metric',
        selectOf(metrics, w.metric, (v) => set((x) => (x.metric = v))),
      ),
    );
  if (w.type === 'progress') {
    const target = h('input', {
      value: String(w.target ?? ''),
      placeholder: 'Number or metric id',
    });
    target.addEventListener('change', () =>
      set(
        (x) =>
          (x.target = /^-?\d+(\.\d+)?$/.test(target.value) ? Number(target.value) : target.value),
      ),
    );
    panel.append(...field('Target', target));
  }
  if (w.type === 'chart' || w.type === 'table')
    panel.append(
      ...field(
        'Data',
        selectOf(sourcesList, w.source, (v) => set((x) => (x.source = v))),
      ),
    );
  if (w.type === 'chart') {
    const kinds: ChartKind[] = [
      'bar',
      'line',
      'area',
      'timeseries',
      'pie',
      'donut',
      'scatter',
      'histogram',
    ];
    panel.append(
      ...field(
        'Chart type',
        selectOf(
          kinds.map((k) => [k, k[0].toUpperCase() + k.slice(1)]),
          w.chart,
          (v) => set((x) => (x.chart = v as ChartKind)),
        ),
      ),
    );
    const cols = columnsOf(w.source).map(
      (c) => [c.name, `${c.name} · ${c.type}`] as [string, string],
    );
    panel.append(
      ...field(
        w.chart === 'histogram' || w.chart === 'scatter' ? 'X column' : 'Group by',
        selectOf(cols, w.dimension, (v) => set((x) => (x.dimension = v))),
      ),
    );
    if (w.chart === 'scatter')
      panel.append(
        ...field(
          'Y column',
          selectOf(cols, w.y, (v) => set((x) => (x.y = v))),
        ),
      );
    if (columnsOf(w.source).find((c) => c.name === w.dimension)?.type === 'date')
      panel.append(
        ...field(
          'Date interval',
          selectOf(
            ['day', 'week', 'month', 'quarter', 'year'].map((b) => [b, b]),
            w.bucket || 'month',
            (v) => set((x) => (x.bucket = v as Widget['bucket'])),
          ),
        ),
      );
    if (w.chart !== 'histogram' && w.chart !== 'scatter') {
      panel.append(
        ...field(
          'Metrics',
          selectOf(
            metrics.filter(
              ([id]) => dashboard!.metrics.find((m) => m.id === id)?.source === w.source,
            ),
            undefined,
            (v) => set((x) => (x.metrics = JSON.parse(v))),
            true,
            w.metrics || [],
          ),
        ),
      );
      panel.append(
        ...field(
          'Sort',
          selectOf(
            [
              ['label', 'By label'],
              ['value-desc', 'Largest first'],
              ['value-asc', 'Smallest first'],
            ],
            w.sort || 'label',
            (v) => set((x) => (x.sort = v as Widget['sort'])),
          ),
        ),
      );
    }
  }
  if (w.type === 'table') {
    const cols = columnsOf(w.source).map((c) => [c.name, c.name] as [string, string]);
    panel.append(
      ...field(
        'Columns',
        selectOf(
          cols,
          undefined,
          (v) => set((x) => (x.columns = JSON.parse(v))),
          true,
          w.columns || [],
        ),
      ),
    );
  }
  if (w.type === 'text') {
    const text = h('textarea', { rows: '6' });
    text.value = w.text || '';
    text.addEventListener('change', () => set((x) => (x.text = text.value)));
    panel.append(...field('Markdown', text));
  }
  if (w.type === 'filter') {
    const filtersList = (dashboard!.filters || []).map(
      (f) => [f.id, `${f.column} (${f.kind})`] as [string, string],
    );
    panel.append(
      ...field(
        'Filter',
        selectOf(filtersList, w.filter, (v) => set((x) => (x.filter = v))),
      ),
    );
  }
  panel.append(
    h(
      'p',
      { class: 'muted' },
      'Move: drag the header or use the arrow keys. Resize: drag the corner or Shift+arrows. Delete removes the widget; Undo restores it.',
    ),
  );
  panel.append(
    button('Remove widget', () =>
      update((d) => {
        d.widgets = d.widgets.filter((x) => x.id !== w.id);
        selected = undefined;
      }),
    ),
  );
  return panel;
}

// ---------------------------------------------------------------------------------------------
// Data, metrics, calculated columns and filters
// ---------------------------------------------------------------------------------------------
const checks = new Map<string, (r: { ok: boolean; error?: string; kind?: string }) => void>();
function formulaInput(
  value: string,
  source: string,
  kind: 'row' | 'aggregate',
  onValid: (v: string) => void,
) {
  const wrap = h('div', {});
  const input = h('input', {
    value,
    spellcheck: 'false',
    'aria-label': kind === 'row' ? 'Column formula' : 'Metric formula',
    list: 'formula-help',
  });
  const status = h('div', { class: 'check', role: 'status' });
  const id = Math.random().toString(36).slice(2);
  let timer = 0;
  const check = () => vscode.postMessage({ type: 'check', id, source, formula: input.value, kind });
  checks.set(id, (r) => {
    status.className = `check ${r.ok ? 'ok' : 'bad'}`;
    status.textContent = r.ok ? '✓ Valid formula' : r.error || 'Invalid formula';
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 200);
  });
  input.addEventListener('change', () => {
    vscode.postMessage({ type: 'check', id, source, formula: input.value, kind });
    checks.set(id, (r) => {
      status.className = `check ${r.ok ? 'ok' : 'bad'}`;
      status.textContent = r.ok ? '✓ Valid formula' : r.error || 'Invalid formula';
      if (r.ok) onValid(input.value);
    });
  });
  wrap.append(input, status);
  return wrap;
}
let shownSignature = '';
const dataSignature = () =>
  JSON.stringify([
    dashboard?.sources.map((s) => s.id),
    dashboard?.metrics.map((m) => [m.id, m.source]),
    (dashboard?.columns || []).map((c) => c.source),
    (dashboard?.filters || []).map((f) => [f.id, f.source, f.kind]),
    sources.map((s) => [s.id, s.status, s.rows, s.columns?.length]),
  ]);
function openData() {
  shownSignature = dataSignature();
  const content = dialog.querySelector<HTMLElement>('.content')!;
  dialog.querySelector('#dialog-title')!.textContent = 'Data, metrics & filters';
  content.replaceChildren();
  const d = dashboard!;
  content.append(h('h3', {}, 'Data files'));
  for (const s of d.sources) {
    const state = sources.find((x) => x.id === s.id);
    const formulaNote = state?.columns
      ?.filter((c) => c.formulas)
      .map(
        (c) =>
          `${c.name}: ${c.formulas!.cached} cached Excel result(s)${c.formulas!.uncached ? `, ${c.formulas!.uncached} without a saved result` : ''}`,
      );
    content.append(
      h(
        'p',
        {},
        h('strong', {}, s.id),
        ` — ${s.path}${s.sheet ? ` · sheet ${s.sheet}` : ''} · ${state?.status === 'ok' ? `${(state.rows ?? 0).toLocaleString()} rows, ${state.columns?.length} columns` : state?.error || 'not loaded'}`,
      ),
      h(
        'p',
        { class: 'muted' },
        `Columns: ${(state?.columns || []).map((c) => `${c.name} (${c.type})`).join(', ')}`,
      ),
      ...(formulaNote?.length
        ? [
            h(
              'p',
              { class: 'muted' },
              `Excel formulas are not recalculated. ${formulaNote.join('; ')}.`,
            ),
          ]
        : []),
    );
  }
  content.append(button('Add data file…', () => vscode.postMessage({ type: 'addSource' })));
  content.append(h('h3', {}, 'Metrics'));
  const sourceOptions = d.sources.map((s) => [s.id, s.id] as [string, string]);
  for (const m of d.metrics) content.append(metricRow(m, sourceOptions));
  content.append(
    button('Add metric', () =>
      update((x) =>
        x.metrics.push({
          id: uid('metric'),
          source: x.sources[0]?.id,
          formula: 'COUNT(rows)',
          label: 'New metric',
        }),
      ),
    ),
  );
  content.append(h('h3', {}, 'Calculated columns'));
  for (const [i, c] of (d.columns || []).entries()) {
    const name = h('input', { value: c.name, 'aria-label': 'Column name' });
    name.addEventListener('change', () => update((x) => (x.columns![i].name = name.value)));
    const remove = button('Remove', () => update((x) => x.columns!.splice(i, 1)));
    content.append(
      h(
        'div',
        { class: 'rowform' },
        name,
        named(
          selectOf(sourceOptions, c.source, (v) => update((x) => (x.columns![i].source = v))),
          `Data source of ${c.name}`,
        ),
        formulaInput(c.formula, c.source, 'row', (v) => update((x) => (x.columns![i].formula = v))),
        h('span', {}),
        remove,
      ),
    );
  }
  content.append(
    button('Add calculated column', () =>
      update(
        (x) =>
          (x.columns = [
            ...(x.columns || []),
            {
              source: x.sources[0]?.id,
              name: `Column ${(x.columns || []).length + 1}`,
              formula: 'YEAR(TODAY())',
            },
          ]),
      ),
    ),
  );
  content.append(h('h3', {}, 'Filters'));
  for (const [i, f] of (d.filters || []).entries()) {
    const cols = columnsOf(f.source).map((c) => [c.name, c.name] as [string, string]);
    content.append(
      h(
        'div',
        { class: 'rowform' },
        h('span', {}, f.id),
        named(
          selectOf(cols, f.column, (v) => update((x) => (x.filters![i].column = v))),
          `Column of filter ${f.id}`,
        ),
        named(
          selectOf(
            [
              ['select', 'Pick values'],
              ['dateRange', 'Date range'],
              ['search', 'Text search'],
            ],
            f.kind,
            (v) => update((x) => (x.filters![i].kind = v as never)),
          ),
          `Kind of filter ${f.id}`,
        ),
        h('span', {}),
        button('Remove', () => update((x) => x.filters!.splice(i, 1))),
      ),
    );
  }
  content.append(
    button('Add filter', () =>
      update(
        (x) =>
          (x.filters = [
            ...(x.filters || []),
            {
              id: uid('filter'),
              source: x.sources[0]?.id,
              column: columnsOf(x.sources[0]?.id)[0]?.name,
              kind: 'select',
            },
          ]),
      ),
    ),
  );
  content.append(
    h(
      'p',
      { class: 'muted' },
      'Formulas: COUNT(rows), COUNT_IF(cond), COUNT_DISTINCT(col), SUM, AVG, MIN, MAX, MEDIAN, SUM_IF(col, cond), AVG_IF(col, cond); in rows: IF, AND, OR, NOT, IN (...), ISNULL, COALESCE, YEAR, MONTH, QUARTER, YEAR_MONTH, DAYS_BETWEEN, DATE, TODAY, ROUND, LOWER, UPPER, CONTAINS, CONCAT. Use [Column Name] for names with spaces. Excel formulas are never recalculated.',
    ),
  );
  const help = h('datalist', { id: 'formula-help' });
  for (const f of [
    'COUNT(rows)',
    'COUNT_IF()',
    'COUNT_DISTINCT()',
    'SUM()',
    'AVG()',
    'SUM_IF(, )',
    'DAYS_BETWEEN(, )',
    'YEAR()',
  ])
    help.append(h('option', { value: f }));
  content.append(help);
  if (!dialog.open) dialog.showModal();
}
const named = <T extends HTMLElement>(el: T, label: string) => (
  el.setAttribute('aria-label', label),
  el
);
function metricRow(m: DashboardMetric, sourceOptions: Array<[string, string]>) {
  const index = dashboard!.metrics.indexOf(m);
  const labelInput = h('input', {
    value: m.label || '',
    placeholder: 'Label',
    'aria-label': 'Metric label',
  });
  labelInput.addEventListener('change', () =>
    update((x) => (x.metrics[index].label = labelInput.value || undefined)),
  );
  const format = named(
    selectOf(
      [
        ['number', 'Number'],
        ['percent', 'Percent'],
        ['currency', 'Currency'],
        ['days', 'Days'],
      ],
      m.format || 'number',
      (v) => update((x) => (x.metrics[index].format = v as DashboardMetric['format'])),
    ),
    `Format of ${m.id}`,
  );
  return h(
    'div',
    { class: 'rowform' },
    h('span', {}, m.id),
    named(
      selectOf(sourceOptions, m.source, (v) => update((x) => (x.metrics[index].source = v))),
      `Data source of ${m.id}`,
    ),
    h(
      'div',
      {},
      labelInput,
      formulaInput(m.formula, m.source, 'aggregate', (v) =>
        update((x) => (x.metrics[index].formula = v)),
      ),
    ),
    format,
    button('Remove', () => update((x) => x.metrics.splice(index, 1))),
  );
}

function saveImage(article: HTMLElement, w: Widget, format: 'svg' | 'png') {
  const svg = article.querySelector('svg.chart-svg');
  if (!svg) return;
  // Inline the computed colors so the file looks the same outside VS Code.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = svg.querySelectorAll('*'),
    target = clone.querySelectorAll('*');
  source.forEach((el, i) => {
    const cs = getComputedStyle(el);
    (target[i] as SVGElement).setAttribute(
      'style',
      `fill:${cs.fill};stroke:${cs.stroke};stroke-width:${cs.strokeWidth};font:${cs.font};opacity:${cs.opacity}`,
    );
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const text = new XMLSerializer().serializeToString(clone);
  if (format === 'svg')
    return vscode.postMessage({ type: 'saveImage', format, data: text, name: w.title || w.id });
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const box = (svg as SVGSVGElement).viewBox.baseVal;
    canvas.width = box.width * 2;
    canvas.height = box.height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    vscode.postMessage({
      type: 'saveImage',
      format,
      data: canvas.toDataURL('image/png'),
      name: w.title || w.id,
    });
  };
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
}

function showRecords(m: { title?: string; columns: string[]; rows: string[][]; total: number }) {
  dialog.querySelector('#dialog-title')!.textContent =
    `${m.title || 'Records'} · ${m.total.toLocaleString()} row(s)`;
  const content = dialog.querySelector<HTMLElement>('.content')!;
  content.replaceChildren(
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, ...m.columns.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, ...m.rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c))))),
    ),
    ...(m.total > m.rows.length
      ? [
          h(
            'p',
            { class: 'muted' },
            `Showing the first ${m.rows.length}; use a table widget's CSV export for all rows.`,
          ),
        ]
      : []),
  );
  if (!dialog.open) dialog.showModal();
}

window.addEventListener('message', (event) => {
  const m = event.data;
  switch (m?.type) {
    case 'model':
      dashboard = m.dashboard;
      results = new Map((m.results as WidgetResult[]).map((r) => [r.id, r]));
      sources = m.sources;
      updatedAt = Math.max(0, ...sources.map((s) => s.loadedAt || 0)) || undefined;
      render();
      renderNotices(m.errors);
      // Rebuild the data dialog only when its structure changed, never while someone types.
      if (
        dialog.open &&
        dialog.querySelector('#dialog-title')!.textContent === 'Data, metrics & filters' &&
        dataSignature() !== shownSignature
      )
        openData();
      return;
    case 'invalid':
      grid.replaceChildren(
        h(
          'p',
          { class: 'error', role: 'alert' },
          `This dashboard file cannot be read: ${m.message}. Fix it in a text editor (Reopen With… → Text Editor).`,
        ),
      );
      return;
    case 'refreshed': {
      const status = bar.querySelector('.status');
      status?.classList.add('flash');
      setTimeout(() => status?.classList.remove('flash'), 1500);
      return;
    }
    case 'checked':
      checks.get(m.id)?.(m.result);
      return;
    case 'records':
      showRecords(m);
      return;
    case 'notice':
      transientNotice = m.message;
      renderNotices();
      setTimeout(() => {
        transientNotice = '';
        renderNotices();
      }, 8000);
      return;
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    vscode.postMessage({ type: 'save' });
  }
});
// The first filters message also asks the host for the initial model.
sendFilters();

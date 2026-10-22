// Page properties and folder databases in the Wiki. A page's front matter is shown as typed
// properties under its title; a folder's pages can be viewed as a database (table, gallery or
// board) whose cells edit the front matter of each page. Nothing is stored besides the pages.
import { ago, button, dialog, field, h, iconButton, post, save, store, svg, ui } from './core';
import type { NavNode } from './core';

export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'url';
export interface Property {
  key: string;
  type: PropertyType;
  value: string | number | boolean | string[];
}
export interface DatabaseRow {
  id: string;
  uri: string;
  path: string;
  title: string;
  icon?: string;
  status?: string;
  cover?: string;
  excerpt: string;
  modified?: number;
  properties: Property[];
}
type View = 'table' | 'gallery' | 'board';
interface ViewState {
  view: View;
  sort?: string;
  desc?: boolean;
  group?: string;
  filter?: string;
}

const typeIcon: Record<PropertyType, Parameters<typeof svg>[0]> = {
  text: 'text',
  number: 'numbered',
  checkbox: 'check',
  date: 'calendar',
  list: 'bullet',
  url: 'link',
};
const typeLabel: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  date: 'Date',
  list: 'List',
  url: 'Link',
};

const display = (p: Property | undefined): string =>
  !p
    ? ''
    : Array.isArray(p.value)
      ? p.value.join(', ')
      : typeof p.value === 'boolean'
        ? p.value
          ? 'Yes'
          : 'No'
        : String(p.value);

/** The value of a property as a cell or a row in the properties panel; click to edit. */
export function propertyValue(
  prop: Property | undefined,
  type: PropertyType,
  save: (value: unknown) => void,
  label: string,
): HTMLElement {
  if (type === 'checkbox') {
    const box = h('input', {
      type: 'checkbox',
      class: 'prop-check',
      'aria-label': label,
      checked: prop?.value === true,
    });
    box.addEventListener('change', () => save(box.checked));
    return box;
  }
  const shown = display(prop);
  const cell = h(
    'button',
    {
      type: 'button',
      class: `prop-value${shown ? '' : ' empty'}`,
      'aria-label': `${label}: ${shown || 'empty'}. Edit`,
    },
    type === 'list' && Array.isArray(prop?.value)
      ? h(
          'span',
          { class: 'prop-chips' },
          ...prop!.value.map((v) => h('span', { class: 'prop-chip', text: v })),
        )
      : h('span', { text: shown || 'Empty' }),
  );
  cell.addEventListener('click', (event) => {
    event.stopPropagation();
    const input = h('input', {
      class: 'field prop-input',
      type:
        type === 'date' ? 'date' : type === 'number' ? 'number' : type === 'url' ? 'url' : 'text',
      value: shown
        ? Array.isArray(prop?.value)
          ? prop!.value.join(', ')
          : String(prop?.value ?? '')
        : '',
      'aria-label': label,
      placeholder: type === 'list' ? 'a, b, c' : '',
    });
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (
        commit &&
        input.value !==
          (shown && Array.isArray(prop?.value) ? prop!.value.join(', ') : String(prop?.value ?? ''))
      )
        save(input.value);
      input.replaceWith(cell);
      if (!commit) cell.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    cell.replaceWith(input);
    input.focus();
  });
  return cell;
}

/** Asks for a new property's name and type. */
function addProperty(onAdd: (key: string, type: PropertyType) => void, taken: string[]) {
  const name = h('input', {
    class: 'field',
    required: true,
    placeholder: 'owner',
    pattern: '[A-Za-z_][A-Za-z0-9_-]{0,39}',
  });
  const kind = h('select', { class: 'field' });
  for (const t of Object.keys(typeLabel) as PropertyType[])
    kind.append(h('option', { value: t, text: typeLabel[t] }));
  dialog(
    'Add property',
    [
      field('Name', name, 'Letters, digits, - and _; saved in the front matter.'),
      field('Type', kind),
    ],
    'Add',
    () => {
      const key = name.value.trim();
      if (!/^[A-Za-z_][\w-]{0,39}$/.test(key) || key === 'title' || taken.includes(key)) {
        name.setCustomValidity(
          taken.includes(key) ? 'This property exists.' : 'Use letters, digits, - and _.',
        );
        name.reportValidity();
        return false;
      }
      onAdd(key, kind.value as PropertyType);
    },
  );
}

/** The properties of the page shown in the Wiki, editable in place. */
export function propertiesPanel(uri: string, props: Property[]): HTMLElement {
  const list = h('dl', { class: 'wiki-props' });
  const write = (key: string, type: PropertyType, value: unknown, remove = false) =>
    post({ type: 'wikiProperty', uri, key, propertyType: type, value, remove });
  for (const p of props) {
    const remove = iconButton('trash', `Remove ${p.key}`, () => write(p.key, p.type, null, true));
    list.append(
      h(
        'div',
        { class: 'prop-row' },
        h('dt', {}, svg(typeIcon[p.type], 13), h('span', { text: p.key })),
        h(
          'dd',
          {},
          propertyValue(p, p.type, (v) => write(p.key, p.type, v), p.key),
          remove,
        ),
      ),
    );
  }
  const add = button(
    'Add property',
    () =>
      addProperty(
        (key, type) => {
          // A new checkbox is written unchecked; other types wait for a value.
          if (type === 'checkbox') write(key, type, false);
          else {
            pendingProperty = { uri, key, type };
            store.render();
          }
        },
        props.map((p) => p.key),
      ),
    'btn ghost small',
    'plus',
  );
  if (pendingProperty?.uri === uri && !props.some((p) => p.key === pendingProperty!.key)) {
    const pending = pendingProperty;
    const value = propertyValue(
      undefined,
      pending.type,
      (v) => {
        pendingProperty = undefined;
        write(pending.key, pending.type, v);
      },
      pending.key,
    );
    list.append(
      h(
        'div',
        { class: 'prop-row' },
        h('dt', {}, svg(typeIcon[pending.type], 13), h('span', { text: pending.key })),
        h('dd', {}, value),
      ),
    );
    requestAnimationFrame(() => (value as HTMLElement).click?.());
  }
  return h('section', { class: 'wiki-props-wrap', 'aria-label': 'Properties' }, list, add);
}
let pendingProperty: { uri: string; key: string; type: PropertyType } | undefined;

// ---------------------------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------------------------
let data: { prefix: string; rows: DatabaseRow[] } | undefined;
const viewOf = (prefix: string): ViewState => ui.dbViews?.[prefix] || { view: 'table' };
function setView(prefix: string, next: Partial<ViewState>) {
  ui.dbViews = { ...ui.dbViews, [prefix]: { ...viewOf(prefix), ...next } };
  save();
  store.render();
}

/** The host sent a folder's rows. */
export function receiveDatabase(prefix: string, rows: DatabaseRow[]) {
  data = { prefix, rows };
  if (ui.wikiDatabase === prefix) store.render();
}
export const requestDatabase = (prefix: string) => post({ type: 'wikiDatabase', prefix });

/** Columns: every property used in the folder, most used first, with the most common type. */
function columns(rows: DatabaseRow[]): Array<{ key: string; type: PropertyType }> {
  const seen = new Map<string, Map<PropertyType, number>>();
  for (const r of rows)
    for (const p of r.properties) {
      const types = seen.get(p.key) || new Map();
      types.set(p.type, (types.get(p.type) || 0) + 1);
      seen.set(p.key, types);
    }
  return [...seen]
    .map(([key, types]) => ({
      key,
      count: [...types.values()].reduce((a, b) => a + b, 0),
      type: [...types].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .filter((c) => !['icon', 'cover', 'image', 'description', 'order'].includes(c.key))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map(({ key, type }) => ({ key, type }));
}

export function databaseView(
  section: NavNode | undefined,
  prefix: string,
  open: (id: string) => void,
  iconEl: (icon: string | undefined, size?: number) => Element | undefined,
): HTMLElement {
  const state = viewOf(prefix);
  const rows = data?.prefix === prefix ? data.rows : undefined;
  if (!rows) requestDatabase(prefix);
  const cols = rows ? columns(rows) : [];
  const prop = (r: DatabaseRow, key: string) => r.properties.find((p) => p.key === key);
  const write = (r: DatabaseRow, key: string, type: PropertyType, value: unknown) =>
    post({ type: 'wikiProperty', uri: r.uri, key, propertyType: type, value, database: prefix });
  const filter = (state.filter || '').toLocaleLowerCase();
  let shown = (rows || []).filter(
    (r) =>
      !filter ||
      `${r.title} ${r.properties.map(display).join(' ')}`.toLocaleLowerCase().includes(filter),
  );
  const sortKey = state.sort || 'title';
  const sortValue = (r: DatabaseRow): string | number =>
    sortKey === 'title'
      ? r.title
      : sortKey === 'modified'
        ? r.modified || 0
        : (() => {
            const p = prop(r, sortKey);
            return typeof p?.value === 'number' ? p.value : display(p);
          })();
  shown = [...shown].sort((a, b) => {
    const x = sortValue(a),
      y = sortValue(b);
    const c =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true });
    // Empty values last.
    if (!String(x) !== !String(y)) return String(x) ? -1 : 1;
    return state.desc ? -c : c;
  });

  const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' });
  for (const [v, label, icon] of [
    ['table', 'Table', 'table'],
    ['gallery', 'Gallery', 'gallery'],
    ['board', 'Board', 'layout'],
  ] as const) {
    const b = button(label, () => setView(prefix, { view: v }), 'btn small', icon, {
      'aria-pressed': String(state.view === v),
    });
    segmented.append(b);
  }
  const search = h('input', {
    id: 'db-filter',
    type: 'search',
    class: 'field',
    placeholder: 'Filter',
    'aria-label': 'Filter pages',
    value: state.filter || '',
  });
  search.addEventListener('change', () => setView(prefix, { filter: search.value }));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setView(prefix, { filter: search.value });
  });
  const sort = h('select', { class: 'field', 'aria-label': 'Sort by' });
  for (const [value, label] of [
    ['title', 'Title'],
    ['modified', 'Last edited'],
    ...cols.map((c) => [c.key, c.key] as [string, string]),
  ])
    sort.append(h('option', { value, text: `Sort: ${label}`, selected: value === sortKey }));
  sort.addEventListener('change', () => setView(prefix, { sort: sort.value }));
  const direction = iconButton(
    state.desc ? 'arrowLeft' : 'arrowRight',
    state.desc ? 'Descending (click for ascending)' : 'Ascending (click for descending)',
    () => setView(prefix, { desc: !state.desc }),
  );
  direction.classList.add(state.desc ? 'desc' : 'asc');
  const groupable = cols.filter(
    (c) => c.type === 'text' || c.type === 'checkbox' || c.type === 'list',
  );
  const groupKey =
    state.group && groupable.some((c) => c.key === state.group)
      ? state.group
      : groupable.find((c) => c.key === 'status')?.key || groupable[0]?.key;
  const group = h('select', { class: 'field', 'aria-label': 'Group by' });
  for (const c of groupable)
    group.append(
      h('option', { value: c.key, text: `Group: ${c.key}`, selected: c.key === groupKey }),
    );
  group.addEventListener('change', () => setView(prefix, { group: group.value }));
  const add = button(
    'New page',
    () => {
      const input = h('input', { class: 'field', required: true, placeholder: 'Title' });
      dialog(
        `New page in ${section?.title || 'this folder'}`,
        [field('Title', input)],
        'Create',
        () => {
          if (!input.value.trim()) return false;
          post({ type: 'wikiDatabaseNew', prefix, title: input.value.trim(), fields: {} });
        },
      );
    },
    'btn primary small',
    'plus',
  );
  const toolbar = h(
    'div',
    { class: 'db-toolbar' },
    segmented,
    search,
    sort,
    direction,
    state.view === 'board' && groupable.length ? group : undefined,
    h('span', { class: 'spacer' }),
    add,
  );
  const titleCell = (r: DatabaseRow) => {
    const b = h(
      'button',
      { type: 'button', class: 'db-title', title: r.path },
      iconEl(r.icon, 14) || svg('file', 14),
      h('span', { text: r.title }),
    );
    b.addEventListener('click', () => open(r.id));
    return b;
  };
  let body: HTMLElement;
  if (!rows) body = h('p', { class: 'muted', text: 'Loading…' });
  else if (!rows.length)
    body = h(
      'div',
      { class: 'empty' },
      h('p', { text: 'This folder has no pages yet.' }),
      add.cloneNode(true) as HTMLElement,
    );
  else if (state.view === 'gallery')
    body = h(
      'ul',
      { class: 'db-gallery' },
      ...shown.map((r) => {
        const card = h(
          'li',
          { class: 'db-card' },
          r.cover
            ? h('img', { class: 'db-cover', src: r.cover, alt: '' })
            : h('div', { class: 'db-cover placeholder' }, iconEl(r.icon, 28) || svg('file', 28)),
          h(
            'div',
            { class: 'db-card-body' },
            titleCell(r),
            r.excerpt ? h('p', { class: 'muted small', text: r.excerpt }) : undefined,
            h(
              'div',
              { class: 'db-card-props' },
              ...cols.slice(0, 3).map((c) => {
                const p = prop(r, c.key);
                return p && display(p)
                  ? h('span', { class: 'prop-chip', title: c.key, text: `${c.key}: ${display(p)}` })
                  : undefined;
              }),
            ),
          ),
        );
        return card;
      }),
    );
  else if (state.view === 'board' && groupKey) {
    const type = cols.find((c) => c.key === groupKey)!.type;
    const valueOf = (r: DatabaseRow) => {
      const p = prop(r, groupKey);
      return Array.isArray(p?.value) ? p!.value[0] || '' : p ? display(p) : '';
    };
    const values = [...new Set(rows.map(valueOf))].sort((a, b) =>
      !a ? 1 : !b ? -1 : a.localeCompare(b),
    );
    body = h(
      'div',
      { class: 'db-board' },
      ...values.map((v) => {
        const column = h(
          'section',
          { class: 'db-column', 'aria-label': v || 'No value' },
          h(
            'h3',
            {},
            h('span', { text: v || 'No value' }),
            h('span', {
              class: 'muted',
              text: String(shown.filter((r) => valueOf(r) === v).length),
            }),
          ),
          ...shown
            .filter((r) => valueOf(r) === v)
            .map((r) => {
              const card = h(
                'article',
                { class: 'db-board-card', draggable: 'true' },
                titleCell(r),
                h(
                  'div',
                  { class: 'db-card-props' },
                  ...cols
                    .filter((c) => c.key !== groupKey)
                    .slice(0, 2)
                    .map((c) => {
                      const p = prop(r, c.key);
                      return p && display(p)
                        ? h('span', { class: 'prop-chip', text: display(p) })
                        : undefined;
                    }),
                ),
              );
              card.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('application/x-notespace-row', r.uri);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              });
              return card;
            }),
        );
        column.addEventListener('dragover', (e) => {
          if (!e.dataTransfer?.types.includes('application/x-notespace-row')) return;
          e.preventDefault();
          column.classList.add('drop');
        });
        column.addEventListener('dragleave', () => column.classList.remove('drop'));
        column.addEventListener('drop', (e) => {
          column.classList.remove('drop');
          const uri = e.dataTransfer?.getData('application/x-notespace-row');
          const r = rows.find((x) => x.uri === uri);
          if (!r || valueOf(r) === v) return;
          e.preventDefault();
          const next = type === 'checkbox' ? v === 'Yes' : type === 'list' ? (v ? [v] : []) : v;
          write(r, groupKey, type, next);
        });
        return column;
      }),
    );
  } else if (state.view === 'board')
    body = h('p', {
      class: 'muted',
      text: 'Add a text, list or checkbox property (such as status) to group pages on a board.',
    });
  else {
    const head = h('tr', {}, h('th', { scope: 'col', text: 'Title' }));
    for (const c of cols) {
      const th = h('th', { scope: 'col' });
      const b = h(
        'button',
        { type: 'button', class: 'db-sort', title: `Sort by ${c.key}` },
        svg(typeIcon[c.type], 12),
        h('span', { text: c.key }),
        sortKey === c.key
          ? h('span', { class: 'muted', text: state.desc ? ' ↓' : ' ↑' })
          : undefined,
      );
      b.addEventListener('click', () =>
        setView(prefix, sortKey === c.key ? { desc: !state.desc } : { sort: c.key, desc: false }),
      );
      th.append(b);
      head.append(th);
    }
    head.append(h('th', { scope: 'col', text: 'Edited' }));
    body = h(
      'div',
      { class: 'db-table-wrap' },
      h(
        'table',
        { class: 'db-table' },
        h('thead', {}, head),
        h(
          'tbody',
          {},
          ...shown.map((r) =>
            h(
              'tr',
              {},
              h('td', {}, titleCell(r)),
              ...cols.map((c) =>
                h(
                  'td',
                  {},
                  propertyValue(
                    prop(r, c.key),
                    prop(r, c.key)?.type || c.type,
                    (v) => write(r, c.key, prop(r, c.key)?.type || c.type, v),
                    `${r.title} ${c.key}`,
                  ),
                ),
              ),
              h('td', { class: 'muted small', text: ago(r.modified) }),
            ),
          ),
        ),
      ),
    );
  }
  return h(
    'div',
    { class: 'db' },
    h(
      'h1',
      {},
      h('span', { class: 'title-icon' }, svg('table', 26)),
      h('span', { text: section?.title || prefix || 'Pages' }),
    ),
    h('p', {
      class: 'muted',
      text: `${rows?.length ?? '…'} page${rows?.length === 1 ? '' : 's'} in ${prefix || 'the top level'} · each column is a front matter property.`,
    }),
    toolbar,
    body,
  );
}

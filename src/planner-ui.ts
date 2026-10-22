// The NoteSpace workspace panel, a small website in one tab: Home, Wiki, Tasks (list, boards and
// calendar over the same tasks), API and Insights (overview, content health, link graph), with
// Back and Forward.
import {
  render as requestRender,
  button,
  Destination,
  h,
  menuAt,
  P,
  post,
  S,
  setPrefs,
  State,
  store,
  svg,
  toast,
  ui,
  closeMenu,
  save,
  Location,
  iconButton,
  Section,
  sectionOf,
} from './workspace-ui/core';
import {
  openWikiPage,
  receivePreview,
  receiveWikiPage,
  revealInWiki,
  showTags,
  showDatabase,
  namedIcon,
  toggleWikiNav,
  wikiView,
} from './workspace-ui/wiki';
import { openFinder } from './workspace-ui/finder';
import { receiveTemplates } from './workspace-ui/template-gallery';
import { receiveDatabase, requestDatabase } from './workspace-ui/database';
import { wireTaskBoards } from './task-board-ui';
import { wireReaderBlocks } from './reader-blocks';
import { FrameName, setFrameDoc, showFrame, toFrame } from './workspace-ui/frames';
import { listOf, select } from './workspace-ui/tasks';
import { boardsView, boardView } from './workspace-ui/boards';
import { calendarView } from './workspace-ui/calendar';
import { detail } from './workspace-ui/details';
import { focusQuickAdd, homeHeader, homeView, quickCreateItems } from './workspace-ui/home';
import { insightsView } from './workspace-ui/insights';
import { tasksView } from './workspace-ui/tasks';
import type { IconName } from './core/icons';

const app = document.getElementById('app')!;

const sections: Array<[Section, string, IconName]> = [
  ['home', 'Home', 'home'],
  ['wiki', 'Wiki', 'preview'],
  ['tasks', 'Tasks', 'task'],
  ['api', 'API', 'code'],
  ['insights', 'Insights', 'check'],
];
/** Pages of a section, shown as tabs under the navigation. */
const pages: Partial<Record<Section, Array<[Destination, string, IconName]>>> = {
  tasks: [
    ['tasks', 'List', 'task'],
    ['boards', 'Boards', 'layout'],
    ['calendar', 'Calendar', 'calendar'],
  ],
  insights: [
    ['insights', 'Overview', 'check'],
    ['health', 'Content health', 'alert'],
    ['graph', 'Link graph', 'link'],
  ],
};
const frameOf = (d: Destination): FrameName | undefined =>
  d === 'api' || d === 'health' || d === 'graph' ? d : undefined;

function go(target: Destination) {
  setPrefs({ destination: target });
}
/** A section opens on the page last shown in it; chosen again, it goes to its first page. */
const goSection = (section: Section) =>
  go(sectionOf(P().destination) === section ? section : ui.sections?.[section] || section);

// Back and Forward: every place shown is recorded once, wherever the change came from.
const here = (): Location => ({
  destination: P().destination,
  board: P().destination === 'board' ? P().board : undefined,
  wikiPage:
    P().destination !== 'wiki'
      ? undefined
      : ui.wikiTags !== undefined
        ? `#tags:${ui.wikiTags}`
        : ui.wikiDatabase !== undefined
          ? `#db:${ui.wikiDatabase}`
          : P().wikiPage,
});
const same = (a?: Location, b?: Location) =>
  !!a && !!b && a.destination === b.destination && a.board === b.board && a.wikiPage === b.wikiPage;
function record() {
  const history = ui.history || { entries: [], at: -1 };
  const now = here();
  if (same(history.entries[history.at], now)) return;
  // A wiki page that was still loading is the same place.
  const last = history.entries[history.at];
  if (last && last.destination === 'wiki' && now.destination === 'wiki' && !last.wikiPage) {
    history.entries[history.at] = now;
  } else {
    history.entries = [...history.entries.slice(0, history.at + 1), now].slice(-50);
    history.at = history.entries.length - 1;
  }
  ui.history = history;
  save();
}
function travel(step: -1 | 1) {
  const history = ui.history;
  const target = history?.entries[history.at + step];
  if (!history || !target) return;
  history.at += step;
  save();
  if (target.destination === 'wiki' && target.wikiPage?.startsWith('#tags:')) {
    showTags(target.wikiPage.slice(6));
  } else if (target.destination === 'wiki' && target.wikiPage?.startsWith('#db:')) {
    showDatabase(target.wikiPage.slice(4));
  } else if (target.destination === 'wiki' && target.wikiPage) {
    // Destination and page change together, so the move is not recorded as a new place.
    openWikiPage({ path: target.wikiPage });
    requestRender();
  } else
    setPrefs({
      destination: target.destination,
      ...(target.board ? { board: target.board } : {}),
    });
}

const brandColors: Record<string, string> = {
  blue: 'var(--vscode-charts-blue,#3794ff)',
  green: 'var(--vscode-charts-green,#89d185)',
  yellow: 'var(--vscode-charts-yellow,#cca700)',
  orange: 'var(--vscode-charts-orange,#d18616)',
  red: 'var(--vscode-charts-red,#f14c4c)',
  purple: 'var(--vscode-charts-purple,#b180d7)',
  magenta: 'var(--vscode-terminal-ansiMagenta,#bc3fbc)',
  cyan: 'var(--vscode-terminal-ansiCyan,#29b8db)',
};

/**
 * The header, as on a documentation site: the wiki's name and the search box on top, the
 * sections as tabs below it and, in sections with several pages, those pages as a third row.
 */
function nav(): HTMLElement {
  const destination = P().destination;
  const current = sectionOf(destination);
  const ws = S().workspace;
  const history = ui.history;
  const back = iconButton('arrowLeft', 'Back (Alt+Left)', () => travel(-1));
  const forward = iconButton('arrowRight', 'Forward (Alt+Right)', () => travel(1));
  if (!history || history.at <= 0) back.setAttribute('disabled', '');
  if (!history || history.at >= history.entries.length - 1) forward.setAttribute('disabled', '');
  const brand = h(
    'button',
    { type: 'button', class: 'brand', title: `${ws.name} — Home` },
    h('span', { class: 'brand-mark' }, svg(namedIcon(ws.icon || '') || 'preview', 16)),
    h('span', { class: 'brand-name', text: ws.name }),
  );
  brand.addEventListener('click', () => go('home'));
  const finder = h(
    'button',
    {
      type: 'button',
      class: 'finder-button',
      title: 'Find pages, tasks and boards (/)',
      'aria-keyshortcuts': '/',
    },
    svg('search', 14),
    h('span', { class: 'label', text: 'Search' }),
    h('kbd', { text: '/' }),
  );
  finder.addEventListener('click', () => openFinder());
  const head = h(
    'div',
    { class: 'header-bar' },
    h('span', { class: 'history' }, back, forward),
    brand,
  );
  if (S().roots.length > 1) {
    const s = h('select', { class: 'field wiki-switch', 'aria-label': 'Wiki' });
    for (const r of S().roots)
      s.append(h('option', { value: r.id, text: r.name, selected: r.id === S().root }));
    s.addEventListener('change', () => post({ type: 'setRoot', id: s.value }));
    head.append(s);
  }
  head.append(
    h('span', { class: 'spacer' }),
    finder,
    button(
      '',
      (e) => menuAt(e, quickCreateItems(), 'Quick create'),
      'btn ghost icon-only',
      'plus',
      { 'aria-label': 'Create', title: 'Create (C)', 'aria-haspopup': 'menu' },
    ),
  );
  const bar = h('nav', { class: 'section-tabs', 'aria-label': 'NoteSpace' });
  if (destination === 'wiki')
    bar.append(
      iconButton('sidebar', 'Show or hide pages', () => toggleWikiNav(), 'btn ghost icon-only'),
    );
  sections.forEach(([id, label, iconName], index) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'nav-item',
        'aria-current': id === current ? 'page' : undefined,
        title: `${label} (Alt+${index + 1})`,
        'data-nav': id,
      },
      svg(iconName, 15),
      h('span', { class: 'label', text: label }),
    );
    if (id === 'tasks') {
      const n = listOf('today', S().tasks).length;
      if (n) b.append(h('span', { class: 'badge', text: String(n), 'aria-label': `${n} today` }));
    }
    b.addEventListener('click', () => goSection(id));
    bar.append(b);
  });
  // The wiki's color marks the header and the Home.
  if (ws.color && brandColors[ws.color])
    document.body.style.setProperty('--brand', brandColors[ws.color]);
  else document.body.style.removeProperty('--brand');
  const top = h('header', { class: 'top' }, h('div', { class: 'nav' }, head, bar));
  const tabs = pages[current];
  if (!tabs) return top;
  const sub = h('nav', { class: 'subnav', 'aria-label': `${current} pages` });
  for (const [id, label, iconName] of tabs) {
    const active = id === destination || (id === 'boards' && destination === 'board');
    const b = h(
      'button',
      {
        type: 'button',
        class: 'subnav-item',
        'aria-current': active ? 'page' : undefined,
        'data-nav': id,
      },
      svg(iconName, 14),
      h('span', { text: label }),
    );
    b.addEventListener('click', () => go(id));
    sub.append(b);
  }
  top.append(sub);
  return top;
}

function render() {
  const state = store.state;
  if (!state) return;
  const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
  const focusedId = document.activeElement?.id;
  // The document scrolls; rebuilding it would otherwise jump back to the top.
  const scroll = window.scrollY;
  const navScroll = document.querySelector('.wiki-nav')?.scrollTop || 0;
  // Text being typed survives a refresh from the host (the inputs are recreated).
  const drafts = new Map<string, { value: string; start: number | null; end: number | null }>();
  for (const input of Array.from(
    app.querySelectorAll<HTMLInputElement>('input[id]:not([type=checkbox]):not([type=date])'),
  ))
    if (input.value)
      drafts.set(input.id, {
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
      });
  app.replaceChildren();
  if (state.empty) {
    app.append(
      h(
        'div',
        { class: 'main' },
        h(
          'div',
          { class: 'empty' },
          h('p', {
            text: 'Open or create a wiki to start. NoteSpace keeps pages, notes, tasks and boards as Markdown files in your workspace.',
          }),
        ),
      ),
    );
    return;
  }
  const destination = P().destination;
  record();
  ui.sections = { ...ui.sections, [sectionOf(destination)]: destination };
  const selected = state.tasks.find((t) => t.key === ui.selected);
  const main = h('main', { class: `main dest-${destination}`, 'aria-label': destination });
  if (destination === 'home') main.append(homeHeader(), homeView());
  else if (destination === 'wiki') main.append(wikiView());
  else if (frameOf(destination)) main.append(h('div', { class: 'frame-space' }));
  else if (destination === 'tasks') main.append(tasksView());
  else if (destination === 'boards') main.append(boardsView());
  else if (destination === 'board') main.append(boardView());
  else if (destination === 'calendar') main.append(calendarView());
  else main.append(insightsView());
  app.append(
    nav(),
    h(
      'div',
      { class: `layout${selected ? ' with-detail' : ''}` },
      main,
      selected ? detail(selected) : undefined,
    ),
  );
  for (const [id, draft] of drafts) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input && !input.value) {
      input.value = draft.value;
      if (id === focusedId && draft.start !== null) input.setSelectionRange(draft.start, draft.end);
    }
  }
  // Sticky columns and frames start below the header, whose height depends on the section.
  const top = app.querySelector('.top')?.getBoundingClientRect().height || 41;
  document.body.style.setProperty('--top', `${Math.round(top)}px`);
  showFrame(frameOf(destination), onKey);
  window.scrollTo(0, scroll);
  const tree = document.querySelector('.wiki-nav');
  if (tree) tree.scrollTop = navScroll;
  if (focusedId) document.getElementById(focusedId)?.focus();
  else if (focusedKey)
    document.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
}
store.render = render;

window.addEventListener('message', (event) => {
  const m = event.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'state') {
    // Index notifications repeat the same state; re-rendering would only disturb focus. A
    // forced state (after an error) always replaces optimistic local changes.
    const json = JSON.stringify({ ...m, force: false, go: undefined });
    if (json === store.lastState && !m.force && !m.go) return;
    store.lastState = json;
    const previous = store.state?.tasks?.find((t) => t.key === ui.selected);
    store.state = m as State;
    // Pages changed: a database on screen reads its rows again.
    if (ui.wikiDatabase !== undefined && P()?.destination === 'wiki')
      requestDatabase(ui.wikiDatabase);
    // Tasks without a ^id are keyed by their line: follow an edited task to its new key.
    if (previous && !store.state.tasks?.some((t) => t.key === ui.selected)) {
      const same = store.state.tasks?.filter(
        (t) => t.pagePath === previous.pagePath && t.title === previous.title,
      );
      if (same?.length === 1) ui.selected = same[0].key;
    }
    // The view's own preferences win (they are saved as they change); the host's copy fills in
    // what changed elsewhere (pins, recent boards) and `go` switches destination on request.
    if (!store.state.empty) {
      store.prefs =
        m.force || !store.prefs
          ? store.state.prefs
          : {
              ...store.prefs,
              pinned: store.state.prefs.pinned,
              recentBoards: store.state.prefs.recentBoards,
              statusColumns: store.state.prefs.statusColumns,
            };
      if (m.go) store.prefs = { ...store.prefs, ...m.go };
    }
    if (ui.selected && !store.state.tasks?.some((t) => t.key === ui.selected))
      ui.selected = undefined;
    requestRender();
  } else if (m.type === 'wikiPage') receiveWikiPage(m.page, m.anchor);
  else if (m.type === 'wikiPreview') receivePreview(m);
  else if (m.type === 'wikiDatabase') receiveDatabase(m.prefix, m.rows);
  else if (m.type === 'toast') toast(String(m.text), !!m.error);
  else if (m.type === 'templates') receiveTemplates(m.items);
  else if (m.type === 'frame') toFrame(m.frame, m.message);
  else if (m.type === 'frameDoc') setFrameDoc(m.frame, m.doc);
  else if (m.type === 'wikiReveal') revealInWiki(m.section, m.filter);
  else if (m.type === 'error') toast(String(m.message), true);
});

// Mouse back and forward buttons.
document.addEventListener('mouseup', (event) => {
  if (event.button === 3 || event.button === 4) {
    event.preventDefault();
    travel(event.button === 3 ? -1 : 1);
  }
});
function onKey(event: KeyboardEvent) {
  // Alt+←/→ go Back and Forward, unless a card or a field already used them (card moves).
  if (
    event.altKey &&
    (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
    !event.defaultPrevented &&
    !(event.target as HTMLElement).closest?.('input, textarea, select, [data-key]')
  ) {
    event.preventDefault();
    travel(event.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (event.altKey && /^Digit[1-5]$/.test(event.code)) {
    event.preventDefault();
    goSection(sections[Number(event.code.slice(5)) - 1][0]);
    return;
  }
  const typing =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement;
  if (
    typing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    document.querySelector('.modal-back')
  )
    return;
  if (event.key === 'n') {
    event.preventDefault();
    focusQuickAdd();
  } else if (event.key === '/') {
    event.preventDefault();
    openFinder();
  } else if (event.key === 'f' && document.getElementById('filter-text')) {
    event.preventDefault();
    document.getElementById('filter-text')!.focus();
  } else if (event.key === 'c') {
    const b = document.querySelector<HTMLElement>('.nav [aria-haspopup=menu]');
    if (b) {
      event.preventDefault();
      b.click();
    }
  } else if (event.key === 'Escape' && ui.selected) {
    closeMenu(false);
    select(undefined);
  }
}
document.addEventListener('keydown', onKey);
// Interactive blocks of wiki pages (boards, ```http, Copy, diagram zoom), as in the Reader.
wireTaskBoards(post);
wireReaderBlocks(post);
void save;
post({ type: 'ready' });

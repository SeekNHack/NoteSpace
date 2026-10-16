// The NoteSpace workspace panel: Home, Tasks, Boards, Calendar and Insights in one view.
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
} from './workspace-ui/core';
import { listOf, select } from './workspace-ui/tasks';
import { boardsView, boardView } from './workspace-ui/boards';
import { calendarView } from './workspace-ui/calendar';
import { detail } from './workspace-ui/details';
import { focusQuickAdd, homeHeader, homeView, quickCreateItems } from './workspace-ui/home';
import { insightsView } from './workspace-ui/insights';
import { tasksView } from './workspace-ui/tasks';
import type { IconName } from './core/icons';

const app = document.getElementById('app')!;

const destinations: Array<[Destination | 'wiki' | 'api', string, IconName, string]> = [
  ['home', 'Home', 'home', 'Alt+1'],
  ['wiki', 'Wiki', 'preview', 'Alt+2'],
  ['tasks', 'Tasks', 'task', 'Alt+3'],
  ['boards', 'Boards', 'layout', 'Alt+4'],
  ['calendar', 'Calendar', 'calendar', 'Alt+5'],
  ['insights', 'Insights', 'check', 'Alt+6'],
  ['api', 'API', 'code', 'Alt+7'],
];

function go(target: Destination | 'wiki' | 'api') {
  if (target === 'wiki') post({ type: 'openWiki' });
  else if (target === 'api') post({ type: 'command', name: 'apiClient' });
  else setPrefs({ destination: target });
}

function nav(): HTMLElement {
  const current = P().destination === 'board' ? 'boards' : P().destination;
  const bar = h('nav', { class: 'nav', 'aria-label': 'NoteSpace' });
  for (const [id, label, iconName, keys] of destinations) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'nav-item',
        'aria-current': id === current ? 'page' : undefined,
        title: `${label} (${keys})${id === 'wiki' ? ' — opens the wiki homepage in the editor' : id === 'api' ? ' — opens the API Client' : ''}`,
        'data-nav': id,
      },
      svg(iconName, 15),
      h('span', { class: 'label', text: label }),
    );
    if (id === 'tasks') {
      const n = listOf('today', S().tasks).length;
      if (n) b.append(h('span', { class: 'badge', text: String(n), 'aria-label': `${n} today` }));
    }
    b.addEventListener('click', () => go(id));
    bar.append(b);
  }
  bar.append(h('span', { class: 'spacer' }));
  if (S().roots.length > 1) {
    const s = h('select', { class: 'field', 'aria-label': 'Wiki' });
    for (const r of S().roots)
      s.append(h('option', { value: r.id, text: r.name, selected: r.id === S().root }));
    s.addEventListener('change', () => post({ type: 'setRoot', id: s.value }));
    bar.append(s);
  }
  bar.append(
    button(
      '',
      (e) => menuAt(e, quickCreateItems(), 'Quick create'),
      'btn ghost icon-only',
      'plus',
      { 'aria-label': 'Create', title: 'Create (C)', 'aria-haspopup': 'menu' },
    ),
  );
  return bar;
}

function render() {
  const state = store.state;
  if (!state) return;
  const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
  const focusedId = document.activeElement?.id;
  const scroll = document.querySelector('.main')?.scrollTop || 0;
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
  const selected = state.tasks.find((t) => t.key === ui.selected);
  const main = h('main', { class: `main dest-${destination}`, 'aria-label': destination });
  if (destination === 'home') main.append(homeHeader(), homeView());
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
  const restored = document.querySelector('.main');
  if (restored) restored.scrollTop = scroll;
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
  } else if (m.type === 'error') toast(String(m.message), true);
});

document.addEventListener('keydown', (event) => {
  if (event.altKey && /^Digit[1-7]$/.test(event.code)) {
    event.preventDefault();
    go(destinations[Number(event.code.slice(5)) - 1][0]);
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
    document.getElementById('filter-text')?.focus();
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
});
void save;
post({ type: 'ready' });

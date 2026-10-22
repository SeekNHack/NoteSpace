// Find anything (/): pages, tasks, boards and the panel's own pages in one list. Typing filters
// by every word; Enter opens the result where it lives in the panel.
import { h, P, S, setPrefs, svg } from './core';
import type { Destination, NavNode } from './core';
import type { IconName } from '../core/icons';
import { openWikiPage, randomPage, showTags } from './wiki';
import { select } from './tasks';
import { openBoard } from './boards';

interface Result {
  label: string;
  detail: string;
  kind: string;
  icon: IconName;
  run: () => void;
}

const places: Array<[string, Destination, IconName]> = [
  ['Home', 'home', 'home'],
  ['Tasks', 'tasks', 'task'],
  ['Boards', 'boards', 'layout'],
  ['Calendar', 'calendar', 'calendar'],
  ['API Client', 'api', 'code'],
  ['Insights', 'insights', 'check'],
  ['Content health', 'health', 'alert'],
  ['Link graph', 'graph', 'link'],
];

function results(query: string): Result[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const score = (text: string) => {
    const t = text.toLocaleLowerCase();
    if (!words.every((w) => t.includes(w))) return -1;
    return words.length && t.startsWith(words[0]) ? 2 : 1;
  };
  const out: Array<Result & { score: number }> = [];
  const add = (r: Result, haystack: string) => {
    const s = score(haystack);
    if (s >= 0) out.push({ ...r, score: s });
  };
  for (const [label, destination, icon] of places)
    add(
      { label, detail: 'Go to', kind: 'Place', icon, run: () => setPrefs({ destination }) },
      label,
    );
  add(
    {
      label: 'Tags',
      detail: 'Every tag in the wiki',
      kind: 'Place',
      icon: 'badge',
      run: () => showTags(''),
    },
    'Tags',
  );
  add(
    {
      label: 'Random page',
      detail: 'Open a page at random',
      kind: 'Place',
      icon: 'refresh',
      run: () => randomPage(),
    },
    'Random page',
  );
  // A board's file is listed as the board.
  const boardFiles = new Set(S().boards.map((b) => b.pagePath));
  const walk = (nodes: NavNode[]) => {
    for (const n of nodes) {
      if (n.id && !boardFiles.has(n.path))
        add(
          {
            label: n.title,
            detail: n.path,
            kind: 'Page',
            icon: n.kind === 'section' ? 'folder' : 'file',
            run: () => {
              setPrefs({ destination: 'wiki' });
              openWikiPage({ id: n.id });
            },
          },
          `${n.title} ${n.path}`,
        );
      walk(n.children || []);
    }
  };
  walk(S().wiki.tree);
  if (words.length) {
    const tags = new Set<string>();
    const collect = (nodes: NavNode[]) =>
      nodes.forEach((n) => {
        n.tags?.forEach((t) => tags.add(t));
        collect(n.children || []);
      });
    collect(S().wiki.tree);
    for (const t of tags)
      add(
        {
          label: `#${t}`,
          detail: 'Pages with this tag',
          kind: 'Tag',
          icon: 'badge',
          run: () => showTags(t),
        },
        `#${t} ${t}`,
      );
  }
  for (const b of S().boards.filter((b) => !b.archived))
    add(
      {
        label: b.name,
        detail: `${b.open} open`,
        kind: 'Board',
        icon: 'layout',
        run: () => openBoard(b.id),
      },
      b.name,
    );
  if (words.length)
    for (const t of S().tasks)
      add(
        {
          label: t.title,
          detail: `${t.checked ? 'Done · ' : ''}${t.pageTitle}`,
          kind: 'Task',
          icon: 'check',
          run: () => {
            if (P().destination !== 'tasks') setPrefs({ destination: 'tasks', taskList: 'all' });
            select(t.key);
          },
        },
        `${t.title} ${t.tags.map((x) => `#${x}`).join(' ')} ${t.project || ''}`,
      );
  // Places first when nothing is typed; then the best matches, open tasks before done ones.
  return out.sort((a, b) => b.score - a.score).slice(0, 60);
}

export function openFinder() {
  if (document.querySelector('.finder')) return;
  const returnTo = document.activeElement as HTMLElement | null;
  const back = h('div', { class: 'modal-back finder-back' });
  const input = h('input', {
    type: 'search',
    class: 'field',
    placeholder: 'Find pages, tasks, boards…',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'finder-list',
    'aria-autocomplete': 'list',
    'aria-label': 'Find',
  });
  const list = h('ul', { class: 'finder-list', id: 'finder-list', role: 'listbox' });
  const box = h(
    'div',
    { class: 'finder', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Find' },
    input,
    list,
  );
  back.append(box);
  document.body.append(back);
  let items: Result[] = [];
  let at = 0;
  const close = () => {
    back.remove();
    returnTo?.focus();
  };
  const choose = (r?: Result) => {
    if (!r) return;
    back.remove();
    r.run();
  };
  const paint = () => {
    list.replaceChildren(
      ...items.map((r, i) => {
        const li = h(
          'li',
          {
            role: 'option',
            id: `finder-${i}`,
            class: 'finder-item',
            'aria-selected': String(i === at),
          },
          svg(r.icon, 14),
          h('span', { class: 'finder-label', text: r.label }),
          h('span', { class: 'finder-detail', text: r.detail }),
          h('span', { class: 'finder-kind', text: r.kind }),
        );
        li.addEventListener('mousedown', (event) => {
          event.preventDefault();
          choose(r);
        });
        return li;
      }),
    );
    if (!items.length) list.append(h('li', { class: 'finder-none', text: 'Nothing found.' }));
    input.setAttribute('aria-activedescendant', items.length ? `finder-${at}` : '');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  };
  const update = () => {
    items = results(input.value);
    at = 0;
    paint();
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length)
        at = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[at]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  back.addEventListener('mousedown', (event) => {
    if (event.target === back) close();
  });
  update();
  input.focus();
}

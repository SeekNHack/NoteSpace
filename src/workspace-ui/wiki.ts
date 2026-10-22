// Wiki destination: an MkDocs-style reader inside the workspace panel. The navigation tree is
// on the left, the page in the middle and its outline on the right; links stay in the panel.
import {
  ago,
  button,
  emptyState,
  h,
  iconButton,
  menuAt,
  post,
  S,
  save,
  setPrefs,
  store,
  svg,
  ui,
} from './core';
import { iconPaths } from '../core/icons';
import type { IconName } from '../core/icons';
import type { MenuItem } from './core';
import { enhanceReaderBlocks } from '../reader-blocks';
import { openDay } from './calendar';
import type { NavNode, WikiPageDto } from './core';

let page: WikiPageDto | undefined;
/** The rendered article, kept across re-renders so its DOM (and images) are not rebuilt. */
let article: HTMLElement | undefined;
let pendingAnchor: string | undefined;

const allNodes = (nodes: NavNode[]): NavNode[] =>
  nodes.flatMap((n) => [n, ...allNodes(n.children || [])]);
const readingOrder = (nodes: NavNode[]): NavNode[] =>
  nodes.flatMap((n) =>
    n.kind === 'page' ? [n] : [...(n.id ? [n] : []), ...readingOrder(n.children || [])],
  );
const expanded = () => new Set(ui.wikiExpanded || []);

/** A page's icon: one of the panel's icons by name, or an emoji. */
export function pageIconEl(icon: string | undefined, size = 14): Element | undefined {
  if (!icon) return undefined;
  if (/^[a-z][a-zA-Z0-9-]*$/.test(icon)) {
    const name = namedIcon(icon);
    return name ? svg(name, size) : undefined;
  }
  return h('span', { class: 'page-emoji', text: icon, 'aria-hidden': 'true' });
}
// Other common icon names (VS Code's codicons among them) for the closest panel icon.
const iconAliases: Record<string, IconName> = {
  'graduation-cap': 'graduation',
  tools: 'wrench',
  organization: 'users',
  people: 'users',
  library: 'book',
  beaker: 'example',
  notebook: 'note',
  project: 'layout',
  gear: 'settings',
  bulb: 'lightbulb',
  'book-open': 'book',
  warning: 'warning',
};
/** The panel icon for an icon name, if there is one. */
export const namedIcon = (name: string): IconName | undefined =>
  name in iconPaths ? (name as IconName) : iconAliases[name];
const statusLabel: Record<string, string> = {
  new: 'New',
  updated: 'Updated',
  beta: 'Beta',
  deprecated: 'Deprecated',
  draft: 'Draft',
};
export const statusBadge = (status: string | undefined) =>
  status
    ? h('span', {
        class: `status-badge status-${status}`,
        text: statusLabel[status] || status,
        title: `Status: ${statusLabel[status] || status}`,
      })
    : undefined;

/** Shows the tag index: every tag, or the pages of one tag. */
export function showTags(tag = '') {
  ui.wikiTags = tag;
  save();
  if (store.prefs?.destination !== 'wiki') setPrefs({ destination: 'wiki' });
  else store.render();
  window.scrollTo(0, 0);
}

/** Opens a page of the wiki at random (pages only, not notebooks or the section pages). */
export function randomPage() {
  const pages = allNodes(S().wiki.tree).filter(
    (n) => n.kind === 'page' && n.id && n.id !== page?.id,
  );
  const pick = pages[Math.floor(Math.random() * pages.length)];
  if (!pick) return;
  if (store.prefs?.destination !== 'wiki') setPrefs({ destination: 'wiki' });
  openWikiPage({ id: pick.id });
}

/** Opens a page of the wiki in the panel (by path from the tree, or by id from a link). */
export function openWikiPage(target: { path?: string; id?: string; anchor?: string }) {
  const node = allNodes(S().wiki.tree).find(
    (n) => (target.id && n.id === target.id) || (target.path && n.path === target.path),
  );
  const path = node?.kind === 'section' ? undefined : node?.path;
  // The section's own page is shown when a section is opened.
  const id = target.id || node?.id;
  if (path && store.prefs) store.prefs = { ...store.prefs, destination: 'wiki', wikiPage: path };
  if (node) revealPath(node.kind === 'section' ? node.path : node.path);
  pendingAnchor = target.anchor || undefined;
  if (ui.wikiTags !== undefined) {
    ui.wikiTags = undefined;
    save();
    store.render();
  }
  post({ type: 'wikiOpen', ...(id ? { id } : { path: target.path }), anchor: target.anchor });
}

/** Expands the sections above a page so it is visible in the tree. */
function revealPath(path: string) {
  const open = expanded();
  const parts = path.replace(/\/$/, '').split('/');
  for (let i = 1; i < parts.length; i++) open.add(`${parts.slice(0, i).join('/')}/`);
  if (path.endsWith('/')) open.add(path);
  ui.wikiExpanded = [...open];
  save();
}

/** A page arrived from the host. */
export function receiveWikiPage(next: WikiPageDto | undefined, anchor?: string) {
  hidePreview();
  const changed = next?.id !== page?.id;
  page = next;
  article = undefined;
  if (next && store.prefs && store.prefs.wikiPage !== next.path)
    store.prefs = { ...store.prefs, wikiPage: next.path };
  if (next) revealPath(next.path);
  const target = anchor || pendingAnchor;
  pendingAnchor = undefined;
  store.render();
  if (target)
    requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ block: 'start' }),
    );
  else if (changed) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------------------------
// Managing pages: the tree is the wiki's file manager (menus, drag and drop)
// ---------------------------------------------------------------------------------------------
const action = (name: string, target: { uri?: string; prefix?: string }) =>
  post({ type: 'wikiAction', action: name, ...target });
const folderOf = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
function pageMenu(n: NavNode): MenuItem[] {
  const uri = n.uri;
  const favorite = S().home.favorites.some((f) => f.uri === uri);
  return [
    { label: 'Edit', icon: 'edit', run: () => action('edit', { uri }) },
    { label: 'Open to the Side', icon: 'split', run: () => action('openToSide', { uri }) },
    { label: 'Open in Reader', icon: 'preview', run: () => action('preview', { uri }) },
    { separator: true, label: '' },
    {
      label: 'New Page Here…',
      icon: 'plus',
      run: () => action('newPage', { prefix: folderOf(n.path) }),
    },
    {
      label: favorite ? 'Remove from Favorites' : 'Add to Favorites',
      icon: 'star',
      run: () => action('toggleFavorite', { uri }),
    },
    { label: 'Copy Link', icon: 'link', run: () => action('copyLink', { uri }) },
    { label: 'Properties…', icon: 'sliders', run: () => action('pageProperties', { uri }) },
    { label: 'History', icon: 'clock', run: () => action('pageHistory', { uri }) },
    { separator: true, label: '' },
    { label: 'Rename…', icon: 'edit', run: () => action('renamePage', { uri }) },
    { label: 'Move…', icon: 'folder', run: () => action('movePage', { uri }) },
    { label: 'Duplicate…', icon: 'copy', run: () => action('duplicatePage', { uri }) },
    {
      label: 'Reveal in File Explorer',
      icon: 'file',
      run: () => action('revealInExplorer', { uri }),
    },
    { separator: true, label: '' },
    { label: 'Delete…', icon: 'trash', danger: true, run: () => action('deletePage', { uri }) },
  ];
}
function sectionMenu(n: NavNode): MenuItem[] {
  const prefix = n.path;
  return [
    ...(n.id
      ? [{ label: 'Open', icon: 'preview' as const, run: () => openWikiPage({ id: n.id }) }]
      : []),
    { label: 'New Page Here…', icon: 'plus', run: () => action('newPage', { prefix }) },
    { label: 'New Folder Here…', icon: 'folder', run: () => action('newSection', { prefix }) },
    { separator: true, label: '' },
    { label: 'Rename or Move…', icon: 'edit', run: () => action('renameSection', { prefix }) },
    {
      label: 'Reveal in File Explorer',
      icon: 'file',
      run: () => action('revealInExplorer', { prefix }),
    },
    { separator: true, label: '' },
    {
      label: 'Delete Folder…',
      icon: 'trash',
      danger: true,
      run: () => action('deleteSection', { prefix }),
    },
  ];
}
function wikiMenu(): MenuItem[] {
  const run = (command: string) => () => action(`wiki:${command}`, {});
  return [
    { label: 'Wiki Settings', icon: 'sliders', run: run('openWikiSettings') },
    { label: 'Rename Wiki…', icon: 'edit', run: run('renameWiki') },
    { label: 'Edit Description…', icon: 'text', run: run('editWikiDescription') },
    { label: 'Change Icon…', icon: 'emoji', run: run('setWikiIcon') },
    { label: 'Change Color…', icon: 'highlight', run: run('setWikiColor') },
    ...(S().roots.length > 1
      ? [{ label: 'Set as Default Wiki', icon: 'star' as const, run: run('setDefaultWiki') }]
      : []),
    { separator: true, label: '' },
    {
      label: 'Export',
      icon: 'attachment',
      items: [
        { label: 'Website (HTML)…', run: run('export') },
        { label: 'PDF…', run: run('exportPdf') },
        { label: 'EPUB…', run: run('exportEpub') },
        { label: 'Customize Site Theme…', run: run('themeBuilder') },
      ],
    },
    { label: 'Validate Links and Pages', icon: 'check', run: run('validate') },
    {
      label: 'Import',
      icon: 'folder',
      items: [
        { label: 'Markdown or MkDocs Project…', run: run('importProject') },
        { label: 'Obsidian Vault…', run: run('importObsidian') },
      ],
    },
    { separator: true, label: '' },
    { label: 'Remove from NoteSpace…', icon: 'unlink', run: run('removeWiki') },
    { label: 'Delete Wiki Files…', icon: 'trash', danger: true, run: run('deleteWiki') },
  ];
}
function fileMenu(n: NavNode): MenuItem[] {
  return [
    { label: 'Open', icon: 'preview', run: () => action('openFile', { uri: n.uri }) },
    {
      label: 'Reveal in File Explorer',
      icon: 'file',
      run: () => action('revealInExplorer', { uri: n.uri }),
    },
  ];
}
/** Pages and folders are dragged onto a folder (or the wiki's name, for the top level). */
function draggable(el: HTMLElement, item: { uri?: string; prefix?: string }) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('application/x-notespace-page', JSON.stringify(item));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
}
function dropTarget(el: HTMLElement, folder: string) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('application/x-notespace-page')) return;
    e.preventDefault();
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop');
    const raw = e.dataTransfer?.getData('application/x-notespace-page');
    if (!raw) return;
    e.preventDefault();
    const item = JSON.parse(raw) as { uri?: string; prefix?: string };
    if (item.prefix && (folder === item.prefix || folder.startsWith(item.prefix))) return;
    post({ type: 'wikiMove', ...item, to: folder });
  });
}

function favorites(): HTMLElement | undefined {
  const list = S().home.favorites;
  if (!list.length) return undefined;
  return h(
    'div',
    { class: 'wiki-favorites' },
    h('div', { class: 'wiki-group', text: 'Favorites' }),
    ...list.map((f) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: `wiki-node page wiki-link${f.path === page?.path ? ' current' : ''}`,
          title: f.path,
        },
        svg('star', 12),
        h('span', { text: f.title }),
      );
      b.addEventListener('click', () => openWikiPage({ path: f.path }));
      return b;
    }),
  );
}

function treeView(nodes: NavNode[], filter: string, depth = 0): HTMLElement | undefined {
  const open = expanded();
  const current = page?.path;
  const matches = (n: NavNode): boolean =>
    !filter ||
    `${n.title} ${n.path}`.toLocaleLowerCase().includes(filter) ||
    (n.children || []).some(matches);
  const visible = nodes.filter(matches);
  if (!visible.length) return undefined;
  const list = h('ul', { class: 'wiki-tree', role: depth ? 'group' : 'tree' });
  for (const n of visible) {
    const li = h('li', { role: 'treeitem' });
    if (n.kind === 'section') {
      const isOpen = !!filter || open.has(n.path);
      li.setAttribute('aria-expanded', String(isOpen));
      const row = h('div', {
        class: `wiki-node section${n.id && n.id === page?.id ? ' current' : ''}`,
        'data-path': n.path,
      });
      dropTarget(row, n.path);
      draggable(row, { prefix: n.path });
      row.addEventListener('contextmenu', (e) => menuAt(e, sectionMenu(n), n.title));
      const twisty = button(
        '',
        () => {
          const set = expanded();
          if (set.has(n.path)) set.delete(n.path);
          else set.add(n.path);
          ui.wikiExpanded = [...set];
          save();
          store.render();
        },
        'twisty',
        isOpen ? 'chevron' : 'chevronRight',
        { 'aria-label': `${isOpen ? 'Collapse' : 'Expand'} ${n.title}` },
      );
      const label = h(
        'button',
        { type: 'button', class: 'wiki-link', 'aria-keyshortcuts': 'Shift+F10' },
        pageIconEl(n.icon, 13),
        h('span', { class: 'title', text: n.title }),
        statusBadge(n.status),
      );
      label.addEventListener('click', () => {
        if (n.id) openWikiPage({ id: n.id });
        else twisty.click();
      });
      label.addEventListener('keydown', (e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
          menuAt(e, sectionMenu(n), n.title);
      });
      row.append(twisty, label);
      li.append(row);
      if (isOpen) {
        const sub = treeView(n.children || [], filter, depth + 1);
        if (sub) li.append(sub);
      }
    } else {
      const file = n.kind === 'file';
      const b = h(
        'button',
        {
          type: 'button',
          class: `wiki-node page wiki-link${file ? ' file' : ''}${n.path === current ? ' current' : ''}`,
          'aria-current': n.path === current ? 'page' : undefined,
          title: file ? `${n.path} — opens in the ${n.file} editor` : n.path,
          'aria-keyshortcuts': 'Shift+F10',
        },
        file ? svg(n.file === 'notebook' ? 'code' : 'layout', 13) : pageIconEl(n.icon, 13),
        h('span', { class: 'title', text: n.title }),
        n.status
          ? statusBadge(n.status)
          : n.draft
            ? h('span', { class: 'chip', text: 'Draft' })
            : undefined,
      );
      const items = () => (file ? fileMenu(n) : pageMenu(n));
      b.addEventListener('click', () =>
        file
          ? post({ type: 'wikiAction', action: 'openFile', uri: n.uri })
          : openWikiPage({ path: n.path }),
      );
      b.addEventListener('contextmenu', (e) => menuAt(e, items(), n.title));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) menuAt(e, items(), n.title);
      });
      if (!file) draggable(b, { uri: n.uri });
      li.append(b);
    }
    list.append(li);
  }
  return list;
}

function sidebar(): HTMLElement {
  const filter = h('input', {
    id: 'wiki-filter',
    type: 'search',
    class: 'field',
    placeholder: 'Filter pages',
    'aria-label': 'Filter pages',
    value: ui.wikiFilter || '',
  });
  filter.addEventListener('input', () => {
    ui.wikiFilter = filter.value;
    save();
    const tree = treeView(S().wiki.tree, filter.value.trim().toLocaleLowerCase());
    nav.querySelector('.wiki-tree')?.remove();
    nav.querySelector('.wiki-none')?.remove();
    nav.append(tree || h('p', { class: 'muted small wiki-none', text: 'No matching pages.' }));
  });
  const name = h('strong', {
    class: 'wiki-name',
    text: S().workspace.name,
    title: 'Drop here to move to the top level',
  });
  dropTarget(name, '');
  const head = h(
    'div',
    { class: 'wiki-side-head' },
    name,
    button('', () => post({ type: 'command', name: 'newPage' }), 'btn ghost icon-only', 'plus', {
      'aria-label': 'New page',
      title: 'New page',
    }),
    button(
      '',
      () => post({ type: 'command', name: 'newSection' }),
      'btn ghost icon-only',
      'folder',
      {
        'aria-label': 'New folder',
        title: 'New folder',
      },
    ),
    iconButton('badge', 'Tags', () => showTags('')),
    iconButton('refresh', 'Random page', () => randomPage()),
    button('', (e) => menuAt(e, wikiMenu(), 'Wiki'), 'btn ghost icon-only', 'more', {
      'aria-label': 'Wiki actions',
      title: 'Wiki settings, export, import',
      'aria-haspopup': 'menu',
    }),
  );
  const nav = h('nav', { class: 'wiki-nav', 'aria-label': 'Pages' }, head, filter);
  if (!ui.wikiFilter) {
    const fav = favorites();
    if (fav) nav.append(fav);
  }
  nav.append(
    treeView(S().wiki.tree, (ui.wikiFilter || '').trim().toLocaleLowerCase()) ||
      h('p', { class: 'muted small wiki-none', text: 'No matching pages.' }),
  );
  return nav;
}

function onArticleClick(event: MouseEvent) {
  hidePreview();
  const anchor = (event.target as HTMLElement).closest?.('a');
  if (!anchor || !page) return;
  const href = anchor.getAttribute('href') || '';
  if (href.startsWith('#wiki:')) {
    event.preventDefault();
    const [id, query] = href.slice(6).split('?');
    const params = new URLSearchParams(query || '');
    const offset = params.get('offset');
    if (offset !== null)
      post({ type: 'wikiOpen', id: decodeURIComponent(id), offset: Number(offset) });
    else openWikiPage({ id: decodeURIComponent(id), anchor: params.get('anchor') || undefined });
  } else if (href.startsWith('#date:')) {
    // A date mention opens that day in the calendar; a person, their tasks.
    event.preventDefault();
    openDay(href.slice(6));
  } else if (href.startsWith('#person:')) {
    event.preventDefault();
    ui.filter = { ...ui.filter, assignee: decodeURIComponent(href.slice(8)) };
    save();
    setPrefs({ destination: 'tasks', taskList: 'all' });
  } else if (href.startsWith('#asset:')) {
    event.preventDefault();
    post({ type: 'wikiAsset', uri: page.uri, target: decodeURIComponent(href.slice(7)) });
  } else if (href.startsWith('#code:')) {
    event.preventDefault();
    post({ type: 'wikiCode', uri: page.uri, target: decodeURIComponent(href.slice(6)) });
  } else if (/^(https?:|mailto:)/i.test(href)) {
    event.preventDefault();
    post({ type: 'external', href });
  } else if (href.startsWith('#') && href.length > 1) {
    event.preventDefault();
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
  }
}

function content(): HTMLElement {
  if (!page)
    return h(
      'div',
      { class: 'wiki-content' },
      emptyState(
        S().wiki.tree.length
          ? 'Loading…'
          : 'This wiki has no pages yet. Pages are Markdown files in the wiki folder.',
        ...(S().wiki.tree.length
          ? []
          : [
              button(
                'New page',
                () => post({ type: 'command', name: 'newPage' }),
                'btn primary',
                'plus',
              ),
            ]),
      ),
    );
  const p = page;
  const tree = S().wiki.tree;
  const nodes = allNodes(tree);
  const crumbs = h('nav', { class: 'wiki-crumbs', 'aria-label': 'Breadcrumb' });
  const parts = p.path.split('/').slice(0, -1);
  const home = h('button', { type: 'button', class: 'crumb', text: S().workspace.name });
  const homeNode = tree.find((n) => n.kind === 'page' && n.id) || tree[0];
  home.addEventListener('click', () => homeNode?.id && openWikiPage({ id: homeNode.id }));
  crumbs.append(home);
  parts.forEach((_, i) => {
    const folder = `${parts.slice(0, i + 1).join('/')}/`;
    const section = nodes.find((n) => n.kind === 'section' && n.path === folder);
    crumbs.append(svg('chevronRight', 12));
    if (section?.id && section.id !== p.id) {
      const a = h('button', { type: 'button', class: 'crumb', text: section.title });
      a.addEventListener('click', () => openWikiPage({ id: section.id }));
      crumbs.append(a);
    } else crumbs.append(h('span', { text: section?.title || parts[i] }));
  });
  const head = h(
    'div',
    { class: 'wiki-head' },
    crumbs,
    statusBadge(p.status),
    h('span', { class: 'spacer' }),
    button('', () => post({ type: 'wikiReader', uri: p.uri }), 'btn ghost icon-only', 'preview', {
      'aria-label': 'Open in Reader',
      title: 'Open the page in the Reader beside (interactive blocks run there)',
    }),
    button('', () => post({ type: 'wikiEdit', uri: p.uri }), 'btn ghost icon-only', 'edit', {
      'aria-label': 'Edit this page',
      title: 'Edit this page',
    }),
  );
  if (!article) {
    article = h('article', { class: 'doc wiki-article' });
    article.innerHTML = p.html;
    enhanceReaderBlocks(article);
    (window as unknown as { wikiRichTabs?: (root: ParentNode) => void }).wikiRichTabs?.(article);
    const icon = pageIconEl(p.icon, 30);
    if (icon) article.querySelector('h1')?.prepend(h('span', { class: 'title-icon' }, icon));
    if (p.tags.length)
      article.prepend(
        h(
          'div',
          { class: 'tags' },
          ...p.tags.map((t) => {
            const b = h('button', {
              type: 'button',
              class: 'tag',
              text: `#${t}`,
              title: `Pages tagged ${t}`,
            });
            b.addEventListener('click', () => showTags(t));
            return b;
          }),
        ),
      );
    if (p.cover) article.prepend(h('img', { class: 'wiki-cover', src: p.cover, alt: '' }));
    article.addEventListener('click', onArticleClick);
    wirePreviews(article);
    // Task checkboxes write the task line; the page comes back rendered from the file.
    article.addEventListener('change', (event) => {
      const box = event.target as HTMLInputElement;
      if (!box.matches('.task-check[data-task-key]')) return;
      box.disabled = true;
      post({
        type: 'complete',
        key: decodeURIComponent(box.dataset.taskKey || ''),
        done: box.checked,
      });
    });
  }
  const order = readingOrder(tree);
  const ix = order.findIndex((n) => n.id === p.id);
  const pagerLink = (n: NavNode | undefined, label: string, cls: string) => {
    if (!n) return undefined;
    const b = h(
      'button',
      { type: 'button', class: `pager ${cls}`, 'aria-label': `${label}: ${n.title}` },
      svg(cls === 'prev' ? 'arrowLeft' : 'arrowRight', 18),
      h('span', {}, h('small', { text: label }), h('span', { class: 'title', text: n.title })),
    );
    b.addEventListener('click', () => openWikiPage({ id: n.id }));
    return b;
  };
  const pager = h(
    'nav',
    { class: 'wiki-pager', 'aria-label': 'Previous and next page' },
    ix > 0 ? pagerLink(order[ix - 1], 'Previous', 'prev') : undefined,
    ix >= 0 && ix < order.length - 1 ? pagerLink(order[ix + 1], 'Next', 'next') : undefined,
  );
  const updated = p.modified
    ? h(
        'p',
        { class: 'wiki-updated', title: new Date(p.modified).toLocaleString() },
        svg('clock', 13),
        h('span', { text: `Last updated ${ago(p.modified)}` }),
      )
    : undefined;
  const backlinks = h(
    'footer',
    { class: 'wiki-backlinks' },
    h('h2', {}, svg('link', 13), h('span', { text: `Linked from · ${p.backlinks.length}` })),
    p.backlinks.length
      ? h(
          'ul',
          {},
          ...p.backlinks.map((b) => {
            const a = h('button', {
              type: 'button',
              class: 'chip-link',
              text: b.title,
              title: b.path,
            });
            a.addEventListener('click', () => openWikiPage({ id: b.id }));
            return h('li', {}, a);
          }),
        )
      : h('p', { class: 'muted small', text: 'No pages link here yet.' }),
  );
  const mentions = p.mentions.length
    ? h(
        'section',
        { class: 'wiki-mentions', 'aria-labelledby': 'wiki-mentions-head' },
        h(
          'h2',
          { id: 'wiki-mentions-head' },
          svg('unlink', 13),
          h('span', { text: `Unlinked mentions · ${p.mentions.length}` }),
        ),
        h(
          'ul',
          {},
          ...p.mentions.map((m) => {
            const open = h('button', {
              type: 'button',
              class: 'link',
              text: m.title,
              title: m.path,
            });
            open.addEventListener('click', () => openWikiPage({ id: m.id }));
            const link = button(
              'Link',
              () => {
                link.setAttribute('disabled', '');
                post({
                  type: 'linkMention',
                  id: m.id,
                  target: p.id,
                  offset: m.offset,
                  length: m.length,
                });
              },
              'btn small',
              'link',
              { title: `Turn “${p.title}” in ${m.title} into a link to this page` },
            );
            return h(
              'li',
              {},
              h('div', { class: 'mention-head' }, open, h('span', { class: 'spacer' }), link),
              h('p', { class: 'muted small', text: m.excerpt }),
            );
          }),
        ),
      )
    : undefined;
  const style = [p.font ? `--ws-font:${p.font}` : '', p.width ? `--ws-doc-width:${p.width}` : '']
    .filter(Boolean)
    .join(';');
  const notice = S().workspace.announcement
    ? h('div', { class: 'wiki-announcement', role: 'note' })
    : undefined;
  if (notice) {
    notice.innerHTML = S().workspace.announcement!;
    notice.addEventListener('click', onArticleClick);
  }
  return h(
    'div',
    { class: 'wiki-content', style: style || undefined },
    notice,
    head,
    article,
    updated,
    backlinks,
    mentions,
    pager,
  );
}

// Hovering a link to another page shows a preview card (title, status, summary, tags).
interface Preview {
  id: string;
  title: string;
  path: string;
  excerpt: string;
  status?: string;
  icon?: string;
  tags: string[];
}
const previews = new Map<string, Preview>();
let previewTimer = 0;
let previewFor: HTMLElement | undefined;
function hidePreview() {
  window.clearTimeout(previewTimer);
  previewFor = undefined;
  document.querySelector('.wiki-preview')?.remove();
}
function showPreview(anchor: HTMLElement, p: Preview) {
  if (previewFor !== anchor || !anchor.isConnected) return;
  document.querySelector('.wiki-preview')?.remove();
  const card = h(
    'div',
    { class: 'wiki-preview', role: 'tooltip' },
    h(
      'div',
      { class: 'preview-head' },
      pageIconEl(p.icon, 15),
      h('strong', { text: p.title }),
      statusBadge(p.status),
    ),
    h('p', { class: 'preview-path', text: p.path }),
    p.excerpt ? h('p', { text: p.excerpt }) : h('p', { class: 'muted', text: 'No text yet.' }),
    p.tags.length
      ? h('p', { class: 'preview-tags', text: p.tags.map((t) => `#${t}`).join(' ') })
      : undefined,
  );
  document.body.append(card);
  const r = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  card.style.width = `${width}px`;
  card.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`;
  const below = r.bottom + 8 + card.offsetHeight < window.innerHeight;
  card.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - card.offsetHeight - 6)}px`;
}
/** The host answered a preview request. */
export function receivePreview(p: Preview) {
  previews.set(p.id, p);
  if (previewFor?.dataset.previewId === p.id) showPreview(previewFor, p);
}
function wirePreviews(root: HTMLElement) {
  root.addEventListener('mouseover', (event) => {
    const a = (event.target as HTMLElement).closest?.('a[href^="#wiki:"]') as HTMLElement | null;
    if (!a || a === previewFor) return;
    hidePreview();
    const id = decodeURIComponent((a.getAttribute('href') || '').slice(6).split('?')[0]);
    if (!id || id === page?.id) return;
    previewFor = a;
    a.dataset.previewId = id;
    previewTimer = window.setTimeout(() => {
      const known = previews.get(id);
      if (known) showPreview(a, known);
      else post({ type: 'wikiPreview', id });
    }, 400);
  });
  root.addEventListener('mouseout', (event) => {
    const to = (event as MouseEvent).relatedTarget as Node | null;
    if (previewFor && (!to || !previewFor.contains(to))) hidePreview();
  });
  root.addEventListener('focusin', (event) => {
    const a = (event.target as HTMLElement).closest?.('a[href^="#wiki:"]');
    if (!a) hidePreview();
  });
}
window.addEventListener('scroll', hidePreview, { passive: true });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hidePreview();
});

/** The tag index: all tags with their page counts, or the pages of one tag. */
function tagsView(): HTMLElement {
  const tag = ui.wikiTags || '';
  const pages = allNodes(S().wiki.tree).filter((n) => n.id && n.kind !== 'file' && n.tags?.length);
  const counts = new Map<string, number>();
  for (const n of pages) for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const crumbs = h('nav', { class: 'wiki-crumbs', 'aria-label': 'Breadcrumb' });
  const all = h('button', { type: 'button', class: 'crumb', text: 'Tags' });
  all.addEventListener('click', () => showTags(''));
  crumbs.append(all);
  if (tag) crumbs.append(svg('chevronRight', 12), h('span', { text: `#${tag}` }));
  const cloud = h(
    'div',
    { class: 'tag-cloud' },
    ...tags.map(([t, n]) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'tag',
          'aria-pressed': String(t === tag),
        },
        h('span', { text: `#${t}` }),
        h('span', { class: 'count', text: String(n) }),
      );
      b.addEventListener('click', () => showTags(t === tag ? '' : t));
      return b;
    }),
  );
  const shown = tag ? pages.filter((n) => n.tags?.includes(tag)) : [];
  const list = tag
    ? h(
        'ul',
        { class: 'tag-pages' },
        ...shown.map((n) => {
          const b = h(
            'button',
            { type: 'button', class: 'tag-page' },
            pageIconEl(n.icon, 14) || svg(n.kind === 'section' ? 'folder' : 'file', 14),
            h('span', { class: 'title', text: n.title }),
            statusBadge(n.status),
            h('span', { class: 'muted small', text: n.path }),
          );
          b.addEventListener('click', () => openWikiPage({ id: n.id }));
          return h('li', {}, b);
        }),
      )
    : undefined;
  return h(
    'div',
    { class: 'wiki-content' },
    h('div', { class: 'wiki-head' }, crumbs),
    h(
      'article',
      { class: 'doc wiki-article' },
      h('h1', { text: tag ? `#${tag}` : 'Tags' }),
      h('p', {
        class: 'muted',
        text: tag
          ? `${shown.length} page${shown.length === 1 ? '' : 's'} tagged ${tag}.`
          : tags.length
            ? 'Every tag in the wiki. Choose one to see its pages.'
            : 'No page has tags yet. Add tags: [a, b] to a page’s front matter.',
      }),
      cloud,
      list,
    ),
  );
}

function outline(): HTMLElement | undefined {
  if (!page || page.headings.length < 2) return undefined;
  const list = h('ul', {});
  for (const heading of page.headings) {
    const a = h('a', {
      href: `#${heading.slug}`,
      class: `toc-${heading.level}`,
      'data-slug': heading.slug,
      text: heading.text,
    });
    a.addEventListener('click', (event) => {
      event.preventDefault();
      document.getElementById(heading.slug)?.scrollIntoView({ block: 'start' });
    });
    list.append(h('li', {}, a));
  }
  return h(
    'aside',
    { class: 'wiki-toc', 'aria-label': 'On this page' },
    h('strong', { text: 'On this page' }),
    list,
  );
}

/** Marks the outline entry of the heading being read (the last one above the header's edge). */
function followOutline() {
  const toc = document.querySelector('.wiki-toc');
  if (!toc || !page) return;
  const edge = (parseInt(document.body.style.getPropertyValue('--top')) || 41) + 24;
  let at = page.headings[0]?.slug;
  for (const heading of page.headings) {
    const el = document.getElementById(heading.slug);
    if (el && el.getBoundingClientRect().top <= edge) at = heading.slug;
  }
  // At the end of the page the last heading may never reach the top.
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2)
    at = page.headings[page.headings.length - 1]?.slug;
  for (const a of Array.from(toc.querySelectorAll<HTMLElement>('a[data-slug]')))
    a.classList.toggle('active', a.dataset.slug === at);
}
let spying = false;
window.addEventListener('scroll', () => {
  if (spying) return;
  spying = true;
  requestAnimationFrame(() => {
    spying = false;
    followOutline();
  });
});

export function wikiView(): HTMLElement {
  if (ui.wikiTags !== undefined)
    return h(
      'div',
      { class: `wiki${ui.wikiNavHidden ? ' nav-hidden' : ''}` },
      sidebar(),
      tagsView(),
      h('div', { class: 'wiki-toc' }),
    );
  const toc = outline();
  if (toc) requestAnimationFrame(followOutline);
  return h(
    'div',
    { class: `wiki${toc ? '' : ' no-toc'}${ui.wikiNavHidden ? ' nav-hidden' : ''}` },
    sidebar(),
    content(),
    // Without an outline its column stays empty, so pages keep their place.
    toc || h('div', { class: 'wiki-toc' }),
  );
}

/** Shows or hides the page tree (narrow panels and reading). */
export function toggleWikiNav() {
  ui.wikiNavHidden = !ui.wikiNavHidden;
  save();
  store.render();
}
export const wikiNavHidden = () => !!ui.wikiNavHidden;

/** Expands a section in the tree (host commands) or puts the cursor in the page filter. */
export function revealInWiki(section?: string, filter?: boolean) {
  if (section) revealPath(section);
  store.render();
  if (filter) document.getElementById('wiki-filter')?.focus();
  else if (section)
    document
      .querySelector<HTMLElement>(
        `.wiki-node.section[data-path="${CSS.escape(section)}"] .wiki-link`,
      )
      ?.focus();
}

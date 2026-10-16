import { galleryCategories, GalleryEntry, searchGallery } from './core/block-gallery';
import { componentFields, ComponentField, readProps, writeProps } from './core/component-props';
import type { IconName } from './core/icons';

type H = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, string | boolean | undefined>,
  ...children: Array<Node | string | undefined>
) => HTMLElementTagNameMap[K];

export interface GalleryContext {
  h: H;
  svg: (name: IconName, size?: number) => SVGElement;
  post: (message: unknown) => void;
  renderSnippet: (source: string, inline: boolean, done: (html: string) => void) => void;
  /** Inserts the entry at the editor's selection. */
  insert: (entry: GalleryEntry) => void;
  available: (command: string) => boolean;
}

/**
 * Block Gallery: every insertable block with a live preview rendered by the reader's renderer,
 * search, categories and keyboard insertion (arrows, Enter, Escape).
 */
export function createBlockGallery(ctx: GalleryContext) {
  const { h } = ctx;
  let category = '';
  let selected = 0;
  let shown: GalleryEntry[] = [];
  let returnFocus: HTMLElement | null = null;
  const search = h('input', {
    type: 'search',
    class: 'gallery-search',
    placeholder: 'Search blocks',
    'aria-label': 'Search blocks',
    'aria-controls': 'gallery-grid',
    autocomplete: 'off',
  });
  const close = h(
    'button',
    {
      type: 'button',
      class: 'tb gallery-close',
      'aria-label': 'Close gallery',
      title: 'Close (Escape)',
    },
    h('span', { text: '×', 'aria-hidden': 'true' }),
  );
  const cats = h('div', { class: 'gallery-cats', role: 'group', 'aria-label': 'Categories' });
  const grid = h('div', {
    class: 'gallery-grid',
    id: 'gallery-grid',
    role: 'listbox',
    'aria-label': 'Blocks',
  });
  const status = h('p', { class: 'gallery-status', role: 'status' });
  const dialog = h(
    'div',
    { class: 'gallery', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gallery-title' },
    h(
      'div',
      { class: 'gallery-head' },
      h('h2', { id: 'gallery-title', text: 'Block gallery' }),
      search,
      close,
    ),
    h('div', { class: 'gallery-body' }, cats, h('div', { class: 'gallery-main' }, status, grid)),
    h('p', { class: 'gallery-keys', text: '↑ ↓ ← → choose · Enter insert · Esc close' }),
  );
  const backdrop = h('div', { class: 'gallery-backdrop', hidden: true }, dialog);
  document.body.append(backdrop);

  const renderCats = () => {
    cats.replaceChildren(
      ...['', ...galleryCategories].map((c) => {
        const b = h('button', {
          type: 'button',
          class: 'gallery-cat',
          'aria-pressed': String(c === category),
          text: c || 'All blocks',
        });
        b.addEventListener('click', () => {
          category = c;
          selected = 0;
          renderCats();
          renderGrid();
          search.focus();
        });
        return b;
      }),
    );
  };
  const renderGrid = () => {
    shown = searchGallery(search.value).filter(
      (e) => (!category || e.category === category) && ctx.available(e.command),
    );
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    status.textContent = shown.length
      ? `${shown.length} block${shown.length === 1 ? '' : 's'}`
      : 'No block matches.';
    grid.replaceChildren(
      ...shown.map((entry, i) => {
        // Previews are pictures: inert, so nothing inside is focusable, clickable or announced.
        const preview = h('div', {
          class: 'gallery-preview doc',
          'aria-hidden': 'true',
          inert: true,
        });
        if (entry.sample) {
          preview.classList.add('pending');
          ctx.renderSnippet(entry.sample, false, (html) => {
            preview.classList.remove('pending');
            preview.innerHTML = html;
          });
        } else
          preview.append(
            h('p', {
              class: 'gallery-pick',
              text: 'Choose a file after inserting; the preview shows its real content.',
            }),
          );
        const card = h(
          'button',
          {
            type: 'button',
            class: 'gallery-card',
            role: 'option',
            id: `gallery-${entry.id}`,
            'data-id': entry.id,
            'aria-selected': String(i === selected),
            tabindex: '-1',
          },
          preview,
          h('span', { class: 'gallery-label', text: entry.label }),
          h('span', { class: 'gallery-desc', text: entry.description }),
        );
        card.addEventListener('click', () => choose(i));
        card.addEventListener('mousemove', () => select(i, false));
        return card;
      }),
    );
    syncSelection(false);
  };
  const columns = () => {
    const first = grid.querySelector<HTMLElement>('.gallery-card');
    if (!first) return 1;
    return Math.max(1, Math.round(grid.clientWidth / (first.offsetWidth + 12)));
  };
  const syncSelection = (scroll = true) => {
    grid
      .querySelectorAll('.gallery-card')
      .forEach((el, i) => el.setAttribute('aria-selected', String(i === selected)));
    const current = grid.children[selected] as HTMLElement | undefined;
    if (current) {
      search.setAttribute('aria-activedescendant', current.id);
      if (scroll) current.scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  };
  const select = (i: number, scroll = true) => {
    if (!shown.length) return;
    selected = Math.max(0, Math.min(shown.length - 1, i));
    syncSelection(scroll);
  };
  const choose = (i: number) => {
    const entry = shown[i];
    if (!entry) return;
    hide(false);
    ctx.insert(entry);
  };
  const hide = (restore = true) => {
    backdrop.hidden = true;
    if (restore) returnFocus?.focus();
  };
  search.addEventListener('input', () => {
    selected = 0;
    renderGrid();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (
      e.key === 'Enter' &&
      (e.target === search || (e.target as HTMLElement).classList.contains('gallery-card'))
    ) {
      e.preventDefault();
      choose(selected);
    } else if (
      ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) &&
      !(e.target as HTMLElement).classList.contains('gallery-cat')
    ) {
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target === search && search.value)
        return;
      e.preventDefault();
      const step = {
        ArrowDown: columns(),
        ArrowUp: -columns(),
        ArrowLeft: -1,
        ArrowRight: 1,
        Home: -shown.length,
        End: shown.length,
      }[e.key]!;
      select(selected + step);
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusable = [
        search,
        close,
        ...Array.from(cats.querySelectorAll<HTMLElement>('button')),
      ];
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      focusable[(index + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
    }
  });
  close.addEventListener('click', () => hide());
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) hide();
  });
  return {
    open(query = '') {
      returnFocus = document.activeElement as HTMLElement | null;
      search.value = query;
      category = '';
      selected = 0;
      renderCats();
      renderGrid();
      backdrop.hidden = false;
      search.focus();
    },
    get isOpen() {
      return !backdrop.hidden;
    },
  };
}

export interface InspectorContext {
  h: H;
  post: (message: unknown) => void;
}

/**
 * Block inspector for fenced components: a small form anchored to the block's header. Applying
 * rewrites only the option lines that changed (see core/component-props).
 */
export function createInspector(ctx: InspectorContext) {
  const { h } = ctx;
  const popover = h('div', {
    class: 'inspector',
    role: 'dialog',
    'aria-label': 'Block properties',
    hidden: true,
  });
  document.body.append(popover);
  let pathRequest = 0;
  const pathWaiters = new Map<number, (path: string) => void>();
  let anchor: HTMLElement | null = null;
  const hide = () => {
    popover.hidden = true;
    anchor?.focus();
    anchor = null;
  };
  popover.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (
      !popover.hidden &&
      !popover.contains(e.target as Node) &&
      e.target !== anchor &&
      !anchor?.contains(e.target as Node)
    )
      hide();
  });
  const field = (f: ComponentField, value: string, language: string) => {
    const id = `insp-${f.key}`;
    let input: HTMLInputElement | HTMLSelectElement;
    if (f.kind === 'select') {
      input = h(
        'select',
        { id, 'data-key': f.key },
        h('option', { value: '', text: '—' }),
        ...f.options!.map((o) => h('option', { value: o, text: o })),
      );
      if (value && !f.options!.includes(value)) input.append(h('option', { value, text: value }));
      input.value = value;
    } else {
      input = h('input', {
        id,
        'data-key': f.key,
        type: f.kind === 'number' ? 'number' : 'text',
        placeholder: f.placeholder,
        value,
        spellcheck: 'false',
      });
    }
    const row = h('div', { class: 'insp-row' }, h('label', { for: id, text: f.label }), input);
    if (f.kind === 'path') {
      const browse = h('button', { type: 'button', class: 'btn', text: 'Browse…' });
      browse.addEventListener('click', () => {
        const id = ++pathRequest;
        pathWaiters.set(id, (path) => {
          (input as HTMLInputElement).value = path;
          input.focus();
        });
        ctx.post({
          type: 'pickComponentPath',
          requestId: id,
          language,
          key: f.key,
          extensions: f.extensions || [],
        });
      });
      row.append(browse);
    }
    if (f.help) row.append(h('small', { text: f.help }));
    return row;
  };
  return {
    supports: (language: string) => language in componentFields,
    open(target: HTMLElement, language: string, source: string, apply: (next: string) => void) {
      anchor = target;
      const fields = componentFields[language];
      const props = readProps(source);
      const form = h('form', {});
      form.append(
        h('h3', { text: `${language} properties` }),
        ...fields.map((f) => field(f, props[f.key] ?? '', language)),
      );
      const unknown = Object.keys(props).filter((k) => !fields.some((f) => f.key === k));
      if (unknown.length)
        form.append(
          h('p', {
            class: 'insp-note',
            text: `Also set in the source: ${unknown.join(', ')} (kept as written).`,
          }),
        );
      const cancel = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
      cancel.addEventListener('click', hide);
      form.append(
        h(
          'div',
          { class: 'insp-actions' },
          cancel,
          h('button', { type: 'submit', class: 'btn primary', text: 'Apply' }),
        ),
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const changes: Record<string, string> = {};
        form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach((el) => {
          const key = el.dataset.key!;
          if ((props[key] ?? '') !== el.value.trim()) changes[key] = el.value.trim();
        });
        if (Object.keys(changes).length) apply(writeProps(source, changes));
        hide();
      });
      popover.replaceChildren(form);
      popover.hidden = false;
      const r = target.getBoundingClientRect();
      const below = r.bottom + 6 + popover.offsetHeight < window.innerHeight;
      popover.style.top = `${Math.max(8, below ? r.bottom + 6 : r.top - popover.offsetHeight - 6)}px`;
      popover.style.left = `${Math.max(8, Math.min(r.right - popover.offsetWidth, window.innerWidth - popover.offsetWidth - 8))}px`;
      form.querySelector<HTMLElement>('[data-key]')?.focus();
    },
    pathPicked(requestId: number, path: string) {
      pathWaiters.get(requestId)?.(path);
      pathWaiters.delete(requestId);
    },
  };
}

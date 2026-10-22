// The template gallery: every template (built in and the wiki's .templates folder) with a
// rendered preview; choosing one and a title creates the page and opens it.
import { dialog, field, h, post } from './core';

interface TemplateItem {
  label: string;
  description: string;
  preview: string;
}
let waiting: { prefix?: string } | undefined;

/** Asks the host for the templates; the gallery opens when they arrive. */
export function openTemplateGallery(prefix?: string) {
  waiting = { prefix };
  post({ type: 'templates' });
}

export function receiveTemplates(items: TemplateItem[]) {
  if (!waiting || !items.length) return;
  const { prefix } = waiting;
  waiting = undefined;
  let chosen = items[0];
  const preview = h('div', { class: 'doc template-preview', 'aria-live': 'polite' });
  const list = h('div', { class: 'template-list', role: 'radiogroup', 'aria-label': 'Template' });
  const show = (item: TemplateItem) => {
    chosen = item;
    preview.innerHTML = item.preview;
    for (const b of Array.from(list.children))
      b.setAttribute('aria-checked', String((b as HTMLElement).dataset.label === item.label));
  };
  items.forEach((item, i) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'template-item',
        role: 'radio',
        'data-label': item.label,
        tabindex: i ? '-1' : '0',
      },
      h('strong', { text: item.label }),
      h('span', { class: 'muted small', text: item.description }),
    );
    b.addEventListener('click', () => show(item));
    b.addEventListener('keydown', (e) => {
      const buttons = Array.from(list.children) as HTMLElement[];
      const at = buttons.indexOf(b);
      const next =
        e.key === 'ArrowDown' ? buttons[at + 1] : e.key === 'ArrowUp' ? buttons[at - 1] : undefined;
      if (next) {
        e.preventDefault();
        next.focus();
        next.click();
      }
    });
    list.append(b);
  });
  const title = h('input', { class: 'field', required: true, placeholder: 'Page title' });
  dialog(
    'New page from a template',
    [
      h('div', { class: 'template-gallery' }, list, preview),
      field('Title', title, prefix ? `Created in ${prefix}` : undefined),
    ],
    'Create',
    () => {
      if (!title.value.trim()) {
        title.reportValidity();
        return false;
      }
      post({ type: 'templateCreate', name: chosen.label, title: title.value.trim(), prefix });
    },
  );
  document.querySelector('.modal')?.classList.add('wide');
  show(chosen);
  title.focus();
}

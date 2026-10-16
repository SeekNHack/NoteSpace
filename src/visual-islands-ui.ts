import { Editor, JSONContent } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { BlockIsland, InlineIsland } from './visual-islands';
import { IconName } from './core/icons';

type Props = Record<string, string | boolean | undefined>;
export interface IslandContext {
  post(message: unknown): void;
  editor(): Editor;
  blocked(): boolean;
  h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props?: Props,
    ...children: Array<Node | string | undefined>
  ): HTMLElementTagNameMap[K];
  svg(name: IconName, size?: number): SVGElement;
  place(el: HTMLElement, rect: { left: number; top: number; bottom: number }): void;
  hideHovercard(): void;
  root: HTMLElement;
  isMac: boolean;
}

export const islandLabels: Record<string, string> = {
  keys: 'Keyboard keys',
  math: 'Math',
  badge: 'Badge',
  button: 'Button',
  tip: 'Tooltip',
  icon: 'Icon',
  emoji: 'Emoji',
  footnote: 'Footnote',
  reflink: 'Reference link',
  html: 'HTML',
  media: 'Media embed',
  include: 'Include',
  abbr: 'Abbreviation',
  refdef: 'Link reference',
  deflist: 'Definition list',
  container: 'Container (source)',
};
/** Kinds whose source is clearer than a rendering (the reader escapes or relocates them). */
const sourceOnly = new Set(['html', 'refdef', 'abbr', 'footnote', 'container', 'reflink']);

/**
 * Studio views for source islands: inline chips and block previews rendered by the reader's
 * renderer, with in-place source editing. Edited source is parsed again, so it may turn into
 * ordinary Studio content or another island; nothing is ever dropped.
 */
export function createIslandViews(ctx: IslandContext) {
  const { h } = ctx;
  const snippetHtml = new Map<string, string>();
  const waiting = new Map<string, Array<(html: string) => void>>();
  let sequence = 0;
  const renderSnippet = (source: string, inline: boolean, done: (html: string) => void) => {
    const key = `${inline ? 'i' : 'b'}:${source}`;
    const cached = snippetHtml.get(key);
    if (cached !== undefined) return done(cached);
    const queue = waiting.get(key);
    if (queue) return void queue.push(done);
    waiting.set(key, [done]);
    ctx.post({ type: 'renderSnippet', id: `${++sequence}`, key, source, inline });
  };
  const handleSnippet = (key: string, html: string) => {
    snippetHtml.set(key, html);
    for (const done of waiting.get(key) || []) done(html);
    waiting.delete(key);
  };

  const replaceIsland = (pos: number, size: number, source: string, inline: boolean) => {
    const editor = ctx.editor();
    if (!source.trim()) {
      editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + size })
        .run();
      return;
    }
    const json = editor.markdown!.parse(source) as JSONContent;
    let content = json.content || [];
    if (inline) {
      const first = content[0];
      content =
        content.length === 1 && first?.type === 'paragraph'
          ? first.content || []
          : [{ type: 'text', text: source.replace(/\s*\n\s*/g, ' ') }];
    }
    const before = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + size }, content)
      .run();
    // Leave a text caret after the edited content; a lingering node selection would let the next
    // keystroke replace the island.
    const end = Math.min(
      pos + size + (editor.state.doc.content.size - before),
      editor.state.doc.content.size,
    );
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.near(editor.state.doc.resolve(end), 1))
        .scrollIntoView(),
    );
  };

  // Inline source editor.
  const input = h('input', { type: 'text', 'aria-label': 'Markdown source', spellcheck: 'false' });
  const hint = h('div', { class: 'hint' });
  const box = h(
    'div',
    {
      class: 'float linkbox sourcebox',
      role: 'dialog',
      'aria-label': 'Edit Markdown source',
      hidden: true,
    },
    h('div', { class: 'row' }, input),
    hint,
  );
  ctx.root.append(box);
  let target: { pos: number; size: number } | undefined;
  const openInline = (pos: number, size: number, source: string, kind: string, anchor: DOMRect) => {
    if (ctx.blocked()) return;
    target = { pos, size };
    input.value = source;
    hint.textContent = `${islandLabels[kind] || 'Markdown'} · Enter to apply · Esc to cancel`;
    ctx.hideHovercard();
    ctx.place(box, anchor);
    input.focus();
    input.select();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const current = target;
      box.hidden = true;
      target = undefined;
      if (current) replaceIsland(current.pos, current.size, input.value, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      box.hidden = true;
      target = undefined;
      ctx.editor().commands.focus();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));

  const openSelected = (editor: Editor, name: string): boolean => {
    const selection = editor.state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return false;
    const dom = editor.view.nodeDOM(selection.from);
    if (!(dom instanceof HTMLElement)) return false;
    if (name === 'inlineIsland')
      openInline(
        selection.from,
        selection.node.nodeSize,
        String(selection.node.attrs.source),
        String(selection.node.attrs.kind),
        dom.getBoundingClientRect(),
      );
    else dom.querySelector<HTMLButtonElement>('.island-head .tb')?.click();
    return true;
  };

  const StudioInlineIsland = InlineIsland.extend({
    addNodeView() {
      return ({ node, getPos }) => {
        let current = node;
        const dom = h('span', { class: 'island', contenteditable: 'false' });
        const render = () => {
          const kind = String(current.attrs.kind);
          const source = String(current.attrs.source);
          dom.dataset.island = kind;
          dom.title = `${islandLabels[kind] || 'Markdown'} · double-click to edit the source`;
          dom.setAttribute('aria-label', `${islandLabels[kind] || 'Markdown'}: ${source}`);
          if (sourceOnly.has(kind) || kind === 'media') {
            dom.classList.add('as-source');
            dom.textContent =
              kind === 'media'
                ? `▶ ${/^!\[([^\]]*)\]/.exec(source)?.[1] || 'Media'}`
                : kind === 'footnote'
                  ? `[${source.slice(2, -1)}]`
                  : source;
            return;
          }
          dom.classList.remove('as-source');
          dom.textContent = source;
          renderSnippet(source, true, (html) => {
            if (String(current.attrs.source) !== source) return;
            if (html.trim()) dom.innerHTML = html;
          });
        };
        render();
        dom.addEventListener('dblclick', (event) => {
          event.preventDefault();
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos !== undefined)
            openInline(
              pos,
              current.nodeSize,
              String(current.attrs.source),
              String(current.attrs.kind),
              dom.getBoundingClientRect(),
            );
        });
        return {
          dom,
          update(next: PMNode) {
            if (next.type !== current.type) return false;
            const changed = next.attrs.source !== current.attrs.source;
            current = next;
            if (changed) render();
            return true;
          },
          selectNode: () => dom.classList.add('selected'),
          deselectNode: () => dom.classList.remove('selected'),
          ignoreMutation: () => true,
          stopEvent: (event: Event) => event.type === 'dblclick',
        };
      };
    },
    addKeyboardShortcuts() {
      return { Enter: () => openSelected(this.editor, this.name) };
    },
  });

  const StudioBlockIsland = BlockIsland.extend({
    addNodeView() {
      return ({ node, getPos }) => {
        let current = node;
        const label = h('span', { class: 'island-label' });
        const editButton = h('button', { type: 'button', class: 'tb text', text: 'Edit source' });
        const head = h(
          'div',
          { class: 'island-head' },
          ctx.svg('rawSource', 14),
          label,
          h('span', { class: 'spacer' }),
          editButton,
        );
        const preview = h('div', { class: 'island-preview' });
        const textarea = h('textarea', {
          'aria-label': 'Markdown source',
          spellcheck: 'false',
          rows: '4',
        });
        const apply = h('button', { type: 'button', class: 'btn primary', text: 'Apply' });
        const cancel = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
        const tip = h('span', {
          class: 'hint',
          text: `${ctx.isMac ? '⌘' : 'Ctrl'}+Enter to apply · Esc to cancel`,
        });
        const editorBox = h(
          'div',
          { class: 'island-editor', hidden: true },
          textarea,
          h('div', { class: 'row' }, tip, h('span', { class: 'spacer' }), cancel, apply),
        );
        const dom = h(
          'div',
          { class: 'island-block', contenteditable: 'false' },
          head,
          preview,
          editorBox,
        );
        const render = () => {
          const kind = String(current.attrs.kind);
          const source = String(current.attrs.source);
          dom.dataset.island = kind;
          label.textContent = islandLabels[kind] || 'Markdown source';
          if (sourceOnly.has(kind)) {
            preview.replaceChildren(h('pre', { class: 'island-source', text: source }));
            return;
          }
          preview.replaceChildren(h('pre', { class: 'island-source pending', text: source }));
          renderSnippet(source, false, (html) => {
            if (String(current.attrs.source) === source && html.trim()) preview.innerHTML = html;
          });
        };
        const open = () => {
          if (ctx.blocked()) return;
          textarea.value = String(current.attrs.source);
          textarea.rows = Math.min(18, Math.max(3, textarea.value.split('\n').length + 1));
          editorBox.hidden = false;
          preview.hidden = true;
          editButton.hidden = true;
          textarea.focus();
        };
        const close = () => {
          editorBox.hidden = true;
          preview.hidden = false;
          editButton.hidden = false;
        };
        const commit = () => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          const value = textarea.value.replace(/\s+$/, '');
          close();
          if (pos !== undefined && value !== current.attrs.source)
            replaceIsland(pos, current.nodeSize, value, false);
        };
        editButton.addEventListener('click', open);
        dom.addEventListener('dblclick', (event) => {
          if (!editorBox.contains(event.target as globalThis.Node)) open();
        });
        apply.addEventListener('click', commit);
        cancel.addEventListener('click', () => {
          close();
          ctx.editor().commands.focus();
        });
        textarea.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
            ctx.editor().commands.focus();
          }
        });
        render();
        return {
          dom,
          update(next: PMNode) {
            if (next.type !== current.type) return false;
            const changed = next.attrs.source !== current.attrs.source;
            current = next;
            if (changed) render();
            return true;
          },
          selectNode: () => dom.classList.add('selected'),
          deselectNode: () => dom.classList.remove('selected'),
          stopEvent: (event: Event) =>
            event.target !== dom && dom.contains(event.target as globalThis.Node),
          ignoreMutation: () => true,
        };
      };
    },
    addKeyboardShortcuts() {
      return { Enter: () => openSelected(this.editor, this.name) };
    },
  });

  /** Opens the source editor of the island at `pos` after it renders. */
  const editAt = (pos: number) =>
    requestAnimationFrame(() => {
      const editor = ctx.editor();
      const dom = editor.view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return;
      const node = editor.state.doc.nodeAt(pos);
      if (node?.type.name === 'inlineIsland')
        openInline(
          pos,
          node.nodeSize,
          String(node.attrs.source),
          String(node.attrs.kind),
          dom.getBoundingClientRect(),
        );
      else dom.querySelector<HTMLButtonElement>('.island-head .tb')?.click();
    });

  return { StudioInlineIsland, StudioBlockIsland, handleSnippet, editAt, renderSnippet };
}

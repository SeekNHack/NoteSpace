import { Editor, JSONContent, NodeViewRendererProps } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { Node as PMNode, Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
  Callout,
  RichContainer,
  SafeCodeBlock,
  lowlight,
  visualExtensions,
} from './visual-markdown';
import { VisualActionQueue } from './core/visual-actions';
import { closeHistory } from '@tiptap/pm/history';
import { blockColors, calloutKinds, defaultBlockColor, layoutKinds } from './core/rich-blocks';
import { icon, IconName } from './core/icons';
import { studioBody } from './visual-merge';
import { createIslandViews } from './visual-islands-ui';
import { createBlockGallery, createInspector } from './visual-gallery-ui';
import { wireHttpBlocks } from './http-block-ui';
import { wireTaskBoards } from './task-board-ui';
import { TaskTokens } from './visual-tasks';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
};
interface ViewState {
  selection?: number;
  scroll?: number;
}
interface Context {
  wiki: string;
  folders: string[];
  title: string;
  path: string;
  backlinks: number;
  mode: 'studio' | 'split';
  runners?: Record<string, string>;
}
const vscode = acquireVsCodeApi();
const viewState: ViewState = vscode.getState() || {};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';
const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string | undefined>
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'html') element.innerHTML = String(value);
    else if (key === 'text') element.textContent = String(value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child !== undefined) element.append(child);
  return element;
};
const svg = (name: IconName, size = 16) => {
  const span = document.createElement('span');
  span.innerHTML = icon(name, size);
  return span.firstElementChild as SVGElement;
};
const label = (kind: string) => kind.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const slugOf = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
    .replace(/\s/g, '-');
const bodyOf = (source: string) => source.replace(/^(?:﻿)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');

// ---------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------
const app = document.getElementById('app')!;
const tbButton = (
  name: IconName,
  ariaLabel: string,
  run: () => void,
  shortcut?: string,
  extra: Record<string, string | boolean | undefined> = {},
) => {
  const button = h(
    'button',
    {
      type: 'button',
      class: 'tb',
      'aria-label': ariaLabel,
      title: shortcut ? `${ariaLabel} (${shortcut})` : ariaLabel,
      ...extra,
    },
    svg(name),
  );
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', run);
  return button;
};
const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Page location' });
const stateLabel = h('span', { class: 'label', id: 'state', text: 'Loading…' });
const sync = h('span', { class: 'sync', role: 'status', 'data-tone': 'busy' }, stateLabel);
const modeButton = (
  mode: 'studio' | 'source' | 'split',
  name: IconName,
  text: string,
  tip: string,
) => {
  const button = h(
    'button',
    {
      type: 'button',
      id: mode,
      'aria-pressed': String(mode === 'studio'),
      title: tip,
      'aria-label': text,
    },
    svg(name, 14),
    h('span', { class: 'label', text }),
  );
  button.addEventListener('click', () => requestMode(mode));
  return button;
};
const modes = h(
  'div',
  { class: 'segmented', role: 'group', 'aria-label': 'Editor mode' },
  modeButton('studio', 'studio', 'Studio', 'Visual editing'),
  modeButton('source', 'source', 'Code', 'Edit Markdown source in the native editor'),
  modeButton('split', 'split', 'Split', 'Studio and Markdown source side by side'),
);
const saveButton = tbButton('save', 'Save', () => requestAction('save'), `${mod}S`, { id: 'save' });
const moreButton = tbButton('more', 'Page actions', () => openPageMenu(moreButton));
const docbar = h('header', { class: 'docbar' }, crumbs, sync, modes, saveButton, moreButton);
const toolbarInner = h('div', { class: 'toolbar-inner' });
const toolbar = h(
  'div',
  { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
  toolbarInner,
);
const notice = h('div', { class: 'notice', role: 'alert', hidden: true });
const chrome = h('div', { class: 'chrome' }, docbar, toolbar, notice);
const editorHost = h('div', { id: 'editor', class: 'doc' });
const readonlyView = h('div', { class: 'doc readonly-view', hidden: true });
const handle = h('div', { class: 'handle', 'aria-hidden': 'true' });
const page = h('div', { class: 'page' }, handle, editorHost, readonlyView);
const canvas = h('main', { class: 'canvas' }, page);
const bubble = h('div', {
  class: 'float bubble',
  role: 'toolbar',
  'aria-label': 'Selection',
  hidden: true,
});
const menu = h('div', { class: 'float menu', role: 'listbox', hidden: true, id: 'menu' });
const linkbox = h('div', {
  class: 'float linkbox',
  role: 'dialog',
  'aria-label': 'Edit link',
  hidden: true,
});
const hovercard = h('div', { class: 'float hovercard', role: 'tooltip', hidden: true });
app.append(chrome, canvas, bubble, menu, linkbox, hovercard);

// ---------------------------------------------------------------------------------------------
// Editor schema with Studio node views
// ---------------------------------------------------------------------------------------------
const imageUrls: Record<string, string> = {};
const WikiImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      { ...HTMLAttributes, src: imageUrls[String(HTMLAttributes.src)] || HTMLAttributes.src },
    ];
  },
});

// ---------------------------------------------------------------------------------------------
// Block color picker: one anchored popover shared by every block header
// ---------------------------------------------------------------------------------------------
/** Block headers re-render when the editor switches between read-only and editable. */
const headerRenders = new Set<() => void>();
const colorPopover = h('div', {
  class: 'color-popover',
  role: 'dialog',
  'aria-label': 'Block color',
  hidden: true,
});
app.append(colorPopover);
let closeColorPopover: (() => void) | undefined;
function openColorPicker(
  anchor: HTMLElement,
  kind: string,
  current: string | null,
  choose: (color: string | null) => void,
) {
  closeColorPopover?.();
  const fallback = defaultBlockColor(kind);
  const selected = current || fallback;
  const group = h('div', {
    class: 'swatches',
    role: 'radiogroup',
    'aria-label': `Color for this ${label(kind)} block`,
  });
  const radios = blockColors.map((color) => {
    const radio = h('button', {
      type: 'button',
      role: 'radio',
      class: 'swatch',
      'data-color': color,
      'aria-checked': String(color === selected),
      tabindex: color === selected ? '0' : '-1',
      title: `${label(color)}${color === fallback ? ' (default)' : ''}`,
      'aria-label': `${label(color)}${color === fallback ? ', default for this block' : ''}`,
    });
    radio.addEventListener('click', () => {
      // Picking the default color stores no override.
      choose(color === fallback ? null : color);
      close(true);
    });
    return radio;
  });
  group.append(...radios);
  const reset = h('button', {
    type: 'button',
    class: 'reset',
    text: `Use default color (${label(fallback)})`,
  });
  reset.disabled = !current;
  reset.addEventListener('click', () => {
    choose(null);
    close(true);
  });
  colorPopover.replaceChildren(group, reset);
  colorPopover.hidden = false;
  const rect = anchor.getBoundingClientRect();
  colorPopover.style.top = `${Math.round(rect.bottom + 6 + window.scrollY)}px`;
  colorPopover.style.left = `${Math.round(Math.max(8, Math.min(rect.left - 8, window.innerWidth - colorPopover.offsetWidth - 8)) + window.scrollX)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  group.addEventListener('keydown', (event) => {
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (move !== undefined && index >= 0) {
      event.preventDefault();
      const next = radios[(index + move + radios.length) % radios.length];
      radios.forEach((r) => r.setAttribute('tabindex', r === next ? '0' : '-1'));
      next.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      radios[event.key === 'Home' ? 0 : radios.length - 1].focus();
    }
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };
  const onPointer = (event: MouseEvent) => {
    if (!colorPopover.contains(event.target as globalThis.Node) && event.target !== anchor)
      close(false);
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onPointer, true);
  function close(restoreFocus: boolean) {
    colorPopover.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onPointer, true);
    closeColorPopover = undefined;
    if (restoreFocus) anchor.focus();
  }
  closeColorPopover = () => close(false);
  (radios.find((r) => r.getAttribute('tabindex') === '0') || radios[0]).focus();
}

/** Shared header for callouts and layout containers: type, inline title and collapse state. */
function containerView(kindAttr: 'type' | 'kind', kinds: readonly string[], isCallout: boolean) {
  return ({ node, editor, getPos }: NodeViewRendererProps) => {
    let current = node;
    const dom = h(isCallout ? 'aside' : 'section', {});
    const iconBox = h('span', { class: 'callout-icon', 'aria-hidden': 'true' });
    const select = h('select', {
      'aria-label': isCallout ? 'Callout type' : 'Block type',
      title: 'Change type',
    });
    for (const kind of kinds) select.append(h('option', { value: kind, text: label(kind) }));
    const title = h('input', {
      type: 'text',
      'aria-label': 'Block title',
      placeholder: 'Add a title',
      maxlength: '160',
      spellcheck: 'true',
    });
    const collapse = tbButton('chevron', 'Collapsed by default', () => {
      update({ collapsed: !current.attrs.collapsed });
    });
    collapse.classList.add('collapse');
    // tabindex: inside the editable document Chrome only moves focus to explicitly focusable controls.
    const colorDot = h('button', {
      type: 'button',
      class: 'color-dot',
      tabindex: '0',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    });
    colorDot.addEventListener('mousedown', (event) => event.preventDefault());
    // The editor handles Enter and Space itself; open the picker before it does.
    colorDot.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      colorDot.click();
    });
    colorDot.addEventListener('click', () => {
      if (!editor.isEditable) return;
      if (colorDot.getAttribute('aria-expanded') === 'true') return closeColorPopover?.();
      openColorPicker(
        colorDot,
        String(current.attrs[kindAttr]),
        current.attrs.color || null,
        (color) => update({ color }),
      );
    });
    const head = h(
      'div',
      { class: 'callout-head', contenteditable: 'false' },
      ...(isCallout ? [iconBox] : []),
      select,
      title,
      colorDot,
      collapse,
    );
    const content = h('div', { class: 'rich-content' });
    dom.append(head, content);
    const update = (attrs: Record<string, unknown>) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined || !editor.isEditable) return;
      // Header changes (type, color, collapse) are their own undo steps, never merged with
      // the insertion or typing that came before.
      editor.view.dispatch(
        closeHistory(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs })),
      );
    };
    select.addEventListener('change', () => update({ [kindAttr]: select.value }));
    title.addEventListener('input', () => update({ title: title.value.replace(/[\r\n]/g, ' ') }));
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'ArrowDown') {
        event.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos !== undefined)
          editor
            .chain()
            .focus()
            .setTextSelection(pos + 2)
            .run();
      }
    });
    const render = () => {
      const kind = String(current.attrs[kindAttr]);
      dom.className = isCallout ? `callout ${kind}` : `rich-block rich-${kind}`;
      dom.setAttribute(isCallout ? 'data-callout' : 'data-rich', kind);
      dom.setAttribute('data-title', current.attrs.title || '');
      dom.setAttribute('data-collapsed', String(!!current.attrs.collapsed));
      if (current.attrs.color) dom.setAttribute('data-color', current.attrs.color);
      else dom.removeAttribute('data-color');
      const shown = current.attrs.color || defaultBlockColor(kind);
      colorDot.setAttribute(
        'aria-label',
        `Block color: ${label(shown)}${current.attrs.color ? '' : ' (default)'}. Change color`,
      );
      colorDot.title = `Color: ${label(shown)}${current.attrs.color ? '' : ' (default)'}`;
      if (select.value !== kind) select.value = kind;
      if (document.activeElement !== title) title.value = current.attrs.title || '';
      title.placeholder = isCallout ? 'Add a title' : `${label(kind)} title`;
      collapse.setAttribute('aria-pressed', String(!current.attrs.collapsed));
      collapse.title = current.attrs.collapsed
        ? 'Collapsed when published. Click to show expanded.'
        : 'Expanded when published. Click to collapse by default.';
      select.disabled = title.disabled = collapse.disabled = colorDot.disabled = !editor.isEditable;
    };
    render();
    headerRenders.add(render);
    return {
      dom,
      contentDOM: content,
      update(next: PMNode) {
        if (next.type !== current.type) return false;
        current = next;
        render();
        return true;
      },
      destroy: () => headerRenders.delete(render),
      stopEvent: (event: Event) => head.contains(event.target as globalThis.Node),
      ignoreMutation: (mutation: { type: string; target: globalThis.Node }) =>
        mutation.type !== 'selection' &&
        ((mutation.type === 'attributes' && mutation.target === dom) ||
          head.contains(mutation.target)),
    };
  };
}

const languages = [
  '',
  'bash',
  'canvas',
  'chart',
  'dashboard',
  'collection',
  'css',
  'html',
  'javascript',
  'json',
  'markdown',
  'mermaid',
  'notebook',
  'openapi',
  'python',
  'tasks',
  'typescript',
  'yaml',
];
const codeViews = new Set<{ pos: () => number | undefined; size: () => number; el: HTMLElement }>();
const diagramWaiters = new Map<string, (m: { svg?: string; error?: string }) => void>();
interface RunMessage {
  cancelled?: boolean;
  error?: string;
  result?: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    runtime: string;
  };
}
const runWaiters = new Map<string, (m: RunMessage) => void>();
let diagramSeq = 0;
const inspector = createInspector({ h, post: (message) => vscode.postMessage(message) });
wireHttpBlocks((message) => vscode.postMessage(message));
wireTaskBoards((message) => vscode.postMessage(message));

const StudioCodeBlock = SafeCodeBlock.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const select = h('select', { 'aria-label': 'Code language', title: 'Language' });
      for (const lang of languages)
        select.append(h('option', { value: lang, text: lang ? label(lang) : 'Plain text' }));
      // Component options (chart type, data file, dashboard widget…) as a small form.
      const props = tbButton('sliders', 'Block properties', () => {
        const language = current.attrs.language || '';
        if (!inspector.supports(language) || !editor.isEditable) return;
        inspector.open(props, language, current.textContent, (next) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined) return;
          const { tr, schema } = editor.state;
          tr.replaceWith(
            pos + 1,
            pos + current.nodeSize - 1,
            next ? schema.text(next) : Fragment.empty,
          );
          editor.view.dispatch(tr);
        });
      });
      const copy = tbButton('copy', 'Copy code', () => {
        void navigator.clipboard?.writeText(current.textContent).then(
          () => flash(copy, 'check'),
          () => undefined,
        );
      });
      const toggle = h('button', {
        type: 'button',
        class: 'tb text',
        title: 'Show or hide the diagram source',
      });
      toggle.addEventListener('mousedown', (e) => e.preventDefault());
      toggle.addEventListener('click', () => {
        dom.classList.toggle('show-source');
        renderToggle();
      });
      const exportSvg = h(
        'button',
        { type: 'button', class: 'tb text', title: 'Export the diagram as an SVG file' },
        'SVG',
      );
      exportSvg.addEventListener('mousedown', (e) => e.preventDefault());
      exportSvg.addEventListener('click', () =>
        vscode.postMessage({ type: 'exportDiagram', source: current.textContent }),
      );
      const zoom = h(
        'button',
        {
          type: 'button',
          class: 'tb text',
          title: 'Show the diagram at actual size (scroll to pan)',
        },
        '1:1',
      );
      zoom.addEventListener('mousedown', (e) => e.preventDefault());
      zoom.addEventListener('click', () => {
        const actual = diagram.classList.toggle('actual-size');
        zoom.textContent = actual ? 'Fit' : '1:1';
        zoom.title = actual
          ? 'Fit the diagram to the page width'
          : 'Show the diagram at actual size (scroll to pan)';
      });
      const runButton = h(
        'button',
        { type: 'button', class: 'tb text run', title: 'Run this block' },
        svg('play', 14),
        'Run',
      );
      runButton.addEventListener('mousedown', (e) => e.preventDefault());
      const runOutput = h('div', {
        class: 'run-output',
        contenteditable: 'false',
        hidden: true,
        'aria-live': 'polite',
      });
      runButton.addEventListener('click', () => {
        const id = `r${++diagramSeq}`;
        runOutput.hidden = false;
        runOutput.replaceChildren(h('div', { class: 'run-meta', text: 'Running…' }));
        runWaiters.set(id, (m) => {
          runOutput.replaceChildren();
          if (m.cancelled) {
            runOutput.hidden = true;
            return;
          }
          if (m.error) {
            runOutput.append(h('pre', { class: 'run-stderr', text: m.error }));
            return;
          }
          const r = m.result!;
          const insert = h('button', { type: 'button', class: 'btn', text: 'Insert output' });
          const clear = h('button', { type: 'button', class: 'btn ghost', text: 'Clear' });
          clear.addEventListener('click', () => (runOutput.hidden = true));
          insert.addEventListener('click', () => {
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (pos === undefined) return;
            const text =
              `${r.stdout}${r.stderr ? `${r.stdout && !r.stdout.endsWith('\n') ? '\n' : ''}${r.stderr}` : ''}`.replace(
                /\n$/,
                '',
              );
            editor
              .chain()
              .focus()
              .insertContentAt(pos + current.nodeSize, {
                type: 'codeBlock',
                attrs: { language: 'text' },
                content: text ? [{ type: 'text', text }] : [],
              })
              .run();
            runOutput.hidden = true;
          });
          runOutput.append(
            h('div', {
              class: 'run-meta',
              text: `${r.timedOut ? 'Timed out' : `Exit ${r.exitCode}`} · ${r.durationMs} ms · ${r.runtime}`,
            }),
          );
          if (r.stdout) runOutput.append(h('pre', { class: 'run-stdout', text: r.stdout }));
          if (r.stderr) runOutput.append(h('pre', { class: 'run-stderr', text: r.stderr }));
          if (!r.stdout && !r.stderr)
            runOutput.append(h('div', { class: 'run-meta', text: 'No output.' }));
          runOutput.append(h('div', { class: 'run-actions' }, insert, clear));
        });
        vscode.postMessage({
          type: 'runCode',
          id,
          language: current.attrs.language || '',
          code: current.textContent,
        });
      });
      const head = h(
        'div',
        { class: 'code-head', contenteditable: 'false' },
        runButton,
        select,
        h('span', { class: 'spacer' }),
        props,
        exportSvg,
        zoom,
        toggle,
        copy,
      );
      const code = h('code', {});
      const pre = h('pre', {}, code);
      const diagram = h('figure', { class: 'diagram', contenteditable: 'false' });
      const dom = h('div', { class: 'code-view' }, head, pre, runOutput, diagram);
      const renderToggle = () => {
        toggle.textContent =
          dom.classList.contains('show-source') || dom.classList.contains('editing')
            ? 'Hide source'
            : 'Edit source';
      };
      let timer: number | undefined;
      let rendered = '';
      const renderDiagram = () => {
        const language = current.attrs.language || '';
        const isMermaid = language === 'mermaid';
        const isCollection = [
          'tasks',
          'collection',
          'chart',
          'notebook',
          'openapi',
          'canvas',
          'dashboard',
          'http',
        ].includes(language);
        dom.classList.toggle('collection-view', isCollection);
        if (isCollection) {
          zoom.hidden = exportSvg.hidden = true;
          toggle.hidden = false;
          const source = current.textContent;
          if (source === rendered) return;
          rendered = source;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            islands.renderSnippet(`\`\`\`${language}\n${source}\n\`\`\``, false, (html) => {
              if (rendered !== source) return;
              diagram.innerHTML = html;
              dom.classList.add('rendered');
              renderToggle();
            });
          }, 300);
          return;
        }
        dom.classList.toggle('mermaid', isMermaid);
        toggle.hidden = zoom.hidden = exportSvg.hidden = !isMermaid;
        if (!isMermaid) {
          diagram.replaceChildren();
          dom.classList.remove('rendered');
          rendered = '';
          return;
        }
        const source = current.textContent;
        if (source === rendered) return;
        rendered = source;
        window.clearTimeout(timer);
        diagram.classList.add('pending');
        timer = window.setTimeout(() => {
          const id = `d${++diagramSeq}`;
          diagramWaiters.set(id, (result) => {
            diagram.classList.remove('pending');
            if (result.svg) {
              diagram.innerHTML = result.svg;
              diagram.setAttribute('aria-label', 'Mermaid diagram preview');
              dom.classList.add('rendered');
            } else {
              diagram.replaceChildren(
                h('p', {
                  class: 'diagram-error',
                  text: `Diagram preview unavailable: ${result.error || 'invalid source'}`,
                }),
              );
              dom.classList.remove('rendered');
            }
            renderToggle();
          });
          vscode.postMessage({ type: 'renderDiagram', id, source });
        }, 350);
      };
      const render = () => {
        const language = current.attrs.language || '';
        props.hidden = !inspector.supports(language) || !editor.isEditable;
        runButton.dataset.language = language.toLowerCase();
        syncRunButton(runButton);
        if (
          !languages.includes(language) &&
          !select.querySelector(`option[value="${CSS.escape(language)}"]`)
        )
          select.append(h('option', { value: language, text: language }));
        select.value = language;
        select.disabled = !editor.isEditable;
        renderDiagram();
        renderToggle();
      };
      select.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            language: select.value || null,
          }),
        );
      });
      const entry = {
        pos: () => (typeof getPos === 'function' ? getPos() : undefined),
        size: () => current.nodeSize,
        el: dom,
      };
      codeViews.add(entry);
      render();
      return {
        dom,
        contentDOM: code,
        update(next: PMNode) {
          if (next.type !== current.type) return false;
          current = next;
          render();
          return true;
        },
        stopEvent: (event: Event) =>
          head.contains(event.target as globalThis.Node) ||
          runOutput.contains(event.target as globalThis.Node) ||
          // Interactive previews (```http cards) keep their own clicks and typing.
          !!(event.target as HTMLElement | null)?.closest?.(
            '.http-block, .collection-board.interactive',
          ),
        ignoreMutation: (mutation: { type: string; target: globalThis.Node }) =>
          mutation.type !== 'selection' &&
          ((mutation.type === 'attributes' && mutation.target === dom) ||
            head.contains(mutation.target) ||
            runOutput.contains(mutation.target) ||
            diagram.contains(mutation.target)),
        destroy: () => {
          codeViews.delete(entry);
          window.clearTimeout(timer);
        },
      };
    };
  },
}).configure({ lowlight, defaultLanguage: null });

const islands = createIslandViews({
  post: (message) => vscode.postMessage(message),
  editor: () => editor,
  blocked: () => blocked,
  h,
  svg,
  place,
  hideHovercard,
  root: app,
  isMac,
});

const editor = new Editor({
  element: editorHost,
  extensions: [
    ...visualExtensions({
      image: WikiImage,
      codeBlock: StudioCodeBlock,
      callout: Callout.extend({ addNodeView: () => containerView('type', calloutKinds, true) }),
      richContainer: RichContainer.extend({
        addNodeView: () => containerView('kind', layoutKinds, false),
      }),
      inlineIsland: islands.StudioInlineIsland,
      blockIsland: islands.StudioBlockIsland,
    }),
    TaskTokens,
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'heading'
          ? `Heading ${node.attrs.level}`
          : "Write, or type '/' for blocks…",
      showOnlyCurrent: true,
      includeChildren: false,
    }),
  ],
  content: '',
  editable: false,
  onUpdate: () => changed(),
  editorProps: {
    attributes: { 'aria-label': 'Visual Markdown editor', spellcheck: 'true', class: 'doc' },
    handleKeyDown: (_view, event) => handleMenuKeys(event),
  },
});

// ---------------------------------------------------------------------------------------------
// Synchronisation with the TextDocument
// ---------------------------------------------------------------------------------------------
let base = '';
/** Studio's serialization of the base document, and the source body of that base version. */
let baseline = '';
let baseBody = '';
let sentNext = '';
let sentBody = '';
let loaded = false;
let pending = false;
let inFlight = false;
let saveInFlight = false;
let blocked = false;
let conflicted = false;
let dirty = false;
let timer: number | undefined;
let context: Context | undefined;
const actionQueue = new VisualActionQueue();

function setState(text: string, tone: 'idle' | 'dirty' | 'busy' | 'saved' | 'error' = 'idle') {
  stateLabel.textContent = text;
  sync.dataset.tone = tone;
  sync.title = text;
  vscode.postMessage({ type: 'state', state: text });
}
function settled() {
  if (blocked) return;
  if (pending) setState('Editing…', 'busy');
  else if (inFlight) setState('Syncing…', 'busy');
  else if (dirty) setState('Unsaved changes', 'dirty');
  else setState('Saved', 'saved');
}
function send() {
  if (blocked || inFlight || saveInFlight || !loaded) {
    pending = true;
    return;
  }
  const next = editor.getMarkdown();
  pending = false;
  if (next.replace(/\s+$/, '') === baseline.replace(/\s+$/, '')) {
    settled();
    flushActions();
    return;
  }
  const normalize = (markdown: string) =>
    editor.markdown!.serialize(editor.markdown!.parse(markdown));
  const body = studioBody(baseBody, next, baseline, normalize);
  inFlight = true;
  sentNext = next;
  sentBody = body;
  settled();
  vscode.postMessage({ type: 'edit', base, body });
}
function changed() {
  if (!loaded || blocked) return;
  pending = true;
  settled();
  window.clearTimeout(timer);
  timer = window.setTimeout(send, 250);
  updateMenus();
  updateToolbar();
}
function flushActions() {
  const type = actionQueue.takeNext(!blocked && !pending && !inFlight && !saveInFlight);
  if (!type) return;
  if (type === 'undo' || type === 'redo') {
    editor.chain().focus()[type]().run();
    flushActions();
    return;
  }
  if (type === 'save') {
    saveInFlight = true;
    setState('Saving…', 'busy');
    vscode.postMessage({ type: 'save' });
    return;
  }
  vscode.postMessage({ type: 'mode', mode: type, ...caretContext() });
}
function requestAction(type: 'save' | 'source' | 'split' | 'studio') {
  window.clearTimeout(timer);
  if (type === 'studio') {
    if (context?.mode === 'split') vscode.postMessage({ type: 'mode', mode: 'studio' });
    return;
  }
  if (blocked) {
    if (type !== 'save') vscode.postMessage({ type: 'mode', mode: type, ...caretContext() });
    return;
  }
  actionQueue.request(type);
  if (pending && !inFlight && !saveInFlight) send();
  else flushActions();
}
const requestMode = (mode: 'studio' | 'source' | 'split') => requestAction(mode);

/** Replaces only the top-level blocks that differ, so selection, scroll and history survive. */
function replaceDocument(markdown: string) {
  const json = editor.markdown!.parse(markdown) as JSONContent;
  const next = PMNode.fromJSON(editor.schema, json);
  const doc = editor.state.doc;
  const start = doc.content.findDiffStart(next.content);
  if (start === null) return;
  let { a: endA, b: endB } = doc.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  const tr = editor.state.tr.replace(start, endA, next.slice(start, endB));
  tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
  editor.view.dispatch(tr);
}
function load(text: string, reason?: string, fallbackHtml?: string) {
  const body = bodyOf(text);
  const first = !loaded;
  try {
    if (first) {
      // The initial load is not an edit: it must never be undoable.
      editor
        .chain()
        .setMeta('addToHistory', false)
        .setContent(body, { contentType: 'markdown', emitUpdate: false })
        .run();
    } else replaceDocument(body);
  } catch {
    reason = 'This Markdown could not be parsed safely. Edit it in Code mode.';
  }
  baseline = sentNext = editor.getMarkdown();
  baseBody = sentBody = body;
  loaded = true;
  setReadOnly(!!reason, reason, fallbackHtml);
  if (first) {
    if (typeof viewState.selection === 'number')
      editor.commands.setTextSelection(
        Math.min(viewState.selection, editor.state.doc.content.size),
      );
    requestAnimationFrame(() => window.scrollTo(0, viewState.scroll || 0));
    if (!reason) editor.commands.focus(undefined, { scrollIntoView: false });
  }
}
function setReadOnly(value: boolean, reason?: string, fallbackHtml?: string) {
  blocked = value;
  editor.setEditable(!value);
  headerRenders.forEach((render) => render());
  saveButton.disabled = value;
  toolbar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = value));
  if (value) {
    hideFloating();
    setState(conflicted ? 'Source changed' : 'Source editing required', 'error');
    showNotice(reason || 'Studio cannot edit this page safely.', conflicted);
  } else {
    notice.hidden = true;
    settled();
  }
  const showFallback = value && !conflicted && !!fallbackHtml;
  readonlyView.hidden = !showFallback;
  editorHost.hidden = showFallback;
  if (showFallback) readonlyView.innerHTML = fallbackHtml!;
  updateToolbar();
}
function showNotice(text: string, conflict: boolean) {
  const actions: HTMLElement[] = [];
  const action = (title: string, run: () => void, primary = false) => {
    const button = h('button', {
      type: 'button',
      class: `btn${primary ? ' primary' : ''}`,
      text: title,
    });
    button.addEventListener('click', run);
    actions.push(button);
  };
  if (conflict) {
    action('Copy my version', () =>
      vscode.postMessage({ type: 'copyDraft', body: editor.getMarkdown() }),
    );
    action(
      'Reload from source',
      () => {
        conflicted = false;
        pending = inFlight = false;
        actionQueue.clear();
        vscode.postMessage({ type: 'reload' });
      },
      true,
    );
  } else action('Edit in Code', () => requestMode('source'), true);
  notice.replaceChildren(h('p', { text }), ...actions);
  notice.hidden = false;
}

// ---------------------------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------------------------
type Command = {
  id: string;
  label: string;
  icon: IconName;
  group: string;
  hint?: string;
  keys?: string;
  run: () => void;
  active?: () => boolean;
  keywords?: string;
};
const chain = () => editor.chain().focus();
/** Group containers are inserted with two children; children are offered inside their group. */
const childKinds: Record<string, string> = {
  tabs: 'tab',
  stepper: 'step',
  timeline: 'event',
  grid: 'card',
};
// Tabs, steps and events only make sense inside their group; cards also stand alone.
const childOf = new Map(
  Object.entries(childKinds)
    .filter(([, child]) => child !== 'card')
    .map(([parent, child]) => [child, parent]),
);
const containerDepth = () => {
  const { $from } = editor.state.selection;
  let depth = 0;
  for (let d = $from.depth; d > 0; d--)
    if (['callout', 'richContainer'].includes($from.node(d).type.name)) depth++;
  return depth;
};
const parentKind = () => {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type.name === 'richContainer') return String($from.node(d).attrs.kind);
  return '';
};
const insertContainer = (type: 'callout' | 'richContainer', kind: string, text = '') => {
  const child = childKinds[kind];
  const paragraph = { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
  chain()
    .insertContent({
      type,
      attrs: type === 'callout' ? { type: kind } : { kind },
      content: child
        ? [1, 2].map((n) => ({
            type: 'richContainer',
            attrs: { kind: child, title: `${label(child)} ${n}` },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: `${label(child)} ${n} content` }],
              },
            ],
          }))
        : [paragraph],
    })
    .run();
};
const insertInlineIsland = (source: string, kind: string, edit = true) => {
  const from = editor.state.selection.from;
  chain().insertContent({ type: 'inlineIsland', attrs: { source, kind } }).run();
  if (edit) islands.editAt(from);
};
const insertBlockIsland = (source: string, kind: string) => {
  chain().insertContent({ type: 'blockIsland', attrs: { source, kind } }).run();
  let at = -1;
  const limit = editor.state.selection.from;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'blockIsland' && node.attrs.source === source && pos <= limit) at = pos;
  });
  if (at >= 0) islands.editAt(at);
};
const insertFootnote = () => {
  let next = 1;
  editor.state.doc.descendants((node) => {
    const match = node.type.name.endsWith('Island')
      ? /\[\^(\d+)\]/.exec(String(node.attrs.source))
      : null;
    if (match) next = Math.max(next, Number(match[1]) + 1);
  });
  insertInlineIsland(`[^${next}]`, 'footnote', false);
  const end = editor.state.doc.content.size;
  const source = `[^${next}]: Footnote text.`;
  editor
    .chain()
    .insertContentAt(end, { type: 'blockIsland', attrs: { source, kind: 'footnote' } })
    .run();
  islands.editAt(end);
};
const blockCommands: Command[] = [
  {
    id: 'paragraph',
    label: 'Text',
    icon: 'text',
    group: 'Basic blocks',
    hint: 'Plain paragraph',
    run: () => chain().setParagraph().run(),
    active: () => editor.isActive('paragraph'),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    icon: 'h1',
    group: 'Basic blocks',
    hint: 'Page title',
    keys: `${mod}Alt+1`,
    run: () => chain().toggleHeading({ level: 1 }).run(),
    active: () => editor.isActive('heading', { level: 1 }),
    keywords: 'title h1',
  },
  {
    id: 'h2',
    label: 'Heading 2',
    icon: 'h2',
    group: 'Basic blocks',
    hint: 'Section heading',
    keys: `${mod}Alt+2`,
    run: () => chain().toggleHeading({ level: 2 }).run(),
    active: () => editor.isActive('heading', { level: 2 }),
    keywords: 'h2 section',
  },
  {
    id: 'h3',
    label: 'Heading 3',
    icon: 'h3',
    group: 'Basic blocks',
    hint: 'Subsection heading',
    keys: `${mod}Alt+3`,
    run: () => chain().toggleHeading({ level: 3 }).run(),
    active: () => editor.isActive('heading', { level: 3 }),
    keywords: 'h3',
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    icon: 'bullet',
    group: 'Basic blocks',
    keys: '- ',
    run: () => chain().toggleBulletList().run(),
    active: () => editor.isActive('bulletList'),
    keywords: 'ul unordered',
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    icon: 'numbered',
    group: 'Basic blocks',
    keys: '1. ',
    run: () => chain().toggleOrderedList().run(),
    active: () => editor.isActive('orderedList'),
    keywords: 'ol ordered',
  },
  {
    id: 'task',
    label: 'Task list',
    icon: 'task',
    group: 'Basic blocks',
    keys: '[] ',
    run: () => chain().toggleTaskList().run(),
    active: () => editor.isActive('taskList'),
    keywords: 'todo checklist checkbox',
  },
  {
    id: 'quote',
    label: 'Quote',
    icon: 'quote',
    group: 'Basic blocks',
    keys: '> ',
    run: () => chain().toggleBlockquote().run(),
    active: () => editor.isActive('blockquote'),
    keywords: 'blockquote',
  },
  {
    id: 'code',
    label: 'Code block',
    icon: 'codeBlock',
    group: 'Basic blocks',
    keys: '``` ',
    run: () => chain().toggleCodeBlock().run(),
    active: () => editor.isActive('codeBlock'),
    keywords: 'snippet fence',
  },
  {
    id: 'table',
    label: 'Table',
    icon: 'table',
    group: 'Basic blocks',
    hint: '3 × 3 with header row',
    run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    keywords: 'grid rows columns',
  },
  {
    id: 'rule',
    label: 'Divider',
    icon: 'rule',
    group: 'Basic blocks',
    keys: '---',
    run: () => chain().setHorizontalRule().run(),
    keywords: 'hr horizontal rule separator',
  },
  {
    id: 'link',
    label: 'Link to page',
    icon: 'link',
    group: 'Links and media',
    hint: 'Search wiki pages',
    keys: '[[',
    run: () => openLinkBox(),
    keywords: 'wiki page internal url',
  },
  {
    id: 'image',
    label: 'Image',
    icon: 'image',
    group: 'Links and media',
    hint: 'Import into wiki assets',
    run: () => vscode.postMessage({ type: 'importImage' }),
    keywords: 'picture photo upload',
  },
  {
    id: 'image-browse',
    label: 'Image from wiki',
    icon: 'gallery',
    group: 'Links and media',
    hint: 'Reuse an imported image',
    run: () => vscode.postMessage({ type: 'browseImages' }),
  },
  {
    id: 'image-path',
    label: 'Image by path',
    icon: 'image',
    group: 'Links and media',
    hint: 'Relative image path',
    run: () => vscode.postMessage({ type: 'requestImagePath' }),
  },
  {
    id: 'attachment',
    label: 'Attachment',
    icon: 'attachment',
    group: 'Links and media',
    hint: 'PDF, CSV, ZIP, Office files',
    run: () => vscode.postMessage({ type: 'importAttachment' }),
    keywords: 'file pdf',
  },
  {
    id: 'mermaid',
    label: 'Mermaid diagram',
    icon: 'mermaid',
    group: 'Diagrams',
    hint: 'Flowchart with live preview',
    run: () =>
      chain()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'flowchart LR\n  A[Start] --> B[Done]' }],
        })
        .run(),
    keywords: 'chart flowchart sequence graph',
  },
  ...calloutKinds.map<Command>((kind) => ({
    id: `callout-${kind}`,
    label: label(kind),
    icon: (kind === 'quote' ? 'quoteIcon' : kind) as IconName,
    group: 'Callouts',
    hint: `${label(kind)} admonition`,
    run: () => insertContainer('callout', kind),
    keywords: `callout admonition ${kind}`,
  })),
  ...layoutKinds.map<Command>((kind) => ({
    id: `layout-${kind}`,
    label: label(kind),
    icon:
      (
        {
          hero: 'hero',
          tabs: 'tabs',
          tab: 'tabs',
          accordion: 'details',
          details: 'details',
          spoiler: 'eye',
          stepper: 'steps',
          step: 'steps',
          timeline: 'timeline',
          event: 'timeline',
          card: 'card',
          grid: 'layout',
          'nav-card': 'card',
          gallery: 'gallery',
          caption: 'caption',
        } as Record<string, IconName>
      )[kind] || 'layout',
    group: 'Layout',
    hint: childKinds[kind]
      ? `${label(kind)} with two ${label(childKinds[kind]).toLowerCase()}s`
      : childOf.has(kind)
        ? `Inside ${label(childOf.get(kind)!)}`
        : `${label(kind)} container`,
    run: () => insertContainer('richContainer', kind),
    keywords: `layout container ${kind}`,
  })),
  {
    id: 'chart',
    label: 'Chart',
    icon: 'layout',
    group: 'Diagrams',
    hint: 'Line, bar, area, scatter or pie from CSV/JSON',
    run: () =>
      chain()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'chart' },
          content: [
            {
              type: 'text',
              text: 'type: bar\ntitle: Weekly visits\nx: week\ny: visits, signups\n---\nweek,visits,signups\nW1,120,8\nW2,180,14\nW3,150,11',
            },
          ],
        })
        .run(),
    keywords: 'graph plot line bar pie scatter area data csv json visualization',
  },
  ...(
    [
      [
        'notebook-embed',
        'Notebook',
        'file',
        'Static view of a .ipynb in the wiki',
        'notebook',
        'path: notebooks/analysis.ipynb',
        'jupyter ipynb notebook embed output',
      ],
      [
        'canvas-embed',
        'Canvas',
        'gallery',
        'Preview of a .canvas board',
        'canvas',
        'path: canvases/Overview.canvas',
        'canvas board whiteboard map embed',
      ],
      [
        'dashboard-embed',
        'Dashboard',
        'layout',
        'Live data dashboard or one of its widgets',
        'dashboard',
        '',
        'dashboard kpi metric chart data excel csv widget',
      ],
      [
        'openapi-embed',
        'API reference',
        'code',
        'Reference generated from an OpenAPI 3 file',
        'openapi',
        'path: api/openapi.yaml',
        'openapi swagger rest api reference endpoint',
      ],
    ] as const
  ).map(([id, label, iconName, hint, language, , keywords]) => ({
    id,
    label,
    icon: iconName as IconName,
    group: 'Diagrams',
    hint,
    // The host asks which file to embed; nothing is inserted if the user cancels.
    run: () => vscode.postMessage({ type: 'pickEmbed', language }),
    keywords,
  })),
  {
    id: 'http-request',
    label: 'HTTP request',
    icon: 'code',
    group: 'Diagrams',
    hint: 'An API call readers can send from the page',
    run: () =>
      chain()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'http' },
          content: [
            {
              type: 'text',
              text: '# @name Get users\n# @test status == 200\nGET {{baseUrl}}/api/users\nAccept: application/json',
            },
          ],
        })
        .run(),
    keywords: 'http api request rest endpoint curl postman send',
  },
  {
    id: 'kanban',
    label: 'Kanban board',
    icon: 'layout',
    group: 'Planner',
    hint: 'Live board of this page’s tasks by status',
    run: () =>
      chain()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'tasks' },
          content: [{ type: 'text', text: 'page: this\nview: board' }],
        })
        .run(),
    keywords: 'kanban board tasks status columns planner',
  },
  {
    id: 'collection-tasks',
    label: 'Task view',
    icon: 'task',
    group: 'Planner',
    hint: 'Live list, table or board of tasks',
    run: () =>
      chain()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'tasks' },
          content: [{ type: 'text', text: 'status: open\nview: list' }],
        })
        .run(),
    keywords: 'tasks query todo planner kanban board embed collection',
  },
  {
    id: 'collection-pages',
    label: 'Page gallery',
    icon: 'gallery',
    group: 'Planner',
    hint: 'Pages in a folder or with a tag',
    run: () =>
      chain()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'collection' },
          content: [{ type: 'text', text: 'source: pages\nfolder: projects\nview: gallery' }],
        })
        .run(),
    keywords: 'collection pages projects gallery cards index',
  },
  {
    id: 'task-item',
    label: 'Task',
    icon: 'task',
    group: 'Planner',
    hint: 'Checklist item with due:, priority:, #tags',
    run: () => {
      const tomorrow = new Date(Date.now() + 86400000);
      const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      chain().toggleTaskList().insertContent(`New task due:${date}`).run();
    },
    keywords: 'todo checkbox due',
  },
  {
    id: 'inline-highlight',
    label: 'Highlight',
    icon: 'highlight',
    group: 'Inline',
    hint: '==marked text==',
    keys: `${mod}Shift+H`,
    run: () => chain().toggleMark('highlight').run(),
    keywords: 'mark highlight',
  },
  {
    id: 'inline-keys',
    label: 'Keyboard keys',
    icon: 'keys',
    group: 'Inline',
    hint: '++Ctrl+K++',
    run: () => insertInlineIsland('++Ctrl+K++', 'keys'),
    keywords: 'keycap kbd shortcut',
  },
  {
    id: 'inline-math',
    label: 'Inline math',
    icon: 'math',
    group: 'Inline',
    hint: '$E = mc^2$',
    run: () => insertInlineIsland('$E = mc^2$', 'math'),
    keywords: 'latex katex formula equation',
  },
  {
    id: 'inline-badge',
    label: 'Badge',
    icon: 'badge',
    group: 'Inline',
    hint: '{badge:New}',
    run: () => insertInlineIsland('{badge:New}', 'badge'),
    keywords: 'label tag pill',
  },
  {
    id: 'inline-button',
    label: 'Button link',
    icon: 'button',
    group: 'Inline',
    hint: '{button:Label|page.md}',
    run: () => insertInlineIsland('{button:Read more|index.md}', 'button'),
    keywords: 'call to action cta',
  },
  {
    id: 'inline-tip',
    label: 'Tooltip',
    icon: 'tooltip',
    group: 'Inline',
    hint: '{tip:Term|Explanation}',
    run: () => insertInlineIsland('{tip:Term|Explanation}', 'tip'),
    keywords: 'annotation hover explanation',
  },
  {
    id: 'inline-icon',
    label: 'Icon',
    icon: 'check',
    group: 'Inline',
    hint: 'check, info, warning, star, heart, arrow',
    run: () => insertInlineIsland('{icon:check}', 'icon'),
    keywords: 'symbol',
  },
  {
    id: 'inline-emoji',
    label: 'Emoji',
    icon: 'emoji',
    group: 'Inline',
    hint: '{emoji:smile}',
    run: () => insertInlineIsland('{emoji:smile}', 'emoji'),
  },
  {
    id: 'inline-footnote',
    label: 'Footnote',
    icon: 'footnote',
    group: 'Inline',
    hint: 'Reference here, note at the end',
    run: () => insertFootnote(),
    keywords: 'reference citation note',
  },
  {
    id: 'block-math',
    label: 'Math block',
    icon: 'mathBlock',
    group: 'Advanced',
    hint: '$$ … $$ (KaTeX)',
    run: () => insertBlockIsland('$$\na^2 + b^2 = c^2\n$$', 'math'),
    keywords: 'latex katex equation formula',
  },
  {
    id: 'block-deflist',
    label: 'Definition list',
    icon: 'definition',
    group: 'Advanced',
    hint: 'Term followed by : definition',
    run: () => insertBlockIsland('Term\n: Definition of the term.', 'deflist'),
    keywords: 'glossary definitions dl',
  },
  {
    id: 'block-abbr',
    label: 'Abbreviation',
    icon: 'definition',
    group: 'Advanced',
    hint: '*[API]: Application Programming Interface',
    run: () => insertBlockIsland('*[API]: Application Programming Interface', 'abbr'),
    keywords: 'acronym glossary',
  },
  {
    id: 'block-include',
    label: 'Include page',
    icon: 'include',
    group: 'Advanced',
    hint: '{{ include "snippet.md" }}',
    run: () => insertBlockIsland('{{ include "snippet.md" }}', 'include'),
    keywords: 'snippet reuse transclude',
  },
  {
    id: 'block-media',
    label: 'Audio or video',
    icon: 'media',
    group: 'Advanced',
    hint: 'Local mp3, ogg, mp4 or webm',
    run: () => vscode.postMessage({ type: 'importMedia' }),
    keywords: 'video audio embed mp4 mp3',
  },
  {
    id: 'block-media-path',
    label: 'Media by path',
    icon: 'media',
    group: 'Advanced',
    hint: 'Embed an existing local file',
    run: () => insertInlineIsland('![Recording](assets/media/recording.mp4)', 'media'),
    keywords: 'video audio embed',
  },
];
blockCommands.splice(1, 0, {
  id: 'block-gallery',
  label: 'Block gallery',
  icon: 'blocks',
  group: 'Basic blocks',
  hint: 'Browse every block with live previews',
  run: () => openGallery(),
  keywords: 'gallery blocks components library browse insert',
});
const commandById = new Map(blockCommands.map((c) => [c.id, c]));
let gallery: ReturnType<typeof createBlockGallery> | undefined;
function openGallery(query = '') {
  if (blocked || !editor.isEditable) return;
  gallery ??= createBlockGallery({
    h,
    svg,
    post: (message) => vscode.postMessage(message),
    renderSnippet: islands.renderSnippet,
    insert: (entry) => {
      if (entry.sample && !entry.pick)
        chain()
          .insertContent((editor.markdown!.parse(`${entry.sample}\n`) as JSONContent).content || [])
          .run();
      else commandById.get(entry.command)?.run();
    },
    available: (id) => available().some((c) => c.id === id),
  });
  gallery.open(query);
}
const run = (id: string) => commandById.get(id)!.run();

const inline: Array<[IconName, string, () => void, string, () => boolean]> = [
  ['bold', 'Bold', () => chain().toggleBold().run(), `${mod}B`, () => editor.isActive('bold')],
  [
    'italic',
    'Italic',
    () => chain().toggleItalic().run(),
    `${mod}I`,
    () => editor.isActive('italic'),
  ],
  [
    'strike',
    'Strikethrough',
    () => chain().toggleStrike().run(),
    `${mod}Shift+S`,
    () => editor.isActive('strike'),
  ],
  [
    'code',
    'Inline code',
    () => chain().toggleCode().run(),
    `${mod}E`,
    () => editor.isActive('code'),
  ],
  [
    'highlight',
    'Highlight',
    () => chain().toggleMark('highlight').run(),
    `${mod}Shift+H`,
    () => editor.isActive('highlight'),
  ],
  ['link', 'Link', () => openLinkBox(), `${mod}K`, () => editor.isActive('link')],
];
const pressable = new Map<HTMLButtonElement, () => boolean>();
const group = (...items: HTMLElement[]) => h('div', { class: 'group' }, ...items);
const divider = () => h('span', { class: 'divider', 'aria-hidden': 'true' });
const undoButton = tbButton('undo', 'Undo', () => requestHistory('undo'), `${mod}Z`);
const redoButton = tbButton('redo', 'Redo', () => requestHistory('redo'), isMac ? '⇧⌘Z' : 'Ctrl+Y');
const blockType = h(
  'button',
  {
    type: 'button',
    class: 'tb text blocktype',
    'aria-label': 'Block type',
    'aria-haspopup': 'listbox',
    title: 'Turn into',
  },
  h('span', { text: 'Text' }),
  svg('chevron', 14),
);
blockType.addEventListener('mousedown', (e) => e.preventDefault());
blockType.addEventListener('click', () =>
  openMenu(
    blockType,
    blockCommands.filter((c) =>
      ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'task', 'quote', 'code'].includes(c.id),
    ),
    { compact: true },
  ),
);
const inlineButtons = inline.map(([name, title, action, keys, active]) => {
  const button = tbButton(name, title, action, keys, { 'aria-pressed': 'false' });
  pressable.set(button, active);
  return button;
});
const listButtons = ['bullet', 'numbered', 'task'].map((id) => {
  const c = commandById.get(id)!;
  const button = tbButton(c.icon, c.label, c.run, undefined, { 'aria-pressed': 'false' });
  pressable.set(button, c.active!);
  return button;
});
const calloutButton = tbButton('callout', 'Callout', () => insertContainer('callout', 'note'));
const insertButtons = [
  calloutButton,
  tbButton('codeBlock', 'Code block', () => run('code')),
  tbButton('table', 'Table', () => run('table')),
  tbButton('image', 'Image', () => run('image')),
  tbButton('mermaid', 'Mermaid diagram', () => run('mermaid')),
];
insertButtons.forEach((b) => b.classList.add('optional'));
const galleryButton = tbButton('blocks', 'Block gallery', () => openGallery());
const insertMenuButton = tbButton(
  'plus',
  'Insert block',
  () => openMenu(insertMenuButton, available()),
  '/',
  { 'aria-haspopup': 'listbox' },
);
const tableGroup = group(
  h('span', { class: 'label', text: 'Table' }),
  tbButton('rowAdd', 'Add row below', () => chain().addRowAfter().run()),
  tbButton('colAdd', 'Add column right', () => chain().addColumnAfter().run()),
  tbButton('rowDel', 'Delete row', () => chain().deleteRow().run()),
  tbButton('colDel', 'Delete column', () => chain().deleteColumn().run()),
  tbButton('trash', 'Delete table', () => chain().deleteTable().run()),
);
tableGroup.classList.add('context');
toolbarInner.append(
  group(undoButton, redoButton),
  divider(),
  group(blockType),
  divider(),
  group(...inlineButtons),
  divider(),
  group(...listButtons),
  divider(),
  group(...insertButtons, galleryButton, insertMenuButton),
  tableGroup,
);
function updateToolbar() {
  for (const [button, active] of pressable)
    button.setAttribute('aria-pressed', String(!blocked && active()));
  const current = blockCommands.find(
    (c) => ['h1', 'h2', 'h3', 'code', 'quote'].includes(c.id) && c.active?.(),
  );
  (blockType.firstElementChild as HTMLElement).textContent =
    current?.label || (editor.isActive('heading') ? 'Heading' : 'Text');
  tableGroup.hidden = blocked || !editor.isActive('table');
  calloutButton.disabled = blocked || containerDepth() >= 4;
  calloutButton.title = containerDepth() >= 4 ? 'Containers nest at most four levels' : 'Callout';
  undoButton.disabled = blocked || !editor.can().undo();
  redoButton.disabled = blocked || !editor.can().redo();
}
function requestHistory(type: 'undo' | 'redo') {
  if (blocked) return;
  // Apply immediately; the edit syncs like any other change.
  editor.chain().focus()[type]().run();
}

// ---------------------------------------------------------------------------------------------
// Floating menus: slash commands, insert menu, page links
// ---------------------------------------------------------------------------------------------
interface MenuItem {
  label: string;
  hint?: string;
  icon: IconName;
  keys?: string;
  group?: string;
  run: () => void;
}
let menuItems: MenuItem[] = [];
let menuIndex = 0;
let menuMode: 'slash' | 'wiki' | 'static' | undefined;
let triggerFrom = -1;
let wikiQuery: string | undefined;
let wikiResults: Array<{ title: string; path: string; target: string }> = [];

function caretRect(): DOMRect | undefined {
  try {
    return editor.view.coordsAtPos(editor.state.selection.from) as unknown as DOMRect;
  } catch {
    return undefined;
  }
}
function place(el: HTMLElement, rect: { left: number; top: number; bottom: number }, gap = 6) {
  el.hidden = false;
  const width = el.offsetWidth,
    height = el.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = rect.bottom + gap;
  const top =
    below + height > window.innerHeight - 8 && rect.top - gap - height > 8
      ? rect.top - gap - height
      : below;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(8, top)}px`;
}
function renderMenu() {
  menu.replaceChildren();
  if (!menuItems.length) {
    menu.append(
      h('div', {
        class: 'empty',
        text: menuMode === 'wiki' ? 'No matching pages' : 'No matching blocks',
      }),
    );
    return;
  }
  let lastGroup: string | undefined;
  menuItems.forEach((item, index) => {
    if (item.group && item.group !== lastGroup) {
      menu.append(h('div', { class: 'heading', text: item.group, role: 'presentation' }));
      lastGroup = item.group;
    }
    const row = h(
      'button',
      {
        type: 'button',
        class: 'item',
        role: 'option',
        'aria-selected': String(index === menuIndex),
        id: `menu-${index}`,
      },
      h('span', { class: 'glyph' }, svg(item.icon)),
      h(
        'span',
        { class: 'text' },
        h('span', { class: 'label', text: item.label }),
        item.hint ? h('span', { class: 'hint', text: item.hint }) : undefined,
      ),
      item.keys ? h('kbd', { text: item.keys }) : undefined,
    );
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('mousemove', () => {
      if (menuIndex !== index) {
        menuIndex = index;
        highlight();
      }
    });
    row.addEventListener('click', () => chooseMenu(index));
    menu.append(row);
  });
  menu.setAttribute('aria-activedescendant', `menu-${menuIndex}`);
}
function highlight() {
  menu
    .querySelectorAll('.item')
    .forEach((el, i) => el.setAttribute('aria-selected', String(i === menuIndex)));
  menu.querySelector(`#menu-${menuIndex}`)?.scrollIntoView({ block: 'nearest' });
  menu.setAttribute('aria-activedescendant', `menu-${menuIndex}`);
}
function closeMenu() {
  menu.hidden = true;
  menuMode = undefined;
  triggerFrom = -1;
  wikiQuery = undefined;
}
function chooseMenu(index: number) {
  const item = menuItems[index];
  if (!item) return;
  const mode = menuMode;
  if ((mode === 'slash' || mode === 'wiki') && triggerFrom >= 0)
    editor
      .chain()
      .focus()
      .deleteRange({ from: triggerFrom, to: editor.state.selection.from })
      .run();
  closeMenu();
  item.run();
}
const asItem = (c: Command): MenuItem => ({
  label: c.label,
  hint: c.hint,
  icon: c.icon,
  keys: c.keys,
  group: c.group,
  run: c.run,
});
function openMenu(anchor: HTMLElement, commands: Command[], options: { compact?: boolean } = {}) {
  if (blocked) return;
  menuMode = 'static';
  menuItems = commands.map((c) => ({ ...asItem(c), group: options.compact ? undefined : c.group }));
  menuIndex = 0;
  menu.classList.toggle('compact', !!options.compact);
  renderMenu();
  place(menu, anchor.getBoundingClientRect());
  menu.tabIndex = -1;
  menu.focus();
}
menu.addEventListener('keydown', (event) => {
  if (menuMode === 'static' && handleMenuKeys(event)) event.preventDefault();
});
/** Child containers are offered only inside their group; nesting stops at four levels. */
const available = () => {
  const parent = parentKind();
  const deep = containerDepth() >= 4;
  return blockCommands.filter((c) => {
    if (deep && /^(callout|layout)-/.test(c.id)) return false;
    const kind = c.id.startsWith('layout-') ? c.id.slice(7) : '';
    return !childOf.has(kind) || childOf.get(kind) === parent;
  });
};
function filterCommands(query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return available();
  return available()
    .map((c) => {
      const text = `${c.label} ${c.keywords || ''} ${c.group}`.toLowerCase();
      const score = c.label.toLowerCase().startsWith(q)
        ? 0
        : text.split(/\s+/).some((w) => w.startsWith(q))
          ? 1
          : text.includes(q)
            ? 2
            : -1;
      return { c, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c);
}
/** Detects `/query` and `[[query` before the caret and keeps the matching menu open. */
function updateMenus() {
  if (menuMode === 'static') return;
  const { selection } = editor.state;
  if (!selection.empty || blocked || editor.isActive('codeBlock')) {
    if (menuMode) closeMenu();
    return;
  }
  const before = selection.$from.parent.textBetween(
    0,
    selection.$from.parentOffset,
    undefined,
    '￼',
  );
  const slash = /(?:^|\s)\/([\p{L}\p{N} -]{0,30})$/u.exec(before);
  const wiki = /\[\[([^\]\n]{0,80})$/.exec(before);
  if (wiki) {
    triggerFrom = selection.from - wiki[0].length;
    menuMode = 'wiki';
    if (wiki[1] !== wikiQuery) {
      wikiQuery = wiki[1];
      vscode.postMessage({ type: 'suggestPages', query: wikiQuery, purpose: 'wiki' });
    }
    return;
  }
  if (slash && !/\s{2}/.test(slash[1])) {
    triggerFrom = selection.from - slash[1].length - 1;
    menuMode = 'slash';
    menuItems = filterCommands(slash[1]).map(asItem);
    menuIndex = Math.min(menuIndex, Math.max(0, menuItems.length - 1));
    if (!slash[1]) menuIndex = 0;
    menu.classList.remove('compact');
    renderMenu();
    const rect = caretRect();
    if (rect) place(menu, rect);
    if (slash[1] && !menuItems.length && slash[1].length > 12) closeMenu();
    return;
  }
  if (menuMode) closeMenu();
}
function showWikiResults(pages: Array<{ title: string; path: string; target: string }>) {
  wikiResults = pages;
  menuItems = pages.map((p) => ({
    label: p.title,
    hint: p.path,
    icon: 'file',
    run: () =>
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'text', text: p.title, marks: [{ type: 'link', attrs: { href: p.target } }] },
          { type: 'text', text: ' ' },
        ])
        .run(),
  }));
  menuIndex = 0;
  menu.classList.remove('compact');
  renderMenu();
  const rect = caretRect();
  if (rect) place(menu, rect);
}
function handleMenuKeys(event: KeyboardEvent): boolean {
  if (!menuMode || menu.hidden) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!menuItems.length) return true;
    menuIndex =
      (menuIndex + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length;
    highlight();
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    if (!menuItems.length) {
      closeMenu();
      return false;
    }
    chooseMenu(menuIndex);
    return true;
  }
  if (event.key === 'Escape') {
    const wasStatic = menuMode === 'static';
    closeMenu();
    if (wasStatic) editor.commands.focus();
    if (pending && !inFlight) send();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Inline link editor (Ctrl/Cmd+K)
// ---------------------------------------------------------------------------------------------
const linkInput = h('input', {
  type: 'text',
  'aria-label': 'Link URL or page',
  placeholder: 'Search pages or paste a URL',
});
const linkResults = h('div', { class: 'menu', role: 'listbox' });
const linkRemove = h('button', { type: 'button', class: 'btn', text: 'Remove' });
linkbox.append(h('div', { class: 'row' }, linkInput, linkRemove), linkResults);
let linkPages: Array<{ title: string; path: string; target: string }> = [];
let linkIndex = -1;
function openLinkBox() {
  if (blocked) return;
  hideHovercard();
  bubble.hidden = true;
  const href = editor.getAttributes('link').href || '';
  if (editor.isActive('link')) editor.chain().extendMarkRange('link').run();
  linkInput.value = href;
  linkRemove.hidden = !href;
  linkPages = [];
  linkIndex = -1;
  linkResults.replaceChildren();
  const rect = caretRect();
  if (rect) place(linkbox, rect);
  linkInput.focus();
  linkInput.select();
  vscode.postMessage({
    type: 'suggestPages',
    query: href && !/[/:.]/.test(href) ? href : '',
    purpose: 'link',
  });
}
function closeLinkBox(refocus = true) {
  linkbox.hidden = true;
  if (refocus) editor.commands.focus();
}
function applyLink(href: string, text?: string) {
  const value = href.trim();
  if (/^\s*(?:javascript|data|vbscript|file):/i.test(value)) return;
  closeLinkBox();
  if (!value) {
    chain().extendMarkRange('link').unsetLink().run();
    return;
  }
  if (editor.state.selection.empty) {
    chain()
      .insertContent({
        type: 'text',
        text: text || value,
        marks: [{ type: 'link', attrs: { href: value } }],
      })
      .run();
  } else chain().extendMarkRange('link').setLink({ href: value }).run();
}
function renderLinkResults() {
  linkResults.replaceChildren();
  linkPages.slice(0, 8).forEach((p, index) => {
    const row = h(
      'button',
      {
        type: 'button',
        class: 'item',
        role: 'option',
        'aria-selected': String(index === linkIndex),
      },
      h('span', { class: 'glyph' }, svg('file')),
      h(
        'span',
        { class: 'text' },
        h('span', { class: 'label', text: p.title }),
        h('span', { class: 'hint', text: p.path }),
      ),
    );
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => applyLink(p.target, p.title));
    linkResults.append(row);
  });
}
linkInput.addEventListener('input', () => {
  linkIndex = -1;
  const value = linkInput.value.trim();
  if (/^(?:https?:|mailto:|\.{0,2}\/|#)/i.test(value)) {
    linkPages = [];
    renderLinkResults();
  } else vscode.postMessage({ type: 'suggestPages', query: value, purpose: 'link' });
});
linkInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = Math.min(8, linkPages.length);
    if (!count) return;
    linkIndex = (linkIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    renderLinkResults();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const pick = linkPages[linkIndex];
    if (pick) applyLink(pick.target, pick.title);
    else applyLink(linkInput.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeLinkBox();
  }
});
linkRemove.addEventListener('click', () => applyLink(''));
linkInput.addEventListener('blur', () =>
  setTimeout(() => {
    if (!linkbox.contains(document.activeElement)) linkbox.hidden = true;
  }, 120),
);

// ---------------------------------------------------------------------------------------------
// Bubble menu, block handle, hover card, page menu
// ---------------------------------------------------------------------------------------------
const bubbleButtons = inline.map(([name, title, action, keys, active]) => {
  const button = tbButton(name, title, action, keys, { 'aria-pressed': 'false' });
  pressable.set(button, active);
  return button;
});
const headingToggle = (level: 1 | 2 | 3) => {
  const button = tbButton(
    `h${level}` as IconName,
    `Heading ${level}`,
    () => chain().toggleHeading({ level }).run(),
    undefined,
    { 'aria-pressed': 'false' },
  );
  pressable.set(button, () => editor.isActive('heading', { level }));
  return button;
};
bubble.append(
  ...bubbleButtons,
  h('span', { class: 'divider' }),
  headingToggle(2),
  headingToggle(3),
);
function updateBubble() {
  const { selection } = editor.state;
  if (
    blocked ||
    selection.empty ||
    selection instanceof NodeSelection ||
    !editor.isFocused ||
    editor.isActive('codeBlock') ||
    !menu.hidden
  ) {
    bubble.hidden = true;
    return;
  }
  const range = window.getSelection()?.rangeCount
    ? window.getSelection()!.getRangeAt(0).getBoundingClientRect()
    : undefined;
  if (!range || (!range.width && !range.height)) {
    bubble.hidden = true;
    return;
  }
  bubble.hidden = false;
  const width = bubble.offsetWidth;
  bubble.style.left = `${Math.max(8, Math.min(range.left + range.width / 2 - width / 2, window.innerWidth - width - 8))}px`;
  bubble.style.top = `${range.top - 44 > 80 ? range.top - 44 : range.bottom + 8}px`;
}

let handlePos = -1;
const plusHandle = tbButton('plus', 'Insert block below', () => {
  if (handlePos < 0) return;
  const node = editor.state.doc.nodeAt(handlePos);
  if (!node) return;
  const after = handlePos + node.nodeSize;
  editor
    .chain()
    .focus()
    .insertContentAt(after, { type: 'paragraph' })
    .setTextSelection(after + 1)
    .insertContent('/')
    .run();
});
const gripHandle = tbButton('grip', 'Drag to move, click for block actions', () => {
  if (handlePos < 0) return;
  editor.chain().focus().setNodeSelection(handlePos).run();
  openMenu(
    gripHandle,
    [
      {
        id: 'up',
        label: 'Move up',
        icon: 'chevron',
        group: '',
        keys: 'Alt+↑',
        run: () => moveBlock(-1),
      },
      {
        id: 'down',
        label: 'Move down',
        icon: 'chevron',
        group: '',
        keys: 'Alt+↓',
        run: () => moveBlock(1),
      },
      { id: 'dup', label: 'Duplicate', icon: 'copy', group: '', run: () => duplicateBlock() },
      {
        id: 'del',
        label: 'Delete',
        icon: 'trash',
        group: '',
        keys: 'Del',
        run: () => chain().deleteSelection().run(),
      },
    ],
    { compact: true },
  );
});
gripHandle.classList.add('grip');
gripHandle.draggable = true;
// Pointer affordance only: keyboard users have Alt+↑/↓ and the slash menu, so keep it out of tab order.
plusHandle.tabIndex = -1;
gripHandle.tabIndex = -1;
handle.append(plusHandle, gripHandle);
function topLevelAt(pos: number): number {
  const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
  return $pos.depth ? $pos.before(1) : pos;
}
function moveBlock(direction: -1 | 1) {
  const { state } = editor;
  const from = topLevelAt(state.selection.from);
  const node = state.doc.nodeAt(from);
  if (!node) return;
  const index = state.doc.resolve(from).index(0);
  const sibling = state.doc.maybeChild(index + direction);
  if (!sibling) return;
  const offsetInBlock = state.selection.from - from;
  const tr = state.tr.delete(from, from + node.nodeSize);
  const target = direction < 0 ? from - sibling.nodeSize : from + sibling.nodeSize;
  tr.insert(target, node);
  const selectionAt = Math.min(target + offsetInBlock, tr.doc.content.size);
  tr.setSelection(
    state.selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, target)
      : TextSelection.near(tr.doc.resolve(selectionAt)),
  );
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}
function duplicateBlock() {
  const from = topLevelAt(editor.state.selection.from);
  const node = editor.state.doc.nodeAt(from);
  if (node)
    editor.view.dispatch(editor.state.tr.insert(from + node.nodeSize, node.copy(node.content)));
}
gripHandle.addEventListener('dragstart', (event) => {
  if (handlePos < 0 || !event.dataTransfer) return;
  const view = editor.view;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, handlePos)));
  const slice = view.state.selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  event.dataTransfer.clearData();
  event.dataTransfer.setData('text/html', dom.innerHTML);
  event.dataTransfer.setData('text/plain', text);
  event.dataTransfer.effectAllowed = 'move';
  const block = view.nodeDOM(handlePos);
  if (block instanceof HTMLElement) event.dataTransfer.setDragImage(block, 0, 0);
  view.dragging = { slice, move: true };
});
canvas.addEventListener('mousemove', (event) => {
  if (blocked || !editor.isEditable) return;
  const view = editor.view;
  const editorRect = view.dom.getBoundingClientRect();
  const found = view.posAtCoords({
    left: Math.max(editorRect.left + 4, Math.min(event.clientX, editorRect.right - 4)),
    top: event.clientY,
  });
  if (!found) return;
  const pos = topLevelAt(found.inside >= 0 ? found.inside : found.pos);
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return;
  handlePos = pos;
  const rect = dom.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const lineOffset = /^(H[1-3])$/.test(dom.tagName)
    ? Math.max(0, (parseFloat(getComputedStyle(dom).lineHeight) || 24) / 2 - 12)
    : 0;
  handle.style.top = `${rect.top - pageRect.top + lineOffset}px`;
  handle.style.left = `-52px`;
  handle.classList.add('visible');
});
canvas.addEventListener('mouseleave', () => handle.classList.remove('visible'));

let hoveredHref = '';
function linkTarget(
  target: EventTarget | null,
): { el: HTMLElement; href: string; kind: 'wiki' | 'markdown' } | undefined {
  const el =
    target instanceof Element
      ? (target.closest('.ProseMirror a, .readonly-view a') as HTMLElement | null)
      : null;
  if (!el) return;
  const wiki = el.getAttribute('data-wiki-link');
  const href = wiki ?? el.getAttribute('href') ?? '';
  return href ? { el, href, kind: wiki ? 'wiki' : 'markdown' } : undefined;
}
document.addEventListener('mouseover', (event) => {
  const link = linkTarget(event.target);
  if (!link || link.href === hoveredHref) return;
  hoveredHref = link.href;
  const rect = link.el.getBoundingClientRect();
  hovercard.dataset.left = String(rect.left);
  hovercard.dataset.top = String(rect.top);
  hovercard.dataset.bottom = String(rect.bottom);
  vscode.postMessage({ type: 'previewLink', href: link.href, kind: link.kind });
});
function hideHovercard() {
  hoveredHref = '';
  hovercard.hidden = true;
}
// The hover card is for pointer exploration; typing or opening a popover dismisses it.
document.addEventListener('keydown', () => hideHovercard(), true);
document.addEventListener('mouseout', (event) => {
  if (linkTarget(event.target)) {
    hoveredHref = '';
    hovercard.hidden = true;
  }
});
// Ctrl/Cmd+Click follows links; a plain click keeps placing the caret like any editor.
editorHost.addEventListener(
  'mousedown',
  (event) => {
    const link = linkTarget(event.target);
    if (!link || !(event.ctrlKey || event.metaKey) || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    vscode.postMessage({ type: 'openLink', href: link.href, kind: link.kind });
  },
  true,
);
readonlyView.addEventListener('click', (event) => {
  const link = linkTarget(event.target);
  if (!link) return;
  event.preventDefault();
  if (link.href.startsWith('#wiki:')) return;
  vscode.postMessage({ type: 'openLink', href: link.href, kind: link.kind });
});

function openPageMenu(anchor: HTMLElement) {
  const command = (id: string, text: string, name: IconName, commandId: string): Command => ({
    id,
    label: text,
    icon: name,
    group: '',
    run: () => vscode.postMessage({ type: 'command', command: commandId }),
  });
  const items = [
    command('props', 'Page properties…', 'edit', 'notespace.pageProperties'),
    command(
      'context',
      `Outline and backlinks${context?.backlinks ? ` (${context.backlinks})` : ''}`,
      'preview',
      'notespace.focusContext',
    ),
    command('preview', 'Open reader preview', 'eye', 'notespace.preview'),
    command('copy', 'Copy page link', 'link', 'notespace.copyLink'),
    command('fav', 'Toggle favorite', 'star', 'notespace.toggleFavorite'),
  ];
  const wasBlocked = blocked;
  blocked = false;
  openMenu(anchor, items, { compact: true });
  blocked = wasBlocked;
  menu.style.left = `${Math.max(8, anchor.getBoundingClientRect().right - menu.offsetWidth)}px`;
}
function hideFloating() {
  closeMenu();
  bubble.hidden = true;
  linkbox.hidden = true;
}
document.addEventListener('mousedown', (event) => {
  const target = event.target as globalThis.Node;
  if (!menu.hidden && !menu.contains(target)) closeMenu();
  if (!linkbox.hidden && !linkbox.contains(target)) linkbox.hidden = true;
});
function flash(button: HTMLElement, name: IconName) {
  const original = button.innerHTML;
  button.replaceChildren(svg(name));
  setTimeout(() => (button.innerHTML = original), 1200);
}

// ---------------------------------------------------------------------------------------------
// Keyboard: Save, history and block moves stay inside Studio
// ---------------------------------------------------------------------------------------------
document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const modKey = event.ctrlKey || event.metaKey;
  if (modKey && key === 's') {
    event.preventDefault();
    event.stopPropagation();
    requestAction('save');
    return;
  }
  // ProseMirror already handled undo/redo; keep VS Code from undoing the document a second time.
  if (modKey && (key === 'z' || key === 'y')) {
    event.stopPropagation();
    if (!(event.target instanceof Element && event.target.closest('.ProseMirror'))) {
      event.preventDefault();
      requestHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }
    return;
  }
  if (!(event.target instanceof Element) || !event.target.closest('.ProseMirror')) return;
  if (modKey && key === 'k') {
    event.preventDefault();
    event.stopPropagation();
    openLinkBox();
  } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !blocked) {
    event.preventDefault();
    event.stopPropagation();
    moveBlock(event.key === 'ArrowUp' ? -1 : 1);
  }
});

/**
 * Pasted or dropped images are saved to the wiki's assets by the host and inserted as
 * `![image.png](…/assets/images/image.png)`, named after the clipboard file.
 */
function sendImages(files: FileList | null | undefined): boolean {
  const images = Array.from(files || []).filter(
    (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type) && f.size <= 20 * 1024 * 1024,
  );
  for (const file of images) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || '').split(',')[1];
      if (base64)
        vscode.postMessage({ type: 'pasteImage', mime: file.type, base64, name: file.name });
    };
    reader.readAsDataURL(file);
  }
  return images.length > 0;
}
editorHost.addEventListener(
  'drop',
  (event) => {
    if (blocked || !event.dataTransfer?.files.length) return;
    const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!Array.from(event.dataTransfer.files).some((f) => f.type.startsWith('image/'))) return;
    event.preventDefault();
    event.stopPropagation();
    if (at) editor.commands.setTextSelection(at.pos);
    sendImages(event.dataTransfer.files);
  },
  true,
);

// Paste: URLs over a selection become links; images go to wiki assets; Markdown text is parsed.
editorHost.addEventListener(
  'paste',
  (event) => {
    if (blocked) return;
    const data = event.clipboardData;
    const plain = data?.getData('text/plain') || '';
    if (sendImages(data?.files)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const url = plain.trim();
    if (/^(https?:\/\/|mailto:)\S+$/i.test(url) && !editor.state.selection.empty) {
      event.preventDefault();
      event.stopPropagation();
      chain().setLink({ href: url }).run();
      return;
    }
    if (
      !data?.types.includes('text/html') &&
      !editor.isActive('codeBlock') &&
      /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|:::|\|.*\|)|\[\[|\*\*|\]\(/.test(plain)
    ) {
      event.preventDefault();
      event.stopPropagation();
      chain()
        .insertContent(editor.markdown!.parse(plain).content || [])
        .run();
    }
  },
  true,
);

// ---------------------------------------------------------------------------------------------
// Caret hand-off with Code mode
// ---------------------------------------------------------------------------------------------
function caretContext(): { text: string; ratio: number } {
  const { $from } = editor.state.selection;
  const block = $from.depth
    ? $from.node(Math.min($from.depth, Math.max(1, $from.depth)))
    : editor.state.doc;
  const text = block.isTextblock ? block.textContent : $from.parent.textContent;
  return {
    text: text.slice(0, 200),
    ratio: editor.state.selection.from / Math.max(1, editor.state.doc.content.size),
  };
}
function reveal(text: string, ratio: number, select: boolean) {
  const needle = text.trim().slice(0, 60);
  if (!needle) return;
  const target = ratio * editor.state.doc.content.size;
  let best: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (
      node.textContent.includes(needle) &&
      (best === undefined || Math.abs(pos - target) < Math.abs(best - target))
    )
      best = pos;
    return false;
  });
  if (best === undefined) return;
  const dom = editor.view.nodeDOM(best);
  if (dom instanceof HTMLElement) {
    const rect = dom.getBoundingClientRect();
    if (rect.top < 90 || rect.bottom > window.innerHeight) dom.scrollIntoView({ block: 'center' });
  }
  if (select)
    editor
      .chain()
      .setTextSelection(best + 1)
      .focus(undefined, { scrollIntoView: false })
      .run();
}
let caretTimer: number | undefined;
editor.on('selectionUpdate', () => {
  viewState.selection = editor.state.selection.from;
  vscode.setState(viewState);
  updateToolbar();
  updateMenus();
  updateBubble();
  const { from, to } = editor.state.selection;
  for (const view of codeViews) {
    const pos = view.pos();
    view.el.classList.toggle(
      'editing',
      pos !== undefined && editor.isFocused && from > pos && to < pos + view.size(),
    );
  }
  if (context?.mode === 'split' && editor.isFocused) {
    window.clearTimeout(caretTimer);
    caretTimer = window.setTimeout(
      () => vscode.postMessage({ type: 'caret', ...caretContext() }),
      200,
    );
  }
});
editor.on('blur', () => setTimeout(updateBubble, 0));
editor.on('focus', updateBubble);
window.addEventListener(
  'scroll',
  () => {
    viewState.scroll = window.scrollY;
    vscode.setState(viewState);
    bubble.hidden = true;
    hovercard.hidden = true;
  },
  { passive: true },
);

/** Run buttons follow the host's runner availability (setting, trust, installed runtimes). */
function syncRunButton(button: HTMLElement) {
  const runtime = context?.runners?.[button.dataset.language || ''];
  button.hidden = !runtime;
  button.title = runtime ? `Run with ${runtime}` : '';
}

function renderContext(next: Context) {
  context = next;
  document.querySelectorAll<HTMLElement>('button.run').forEach(syncRunButton);
  // VS Code already shows the file path in its breadcrumbs; show wiki context instead.
  crumbs.replaceChildren();
  crumbs.append(h('span', { class: 'wiki', text: next.wiki, title: `Wiki: ${next.wiki}` }));
  const links = h(
    'button',
    {
      type: 'button',
      class: 'chip',
      title: 'Show outline, backlinks and links',
      'aria-label': `${next.backlinks} backlink${next.backlinks === 1 ? '' : 's'}`,
    },
    svg('link', 13),
    h('span', {
      text: next.backlinks
        ? `${next.backlinks} backlink${next.backlinks === 1 ? '' : 's'}`
        : 'No backlinks',
    }),
  );
  links.addEventListener('click', () =>
    vscode.postMessage({ type: 'command', command: 'notespace.focusContext' }),
  );
  crumbs.append(links);
  document.title = next.title;
  const active = next.mode === 'split' ? 'split' : 'studio';
  modes
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.id === active)));
}

// ---------------------------------------------------------------------------------------------
// Messages from the extension host
// ---------------------------------------------------------------------------------------------
window.addEventListener('message', (event) => {
  const m = event.data;
  if (!m || typeof m !== 'object') return;
  switch (m.type) {
    case 'init':
    case 'document': {
      if (typeof m.text !== 'string' || typeof m.base !== 'string') return;
      if (m.images && typeof m.images === 'object') Object.assign(imageUrls, m.images);
      if (m.context) renderContext(m.context);
      if (loaded && (pending || inFlight || conflicted)) return;
      base = m.base;
      dirty = !!m.dirty;
      load(m.text, m.reason, m.fallback);
      return;
    }
    case 'ack': {
      inFlight = false;
      base = m.base;
      baseline = sentNext;
      baseBody = sentBody;
      dirty = m.dirty !== false;
      if (m.images && typeof m.images === 'object') Object.assign(imageUrls, m.images);
      if (typeof m.resync === 'string' && !pending) {
        base = m.version;
        baseBody = bodyOf(m.resync);
        replaceDocument(baseBody);
        baseline = editor.getMarkdown();
      }
      if (pending) send();
      else {
        settled();
        flushActions();
      }
      return;
    }
    case 'dirty':
      dirty = !!m.dirty;
      if (!pending && !inFlight && !saveInFlight && !blocked) settled();
      return;
    case 'saved':
      saveInFlight = false;
      dirty = !m.saved;
      if (m.saved) setState('Saved to disk', 'saved');
      else setState('Save failed', 'error');
      if (pending && !inFlight) send();
      else flushActions();
      return;
    case 'flush':
      window.clearTimeout(timer);
      if (pending && !inFlight) send();
      {
        const wait = () =>
          inFlight || pending ? setTimeout(wait, 30) : vscode.postMessage({ type: 'flushed' });
        wait();
      }
      return;
    case 'conflict':
      inFlight = false;
      pending = false;
      conflicted = true;
      actionQueue.clear();
      setReadOnly(
        true,
        `${m.reason || 'The Markdown source changed.'} Your Studio version is still shown; copy it before reloading.`,
      );
      return;
    case 'context':
      if (m.context) renderContext(m.context);
      return;
    case 'width':
      document.body.dataset.width = String(m.width);
      return;
    case 'reveal':
      if (typeof m.text === 'string') reveal(m.text, Number(m.ratio) || 0, !!m.select);
      return;
    case 'scrollToHeading': {
      const slug = String(m.slug || '');
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && slugOf(node.textContent) === slug) {
          const dom = editor.view.nodeDOM(pos);
          if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start' });
          editor
            .chain()
            .setTextSelection(pos + 1)
            .focus(undefined, { scrollIntoView: false })
            .run();
          return false;
        }
        return true;
      });
      return;
    }
    case 'draftCopied':
      setState('Studio Markdown copied', 'error');
      return;
    case 'runResult':
      runWaiters.get(m.id)?.(m);
      runWaiters.delete(m.id);
      return;
    case 'snippet':
      if (typeof m.key === 'string')
        islands.handleSnippet(m.key, typeof m.html === 'string' ? m.html : '');
      return;
    case 'diagram':
      diagramWaiters.get(m.id)?.(m);
      diagramWaiters.delete(m.id);
      return;
    case 'theme':
      return;
    case 'linkPreview': {
      if (m.href !== hoveredHref || !linkbox.hidden || !menu.hidden) return;
      hovercard.replaceChildren();
      if (m.external)
        hovercard.append(h('strong', { text: 'External link' }), h('small', { text: m.href }));
      else if (m.missing)
        hovercard.append(
          h('strong', { class: 'missing', text: 'Page not found' }),
          h('small', { text: m.href }),
          h('p', { text: 'Ctrl+Click to create it.' }),
        );
      else
        hovercard.append(
          h('strong', { text: m.title }),
          h('small', { text: m.path || '' }),
          h('p', { text: m.excerpt || 'Empty page' }),
        );
      if (!m.missing)
        hovercard.append(
          h('div', { class: 'hint', text: `${isMac ? '⌘' : 'Ctrl'}+Click to open` }),
        );
      place(hovercard, {
        left: Number(hovercard.dataset.left),
        top: Number(hovercard.dataset.top),
        bottom: Number(hovercard.dataset.bottom),
      });
      return;
    }
    case 'pageSuggestions':
      if (!Array.isArray(m.pages)) return;
      if (m.purpose === 'link') {
        if (linkbox.hidden) return;
        linkPages = m.pages;
        linkIndex = linkPages.length && !/[/:.]/.test(linkInput.value) && linkInput.value ? 0 : -1;
        renderLinkResults();
      } else if (menuMode === 'wiki' && m.query === wikiQuery) showWikiResults(m.pages);
      return;
    case 'imageImported':
      if (typeof m.target !== 'string') return;
      if (typeof m.url === 'string') imageUrls[m.target] = m.url;
      chain()
        .setImage({ src: m.target, alt: typeof m.alt === 'string' ? m.alt : '' })
        .run();
      return;
    case 'componentPath':
      if (typeof m.requestId === 'number' && typeof m.path === 'string')
        inspector.pathPicked(m.requestId, m.path);
      return;
    case 'embedPicked':
      if (typeof m.language === 'string' && typeof m.path === 'string')
        chain()
          .insertContent({
            type: 'codeBlock',
            attrs: { language: m.language },
            content: [{ type: 'text', text: `path: ${m.path}` }],
          })
          .run();
      return;
    case 'mediaImported':
      if (typeof m.source === 'string') insertInlineIsland(m.source, 'media', false);
      return;
    case 'imageAltChosen':
      if (typeof m.alt === 'string') chain().updateAttributes('image', { alt: m.alt }).run();
      return;
    case 'attachmentImported':
      if (typeof m.target === 'string' && typeof m.label === 'string')
        chain()
          .insertContent({
            type: 'text',
            text: m.label,
            marks: [{ type: 'link', attrs: { href: m.target } }],
          })
          .run();
      return;
  }
});
void Fragment;
void wikiResults;
updateToolbar();
vscode.postMessage({ type: 'ready' });

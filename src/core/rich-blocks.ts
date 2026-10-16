import MarkdownIt from 'markdown-it';
/** Internal documentation blocks. Their Markdown source remains the durable format. */
export const calloutKinds = [
  'note',
  'abstract',
  'info',
  'tip',
  'success',
  'question',
  'warning',
  'failure',
  'danger',
  'bug',
  'example',
  'quote',
  'important',
] as const;

export const layoutKinds = [
  'hero',
  'tabs',
  'tab',
  'accordion',
  'details',
  'spoiler',
  'stepper',
  'step',
  'timeline',
  'event',
  'card',
  'grid',
  'nav-card',
  'gallery',
  'caption',
] as const;

export const richBlockKinds = [...calloutKinds, ...layoutKinds] as const;
export type RichBlockKind = (typeof richBlockKinds)[number];
const kinds = new Set<string>(richBlockKinds);
const callouts = new Set<string>(calloutKinds);

/**
 * Block color presets. Documents store only explicit overrides, by id (`{color=amber}` at the
 * end of the opening line); the actual colors come from theme-aware design tokens.
 */
export const blockColors = [
  'blue',
  'cyan',
  'teal',
  'green',
  'amber',
  'red',
  'pink',
  'purple',
  'indigo',
  'gray',
] as const;
export type BlockColor = (typeof blockColors)[number];
const colorIds = new Set<string>(blockColors);

/** Semantic default color of each block type. */
export function defaultBlockColor(kind: string): BlockColor {
  switch (kind) {
    case 'note':
    case 'info':
    case 'abstract':
    case 'question':
      return 'blue';
    case 'tip':
    case 'success':
      return 'green';
    case 'warning':
      return 'amber';
    case 'danger':
    case 'failure':
    case 'bug':
      return 'red';
    case 'details':
    case 'spoiler':
    case 'accordion':
    case 'important':
      return 'purple';
    case 'nav-card':
      return 'cyan';
    case 'example':
      return 'indigo';
    default:
      return 'gray';
  }
}

export interface RichBlock {
  kind: RichBlockKind;
  title: string;
  collapsed: boolean;
  /** Explicit color override; absent means the semantic default. */
  color?: BlockColor;
  body: string;
  raw: string;
}

export function richBlockHeader(line: string): Omit<RichBlock, 'body' | 'raw'> | undefined {
  const match = /^:::([a-z][a-z-]*)(?:[ \t]+(.*))?[ \t]*$/i.exec(line.replace(/\r$/, ''));
  if (!match || !kinds.has(match[1].toLowerCase())) return;
  let rest = (match[2] || '').trim();
  // Optional attribute block: only `{color=<preset>}` is understood; anything else stays source.
  let color: BlockColor | undefined;
  const attrs = /(?:^|\s)\{([^{}]*)\}$/.exec(rest);
  if (attrs) {
    const pair = /^\s*color\s*=\s*([a-z]+)\s*$/.exec(attrs[1]);
    if (!pair || !colorIds.has(pair[1])) return;
    color = pair[1] as BlockColor;
    rest = rest.slice(0, attrs.index).trim();
  }
  const state = /(?:^|\s)(collapsed|open)$/i.exec(rest);
  if (state) rest = rest.slice(0, state.index).trim();
  if (rest && !rest.startsWith('"')) return;
  let title = rest;
  if (rest.startsWith('"')) {
    try {
      title = JSON.parse(rest);
    } catch {
      return;
    }
    if (typeof title !== 'string') return;
  }
  if (title.length > 160 || /[\r\n]/.test(title)) return;
  return {
    kind: match[1].toLowerCase() as RichBlockKind,
    title,
    collapsed: state?.[1].toLowerCase() === 'collapsed',
    ...(color ? { color } : {}),
  };
}

/** Reads one balanced ::: container; fences inside it do not change nesting. */
export function parseRichBlock(source: string): RichBlock | undefined {
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) || [];
  const first = richBlockHeader((lines[0] || '').replace(/\n$/, ''));
  if (!first) return;
  let depth = 1;
  let fence = '';
  let offset = lines[0]!.length;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r?\n$/, '');
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = fenceMatch[1];
      else if (fence[0] === marker && fenceMatch[1].length >= fence.length) fence = '';
    } else if (!fence) {
      if (/^:::[ \t]*$/.test(line)) {
        depth--;
        if (!depth)
          return {
            ...first,
            body: lines.slice(1, i).join(''),
            raw: source.slice(0, offset + lines[i].length),
          };
      } else if (/^:::[a-z]/i.test(line)) {
        depth++;
      }
    }
    offset += lines[i].length;
  }
}

export function richBlockSource(
  kind: RichBlockKind,
  body: string,
  title = '',
  collapsed = false,
  color?: string,
): string {
  // Explicit values are kept as written, even when they equal the default.
  const override = color && colorIds.has(color) ? color : '';
  const heading = `:::${kind}${title ? ` ${JSON.stringify(title)}` : ''}${collapsed ? ' collapsed' : ''}${override ? ` {color=${override}}` : ''}`;
  return `${heading}\n${body.trim()}\n:::`;
}

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const label = (kind: string): string =>
  kind.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Group containers label themselves with their title only; a generic "Grid" heading adds noise. */
const groups = new Set(['tabs', 'stepper', 'timeline', 'grid', 'gallery']);
const listParents: Record<string, string> = { step: 'stepper', event: 'timeline' };

type BlockHeader = Omit<RichBlock, 'body' | 'raw'>;

/** Opening and closing HTML for one container; the body is rendered between them. */
function blockParts(block: BlockHeader, parent?: string): [string, string] {
  const [open, close] = blockPartsFor(block, parent);
  // The override travels as data-color; CSS maps it (and each kind's default) to theme tokens.
  return [
    block.color ? open.replace(/^<([a-z]+)/, `<$1 data-color="${block.color}"`) : open,
    close,
  ];
}
function blockPartsFor(block: BlockHeader, parent?: string): [string, string] {
  const kind = block.kind;
  const title = escape(block.title || label(kind));
  const heading = groups.has(kind) && !block.title ? '' : `<div class="rich-title">${title}</div>`;
  if (kind === 'caption')
    return [
      '<figure class="rich-block rich-caption"><div class="rich-content">',
      `</div><figcaption>${title}</figcaption></figure>`,
    ];
  if (kind === 'gallery')
    return [
      `<section class="rich-block rich-gallery" role="group" aria-label="${title}">${heading}`,
      '</section>',
    ];
  // Steps and events are list items of their stepper/timeline, so the order is announced.
  if (listParents[kind] && parent === listParents[kind])
    return [
      `<li class="rich-block rich-${kind}"><div class="rich-title">${title}</div><div class="rich-content">`,
      '</div></li>',
    ];
  if (kind === 'stepper' || kind === 'timeline')
    return [
      `<section class="rich-block rich-${kind}" aria-label="${title}">${heading}<ol class="rich-content">`,
      '</ol></section>',
    ];
  if (block.collapsed || ['accordion', 'details', 'spoiler', 'tab'].includes(kind))
    return [
      `<details class="${callouts.has(kind) ? 'callout ' : ''}rich-block rich-${kind}"${block.collapsed ? '' : ' open'}><summary>${title}</summary><div class="rich-content">`,
      '</div></details>',
    ];
  const tag = callouts.has(kind) ? 'aside' : 'section';
  const role = callouts.has(kind) ? ' role="note"' : '';
  const classes = callouts.has(kind)
    ? `callout ${kind} rich-block rich-${kind}`
    : `rich-block rich-${kind}`;
  const group = groups.has(kind) ? ` aria-label="${title}"` : '';
  return [
    `<${tag} class="${classes}"${role}${group}>${heading}<div class="rich-content">`,
    `</div></${tag}>`,
  ];
}

function blockHtml(block: RichBlock, inner: string, parent?: string): string {
  const [open, close] = blockParts(block, parent);
  return open + inner + close;
}

/**
 * markdown-it block rule for `:::kind` containers. The whole page is parsed in one pass, so
 * footnotes, reference links and abbreviations work across container boundaries.
 */
export function richBlockPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    'fence',
    'rich_block',
    (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const header = richBlockHeader(state.src.slice(start, state.eMarks[startLine]));
      if (!header) return false;
      // Find the balanced closing line; fences inside the body do not count.
      let depth = 1,
        fence = '',
        line = startLine + 1;
      for (; line < endLine; line++) {
        const lineStart = state.bMarks[line] + state.tShift[line];
        if (state.sCount[line] < state.blkIndent) break;
        const text = state.src.slice(lineStart, state.eMarks[line]);
        const fenceMatch = /^(`{3,}|~{3,})/.exec(text);
        if (fenceMatch) {
          if (!fence) fence = fenceMatch[1];
          else if (fence[0] === fenceMatch[1][0] && fenceMatch[1].length >= fence.length)
            fence = '';
        } else if (!fence) {
          if (/^:::[ \t]*$/.test(text)) {
            if (!--depth) break;
          } else if (/^:::[a-z]/i.test(text)) depth++;
        }
      }
      if (depth) return false;
      if (silent) return true;
      const oldParent = state.parentType,
        oldLineMax = state.lineMax;
      state.parentType = 'container' as typeof state.parentType;
      state.lineMax = line;
      const open = state.push('rich_open', 'div', 1);
      open.block = true;
      open.meta = header;
      open.map = [startLine, line];
      state.md.block.tokenize(state, startLine + 1, line);
      const close = state.push('rich_close', 'div', -1);
      close.block = true;
      close.meta = header;
      state.parentType = oldParent;
      state.lineMax = oldLineMax;
      state.line = line + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );
  md.renderer.rules.rich_open = (tokens, i, _options, env: { richStack?: string[] }) => {
    const stack = (env.richStack ||= []);
    const header = tokens[i].meta as BlockHeader;
    const html = blockParts(header, stack.at(-1))[0];
    stack.push(header.kind);
    return html;
  };
  md.renderer.rules.rich_close = (tokens, i, _options, env: { richStack?: string[] }) => {
    const stack = (env.richStack ||= []);
    stack.pop();
    return blockParts(tokens[i].meta as BlockHeader, stack.at(-1))[1];
  };
}

/** Renders recognized blocks recursively and sends ordinary Markdown to one shared renderer. */
export function renderRichBlocks(
  source: string,
  renderMarkdown: (source: string) => string,
  parent?: string,
): string {
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) || [];
  let html = '';
  let plain = '';
  let fence = '';
  for (let i = 0; i < lines.length;) {
    const line = lines[i].replace(/\r?\n$/, '');
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fence[0] === fenceMatch[1][0] && fenceMatch[1].length >= fence.length) fence = '';
    }
    const block = !fence && !fenceMatch ? parseRichBlock(lines.slice(i).join('')) : undefined;
    if (block) {
      html += renderMarkdown(plain);
      plain = '';
      html += blockHtml(block, renderRichBlocks(block.body, renderMarkdown, block.kind), parent);
      let consumed = 0;
      while (i < lines.length && consumed < block.raw.length) consumed += lines[i++].length;
    } else {
      plain += lines[i++];
    }
  }
  return html + renderMarkdown(plain);
}

import MarkdownIt from 'markdown-it';
import { parsePage, wikiPlugin } from './markdown';
import {
  blockIdPlugin,
  blockSource,
  dateLabel,
  markAnnotations,
  markEnd,
  markStart,
  mentionPlugin,
  sectionSource,
} from './markdown-extras';
import { Page } from './model';
import { WikiIndex } from './index';
import { isExternal } from './paths';
import { richBlockPlugin } from './rich-blocks';
import { pageWithIncludes } from './includes';
import { richInlinePlugin } from './rich-inline';
import { documentCss, tokensCss } from './design';
import { chartCss } from './charts';
import { notebookCss } from './notebook';
import { canvasCss } from './canvas';
import { apiCss } from './openapi';
import { parseCodeRef } from './code-refs';
import { parseTasks, daysBetween } from './tasks';
import { dashboardCss } from './dashboard';
import { httpBlockCss, renderHttpBlock } from './http/render';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import yamlLanguage from 'highlight.js/lib/languages/yaml';
for (const [name, grammar] of Object.entries({
  javascript,
  typescript,
  python,
  bash,
  json,
  css,
  xml,
  markdown: markdownLanguage,
  yaml: yamlLanguage,
}))
  hljs.registerLanguage(name, grammar);
for (const [alias, name] of Object.entries({
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  html: 'xml',
  md: 'markdown',
  yml: 'yaml',
}))
  hljs.registerAliases(alias, { languageName: name });
/** Syntax-highlighted HTML for a code sample (escaped text for unknown languages). */
export const highlightCode = (language: string, code: string): string =>
  hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : escapeHtml(code);
export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const safeExternal = (s: string): boolean => /^(https?:|mailto:)/i.test(s);
export interface RenderOptions {
  pageHref: (page: Page, anchor?: string) => string;
  imageHref?: (target: string) => string | undefined;
  mediaHref?: (target: string) => string | undefined;
  assetHref?: (target: string) => string | undefined;
  /** Links to source files (code references); without it they render as plain marked text. */
  codeHref?: (target: string) => string | undefined;
  includeWarning?: (message: string) => void;
  /** Renders ```tasks / ```collection blocks; without it they stay code. */
  collection?: (kind: 'tasks' | 'collection', source: string) => string;
  /** Renders ```chart blocks (see core/charts.ts); without it they stay code. */
  chart?: (source: string) => string;
  /** Renders ```notebook embeds (saved outputs only). */
  notebook?: (source: string) => string;
  /** Renders ```canvas embeds as static previews. */
  canvas?: (source: string) => string;
  /** Renders ```openapi embeds as static API references. */
  openapi?: (source: string) => string;
  /** Renders ```dashboard embeds as snapshots. */
  dashboard?: (source: string) => string;
  /** Renders ```http blocks interactively; without it they are static request cards. */
  http?: (source: string) => string;
  /** `[label](template:Name)` buttons create a page from a template (Reader and Wiki only). */
  templates?: boolean;
  /** Today in the wiki's time zone: due dates read as Today, Tomorrow or overdue. */

  today?: string;
  /**
   * The planner key of the task written on a body line; tasks with a key get a checkbox that
   * can be clicked (`.task-check[data-task-key]`), the others a read-only one.
   */
  taskKey?: (bodyLine: number, raw: string) => string | undefined;
}

/** Task metadata written as plain words (`due:`, `priority:`, `@person`, `^id`…). */
const taskWords =
  /(^|\s)(?:(?:due|start|done|priority|status|repeat|project|order|board|col):\S+|@[\p{L}\p{N}_.-]+|\^[A-Za-z0-9-]{1,32}|#([\p{L}\p{N}_/-]+))(?=\s|$)/gu;

/**
 * Task list items: a checkbox instead of `[ ]`, and the metadata words as badges (due date,
 * priority, person, project, repeat, status) instead of raw text. Tags become chips.
 */
function taskListPlugin(md: MarkdownIt, body: string, options: RenderOptions) {
  const lines = body.split('\n');
  md.core.ruler.push('task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      const item = tokens[i];
      const inline = tokens[i + 2];
      if (item.type !== 'list_item_open' || inline.type !== 'inline' || !item.map) continue;
      const box = /^\[([ xX])\]\s+/.exec(inline.content);
      const first = inline.children?.[0];
      if (!box || !first || first.type !== 'text' || !first.content.startsWith(box[0].trimEnd()))
        continue;
      const raw = (lines[item.map[0]] || '').replace(/\r$/, '');
      const task = parseTasks({ id: '', path: '', title: '', text: raw })[0];
      if (!task) continue;
      first.content = first.content.slice(box[0].trimEnd().length).replace(/^\s+/, '');
      // Metadata words leave the text; tags stay as chips.
      const children: typeof inline.children = [];
      for (const child of inline.children!) {
        if (child.type !== 'text') {
          children.push(child);
          continue;
        }
        let last = 0;
        for (const m of child.content.matchAll(taskWords)) {
          const start = m.index! + m[1].length;
          const before = new state.Token('text', '', 0);
          before.content = child.content.slice(last, m.index! + m[1].length);
          children.push(before);
          if (m[2]) {
            const tag = new state.Token('html_inline', '', 0);
            tag.content = `<span class="task-tag">#${escapeHtml(m[2])}</span>`;
            children.push(tag);
          }
          last = start + m[0].length - m[1].length;
        }
        const rest = new state.Token('text', '', 0);
        rest.content = child.content.slice(last);
        children.push(rest);
      }
      while (children.length && children[children.length - 1].type === 'text') {
        const end = children[children.length - 1];
        end.content = end.content.replace(/\s+$/, '');
        if (end.content) break;
        children.pop();
      }
      const key = options.taskKey?.(item.map[0], raw);
      const done = task.status === 'done';
      const open = new state.Token('html_inline', '', 0);
      open.content = `<input type="checkbox" class="task-check"${done ? ' checked' : ''}${key ? ` data-task-key="${escapeHtml(encodeURIComponent(key))}"` : ' disabled'} aria-label="${escapeHtml(task.title || 'Task')}"><span class="task-text">`;
      const badges: string[] = [];
      if (task.due) {
        const diff = options.today ? daysBetween(options.today, task.due.slice(0, 10)) : NaN;
        const label =
          diff === 0
            ? 'Today'
            : diff === 1
              ? 'Tomorrow'
              : diff === -1
                ? 'Yesterday'
                : task.due.slice(0, 10);
        const time = task.due.length > 10 ? ` ${task.due.slice(11)}` : '';
        badges.push(
          `<span class="task-badge due${!done && diff < 0 ? ' overdue" data-tone="red' : !done && diff === 0 ? ' today" data-tone="orange' : ''}" title="Due ${escapeHtml(task.due)}">${escapeHtml(label + time)}</span>`,
        );
      }
      if (task.priority)
        badges.push(
          `<span class="task-badge priority ${task.priority}" data-tone="${{ high: 'red', medium: 'orange', low: 'blue' }[task.priority]}" title="Priority">${task.priority}</span>`,
        );
      if (task.status === 'doing' || task.status === 'blocked')
        badges.push(
          `<span class="task-badge status ${task.status}" data-tone="${task.status === 'doing' ? 'blue' : 'red'}">${task.status === 'doing' ? 'In progress' : 'Blocked'}</span>`,
        );
      if (task.assignee)
        badges.push(`<span class="task-badge person">@${escapeHtml(task.assignee)}</span>`);
      if (task.project)
        badges.push(`<span class="task-badge project">${escapeHtml(task.project)}</span>`);
      if (task.repeat)
        badges.push(
          `<span class="task-badge repeat" title="Repeats">↻ ${escapeHtml(task.repeat)}</span>`,
        );
      const close = new state.Token('html_inline', '', 0);
      close.content = `</span>${badges.length ? `<span class="task-badges">${badges.join('')}</span>` : ''}`;
      inline.children = [open, ...children, close];
      item.attrJoin('class', `task-list-item${done ? ' done' : ''}`);
      for (let j = i - 1; j >= 0; j--)
        if (
          (tokens[j].type === 'bullet_list_open' || tokens[j].type === 'ordered_list_open') &&
          tokens[j].level === item.level - 1
        ) {
          if (!tokens[j].attrGet('class')?.includes('contains-task-list'))
            tokens[j].attrJoin('class', 'contains-task-list');
          break;
        }
    }
  });
}
/** Embeds being rendered (`![[Page#^id]]` inside embeds stops at this depth). */
let embedDepth = 0;
const embedLine = /^ {0,3}!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\][ \t]*$/;

export function renderPage(page: Page, index: WikiIndex, options: RenderOptions): string {
  const contentPage = pageWithIncludes(page, index, options.includeWarning);
  // A line that is only `![[Page]]`, `![[Page#Heading]]` or `![[Page#^block]]` embeds that
  // content. Lines in code blocks are left alone.
  const embeds: string[] = [];
  let fence = '';
  const body = contentPage.body
    .split('\n')
    .map((line) => {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f)
        fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? '' : fence) : f[1];
      const m = !fence && embedLine.exec(line);
      if (!m) return line;
      const r = index.resolve(page, m[1].trim());
      if (!r.page || r.error) return line;
      embeds.push(renderEmbed(page, m[1].trim(), r.page, r.heading, index, options));
      return `${markStart}embed:${embeds.length - 1}${markEnd}`;
    })
    .join('\n');
  const renderedHeadings = contentPage.headings;
  const md = new MarkdownIt({ html: false, linkify: true });
  wikiPlugin(md);
  richInlinePlugin(md);
  richBlockPlugin(md);
  blockIdPlugin(md);
  taskListPlugin(md, body, options);
  mentionPlugin(md, options.today);
  annotationPlugin(md);
  md.renderer.rules.mention = (tokens, i) => {
    const meta = tokens[i].meta as { kind: string; date?: string; name?: string };
    if (meta.kind === 'date')
      return `<a class="mention mention-date" href="#date:${escapeHtml(meta.date!)}" title="${escapeHtml(meta.date!)}">${escapeHtml(dateLabel(meta.date!, options.today))}</a>`;
    return `<a class="mention mention-person" href="#person:${encodeURIComponent(meta.name!)}">@${escapeHtml(meta.name!)}</a>`;
  };
  md.renderer.rules.wiki_link = (tokens, i) => {
    const t = tokens[i],
      r = index.resolve(page, t.meta.target);
    // `[[Page#Heading]]` without a label reads as “Page › Heading”.
    const label = escapeHtml(
      r.page && !r.error && t.content === t.meta.target && t.meta.target.includes('#')
        ? `${r.page.title} › ${r.heading?.level === 0 ? 'block' : r.heading?.text || ''}`
        : t.content,
    );
    if (r.page && !r.error)
      return `<a href="${escapeHtml(options.pageHref(r.page, r.heading?.slug))}">${label}</a>`;
    return `<span class="broken-link" title="${escapeHtml(r.error || 'Unsupported wiki link')}">${label}</span>`;
  };
  md.renderer.rules.wiki_button = (tokens, i) => {
    const token = tokens[i];
    const target = String(token.meta.value || '');
    const label = escapeHtml(token.content);
    if (isExternal(target))
      return safeExternal(target)
        ? `<a class="doc-button" href="${escapeHtml(target)}" rel="noopener noreferrer">${label}</a>`
        : `<span class="broken-link">${label}</span>`;
    const resolved = index.resolve(page, target, 'markdown');
    return resolved.page && !resolved.error
      ? `<a class="doc-button" href="${escapeHtml(options.pageHref(resolved.page, resolved.heading?.slug))}">${label}</a>`
      : `<span class="broken-link" title="${escapeHtml(resolved.error || 'Missing page')}">${label}</span>`;
  };
  const defaultLink =
    md.renderer.rules.link_open ||
    ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
    const token = tokens[i],
      href = token.attrGet('href') || '';
    const template = /^template:(.{1,120})$/i.exec(href);
    if (template) {
      // Where pages cannot be created (exported sites) the label stays as plain text.
      if (options.templates) {
        token.attrSet('href', `#template:${encodeURIComponent(decodeURIComponent(template[1]))}`);
        token.attrSet('class', 'doc-button template-button');
        token.attrSet('title', `New page from the ${decodeURIComponent(template[1])} template`);
        return defaultLink(tokens, i, opts, env, self);
      }
      token.tag = 'span';
      token.attrs = [];
      for (let j = i + 1, depth = 1; j < tokens.length; j++) {
        if (tokens[j].type === 'link_open') depth++;
        if (tokens[j].type === 'link_close' && !--depth) {
          tokens[j].tag = 'span';
          break;
        }
      }
      return self.renderToken(tokens, i, opts);
    }
    if (isExternal(href)) {
      if (!safeExternal(href)) token.attrSet('href', '#');
      token.attrSet('rel', 'noopener noreferrer');
    } else if (parseCodeRef(href)) {
      const target = options.codeHref?.(href);
      token.attrSet('class', 'code-ref');
      token.attrSet('title', `Source: ${href}`);
      if (target) token.attrSet('href', target);
      else {
        // No place to open source files (static export): keep the label, drop the link.
        token.tag = 'span';
        token.attrs = (token.attrs || []).filter(([name]) => name !== 'href');
        for (let j = i + 1, depth = 1; j < tokens.length; j++) {
          if (tokens[j].type === 'link_open') depth++;
          if (tokens[j].type === 'link_close' && !--depth) {
            tokens[j].tag = 'span';
            break;
          }
        }
        return self.renderToken(tokens, i, opts);
      }
    } else {
      const asset = /\.(?:pdf|txt|csv|zip|docx|xlsx|pptx)(?:#.*)?$/i.test(href)
        ? options.assetHref?.(href)
        : undefined;
      if (asset) {
        token.attrSet('href', asset);
        return defaultLink(tokens, i, opts, env, self);
      }
      const r = index.resolve(page, href, 'markdown');
      token.attrSet('href', r.page && !r.error ? options.pageHref(r.page, r.heading?.slug) : '#');
      if (!r.page || r.error) {
        token.attrSet('class', 'broken-link');
        token.attrSet('title', r.error || 'Missing page');
      }
    }
    return defaultLink(tokens, i, opts, env, self);
  };
  md.renderer.rules.image = (tokens, i) => {
    const t = tokens[i],
      target = t.attrGet('src') || '';
    if (/\.(?:mp4|webm|mp3|ogg)(?:[#?].*)?$/i.test(target)) {
      const src = options.mediaHref?.(target);
      if (!src)
        return `<span class="image-placeholder">[Media unavailable: ${escapeHtml(t.content)}]</span>`;
      const audio = /\.(?:mp3|ogg)(?:[#?].*)?$/i.test(target);
      const tag = audio ? 'audio' : 'video';
      return `<${tag} controls preload="metadata" src="${escapeHtml(src)}" aria-label="${escapeHtml(t.content || 'Local media')}">${escapeHtml(t.content)}</${tag}>`;
    }
    const src = options.imageHref?.(target);
    return src
      ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(t.content)}" loading="lazy">`
      : `<span class="image-placeholder">[Image: ${escapeHtml(t.content)}]</span>`;
  };
  const originalFence =
    md.renderer.rules.fence ||
    ((tokens, i) => `<pre><code>${escapeHtml(tokens[i].content)}</code></pre>`);
  md.renderer.rules.fence = (tokens, i, opts, env, self) => {
    // `{ .yaml .annotate }` (attribute list) reads like `yaml annotate`.
    const info = tokens[i].info
      .trim()
      .replace(/^\{\s*([^}]*)\}\s*$/, (_, attrs: string) => attrs.replace(/(^|\s)\./g, '$1'));
    const lang = info.split(/\s+/)[0].toLowerCase();
    if (lang === 'chart' && options.chart) return options.chart(tokens[i].content);
    if (lang === 'notebook' && options.notebook) return options.notebook(tokens[i].content);
    if (lang === 'canvas' && options.canvas) return options.canvas(tokens[i].content);
    if (lang === 'openapi' && options.openapi) return options.openapi(tokens[i].content);
    if (lang === 'dashboard' && options.dashboard) return options.dashboard(tokens[i].content);
    if (lang === 'http')
      return options.http
        ? options.http(tokens[i].content)
        : renderHttpBlock(tokens[i].content, { interactive: false }, `http-${i}`);
    if ((lang === 'tasks' || lang === 'collection') && options.collection)
      return options.collection(lang, tokens[i].content);
    if (lang === 'mermaid')
      return `<pre class="mermaid" data-diagram="mermaid">${escapeHtml(tokens[i].content)}</pre>`;
    const language = /^[\w+-]{1,30}$/.test(lang) && hljs.getLanguage(lang) ? lang : '';
    const title = /(?:^|\s)title="([^"\r\n]{1,120})"/.exec(info)?.[1] || '';
    const lineStart = Number(/(?:^|\s)linenums="(\d{1,6})"/.exec(info)?.[1] || 0);
    const highlights = new Set<number>();
    const highlightSpec = /(?:^|\s)hl_lines="([\d, -]{1,100})"/.exec(info)?.[1] || '';
    for (const part of highlightSpec.split(/[ ,]+/)) {
      const range = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!range) continue;
      const start = Number(range[1]),
        end = Number(range[2] || range[1]);
      for (let line = start; line <= Math.min(end, start + 200); line++) highlights.add(line);
    }
    let code: string;
    const annotated = tokens[i].meta?.annotations as string | undefined;
    const source = annotated ? markAnnotations(tokens[i].content).code : tokens[i].content;
    if (lineStart || highlights.size) {
      const lines = source.replace(/\n$/, '').split('\n');
      const rendered = lines.map((line, position) => {
        const highlighted = language
          ? hljs.highlight(line, { language, ignoreIllegals: true }).value
          : escapeHtml(line);
        return `<span class="code-line${highlights.has(position + 1) ? ' highlighted' : ''}"${lineStart ? ` data-line="${lineStart + position}"` : ''}>${highlighted || ' '}</span>`;
      });
      code = `<pre><code class="${language ? `hljs language-${escapeHtml(language)}` : ''}">${rendered.join('')}</code></pre>`;
    } else
      code = language
        ? `<pre><code class="hljs language-${escapeHtml(language)}">${hljs.highlight(source, { language, ignoreIllegals: true }).value}</code></pre>`
        : annotated
          ? `<pre><code>${escapeHtml(source)}</code></pre>`
          : originalFence(tokens, i, opts, env, self);
    if (annotated)
      code = code.replace(
        // Highlighting may wrap the number in a span of its own.
        new RegExp(`${markStart}(?:<span[^>]*>)?(\\d{1,2})(?:</span>)?${markEnd}`, 'g'),
        (_, n: string) =>
          `<a class="code-annotation" href="#${annotated}-${n}" aria-label="Annotation ${n}">${n}</a>`,
      );
    return `<div class="code-block">${title ? `<div class="code-title">${escapeHtml(title)}</div>` : ''}<button class="copy-code" type="button" aria-label="Copy code">Copy</button>${code}</div>`;
  };
  let headingIndex = 0;
  md.renderer.rules.heading_open = (tokens, i, opts, _env, self) => {
    tokens[i].attrSet('id', renderedHeadings[headingIndex++]?.slug || '');
    return self.renderToken(tokens, i, opts);
  };
  md.renderer.rules.heading_close = (tokens, i, opts, _env, self) => {
    const slug = renderedHeadings[headingIndex - 1]?.slug;
    return `${slug ? `<a class="permalink" href="#${encodeURIComponent(slug)}" aria-label="Link to this heading">#</a>` : ''}${self.renderToken(tokens, i, opts)}`;
  };
  const html = md.render(body, {});
  return embeds.length
    ? html.replace(
        new RegExp(`<p>${markStart}embed:(\\d+)${markEnd}</p>`, 'g'),
        (_, n: string) => embeds[Number(n)] ?? '',
      )
    : html;
}

/**
 * Annotated code blocks (` ```yaml annotate `): the ordered list right after the block holds
 * the annotations; it gets ids the markers in the code link to.
 */
function annotationPlugin(md: MarkdownIt) {
  let blocks = 0;
  md.core.ruler.push('code_annotations', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== 'fence') continue;
      const info = t.info.replace(/[{}.]/g, ' ');
      if (!/(^|\s)annotate(\s|$)/.test(info)) continue;
      const key = `annotation-${++blocks}`;
      t.meta = { ...(t.meta || {}), annotations: key };
      const list = tokens[i + 1];
      if (list?.type !== 'ordered_list_open') continue;
      list.attrJoin('class', 'code-annotations');
      let n = Number(list.attrGet('start') || 1);
      for (let j = i + 2, depth = 0; j < tokens.length; j++) {
        if (tokens[j].type === 'ordered_list_open' || tokens[j].type === 'bullet_list_open')
          depth++;
        if (tokens[j].type === 'ordered_list_close' || tokens[j].type === 'bullet_list_close') {
          if (!depth--) break;
        }
        if (tokens[j].type === 'list_item_open' && !depth) tokens[j].attrSet('id', `${key}-${n++}`);
      }
    }
  });
}

/** An embedded page, section or block, with a link to where it comes from. */
function renderEmbed(
  from: Page,
  target: string,
  page: Page,
  heading: { slug: string; offset: number; level: number } | undefined,
  index: WikiIndex,
  options: RenderOptions,
): string {
  const href = escapeHtml(options.pageHref(page, heading?.slug));
  const label = escapeHtml(
    heading ? `${page.title} › ${heading.level ? target.split('#')[1] : 'block'}` : page.title,
  );
  if (embedDepth >= 3 || (page.id === from.id && !heading))
    return `<p class="embed-unavailable"><a href="${href}">${label}</a> (embedded too deeply)</p>`;
  const bodyOffset = page.text.length - page.body.length;
  const source = !heading
    ? page.body
    : heading.level === 0
      ? blockSource(page.body, heading.slug.replace(/^block-/, ''))
      : sectionSource(page.body, heading.offset - bodyOffset);
  if (source === undefined) return '';
  embedDepth++;
  try {
    const sub = { ...parsePage(page.root, page.path, page.uri, source), id: page.id };
    const inner = renderPage(sub, index, { ...options, taskKey: undefined });
    return `<div class="embed" data-embed="${escapeHtml(page.id)}"><a class="embed-source" href="${href}">${label}</a><div class="embed-body">${inner}</div></div>`;
  } finally {
    embedDepth--;
  }
}
/** Styles of a rendered page (`.doc`) and its embedded blocks, without page chrome. */
export const pageCss = `${documentCss}
${chartCss}
${notebookCss}
${canvasCss}
${apiCss}
${dashboardCss}
${httpBlockCss}`;
/** Base page styles plus the shared design system; used by the reader, dashboard and export. */
export const contentCss = `${tokensCss}
html{background:var(--ws-bg)}
body{margin:0;background:var(--ws-bg);color:var(--ws-fg);font-family:var(--ws-font);font-size:var(--ws-ui-size);line-height:1.5;-webkit-font-smoothing:antialiased}
.muted{color:var(--ws-muted)}
${pageCss}`;
export function htmlDocument(title: string, content: string, css = contentCss): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main class="doc">${content}</main></body></html>`;
}

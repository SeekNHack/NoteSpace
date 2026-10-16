import MarkdownIt from 'markdown-it';
import { wikiPlugin } from './markdown';
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
}
export function renderPage(page: Page, index: WikiIndex, options: RenderOptions): string {
  const contentPage = pageWithIncludes(page, index, options.includeWarning);
  const body = contentPage.body;
  const renderedHeadings = contentPage.headings;
  const md = new MarkdownIt({ html: false, linkify: true });
  wikiPlugin(md);
  richInlinePlugin(md);
  richBlockPlugin(md);
  md.renderer.rules.wiki_link = (tokens, i) => {
    const t = tokens[i],
      r = index.resolve(page, t.meta.target);
    const label = escapeHtml(t.content);
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
    const info = tokens[i].info.trim();
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
    if (lineStart || highlights.size) {
      const lines = tokens[i].content.replace(/\n$/, '').split('\n');
      const rendered = lines.map((line, position) => {
        const highlighted = language
          ? hljs.highlight(line, { language, ignoreIllegals: true }).value
          : escapeHtml(line);
        return `<span class="code-line${highlights.has(position + 1) ? ' highlighted' : ''}"${lineStart ? ` data-line="${lineStart + position}"` : ''}>${highlighted || ' '}</span>`;
      });
      code = `<pre><code class="${language ? `hljs language-${escapeHtml(language)}` : ''}">${rendered.join('')}</code></pre>`;
    } else
      code = language
        ? `<pre><code class="hljs language-${escapeHtml(language)}">${hljs.highlight(tokens[i].content, { language, ignoreIllegals: true }).value}</code></pre>`
        : originalFence(tokens, i, opts, env, self);
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
  return md.render(body, {});
}
/** Base page styles plus the shared design system; used by the reader, dashboard and export. */
export const contentCss = `${tokensCss}
html{background:var(--ws-bg)}
body{margin:0;background:var(--ws-bg);color:var(--ws-fg);font-family:var(--ws-font);font-size:var(--ws-ui-size);line-height:1.5;-webkit-font-smoothing:antialiased}
.muted{color:var(--ws-muted)}
${documentCss}
${chartCss}
${notebookCss}
${canvasCss}
${apiCss}
${dashboardCss}
${httpBlockCss}`;
export function htmlDocument(title: string, content: string, css = contentCss): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main class="doc">${content}</main></body></html>`;
}

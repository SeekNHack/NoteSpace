import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WikiRoot, WikiWorkspace } from './workspace';
import { Page } from './core/model';
import { exportWiki, printCss } from './export';
import type { PlannerService } from './planner';
import { escapeHtml } from './core/render';
import { posix } from './core/paths';
import { toXhtml } from './core/xhtml';
import { zip, ZipEntry } from './core/zip';

type Entry = { page: Page; body: string; output: string; lang: string };

/** Renders the selected pages through the normal export into a temporary folder. */
async function render(
  workspace: WikiWorkspace,
  root: WikiRoot,
  include: (page: Page) => boolean,
  planner?: PlannerService,
): Promise<{ dir: string; entries: Entry[]; warnings: string[] }> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'notespace-publish-'));
  const entries: Entry[] = [];
  try {
    const result = await exportWiki(workspace, root, vscode.Uri.file(parent), undefined, {
      planner,
      noAnalytics: true,
      collect: (e) => include(e.page) && entries.push(e),
    });
    if (!entries.length)
      throw new Error(
        'No published pages match this selection (drafts and private pages are not exported).',
      );
    // Books start at the homepage, then follow the site's navigation order.
    const home = root.config?.content.homepage || 'index.md';
    entries.sort((a, b) => Number(b.page.path === home) - Number(a.page.path === home));
    return { dir: result.uri.fsPath, entries, warnings: result.warnings };
  } catch (e) {
    await fs.rm(parent, { recursive: true, force: true });
    throw e;
  }
}
/** Collapsed blocks are opened: paper and e-readers have no way to expand them. */
const expand = (html: string) => html.replace(/<details(?![^>]*\bopen\b)/g, '<details open');
const cleanup = (dir: string) => fs.rm(path.dirname(dir), { recursive: true, force: true });

/** Rewrites a body's relative URLs from its page folder to the site root (print.html). */
function rebase(body: string, output: string, anchors: Map<string, string>): string {
  return body.replace(/\b(href|src)="([^"]*)"/g, (all, name: string, value: string) => {
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return all;
    const [target, hash] = value.split('#');
    const resolved = posix.normalize(posix.join(posix.dirname(output), decodeURI(target)));
    if (name === 'href' && anchors.has(resolved))
      return `href="#${anchors.get(resolved)}${hash ? `-${hash}` : ''}"`;
    return `${name}="${encodeURI(resolved)}${hash ? `#${hash}` : ''}"`;
  });
}

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------
export function findBrowser(): string | undefined {
  const configured = vscode.workspace
    .getConfiguration('notespace')
    .get<string>('export.browserPath', '');
  if (configured) return existsSync(configured) ? configured : undefined;
  const env = process.env;
  const candidates =
    process.platform === 'win32'
      ? [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']]
          .filter(Boolean)
          .flatMap((base) => [
            path.join(base!, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(base!, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(base!, 'Chromium', 'Application', 'chrome.exe'),
            path.join(base!, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          ])
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          ]
        : [
            'google-chrome',
            'google-chrome-stable',
            'chromium',
            'chromium-browser',
            'microsoft-edge',
            'brave-browser',
          ].flatMap((name) =>
            (env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, name)),
          );
  return candidates.find((c) => existsSync(c));
}

export interface PdfResult {
  pdf?: vscode.Uri;
  /** Set when no browser was found: an HTML file to print with “Save as PDF”. */
  printHtml?: vscode.Uri;
  pages: number;
  warnings: string[];
}

/**
 * PDF of one page, a folder or the whole wiki. The print layout is the exported site's HTML
 * with print CSS; a locally installed Chromium-based browser (Chrome, Edge, Chromium, Brave)
 * turns it into PDF in headless mode. Nothing is downloaded and nothing leaves the machine.
 */
export async function exportPdf(
  workspace: WikiWorkspace,
  root: WikiRoot,
  target: vscode.Uri,
  include: (page: Page) => boolean,
  title: string,
  planner?: PlannerService,
): Promise<PdfResult> {
  const { dir, entries, warnings } = await render(workspace, root, include, planner);
  try {
    const anchors = new Map(entries.map((e, i) => [e.output, `p${i + 1}`]));
    const description = root.config?.wiki.description || '';
    const toc =
      entries.length > 1
        ? `<nav class="print-toc" aria-label="Contents"><h2>Contents</h2><ol>${entries.map((e, i) => `<li><a href="#p${i + 1}">${escapeHtml(e.page.title)}</a></li>`).join('')}</ol></nav>`
        : '';
    const sections = entries
      .map((e, i) => {
        // Heading ids are prefixed per page so anchors stay unique in one document.
        const body = rebase(expand(e.body), e.output, anchors)
          .replace(/\bid="([^"]+)"/g, `id="p${i + 1}-$1"`)
          .replace(/href="#(?!p\d)([^"]+)"/g, `href="#p${i + 1}-$1"`);
        return `<section class="print-page doc" id="p${i + 1}" lang="${escapeHtml(e.lang)}">${body}</section>`;
      })
      .join('');
    const html = `<!doctype html><html lang="${escapeHtml(root.config?.wiki.language || 'en')}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="site.css"><style>@page{size:A4;margin:18mm 16mm}body{margin:0}.print-cover{min-height:40vh;display:flex;flex-direction:column;justify-content:flex-end;border-bottom:2px solid var(--ws-accent);margin-bottom:24px}.print-cover h1{font-size:30px;margin:0 0 6px}${printCss.replace(/^@media print\{|\}$/g, '')}</style></head><body><main class="print-root" style="max-width:var(--ws-doc-width);margin:0 auto;padding:16px">${entries.length > 1 ? `<header class="print-cover doc"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p class="muted">${new Date().toISOString().slice(0, 10)} · ${entries.length} pages</p></header>${toc}` : ''}${sections}</main></body></html>`;
    const printFile = path.join(dir, 'print.html');
    await fs.writeFile(printFile, html);
    const browser = findBrowser();
    if (!browser) {
      // Intelligible fallback: keep a print-ready HTML next to the requested PDF.
      const fallback = vscode.Uri.joinPath(
        target,
        '..',
        `${posix.basename(target.path, '.pdf')}-print`,
      );
      await vscode.workspace.fs.copy(vscode.Uri.file(dir), fallback, { overwrite: false });
      return {
        printHtml: vscode.Uri.joinPath(fallback, 'print.html'),
        pages: entries.length,
        warnings,
      };
    }
    const out = path.join(dir, 'out.pdf');
    await new Promise<void>((resolve, reject) =>
      execFile(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--no-pdf-header-footer',
          `--user-data-dir=${path.join(dir, '.profile')}`,
          ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
          `--print-to-pdf=${out}`,
          vscode.Uri.file(printFile).toString(),
        ],
        { timeout: 180000, windowsHide: true },
        (error, _stdout, stderr) =>
          error && !existsSync(out)
            ? reject(
                new Error(
                  `The browser could not print the PDF: ${(stderr || error.message).trim().split('\n').pop()}`,
                ),
              )
            : resolve(),
      ),
    );
    const bytes = await fs.readFile(out);
    if (bytes.subarray(0, 5).toString() !== '%PDF-')
      throw new Error('The browser did not produce a PDF file.');
    await vscode.workspace.fs.writeFile(target, bytes);
    return { pdf: target, pages: entries.length, warnings };
  } finally {
    await cleanup(dir);
  }
}

// ---------------------------------------------------------------------------------------------
// EPUB 3
// ---------------------------------------------------------------------------------------------
const media: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const epubCss = `body{font-family:serif;line-height:1.5;margin:0 4%}h1,h2,h3,h4{font-family:sans-serif;line-height:1.25}pre,code{font-family:monospace;font-size:.9em}pre{white-space:pre-wrap;background:#f4f4f4;padding:.6em;border-radius:4px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.2em .4em}img,svg{max-width:100%;height:auto}blockquote{margin-left:1em;padding-left:.8em;border-left:3px solid #999}.callout,.api-op,.nb-cell,.chart,.canvas-preview,.collection{border:1px solid #bbb;border-left-width:4px;padding:.4em .8em;margin:1em 0}.callout-title,.callout summary{font-weight:bold}.epub-fallback{font-style:italic;color:#555}.copy-code,.permalink{display:none}.muted{color:#555}`;

/**
 * EPUB 3 of the wiki's current version in its default language, in navigation order. Uses the
 * same rendering as the site (rich blocks, diagrams, charts, notebooks, canvases, API
 * references); media players and scripts are replaced by text fallbacks.
 */
export async function exportEpub(
  workspace: WikiWorkspace,
  root: WikiRoot,
  target: vscode.Uri,
  planner?: PlannerService,
): Promise<{ epub: vscode.Uri; pages: number; warnings: string[]; fallbacks: number }> {
  const scope = (page: Page) => workspace.index.scope?.(page) ?? '';
  const { dir, entries, warnings } = await render(workspace, root, (p) => !scope(p), planner);
  try {
    const title = root.config?.wiki.title || root.name;
    const language = root.config?.wiki.language || 'en';
    const files: ZipEntry[] = [];
    const manifest: string[] = [];
    const resources = new Set<string>();
    let fallbacks = 0;
    const chapterOf = (output: string) => `${output.replace(/\.html$/, '')}.xhtml`;
    const pageOutputs = new Set(entries.map((e) => e.output));
    entries.forEach((entry, i) => {
      const base = posix.dirname(entry.output);
      const converted = toXhtml(expand(entry.body), (url, attribute) => {
        if (!url || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return url;
        const [file, hash] = url.split('#');
        const resolved = posix.normalize(posix.join(base, decodeURI(file)));
        if (attribute === 'href' && pageOutputs.has(resolved))
          return `${encodeURI(posix.relative(base, chapterOf(resolved)))}${hash ? `#${hash}` : ''}`;
        if (attribute === 'src' || /\.(png|jpe?g|gif|webp|svg)$/i.test(resolved)) {
          resources.add(resolved);
          return url;
        }
        // Attachments and unexported pages cannot be part of the book: keep the text, drop the target.
        return '#';
      });
      fallbacks += converted.fallbacks;
      const css = posix.relative(base, 'style.css');
      const doc = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(entry.lang)}" xml:lang="${xml(entry.lang)}"><head><meta charset="utf-8"/><title>${xml(entry.page.title)}</title><link rel="stylesheet" type="text/css" href="${xml(css)}"/></head><body><section epub:type="chapter">${converted.xhtml}</section></body></html>`;
      const name = chapterOf(entry.output);
      files.push({ name: `OEBPS/${name}`, data: new TextEncoder().encode(doc) });
      const props = [converted.svg && 'svg', converted.mathml && 'mathml']
        .filter(Boolean)
        .join(' ');
      manifest.push(
        `<item id="c${i + 1}" href="${xml(encodeURI(name))}" media-type="application/xhtml+xml"${props ? ` properties="${props}"` : ''}/>`,
      );
    });
    let r = 0;
    for (const resource of resources) {
      const ext = resource.split('.').pop()!.toLowerCase();
      if (!media[ext]) continue;
      try {
        const data = await fs.readFile(path.join(dir, resource));
        files.push({
          name: `OEBPS/${resource}`,
          data,
          compress: !/^image\/(png|jpeg|gif|webp)$/.test(media[ext]),
        });
        manifest.push(
          `<item id="r${++r}" href="${xml(encodeURI(resource))}" media-type="${media[ext]}"/>`,
        );
      } catch {
        warnings.push(`${resource}: image missing from the export and left out of the e-book.`);
      }
    }
    // Navigation document, nested by folder.
    const nav = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(language)}" xml:lang="${xml(language)}"><head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${entries.map((e) => `<li><a href="${xml(encodeURI(chapterOf(e.output)))}">${xml(e.page.title)}</a></li>`).join('')}</ol></nav><nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="${xml(encodeURI(chapterOf(entries[0].output)))}">Start</a></li></ol></nav></body></html>`;
    const id = `urn:uuid:${randomUUID()}`;
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${xml(language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${id}</dc:identifier><dc:title>${xml(title)}</dc:title><dc:language>${xml(language)}</dc:language>${root.config?.wiki.description ? `<dc:description>${xml(root.config.wiki.description)}</dc:description>` : ''}<dc:creator>${xml(title)}</dc:creator><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest.join('')}</manifest><spine>${entries.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`;
    const container = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
    const enc = (s: string) => new TextEncoder().encode(s);
    const bytes = zip([
      { name: 'mimetype', data: enc('application/epub+zip'), compress: false },
      { name: 'META-INF/container.xml', data: enc(container) },
      { name: 'OEBPS/content.opf', data: enc(opf) },
      { name: 'OEBPS/nav.xhtml', data: enc(nav) },
      { name: 'OEBPS/style.css', data: enc(epubCss) },
      ...files,
    ]);
    await vscode.workspace.fs.writeFile(target, bytes);
    return { epub: target, pages: entries.length, warnings, fallbacks };
  } finally {
    await cleanup(dir);
  }
}

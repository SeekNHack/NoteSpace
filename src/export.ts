import { markdown } from './core/markdown';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WikiRoot, WikiWorkspace } from './workspace';
import { Page } from './core/model';
import { contentCss, escapeHtml, renderPage } from './core/render';
import { encodePath, insidePath, isExternal, posix, splitTarget, uriPath } from './core/paths';
import { renderDiagrams } from './diagrams';
import { resolveAttachment, resolveImage } from './assets';
import MarkdownIt from 'markdown-it';
import { icon, iconPaths, IconName } from './core/icons';
import { pageIcon, pageShowsPager, pageStatus } from './core/nav-tree';
import { excerptOf } from './core/mentions';
import { pageWithIncludes } from './core/includes';
import { readerInteractions } from './core/reader-interactions';
import type { PlannerService } from './planner';
import { chartRenderer } from './chart-data';
import { canvasRenderer } from './canvas-editor';
import { openApiRenderer } from './api-playground';
import { dashboardRenderer } from './dashboards';
import { scopeOf, variants } from './core/scopes';
import { appearanceCss as themeCss } from './core/themes';
import { notebookPageHtml, notebookRenderer, readNotebook, renderNotebookHtml } from './notebooks';
import { compareTasks, inList, statusLabels, Task, taskStatuses } from './core/tasks';
export interface ExportResult {
  uri: vscode.Uri;
  pages: number;
  warnings: string[];
}
/** Exports an immutable snapshot into a new directory; never overwrites an existing export. */
export async function exportWiki(
  workspace: WikiWorkspace,
  root: WikiRoot,
  parent: vscode.Uri,
  token?: vscode.CancellationToken,
  options: {
    planner?: PlannerService;
    /** Receives each page's rendered body (same HTML as the site) for PDF and EPUB builds. */
    collect?: (entry: { page: Page; body: string; output: string; lang: string }) => void;
    /** Skip the analytics snippet (print and e-book builds never count views). */
    noAnalytics?: boolean;
  } = {},
): Promise<ExportResult> {
  const sort = root.config?.navigation.sort || 'filename';
  // Daily notes and the planner inbox are private unless the wiki opts in.
  const plannerExport = root.config?.features.plannerExport === true;
  const plannerConfig = options.planner?.config(root);
  const dailyFolder = plannerConfig?.dailyFolder || 'daily';
  // Journals and the inbox stay private in every language and archived version too.
  const isPrivate = (p: Page) => {
    const logical = scopeOf(p.path, root.config).logical;
    return (
      !plannerExport &&
      (new RegExp(
        `^${dailyFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d{4}-\\d{2}-\\d{2}\\.md$`,
      ).test(logical) ||
        logical === (plannerConfig?.inbox || 'Inbox.md'))
    );
  };
  const pages = workspace.index
    .all(root.id)
    .filter((p) => !p.draft && !isPrivate(p))
    .sort(
      (a, b) =>
        (sort === 'order' ? (a.order ?? Infinity) - (b.order ?? Infinity) : 0) ||
        (sort === 'title' ? a.title.localeCompare(b.title) : a.path.localeCompare(b.path)),
    );
  if (!pages.length) throw new Error('This wiki has no pages to export.');
  const homepage =
    pages.find((page) => page.path === root.config?.content.homepage) ||
    pages.find((page) => page.path === 'Home.md') ||
    pages.find((page) => page.path === 'index.md');
  const { WikiIndex } = await import('./core/index');
  const index = new WikiIndex();
  index.scope = workspace.index.scope;
  index.replace(pages);
  // Navigation, pager and search stay within one language and version.
  const scopeOfPage = (p: Page) => workspace.index.scope?.(p) ?? '';
  const directory = vscode.Uri.joinPath(
    parent,
    `notespace-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`,
  );
  const warnings: string[] = [];
  const write = async (path: string, bytes: Uint8Array) => {
    const uri = vscode.Uri.joinPath(directory, path);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, bytes);
  };
  const diagramOptions = { mode: 'image', theme: root.config?.appearance.theme } as const;
  const outputPath = (p: Page) => `pages/${p.path.replace(/\.md$/i, '.html')}`;
  const appearanceCss = themeCss(root.config?.appearance);
  // Analytics only when the wiki configures a provider and endpoint; the CSP allows exactly that origin.
  const analytics =
    !options.noAnalytics && root.config && root.config.analytics.provider !== 'none'
      ? root.config.analytics
      : undefined;
  const analyticsOrigin = analytics ? new URL(analytics.endpoint).origin : '';
  // The announcement is one line of inline Markdown (links and emphasis; no HTML).
  const announcement = root.config?.wiki.announcement
    ? `<div class="site-announcement" role="note">${new MarkdownIt({ html: false, linkify: true }).renderInline(root.config.wiki.announcement)}</div>`
    : '';
  const siteUrl = root.config?.build.url;
  const siteName = root.config?.wiki.title || root.name;
  const sitePage = (
    title: string,
    content: string,
    from: string,
    lang = root.config?.wiki.language || 'en',
    meta: { description?: string; image?: string } = {},
  ): string => {
    const relative = (file: string) => encodePath(posix.relative(posix.dirname(from), file));
    // Share previews (Open Graph): absolute URLs need build.url; without it the image is omitted.
    const description = meta.description || root.config?.wiki.description || '';
    const share = [
      description ? `<meta name="description" content="${escapeHtml(description)}">` : '',
      `<meta property="og:type" content="${from === 'index.html' ? 'website' : 'article'}">`,
      `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      description ? `<meta property="og:description" content="${escapeHtml(description)}">` : '',
      siteUrl ? `<link rel="canonical" href="${escapeHtml(siteUrl + encodePath(from))}">` : '',
      siteUrl ? `<meta property="og:url" content="${escapeHtml(siteUrl + encodePath(from))}">` : '',
      siteUrl && meta.image
        ? `<meta property="og:image" content="${escapeHtml(siteUrl + encodePath(meta.image))}"><meta name="twitter:card" content="summary_large_image">`
        : '',
    ].join('');
    return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'${analyticsOrigin ? ` ${analyticsOrigin}` : ''}; base-uri 'none'; form-action 'none'">${analytics ? `<meta name="wiki-analytics" content="${escapeHtml(JSON.stringify(analytics))}">` : ''}<title>${escapeHtml(title)}</title>${share}<link rel="stylesheet" href="${relative('site.css')}"></head><body>${announcement}<div class="site-layout${from === 'index.html' || !content.includes('class="site-nav"') ? ' site-home' : ''}">${content}</div><script defer src="${relative('site.js')}"></script></body></html>`;
  };
  const iconHtml = (p: Page) => {
    const name = pageIcon(p);
    if (!name) return '';
    if (name in iconPaths) return `<span class="page-icon">${icon(name as IconName, 15)}</span>`;
    return /^[a-z]/.test(name)
      ? ''
      : `<span class="page-icon" aria-hidden="true">${escapeHtml(name)}</span>`;
  };
  const statusHtml = (p: Page) => {
    const status = pageStatus(p);
    return status
      ? ` <span class="status-badge status-${status}">${status[0].toUpperCase()}${status.slice(1)}</span>`
      : '';
  };
  const tagged = new Map<string, Page[]>();
  for (const p of pages) for (const t of p.tags) tagged.set(t, [...(tagged.get(t) || []), p]);
  try {
    await vscode.workspace.fs.createDirectory(directory);
    const assets = new Set<string>();
    let homepageBody = '';
    for (const page of pages) {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      const contentPage = pageWithIncludes(page, index, (message) =>
        warnings.push(`${page.path}: ${message}`),
      );
      const images = new Map<string, string>(),
        media = new Map<string, string>(),
        attachments = new Map<string, string>();
      for (const link of contentPage.links.filter((l) => l.kind === 'image')) {
        if (isExternal(link.target)) {
          warnings.push(`${page.path}: remote image omitted: ${link.target}`);
          continue;
        }
        const target = splitTarget(link.target).path,
          file = posix.normalize(
            target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(page.path), target),
          );
        const projectAsset = file.startsWith('../assets/') && root.projectUri;
        const isMedia = /\.(?:mp4|webm|mp3|ogg)$/i.test(file);
        if (
          (!insidePath(file) && !projectAsset) ||
          !/\.(png|jpe?g|gif|webp|avif|bmp|mp4|webm|mp3|ogg)$/i.test(file)
        ) {
          warnings.push(`${page.path}: unsupported image: ${link.target}`);
          continue;
        }
        try {
          const uri = projectAsset
            ? vscode.Uri.joinPath(root.projectUri!, file.slice(3))
            : vscode.Uri.joinPath(root.uri, file);
          await workspace.assertNoSymlink(root, uri);
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type !== vscode.FileType.File || stat.size > (isMedia ? 50 : 20) * 1024 * 1024)
            throw new Error('Asset is not a supported regular file or exceeds its size limit');
          const outputAsset = projectAsset ? file.slice(3) : `assets/${file}`;
          if (!assets.has(outputAsset)) {
            await write(outputAsset, await vscode.workspace.fs.readFile(uri));
            assets.add(outputAsset);
          }
          (isMedia ? media : images).set(
            markdown.normalizeLink(link.target),
            encodePath(posix.relative(posix.dirname(outputPath(page)), outputAsset)),
          );
        } catch (e) {
          warnings.push(`${page.path}: could not copy ${link.target}: ${String(e)}`);
        }
      }
      for (const link of contentPage.links.filter(
        (l) =>
          l.kind === 'markdown' && /\.(?:pdf|txt|csv|zip|docx|xlsx|pptx)(?:#.*)?$/i.test(l.target),
      )) {
        const uri = await resolveAttachment(workspace, root, page, link.target);
        if (!uri) {
          warnings.push(`${page.path}: missing or unsupported attachment: ${link.target}`);
          continue;
        }
        const projectAsset =
          root.projectUri &&
          uriPath(uri).startsWith(uriPath(root.projectUri).replace(/\/$/, '') + '/assets/');
        const outputAsset = projectAsset
          ? posix.relative(uriPath(root.projectUri!), uriPath(uri))
          : `assets/${posix.relative(uriPath(root.uri), uriPath(uri))}`;
        if (!assets.has(outputAsset)) {
          await write(outputAsset, await vscode.workspace.fs.readFile(uri));
          assets.add(outputAsset);
        }
        attachments.set(
          markdown.normalizeLink(link.target),
          encodePath(posix.relative(posix.dirname(outputPath(page)), outputAsset)),
        );
      }
      const href = (p: Page, anchor?: string) =>
        encodePath(posix.relative(posix.dirname(outputPath(page)), outputPath(p))) +
        (anchor ? `#${encodeURIComponent(anchor)}` : '');
      const body = await renderDiagrams(
        renderPage(contentPage, index, {
          pageHref: href,
          imageHref: (target) => images.get(target),
          mediaHref: (target) => media.get(target),
          assetHref: (target) => attachments.get(target),
          collection: options.planner?.collection(page, (target) => href(target), plannerExport),
          chart: await chartRenderer(workspace, page, options.planner, plannerExport),
          notebook: await notebookRenderer(workspace, page),
          openapi: await openApiRenderer(workspace, page),
          // Exports include dashboards only when the dashboard file allows snapshots.
          dashboard: await dashboardRenderer(vscode.Uri.parse(page.uri), page.text, {
            forExport: true,
          }),
          canvas: await canvasRenderer(workspace, page, (file) => {
            const target = pages.find((p) => p.path === file);
            return target ? href(target) : undefined;
          }),
        }),
        diagramOptions,
      );
      options.collect?.({
        page,
        body,
        output: outputPath(page),
        lang: scopeOf(page.path, root.config).language || root.config?.wiki.language || 'en',
      });
      if (page.id === homepage?.id) {
        const atRoot = (value: string) =>
          encodePath(
            posix.normalize(posix.join(posix.dirname(outputPath(page)), decodeURIComponent(value))),
          );
        homepageBody = await renderDiagrams(
          renderPage(contentPage, index, {
            pageHref: (target, anchor) =>
              encodePath(outputPath(target)) + (anchor ? `#${encodeURIComponent(anchor)}` : ''),
            imageHref: (target) => {
              const value = images.get(target);
              return value && atRoot(value);
            },
            mediaHref: (target) => {
              const value = media.get(target);
              return value && atRoot(value);
            },
            assetHref: (target) => {
              const value = attachments.get(target);
              return value && atRoot(value);
            },
          }),
          diagramOptions,
        );
      }
      for (const link of contentPage.links.filter((l) => l.kind !== 'image')) {
        if (attachments.has(markdown.normalizeLink(link.target))) continue;
        if (
          link.kind === 'markdown' &&
          /\.(?:pdf|txt|csv|zip|docx|xlsx|pptx)(?:#.*)?$/i.test(link.target)
        )
          continue;
        const r = index.resolve(page, link.target, link.kind);
        if (r.error) warnings.push(`${page.path}: ${r.error} link: ${link.target}`);
      }
      const backlinks = index.backlinks(page);
      const footer = backlinks.length
        ? `<footer><h2>Backlinks</h2><ul>${backlinks.map((b) => `<li><a href="${escapeHtml(href(b.page))}">${escapeHtml(b.page.title)}</a></li>`).join('')}</ul></footer>`
        : '';
      const searchBox =
        root.config?.features.search === false
          ? ''
          : `<input class="site-search" type="search" placeholder="Search docs" aria-label="Search docs" data-scope="${escapeHtml(scopeOfPage(page))}" data-index="${encodePath(posix.relative(posix.dirname(outputPath(page)), 'search-index.json'))}"><ul class="search-results"></ul>`;
      const scoped = pages.filter((p) => scopeOfPage(p) === scopeOfPage(page));
      let switchers = '',
        banner = '',
        lang = root.config?.wiki.language || 'en';
      if (
        root.config &&
        (root.config.i18n.languages.length || root.config.versions.archived.length)
      ) {
        const v = variants(page, pages, root.config);
        lang = v.scope.language || lang;
        const pill = (label: string, target: Page | undefined, current: boolean) =>
          current
            ? `<span aria-current="true">${escapeHtml(label)}</span>`
            : target
              ? `<a href="${escapeHtml(href(target))}" hreflang="${escapeHtml(label)}">${escapeHtml(label)}</a>`
              : `<span class="missing" title="Not available">${escapeHtml(label)}</span>`;
        if (root.config.i18n.languages.length)
          switchers += `<nav class="site-variants" aria-label="Language">${v.languages.map((l) => pill(l.language, l.page, l.current)).join('')}</nav>`;
        if (root.config.versions.archived.length)
          switchers += `<nav class="site-variants" aria-label="Version">${v.versions.map((x) => pill(x.version, x.page, x.current).replace(/ hreflang="[^"]*"/, '')).join('')}</nav>`;
        if (v.scope.version) {
          const latest = v.versions.find((x) => !x.archived)?.page;
          banner = `<p class="archived-banner" role="note">You are reading version ${escapeHtml(v.scope.version)}, an archived version.${latest ? ` <a href="${escapeHtml(href(latest))}">Go to the latest version</a>.` : ''}</p>`;
        }
      }
      const nav = `<aside class="site-nav"><strong><a href="${encodePath(posix.relative(posix.dirname(outputPath(page)), 'index.html'))}">${escapeHtml(root.config?.wiki.title || root.name)}</a></strong>${switchers}${searchBox}<ul>${scoped.map((p) => `<li><a ${p.id === page.id ? 'aria-current="page"' : ''} href="${escapeHtml(href(p))}">${iconHtml(p)}${escapeHtml(p.title)}</a>${statusHtml(p)}</li>`).join('')}</ul></aside>`;
      // The cover image (front matter `cover:`) is copied like the page's other images.
      let cover = '';
      const coverTarget = page.properties?.cover || page.properties?.image;
      if (coverTarget && !isExternal(coverTarget)) {
        const uri = await resolveImage(workspace, root, page, coverTarget);
        if (uri && /\.(png|jpe?g|gif|webp)$/i.test(uriPath(uri))) {
          const inRoot = posix.relative(uriPath(root.uri), uriPath(uri));
          const outputAsset = insidePath(inRoot)
            ? `assets/${inRoot}`
            : `assets/covers/${posix.basename(uriPath(uri))}`;
          if (!assets.has(outputAsset)) {
            await write(outputAsset, await vscode.workspace.fs.readFile(uri));
            assets.add(outputAsset);
          }
          cover = outputAsset;
        } else warnings.push(`${page.path}: cover image not found: ${coverTarget}`);
      }
      const coverHtml = cover
        ? `<img class="page-cover" src="${encodePath(posix.relative(posix.dirname(outputPath(page)), cover))}" alt="">`
        : '';
      const tagsHtml = page.tags.length
        ? `<p class="page-tags">${page.tags.map((t) => `<a class="tag" href="${encodePath(posix.relative(posix.dirname(outputPath(page)), 'tags.html'))}#tag-${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join('')}</p>`
        : '';
      const statusLine = pageStatus(page)
        ? `<p class="page-status">${statusHtml(page).trim()}</p>`
        : '';
      const toc =
        root.config?.features.tableOfContents === false
          ? ''
          : `<aside class="site-toc"><strong>On this page</strong><ul>${page.headings.map((h) => `<li><a href="#${escapeHtml(h.slug)}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></aside>`;
      const ix = scoped.findIndex((p) => p.id === page.id);
      const pager = !pageShowsPager(page)
        ? ''
        : `<nav class="site-pager">${ix > 0 ? `<a href="${escapeHtml(href(scoped[ix - 1]))}">← ${escapeHtml(scoped[ix - 1].title)}</a>` : '<span></span>'}${ix < scoped.length - 1 ? `<a href="${escapeHtml(href(scoped[ix + 1]))}">${escapeHtml(scoped[ix + 1].title)} →</a>` : ''}</nav>`;
      const breadcrumbs =
        root.config?.features.breadcrumbs === false
          ? ''
          : `<div class="breadcrumbs">${escapeHtml(root.name)} / ${escapeHtml(page.path)}</div>`;
      await write(
        outputPath(page),
        new TextEncoder().encode(
          sitePage(
            page.title,
            nav +
              `<main class="doc">${banner}${breadcrumbs}${coverHtml}${statusLine}${tagsHtml}${body}${pager}${footer}</main>` +
              toc,
            outputPath(page),
            lang,
            { description: excerptOf(page, 200), image: cover || undefined },
          ),
        ),
      );
    }
    // Notebooks: static pages with saved outputs; nothing is executed.
    const notebookLinks: string[] = [];
    for (const uri of await vscode.workspace.findFiles(
      new vscode.RelativePattern(root.uri, '**/*.ipynb'),
      '**/{node_modules,.git,.notespace-trash,.ipynb_checkpoints}/**',
      2000,
    )) {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      const relativePath = posix.relative(uriPath(root.uri), uriPath(uri));
      if (!insidePath(relativePath)) continue;
      try {
        await workspace.assertNoSymlink(root, uri);
        const html = renderNotebookHtml(await readNotebook(uri));
        const out = `notebooks/${relativePath.replace(/\.ipynb$/i, '.html')}`;
        await write(
          out,
          new TextEncoder().encode(
            sitePage(
              posix.basename(relativePath),
              `<main class="doc">${notebookPageHtml(posix.basename(relativePath), html)}</main>`,
              out,
            ),
          ),
        );
        notebookLinks.push(`<li><a href="${encodePath(out)}">${escapeHtml(relativePath)}</a></li>`);
      } catch (e) {
        warnings.push(
          `${relativePath}: notebook not exported: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    const listingSearch =
      root.config?.features.search === false
        ? ''
        : '<input class="site-search" type="search" placeholder="Search docs" aria-label="Search docs" data-scope="" data-index="search-index.json"><ul class="search-results"></ul>';
    // Entry points for the other languages and archived versions (their first page in order).
    const firstIn = (prefix: string) =>
      pages.find((p) => scopeOfPage(p) === prefix && /(^|\/)index\.md$/.test(p.path)) ||
      pages.find((p) => scopeOfPage(p) === prefix);
    const entry = (label: string, prefix: string) => {
      const target = firstIn(prefix);
      return target
        ? `<li><a href="${encodePath(outputPath(target))}">${escapeHtml(label)}</a></li>`
        : '';
    };
    const languageLinks = (root.config?.i18n.languages || []).map((l) => entry(l, l)).join('');
    const versionLinks = (root.config?.versions.archived || [])
      .map((v) => entry(v, `_versions/${v}`))
      .join('');
    const variantsListing = `${languageLinks ? `<section aria-label="Languages"><h2>Languages</h2><ul>${languageLinks}</ul></section>` : ''}${versionLinks ? `<section aria-label="Archived versions"><h2>Archived versions</h2><ul>${versionLinks}</ul></section>` : ''}`;
    const listing = `<main class="doc">${homepageBody || `<header><p class="muted">NOTESPACE</p><h1>${escapeHtml(root.config?.wiki.title || root.name)}</h1><p>${escapeHtml(root.config?.wiki.description || '')}</p></header>`}${variantsListing}<section aria-label="Browse pages"><h2>Browse pages</h2>${listingSearch}<ul>${pages
      .filter((p) => !scopeOfPage(p))
      .map(
        (p) =>
          `<li><a href="${encodePath(outputPath(p))}">${escapeHtml(p.title)}</a> <small class="muted">${escapeHtml(p.path)}</small></li>`,
      )
      .join(
        '',
      )}</ul></section>${notebookLinks.length ? `<section aria-label="Notebooks"><h2>Notebooks</h2><ul>${notebookLinks.join('')}</ul></section>` : ''}${plannerExport && options.planner ? '<p><a href="planner.html">Planner snapshot</a></p>' : ''}</main>`;
    await write('index.html', new TextEncoder().encode(sitePage(root.name, listing, 'index.html')));
    if (tagged.size) {
      const tags = [...tagged].sort((a, b) => a[0].localeCompare(b[0]));
      const tagIndex = `<main class="doc"><p class="breadcrumbs"><a href="index.html">${escapeHtml(siteName)}</a></p><h1>Tags</h1><p class="tag-cloud">${tags.map(([t, list]) => `<a class="tag" href="#tag-${encodeURIComponent(t)}">#${escapeHtml(t)} <small>${list.length}</small></a>`).join('')}</p>${tags
        .map(
          ([t, list]) =>
            `<section id="tag-${escapeHtml(encodeURIComponent(t))}"><h2>#${escapeHtml(t)}</h2><ul>${list.map((p) => `<li><a href="${encodePath(outputPath(p))}">${escapeHtml(p.title)}</a>${statusHtml(p)}</li>`).join('')}</ul></section>`,
        )
        .join('')}</main>`;
      await write(
        'tags.html',
        new TextEncoder().encode(sitePage(`Tags · ${siteName}`, tagIndex, 'tags.html')),
      );
    }
    if (root.config?.versions.archived.length) {
      // Stable aliases: latest/ always opens the live docs; versions.json lists every version.
      const current = root.config.versions.current || 'latest';
      await write(
        'latest/index.html',
        new TextEncoder().encode(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../index.html"><link rel="canonical" href="../index.html"><title>${escapeHtml(root.config.wiki.title)} · latest</title></head><body><p><a href="../index.html">Open the latest documentation (${escapeHtml(current)})</a></p></body></html>`,
        ),
      );
      await write(
        'versions.json',
        new TextEncoder().encode(
          JSON.stringify(
            {
              latest: { id: current, href: 'index.html' },
              archived: root.config.versions.archived.map((v) => {
                const target = firstIn(`_versions/${v}`);
                return { id: v, href: target ? encodePath(outputPath(target)) : null };
              }),
            },
            null,
            2,
          ) + '\n',
        ),
      );
    }
    if (plannerExport && options.planner) {
      const today = options.planner.today(root);
      const tasks = options.planner
        .tasks(root.id)
        .filter((t) => pages.some((p) => p.id === t.pageId));
      const link = (t: Task) => {
        const page = pages.find((p) => p.id === t.pageId)!;
        return `<a href="${encodePath(outputPath(page))}">${escapeHtml(page.title)}</a>`;
      };
      const list = (title: string, items: Task[]) =>
        items.length
          ? `<section><h2>${title}</h2><ul class="contains-task-list">${items
              .sort(compareTasks)
              .map(
                (t) =>
                  `<li class="task-list-item"><input type="checkbox" disabled${t.status === 'done' ? ' checked' : ''} aria-label="${t.status === 'done' ? 'Done' : 'Open'}"> ${escapeHtml(t.title)}${t.due ? ` <span class="task-due">${escapeHtml(t.due)}</span>` : ''} <span class="task-page">· ${link(t)}</span></li>`,
              )
              .join('')}</ul></section>`
          : '';
      const board = `<section><h2>Board</h2><div class="collection-board" role="region" aria-label="Task board" tabindex="0">${taskStatuses
        .map(
          (status) =>
            `<section class="collection-column" aria-label="${statusLabels[status]}"><h4>${statusLabels[status]}</h4>${tasks
              .filter((t) => t.status === status)
              .map((t) => `<div class="collection-card">${escapeHtml(t.title)}</div>`)
              .join('')}</section>`,
        )
        .join('')}</div></section>`;
      // Month calendar: tasks by due date and links to daily notes, as plain HTML.
      const [year, month] = today.split('-').map(Number);
      const notes = options.planner.dailyNotes(root);
      const first = new Date(Date.UTC(year, month - 1, 1));
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const offset = (first.getUTCDay() + 6) % 7;
      const cells: string[] = [];
      for (let i = 0; i < offset; i++) cells.push('<td></td>');
      for (let d = 1; d <= days; d++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const note = notes.get(date);
        const due = tasks.filter((t) => t.due?.slice(0, 10) === date);
        cells.push(
          `<td${date === today ? ' aria-current="date"' : ''}><span class="day">${note && pages.some((p) => p.id === note.id) ? `<a href="${encodePath(outputPath(note))}">${d}</a>` : d}</span>${due.map((t) => `<span class="cal-task${t.status === 'done' ? ' done' : ''}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>`).join('')}</td>`,
        );
      }
      while (cells.length % 7) cells.push('<td></td>');
      const rows = Array.from(
        { length: cells.length / 7 },
        (_, r) => `<tr>${cells.slice(r * 7, r * 7 + 7).join('')}</tr>`,
      ).join('');
      const monthName = first.toLocaleString(root.config?.wiki.language || 'en', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      const calendar = `<section><h2>Calendar</h2><table class="snapshot-calendar"><caption>${escapeHtml(monthName)}</caption><thead><tr>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => `<th scope="col">${n}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></section>`;
      const snapshot = `<main class="doc"><h1>Planner</h1><p class="muted">Read-only snapshot from ${escapeHtml(today)}.</p>${list(
        'Overdue',
        tasks.filter((t) => inList(t, 'overdue', today)),
      )}${list(
        'Today',
        tasks.filter((t) => inList(t, 'today', today) && !inList(t, 'overdue', today)),
      )}${list(
        'Upcoming',
        tasks.filter((t) => inList(t, 'upcoming', today)),
      )}${calendar}${board}</main>`;
      await write(
        'planner.html',
        new TextEncoder().encode(sitePage('Planner', snapshot, 'planner.html')),
      );
    }
    await write(
      'site.css',
      new TextEncoder().encode(`${contentCss}\n${siteCss}\n${appearanceCss}`),
    );
    await write(
      'site.js',
      new TextEncoder().encode(
        `${siteJs}\n${readerInteractions}${analytics ? `\n${analyticsJs}` : ''}`,
      ),
    );
    if (root.config?.features.search !== false)
      await write(
        'search-index.json',
        new TextEncoder().encode(
          JSON.stringify(
            pages.map((p) => ({
              title: p.title,
              path: outputPath(p),
              scope: scopeOfPage(p),
              body: p.body.slice(0, 5000),
            })),
          ),
        ),
      );
    await write('.notespace-build', new TextEncoder().encode('NoteSpace generated site\n'));
    await write(
      'export-report.json',
      new TextEncoder().encode(JSON.stringify({ pages: pages.length, warnings }, null, 2)),
    );
    return { uri: directory, pages: pages.length, warnings };
  } catch (e) {
    try {
      await vscode.workspace.fs.delete(directory, { recursive: true });
    } catch {
      /* Preserve original failure. */
    }
    throw e;
  }
}
/** Print and PDF: one column, no navigation, readable page breaks. */
export const printCss = `@media print{:root{color-scheme:light}body{background:#fff}.site-nav,.site-toc,.site-pager,.site-search,.search-results,.copy-code,.breadcrumbs,.site-variants{display:none!important}.site-layout{display:block;max-width:none;padding:0}.doc{max-width:none}.doc pre,.doc figure,.doc table,.doc .callout,.doc .api-op,.doc .nb-cell,.doc img,.doc svg{break-inside:avoid}.doc h1,.doc h2,.doc h3{break-after:avoid}.doc a[href^="http"]::after{content:" (" attr(href) ")";font-size:.85em;color:#555;word-break:break-all}.doc details{display:block}.doc details>*{display:block}.print-page{break-before:page}.print-page:first-of-type{break-before:auto}.print-toc ol{columns:1}}`;
const siteCss = `.site-layout{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,var(--ws-doc-width)) minmax(140px,200px);gap:40px;max-width:1400px;margin:0 auto;padding:32px 24px}.site-layout.site-home{display:block;max-width:var(--ws-doc-width)}.site-layout main{min-width:0;width:100%}.site-nav,.site-toc{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;font-size:13px}.site-nav ul,.site-toc ul{list-style:none;padding:0;margin:8px 0}.site-nav li,.site-toc li{padding:3px 0}.site-nav a,.site-toc a{color:var(--ws-muted);text-decoration:none}.site-nav a:hover,.site-toc a:hover{color:var(--ws-fg)}.site-nav a[aria-current=page]{color:var(--ws-accent);font-weight:600}.site-nav>strong a{color:var(--ws-fg);font-size:15px}.site-toc strong{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ws-muted)}.site-toc ul{border-left:1px solid var(--ws-hairline);padding-left:10px}.site-search{width:100%;margin:12px 0 4px;height:30px;padding:0 10px;border:1px solid var(--ws-border);border-radius:6px;background:var(--ws-bg);color:var(--ws-fg);font:inherit}.site-search:focus{outline:1px solid var(--ws-focus)}.search-results:empty{display:none}.site-pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:48px 0 24px}.site-pager a{display:block;padding:10px 14px;border:1px solid var(--ws-hairline);border-radius:6px;text-decoration:none}.site-pager a:last-child:not(:first-child){text-align:right}.breadcrumbs{color:var(--ws-muted);font-size:13px;margin-bottom:18px}.site-variants{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 0;font-size:12px}.site-variants a,.site-variants span{padding:1px 6px;border-radius:4px}.site-variants [aria-current]{background:var(--ws-surface-2);font-weight:600}.site-variants .missing{color:var(--ws-muted);text-decoration:line-through}.archived-banner{padding:8px 12px;border:1px solid var(--ws-orange);border-radius:6px;margin:0 0 18px}.site-announcement{padding:8px 16px;text-align:center;font-size:14px;background:color-mix(in srgb,var(--ws-accent) 16%,var(--ws-bg));border-bottom:1px solid var(--ws-hairline)}.site-announcement a{color:inherit;font-weight:600}.page-cover{display:block;width:100%;max-height:260px;object-fit:cover;border-radius:12px;margin:0 0 20px}.page-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.page-tags .tag,.tag-cloud .tag{text-decoration:none}.tag-cloud{display:flex;flex-wrap:wrap;gap:8px}.page-status{margin:0 0 8px}.page-icon{display:inline-flex;vertical-align:-2px;margin-right:6px;color:var(--ws-accent)}.site-nav .status-badge{margin-left:4px;font-size:10px}@media(max-width:900px){.site-layout{grid-template-columns:180px minmax(0,1fr)}.site-toc{display:none}}@media(max-width:600px){.site-layout{display:block;padding:16px}.site-nav{position:static;max-height:200px;border-bottom:1px solid var(--ws-hairline);margin-bottom:20px}}.doc table.snapshot-calendar{display:table;width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.snapshot-calendar caption{text-align:left;font-weight:600;margin-bottom:6px}.snapshot-calendar td{vertical-align:top;height:72px;border:1px solid var(--ws-hairline);padding:4px}.snapshot-calendar td[aria-current]{outline:2px solid var(--ws-accent);outline-offset:-2px}.snapshot-calendar .day{display:block;font-weight:600}.cal-task{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ws-muted)}.cal-task.done{text-decoration:line-through}${printCss}`;
// Optional page-view beacon. It never runs from file:// URLs, honours Do Not Track and Global
// Privacy Control, sets no cookies and sends only the page path (no query string or hash).
const analyticsJs = `(()=>{const m=document.querySelector('meta[name=wiki-analytics]');if(!m||location.protocol==='file:')return;if(navigator.doNotTrack==='1'||window.doNotTrack==='1'||navigator.globalPrivacyControl)return;try{const c=JSON.parse(m.content);const url=location.origin+location.pathname;const body=c.provider==='plausible'?{name:'pageview',url,domain:c.domain}:{path:location.pathname,lang:document.documentElement.lang};const blob=new Blob([JSON.stringify(body)],{type:'text/plain'});if(!(navigator.sendBeacon&&navigator.sendBeacon(c.endpoint,blob)))fetch(c.endpoint,{method:'POST',body:blob,keepalive:true,credentials:'omit',mode:'no-cors'}).catch(()=>{})}catch{}})();`;
const siteJs = `document.querySelectorAll('.copy-code').forEach(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(button.parentElement.querySelector('code')?.textContent||'');button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1500)}catch{button.textContent='Unavailable'}}));document.querySelectorAll('.site-search').forEach(input=>{let entries;input.addEventListener('input',async()=>{const q=input.value.trim().toLocaleLowerCase(),list=input.parentElement.querySelector('.search-results');list.replaceChildren();if(!q)return;try{entries ||= await (await fetch(input.dataset.index)).json();for(const page of entries.filter(p=>(p.scope||'')===(input.dataset.scope||'')&&(p.title+' '+p.body).toLocaleLowerCase().includes(q)).slice(0,30)){const li=document.createElement('li'),a=document.createElement('a');a.href=new URL(page.path, new URL(input.dataset.index,location.href)).href;a.textContent=page.title;li.append(a);list.append(li)}}catch{list.textContent='Search index unavailable'}})})`;

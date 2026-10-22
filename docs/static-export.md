# Static export, PDF and EPUB

**Export Wiki to HTML** asks for a parent directory and creates a new timestamped snapshot. **Build Wiki** writes to `build.output` from `wiki.yaml` (normally `dist/`), replacing an earlier build only when it carries NoteSpace's build marker. **Export PDF** and **Export EPUB** use the same rendering.

## Site

The generator uses the reader's renderer and link resolver. It writes `index.html`, page HTML under `pages/` (mirroring folders, translations `pages/<lang>/…` and archived versions `pages/_versions/<id>/…`), `site.css`, `site.js`, `search-index.json`, copied images and attachments, notebook pages under `notebooks/`, and `export-report.json`. Drafts are omitted; daily notes, the planner inbox and task views are omitted unless `features.plannerExport` is true.

| Content                                                    | In the site                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Callouts, tabs, steppers, timelines, cards, grids, details | Same HTML as the reader; tabs work with the bundled script and fall back to disclosures without it                                                                       |
| Math                                                       | MathML                                                                                                                                                                   |
| Mermaid                                                    | Self-contained SVG images that follow light/dark                                                                                                                         |
| Charts                                                     | Accessible SVG with legend and data table                                                                                                                                |
| Notebooks                                                  | Saved outputs (sanitized); full notebook pages under `notebooks/`                                                                                                        |
| Canvas                                                     | Static SVG preview with links to exported pages                                                                                                                          |
| OpenAPI                                                    | Static reference (no requests, no credentials)                                                                                                                           |
| Task views, Kanban, calendar                               | Read-only snapshots (`planner.html`: lists, a month calendar with due tasks and daily-note links, and a status board) — only with `plannerExport`                        |
| Languages and versions                                     | Language and version switchers, `<html lang>`, navigation, pager and search scoped to the page's language and version; the index lists language and version entry points |

Pages also show their cover image, status badge and tags; `tags.html` lists every tag with its pages, and the navigation shows page icons and statuses. `wiki.announcement` appears as a bar above every page. Each page has a description (`description:` or its first paragraph) for search engines and share previews (Open Graph); with `build.url` set, pages also get canonical links and the cover becomes the preview image.

**Blog**: **NoteSpace: New Blog Post** (or _Blog post_ in the tab's Create menu) creates `blog/<date>-<title>.md` with `date`, `authors` and `tags`, and on the first post `blog/index.md` with a posts list:

````markdown
```collection
source: pages
folder: blog
view: posts
```
````

Posts are listed newest first (front matter `date:`, else the date in the file name) with authors, tags and a summary. Any page list can be sorted with `sort: title`, `sort: -date` or `sort: <property>`.

Search runs client-side over the current language and version; serve the directory over HTTP when testing locally (browsers block `fetch` from `file://`). Pages are responsive (one column below 600 px) and print without navigation. The CSP allows no inline scripts and no external resources except the analytics endpoint when configured.

### Optional analytics

Off by default. With `analytics.provider: beacon` the site posts `{ "path", "lang" }` for each page view to `analytics.endpoint`; with `plausible` it sends Plausible's `pageview` event for `analytics.domain`. No cookies, identifiers, query strings or referrers are sent; nothing is sent from `file://`, or when the browser signals Do Not Track or Global Privacy Control. NoteSpace itself sends no telemetry.

## PDF

**Export PDF (Page, Section or Wiki)** prints one page, the current folder or the whole wiki (current version, default language; homepage first, then navigation order) with a cover and table of contents. It uses an installed Chrome, Edge, Chromium or Brave in headless mode (or `notespace.export.browserPath`); nothing is downloaded. Collapsed callouts and details are expanded; tabs are shown one after another; links to other included pages become in-document links; external links print their URL. Without a supported browser the command saves a print-ready HTML page to open and print with _Save as PDF_.

## EPUB

**Export EPUB** writes an EPUB 3 of the current version in the default language (homepage first) with a navigation document, language metadata, images, MathML and SVG. It is checked with the W3C EPUBCheck validator in the test suite. Fallbacks: audio and video become a short note naming the file; links to attachments and to pages outside the book keep their text but no target; collapsed blocks are expanded; tabs are shown sequentially; interactive Planner views are the same static snapshots as the site.

Routes and resources use relative links, so a site works at `/` or beneath a subdirectory. `basePath` is validated; absolute canonical URLs come from `build.url`. The exporter runs in the VS Code extension host; a standalone CLI is not included.

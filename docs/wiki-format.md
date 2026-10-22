# Wiki format

A versioned wiki is a directory containing `wiki.yaml`. The extension detects these files inside workspace folders, including multi-root workspaces. Markdown remains the source of truth.

```yaml
schemaVersion: 1
wiki:
  title: My Documentation
  description: Created with NoteSpace
  language: en
  announcement: Version 2 is out — [see what changed](https://example.com/v2) # optional, one line
content:
  root: docs
  homepage: index.md
navigation:
  mode: automatic
  sort: filename # filename, title, order
appearance:
  theme: system # system, light, dark
  accent: '#4f87ff'
  preset: default # default, ocean, forest, paper, terminal, rose (optional)
  font: system # system, humanist, serif, mono (optional)
  width: normal # narrow, normal, wide (optional)
features:
  search: true
  tableOfContents: true
  breadcrumbs: true
  plannerExport: false # export daily notes, inbox, task views and a planner snapshot
build:
  output: dist
  basePath: /
  url: https://docs.example.com/ # optional: canonical links and share previews
i18n: # optional
  languages: [it, de] # translations live in <content root>/<code>/
versions: # optional
  current: '2.0' # label of the live docs
  archived: ['1.0'] # snapshots in <content root>/_versions/<id>/
analytics: # optional, off by default
  provider: none # none, beacon, plausible
  endpoint: '' # https URL (http only for localhost)
  domain: '' # required for plausible
```

Optional sections and fields added in later versions are written only once they differ from their defaults, so older `wiki.yaml` files are not rewritten. **Customize Site Theme** edits `appearance` visually; **Add Language** and **Archive Current Version** edit `i18n` and `versions`. Body text and background colors always come from the light/dark scheme; presets only set the accent (adjusted per scheme to keep 4.5:1 link contrast), typeface, measure and corner radius.

Paths must be safe and relative; build output cannot overlap the content root. Unsupported schema versions are rejected. Unknown YAML fields survive edits made through **Open Wiki Settings**. Links in generated HTML are relative, so the site can be hosted under a subdirectory.

Pages live under the content root. The `assets/images` directory is beside `docs` by default. Frontmatter is optional:

```markdown
---
title: Installation
description: Install the product
order: 1
icon: download # an icon name (rocket, book, globe, download…) or an emoji
status: new # new, updated, beta, deprecated or draft: a badge in the navigation
cover: ../assets/images/install.png # a banner above the title in the Wiki
pager: true # Previous / Next links at the end of this page (off unless set)
draft: false
tags: [guide]
translated_from: 8c3f0a1b2d4e5f60 # set on translations by Create Translation
---

# Installation
```

`icon`, `status` and `cover` are shown in the Wiki of the NoteSpace tab: the icon and status badge in the page tree and above the title, the cover as a banner. Tags open the tag index (**Tags** in the Wiki's page tree or Find). `order` sorts pages when navigation sort is `order`; section order can be set on its `index.md` page. A folder's own page is its `index.md` or `README.md`, else a page with the folder's name beside it (`Guide.md` next to `Guide/`) or inside it (`Guide/Guide.md`). `draft: true` hides a page from static export. **Edit Page Properties and Order** offers guided inputs. Legacy folders configured with `notespace.root` remain readable when no `wiki.yaml` is found.

## Properties, databases, templates and clips

**Properties**: the front matter of a page appears under its title in the Wiki as typed properties — text, number, checkbox (true/false), date (`YYYY-MM-DD`), list and link — read from the YAML values. Click a value to edit it, **Add property** adds one, the trash button removes it. Edits change only that YAML key; comments and the rest of the file stay as they are.

**Databases**: a folder's pages can be shown as a database — **Database** on the folder's page or **Open as Database** in the page tree's folder menu. Every property used in the folder is a column. **Table** edits cells in place and sorts by any column; **Gallery** shows cards with each page's `cover:`; **Board** groups pages by a text, list or checkbox property (`status` by default) and moving a card writes the new value. **New page** creates a page in the folder. The view, sort, grouping and filter are remembered per folder; nothing is stored besides the pages.

**Templates**: _Page from template_ (Create menu) opens a gallery of the built-in templates and the wiki's `.templates/*.md` with a preview. In a page, `[New meeting](template:Meeting)` is a button that creates a page from that template in the page's folder (in the Reader and the Wiki; exported sites show the label only).

**Web clips**: **NoteSpace: Clip a Web Page…** (or _Clip a web page_ in the Create menu) downloads a page once (up to 3 MB, 15 seconds) and saves `clips/<title>.md` with the source, site, author and date in the front matter, the summary and first paragraphs as quotes, a link to the original and a Notes section. Scripts and images are never kept.

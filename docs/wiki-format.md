# Wiki format

A versioned wiki is a directory containing `wiki.yaml`. The extension detects these files inside workspace folders, including multi-root workspaces. Markdown remains the source of truth.

```yaml
schemaVersion: 1
wiki:
  title: My Documentation
  description: Created with NoteSpace
  language: en
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
draft: false
tags: [guide]
translated_from: 8c3f0a1b2d4e5f60 # set on translations by Create Translation
---

# Installation
```

`icon`, `status` and `cover` are shown in the Wiki of the NoteSpace tab: the icon and status badge in the page tree and above the title, the cover as a banner. Tags open the tag index (**Tags** in the Wiki's page tree or Find). `order` sorts pages when navigation sort is `order`; section order can be set on its `index.md` page. `draft: true` hides a page from static export. **Edit Page Properties and Order** offers guided inputs. Legacy folders configured with `notespace.root` remain readable when no `wiki.yaml` is found.

# Knowledge, quality, languages, history and AI

Phase 05 features build on the same files as the rest of NoteSpace: Markdown pages, `wiki.yaml`, and plain folders. Nothing needs a server, an account or a model download.

## Content health

**NoteSpace: Open Content Health Report** (also on the dashboard) computes from the files:

- broken links (with a link to the exact place), pages without incoming links (daily notes, the inbox and each language's homepage are exempt), drafts;
- **duplicate headings** (only the first one is reachable by `#anchor`), **ambiguous titles** (`[[Title]]` cannot decide), **front matter fields with the wrong type** (`tags: 3`, `draft: "no"`), **empty pages** — the same checks appear as editor diagnostics;
- **translation coverage** per language (see below) with _Create translation_ and _Mark as up to date_ actions;
- **API coverage**: for every OpenAPI 3 description in the wiki, which operations are documented. An operation counts when a page embeds the file in an ` ```openapi ` block, names its `operationId`, or writes `METHOD /path` (for example `` `GET /pets` ``).

- **accessibility and structure**: images without alternative text, skipped heading levels (`##` followed by `####`) and more than one `#` title;
- **rule violations** from `quality.rules` in `wiki.yaml` (below);
- **outdated pages** when `quality.staleDays` is set: pages whose last Git commit is older than that many days (pages not in Git are not counted);
- a missing homepage (`content.homepage`), with a button to create it.

Archived versions are excluded from the report, search, the graph and the Planner.

**Health score.** The report shows the share of pages with no broken link and no content issue (duplicate headings, ambiguous titles, front matter problems, empty pages, accessibility/structure findings, rule violations). Pages without incoming links, drafts and outdated pages are listed but do not lower the score, because they are not necessarily wrong. The report states the counts behind the percentage.

**Quick fixes.** In Code mode the light bulb fixes findings with one reviewable edit: _Use “deploy flow” as alternative text_ (from the file name), _Change to a level 2 heading_, _Rename to “Steps (2)”_, _Add front matter field “owner”_ (the field is added empty and stays reported until it has a value) and _Add section “Overview”_ (appended at the end).

**Rules.** Folder-specific requirements live in `wiki.yaml`; they apply to pages under `folder` (relative to the content root; omit it for every page):

```yaml
quality:
  staleDays: 180 # 0 or absent: no age check
  rules:
    - folder: guides
      fields: [owner, description] # front matter fields that must have a value
      sections: [Overview, Troubleshooting] # headings (any level, case-insensitive)
    - fields: [title]
```

## Search

Search is an incremental full-text index over **page sections** (the text between headings): saving one page re-indexes only that page. Every word must occur in the page (title, path or text); partial words and accents match (`cafe` finds _Café_); `#tag` filters by tag. Results open at the best-matching section. With 1,000 pages a query takes under a millisecond on the test machine and re-indexing a page about 0.1 ms (see the `knowledge` unit tests).

**Advanced Search** (_NoteSpace: Advanced Search_, Ctrl+Alt+Shift+F / Cmd+Alt+Shift+F, or the filter button in Search Pages) uses the same index with a query language. Filters narrow the pages, then words are ranked:

| Syntax                                                | Meaning                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `"exact phrase"`                                      | the words in this order                                                                         |
| `-word`                                               | pages without the word                                                                          |
| `tag:api` or `#api`                                   | pages tagged `api`                                                                              |
| `path:guides/`                                        | path contains `guides/`                                                                         |
| `heading:install`                                     | a heading contains “install”; the result opens at that heading                                  |
| `prop:owner`, `prop:owner=alice`, `prop:status!=done` | front matter field present, containing, or not containing a value                               |
| `link:setup`                                          | links to a page whose title or path matches, or to a URL containing the text                    |
| `code:python`                                         | has a ` ```python ` block (`js`, `ts`, `py`, `sh`, `yml` aliases work both ways)                |
| `type:draft`                                          | also `chart`, `dashboard`, `openapi`, `notebook`, `canvas`, `mermaid`, `tasks`, `image`, `math` |
| `version:1.0`                                         | pages of an archived version; `version:latest` is the live documentation                        |
| `sort:title`                                          | or `sort:path`; relevance is the default                                                        |

The panel adds pickers for tags, folders, types, code languages and front matter fields (each adds the filter to the query text, so what you see is what is searched), shows matched words highlighted in each preview, the number of results and the time taken, warns about unknown filters, and keeps the last 15 searches per workspace (_Clear recent searches_ removes them). Arrow keys move through results and Enter opens one. On the test machine a query over 1,000 pages takes a few milliseconds and over 10,000 pages under 50 ms (`docs/benchmark-search.json`, `src/test/unit/search-query.test.ts`).

**Semantic Search (Local Model)** is optional. Set `wikiStudio.semanticSearch.model` to an embedding model you already run behind an OpenAI-compatible endpoint (`wikiStudio.ai.endpoint`, default `http://127.0.0.1:11434/v1`, the address of a local Ollama). The first run asks before sending page text (and warns if the endpoint is not on this machine); drafts and archived versions are skipped and credential-like values are redacted. Vectors are cached in VS Code's workspace storage — not in the wiki — and only changed sections are embedded again. NoteSpace never downloads models.

## Knowledge graph

**Explore Link Graph** shows all pages or, with _Around “page”_, the active page and pages within one or two links in either direction.

## Languages

Add a language with **NoteSpace: Add Language** (writes `i18n.languages` in `wiki.yaml`). Translations are pages in a folder named after the language code:

```text
docs/guide/setup.md        default language (wiki.language)
docs/it/guide/setup.md     Italian
```

**Create Translation** (page context menu, health report) copies the page into the language folder and records `translated_from: <fingerprint>` — a hash of the source text — in its front matter. When the source changes, the translation is reported as _outdated_ until you run **Mark Translation as Up to Date**. `[[Links]]` in a translation prefer pages of the same language. The reader and the static site show a language switcher, set `<html lang>`, and keep navigation, pager and search within the language. The Planner reads tasks from default-language pages only, so translated task lists are not counted twice.

## Versions

**Archive Current Version** copies everything under the content root (pages, images, attachments) to `_versions/<id>/`, lists the id in `versions.archived` and optionally sets a new `versions.current` label. Nothing is moved or deleted and existing folders are never overwritten. Archived pages stay editable files; links inside them resolve within the archive; the reader and static site show a version switcher and an _archived version_ banner; the site index lists archived versions. Exported routes mirror the folders (`pages/_versions/1.0/guide/setup.html`).

**Versions from Git.** _NoteSpace: Browse Wiki at Git Tag or Branch_ shows the wiki as it was at a tag or branch: a read-only snapshot pinned to one commit, read with `git for-each-ref`, `rev-parse`, `ls-tree` and `show`. Nothing is checked out and the working tree is not written. The snapshot has its own page list, search and links (they resolve inside that version), marks pages that have changed or were removed since, lists pages that did not exist yet, and compares any page with the working tree (inline or in VS Code's diff editor). _Compare Page with Git Tag or Branch_ (also in the page's context menu) opens the diff editor directly. Images and embeds are not loaded in snapshots; they show their alternative text or source.

Static exports with archived versions also write `latest/index.html` (always opens the live documentation) and `versions.json` (`{ "latest": {...}, "archived": [{ "id", "href" }] }`) for links and tooling that need a stable entry point.

## Code references

Link to source code with ordinary Markdown links, so pages stay readable on any Markdown host:

```markdown
[parsePage](../src/core/markdown.ts#parsePage)
[WikiIndex.search](../src/core/index.ts#WikiIndex.search)
[the retry loop](../src/dashboards.ts#L120-L140)
[workspace.ts](../src/workspace.ts)
```

A link to a source file (by extension) with `#Symbol`, `#Class.member` or `#L10-L20` is a **code reference**. Symbols are found with the language's own symbol provider (VS Code's _Go to Symbol_); without a language extension a declaration search is used, and when even that finds nothing the reference is reported as unverifiable rather than broken. Problems appear as diagnostics on the link: missing file, symbol renamed or removed, lines beyond the end of the file, or a path outside the workspace folder. Clicking a reference in the reader, Studio or Code mode opens the source at the symbol or lines. _Insert Code Reference_ (in a wiki page in Code mode) searches the workspace's symbols and inserts a link to the one you pick, using the selected text as the label; _Show Documentation for This File_ (editor context menu of a source file) lists the pages that reference it. Static exports keep the link text but drop the link, since the source is not published.

## Page history (Git)

**Show Page History** lists the commits that touched the page (following renames as Git detects them; a rename that also rewrites most of the file is shown as a new file, like `git log --follow`). For each commit you can see what it changed, compare that version with the current text, open VS Code's diff editor, or **Restore** it. Restoring asks first, replaces the page text as a normal edit and saves it; Undo in the editor reverts it. NoteSpace only runs read-only Git commands (`rev-parse`, `log`, `show`, `status`, `config --get`) — never checkout, reset, commit or push.

## Review comments

In Code mode, add review comments with VS Code's comment UI (the **+** in the gutter). Threads can be replied to, resolved, reopened and deleted. They are stored as portable JSON next to the wiki, one file per page: `<content root>/.reviews/<page path>.json` (`schema: wiki-studio.review/1`, author from `git config user.name` or the OS user, ISO dates, the commented line and its text). After a save, threads follow their quoted line when it moved; if the text is gone the thread stays at the old line and says so. Reviews are shared like any other file (Git, copy); there is no server and no real-time sync. They are never exported.

## Importing an Obsidian vault

**Import Obsidian Vault** reads a vault and creates a **new** wiki folder (the vault is never modified, so it is the backup). Before anything is written, a report previews the conversion:

| Obsidian                                                                     | NoteSpace                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| `![[image.png]]`, `![[image.png\|300]]`                                      | `![image](path)` (size dropped, reported) |
| `![[Note]]`                                                                  | `{{ include "Note.md" }}`                 |
| `> [!warning]- Title` callouts                                               | `:::warning "Title" collapsed`            |
| `%%comment%%`                                                                | `<!--comment-->`                          |
| `[[Note#^block]]`                                                            | `[[Note]]` (block ids are reported)       |
| `[[links\|labels]]`, `[[Note#Heading]]`, `==highlight==`, tags, front matter | unchanged                                 |
| Dataview queries, nested callouts, unknown embeds                            | kept as text and reported                 |

Images, PDFs, CSV/JSON, canvases and notebooks are copied; other files are listed as not copied. Links are resolved by name the way Obsidian does (shortest path wins). The report is saved as `import-report.md`. MkDocs and generic Markdown projects keep using **Import Markdown or MkDocs Project** (in place, source files untouched).

## MCP server

**Copy MCP Server Configuration** (trusted workspaces only) copies a configuration for MCP clients that starts `dist/mcp-server.js` with Node.js 20+ over **stdio**; it opens no network port and NoteSpace never starts it itself. It serves one wiki with `list_pages`, `read_page`, `search_pages` and `get_backlinks`. Writing (`write_page`) exists only when you choose _Read and write_: it creates pages or replaces a page the client read (it must send the page's sha256, so newer edits are never overwritten), and refuses paths outside the content root, non-Markdown files, hidden folders and symbolic links. Arguments are validated against each tool's schema.

## AI assistance

Optional, through either VS Code's language models (for example from a chat extension) or an OpenAI-compatible endpoint you configure (`wikiStudio.ai.provider: endpoint`, `wikiStudio.ai.endpoint`, `wikiStudio.ai.model`; an API key, if needed, is kept in VS Code's secret storage via **AI: Set Endpoint API Key**). `wikiStudio.ai.provider: off` disables it.

- **AI: Improve Page or Selection**, **AI: Translate Page** (into a translation page, with `translated_from` set), **AI: Draft Documentation from Code** (from the active source file into a new page), **AI: Review Page Quality** (suggestions only, nothing changes).
- Before each request a dialog names the model or endpoint and the size of the text; only that text is sent. Credential-like values (private keys, cloud and GitHub tokens, `password: …`, bearer tokens, passwords in URLs) are replaced with `[REDACTED]` first, and the dialog says how many.
- Results open as a **proposal in a diff editor**. Nothing changes until **Apply AI Proposal** (editor title), which writes and saves the change (Undo reverts it); **Discard** drops it. A proposal is refused if the page changed after it was made.

## Pasting images

Paste (or drop) a screenshot or image into Studio: it is saved to the wiki's `assets/images/` under its clipboard name (`image.png`, then `image-1.png`…), never overwriting, and inserted at once as `![image.png](../assets/images/image.png)`. In Code mode, VS Code's built-in Markdown paste handles images.

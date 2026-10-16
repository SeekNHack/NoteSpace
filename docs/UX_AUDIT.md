# UX audit and redesign plan (1.1.2 → 1.2.0)

This audit was made on 2026-10-14 against the packaged 1.1.2 VSIX running in an isolated code-server 4.138.0 profile. Baseline screenshots were captured with `scripts/visual-review.mjs` before any change. The redesign that answers it shipped as 1.2.0; results are recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## What the previous interface did well

- Sound architecture: a `CustomTextEditorProvider` backed by the real `TextDocument`, versioned edits, VS Code-owned save/dirty state, guarded Markdown conversion and a shared renderer for preview and export.
- Native tree view, command palette integration, diagnostics, completions and link rewriting.
- Broad automated coverage: unit, extension host and a code-server browser journey.

## Highest-impact defects

| #   | Area     | Defect                                                                                                                                                                                         | Impact                                                                                           |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Studio   | A three-row wall of 30 text buttons (`H1`, `+ row`, `- column`, `Image path`, …) plus three native `<select>`s above the page; a second header repeated "NoteSpace" and the state text.        | The editor read as a form, not a document. Table and block controls were shown while irrelevant. |
| 2   | Studio   | Callouts were grey boxes with a pseudo-element title; titles and collapse state were edited through VS Code input boxes; the callout type was chosen in a toolbar `<select>` before insertion. | Documentation blocks did not feel first-class or editable in place.                              |
| 3   | Studio   | Mermaid blocks showed only source text; the reader rendered diagrams on a hard-coded **white** canvas (`bg: '#ffffff'`) as `<img>`, clashing with dark themes.                                 | Explicit requirement failure.                                                                    |
| 4   | Studio   | Any page with a `[[wiki link]]` opened in Code mode.                                                                                                                                           | The 30 % Obsidian identity was unusable visually.                                                |
| 5   | Studio   | Every Studio edit rewrote the document with Tiptap's normalised Markdown (table padding, list markers, blank lines).                                                                           | Unrelated diff noise on every small edit; conflicts with Git workflows.                          |
| 6   | Modes    | Code and Split opened additional tabs; switching back left duplicates. Split always targeted columns 1 and 2.                                                                                  | Tab clutter; unclear which editor was "the page".                                                |
| 7   | Modes    | No in-editor indication of mode; status bar only showed `Wiki: N`.                                                                                                                             | Modes were not discoverable.                                                                     |
| 8   | Home     | "Wiki Home" rendered the wiki's own index Markdown and appended three generic cards; it opened automatically whenever the sidebar became visible.                                              | Mixed document content with workflow UI; surprising page transitions.                            |
| 9   | Explorer | Backlinks and Outline were two always-expanded panes in the primary sidebar; folders used plain icons; Recent was a flat group; context menu had no grouping.                                  | Navigation sidebar crowded by context views; menus hard to scan.                                 |
| 10  | Reader   | Preview forced `#fff`/`#17212c` backgrounds when `wiki.yaml` selected a theme, ignoring the VS Code theme; callouts used hard-coded blues.                                                     | Light/dark/high-contrast inconsistencies.                                                        |
| 11  | Data     | Undo right after opening could revert the initial load (found by the new smoke test).                                                                                                          | Potential empty-page write.                                                                      |
| 12  | Tests    | The code-server journey could fail on a race (`Build Wiki` asserted before the build finished); the desktop journey failed because viewport emulation broke webview clicks.                    | Unreliable signal.                                                                               |

## Plan (executed)

1. **Design foundation** — one token set mapped to VS Code theme variables, shared typography for Studio, reader and export, a small Lucide icon subset. See [design-system.md](design-system.md).
2. **Studio** — document bar (wiki, backlinks, sync state, Studio/Code/Split switcher), one compact icon toolbar with contextual table tools, bubble menu, grouped slash/insert menu, block handles (insert, drag, move, duplicate, delete), inline callout/container headers, code blocks with language picker and copy, Mermaid live preview, inline link popover, hover cards, Ctrl/Cmd+Click navigation.
3. **Data integrity** — source-preserving merge with verification, versioned rebase for Split mode, conflict UI, wiki-link atoms, read-only faithful rendering for unsupported syntax, safe mode switching that never drops unsaved edits.
4. **Explorer and navigation** — file-icon theme icons, stable ids and auto-reveal of the active page, grouped context menus with inline actions, a single collapsible **Page** view (outline, backlinks, links, properties) that can be dragged to the Secondary Side Bar, mode and wiki status bar items.
5. **Dashboard** — separate workflow surface: continue writing, recent pages with times, favorites, structure, actionable health (broken links, unlinked pages, drafts, warnings); the index page is one click away instead of embedded.
6. **Verification** — screenshot review in dark, light and high-contrast themes and at narrow width; regression fixes found by inspection; extended unit, extension-host and browser tests.

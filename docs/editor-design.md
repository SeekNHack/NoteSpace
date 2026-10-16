# Editor design: Studio, Code and Split

## Modes

| Mode       | Surface                                                                           | Notes                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Studio** | `CustomTextEditorProvider` (`notespace.visual`) with a Tiptap/ProseMirror webview | Default for pages whose syntax round-trips safely.                                                                       |
| **Code**   | VS Code's own Markdown text editor                                                | Syntax highlighting, diagnostics, code actions, completions, hovers and every Markdown extension the user has installed. |
| **Split**  | Studio and the native text editor side by side                                    | Both edit the same `TextDocument`.                                                                                       |

All three are views of one `TextDocument`; VS Code owns dirty state, Save and Auto Save. Switch modes with the segmented control in Studio's document bar, the editor-title actions, the status bar item, **Ctrl/Cmd+Alt+E** (Studio ↔ Code) or the commands _Open in Studio_, _Open in Code (Markdown Source)_ and _Open Split View_ (which toggles). Mode switches replace the tab in place. The Studio caret is carried to the matching source line and back (text-based mapping in `src/core/source-map.ts`); in Split mode the source editor follows the Studio caret and vice versa without stealing focus.

### Safe switching

Studio flushes pending edits before any switch. Replacement uses VS Code's own _Reopen Editor With_ (`reopenActiveEditorWith` on newer VS Code, `workbench.action.reopenTextEditor` on 1.96). Some VS Code versions revert a dirty custom editor while replacing or closing it; `src/modes.ts` therefore snapshots the text of a dirty document before every replacement or tab close and re-applies it as one edit if the platform reverted it. The extension-host test _mode switching replaces the tab in place and keeps unsaved edits_ covers Studio → Code → Studio → Split → Studio with unsaved changes on VS Code 1.96.4.

## Synchronisation protocol

The webview never writes files. Messages:

1. `init` / `document` (host → Studio): full text, a base id `v<version>`, the safety verdict and, for unsupported syntax, a faithful read-only rendering.
2. `edit` (Studio → host): `{ base, body }`. Studio computes `body` in the webview (see _Source preservation_), debounced to 250 ms, one edit in flight.
3. `ack` (host → Studio): the new base id and, when another editor changed the document meanwhile, the merged text for Studio to absorb.

The host remembers the last 24 texts by id. If the document still equals the edit's base, it applies the minimal UTF-16 span. If another editor changed the document (Split mode, rename, external tool), `src/core/rebase.ts` rebases the Studio span over the other change when the two do not touch the same or adjacent text, applies it, and returns a synthetic base for what Studio believes so later edits keep rebasing until Studio is idle. Overlapping changes are never guessed: Studio becomes read-only, keeps its version visible and offers **Copy my version** and **Reload from source**. External changes absorbed while Studio is idle replace only the top-level blocks that differ (`findDiffStart`/`findDiffEnd`), which keeps selection, scroll position and undo history for untouched blocks.

## Source preservation

Tiptap serialises the whole document, normalising Markdown the user did not touch. `src/core/source-merge.ts` aligns three versions — the original source, Studio's serialisation of it (_baseline_) and Studio's serialisation after the edit (_next_) — and copies source lines wherever Studio's lines did not change. The candidate is accepted only if it parses, with the real Studio schema, to the same document as _next_ (`src/visual-merge.ts`); otherwise the normalised serialisation is used. Line endings and the final newline follow the source. Frontmatter is never touched by Studio. Inserting and removing a block on a page with a padded table now leaves the file byte-identical, verified in the browser journey and in `source-merge.test.ts`.

## Undo and redo

Inside Studio, ProseMirror history provides undo/redo with caret restoration. The initial load and absorbed external changes are excluded from history, so undo can never empty a freshly opened page. Ctrl/Cmd+Z, Ctrl+Y and Ctrl/Cmd+Shift+Z are handled by Studio and stopped from reaching the workbench (which would otherwise undo the same change a second time in the `TextDocument`). In Code mode VS Code's native text undo applies. Toolbar Undo/Redo buttons are disabled when there is nothing to undo.

## What Studio edits

Everything in the [Markdown support](markdown-support.md) table: structured content, nested containers, wiki links and highlights, plus **source islands** for constructs Studio does not model structurally (math, keycaps, badges, buttons, tooltips, icons, emoji, footnotes, abbreviations, definition lists, reference links, includes, media embeds, HTML and unknown containers). Islands keep their Markdown byte-identical, render with the reader's own renderer (requested from the host and cached), and are edited as source in place — inline islands in a small popover, block islands in a textarea with **Ctrl/Cmd+Enter** to apply. Edited source is parsed again, so it may become ordinary content.

Pages open in Code by default only when Studio cannot preserve them: links or islands inside formatted text, unbalanced containers, nesting deeper than four levels, or shortcut reference links. Opening such a page explicitly in Studio shows the reader rendering read-only with an **Edit in Code** action.

## Interaction reference

| Action             | How                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Insert any block   | Type `/` at the start of a line or after a space; or the **+** toolbar button; or the **+** block handle |
| Link to a page     | Type `[[` (inserts a portable relative Markdown link) or press **Ctrl/Cmd+K** for the link popover       |
| Follow a link      | **Ctrl/Cmd+Click**; hover shows a page preview card                                                      |
| Format selection   | Bubble menu, or **Ctrl/Cmd+B / I / E / Shift+S**                                                         |
| Headings and lists | Markdown shortcuts (`# `, `- `, `1. `, `[] `, `> `, ` ``` `) or **Ctrl/Cmd+Alt+1–3**                     |
| Move a block       | Drag the ⋮⋮ handle, or **Alt+↑ / Alt+↓**                                                                 |
| Block actions      | Click the ⋮⋮ handle: move up/down, duplicate, delete                                                     |
| Paste              | URLs over a selection become links; images are imported into wiki assets; Markdown text is parsed        |
| Save               | **Ctrl/Cmd+S** (flushes pending edits first)                                                             |
| Browse blocks      | **Block gallery** toolbar button or `/Block gallery`: search, categories, live previews; arrows + Enter  |
| Block properties   | Container header (type, title, collapsed, color); ⚙ **Block properties** on chart/task/embed blocks      |

## Block gallery and inspector

The **Block gallery** lists every block Studio can insert — callouts (note, tip, info, warning, danger, success, example, quote), details, spoiler, FAQ (an accordion of details), hero, navigation card, card grid, tabs, steps, timeline, code, table, image, math, Mermaid, data chart, dashboard embed, task board and API endpoint reference — in seven categories with a search box. Each card's preview is rendered by the reader's own renderer from the block's Markdown, and inserting a block adds exactly that Markdown at the cursor (blocks that need a file — image, dashboard, API reference — open the same file picker as the `/` menu). Keyboard: type to search, arrow keys move through the grid, **Enter** inserts, **Escape** closes the gallery. Blocks that cannot be nested where the cursor is (for example a fifth container level) are not offered.

Properties are edited where the block is, not in a permanent side panel:

- **Containers** (callouts and layout blocks): the header edits the type, the title, the collapsed state and the color (circle → presets and _Use default color_).
- **Components** in fences (` ```chart `, ` ```tasks `, ` ```collection `, ` ```dashboard `, ` ```openapi `, ` ```notebook `, ` ```canvas `): the ⚙ **Block properties** button opens a small form for that component — for a chart the type, title, data file, X/Y columns, grouping and height; for tasks the view, status, page, project, tag, assignee, priority, text and limit; for embeds the file (with **Browse…** listing matching files in the wiki) and, for dashboards, the widget. **Apply** rewrites only the option lines that changed, keeps unknown options, comments and inline data as written, and is one undo step.

There are no icon or alignment properties: the wiki's Markdown syntax has no portable way to store them, and NoteSpace does not invent metadata other Markdown tools would show as stray text. Block colors are the one documented extension (`{color=…}`, see [Markdown support](markdown-support.md#block-colors)); the static export renders them, while MkDocs and other tools ignore or display the attribute.

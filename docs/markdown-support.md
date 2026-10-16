# Markdown support

NoteSpace stores ordinary Markdown files. The reader and static exporter call the same renderer, which parses each page in one pass (so footnotes, reference links and abbreviations work across containers). Raw HTML is escaped, not executed. Source files, including YAML frontmatter, are never rewritten merely by opening them.

## How Studio edits each construct

| Construct                                                                                                                                                                                         | Studio representation                                                                      | Round-trip                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Paragraphs, headings, emphasis, strike, inline code, links, lists, task lists, quotes, rules, tables, images, fenced code (with info strings such as `title=`, `linenums=`, `hl_lines=`), Mermaid | Structured content                                                                         | Untouched lines byte-identical (source-preserving merge); edited blocks use canonical Markdown |
| `:::` callouts and layout containers, including nested tabs, steppers, timelines and grids (up to four levels)                                                                                    | Container blocks with inline type, title and collapse controls                             | As above                                                                                       |
| `[[wiki links]]`                                                                                                                                                                                  | Link atoms                                                                                 | Byte-identical                                                                                 |
| `==highlight==`                                                                                                                                                                                   | Highlight mark (**Ctrl/Cmd+Shift+H**)                                                      | Canonical                                                                                      |
| `++keys++`, `$math$`, `{badge:…}`, `{button:…\|…}`, `{tip:…\|…}`, `{icon:…}`, `{emoji:…}`, footnote references, reference links, inline HTML, media embeds                                        | **Inline source islands**: rendered chips, double-click or Enter to edit the source        | Byte-identical                                                                                 |
| `$$` math, definition lists, abbreviation, footnote and link-reference definitions, `{{ include }}`, HTML blocks and comments, unknown or malformed `:::` containers                              | **Block source islands**: rendered preview (by the reader's renderer) with **Edit source** | Byte-identical                                                                                 |

Islands are re-parsed after editing, so changing a badge's source into plain text turns it into ordinary text, and nothing is ever dropped. Pages still open in Code when Studio cannot preserve them: links, math or inline components inside formatted text (for example `**[[Page]]**`), unbalanced containers, containers nested more than four levels, and shortcut reference links (`[label]` with a definition).

## Documentation containers

Use a line-starting `:::kind` and a closing `:::`. An optional title must be a JSON-style quoted string. Add `collapsed` to start a disclosure closed; otherwise it starts open. Example:

```md
:::warning "Before deployment" collapsed
Keep a **backup** and check [the guide](guide.md).
:::
```

Callout kinds: `note`, `abstract`, `info`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`, and the existing `important`. Existing `:::note` pages retain their source syntax and the `callout note` CSS classes.

Layout kinds: `hero`, `tabs`, `tab`, `accordion`, `details`, `spoiler`, `stepper`, `step`, `timeline`, `event`, `card`, `grid`, `nav-card`, `gallery`, and `caption`. Put `:::tab` blocks inside `:::tabs` for a keyboard-accessible single-selection tab group (Left/Right/Home/End); without scripts each tab remains an open disclosure. `:::caption "Text"` wraps its body in a figure and uses the title as the caption. `:::hero "Title"` makes a landing-page hero; ordinary Markdown links in its body become action buttons. Stepper/timeline and navigation cards have presentation styling but richer semantics are still planned.

New versioned wikis start with an editable `docs/index.md` containing a hero, description and optional Getting started link. Opening NoteSpace shows the configured homepage above the real recent/favorites/health dashboard. Static `index.html` renders the same homepage content above a browsable page list. Existing wiki homepage files are read without modification.

Studio's `/` menu and **+** insert menu offer every registered container. Tabs, steppers, timelines and grids are inserted with two children; tab, step and event entries appear inside their group. The block header edits the type, the quoted title and the collapsed state in place. Steppers and timelines render as ordered lists, navigation cards are fully clickable, and group containers take an accessible name from their title. Unknown or malformed `:::` blocks are kept as block islands.

### Block colors

Every block type has a semantic default color: note, info, abstract and question are blue; tip and success green; warning amber; danger, failure and bug red; details, spoiler, accordion and important purple; navigation cards cyan; examples indigo; quotes, cards and layout groups neutral gray. In Studio, the small circle in a block's header opens a color picker (mouse or keyboard: Enter opens it, arrow keys move, Enter chooses, Escape closes) with ten presets — blue, cyan, teal, green, amber, red, pink, purple, indigo, gray — and **Use default color**.

Only an explicit choice is stored, as an attribute block at the end of the opening line:

```markdown
:::details "Setup" collapsed {color=amber}
Steps that need care.
:::
```

The value is a preset id, never a color code; the actual tint, border and label color come from the light, dark or high-contrast theme, so the block stays readable everywhere (body text keeps the normal text color). The attribute survives Studio, Code and Split, undo/redo, reopening and external edits, and is rendered by the reader, the static site, PDF and EPUB. Any other content between braces (`{.class}`, `{color=#ff0000}`) is not interpreted: the block is kept byte-identical as a source island. Other Markdown tools that understand `:::` containers ignore or display the attribute block; MkDocs Material has no equivalent per-block color, so NoteSpace's own export is the supported way to publish colored blocks.

## Inline documentation syntax

The reader and exporter support definition lists (`Term` followed by `: Definition`), footnotes (`[^id]`), abbreviation definitions (`*[API]: Application Programming Interface`), `==highlight==`, `++Ctrl+K++` keycaps, `$x^2$` and `$$…$$` math rendered to KaTeX MathML, plus:

| Source                          | Output                  |
| ------------------------------- | ----------------------- |
| `{badge:New}`                   | Badge                   |
| `{button:Read guide             | guide.md}`              | Safe page link styled as a button   |
| `{tip:API                       | Application interface}` | Text with a hover/focus explanation |
| `{icon:check}`, `{emoji:smile}` | Small built-in symbols  |

Studio inserts each of these from the `/` menu (Inline and Advanced groups) and edits them as source islands; highlights are a real mark. Unsafe button URLs are rendered as broken links. Raw HTML is always escaped.

## Code, diagrams, images, and navigation

Fenced code supports language highlighting, a copy button, and optional `title="example.ts"`, `linenums="7"`, and `hl_lines="2 4-5"` attributes after the language. Line highlighting counts from the first source line; `linenums` sets only the displayed number. Unsupported languages remain escaped code. A `mermaid` fence is rendered locally as SVG for supported diagram families; unsupported diagrams remain visible as code. No external diagram service is called.

Standard Markdown tables, task lists, images and links work. The source editor supports `[[Page]]`, `[[/folder/Page|label]]`, and `[[Page#heading]]`; Studio inserts relative Markdown links through `[[` completion. A leading `/` in a wiki link means wiki-root-relative; `./` and `../` are relative to the source page. Bare names resolve by relative path, root path, then unique title/filename. Standard Markdown links use relative paths. Headings receive stable IDs, a permalink, and the reader/export table of contents. Local images and attachments use the existing import/browse flows. `![Label](clip.mp4)` or `![Label](clip.mp3)` embeds a local video or audio file; WebM and Ogg are also allowed. Media is limited to 50 MiB and checked against the wiki root and symlinks. **Import Audio or Video** (Studio `/` menu, page context menu or Command Palette) copies MP4, WebM, MP3 or Ogg files into `assets/media` after checking that the content matches the file type. Remote images and media are omitted from export.

## Includes and import

A line containing `{{ include "snippet.md" name="Reader" }}` inserts the body of another indexed page in the same wiki. The included page can use `{{name}}` placeholders; values are plain Markdown text, not code. Relative links and images in included text resolve from the including page. Includes are limited to 12 levels, reject missing/outside pages, and report cycles visibly. Studio shows include directives as block islands with the expanded content as preview. Preview and export both expand includes; export copies local assets referenced by expanded content. This is an internal mechanism, not a public plugin API.

**NoteSpace: Import Markdown or MkDocs Project** creates a `wiki.yaml` beside an existing `docs/` folder (or the safe `docs_dir` from `mkdocs.yml`) without copying or rewriting the Markdown. It maps the project title, description and supported language; it reports unmigrated MkDocs settings and `!!!`, `???`, template/snippet and attribute-list syntax in the NoteSpace output. It refuses to overwrite an existing `wiki.yaml`, leave the workspace, follow a symlink to the docs root, or import a project without Markdown files. Review source-only constructs before editing imported pages visually.

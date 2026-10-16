# NoteSpace design system

NoteSpace lives inside VS Code, so its design system is a thin layer over the active theme rather than a palette of its own. The source of truth is `src/core/design.ts` (tokens and document styles), `src/visual-css.ts` (Studio chrome) and the panel styles in `src/webviews.ts`.

## Principles

- **The document first.** Chrome is one 36 px document bar and one 38 px toolbar; everything else appears in context (bubble menu on selection, table tools inside tables, block handles on hover, block headers inside blocks).
- **Native where native exists.** Tabs, explorer, context menus, Command Palette, quick picks, status bar and the Markdown text editor are VS Code's own. Webviews are used for the visual editor, the reader, the dashboard and the graph only.
- **Theme-derived, never hard-coded.** Every color resolves from a `--vscode-*` variable. Light/dark fallbacks (`light-dark()`) exist only for static exports opened in a browser. `body.vscode-*` classes set `color-scheme` so fallbacks follow the VS Code theme.
- **High contrast is a first-class theme.** `--vscode-contrastBorder` doubles as the hairline color, so every surface gains a visible border in HC themes; menu selection adds `--vscode-contrastActiveBorder` outlines.

## Tokens

| Token                                            | Source                                                                                                                               | Use                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `--ws-bg`, `--ws-fg`                             | `editor.background`, `editor.foreground`                                                                                             | Canvas and text                                                                                             |
| `--ws-muted`, `--ws-faint`                       | `descriptionForeground`, mix of fg/bg                                                                                                | Secondary text, placeholders, line numbers                                                                  |
| `--ws-hairline`, `--ws-border`                   | `contrastBorder` or 12 % / 20 % of fg                                                                                                | Dividers, block outlines                                                                                    |
| `--ws-surface`, `--ws-surface-2`, `--ws-code-bg` | mixes of fg into bg, `textCodeBlock.background`                                                                                      | Cards, table headers, code                                                                                  |
| `--ws-hover`, `--ws-pressed`                     | `toolbar.hoverBackground`, `toolbar.activeBackground`                                                                                | Icon buttons                                                                                                |
| `--ws-accent`, `--ws-focus`, `--ws-selection`    | `textLink.foreground`, `focusBorder`, `editor.selectionBackground`                                                                   | Links, focus rings, selection                                                                               |
| `--ws-menu-*`                                    | `menu.*`, `list.activeSelection*`                                                                                                    | Slash menu, popovers                                                                                        |
| `--ws-blue/cyan/green/orange/red/purple`         | `editorInfo/Warning/Error.foreground`, `gitDecoration.addedResourceForeground`, `symbolIcon.functionForeground`, `terminal.ansiCyan` | Callout kinds. Opaque semantic tokens are used on purpose: some themes define `charts.*` colors with alpha. |
| `--ws-tok-*`                                     | debug token and symbol icon colors                                                                                                   | Syntax highlighting in Studio, reader and export                                                            |

Spacing uses a 4 px scale (`--ws-s1` 4 px … `--ws-s7` 48 px). Radii are 4, 6 and 8 px. UI text is 13 px (`--vscode-font-family`); document text is 15 px with a 1.7 line height; code uses `--vscode-editor-font-family` at 13 px.

## Document typography

The `.doc` class styles Studio's ProseMirror root, the reader article, the read-only Studio fallback and the static export identically. Headings scale 1.85 / 1.4 / 1.15 / 1 em with weight 650 and tight letter spacing; paragraphs use 0.7 em vertical rhythm. The writing column is 760 px by default (`notespace.editor.width`: `normal`, `wide` 960 px, `full`). Tables scroll horizontally instead of overflowing; code blocks scroll and never wrap.

## Components

- **Callouts** — 3 px colored left rule, 6 % tinted background, 10 % tinted header with the kind icon (Lucide, via CSS mask so it inherits the kind color). In Studio the header holds the type picker, an inline title field and the "collapsed by default" toggle.
- **Layout blocks** — cards and nav cards use neutral surfaces; steppers and timelines use numbered/dotted rails; tabs use an underline indicator; the hero uses a subtle accent gradient.
- **Code blocks** — header with language picker, copy action and, for Mermaid, _Edit source_ and _Fit / 1:1_ toggles. Mermaid previews sit on `--ws-surface` and take every color from tokens, so diagrams follow light, dark and HC themes.
- **Menus** — 300 px grouped list with icon tiles, descriptions and Markdown shortcut hints; keyboard first (↑ ↓ Enter Tab Esc); selected row scrolls into view.
- **Status** — a colored dot plus label (`Saved`, `Unsaved changes`, `Syncing…`, `Source editing required`) mirrored in the VS Code status bar.

## Icons

`scripts/icons.mjs` copies 76 icons from `lucide-static` (ISC) into `src/core/icons.ts`. Only these paths ship. Native views use Codicons (`$(name)`) and the file icon theme.

## Responsive behavior

Below 720 px the document bar hides labels and the wiki name, block handles disappear and the canvas padding shrinks to 16 px. Below 480 px the toolbar keeps formatting and the **+** insert menu; dedicated insert buttons move into that menu. The reader drops its outline column below 900 px and button labels below that.

# Charts, notebooks, diagrams and APIs

Phase 04 adds computational and visual content to wikis. Every format is a plain file or a fenced block in Markdown; the same renderer serves Studio, the reader and the static export, so a page looks the same in all three. Nothing runs or connects to the network unless you explicitly ask for it.

| Content        | Stored as                                             | Studio                                                  | Reader / export                         |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| Chart          | ` ```chart ` block + optional CSV/JSON file           | Live preview, `/Chart`                                  | Accessible SVG with data table          |
| Notebook embed | ` ```notebook ` block pointing to a `.ipynb`          | Static preview with saved outputs, `/Notebook`          | Same; notebooks also exported as pages  |
| Notebook       | `.ipynb` (nbformat 4)                                 | VS Code notebook editor (**Open Notebook**)             | `notebooks/…html` pages                 |
| Canvas         | `.canvas` ([JSON Canvas 1.0](https://jsoncanvas.org)) | Visual canvas editor; ` ```canvas ` embeds, `/Canvas`   | SVG preview with links to pages         |
| API reference  | OpenAPI 3.x YAML/JSON + ` ```openapi ` block          | Static reference, `/API reference`; **API Playground**  | Static reference (no requests, no keys) |
| Runnable code  | Ordinary fenced code blocks                           | **Run** button only when enabled (see below)            | Never executed                          |
| Mermaid        | ` ```mermaid ` block                                  | Live preview, diagnostics, 1:1/Fit zoom, **SVG** export | Theme-aware SVG                         |

## Charts

````markdown
```chart
type: line          # line | bar | area | scatter | pie
title: Weekly visits
data: data/visits.csv   # CSV or JSON array of objects, inside the wiki
x: week
y: visits, signups
height: 280         # optional, 160–800
```
````

Data can also be inline: put CSV after a `---` line instead of `data:`. `source: tasks` with `group: status | priority | project | assignee` charts the Planner's tasks (counts per group); in exports this follows the planner privacy setting. Data files are read only from inside the wiki, never through symlinks, up to 2 MiB and 5,000 rows; remote URLs are not fetched. An unknown `source:` or a missing file shows an inline error instead of an empty chart.

Charts are SVG with a `<title>`/`<desc>`, a legend, focusable data points with tooltips (`<title>` on each point) and a collapsible data table, so the values are available without the graphic. Colors come from the theme palette.

## Notebooks

- **Import Jupyter Notebook** copies a validated `.ipynb` into `notebooks/` (never overwriting). The **Pages** view lists notebooks; **Open Notebook** uses VS Code's notebook editor for cell editing, reordering and outputs. **Preview Notebook (Saved Outputs)** shows a read-only rendering beside it. **Convert Notebook to Markdown Page** writes a page with code, text outputs and images stored as wiki assets.
- Reading never needs a kernel. Opening, previewing and exporting never execute a cell.
- Saved outputs render as text, tables (sanitized HTML: no scripts, event handlers, iframes, forms or remote resources), PNG/JPEG/GIF images and ANSI-stripped errors.
- **Running cells.** If the Jupyter extension is installed, its kernels appear as usual. Otherwise NoteSpace offers **NoteSpace Python** (setting `wikiStudio.notebooks.pythonKernel`, default on) when `python3` is found: one persistent process per notebook (variables persist between cells), stdout/stderr, rich `repr`/`_repr_html_`, matplotlib figures as PNG, errors with tracebacks. It runs only when you run a cell, only in a trusted workspace; interrupt stops the process. Outputs are saved in the `.ipynb` when you save the notebook. In code-server cells run on the server.

## Runnable code blocks

Off by default. With `wikiStudio.codeRunner.enabled` in a trusted workspace, Studio shows **Run** on `python`, `javascript`/`js` (the VS Code Node runtime) and `bash`/`sh` blocks. The first run of each runtime per session asks for confirmation and states where it runs (this machine or the remote host). Output shows exit code, duration, stdout and stderr; **Insert output** adds it as a `text` block after the code. Runs stop after `wikiStudio.codeRunner.timeoutSeconds` (default 20) and keep at most 200 KB of output. The reader, preview and export never run code.

## Canvas

`.canvas` files open in the **NoteSpace Canvas** editor: add text cards, page cards (pick a wiki page), link cards and groups; drag to move, resize from the corner, drag the dot to connect, double-click to add or edit, colors from the toolbar, zoom and Fit. Ctrl/Cmd+click opens a page card. The editor writes through VS Code's text document, so undo, dirty state and Save work as usual, and fields NoteSpace does not know (from Obsidian or other tools) are preserved. An invalid file is shown read-only with the parse error and is never overwritten. ` ```canvas ` with `path: canvases/Map.canvas` embeds a static preview; page cards link to the exported pages.

### Excalidraw and draw.io

NoteSpace does not ship an Excalidraw or draw.io editor and does not show buttons for one. Both tools can save diagrams as PNG files with the editable scene embedded (`*.excalidraw.png`, `*.drawio.png`). Add those like any image: they render in Studio, the reader and the export, and they stay editable with the companion VS Code extensions (for example _Draw.io Integration_ or _Excalidraw_), which open them directly. SVG variants are not rendered because NoteSpace does not display SVG files from the workspace (they can contain scripts).

## OpenAPI references and the API Playground

` ```openapi ` with `path: api/openapi.yaml` renders a static reference: operations grouped by tag, parameters, request body and response examples (from `example`, `examples` or generated from the schema). Only local `#/…` references are resolved; nothing is downloaded. The reference is safe to export: it contains no credentials and makes no requests.

**NoteSpace: Open API Playground** (also on YAML/JSON files in the Explorer and on the editor title of an OpenAPI file) lists operations and lets you choose a server, fill path/query/header parameters and a body, and send real HTTP requests:

- Requests are sent by the extension host only when you press **Send**, with a 30-second timeout, and only in a trusted workspace. The first request to each origin asks for permission; approvals are remembered per workspace.
- Credentials (`http` bearer/basic, `apiKey` in header/query/cookie) are stored in VS Code **SecretStorage** under a key derived from the description file and scheme name. They are never sent to the webview, never written to Markdown, settings or exports, and are added to the request only for operations that declare that scheme. OAuth2/OpenID Connect flows are listed but not performed.
- Redirects are not followed automatically (a 3xx is shown as the response) so credentials are never forwarded to another origin. `Set-Cookie` headers are not displayed; bodies over 1 MiB are truncated in the view.
- In code-server, requests leave from the server, which the permission prompt states.
- **Local and sensitive targets.** Before sending, the host name is resolved and classified. Cloud metadata services (`169.254.169.254`, `metadata.google.internal` and similar) are refused. Servers on this machine (loopback), on a private or link-local network, or names that resolve there need their own approval, separate from public servers — so a name that later starts resolving to a private address asks again.
- **Requests that change data.** Every `POST`, `PUT`, `PATCH` or `DELETE` asks for confirmation, each time, naming the method and URL.

The reference shows **response models**: request bodies and responses that use `components.schemas` link to the model, inline schemas are shown as field tables (name, type, required, description; nested fields as `a.b`, array items as `a[].b`), a **Schemas** section lists every model, **Authentication** lists the security schemes, and every operation has a syntax-highlighted **curl** sample with placeholders for credentials (`$TOKEN`, `$API_KEY`). The playground has a **searchable endpoint catalog** (method, path, summary, operationId or tag), a schema view with the operations that use each model, and a _Request and response models_ section per operation. When the description file changes, the open playground and readers update (keeping the last valid version on screen if the new one cannot be parsed).

**Generate API Reference Pages** (command, or right-click a YAML/JSON file) writes ordinary wiki pages from a description into a folder you choose: `index.md` (servers, authentication, endpoint groups), one page per tag with parameters, models, examples and curl, and `schemas.md`. Generated pages are searchable, linkable and exportable like any page. The generated part of each page sits between markers:

```markdown
<!-- wiki-studio:generated source="../../specs/shop.yaml" hash="…" -->

…
<!-- /wiki-studio:generated -->
```

Write your own notes **outside** the markers; they are never touched. Regenerating replaces a generated part only if it is unchanged since it was generated. If you edited inside it, NoteSpace asks: **Replace Generated Section** (your edits there are lost), **Keep My Edits** (the page is left as is) or **Compare** (VS Code's diff editor, then the question again). A file with the same name but no markers is never replaced and is reported as skipped. When a description changes, NoteSpace tells you how many generated pages are out of date and offers _Regenerate…_; it does not regenerate on its own.

## Offline and missing dependencies

Charts, notebook previews, canvases, API references and Mermaid work offline with no extra installation. Without `python3` (or with the kernel disabled) notebooks are read-only unless another kernel is installed; without the code runner enabled no Run button appears. The playground needs network access to the API you call, nothing else.

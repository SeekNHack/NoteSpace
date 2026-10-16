# Next steps

## After the 1.2.0 redesign

- Source islands are edited as Markdown source (with a rendered preview), not through dedicated visual forms for each component.
- Links, math or inline components inside bold/italic text still open the page in Code (Tiptap cannot serialise marks around inline atoms losslessly).
- Mermaid previews are rendered by the host renderer (beautiful-mermaid); diagram types it does not support keep their source with an inline error. There is no visual diagram editor; the source is edited in the block.
- Extensions cannot default a view into the Secondary Side Bar on VS Code 1.96; the **Page** view is collapsed in the NoteSpace container and can be dragged there.
- Block drag and drop uses ProseMirror's native drag; it is not covered by pointer-driven browser tests yet (keyboard moves are).
- The VS Code 1.96 snapshot-and-restore path keeps unsaved content across mode switches but the restore is one edit, so text-editor undo history from before the switch is not preserved on that version.

## Phase 02

Verified complete with 1.3.0 (see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)).

## Phase 03

Verified complete with 1.4.0. Known limits: task descriptions are edited in the page, not in the Planner; the board's column order is a per-workspace preference, not stored in the wiki; reminders run only while VS Code is open.

## Phase 04

Verified complete with 1.5.0. Known limits: the built-in Python kernel is a light local runner (no widgets, no `input()`, no Jupyter messaging protocol) — install the Jupyter extension for full kernels; the code runner offers Python, Node and Bash only; the API Playground supports bearer, basic and API-key credentials (OAuth2/OpenID Connect are listed, not performed) and resolves only local `$ref`s; Excalidraw and draw.io editing relies on their own extensions.

## Phase 05

Verified complete with 1.6.0. Known limits: semantic search and the endpoint AI provider need a model server you run (NoteSpace does not ship or download models); review comments are shown in Code mode (Studio pages show them after switching to Code); the Obsidian importer does not run Dataview queries or keep image sizes; Git history relies on Git's rename detection; VS Code 1.96 has no API to register MCP servers, so the configuration is copied for your MCP client.

## Phase 06

Verified complete with 1.7.0. Known limits: PDF needs a locally installed Chromium-based browser (otherwise a print-ready HTML page is produced); EPUB covers the current version in the default language and replaces audio/video with notes; `basePath` does not yet produce absolute canonical URLs; there is no standalone CLI. Next: phase 06.5 (block colors), 07 (gallery, dashboards, OpenAPI studio, code intelligence) and 08 (workspace navigation).

## Phase 06.5

Verified complete with 1.8.0. Known limits: colors are presets (no free color values, by design); MkDocs Material cannot show per-block colors, so publishing colored blocks relies on NoteSpace's own export; the embedded Kanban board in pages is read-only (cards move in the Planner board).

## Phase 07

Implemented with 1.9.0 (verification results in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)). Known limits: dashboards read `.xlsx` only (not `.xls`/`.xlsb`), take formula results from the values Excel saved, and implement the documented formula subset rather than Excel's language; tables in dashboards page but do not sort; dashboard files use the `.wiki-dashboard.json` suffix (the custom editor pattern) rather than any `*.json`; the block inspector covers fenced components while containers keep their header controls, and there are no icon or alignment properties because the Markdown syntax has none; Git snapshots show page text without images or embeds; OpenAPI references resolve only local `$ref`s and OAuth2 flows are not performed; the API Playground's trust gate is not covered by an automated untrusted-workspace test. Next: phase 08 (workspace navigation, compared with Workspace Wiki).

## Phase 08

Implemented with 1.10.0 (results in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)). Known limits: `.gitignore` support reads the workspace folder's `.gitignore` files but not `.git/info/exclude` or the global excludes file; readable labels apply to the Pages view only (the dashboard and search show page titles); a folder is not represented by its index page; NoteSpace is not a web extension. Following the active editor is verified in the browser journey, not in the extension-host suite (the test host does not render tree views).

## Unified workspace (1.11.0)

Known limits: the old dashboard page is replaced by Home and Insights; boards show tasks of one wiki at a time; column icons come from the extension's icon set; dragging a card from one board to another is done with **Add to another board** or **Move into board file** rather than by drag; the Planner browser journey was intermittent once in five runs during verification (a calendar drag), then passed three times in a row.

## API client and wiki management (1.12.0)

Known limits, documented in [api-client.md](api-client.md#limits): no OAuth implicit/password/device grants, token refresh or client certificates; the authorization code flow needs the browser to reach a loopback port on the extension host (an issue with code-server and remote development); no proxy, cookie jar, WebSocket, gRPC or Postman/Insomnia import; collections live in the first workspace folder. Still open from earlier: making the Kanban embedded in pages draggable.

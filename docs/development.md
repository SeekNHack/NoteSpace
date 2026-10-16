# Development

Install Node.js 22.12+ and run `npm ci`. `npm run build` bundles the extension host and visual editor with esbuild. `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:ui`, and `npm run package` are the main commands. `npm run watch` watches only the extension-host bundle; rerun the full build after visual editor changes.

The repository is a TypeScript extension package with framework-independent modules under `src/core`, workspace and command adapters under `src`, and browser code in `src/visual-ui.ts` and `media/webview.js`. It is not split into npm workspaces. The VSIX bundles `dist/extension.js`, `dist/visual.js`, and media assets. `scripts/notices.mjs` regenerates dependency licenses.

Open this repository in VS Code and press F5 for an Extension Development Host. The workspace settings point the explorer at `examples/wiki`. For code-server, package, install the VSIX with `code-server --install-extension ... --force`, then reload the browser window. Workspace access uses `vscode.workspace.fs`; no workspace scripts or Git commands run automatically.

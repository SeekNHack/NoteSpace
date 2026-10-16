# Contributing

Use Node.js 22.12+ and npm. Run `npm ci`, then `npm test`. Press F5 in VS Code to launch the example workspace. `npm run watch` rebuilds the extension as you edit; reload the Extension Development Host after changes.

Keep link semantics in `src/core/`; providers, preview and export must agree. Add behavior tests for bug fixes, especially source ranges and rename edits. Exercise changes to VS Code integration in `npm run test:integration`; exercise visible workflows in `npm run test:ui`. Linux headless runs need `xvfb-run -a` and Electron's GTK/NSS/GBM/ALSA dependencies. Run `npm run package` to confirm the installable artifact still builds.

Prefer native VS Code interactions over new webviews. Webviews must escape user content, retain a restrictive CSP, validate messages and support keyboard input. Use `workspace.fs` and URI operations for workspace data. Do not execute workspace commands, collect telemetry, add credentials, or introduce network calls without an explicit product design and user controls.

Keep changes focused, describe the user-visible behavior and list the checks actually run. Never claim CI or platform coverage that has not run. Open an issue or a pull request on [GitHub](https://github.com/SeekNHack/NoteSpace). Contributions are under the MIT license.

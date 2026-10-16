# Release guide

1. Use Node.js 22.12+ and a clean checkout. Run `npm ci`.
2. Update the package version and CHANGELOG. The VSIX output filename is generated from package metadata.
3. Run `npm test`, `npm run test:integration`, `npm run test:ui` and `npm audit`. Run host tests on minimum-supported VS Code and current stable. Linux headless runs need `xvfb-run -a`.
4. Run `npm run package`. The prepublish hook typechecks, bundles runtime dependencies and regenerates third-party notices. Inspect the VSIX file list and install it into a clean VS Code profile.
5. Verify initialize → create → link → preview → rename → Save All → export in the installed package. Check high-contrast mode, narrow panels, keyboard navigation and the supported host platforms. Update `docs/VALIDATION.md` with actual results.
6. Commit, then tag and push: `git tag v<version> && git push origin v<version>`. The **Release NoteSpace** workflow (`.github/workflows/release.yml`) runs the tests, checks that the tag matches `package.json`, builds the VSIX and attaches it to a GitHub Release with the version's CHANGELOG section as notes. VSIX files are never committed (`*.vsix` and `artifacts/` are ignored).
7. Visual Studio Marketplace (optional): create the publisher named in `package.json` (`notespace`, or change it to one you own) at https://marketplace.visualstudio.com/manage, create an Azure DevOps personal access token with the Marketplace (Manage) scope and save it as the repository secret `VSCE_PAT`. The release workflow then also runs `vsce publish`; without the secret that step is skipped. Never commit credentials.

The regular CI workflow builds a VSIX artifact for each push; only the release workflow publishes.

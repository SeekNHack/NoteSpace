import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureTestTools, pythonPath, toolsDir } from './test-tools.mjs';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'notespace-test-'));
await ensureTestTools();
try {
  for (const name of ['primary', 'secondary', 'exports', 'user', 'extensions'])
    await mkdir(path.join(temporary, name), { recursive: true });
  const workspace = path.join(temporary, 'test.code-workspace');
  await writeFile(
    workspace,
    JSON.stringify({
      folders: [{ path: 'primary' }, { path: 'secondary' }],
      settings: {
        'workbench.startupEditor': 'none',
        'files.autoSave': 'off',
        // Same line endings on every OS (Windows defaults to CRLF); CRLF is covered by unit tests.
        'files.eol': '\n',
        'extensions.autoUpdate': false,
        'security.workspace.trust.enabled': false,
      },
    }),
  );
  await build({
    entryPoints: ['src/test/integration/suite.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    outfile: 'out/integration.cjs',
    sourcemap: true,
  });
  await runTests({
    version: process.env.VSCODE_VERSION || '1.96.4',
    extensionDevelopmentPath: process.cwd(),
    extensionTestsPath: path.resolve('out/integration.cjs'),
    extensionTestsEnv: {
      WIKI_TEST_DIR: temporary,
      // Real tools for checking exports: a Chromium for PDF printing, epubcheck and pypdf.
      WIKI_CHROMIUM: await import('playwright-core')
        .then((p) => p.chromium.executablePath())
        .catch(() => ''),
      WIKI_TOOLS: toolsDir,
      WIKI_PYTHON: pythonPath,
      WIKI_BENCHMARK: process.env.WIKI_BENCHMARK || '',
      WIKI_BENCHMARK_REPORT: process.env.WIKI_BENCHMARK_REPORT || '',
    },
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--no-sandbox',
      '--disable-gpu',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${path.join(temporary, 'user')}`,
      `--extensions-dir=${path.join(temporary, 'extensions')}`,
    ],
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}

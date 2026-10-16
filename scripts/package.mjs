import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@vscode/vsce/vsce',
    'package',
    '--no-dependencies',
    '--allow-missing-repository',
    '--no-rewrite-relative-links',
    '--out',
    `${pkg.name}-${pkg.version}.vsix`,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);

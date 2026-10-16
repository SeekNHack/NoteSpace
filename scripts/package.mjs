import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@vscode/vsce/vsce',
    'package',
    '--no-dependencies',
    // README images and links point to the repository, so they work on the Marketplace too.
    '--baseContentUrl',
    'https://github.com/SeekNHack/NoteSpace/blob/main',
    '--baseImagesUrl',
    'https://github.com/SeekNHack/NoteSpace/raw/main',
    '--out',
    `${pkg.name}-${pkg.version}.vsix`,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);

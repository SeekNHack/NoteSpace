import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { toXhtml } from '../../core/xhtml';
import { crc32, zip } from '../../core/zip';
import {
  appearanceCss,
  contrast,
  presets,
  readableAccent,
  resolveAppearance,
} from '../../core/themes';
import { parseConfig } from '../../core/config';

test('rendered HTML becomes well-formed XHTML with namespaces and media fallbacks', () => {
  const r = toXhtml(
    '<p>a<br>b & <input type="checkbox" disabled checked></p><img src="x.png" alt=""><svg viewBox="0 0 1 1"><use xlink:href="#a"/><foreignObject></foreignObject></svg><math><mi>x</mi></math><video controls src="v.mp4"></video><script>alert(1)</script><details><summary>S</summary>t</details>',
    (u) => (u === 'x.png' ? 'img/x.png' : u),
  );
  assert.equal(
    r.xhtml,
    '<p>a<br/>b &amp; <input type="checkbox" disabled="disabled" checked="checked"/></p><img src="img/x.png" alt=""/><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><use xlink:href="#a"/><foreignObject/></svg><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math><p class="epub-fallback">Video: v.mp4 — not included in the e-book; see the online documentation.</p><details><summary>S</summary>t</details>',
  );
  assert.deepEqual([r.svg, r.mathml, r.fallbacks, r.resources], [true, true, 1, ['img/x.png']]);
});

test('ZIP output is readable by unzip with stored and deflated entries', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = zip([
    { name: 'mimetype', data: new TextEncoder().encode('application/epub+zip'), compress: false },
    { name: 'dir/ü.txt', data: new TextEncoder().encode('hello '.repeat(100)) },
  ]);
  const buf = Buffer.from(bytes);
  assert.equal(buf.subarray(30, 38).toString(), 'mimetype', 'mimetype is the first entry');
  assert.equal(
    buf.subarray(38, 58).toString(),
    'application/epub+zip',
    'stored uncompressed right after its name',
  );
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  writeFileSync(path.join(dir, 'a.zip'), bytes);
  try {
    execFileSync('unzip', ['-q', '-o', 'a.zip'], { cwd: dir });
    assert.equal(readFileSync(path.join(dir, 'dir/ü.txt'), 'utf8'), 'hello '.repeat(100));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // No unzip binary: decode the deflated entry directly.
    const start = 30 + 8 + 20 + 30 + Buffer.byteLength('dir/ü.txt');
    assert.match(inflateRawSync(buf.subarray(start)).toString(), /^hello /);
  }
});

test('theme presets resolve with readable link colors and validated settings', () => {
  for (const preset of presets) {
    const accent = resolveAppearance({ theme: 'system', accent: '', preset: preset.id }).accent;
    assert.ok(contrast(readableAccent(accent, '#ffffff'), '#ffffff') >= 4.5, `${preset.id} light`);
    assert.ok(contrast(readableAccent(accent, '#1e1e1e'), '#1e1e1e') >= 4.5, `${preset.id} dark`);
  }
  assert.match(
    appearanceCss({ theme: 'dark', accent: '#ffff00', preset: 'paper' }),
    /color-scheme:dark;--ws-accent:light-dark\(#[0-9a-f]{6},#ffff00\);--ws-font:"Iowan Old Style".*--ws-doc-width:680px;--ws-r1:1px;--ws-r2:2px/,
  );
  const base = 'schemaVersion: 1\nwiki:\n  title: T\n';
  assert.equal(parseConfig(base).analytics.provider, 'none', 'analytics is off by default');
  assert.throws(
    () => parseConfig(`${base}analytics:\n  provider: beacon\n`),
    /endpoint is required/,
  );
  assert.throws(
    () => parseConfig(`${base}analytics:\n  provider: beacon\n  endpoint: http://example.com/e\n`),
    /https URL/,
  );
  assert.equal(
    parseConfig(`${base}analytics:\n  provider: beacon\n  endpoint: https://stats.example.com/e\n`)
      .analytics.endpoint,
    'https://stats.example.com/e',
  );
  assert.throws(
    () => parseConfig(`${base}appearance:\n  preset: neon\n`),
    /appearance.preset must be one of/,
  );
});

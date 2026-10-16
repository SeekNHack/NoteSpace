import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSymbol, parseCodeRef } from '../../core/code-refs';
import { parsePage } from '../../core/markdown';
import { WikiIndex } from '../../core/index';
import { renderPage } from '../../core/render';

test('code references are links to source files with optional symbols or lines', () => {
  assert.deepEqual(parseCodeRef('../src/core/markdown.ts#parsePage'), {
    path: '../src/core/markdown.ts',
    symbol: 'parsePage',
  });
  assert.deepEqual(parseCodeRef('../src/index.ts#WikiIndex.search'), {
    path: '../src/index.ts',
    symbol: 'WikiIndex.search',
  });
  assert.deepEqual(parseCodeRef('lib/a%20b.py#L10-L20'), {
    path: 'lib/a b.py',
    line: 10,
    endLine: 20,
  });
  assert.deepEqual(parseCodeRef('main.go'), { path: 'main.go' });
  for (const notCode of ['Guide.md', 'https://x.org/a.ts', 'image.png', 'data.csv', 'notes.txt'])
    assert.equal(parseCodeRef(notCode), undefined, notCode);
  const tree = [
    {
      name: 'WikiIndex',
      start: 3,
      end: 90,
      children: [
        { name: 'search', start: 40, end: 60 },
        { name: 'resolve', start: 10, end: 30 },
      ],
    },
    { name: 'parsePage(root, file)', start: 100, end: 120 },
    { name: 'Other', start: 130, end: 140, children: [{ name: 'search', start: 135, end: 136 }] },
  ];
  assert.equal(findSymbol(tree, 'WikiIndex.search')?.start, 40);
  assert.equal(findSymbol(tree, 'parsePage')?.start, 100, 'signatures in names are ignored');
  assert.equal(findSymbol(tree, 'resolve')?.start, 10, 'a unique member can be named alone');
  assert.equal(findSymbol(tree, 'search'), undefined, 'an ambiguous member is not guessed');
  assert.equal(findSymbol(tree, 'WikiIndex.missing'), undefined);
});

test('code references render as source links in the reader and as marked text in exports', () => {
  const page = parsePage(
    'r',
    'guide.md',
    'file:///w/guide.md',
    '# Guide\n\nSee [parsePage](../src/markdown.ts#parsePage) and [Guide](guide.md).',
  );
  const index = new WikiIndex();
  index.replace([page]);
  const reader = renderPage(page, index, {
    pageHref: () => 'x.html',
    codeHref: (t) => `#code:${encodeURIComponent(t)}`,
  });
  assert.match(
    reader,
    /<a href="#code:\.\.%2Fsrc%2Fmarkdown\.ts%23parsePage" class="code-ref" title="Source: \.\.\/src\/markdown\.ts#parsePage">parsePage<\/a>/,
  );
  const site = renderPage(page, index, { pageHref: () => 'x.html' });
  assert.match(
    site,
    /<span class="code-ref" title="Source: \.\.\/src\/markdown\.ts#parsePage">parsePage<\/span>/,
  );
  assert.match(site, /<a href="x.html">Guide<\/a>/);
  assert.doesNotMatch(site, /broken-link/);
});

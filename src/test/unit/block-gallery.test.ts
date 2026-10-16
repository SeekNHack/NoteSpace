import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from '../../core/markdown';
import { WikiIndex } from '../../core/index';
import { renderPage } from '../../core/render';
import { galleryCategories, galleryEntries, searchGallery } from '../../core/block-gallery';
import { componentFields, readProps, writeProps } from '../../core/component-props';
import { calloutKinds, layoutKinds } from '../../core/rich-blocks';

test('every gallery sample renders as its block with the reader renderer', () => {
  const index = new WikiIndex();
  for (const entry of galleryEntries) {
    assert.ok((galleryCategories as readonly string[]).includes(entry.category), entry.id);
    if (!entry.sample) continue;
    const page = parsePage('r', 'a.md', 'file:///a.md', entry.sample);
    index.replace([page]);
    const html = renderPage(page, index, {
      pageHref: () => '#',
      imageHref: () => undefined,
      chart: (s) => `<figure class="chart">${s.length}</figure>`,
    });
    assert.doesNotMatch(html, /<p>:::|source-island/, `${entry.id} renders as a block`);
    const kind = entry.command.replace(/^(callout|layout)-/, '');
    if (entry.command.startsWith('callout-'))
      assert.match(html, new RegExp(`callout ${kind}\\b`), entry.id);
    if (entry.command.startsWith('layout-'))
      assert.match(html, new RegExp(`rich-${kind}\\b`), entry.id);
  }
});

test('gallery entries point at real block kinds and search by words', () => {
  for (const entry of galleryEntries) {
    if (entry.command.startsWith('callout-'))
      assert.ok((calloutKinds as readonly string[]).includes(entry.command.slice(8)), entry.id);
    if (entry.command.startsWith('layout-'))
      assert.ok((layoutKinds as readonly string[]).includes(entry.command.slice(7)), entry.id);
  }
  assert.deepEqual(
    searchGallery('faq').map((e) => e.id),
    ['faq'],
  );
  assert.deepEqual(
    searchGallery('api endpoint').map((e) => e.id),
    ['http', 'api'],
  );
  assert.ok(searchGallery('callout').length >= 8);
  assert.equal(searchGallery('').length, galleryEntries.length);
});

test('the inspector edits component options and keeps everything else', () => {
  const chart =
    '# comment kept\ntype: bar\ntitle: Weekly visits\nx: week\ny: visits\n---\nweek,visits\nW1,120\n';
  assert.deepEqual(readProps(chart), {
    type: 'bar',
    title: 'Weekly visits',
    x: 'week',
    y: 'visits',
  });
  const next = writeProps(chart, { type: 'line', title: '', height: '320', y: 'visits, signups' });
  assert.equal(
    next,
    '# comment kept\ntype: line\nx: week\ny: visits, signups\nheight: 320\n---\nweek,visits\nW1,120\n',
  );
  assert.equal(writeProps('view: board', { page: 'this' }), 'view: board\npage: this');
  assert.equal(writeProps('', { path: 'api/shop.yaml' }), 'path: api/shop.yaml');
  assert.equal(
    writeProps('path: a.yaml\n', { path: 'b\nc.yaml' }),
    'path: b c.yaml\n',
    'values stay on one line',
  );
  assert.equal(
    writeProps('Path: a.ipynb', { path: 'b.ipynb' }),
    'Path: b.ipynb',
    'key spelling is kept',
  );
  for (const [lang, fields] of Object.entries(componentFields))
    assert.ok(fields.length && new Set(fields.map((f) => f.key)).size === fields.length, lang);
});

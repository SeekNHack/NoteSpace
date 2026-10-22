import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from '../../core/markdown';
import { createConfig, defaultConfig, parseConfig } from '../../core/config';
import { postDate, renderCollection } from '../../core/collections';

const page = (file: string, text: string) => parsePage('root', file, `file:///wiki/${file}`, text);

test('wiki.announcement and build.url are validated and kept', () => {
  const config = defaultConfig('Docs');
  config.wiki.announcement = 'New **release**';
  config.build.url = 'https://docs.example.com/guide';
  const parsed = parseConfig(createConfig(config));
  assert.equal(parsed.wiki.announcement, 'New **release**');
  assert.equal(parsed.build.url, 'https://docs.example.com/guide/');
  assert.equal(parseConfig(createConfig(defaultConfig('Docs'))).build.url, undefined);
  assert.throws(
    () => parseConfig('schemaVersion: 1\nwiki:\n  title: X\nbuild:\n  url: http://x.com\n'),
    /build\.url/,
  );
  assert.throws(
    () =>
      parseConfig(`schemaVersion: 1\nwiki:\n  title: X\n  announcement: "${'a'.repeat(401)}"\n`),
    /announcement/,
  );
});

test('posts are listed newest first with date, authors, tags and a summary', () => {
  const index = page('blog/index.md', '# Blog\n');
  const a = page(
    'blog/2026-01-02-hello.md',
    '---\nauthors: [Ana, Bo]\ntags: [news]\n---\n# Hello\n\nThe first post of the blog.\n',
  );
  const b = page(
    'blog/old.md',
    '---\ndate: 2025-12-01\n---\n# Old\n\nAn older post with some text.\n',
  );
  const c = page('guide.md', '# Guide\n');
  assert.equal(postDate(a), '2026-01-02');
  assert.equal(postDate(b), '2025-12-01');
  const html = renderCollection('collection', 'source: pages\nfolder: blog\nview: posts', {
    tasks: [],
    pages: [index, a, b, c],
    page: index,
    today: '2026-01-05',
    pageHref: (p) => p.path,
    showTasks: true,
  });
  assert.match(
    html,
    /Hello[\s\S]*January 2, 2026[\s\S]*Ana, Bo[\s\S]*#news[\s\S]*The first post of the blog\.[\s\S]*Old[\s\S]*December 1, 2025/,
  );
  assert.doesNotMatch(html, /Guide/);
  const byTitle = renderCollection('collection', 'source: pages\nfolder: blog\nsort: title', {
    tasks: [],
    pages: [index, a, b],
    page: index,
    today: '2026-01-05',
    pageHref: (p) => p.path,
    showTasks: true,
  });
  assert.ok(byTitle.indexOf('Hello') < byTitle.indexOf('Old'));
});

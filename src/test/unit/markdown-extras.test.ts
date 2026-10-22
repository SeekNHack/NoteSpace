import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from '../../core/markdown';
import { WikiIndex } from '../../core/index';
import { renderPage } from '../../core/render';
import { blockSource, markAnnotations, sectionSource } from '../../core/markdown-extras';

const page = (file: string, text: string) => parsePage('root', file, `file:///wiki/${file}`, text);
const indexOf = (...pages: ReturnType<typeof page>[]) => {
  const index = new WikiIndex();
  index.replace(pages);
  return index;
};
const href = (p: { path: string }, anchor?: string) => `${p.path}${anchor ? `#${anchor}` : ''}`;

test('block references: ^ids become anchors, links resolve and ![[...]] embeds the block', () => {
  const source = page(
    'facts.md',
    '# Facts\n\nThe sky is blue. ^sky\n\n- Grass is green ^grass\n- Snow is white\n\n## Details\n\nMore.\n\n## Other\n\nElse.\n',
  );
  const reader = page(
    'reader.md',
    '# Reader\n\nSee [[Facts#^sky]].\n\n![[Facts#^grass]]\n\n![[Facts#Details]]\n\n```\n![[Facts#^sky]]\n```\n',
  );
  const index = indexOf(source, reader);
  assert.equal(index.resolve(reader, 'Facts#^sky').heading?.slug, 'block-sky');
  assert.equal(index.resolve(reader, 'Facts#^missing').error, 'heading');
  const own = renderPage(source, index, { pageHref: href });
  assert.match(own, /<p id="block-sky">The sky is blue\.<\/p>/);
  assert.match(own, /<li id="block-grass">Grass is green<\/li>/);
  assert.doesNotMatch(own, /\^sky|\^grass/);
  const html = renderPage(reader, index, { pageHref: href });
  assert.match(html, /<a href="facts\.md#block-sky">/);
  assert.match(html, /class="embed"[\s\S]*Grass is green[\s\S]*<\/div><\/div>/);
  assert.match(html, /class="embed"[\s\S]*Details[\s\S]*More\./);
  assert.doesNotMatch(html, /Else\./, 'the embedded section stops at the next heading');
  assert.match(html, /<code>!\[\[Facts#\^sky\]\]\n<\/code>/, 'code is left alone');
  assert.equal(blockSource(source.body, 'grass'), 'Grass is green');
  assert.equal(sectionSource('## A\n\nx\n\n### B\n\ny\n\n## C\n', 0), '## A\n\nx\n\n### B\n\ny');
});

test('embeds of a page that embeds itself stop', () => {
  const a = page('a.md', '# A\n\n![[B]]\n');
  const b = page('b.md', '# B\n\n![[A]]\n');
  const html = renderPage(a, indexOf(a, b), { pageHref: href });
  assert.match(html, /embedded too deeply/);
});

test('mentions: dates read relative to today and people become chips; tasks keep badges', () => {
  const p = page(
    'm.md',
    '# M\n\nMeet @ana on @2026-10-23 and @today, mail me@example.com.\n\n- [ ] Call @bob due:2026-10-24\n',
  );
  const html = renderPage(p, indexOf(p), { pageHref: href, today: '2026-10-22' });
  assert.match(html, /<a class="mention mention-person" href="#person:ana">@ana<\/a>/);
  assert.match(html, /href="#date:2026-10-23"[^>]*>Tomorrow<\/a>/);
  assert.match(html, /href="#date:2026-10-22"[^>]*>Today<\/a>/);
  assert.match(html, /me@example\.com/);
  assert.doesNotMatch(html, /mention-person" href="#person:example/);
  assert.match(html, /task-badge[^"]*person[\s\S]*bob/);
});

test('code annotations: markers link to the list after the block', () => {
  assert.equal(markAnnotations('a: 1 # (1)\nb: 2 # (2)!\n').code, 'a: 1 # 1\nb: 2 2\n');
  const p = page(
    'c.md',
    '# C\n\n``` { .yaml .annotate }\ntheme: x # (1)\n```\n\n1. The theme.\n\n```js annotate\nrun(); // (1)!\n```\n',
  );
  const html = renderPage(p, indexOf(p), { pageHref: href });
  assert.match(
    html,
    /<a class="code-annotation" href="#annotation-1-1" aria-label="Annotation 1">1<\/a>/,
  );
  assert.match(html, /<ol class="code-annotations">\s*<li id="annotation-1-1">The theme\.<\/li>/);
  assert.match(html, /language-yaml/);
  assert.match(html, /href="#annotation-2-1"/);
  assert.doesNotMatch(html, /\/\/ <a class="code-annotation"/);
});

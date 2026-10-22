import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipFromHtml, clipMarkdown } from '../../core/web-clip';
import { parsePage } from '../../core/markdown';

test('a clip keeps the metadata and the main paragraphs, never scripts or menus', () => {
  const html = `<!doctype html><html><head><title>Fallback title</title>
    <meta property="og:title" content="The &amp; Article">
    <meta name="description" content="What it is about.">
    <meta property="og:site_name" content="Example News">
    <meta name="author" content="Ana Writer">
    <meta property="article:published_time" content="2026-10-01T08:00:00Z">
    <script>alert('x')</script></head><body>
    <nav><p>Menu entry that is long enough to be a paragraph of text.</p></nav>
    <article><h1>The Article</h1><p>First paragraph of the article, with <b>bold</b> words &mdash; and more.</p>
    <p>short</p><p>Second paragraph that is long enough to keep in the clip [x] *y*.</p></article>
    <footer><p>Footer text that is long enough to be a paragraph of text too.</p></footer></body></html>`;
  const clip = clipFromHtml(html, 'https://news.example.com/a?b=1');
  assert.equal(clip.title, 'The & Article');
  assert.equal(clip.description, 'What it is about.');
  assert.equal(clip.site, 'Example News');
  assert.equal(clip.author, 'Ana Writer');
  assert.equal(clip.published, '2026-10-01');
  assert.deepEqual(clip.paragraphs, [
    'First paragraph of the article, with bold words — and more.',
    'Second paragraph that is long enough to keep in the clip [x] *y*.',
  ]);
  const md = clipMarkdown(clip, '2026-10-22');
  const page = parsePage('r', 'clips/a.md', 'file:///w/clips/a.md', md);
  assert.equal(page.title, 'The & Article');
  assert.deepEqual(page.tags, ['clip']);
  assert.equal(page.properties?.source, 'https://news.example.com/a?b=1');
  assert.equal(page.properties?.published, '2026-10-01');
  assert.match(
    md,
    /> Second paragraph that is long enough to keep in the clip \\\[x\\\] \\\*y\\\*\./,
  );
  assert.match(
    md,
    /\[Open the original\]\(<https:\/\/news\.example\.com\/a\?b=1>\) · Example News/,
  );
  assert.doesNotMatch(md, /alert|Menu entry|Footer text/);
  assert.equal(clipFromHtml('<p>x</p>', 'https://www.site.org/').title, 'site.org');
});

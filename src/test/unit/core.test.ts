import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from '../../core/markdown';
import { WikiIndex } from '../../core/index';
import { safeRelative, pagePath, slug, namedPage, namedSection } from '../../core/paths';
import { renderPage, htmlDocument } from '../../core/render';
import { fillTemplate, localDate } from '../../templates';
import { movedUri } from '../../core/activity-uris';
import { wikiHealth } from '../../core/health';
import { renderRichBlocks } from '../../core/rich-blocks';
const page = (file: string, text: string, root = 'root') =>
  parsePage(root, file, `file:///wiki/${file}`, text);
const indexOf = (...pages: ReturnType<typeof page>[]) => {
  const index = new WikiIndex();
  index.replace(pages);
  return index;
};

test('front matter, headings, duplicate slugs and accurate source offsets', () => {
  const text =
    '---\r\ntitle: My page\r\ntags: [one, two]\r\n---\r\n# Hello *world*\r\n\r\n## Same\r\n## Same\r\n[[Target|label]]';
  const p = page('a.md', text);
  assert.equal(p.title, 'My page');
  assert.deepEqual(p.tags, ['one', 'two']);
  assert.deepEqual(
    p.headings.map((h) => h.slug),
    ['hello-world', 'same', 'same-1'],
  );
  assert.equal(text.slice(p.headings[1].offset, p.headings[1].offset + 7), '## Same');
  assert.equal(text.slice(p.links[0].targetStart, p.links[0].targetEnd), 'Target');
  assert.equal(text.slice(p.links[0].start, p.links[0].end), '[[Target|label]]');
});
test('new page and folder names preserve display titles while slugging safe paths', () => {
  assert.deepEqual(namedPage('Project Notes/Release v1.2.md'), {
    path: 'project-notes/release-v1-2.md',
    title: 'Release v1.2',
  });
  assert.deepEqual(namedSection('Project Notes/Design Docs'), {
    path: 'project-notes/design-docs',
    title: 'Design Docs',
  });
  assert.deepEqual(namedPage('  -- Project  /  --- Release! --  '), {
    path: 'project/release.md',
    title: '--- Release! --',
  });
  for (const invalid of ['', 'folder/', '../escape', 'CON', '✨', 'folder/---'])
    assert.throws(() => namedPage(invalid));
  for (const invalid of ['folder/', '✨', 'folder/---']) assert.throws(() => namedSection(invalid));
});
test('malformed YAML is recoverable and alias expansion is disabled', () => {
  assert.ok(page('a.md', '---\ntitle: [broken\n---\n# Good').metadataError);
  assert.ok(page('a.md', '---\nx: &a [hi]\ntags: *a\n---\n# Good').metadataError);
  assert.equal(page('a.md', '---\ntags: alpha, beta\n---\ntext').tags.length, 2);
});
test('ignores links in front matter, fenced code, indented code, inline code and comments', () => {
  const p = page(
    'a.md',
    '---\ntitle: "[[No]]"\n---\n# Title\n```md\n[[No]]\n```\n\n    [[No]]\n\n`[[No]]` and ``x ` [[No]]``\n<!-- [[No]] -->\n\\[[No]]\n[[Yes]]',
  );
  assert.deepEqual(
    p.links.map((l) => l.target),
    ['Yes'],
  );
});
test('parses wiki, Markdown, image, angle and balanced parenthesis destinations', () => {
  const p = page(
    'a.md',
    '[[Folder/Page#Heading|Label]] [label](folder/a(b).md#h) ![alt](<my image.png>) [site](https://example.com "Title")',
  );
  assert.deepEqual(
    p.links.map((l) => [l.kind, l.target]),
    [
      ['wiki', 'Folder/Page#Heading'],
      ['markdown', 'folder/a(b).md#h'],
      ['image', 'my image.png'],
      ['markdown', 'https://example.com'],
    ],
  );
  for (const l of p.links) assert.equal(p.text.slice(l.targetStart, l.targetEnd), l.target);
});
test('resolves relative, root, alias, heading, encoded paths and external links', () => {
  const a = page('folder/a.md', '# A'),
    b = page('folder/b.md', '# Fancy name\n## A heading'),
    c = page('hello world.md', '# Hello');
  const idx = indexOf(a, b, c);
  for (const target of ['b', './b', '/folder/b', 'Fancy name'])
    assert.equal(idx.resolve(a, target).page?.id, b.id);
  assert.equal(idx.resolve(a, 'b#A heading').heading?.slug, 'a-heading');
  assert.equal(idx.resolve(a, '../hello%20world.md', 'markdown').page?.id, c.id);
  assert.equal(idx.resolve(a, '#a').page?.id, a.id);
  assert.equal(idx.resolve(a, 'https://example.com').external, true);
  assert.equal(idx.resolve(a, '../../escape', 'markdown').error, 'unsafe');
  assert.equal(idx.resolve(a, 'b#missing').error, 'heading');
});
test('root isolation, ambiguity and Markdown relative semantics', () => {
  const a = page('a.md', '# A'),
    b = page('one/b.md', '# Shared'),
    c = page('two/b.md', '# Shared'),
    d = page('c.md', '# Other', 'other');
  const idx = indexOf(a, b, c, d);
  assert.equal(idx.resolve(a, 'Shared').error, 'ambiguous');
  assert.equal(idx.resolve(a, 'b').error, 'ambiguous');
  assert.equal(idx.resolve(a, 'Other').error, 'missing');
  assert.equal(idx.resolve(a, 'b.md', 'markdown').error, 'missing');
});
test('search matches all terms, tags and content and ranks titles first', () => {
  const a = page('a.md', '---\ntags: [design]\n---\n# Search\nneedle haystack'),
    b = page('b.md', '# Needle\nsecond page');
  const idx = indexOf(a, b);
  assert.equal(idx.search('needle')[0].page.id, b.id);
  assert.equal(idx.search('#design needle')[0].page.id, a.id);
  assert.equal(idx.search('needle missing').length, 0);
  assert.equal(idx.search('')[0].page.id, b.id);
});
test('incremental removal clears URI and aliases without affecting other pages', () => {
  const a = page('a.md', '# Shared'),
    b = page('b.md', '# Other');
  const idx = indexOf(a, b);
  assert.equal(idx.resolve(b, 'Shared').page?.id, a.id);
  idx.remove(a.uri);
  assert.equal(idx.byUri(a.uri), undefined);
  assert.equal(idx.resolve(b, 'Shared').error, 'missing');
  assert.equal(idx.byUri(b.uri)?.id, b.id);
  idx.upsert(page('a.md', '# Renamed'));
  assert.equal(idx.resolve(b, 'Renamed').page?.id, a.id);
});
test('backlinks and graph deduplicate edges but preserve link occurrences', () => {
  const a = page('a.md', '# A\n[[b]] and [B](b.md)\n![image](b.md)'),
    b = page('b.md', '# B');
  const idx = indexOf(a, b);
  assert.equal(idx.backlinks(b).length, 2);
  assert.equal(idx.graph().edges.length, 1);
  assert.equal(idx.graph().nodes.length, 2);
});
test('rename updates incoming links and outgoing relative links including images', () => {
  const a = page('a.md', '# A\n[[folder/b#heading|B]] [B](folder/b.md#heading)'),
    b = page('folder/b.md', '# B\n## Heading\n[a](../a.md) ![pic](img.png) [[#heading]]');
  const idx = indexOf(a, b),
    changes = idx.renameChanges(b, 'new/nested/c.md');
  const apply = (p: ReturnType<typeof page>) =>
    [...(changes.get(p.uri) || [])]
      .sort((a, b) => b.start - a.start)
      .reduce((s, c) => s.slice(0, c.start) + c.text + s.slice(c.end), p.text);
  assert.equal(apply(a), '# A\n[[/new/nested/c#heading|B]] [B](new/nested/c.md#heading)');
  assert.equal(
    apply(b),
    '# B\n## Heading\n[a](../../a.md) ![pic](../../folder/img.png) [[#heading]]',
  );
});
test('renderer escapes untrusted HTML and blocks unsafe destinations and remote images', () => {
  const p = page(
      'a.md',
      '# <img onerror=alert(1)>\n<script>alert(1)</script>\n[[javascript:alert(1)|go]]\n[x](command:evil)\n![track](https://evil.test/a.png)',
    ),
    idx = indexOf(p);
  const html = renderPage(p, idx, { pageHref: () => 'a.html' });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="command:'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('<img '));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(htmlDocument('<unsafe>', html).includes('<title>&lt;unsafe&gt;</title>'));
});
test('renderer shares heading slugs and link resolution with index', () => {
  const a = page('a.md', '# A\n## Repeat\n## Repeat\n[[b#hello|Hi]] [B](b.md#hello)'),
    b = page('b.md', '# Hello'),
    idx = indexOf(a, b);
  const html = renderPage(a, idx, { pageHref: (p, anchor) => `${p.path}.html#${anchor}` });
  assert.ok(html.includes('id="repeat-1"'));
  assert.equal(html.match(/href="b.md.html#hello"/g)?.length, 2);
});
test('renderer highlights known code languages and keeps unknown fences safe', () => {
  const p = page(
    'code.md',
    '# Code\n\n```javascript\nconst answer = 42;\n```\n\n```unknown\n<script>\n```',
  );
  const html = renderPage(p, indexOf(p), { pageHref: () => '#' });
  assert.match(html, /class="hljs language-javascript"/);
  assert.match(html, /hljs-keyword/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('rich blocks share safe nested rendering across preview and export', () => {
  const p = page(
    'rich.md',
    '# Rich\n\n:::warning "Careful <script>" collapsed\n' +
      'Read [Guide](guide.md).\n\n:::tip "Inside"\nNested **text**.\n:::\n:::\n\n' +
      '```md\n:::danger\nnot a block\n:::\n```',
  );
  const guide = page('guide.md', '# Guide');
  const html = renderPage(p, indexOf(p, guide), { pageHref: (target) => target.path + '.html' });
  assert.match(html, /<details class="callout rich-block rich-warning"/);
  assert.match(html, /Careful &lt;script&gt;/);
  assert.match(html, /<aside class="callout tip rich-block rich-tip"/);
  assert.match(html, /href="guide.md.html"/);
  assert.match(html, /:::danger/);
  assert.ok(!html.includes('<script>'));
});

test('tabs, captions and local media have safe shared rendering', () => {
  const p = page(
    'rich-media.md',
    '# Media\n\n:::tabs "Examples"\n:::tab "First"\nAlpha\n:::\n:::tab "Second"\nBeta\n:::\n:::\n\n' +
      ':::caption "A tiny image"\n![Pixel](pixel.png)\n:::\n\n![Listen](clip.mp3)\n',
  );
  const html = renderPage(p, indexOf(p), {
    pageHref: () => '#',
    imageHref: () => 'assets/pixel.png',
    mediaHref: () => 'assets/clip.mp3',
  });
  assert.match(html, /class="rich-block rich-tabs"/);
  assert.match(html, /<details class="rich-block rich-tab" open>/);
  assert.match(html, /<figure class="rich-block rich-caption">/);
  assert.match(html, /<figcaption>A tiny image<\/figcaption>/);
  assert.match(html, /<audio controls preload="metadata" src="assets\/clip\.mp3"/);
  const missing = renderPage(p, indexOf(p), { pageHref: () => '#' });
  assert.match(missing, /Media unavailable: Listen/);
  assert.ok(!missing.includes('src="clip.mp3"'));
});

test('local includes substitute parameters and stop cycles without running HTML', () => {
  const a = page('a.md', '# A\n\n{{ include "snippet.md" name="Reader" }}'),
    snippet = page('snippet.md', 'Hello **{{name}}**.\n\n{{ include "a.md" }}');
  const warnings: string[] = [];
  const html = renderPage(a, indexOf(a, snippet), {
    pageHref: () => '#',
    includeWarning: (warning) => warnings.push(warning),
  });
  assert.match(html, /Hello <strong>Reader<\/strong>/);
  assert.match(html, /Include cycle or depth limit/);
  assert.deepEqual(warnings, ['Include cycle or depth limit: a.md']);
  const unsafe = page('unsafe.md', '{{ include "../outside.md" }}');
  const missing = renderPage(unsafe, indexOf(unsafe), { pageHref: () => '#' });
  assert.match(missing, /Include unavailable/);
  assert.ok(!missing.includes('<script>'));
});

test('definitions, footnotes, abbreviations, highlights, keycaps and math render safely', () => {
  const p = page(
    'inline.md',
    '# Syntax\n\nAPI means Application Programming Interface.\n\n' +
      '*[API]: Application Programming Interface\n\n' +
      'Term\n: Definition\n\n' +
      'A note[^one] with ==highlight== and ++Ctrl+K++.\n\n' +
      '[^one]: Footnote text.\n\n' +
      '$x^2$\n\n$$\ny = x + 1\n$$',
  );
  const html = renderPage(p, indexOf(p), { pageHref: () => '#' });
  assert.match(html, /<dl>/);
  assert.match(html, /class="footnote-ref"/);
  assert.match(html, /<abbr title="Application Programming Interface">API<\/abbr>/);
  assert.match(html, /<mark>highlight<\/mark>/);
  assert.match(html, /<kbd>Ctrl\+K<\/kbd>/);
  assert.match(html, /<math/);
  assert.ok(!html.includes('<script>'));
  assert.deepEqual(p.links, []);
});

test('fenced code options emit a safe label, numbered highlighted lines and a permalink', () => {
  const p = page(
    'code-options.md',
    '# Options\n\n```ts title="example.ts" linenums="7" hl_lines="2"\nconst a = 1;\nconst b = 2;\n```',
  );
  const html = renderPage(p, indexOf(p), { pageHref: () => '#' });
  assert.match(html, /class="code-title">example\.ts/);
  assert.match(html, /class="code-line highlighted" data-line="8"/);
  assert.match(html, /class="permalink" href="#options"/);
  assert.match(html, /aria-label="Copy code"/);
});

test('inline badges, buttons, tooltips and icons keep links and labels safe', () => {
  const a = page(
    'a.md',
    '{badge:New} {button:Read guide|guide.md} {tip:API|Application interface} ' +
      '{icon:check} {emoji:smile} {button:Bad|javascript:alert(1)}',
  );
  const guide = page('guide.md', '# Guide');
  const html = renderPage(a, indexOf(a, guide), { pageHref: (target) => target.path + '.html' });
  assert.match(html, /class="doc-badge">New/);
  assert.match(html, /class="doc-button" href="guide.md.html">Read guide/);
  assert.match(html, /class="doc-tip" title="Application interface">API/);
  assert.match(html, /aria-label="check"/);
  assert.ok(!html.includes('href="javascript:'));
});
test('portable paths reject traversal, absolute paths, reserved names and control characters', () => {
  for (const invalid of [
    '../escape',
    '/tmp/a',
    'C:\\a',
    'a/../../b',
    'NUL.md',
    'a?',
    'a#b',
    'a\u0000b',
    'trailing.',
  ])
    assert.throws(() => pagePath(invalid), invalid);
  assert.equal(pagePath('folder\\New page'), 'folder/New page.md');
  assert.equal(safeRelative('.', true), '.');
  assert.equal(slug('Hello, 世界!'), 'hello-世界');
});
test('templates use local date and do not interpret replacement special characters', () => {
  assert.equal(localDate(new Date(2025, 0, 2)), '2025-01-02');
  assert.equal(fillTemplate('# {{title}} {{date}}', '$&', '2025-01-02'), '# $& 2025-01-02');
});

test('reference-style links and images participate in navigation and rename once per definition', () => {
  const a = page(
      'a.md',
      '# A\n[B][target] [target][] [target] ![image][pic]\n\n[target]: b.md#hello\n[pic]: <my image.png>\n',
    ),
    b = page('b.md', '# Hello'),
    idx = indexOf(a, b);
  assert.deepEqual(
    a.links.map((l) => l.target),
    ['b.md#hello', 'b.md#hello', 'b.md#hello', 'my image.png'],
  );
  assert.equal(idx.backlinks(b).length, 3);
  const edits = idx.renameChanges(b, 'new.md').get(a.uri)!;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].text, 'new.md#hello');
  assert.equal(a.text.slice(edits[0].start, edits[0].end), 'b.md#hello');
});
test('unmatched backticks do not hide links and exact delimiter lengths do', () => {
  assert.deepEqual(
    page('a.md', '`` unmatched [[Yes]] `').links.map((l) => l.target),
    ['Yes'],
  );
  assert.deepEqual(
    page('a.md', '`` code ` [[No]] `` [[Yes]]').links.map((l) => l.target),
    ['Yes'],
  );
});
test('incremental changes replace aliases and preserve lookup isolation', () => {
  const a = page('a.md', '# Old'),
    idx = indexOf(a);
  idx.upsert(page('a.md', '# New'));
  assert.equal(idx.resolve(a, 'Old').error, 'missing');
  assert.equal(idx.resolve(a, 'New').page?.title, 'New');
  assert.equal(idx.byUri(a.uri)?.title, 'New');
});

test('favorites and recents follow page and folder moves without touching similar paths', () => {
  const from = 'file:///wiki/project';
  const to = 'file:///wiki/archived/project';
  assert.equal(movedUri(`${from}/notes.md`, from, to), `${to}/notes.md`);
  assert.equal(movedUri(from, from, to), to);
  assert.equal(
    movedUri('file:///wiki/projects/notes.md', from, to),
    'file:///wiki/projects/notes.md',
  );
  assert.equal(
    movedUri('file:///other/project/notes.md', from, to),
    'file:///other/project/notes.md',
  );
});

test('dashboard health counts page links and excludes valid attachment and image paths', () => {
  const home = page(
    'Home.md',
    '# Home\n\n[Guide](Guide.md) [PDF](manual.pdf) [Missing](Absent.md) [[Unknown]] ![Image](missing.png)',
  );
  const guide = page('Guide.md', '---\ndraft: true\n---\n# Guide\n\n[Home](Home.md)');
  assert.deepEqual(wikiHealth(indexOf(home, guide)), {
    pages: 2,
    drafts: 1,
    unresolvedPages: 2,
    withoutIncoming: 0,
  });
});

test('malformed bracket runs are bounded and escaped backticks remain text', () => {
  assert.equal(page('a.md', '['.repeat(100000)).links.length, 0);
  assert.deepEqual(
    page('a.md', '\\` [[Yes]] `').links.map((l) => l.target),
    ['Yes'],
  );
});

test('steppers and timelines render as ordered lists and group titles are optional', () => {
  const html = renderRichBlocks(
    ':::stepper "Setup"\n:::step "Install"\nRun it.\n:::\n:::step "Configure"\nEdit.\n:::\n:::\n\n:::grid\n:::nav-card "Guide"\n[Open](guide.md)\n:::\n:::',
    (source) => `<p>${source.trim()}</p>`,
  );
  assert.match(
    html,
    /<section class="rich-block rich-stepper" aria-label="Setup"><div class="rich-title">Setup<\/div><ol class="rich-content">/,
  );
  assert.equal((html.match(/<li class="rich-block rich-step">/g) || []).length, 2);
  assert.match(
    html,
    /<section class="rich-block rich-grid" aria-label="Grid"><div class="rich-content">/,
  );
  assert.doesNotMatch(html, /<div class="rich-title">Grid<\/div>/);
  // A step outside a stepper is still a section.
  assert.match(
    renderRichBlocks(':::step\nAlone\n:::', (s) => s),
    /<section class="rich-block rich-step">/,
  );
});

test('footnotes, reference links and abbreviations work across container boundaries', () => {
  const p = page(
    'doc.md',
    'A note[^1] and [the guide][g].\n\n:::tip\nThe API is documented.\n:::\n\n[g]: guide.md\n*[API]: Application Programming Interface\n\n[^1]: Footnote text.\n',
  );
  const guide = page('guide.md', '# Guide');
  const html = renderPage(p, indexOf(p, guide), { pageHref: (target) => target.path + '.html' });
  assert.match(html, /<sup class="footnote-ref">/);
  assert.match(html, /<section class="footnotes">[\s\S]*Footnote text\./);
  assert.match(html, /<a href="guide.md.html">the guide<\/a>/);
  assert.match(
    html,
    /<aside class="callout tip[^"]*"[^>]*>[\s\S]*<abbr title="Application Programming Interface">API<\/abbr>/,
  );
});

test('media imports require content that matches the file type', async () => {
  const { looksLikeMedia } = await import('../../core/media');
  assert.ok(looksLikeMedia(Buffer.from('49443303000000000000', 'hex'), '.mp3'));
  assert.ok(looksLikeMedia(Buffer.from('000000206674797069736f6d', 'hex'), '.mp4'));
  assert.ok(looksLikeMedia(Buffer.from('OggS\0\0\0\0'), '.ogg'));
  assert.ok(looksLikeMedia(Buffer.from('1a45dfa3a3428680', 'hex'), '.webm'));
  assert.equal(looksLikeMedia(Buffer.from('<html><script>'), '.mp4'), false);
  assert.equal(looksLikeMedia(Buffer.from('ID3'), '.exe'), false);
});

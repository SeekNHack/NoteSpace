import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownManager } from '@tiptap/markdown';
import { visualExtensions } from '../../visual-markdown';
import { planVisualBodyEdit, splitFrontmatter, visualSafety } from '../../core/visual-safety';
import { homepageTemplate } from '../../templates';

const manager = () => new MarkdownManager({ extensions: visualExtensions() });

test('Studio schema round-trips supported Markdown and keeps frontmatter byte-exact', () => {
  const source =
    '---\r\ntitle: Release\r\ntags: [phase-one]\r\n---\r\n' +
    '# Release\n\nA [Guide](../Guide.md) and **bold** text.\n\n- [ ] Action\n\n' +
    ':::warning\nCareful here.\n:::\n\n' +
    '| A | B |\n| --- | --- |\n| x | y |\n\n' +
    '```mermaid\nflowchart TD\n A-->B\n```\n\n![Logo](../assets/logo.png)\n';
  assert.equal(visualSafety(source), undefined);
  const { prefix, body } = splitFrontmatter(source);
  const markdown = manager();
  const parsed = markdown.parse(body);
  const serialized = markdown.serialize(parsed);
  assert.equal(prefix, '---\r\ntitle: Release\r\ntags: [phase-one]\r\n---\r\n');
  assert.equal(splitFrontmatter(prefix + serialized).prefix, prefix);
  assert.match(serialized, /\[Guide\]\(\.\.\/Guide\.md\)/);
  assert.match(serialized, /- \[ \] Action/);
  assert.match(serialized, /:::warning\nCareful here\.\n:::/);
  assert.match(serialized, /```mermaid\nflowchart TD/);
  assert.match(serialized, /!\[Logo\]\(\.\.\/assets\/logo\.png\)/);
  assert.ok(JSON.stringify(parsed).includes('"type":"table"'));
  assert.equal(markdown.serialize(markdown.parse(serialized)), serialized);
});

test('unfinished visual page-link query survives a Markdown parse/serialize cycle', () => {
  const markdown = manager();
  const first = markdown.serialize(markdown.parse('Before [[Gui'));
  assert.equal(visualSafety(first), undefined);
  assert.equal(markdown.parse(first).content?.[0]?.content?.[0]?.text, 'Before [[Gui');
  assert.equal(visualSafety('Before [[Guide]]'), undefined);
});

test('wiki links round-trip as Studio atoms and stay byte-identical', () => {
  const markdown = manager();
  for (const source of [
    'See [[Guide]] and [[/a/b#setup|the label]] now.',
    '# Title [[Home]]\n\n- item [[X|y]]',
  ]) {
    assert.equal(visualSafety(source), undefined, source);
    const parsed = markdown.parse(source);
    assert.ok(JSON.stringify(parsed).includes('"wikiLink"'), source);
    assert.equal(markdown.serialize(parsed), source);
  }
  const table = '| A | B |\n| --- | --- |\n| [[Guide]] | x |';
  assert.equal(visualSafety(table), undefined);
  assert.match(markdown.serialize(markdown.parse(table)), /\| \[\[Guide\]\] +\| x +\|/);
  assert.ok(visualSafety('**bold [[Guide]]**'));
  assert.ok(visualSafety('~~[[Guide]]~~'));
});

test('documented wiki syntax inside inline code survives Studio conversion', () => {
  const source = 'Use `[[Page name]]` to link pages.';
  assert.equal(visualSafety(source), undefined);
  const markdown = manager();
  assert.equal(markdown.serialize(markdown.parse(source)), source);
});

test('reference links and definitions are preserved as source islands', () => {
  const markdown = manager();
  for (const source of [
    '[Guide][ref]\n\n   [ref]: Guide.md',
    '[Other][]\n\n[Other]: other.md "Title"',
  ]) {
    assert.equal(visualSafety(source), undefined, source);
    assert.equal(markdown.serialize(markdown.parse(source)), source);
  }
});

test('MkDocs-style inline and block syntax round-trips byte-identically as source islands', () => {
  const markdown = manager();
  const cases: Array<[string, string[]]> = [
    [
      'Press ++Ctrl+K++, see $x^2 + 1$, {badge:New}, {button:Read|guide.md} and {tip:API|Interface}.',
      ['inlineIsland'],
    ],
    [
      'Icons {icon:check} {emoji:smile} and ==highlighted **bold** text== end.',
      ['inlineIsland', 'highlight'],
    ],
    [
      'A footnote[^1] here.\n\n[^1]: The note text.\n    Continued line.',
      ['inlineIsland', 'blockIsland'],
    ],
    ['*[API]: Application Programming Interface\n\nThe API is fine.', ['blockIsland']],
    ['Term\n: Definition one\n: Definition two\n\nOther term\n: More', ['blockIsland']],
    ['$$\na^2 + b^2 = c^2\n$$', ['blockIsland']],
    ['{{ include "snippet.md" name="Reader" }}', ['blockIsland']],
    [
      '<!-- hidden\ncomment -->\n\nText <kbd>x</kbd> and <br> end.',
      ['blockIsland', 'inlineIsland'],
    ],
    ['<div class="x">\n  raw html\n</div>\n\nAfter.', ['blockIsland']],
    ['![Listen](clip.mp3)', ['inlineIsland']],
    [':::unknown\nkeep\n:::\n\n:::note extra\nmalformed\n:::', ['blockIsland']],
    ['Price is $5 and $10 total.', []],
  ];
  for (const [source, types] of cases) {
    assert.equal(visualSafety(source), undefined, source);
    const parsed = JSON.stringify(markdown.parse(source));
    for (const type of types)
      assert.ok(parsed.includes(`"type":"${type}"`), `${type} in ${source}`);
    assert.equal(markdown.serialize(markdown.parse(source)), source);
  }
});

test('fenced Markdown examples retain unsupported markers as code in Studio', () => {
  const source = ':::note\n```md\n:::unknown\n[ref]: Guide.md\n<script>x</script>\n```\n:::';
  assert.equal(visualSafety(source), undefined);
  const markdown = manager();
  assert.equal(markdown.serialize(markdown.parse(source)), source);
});

test('inline HTML and math examples retain their text when opened in Studio', () => {
  const source = 'Use `<script>alert(1)</script>` and `$$`.';
  assert.equal(visualSafety(source), undefined);
  const markdown = manager();
  assert.equal(markdown.serialize(markdown.parse(source)), source);
});

test('Studio edits preserve frontmatter and replace only changed UTF-16 body spans', () => {
  const frontmatter = '\uFEFF---\r\ntitle: Release\r\n---\r\n';
  const cases = [
    ['# Hello\n', '# Hello!\n'],
    ['# Hello\n', '# Hello\nNext\n'],
    ['# Hello\nNext\n', '# Hello\n'],
    ['A 😀 page\r\n', 'A 😀 new page\r\n'],
    ['# Heading\n\nLast\n', '# Heading\n\nFirst and Last\n'],
    ['', '# New page\n'],
  ];
  for (const [before, after] of cases) {
    const source = frontmatter + before;
    const edit = planVisualBodyEdit(source, after);
    assert.ok(edit);
    assert.ok(edit.start >= frontmatter.length);
    assert.equal(
      source.slice(0, edit.start) + edit.text + source.slice(edit.end),
      frontmatter + after,
    );
  }
  assert.equal(planVisualBodyEdit(frontmatter + '# Same\n', '# Same\n'), undefined);
});

test('rich documentation containers round-trip through the actual Studio schema', () => {
  const source =
    ':::warning "Deploy carefully" collapsed\n' +
    'Check the **backup**.\n:::\n\n' +
    ':::card "First card"\nEditable text.\n:::\n';
  assert.equal(visualSafety(source), undefined);
  const markdown = manager();
  const first = markdown.serialize(markdown.parse(source));
  assert.match(first, /:::warning "Deploy carefully" collapsed/);
  assert.match(first, /:::card "First card"/);
  assert.equal(markdown.serialize(markdown.parse(first)), first);
  assert.equal(visualSafety(':::unknown\nKeep as source.\n:::'), undefined);
  assert.ok(visualSafety(':::card\nMissing end'));
  assert.equal(visualSafety(':::warning\n:::tip\nNested.\n:::\n:::'), undefined);
  // Includes and media embeds are preserved as source islands (see the island test).
  assert.equal(visualSafety('{{ include "snippet.md" }}'), undefined);
  assert.equal(visualSafety('![Listen](clip.mp3)'), undefined);
});

test('new wiki homepage hero opens and round-trips in Studio', () => {
  const source = homepageTemplate('Studio Demo', 'A documentation hub', true);
  assert.equal(visualSafety(source), undefined);
  assert.match(source, /:::hero "Welcome to Studio Demo"/);
  assert.match(source, /\[Get started\]\(guides\/getting-started\.md\)/);
  const markdown = manager();
  const first = markdown.serialize(markdown.parse(source));
  assert.match(first, /:::hero "Welcome to Studio Demo"/);
  assert.equal(markdown.serialize(markdown.parse(first)), first);
  assert.doesNotMatch(homepageTemplate('Empty', '', false), /getting-started\.md/);
});

test('containers keep every child block separate and nested containers round-trip', () => {
  const markdown = manager();
  const multi = ':::note\nFirst paragraph.\n\nSecond paragraph.\n\n- item\n:::';
  assert.equal(markdown.serialize(markdown.parse(multi)), multi);
  for (const source of [
    ':::tabs "Examples"\n:::tab "First"\nAlpha content\n:::\n\n:::tab "Second"\nBeta **bold**\n\n- a\n- b\n:::\n:::',
    ':::stepper\n:::step "Install"\nRun it.\n:::\n\n:::step "Configure"\nEdit.\n:::\n:::',
    ':::grid\n:::card "A"\nOne\n:::\n\n:::nav-card "B"\n[Go](x.md)\n:::\n:::',
    ':::warning\n:::tip\nNested.\n:::\n:::',
  ]) {
    assert.equal(visualSafety(source), undefined, source);
    assert.equal(markdown.serialize(markdown.parse(source)), source);
  }
});

test('code fences stay longer than fences inside the code and keep their info string', () => {
  const markdown = manager();
  const nested = '````md\n```js\nx\n```\n````';
  assert.equal(markdown.serialize(markdown.parse(nested)), nested);
  const info = '```ts title="a.ts" linenums="3" hl_lines="1"\nconst a = 1;\n```';
  assert.equal(markdown.serialize(markdown.parse(info)), info);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { MarkdownManager } from '@tiptap/markdown';
import { visualExtensions } from '../../visual-markdown';
import {
  blockColors,
  defaultBlockColor,
  parseRichBlock,
  richBlockHeader,
  richBlockKinds,
  richBlockPlugin,
  richBlockSource,
} from '../../core/rich-blocks';
import { calloutCss } from '../../core/design';
import { visualSafety } from '../../core/visual-safety';

test('every block type has a semantic default color', () => {
  const expected: Record<string, string> = {
    note: 'blue',
    info: 'blue',
    tip: 'green',
    success: 'green',
    warning: 'amber',
    danger: 'red',
    failure: 'red',
    details: 'purple',
    spoiler: 'purple',
    'nav-card': 'cyan',
    example: 'indigo',
    quote: 'gray',
    card: 'gray',
    tabs: 'gray',
  };
  for (const [kind, color] of Object.entries(expected))
    assert.equal(defaultBlockColor(kind), color, kind);
  for (const kind of richBlockKinds) {
    assert.ok(blockColors.includes(defaultBlockColor(kind)), kind);
    assert.ok(calloutCss.includes(`.doc .rich-${kind},`), `CSS default for ${kind}`);
  }
  for (const color of blockColors)
    assert.ok(calloutCss.includes(`[data-color="${color}"]`), `CSS override for ${color}`);
});

test('color overrides parse, serialize and stay out of documents by default', () => {
  assert.deepEqual(richBlockHeader(':::details "Setup" collapsed {color=amber}'), {
    kind: 'details',
    title: 'Setup',
    collapsed: true,
    color: 'amber',
  });
  assert.deepEqual(richBlockHeader(':::tip {color=pink}'), {
    kind: 'tip',
    title: '',
    collapsed: false,
    color: 'pink',
  });
  assert.equal(richBlockHeader(':::tip')?.color, undefined);
  // Anything else in braces is not understood and keeps the block as source.
  assert.equal(richBlockHeader(':::tip {color=#ff0000}'), undefined);
  assert.equal(richBlockHeader(':::tip {.wide}'), undefined);
  assert.equal(
    richBlockSource('details', 'Body', 'Setup', true, 'amber'),
    ':::details "Setup" collapsed {color=amber}\nBody\n:::',
  );
  assert.equal(
    richBlockSource('details', 'Body', 'Setup', true),
    ':::details "Setup" collapsed\nBody\n:::',
  );
  assert.equal(richBlockSource('details', 'Body', '', false, 'bogus'), ':::details\nBody\n:::');
  assert.equal(parseRichBlock(':::warning {color=red}\nx\n:::\n')?.color, 'red');
});

test('rendered HTML carries the override for every block shape, including nested blocks', () => {
  const md = new MarkdownIt({ html: false });
  richBlockPlugin(md);
  const html = md.render(
    ':::tabs {color=teal}\n:::tab "A" {color=indigo}\nOne\n:::\n:::\n\n:::details "D" collapsed {color=amber}\n:::note {color=green}\nInner\n:::\n:::\n\n:::nav-card\n[Go](a.md)\n:::\n',
  );
  assert.match(html, /<section data-color="teal" class="rich-block rich-tabs"/);
  assert.match(html, /<details data-color="indigo" class="rich-block rich-tab"/);
  assert.match(html, /<details data-color="amber" class="rich-block rich-details">/);
  assert.match(
    html,
    /<aside data-color="green" class="callout note rich-block rich-note" role="note">/,
  );
  assert.match(html, /<section class="rich-block rich-nav-card">/);
});

test('Studio round-trips colors byte-identically, including callouts and nested containers', () => {
  const manager = new MarkdownManager({ extensions: visualExtensions() });
  const source =
    ':::details "Setup" {color=amber}\nOuter\n\n:::warning "Inner" collapsed {color=purple}\nCareful.\n:::\n:::\n\n:::note\nDefault color.\n:::\n';
  assert.equal(visualSafety(source), undefined);
  const parsed = manager.parse(source);
  const json = JSON.stringify(parsed);
  assert.match(json, /"kind":"details","title":"Setup","collapsed":false,"color":"amber"/);
  assert.match(json, /"type":"warning","title":"Inner","collapsed":true,"color":"purple"/);
  assert.equal(manager.serialize(parsed), source.replace(/\n$/, ''));
});

test('an empty container parses to the same document the editor creates', () => {
  const manager = new MarkdownManager({ extensions: visualExtensions() });
  const parsed = manager.parse(':::details {color=amber}\n\n:::\n') as {
    content: Array<{ content?: Array<{ type: string }> }>;
  };
  assert.deepEqual(
    parsed.content[0].content?.map((c) => c.type),
    ['paragraph'],
  );
});

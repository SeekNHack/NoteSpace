import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from '../../core/markdown';
import { excerptOf, linkMention, plainMask, unlinkedMentions } from '../../core/mentions';
import { navTree, pageIcon, pageStatus } from '../../core/nav-tree';

const page = (path: string, text: string) => parsePage('r', path, `file:///w/${path}`, text);

test('unlinked mentions skip code, links and headings, and link the first plain mention', () => {
  const target = page('setup.md', '# Setup Guide\n');
  const other = page(
    'a.md',
    '---\ntitle: A\n---\n# About the Setup Guide\n\n`setup guide` and [[Setup Guide]] and [x](setup.md)\n\n```\nSetup Guide\n```\n\nRead the setup guide first.\n',
  );
  const linked = page('b.md', 'See the Setup Guide.\n');
  const found = unlinkedMentions(target, [target, other, linked], (p) => p.id === linked.id);
  assert.equal(found.length, 1);
  const m = found[0];
  assert.equal(other.text.slice(m.offset, m.offset + m.length), 'setup guide');
  assert.match(m.excerpt, /Read the setup guide first/);
  const next = linkMention(other.text, m.offset, m.length, 'Setup Guide');
  assert.match(next, /Read the \[\[Setup Guide\|setup guide\]\] first\./);
  assert.equal(next.replace('[[Setup Guide|setup guide]]', 'setup guide'), other.text);
  assert.throws(() => linkMention('changed text here', m.offset, m.length, 'Setup Guide'));
  // Short titles are not searched (too many false matches).
  assert.deepEqual(
    unlinkedMentions(page('x.md', '# Go\n'), [other], () => false),
    [],
  );
  // The mask keeps the text's length.
  assert.equal(plainMask(other.body).length, other.body.length);
});

test('excerpts prefer the description and read links as their labels', () => {
  assert.equal(
    excerptOf(page('a.md', '---\ndescription: Short summary\n---\n# A\n')),
    'Short summary',
  );
  assert.equal(
    excerptOf(
      page(
        'b.md',
        '# B\n\n```js\ncode();\n```\n\nThis page explains [[Setup|the setup]] and **why** it [matters](x.md).\n',
      ),
    ),
    'This page explains the setup and why it matters.',
  );
});

test('page status and icon come from the front matter and reach the navigation', () => {
  const p = page('a.md', '---\nstatus: Deprecated\nicon: rocket\ntags: [x]\n---\n# A\n');
  assert.equal(pageStatus(p), 'deprecated');
  assert.equal(pageIcon(p), 'rocket');
  assert.equal(pageIcon(page('b.md', '---\nicon: "🚀"\n---\n')), '🚀');
  assert.equal(pageIcon(page('c.md', '---\nicon: "<b>x</b>"\n---\n')), undefined);
  assert.equal(pageStatus(page('d.md', '---\nstatus: whatever\n---\n')), undefined);
  const [node] = navTree([p], { sort: 'filename' });
  assert.equal(node.status, 'deprecated');
  assert.equal(node.icon, 'rocket');
  assert.deepEqual(node.tags, ['x']);
});

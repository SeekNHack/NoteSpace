import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navOrder, navTree } from '../../core/nav-tree';

const pages = [
  { id: 'a', path: 'index.md', title: 'Home' },
  { id: 'b', path: 'guides/index.md', title: 'Guides' },
  { id: 'c', path: 'guides/setup.md', title: 'Setup' },
  { id: 'd', path: 'guides/advanced/tuning.md', title: 'tuning', titleFromFile: true },
  { id: 'e', path: 'about.md', title: 'About' },
];

test('nav tree: folders become sections with their index page', () => {
  const tree = navTree(pages, { sort: 'filename', readable: true });
  assert.deepEqual(
    tree.map((n) => [n.kind, n.title, n.id]),
    [
      ['page', 'Home', 'a'],
      ['section', 'Guides', 'b'],
      ['page', 'About', 'e'],
    ],
  );
  const guides = tree[1];
  assert.deepEqual(
    guides.children!.map((n) => [n.kind, n.title]),
    [
      ['section', 'Advanced'],
      ['page', 'Setup'],
    ],
  );
  assert.equal(guides.children![0].children![0].title, 'Tuning');
});

test('nav order: reading order for previous and next', () => {
  const order = navOrder(navTree(pages, { sort: 'filename' })).map((n) => n.id);
  assert.deepEqual(order, ['a', 'b', 'd', 'c', 'e']);
});

test('nav tree: folders first or files first, notebooks after pages', () => {
  const tree = navTree(
    [
      { id: 'a', path: 'b.md', title: 'B' },
      { id: 'x', path: 'a.ipynb', title: 'a.ipynb', file: 'notebook', uri: 'file:///a.ipynb' },
      { id: 'c', path: 'z/c.md', title: 'C' },
    ],
    { sort: 'filename', directorySort: 'files-first' },
  );
  assert.deepEqual(
    tree.map((n) => [n.kind, n.title]),
    [
      ['page', 'B'],
      ['file', 'a.ipynb'],
      ['section', 'z'],
    ],
  );
  assert.equal(tree[1].id, undefined, 'files are not wiki pages');
  const folders = navTree(
    [
      { id: 'c', path: 'z/c.md', title: 'C' },
      { id: 'a', path: 'b.md', title: 'B' },
    ],
    { sort: 'filename' },
  );
  assert.equal(folders[0].kind, 'section', 'folders first by default');
});

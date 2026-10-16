import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix, uriPath } from '../../core/paths';

test('uriPath folds Windows drive letters so the same file compares equal', () => {
  const folder = { path: '/C:/Users/me/notes' };
  const found = { path: '/c:/Users/me/notes/docs/Home.md' };
  assert.equal(uriPath(folder), '/c:/Users/me/notes');
  assert.ok(uriPath(found).startsWith(`${uriPath(folder)}/`));
  assert.equal(posix.relative(uriPath(folder), uriPath(found)), 'docs/Home.md');
  // Other paths are unchanged.
  assert.equal(uriPath({ path: '/home/me/C:/x.md' }), '/home/me/C:/x.md');
  assert.equal(uriPath({ path: '/srv/wiki/Home.md' }), '/srv/wiki/Home.md');
});

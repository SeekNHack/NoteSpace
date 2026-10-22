import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameClash } from '../../core/name-clash';

const pages = [
  { id: '1', path: 'Ciao.md', title: 'Ciao' },
  { id: '2', path: 'Ciao/ciao.md', title: 'ciao' },
  { id: '3', path: 'Notes/todo.md', title: 'Todo' },
  { id: '4', path: 'Test.md', title: 'Test' },
];

test('similar names: explained for folder pages, warned for confusing ones', () => {
  assert.deepEqual(nameClash(pages, 'notes.md'), {
    message: 'This page will be the page of the folder “Notes”.',
    severity: 'info',
  });
  // Inside "Ciao", which already has its page Ciao.md: a page named Ciao would be a second one.
  assert.deepEqual(
    nameClash(
      pages.filter((p) => p.id !== '2'),
      'Ciao/ciao.md',
    ),
    {
      message: '“Ciao” already has its own page, “Ciao”; this one will be listed inside it.',
      severity: 'warning',
    },
  );
  assert.equal(nameClash(pages, 'Ciao/other.md'), undefined);
  assert.deepEqual(nameClash(pages, 'test/'), {
    message: '“Test” will become this folder’s page.',
    severity: 'info',
  });
  assert.equal(nameClash(pages, 'notes/')?.severity, 'warning');
  assert.equal(nameClash(pages, 'Other.md'), undefined);
  assert.equal(
    nameClash([{ id: '9', path: 'a/Plan.md', title: 'My plan' }], 'a/my plan.md')?.severity,
    'warning',
  );
});

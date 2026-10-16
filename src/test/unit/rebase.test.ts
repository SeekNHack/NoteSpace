import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, diffSpan, rebaseEdit } from '../../core/rebase';

const base = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n';

test('a Studio edit rebases over a source edit elsewhere in Split mode', () => {
  const current = base.replace('Second paragraph.', 'Second paragraph, edited in Code.');
  const studio = diffSpan(base, base.replace('First paragraph.', 'First paragraph from Studio.'))!;
  const result = rebaseEdit(base, current, studio);
  assert.ok('change' in result);
  assert.equal(
    applyChange(current, result.change),
    '# Title\n\nFirst paragraph from Studio.\n\nSecond paragraph, edited in Code.\n',
  );
});

test('a source edit before the Studio edit shifts it correctly', () => {
  const current = base.replace('# Title', '# A much longer title');
  const studio = diffSpan(base, base.replace('Second', 'Last'))!;
  const result = rebaseEdit(base, current, studio);
  assert.ok('change' in result);
  assert.equal(applyChange(current, result.change), current.replace('Second', 'Last'));
});

test('overlapping or adjacent edits are reported as conflicts, never merged silently', () => {
  const studio = diffSpan(base, base.replace('First paragraph.', 'Studio text.'))!;
  for (const current of [
    base.replace('First paragraph.', 'Code text.'),
    base.replace('First paragraph.', 'First paragraphX.'),
  ])
    assert.deepEqual(rebaseEdit(base, current, studio), { conflict: true });
  assert.deepEqual(rebaseEdit(base, base, studio), { change: studio });
});

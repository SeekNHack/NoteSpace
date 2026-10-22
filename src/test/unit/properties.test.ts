import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propertyValue, typedProperties, validPropertyKey } from '../../core/properties';
import { withFrontMatter } from '../../core/frontmatter';

test('front matter reads as typed properties and edits keep the YAML', () => {
  const text =
    '---\ntitle: T\nowner: Ana\ndue: 2026-10-30\npoints: 3\ndone: false\ntags: [a, b]\nlink: https://x.dev\nmeta: { a: 1 }\n---\n# T\n';
  assert.deepEqual(typedProperties(text), [
    { key: 'owner', type: 'text', value: 'Ana' },
    { key: 'due', type: 'date', value: '2026-10-30' },
    { key: 'points', type: 'number', value: 3 },
    { key: 'done', type: 'checkbox', value: false },
    { key: 'tags', type: 'list', value: ['a', 'b'] },
    { key: 'link', type: 'url', value: 'https://x.dev' },
  ]);
  assert.deepEqual(typedProperties('# No front matter\n'), []);
  assert.equal(propertyValue('number', '4.5'), 4.5);
  assert.equal(propertyValue('checkbox', true), true);
  assert.deepEqual(propertyValue('list', 'x, y ,, z'), ['x', 'y', 'z']);
  assert.equal(propertyValue('text', '  '), null);
  assert.throws(() => propertyValue('date', '30/10/2026'), /YYYY-MM-DD/);
  assert.throws(() => propertyValue('number', 'many'), /number/);
  const edited = withFrontMatter(text, { due: propertyValue('date', '2026-11-02'), owner: null });
  assert.match(edited, /^---\ntitle: T\ndue: 2026-11-02\n/);
  assert.equal(typedProperties(edited).find((p) => p.key === 'due')?.type, 'date');
  assert.ok(validPropertyKey('owner'));
  assert.ok(!validPropertyKey('title'));
  assert.ok(!validPropertyKey('bad key'));
});

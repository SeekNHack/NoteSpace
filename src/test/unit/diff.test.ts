import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, hunks } from '../../core/diff';

const rebuild = (lines: ReturnType<typeof diffLines>) => ({
  a: lines
    .filter((l) => l.type !== 'add')
    .map((l) => l.text)
    .join('\n'),
  b: lines
    .filter((l) => l.type !== 'del')
    .map((l) => l.text)
    .join('\n'),
});

test('line diff reconstructs both sides and finds minimal edits', () => {
  const d = diffLines('a\nb\nc\nd\n', 'a\nx\nc\nd\ne\n');
  assert.deepEqual(
    d.map((l) => `${l.type[0]}${l.text}`),
    ['sa', 'db', 'ax', 'sc', 'sd', 'ae'],
  );
  assert.deepEqual(diffLines('', 'one'), [
    { type: 'del', text: '', a: 1 },
    { type: 'add', text: 'one', b: 1 },
  ]);
  assert.deepEqual(
    diffLines('same\r\n', 'same\n').map((l) => l.type),
    ['same'],
  );
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 5;
  for (let round = 0; round < 200; round++) {
    const a = Array.from({ length: rand() * 3 }, () => String(rand())).join('\n');
    const b = Array.from({ length: rand() * 3 }, () => String(rand())).join('\n');
    const r = rebuild(diffLines(a, b));
    assert.equal(r.a, a);
    assert.equal(r.b, b);
  }
});

test('hunks keep context and merge nearby changes', () => {
  const old = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
  const changed = old.replace('l5', 'L5').replace('l8', 'L8').replace('l25', 'L25');
  const h = hunks(diffLines(old, changed));
  assert.equal(h.length, 2);
  assert.equal(h[0].lines[0].text, 'l2');
  assert.equal(h[1].lines.at(-1)!.text, 'l28');
});

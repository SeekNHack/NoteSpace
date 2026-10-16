import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualActionQueue } from '../../core/visual-actions';

test('Save survives a later Code request while sync and save are in flight', () => {
  const queue = new VisualActionQueue();
  queue.request('save');
  queue.request('source');
  assert.equal(queue.takeNext(false), undefined);
  assert.equal(queue.takeNext(true), 'save');
  assert.equal(queue.takeNext(false), undefined);
  assert.equal(queue.takeNext(true), 'source');
  assert.equal(queue.takeNext(true), undefined);
});

test('repeated Save requests coalesce and the latest mode request wins', () => {
  const queue = new VisualActionQueue();
  queue.request('split');
  queue.request('save');
  queue.request('save');
  queue.request('source');
  assert.equal(queue.takeNext(true), 'save');
  assert.equal(queue.takeNext(true), 'source');
  assert.equal(queue.takeNext(true), undefined);
});

test('a source conflict clears all queued actions', () => {
  const queue = new VisualActionQueue();
  queue.request('save');
  queue.request('split');
  queue.clear();
  assert.equal(queue.takeNext(true), undefined);
});

test('undo and redo keep their order and run before Save and mode changes', () => {
  const queue = new VisualActionQueue();
  queue.request('source');
  queue.request('undo');
  queue.request('save');
  queue.request('redo');
  queue.request('undo');
  assert.equal(queue.takeNext(false), undefined);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map(() => queue.takeNext(true)),
    ['undo', 'redo', 'undo', 'save', 'source', undefined],
  );
});

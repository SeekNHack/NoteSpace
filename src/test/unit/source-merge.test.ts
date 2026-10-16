import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownManager } from '@tiptap/markdown';
import { visualExtensions } from '../../visual-markdown';
import { mergeVisualEdit } from '../../core/source-merge';
import { studioBody } from '../../visual-merge';
import { planVisualBodyEdit, splitFrontmatter } from '../../core/visual-safety';

const manager = new MarkdownManager({ extensions: visualExtensions() });
const serialize = (s: string) => manager.serialize(manager.parse(s));
const planStudioEdit = (source: string, next: string, baseline?: string) =>
  planVisualBodyEdit(source, studioBody(splitFrontmatter(source).body, next, baseline, serialize));
const apply = (source: string, edit?: { start: number; end: number; text: string }) =>
  edit ? source.slice(0, edit.start) + edit.text + source.slice(edit.end) : source;

const source = [
  '# Release',
  '',
  'Intro paragraph.',
  '',
  '| Stage | Owner |',
  '|:------|------:|',
  '| Build | CI |',
  '',
  '* first',
  '* second',
  '',
  'Closing words.',
  '',
].join('\n');

test('a one-line Studio edit leaves untouched normalized source byte-identical', () => {
  const baseline = serialize(source);
  assert.notEqual(baseline, source, 'fixture must be something Studio normalizes');
  const next = baseline.replace('Closing words.', 'Closing words, edited.');
  const result = apply(source, planStudioEdit(source, next, baseline));
  assert.equal(result, source.replace('Closing words.', 'Closing words, edited.'));
});

test('inserting a block keeps the table and list markers from the source', () => {
  const baseline = serialize(source);
  const next = baseline.replace('Intro paragraph.', 'Intro paragraph.\n\n## Added section');
  const result = apply(source, planStudioEdit(source, next, baseline));
  assert.match(result, /\|:------\|------:\|/);
  assert.match(result, /\* first\n\* second/);
  assert.match(result, /Intro paragraph\.\n\n## Added section\n+\| Stage/);
  assert.equal(serialize(result), serialize(next));
});

test('editing inside a normalized table falls back only around the changed rows', () => {
  const baseline = serialize(source);
  const next = baseline.replace('| Build | CI    |', '| Build | Ops   |');
  assert.notEqual(next, baseline);
  const result = apply(source, planStudioEdit(source, next, baseline));
  assert.equal(serialize(result), serialize(next));
  assert.match(result, /\* first\n\* second/);
  assert.match(result, /Ops/);
});

test('frontmatter and CRLF line endings are preserved for untouched lines', () => {
  const crlf = '---\r\ntitle: X\r\n---\r\n' + source.replace(/\n/g, '\r\n');
  const { body } = splitFrontmatter(crlf);
  const baseline = serialize(body.replace(/\r\n/g, '\n'));
  const next = baseline.replace('Intro paragraph.', 'Intro changed.');
  const result = apply(crlf, planStudioEdit(crlf, next, baseline));
  assert.equal(result, crlf.replace('Intro paragraph.', 'Intro changed.'));
});

test('without a baseline or when the merge is not equivalent, Studio output is used', () => {
  const next = serialize(source).replace('Intro', 'Opening');
  const result = apply(source, planStudioEdit(source, next));
  assert.equal(result, `${next}\n`, 'Studio output keeps the final newline');
  assert.equal(mergeVisualEdit('a\nb', 'a\nb', 'a\nb'), 'a\nb');
  assert.equal(mergeVisualEdit('x', 'x', 'y'), 'y');
});

test('deleting a block removes only that block', () => {
  const baseline = serialize(source);
  const next = baseline.replace('Intro paragraph.\n\n', '');
  const result = apply(source, planStudioEdit(source, next, baseline));
  assert.equal(result.replace(/\n{3,}/g, '\n\n'), source.replace('Intro paragraph.\n\n', ''));
});

test('a trailing empty Studio paragraph does not force a full rewrite', () => {
  const src =
    '# Guide\n\nShip it.\n\n| Stage | Owner |\n| --- | --- |\n| Build | CI |\n\n- [x] Tag\n';
  const baseline = `${serialize(src)}\n\n`;
  const next = baseline.replace('# Guide\n\n', '# Guide\n\n/\n\n');
  const result = apply(src, planStudioEdit(src, next, baseline));
  assert.equal(result, src.replace('# Guide\n\n', '# Guide\n\n/\n\n'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateText, plainLine } from '../../core/source-map';

test('Studio text locates its Markdown source despite formatting markers', () => {
  const source =
    '# Title\n\nSome **bold** words and a [link](x.md) here.\n\nRepeat me.\n\nRepeat me.\n';
  assert.equal(locateText(source, 'Some bold words and a link here.'), source.indexOf('Some'));
  assert.equal(locateText(source, 'Repeat me.', 0), source.indexOf('Repeat'));
  assert.equal(locateText(source, 'Repeat me.', 1), source.lastIndexOf('Repeat'));
  assert.equal(locateText(source, ''), undefined);
  assert.equal(locateText(source, 'absent text entirely'), undefined);
});

test('source lines reduce to the text Studio shows', () => {
  assert.equal(plainLine('## Getting **started**'), 'Getting started');
  assert.equal(plainLine('- [x] Read [the guide](g.md)'), 'Read the guide');
  assert.equal(plainLine('> See [[Home|home page]]'), 'See home page');
});

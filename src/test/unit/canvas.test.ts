import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCanvas, renderCanvasSvg, serializeCanvas } from '../../core/canvas';

const source = JSON.stringify({
  nodes: [
    {
      id: 'a',
      type: 'text',
      text: '# Plan\nShip <it>',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      color: '4',
      custom: { keep: true },
    },
    { id: 'b', type: 'file', file: 'guides/Start.md', x: 300, y: 0, width: 200, height: 60 },
    { id: 'c', type: 'link', url: 'javascript:alert(1)', x: 0, y: 200, width: 200, height: 60 },
    { id: 'g', type: 'group', label: 'Phase 1', x: -20, y: -20, width: 560, height: 120 },
    { id: 'a', type: 'text', text: 'duplicate id', x: 1, y: 1, width: 1, height: 1 },
    { id: 'bad', type: 'video' },
  ],
  edges: [
    { id: 'e1', fromNode: 'a', toNode: 'b', label: 'leads to', extra: 1 },
    { id: 'e2', fromNode: 'a', toNode: 'missing' },
  ],
  metadata: { version: '1.0' },
});

test('JSON Canvas parsing keeps unknown fields and drops invalid nodes and dangling edges', () => {
  const canvas = parseCanvas(source);
  assert.deepEqual(
    canvas.nodes.map((n) => n.id),
    ['a', 'b', 'c', 'g'],
  );
  assert.deepEqual(
    canvas.edges.map((e) => e.id),
    ['e1'],
  );
  assert.deepEqual(canvas.nodes[0].custom, { keep: true });
  assert.equal(canvas.edges[0].extra, 1);
  assert.deepEqual(canvas.metadata, { version: '1.0' });
  const text = serializeCanvas(canvas);
  assert.match(text, /^\{\n\t"nodes"/);
  assert.deepEqual(parseCanvas(text), canvas);
  assert.deepEqual(parseCanvas(''), { nodes: [], edges: [] });
  assert.throws(() => parseCanvas('{oops'), /Invalid canvas JSON/);
  assert.throws(() => parseCanvas('[]'), /must be a JSON object/);
});

test('canvas previews are static, escaped and only link safe targets', () => {
  const svg = renderCanvasSvg(parseCanvas(source), 'Map', (file) =>
    file === 'guides/Start.md' ? 'guides/Start.html' : undefined,
  );
  assert.match(svg, /aria-label="Map: 4 cards, 1 connections"/);
  assert.match(svg, /<a href="guides\/Start.html" aria-label="Page guides\/Start.md">/);
  assert.match(svg, /role="group"/, 'an SVG with links is not exposed as a single image');
  assert.match(svg, /Ship &lt;it&gt;/);
  // Unsafe URLs stay visible as text but never become links.
  assert.doesNotMatch(svg, /href="javascript:|<script|on[a-z]+=/i);
  assert.match(
    svg,
    /<g><rect class="canvas-node canvas-link"[^>]*\/><text class="canvas-label"><tspan[^>]*>javascript:alert\(1\)/,
  );
  assert.match(svg, /marker-end="url\(#canvas-arrow\)"/);
  assert.match(svg, /leads to/);
  assert.match(renderCanvasSvg({ nodes: [], edges: [] }, 'Empty'), /Empty canvas\./);
});

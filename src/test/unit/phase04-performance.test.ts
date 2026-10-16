import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotebook, renderNotebook } from '../../core/notebook';
import { parseChartSpec, parseCsv, renderChart } from '../../core/charts';
import { parseOpenApi, renderApiReference } from '../../core/openapi';
import { parseCanvas, renderCanvasSvg, serializeCanvas } from '../../core/canvas';

const timed = <T>(fn: () => T): [T, number] => {
  const start = performance.now();
  const value = fn();
  return [value, performance.now() - start];
};

test('a 2,000-cell notebook with outputs parses and renders quickly', () => {
  const cells = Array.from({ length: 2000 }, (_, i) =>
    i % 2
      ? {
          cell_type: 'code',
          metadata: {},
          execution_count: i,
          source: [`value_${i} = ${i} * 2\n`, `print(value_${i})`],
          outputs: [{ output_type: 'stream', name: 'stdout', text: [`${i * 2}\n`] }],
        }
      : {
          cell_type: 'markdown',
          metadata: {},
          source: [`## Step ${i}\n`, 'Some *explanation* text.'],
        },
  );
  const json = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells });
  const [html, ms] = timed(() =>
    renderNotebook(parseNotebook(json), {
      renderMarkdown: (md) => `<p>${md}</p>`,
      highlight: (code) => code,
    }),
  );
  assert.equal((html.match(/class="nb-cell /g) || []).length, 2000);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
});

test('a 5,000-row chart renders deterministically and quickly', () => {
  const csv = [
    'day,visits,signups',
    ...Array.from({ length: 5000 }, (_, i) => `D${i},${(i * 37) % 1000},${(i * 13) % 100}`),
  ].join('\n');
  const spec = parseChartSpec('type: line\ntitle: Load\nx: day\ny: visits, signups');
  const [first, ms] = timed(() => renderChart(spec, parseCsv(csv)));
  assert.equal(first, renderChart(spec, parseCsv(csv)), 'same input, same SVG');
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
});

test('an OpenAPI description with 500 operations and a 1,000-node canvas stay fast', () => {
  const paths = Array.from(
    { length: 250 },
    (_, i) =>
      `  /items${i}/{id}:\n    get:\n      operationId: get${i}\n      tags: [T${i % 10}]\n      parameters: [{name: id, in: path, required: true, schema: {$ref: '#/components/schemas/Id'}}]\n      responses: {"200": {description: OK, content: {application/json: {schema: {$ref: '#/components/schemas/Item'}}}}}\n    put:\n      operationId: put${i}\n      requestBody: {content: {application/json: {schema: {$ref: '#/components/schemas/Item'}}}}\n      responses: {"204": {description: Saved}}`,
  ).join('\n');
  const yaml = `openapi: 3.0.3\ninfo: {title: Big, version: "1"}\npaths:\n${paths}\ncomponents:\n  schemas:\n    Id: {type: string}\n    Item: {type: object, properties: {id: {$ref: '#/components/schemas/Id'}, children: {type: array, items: {$ref: '#/components/schemas/Item'}}}}\n`;
  const [html, apiMs] = timed(() => renderApiReference(parseOpenApi(yaml), (md) => md));
  assert.equal((html.match(/class="api-op"/g) || []).length, 500);
  assert.ok(apiMs < 3000, `API took ${apiMs.toFixed(0)} ms`);
  const canvas = {
    nodes: Array.from({ length: 1000 }, (_, i) => ({
      id: `n${i}`,
      type: 'text',
      text: `Card ${i}`,
      x: (i % 40) * 260,
      y: Math.floor(i / 40) * 120,
      width: 240,
      height: 80,
    })),
    edges: Array.from({ length: 999 }, (_, i) => ({
      id: `e${i}`,
      fromNode: `n${i}`,
      toNode: `n${i + 1}`,
    })),
  };
  const [svg, canvasMs] = timed(() =>
    renderCanvasSvg(parseCanvas(serializeCanvas(canvas as never)), 'Big'),
  );
  assert.match(svg, /1000 cards, 999 connections/);
  assert.ok(canvasMs < 1500, `canvas took ${canvasMs.toFixed(0)} ms`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChartSpec, parseCsv, parseJsonRows, renderChart, ticks } from '../../core/charts';

test('CSV parsing handles quotes, CRLF and numbers', () => {
  assert.deepEqual(parseCsv('name,value\r\n"Smith, J.",12\r\n"say ""hi""",3.5\n\n'), [
    { name: 'Smith, J.', value: 12 },
    { name: 'say "hi"', value: 3.5 },
  ]);
  assert.deepEqual(parseJsonRows('{"rows":[{"a":1,"b":"x","c":{"nested":true}}]}'), [
    { a: 1, b: 'x' },
  ]);
  assert.throws(() => parseJsonRows('{"a":1}'));
});

test('chart specs default safely and read inline data after ---', () => {
  const spec = parseChartSpec('type: wobble\ntitle: T\ny: a, b\nheight: 5000\n---\nx,a,b\n1,2,3');
  assert.equal(spec.type, 'bar');
  assert.deepEqual(spec.y, ['a', 'b']);
  assert.equal(spec.height, 800);
  assert.equal(spec.inline, 'x,a,b\n1,2,3');
  assert.deepEqual(ticks(0, 97), [0, 20, 40, 60, 80, 100]);
});

test('charts render deterministic, accessible SVG without inline styles or scripts', () => {
  const rows = parseCsv('week,visits,signups\nW1,120,8\nW2,180,14\nW3,150,11');
  for (const type of ['line', 'bar', 'area', 'scatter', 'pie'] as const) {
    const spec = {
      ...parseChartSpec(`type: ${type}\ntitle: Visits <b>\nx: week`),
      y: type === 'pie' ? ['visits'] : ['visits', 'signups'],
    };
    const a = renderChart(spec, rows);
    assert.equal(a, renderChart(spec, rows), `${type} is deterministic`);
    assert.match(
      a,
      /<svg class="chart-svg"[^>]*role="group" aria-labelledby="c[a-z0-9]+-t c[a-z0-9]+-d">/,
    );
    assert.match(a, /<title id="[^"]+">Visits &lt;b&gt;<\/title>/);
    assert.match(a, /<details class="chart-data"><summary>Data table<\/summary>/);
    assert.match(a, /aria-label="[^"]*120/);
    assert.doesNotMatch(a, /style=|<script|on[a-z]+=/i);
  }
  assert.match(renderChart(parseChartSpec('title: Empty'), []), /No data\./);
  assert.match(renderChart(parseChartSpec('y: missing'), [{ a: 'x' }]), /No numeric columns/);
});

test('rendered values are escaped', () => {
  const html = renderChart(parseChartSpec('type: bar'), [
    { label: '<img src=x onerror=alert(1)>', n: 1 },
  ]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

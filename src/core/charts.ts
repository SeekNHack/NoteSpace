/**
 * ```chart blocks render deterministic, accessible SVG. The same function serves the reader,
 * Studio's preview and static export, so exported charts match what the editor showed.
 *
 *   ```chart
 *   type: bar            # line | bar | area | scatter | pie
 *   title: Weekly visits
 *   data: data/visits.csv   # CSV or JSON file in the wiki (or inline CSV after ---)
 *   x: week
 *   y: visits, signups
 *   ---
 *   week,visits,signups
 *   W1,120,8
 *   ```
 *
 * Colors are CSS classes (`.chart-s0` …) resolved by the page stylesheet, never inline styles.
 */
export type ChartType = 'line' | 'bar' | 'area' | 'scatter' | 'pie' | 'donut';
export interface ChartSpec {
  type: ChartType;
  title?: string;
  data?: string;
  x?: string;
  y: string[];
  source?: string;
  group?: string;
  height: number;
  inline?: string;
}
export type Row = Record<string, string | number>;

export function parseChartSpec(source: string): ChartSpec {
  const [head, ...rest] = source.split(/^---[ \t]*$/m);
  const spec: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const match = /^\s*([a-z]+)\s*:\s*(.*?)\s*(?:#.*)?$/i.exec(line);
    if (match) spec[match[1].toLowerCase()] = match[2];
  }
  const type = (
    ['line', 'bar', 'area', 'scatter', 'pie', 'donut'].includes(spec.type) ? spec.type : 'bar'
  ) as ChartType;
  return {
    type,
    title: spec.title,
    data: spec.data,
    x: spec.x,
    y: (spec.y || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    source: spec.source,
    group: spec.group,
    height: Math.min(Math.max(Number(spec.height) || 280, 160), 800),
    inline: rest.length ? rest.join('---').replace(/^\n/, '') : undefined,
  };
}

/** RFC 4180 CSV with quoted fields; numbers are parsed when the whole cell is numeric. */
export function parseCsv(text: string, maxRows = 5000): Row[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      if (rows.length > maxRows) break;
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const names = header.map((h, i) => h.trim() || `column${i + 1}`);
  return body.map((cells) =>
    Object.fromEntries(names.map((name, i) => [name, toValue(cells[i] ?? '')])),
  );
}
const toValue = (cell: string): string | number => {
  const trimmed = cell.trim();
  return /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed) ? Number(trimmed) : trimmed;
};

/** JSON data: an array of objects, or `{ "rows": [...] }`. */
export function parseJsonRows(text: string): Row[] {
  const value = JSON.parse(text);
  const rows = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : undefined;
  if (!rows) throw new Error('JSON data must be an array of objects or { "rows": [...] }.');
  return rows
    .filter((r: unknown) => r && typeof r === 'object' && !Array.isArray(r))
    .slice(0, 5000)
    .map((r: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(r)
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
          .map(([k, v]) => [k, v as string | number]),
      ),
    );
}

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const fmt = (n: number) =>
  Math.abs(n) >= 1e6
    ? `${+(n / 1e6).toFixed(1)}M`
    : Math.abs(n) >= 1e4
      ? `${+(n / 1e3).toFixed(1)}k`
      : `${+n.toFixed(2)}`;

/** "Nice" axis ticks covering [min, max]. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
  const step = [1, 2, 5, 10].map((m) => m * step0).find((s) => span / s <= count) || step0 * 10;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5 && out.length < 50; v += step) out.push(+v.toFixed(10));
  return out;
}

export function renderChart(spec: ChartSpec, rows: Row[]): string {
  const title = spec.title || 'Chart';
  if (!rows.length)
    return `<figure class="chart"><figcaption>${escape(title)}</figcaption><p class="muted">No data.</p></figure>`;
  const keys = Object.keys(rows[0]);
  const x = spec.x && keys.includes(spec.x) ? spec.x : keys[0];
  const series = (
    spec.y.length ? spec.y : keys.filter((k) => k !== x && typeof rows[0][k] === 'number')
  ).filter((k) => keys.includes(k));
  if (!series.length)
    return `<figure class="chart"><figcaption>${escape(title)}</figcaption><p class="muted">No numeric columns to plot.</p></figure>`;
  const value = (row: Row, key: string) =>
    typeof row[key] === 'number' ? (row[key] as number) : Number(row[key]) || 0;
  const table = `<details class="chart-data"><summary>Data table</summary><table><thead><tr><th scope="col">${escape(x)}</th>${series
    .map((s) => `<th scope="col">${escape(s)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .slice(0, 200)
    .map(
      (r) =>
        `<tr><th scope="row">${escape(String(r[x]))}</th>${series.map((s) => `<td>${escape(String(r[s] ?? ''))}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table></details>`;
  const legend =
    series.length > 1 || spec.type === 'pie' || spec.type === 'donut'
      ? `<ul class="chart-legend">${(spec.type === 'pie' || spec.type === 'donut'
          ? rows.map((r) => String(r[x]))
          : series
        )
          .map(
            (name, i) =>
              `<li><span class="chart-swatch chart-s${i % 8}"></span>${escape(name)}</li>`,
          )
          .join('')}</ul>`
      : '';
  const W = 640,
    H = spec.height;
  const id = `c${hash(JSON.stringify([spec, rows.length, rows[0]]))}`;
  const description = `${spec.type} chart of ${series.join(', ')} by ${x}, ${rows.length} data points.`;
  let body = '';
  if (spec.type === 'pie' || spec.type === 'donut') {
    const s = series[0];
    const total = rows.reduce((sum, r) => sum + Math.max(0, value(r, s)), 0) || 1;
    let angle = -Math.PI / 2;
    const cx = W / 2,
      cy = H / 2,
      r = Math.min(W, H) / 2 - 16;
    body =
      rows
        .map((row, i) => {
          const v = Math.max(0, value(row, s));
          const a = (v / total) * Math.PI * 2;
          const x1 = cx + r * Math.cos(angle),
            y1 = cy + r * Math.sin(angle);
          angle += a;
          const x2 = cx + r * Math.cos(angle),
            y2 = cy + r * Math.sin(angle);
          const label = `${row[x]}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`;
          const path =
            a >= Math.PI * 2 - 1e-9
              ? `<circle cx="${cx}" cy="${cy}" r="${r}"`
              : `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z"`;
          return `${path} class="chart-slice chart-s${i % 8}" data-index="${i}" tabindex="0" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title>${a >= Math.PI * 2 - 1e-9 ? '</circle>' : '</path>'}`;
        })
        .join('') +
      (spec.type === 'donut'
        ? `<circle class="chart-hole" cx="${cx}" cy="${cy}" r="${(r * 0.56).toFixed(2)}"/>`
        : '');
  } else {
    const left = 52,
      right = 16,
      top = 12,
      bottom = 36;
    const values = rows.flatMap((r) => series.map((s) => value(r, s)));
    const numericX = spec.type === 'scatter' && rows.every((r) => typeof r[x] === 'number');
    const yTicks = ticks(Math.min(0, ...values), Math.max(0, ...values));
    const y0 = yTicks[0],
      y1 = yTicks[yTicks.length - 1];
    const sy = (v: number) => top + (H - top - bottom) * (1 - (v - y0) / (y1 - y0 || 1));
    const xs = numericX ? rows.map((r) => r[x] as number) : [];
    const xTicks = numericX ? ticks(Math.min(...xs), Math.max(...xs)) : [];
    const plotW = W - left - right;
    const band = plotW / rows.length;
    const sx = (row: Row, i: number) =>
      numericX
        ? left +
          (plotW * ((row[x] as number) - xTicks[0])) / (xTicks[xTicks.length - 1] - xTicks[0] || 1)
        : left + band * (i + 0.5);
    const grid = yTicks
      .map(
        (t) =>
          `<line class="chart-grid" x1="${left}" x2="${W - right}" y1="${sy(t).toFixed(2)}" y2="${sy(t).toFixed(2)}"/><text class="chart-tick" x="${left - 6}" y="${(sy(t) + 4).toFixed(2)}" text-anchor="end">${fmt(t)}</text>`,
      )
      .join('');
    const every = Math.ceil(rows.length / 10);
    const xLabels = numericX
      ? xTicks
          .map(
            (t) =>
              `<text class="chart-tick" x="${(left + (plotW * (t - xTicks[0])) / (xTicks[xTicks.length - 1] - xTicks[0] || 1)).toFixed(2)}" y="${H - bottom + 18}" text-anchor="middle">${fmt(t)}</text>`,
          )
          .join('')
      : rows
          .map((r, i) =>
            i % every
              ? ''
              : `<text class="chart-tick" x="${sx(r, i).toFixed(2)}" y="${H - bottom + 18}" text-anchor="middle">${escape(String(r[x]).slice(0, 14))}</text>`,
          )
          .join('');
    const axis = `<line class="chart-axis" x1="${left}" x2="${W - right}" y1="${sy(Math.max(y0, Math.min(0, y1))).toFixed(2)}" y2="${sy(Math.max(y0, Math.min(0, y1))).toFixed(2)}"/>`;
    const point = (row: Row, i: number, s: string, k: number) => {
      const label = `${s} at ${row[x]}: ${fmt(value(row, s))}`;
      return `<circle class="chart-point chart-s${k % 8}" data-index="${i}" cx="${sx(row, i).toFixed(2)}" cy="${sy(value(row, s)).toFixed(2)}" r="${spec.type === 'scatter' ? 4.5 : 3.5}" tabindex="0" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title></circle>`;
    };
    if (spec.type === 'bar') {
      const inner = Math.min(band * 0.8, 48 * series.length);
      const w = inner / series.length;
      body = rows
        .map((row, i) =>
          series
            .map((s, k) => {
              const v = value(row, s);
              const yv = sy(v),
                yz = sy(Math.max(y0, Math.min(0, y1)));
              const label = `${s} at ${row[x]}: ${fmt(v)}`;
              return `<rect class="chart-bar chart-s${k % 8}" data-index="${i}" x="${(left + band * i + (band - inner) / 2 + w * k).toFixed(2)}" y="${Math.min(yv, yz).toFixed(2)}" width="${Math.max(1, w - 2).toFixed(2)}" height="${Math.abs(yz - yv).toFixed(2)}" tabindex="0" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title></rect>`;
            })
            .join(''),
        )
        .join('');
    } else {
      body = series
        .map((s, k) => {
          const pts = rows.map((r, i) => `${sx(r, i).toFixed(2)},${sy(value(r, s)).toFixed(2)}`);
          const area =
            spec.type === 'area'
              ? `<path class="chart-area chart-s${k % 8}" d="M${pts[0].split(',')[0]},${sy(Math.max(y0, Math.min(0, y1))).toFixed(2)} L${pts.join(' L')} L${pts[pts.length - 1].split(',')[0]},${sy(Math.max(y0, Math.min(0, y1))).toFixed(2)} Z"/>`
              : '';
          const line =
            spec.type === 'scatter'
              ? ''
              : `<polyline class="chart-line chart-s${k % 8}" points="${pts.join(' ')}"/>`;
          return `${area}${line}${rows.map((r, i) => point(r, i, s, k)).join('')}`;
        })
        .join('');
    }
    body = `${grid}${axis}${xLabels}${body}`;
  }
  return `<figure class="chart chart-${spec.type}"><figcaption>${escape(title)}</figcaption><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="${id}-t ${id}-d"><title id="${id}-t">${escape(title)}</title><desc id="${id}-d">${escape(description)}</desc>${body}</svg>${legend}${table}</figure>`;
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Stylesheet for charts; colors come from design tokens so charts follow the theme. */
export const chartCss = `.doc .chart-hole{fill:var(--ws-surface)}
.doc .chart{margin:1.2em 0;padding:12px 14px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
.doc .chart figcaption{font-weight:600;font-size:.95em;margin:0 0 6px}
.doc .chart-svg{width:100%;height:auto;display:block;overflow:visible}
.doc .chart-grid{stroke:var(--ws-hairline);stroke-width:1}
.doc .chart-axis{stroke:var(--ws-border);stroke-width:1}
.doc .chart-tick{fill:var(--ws-muted);font:11px var(--ws-font)}
.doc .chart-line{fill:none;stroke-width:2.25;stroke-linejoin:round;stroke-linecap:round}
.doc .chart-area{opacity:.18;stroke:none}
.doc .chart-point{stroke:var(--ws-surface);stroke-width:1.5}
.doc .chart-bar:hover,.doc .chart-point:hover,.doc .chart-slice:hover,.doc .chart-bar:focus,.doc .chart-point:focus,.doc .chart-slice:focus{opacity:.8;outline:none;stroke:var(--ws-focus);stroke-width:2}
.doc .chart-slice{stroke:var(--ws-surface);stroke-width:1.5}
.doc .chart-legend{display:flex;flex-wrap:wrap;gap:4px 14px;list-style:none;padding:0;margin:8px 0 0;font-size:.85em;color:var(--ws-muted)}
.doc .chart-legend li{display:flex;align-items:center;gap:6px}
.doc .chart-swatch{width:10px;height:10px;border-radius:2px;display:inline-block}
.doc .chart-data{margin-top:6px;font-size:.85em}.doc .chart-data summary{cursor:pointer;color:var(--ws-muted)}
.doc .chart-data table{margin:6px 0 0}
${[
  '--ws-blue',
  '--ws-orange',
  '--ws-green',
  '--ws-purple',
  '--ws-red',
  '--ws-cyan',
  '--ws-accent',
  '--ws-muted',
]
  .map(
    (token, i) =>
      `.doc .chart-s${i}{fill:var(${token});stroke:var(${token})}.doc .chart-line.chart-s${i}{fill:none}.doc .chart-swatch.chart-s${i}{background:var(${token})}`,
  )
  .join('\n')}`;

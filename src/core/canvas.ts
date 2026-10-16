/**
 * JSON Canvas 1.0 (https://jsoncanvas.org): `{ nodes: [...], edges: [...] }`. Unknown fields on
 * the document, nodes and edges are preserved when NoteSpace writes the file back.
 */
export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
  [extra: string]: unknown;
}
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  toEnd?: 'none' | 'arrow';
  fromEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
  [extra: string]: unknown;
}
export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [extra: string]: unknown;
}

const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function parseCanvas(text: string): Canvas {
  if (!text.trim()) return { nodes: [], edges: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid canvas JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('A canvas must be a JSON object.');
  const doc = value as Record<string, unknown>;
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  for (const raw of Array.isArray(doc.nodes) ? doc.nodes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    if (
      typeof n.id !== 'string' ||
      ids.has(n.id) ||
      !['text', 'file', 'link', 'group'].includes(String(n.type))
    )
      continue;
    ids.add(n.id);
    nodes.push({
      ...n,
      id: n.id,
      type: n.type as CanvasNode['type'],
      x: finite(n.x, 0),
      y: finite(n.y, 0),
      width: Math.max(20, finite(n.width, 250)),
      height: Math.max(20, finite(n.height, 60)),
    });
  }
  const edges: CanvasEdge[] = [];
  for (const raw of Array.isArray(doc.edges) ? doc.edges : []) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== 'string' || !ids.has(String(e.fromNode)) || !ids.has(String(e.toNode)))
      continue;
    edges.push({
      ...e,
      id: e.id,
      fromNode: String(e.fromNode),
      toNode: String(e.toNode),
    } as CanvasEdge);
  }
  return { ...doc, nodes, edges };
}

/** Obsidian writes canvases with tab indentation; keep that so diffs stay small. */
export const serializeCanvas = (canvas: Canvas) => `${JSON.stringify(canvas, null, '\t')}\n`;

export const canvasColors: Record<string, string> = {
  '1': 'var(--ws-red)',
  '2': 'var(--ws-orange)',
  '3': 'var(--ws-orange)',
  '4': 'var(--ws-green)',
  '5': 'var(--ws-cyan)',
  '6': 'var(--ws-purple)',
};

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function anchor(
  node: CanvasNode,
  side: string | undefined,
  other: CanvasNode,
): [number, number] {
  const cx = node.x + node.width / 2,
    cy = node.y + node.height / 2;
  const s =
    side ||
    (Math.abs(other.x + other.width / 2 - cx) > Math.abs(other.y + other.height / 2 - cy)
      ? other.x + other.width / 2 > cx
        ? 'right'
        : 'left'
      : other.y + other.height / 2 > cy
        ? 'bottom'
        : 'top');
  return s === 'right'
    ? [node.x + node.width, cy]
    : s === 'left'
      ? [node.x, cy]
      : s === 'top'
        ? [cx, node.y]
        : [cx, node.y + node.height];
}

/** Read-only SVG preview for pages and exports. Text is plain (no Markdown execution). */
export function renderCanvasSvg(
  canvas: Canvas,
  title: string,
  fileHref?: (file: string) => string | undefined,
): string {
  if (!canvas.nodes.length)
    return `<figure class="canvas-preview"><figcaption>${escape(title)}</figcaption><p class="muted">Empty canvas.</p></figure>`;
  const minX = Math.min(...canvas.nodes.map((n) => n.x)) - 20,
    minY = Math.min(...canvas.nodes.map((n) => n.y)) - 20;
  const maxX = Math.max(...canvas.nodes.map((n) => n.x + n.width)) + 20,
    maxY = Math.max(...canvas.nodes.map((n) => n.y + n.height)) + 20;
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const color = (c?: string) =>
    c && /^#[0-9a-f]{6}$/i.test(c) ? c : c && canvasColors[c] ? canvasColors[c] : undefined;
  let linked = false;
  const groups = canvas.nodes.filter((n) => n.type === 'group');
  const others = canvas.nodes.filter((n) => n.type !== 'group');
  const box = (n: CanvasNode) => {
    const stroke = color(n.color);
    const label =
      n.type === 'file'
        ? n.file || ''
        : n.type === 'link'
          ? n.url || ''
          : n.type === 'group'
            ? n.label || ''
            : (n.text || '').replace(/^#+\s*/gm, '');
    const lines = label.split('\n').slice(0, Math.max(1, Math.floor((n.height - 12) / 18)));
    const text = lines
      .map(
        (line, i) =>
          `<tspan x="${n.x + 12}" y="${n.y + 22 + i * 18}">${escape(line.slice(0, Math.floor(n.width / 7.5)))}</tspan>`,
      )
      .join('');
    const href =
      n.type === 'file' && n.file
        ? fileHref?.(n.file)
        : n.type === 'link' && /^https?:\/\//i.test(n.url || '')
          ? n.url
          : undefined;
    const shape = `<rect class="canvas-node canvas-${n.type}" x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8"${stroke ? ` stroke="${stroke}"` : ''}/><text class="canvas-label">${text}</text>`;
    if (href) linked = true;
    return href
      ? `<a href="${escape(href)}" aria-label="${escape(n.type === 'file' ? `Page ${n.file}` : `Link ${n.url}`)}">${shape}</a>`
      : `<g>${shape}</g>`;
  };
  const edges = canvas.edges
    .map((e) => {
      const from = byId.get(e.fromNode)!,
        to = byId.get(e.toNode)!;
      const [x1, y1] = anchor(from, e.fromSide, to),
        [x2, y2] = anchor(to, e.toSide, from);
      const mid = e.label
        ? `<text class="canvas-edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle">${escape(e.label)}</text>`
        : '';
      return `<line class="canvas-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${e.toEnd === 'none' ? '' : ' marker-end="url(#canvas-arrow)"'}/>${mid}`;
    })
    .join('');
  const width = maxX - minX,
    height = maxY - minY;
  const body = `${groups.map(box).join('')}${edges}${others.map(box).join('')}`;
  // An image role would hide the links inside from assistive technology.
  return `<figure class="canvas-preview"><figcaption>${escape(title)}</figcaption><svg viewBox="${minX} ${minY} ${width} ${height}" role="${linked ? 'group' : 'img'}" aria-label="${escape(`${title}: ${canvas.nodes.length} cards, ${canvas.edges.length} connections`)}"><defs><marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="canvas-arrow"/></marker></defs>${body}</svg></figure>`;
}

export const canvasCss = `.doc .canvas-preview{margin:1.2em 0;padding:10px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
.doc .canvas-preview figcaption{font-weight:600;font-size:.9em;margin-bottom:6px}
.doc .canvas-preview svg{width:100%;height:auto;max-height:520px}
.doc .canvas-node{fill:var(--ws-bg);stroke:var(--ws-border);stroke-width:1.5}
.doc .canvas-group{fill:none;stroke-dasharray:6 4}
.doc .canvas-label{fill:var(--ws-fg);font:13px var(--ws-font)}
.doc .canvas-file+.canvas-label,.doc .canvas-link+.canvas-label{fill:var(--ws-accent)}
.doc .canvas-edge{stroke:var(--ws-muted);stroke-width:1.5}
.doc .canvas-arrow{fill:var(--ws-muted)}
.doc .canvas-edge-label{fill:var(--ws-muted);font:11px var(--ws-font)}
.doc .canvas-preview a:hover .canvas-node{stroke:var(--ws-accent)}`;

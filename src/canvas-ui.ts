import { anchor, Canvas, canvasColors, CanvasEdge, CanvasNode } from './core/canvas';
import { icon } from './core/icons';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { x: number; y: number; zoom: number } | undefined;
  setState(state: { x: number; y: number; zoom: number }): void;
};
const vscode = acquireVsCodeApi();
const view = vscode.getState() || { x: 80, y: 80, zoom: 1 };
let canvas: Canvas = { nodes: [], edges: [] };
let selected: { kind: 'node' | 'edge'; id: string } | undefined;
let editing: string | undefined;
let timer: number | undefined;

const app = document.getElementById('app')!;
app.innerHTML = `<style>
.tools{position:fixed;top:10px;left:10px;z-index:10;display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:4px;background:var(--ws-menu-bg);border:1px solid var(--ws-menu-border);border-radius:8px;box-shadow:var(--ws-shadow)}
.tools button{height:26px;padding:0 9px;border:0;border-radius:4px;background:none;color:var(--ws-fg);cursor:pointer;font:inherit}
.tools button:hover{background:var(--ws-hover)}.tools .sep{width:1px;height:18px;background:var(--ws-hairline)}
.tools .swatch{width:16px;height:16px;padding:0;border-radius:50%;border:1px solid var(--ws-border)}
.hint{position:fixed;bottom:10px;left:10px;color:var(--ws-muted);font-size:12px;z-index:10}
.viewport{position:absolute;inset:0;overflow:hidden;cursor:grab;background-image:radial-gradient(var(--ws-hairline) 1px,transparent 1px);background-size:24px 24px}
.viewport.panning{cursor:grabbing}
.world{position:absolute;left:0;top:0;transform-origin:0 0}
svg.edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible}
.edge{stroke:var(--ws-muted);stroke-width:2;fill:none}.edge.sel{stroke:var(--ws-focus);stroke-width:3}
.hit{stroke:transparent;stroke-width:14;fill:none;cursor:pointer}
.arrow{fill:var(--ws-muted)}
.elabel{fill:var(--ws-muted);font:12px var(--ws-font)}
.node{position:absolute;box-sizing:border-box;border:2px solid var(--ws-border);border-radius:8px;background:var(--ws-bg);padding:8px 10px;overflow:hidden;cursor:move;white-space:pre-wrap;line-height:1.4}
.node.group{background:color-mix(in srgb,var(--ws-fg) 3%,transparent);border-style:dashed;padding:4px 8px;font-weight:600;color:var(--ws-muted)}
.node.sel{outline:2px solid var(--ws-focus);outline-offset:2px}
.node:focus-visible{outline:2px solid var(--ws-focus)}
.node .meta{font-size:11px;color:var(--ws-muted)}
.node .glyph{display:inline-flex;vertical-align:-2px;margin-right:6px;color:var(--ws-muted)}
.node textarea{width:100%;height:100%;border:0;outline:0;background:none;color:inherit;font:inherit;resize:none}
.node .connect{position:absolute;right:-1px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;background:var(--ws-accent);cursor:crosshair;opacity:0}
.node:hover .connect,.node.sel .connect{opacity:1}
.node .resize{position:absolute;right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize}
.notice{position:fixed;inset:auto 10px 40px 10px;z-index:11;padding:10px;border:1px solid var(--ws-red);background:var(--ws-bg)}
</style>
<div class="viewport" tabindex="0" aria-label="Canvas. Double-click to add a card."><div class="world"><svg class="edges"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs><g id="edges"></g><line id="drag-line" class="edge" style="display:none"/></svg><div id="nodes"></div></div></div>
<div class="tools" role="toolbar" aria-label="Canvas tools">
<button data-add="text">+ Card</button><button data-add="file">+ Page</button><button data-add="link">+ Link</button><button data-add="group">+ Group</button><span class="sep"></span>
${['', '1', '2', '4', '5', '6'].map((c) => `<button class="swatch" data-color="${c}" title="${c ? 'Color' : 'No color'}" aria-label="${c ? `Color ${c}` : 'No color'}" style="background:${c ? canvasColors[c] : 'var(--ws-bg)'}"></button>`).join('')}
<span class="sep"></span><button data-zoom="-1" aria-label="Zoom out">−</button><button data-zoom="0" id="zoom-label">100%</button><button data-zoom="1" aria-label="Zoom in">+</button><button data-fit>Fit</button><span class="sep"></span><button data-delete>Delete</button></div>
<div class="hint">Double-click to add a card · drag the blue dot to connect · Ctrl+click a page card to open it</div>`;
const viewport = app.querySelector<HTMLElement>('.viewport')!;
const world = app.querySelector<HTMLElement>('.world')!;
const nodesLayer = app.querySelector<HTMLElement>('#nodes')!;
const edgesLayer = app.querySelector<SVGGElement>('#edges')!;
const dragLine = app.querySelector<SVGLineElement>('#drag-line')!;

const uid = () => Math.random().toString(16).slice(2, 18);
let invalid = false;
const changed = () => {
  // Never write while the file could not be parsed: that would replace it with an empty canvas.
  if (invalid) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => vscode.postMessage({ type: 'change', canvas }), 250);
};
const applyView = () => {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
  app.querySelector('#zoom-label')!.textContent = `${Math.round(view.zoom * 100)}%`;
  vscode.setState(view);
};
const toWorld = (clientX: number, clientY: number) => ({
  x: (clientX - view.x) / view.zoom,
  y: (clientY - view.y) / view.zoom,
});
const byId = (id: string) => canvas.nodes.find((n) => n.id === id);

function render() {
  nodesLayer.replaceChildren();
  const ordered = [
    ...canvas.nodes.filter((n) => n.type === 'group'),
    ...canvas.nodes.filter((n) => n.type !== 'group'),
  ];
  for (const node of ordered) {
    const el = document.createElement('div');
    el.className = `node ${node.type}${selected?.kind === 'node' && selected.id === node.id ? ' sel' : ''}`;
    el.tabIndex = 0;
    el.dataset.id = node.id;
    el.setAttribute('role', 'group');
    Object.assign(el.style, {
      left: `${node.x}px`,
      top: `${node.y}px`,
      width: `${node.width}px`,
      height: `${node.height}px`,
    });
    const color =
      node.color && (/^#[0-9a-f]{6}$/i.test(node.color) ? node.color : canvasColors[node.color]);
    if (color) el.style.borderColor = color;
    if (editing === node.id) {
      const area = document.createElement('textarea');
      area.value =
        node.type === 'text'
          ? node.text || ''
          : node.type === 'link'
            ? node.url || ''
            : node.type === 'group'
              ? node.label || ''
              : node.file || '';
      area.setAttribute('aria-label', 'Card text');
      area.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) area.blur();
      });
      area.addEventListener('blur', () => {
        if (node.type === 'text') node.text = area.value;
        else if (node.type === 'link') node.url = area.value.trim();
        else if (node.type === 'group') node.label = area.value.trim();
        editing = undefined;
        changed();
        render();
        nodesLayer.querySelector<HTMLElement>(`[data-id="${node.id}"]`)?.focus();
      });
      el.append(area);
      setTimeout(() => area.focus());
    } else {
      const label =
        node.type === 'text'
          ? node.text || ''
          : node.type === 'file'
            ? node.file || ''
            : node.type === 'link'
              ? node.url || ''
              : node.label || 'Group';
      if (node.type === 'file' || node.type === 'link') {
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.innerHTML = icon(node.type === 'file' ? 'file' : 'link', 14);
        el.append(glyph);
      }
      el.append(document.createTextNode(label));
      el.setAttribute('aria-label', `${node.type} card: ${label.slice(0, 80)}`);
      if (node.type === 'file') {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = 'Ctrl+click to open';
        el.append(meta);
      }
    }
    const connect = document.createElement('div');
    connect.className = 'connect';
    connect.title = 'Drag to another card to connect';
    const resize = document.createElement('div');
    resize.className = 'resize';
    el.append(connect, resize);
    nodesLayer.append(el);
  }
  edgesLayer.replaceChildren();
  for (const edge of canvas.edges) {
    const from = byId(edge.fromNode),
      to = byId(edge.toNode);
    if (!from || !to) continue;
    const [x1, y1] = anchor(from, edge.fromSide, to),
      [x2, y2] = anchor(to, edge.toSide, from);
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(k, String(v));
    line.setAttribute(
      'class',
      `edge${selected?.kind === 'edge' && selected.id === edge.id ? ' sel' : ''}`,
    );
    if (edge.toEnd !== 'none') line.setAttribute('marker-end', 'url(#arr)');
    const hit = line.cloneNode() as SVGLineElement;
    hit.setAttribute('class', 'hit');
    hit.removeAttribute('marker-end');
    hit.dataset.edge = edge.id;
    edgesLayer.append(line, hit);
    if (edge.label) {
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('class', 'elabel');
      text.setAttribute('x', String((x1 + x2) / 2));
      text.setAttribute('y', String((y1 + y2) / 2 - 6));
      text.setAttribute('text-anchor', 'middle');
      text.textContent = edge.label;
      edgesLayer.append(text);
    }
  }
}

function addNode(
  type: CanvasNode['type'],
  at?: { x: number; y: number },
  extra: Partial<CanvasNode> = {},
) {
  const center = at || toWorld(viewport.clientWidth / 2 - 120, viewport.clientHeight / 2 - 40);
  const node: CanvasNode = {
    id: uid(),
    type,
    x: Math.round(center.x),
    y: Math.round(center.y),
    width: type === 'group' ? 420 : 250,
    height: type === 'group' ? 300 : type === 'text' ? 80 : 60,
    ...(type === 'text'
      ? { text: '' }
      : type === 'link'
        ? { url: 'https://' }
        : type === 'group'
          ? { label: 'Group' }
          : {}),
    ...extra,
  };
  canvas.nodes.push(node);
  selected = { kind: 'node', id: node.id };
  if (type !== 'file') editing = node.id;
  changed();
  render();
}
function removeSelected() {
  if (!selected) return;
  if (selected.kind === 'node') {
    const id = selected.id;
    canvas.nodes = canvas.nodes.filter((n) => n.id !== id);
    canvas.edges = canvas.edges.filter((e) => e.fromNode !== id && e.toNode !== id);
  } else canvas.edges = canvas.edges.filter((e) => e.id !== selected!.id);
  selected = undefined;
  changed();
  render();
}
function fit() {
  if (!canvas.nodes.length) return;
  const minX = Math.min(...canvas.nodes.map((n) => n.x)),
    minY = Math.min(...canvas.nodes.map((n) => n.y));
  const maxX = Math.max(...canvas.nodes.map((n) => n.x + n.width)),
    maxY = Math.max(...canvas.nodes.map((n) => n.y + n.height));
  view.zoom = Math.max(
    0.2,
    Math.min(
      1.5,
      Math.min(
        (viewport.clientWidth - 80) / (maxX - minX),
        (viewport.clientHeight - 120) / (maxY - minY),
      ),
    ),
  );
  view.x = 40 - minX * view.zoom;
  view.y = 70 - minY * view.zoom;
  applyView();
}

let drag:
  | { kind: 'pan'; x: number; y: number; vx: number; vy: number }
  | {
      kind: 'move';
      id: string;
      dx: number;
      dy: number;
      children: Array<{ node: CanvasNode; dx: number; dy: number }>;
      moved: boolean;
    }
  | { kind: 'resize'; id: string }
  | { kind: 'connect'; id: string }
  | undefined;
viewport.addEventListener('mousedown', (event) => {
  const target = event.target as Element;
  const nodeEl = target.closest<HTMLElement>('.node');
  const hit = target.closest<SVGElement>('.hit');
  if (target.tagName === 'TEXTAREA') return;
  if (hit) {
    selected = { kind: 'edge', id: hit.dataset.edge! };
    render();
    return;
  }
  if (!nodeEl) {
    selected = undefined;
    render();
    drag = { kind: 'pan', x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    viewport.classList.add('panning');
    return;
  }
  const node = byId(nodeEl.dataset.id!)!;
  if (selected?.id !== node.id) {
    selected = { kind: 'node', id: node.id };
    render();
  }
  const p = toWorld(event.clientX, event.clientY);
  if (target.classList.contains('connect')) drag = { kind: 'connect', id: node.id };
  else if (target.classList.contains('resize')) drag = { kind: 'resize', id: node.id };
  else {
    const inside =
      node.type === 'group'
        ? canvas.nodes.filter(
            (n) =>
              n !== node &&
              n.x >= node.x &&
              n.y >= node.y &&
              n.x + n.width <= node.x + node.width &&
              n.y + n.height <= node.y + node.height,
          )
        : [];
    drag = {
      kind: 'move',
      id: node.id,
      dx: p.x - node.x,
      dy: p.y - node.y,
      children: inside.map((n) => ({ node: n, dx: n.x - node.x, dy: n.y - node.y })),
      moved: false,
    };
  }
  event.preventDefault();
});
window.addEventListener('mousemove', (event) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    view.x = drag.vx + event.clientX - drag.x;
    view.y = drag.vy + event.clientY - drag.y;
    applyView();
    return;
  }
  const node = byId(drag.id);
  if (!node) return;
  const p = toWorld(event.clientX, event.clientY);
  if (drag.kind === 'move') {
    node.x = Math.round(p.x - drag.dx);
    node.y = Math.round(p.y - drag.dy);
    for (const child of drag.children) {
      child.node.x = node.x + child.dx;
      child.node.y = node.y + child.dy;
    }
    drag.moved = true;
  } else if (drag.kind === 'resize') {
    node.width = Math.max(60, Math.round(p.x - node.x));
    node.height = Math.max(40, Math.round(p.y - node.y));
  } else {
    const [x1, y1] = anchor(node, 'right', node);
    dragLine.style.display = '';
    for (const [k, v] of Object.entries({ x1, y1, x2: p.x, y2: p.y }))
      dragLine.setAttribute(k, String(v));
    return;
  }
  render();
});
window.addEventListener('mouseup', (event) => {
  const current = drag;
  drag = undefined;
  viewport.classList.remove('panning');
  dragLine.style.display = 'none';
  if (!current || current.kind === 'pan') return;
  if (current.kind === 'connect') {
    const target = (
      document.elementFromPoint(event.clientX, event.clientY) as Element | null
    )?.closest<HTMLElement>('.node');
    if (target && target.dataset.id !== current.id) {
      const edge: CanvasEdge = {
        id: uid(),
        fromNode: current.id,
        toNode: target.dataset.id!,
        toEnd: 'arrow',
      };
      canvas.edges.push(edge);
      changed();
      render();
    }
    return;
  }
  if (current.kind === 'move' && !current.moved) return;
  changed();
});
viewport.addEventListener('dblclick', (event) => {
  const nodeEl = (event.target as Element).closest<HTMLElement>('.node');
  if (nodeEl) {
    const node = byId(nodeEl.dataset.id!)!;
    if (node.type !== 'file') {
      editing = node.id;
      render();
    }
    return;
  }
  addNode('text', toWorld(event.clientX, event.clientY));
});
viewport.addEventListener('click', (event) => {
  const nodeEl = (event.target as Element).closest<HTMLElement>('.node');
  if (!nodeEl || !(event.ctrlKey || event.metaKey)) return;
  const node = byId(nodeEl.dataset.id!)!;
  if (node.type === 'file' && node.file) vscode.postMessage({ type: 'openFile', file: node.file });
  if (node.type === 'link' && node.url) vscode.postMessage({ type: 'openLink', url: node.url });
});
viewport.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const before = toWorld(event.clientX, event.clientY);
      view.zoom = Math.max(0.2, Math.min(2.5, view.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
      view.x = event.clientX - before.x * view.zoom;
      view.y = event.clientY - before.y * view.zoom;
    } else {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
    }
    applyView();
  },
  { passive: false },
);
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLTextAreaElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    window.clearTimeout(timer);
    if (!invalid) vscode.postMessage({ type: 'change', canvas });
    vscode.postMessage({ type: 'save' });
    return;
  }
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
  if (focused && selected?.id !== focused) selected = { kind: 'node', id: focused };
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    removeSelected();
  } else if (event.key === 'Enter' && selected?.kind === 'node') {
    event.preventDefault();
    editing = selected.id;
    render();
  } else if (selected?.kind === 'node' && event.key.startsWith('Arrow')) {
    event.preventDefault();
    const node = byId(selected.id)!;
    const step = event.shiftKey ? 50 : 10;
    if (event.key === 'ArrowLeft') node.x -= step;
    if (event.key === 'ArrowRight') node.x += step;
    if (event.key === 'ArrowUp') node.y -= step;
    if (event.key === 'ArrowDown') node.y += step;
    changed();
    render();
    nodesLayer.querySelector<HTMLElement>(`[data-id="${node.id}"]`)?.focus();
  }
});
app.querySelector('.tools')!.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.dataset.add === 'file') vscode.postMessage({ type: 'pickPage' });
  else if (button.dataset.add) addNode(button.dataset.add as CanvasNode['type']);
  else if (button.dataset.color !== undefined && selected) {
    const target =
      selected.kind === 'node'
        ? byId(selected.id)
        : canvas.edges.find((e) => e.id === selected!.id);
    if (target) {
      if (button.dataset.color) target.color = button.dataset.color;
      else delete target.color;
      changed();
      render();
    }
  } else if (button.dataset.zoom !== undefined) {
    const step = Number(button.dataset.zoom);
    view.zoom = step ? Math.max(0.2, Math.min(2.5, view.zoom * (step > 0 ? 1.2 : 1 / 1.2))) : 1;
    applyView();
  } else if (button.dataset.fit !== undefined) fit();
  else if (button.dataset.delete !== undefined) removeSelected();
});
window.addEventListener('message', (event) => {
  const m = event.data;
  if (m?.type === 'document') {
    invalid = false;
    document.querySelector('.notice')?.remove();
    const first = !canvas.nodes.length && !canvas.edges.length;
    canvas = m.canvas;
    if (
      selected &&
      !canvas.nodes.some((n) => n.id === selected!.id) &&
      !canvas.edges.some((e) => e.id === selected!.id)
    )
      selected = undefined;
    render();
    if (first && !vscode.getState()) fit();
  } else if (m?.type === 'invalid') {
    invalid = true;
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.setAttribute('role', 'alert');
    notice.textContent = `${m.message} Open the file with the text editor to fix it; the canvas is not changed.`;
    document.body.append(notice);
  } else if (m?.type === 'pagePicked') addNode('file', undefined, { file: m.file });
});
applyView();
vscode.postMessage({ type: 'ready' });

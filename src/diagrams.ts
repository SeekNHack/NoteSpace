import { normalizeMermaid } from './core/mermaid-source';
import { escapeHtml } from './core/render';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

type Renderer = (source: string, options: Record<string, unknown>) => string;
let renderer: Renderer | undefined;

/** One lazily started worker; requests time out so a pathological diagram cannot hang the host. */
let worker: Worker | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
const waiting = new Map<number, { resolve: (svg: string) => void; reject: (e: Error) => void }>();
const workerFile = path.join(__dirname, 'mermaid-worker.js');
function inWorker(source: string, options: Record<string, unknown>): Promise<string> {
  if (!worker) {
    worker = new Worker(workerFile);
    worker.unref();
    worker.on('message', (m: { id: number; svg?: string; error?: string }) => {
      const entry = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.svg !== undefined) entry?.resolve(m.svg);
      else entry?.reject(new Error(m.error || 'Diagram could not be rendered.'));
    });
    const fail = (error: Error) => {
      for (const entry of waiting.values()) entry.reject(error);
      waiting.clear();
      worker = undefined;
    };
    worker.on('error', fail);
    worker.on('exit', () => fail(new Error('Diagram renderer stopped.')));
  }
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => void worker?.terminate(), 60000);
  const id = ++sequence;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      void worker?.terminate();
      reject(new Error('Diagram rendering timed out.'));
    }, 10000);
    waiting.set(id, {
      resolve: (svg) => {
        clearTimeout(timer);
        resolve(svg);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    worker!.postMessage({ id, source, options });
  });
}
async function render(source: string, options: Record<string, unknown>): Promise<string> {
  // The bundled extension ships the worker; unit tests run from source and render in-process.
  if (existsSync(workerFile)) return inWorker(source, options);
  renderer ||= (await import('beautiful-mermaid')).renderMermaidSVG as Renderer;
  return renderer(source, options);
}

export interface DiagramOptions {
  /**
   * `inline` emits SVG whose colors come from the page's CSS custom properties, so it follows
   * the active VS Code theme (requires a CSP that allows inline styles).
   * `image` emits a self-contained SVG image for static export; it follows the reader's
   * `prefers-color-scheme` unless `theme` forces one palette.
   */
  mode?: 'inline' | 'image';
  theme?: 'system' | 'light' | 'dark';
}

const palettes = {
  light:
    '--bg:#f6f8fa;--fg:#1f2328;--line:#6e7781;--accent:#0969da;--surface:#ffffff;--border:#d0d7de',
  dark: '--bg:#1c2128;--fg:#d4d4d4;--line:#8b949e;--accent:#4daafc;--surface:#22272e;--border:#444c56',
};

/** Rejects SVG that could execute or load anything; the renderer escapes labels, this is defense in depth. */
const unsafeSvg =
  /<script|<foreignObject|<iframe|<image|<use\b|\son[a-z]+\s*=|javascript:|href\s*=/i;

/** Renders one Mermaid source into sanitized SVG markup, or throws. */
export async function mermaidSvg(source: string, options: DiagramOptions = {}): Promise<string> {
  if (source.length > 20000) throw new Error('Diagram source is too large to render.');
  let svg = (
    await render(normalizeMermaid(source), {
      bg: '#000001',
      fg: '#000002',
      transparent: true,
      padding: 16,
    })
  )
    .replace(/@import\s+url\([^)]*\);?/gi, '')
    .replace(/'Inter',\s*/g, '')
    .replace(/'JetBrains Mono',\s*/g, '');
  if (svg.length > 1024 * 1024 || unsafeSvg.test(svg)) throw new Error('Diagram output rejected.');
  // Drop the renderer's fixed colors; the surrounding page or the palette below supplies them.
  svg = svg.replace(/^<svg([^>]*?)\sstyle="[^"]*"/, '<svg$1');
  if (options.mode === 'image') {
    const theme = options.theme || 'system';
    const css =
      theme === 'system'
        ? `svg{${palettes.light}}@media (prefers-color-scheme: dark){svg{${palettes.dark}}}`
        : `svg{${palettes[theme]}}`;
    svg = svg.replace(/<style>/, `<style>${css}`);
  }
  return svg.replace(/^<svg/, '<svg role="img" aria-label="Mermaid diagram"');
}

const decode = (s: string) =>
  s.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (value) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value]!,
  );

/** Replaces rendered Mermaid fences with diagrams. Invalid diagrams keep their source visible. */
export async function renderDiagrams(html: string, options: DiagramOptions = {}): Promise<string> {
  if (!html.includes('data-diagram="mermaid"')) return html;
  const parts: string[] = [];
  const pattern = /<pre class="mermaid" data-diagram="mermaid">([\s\S]*?)<\/pre>/g;
  let last = 0;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    parts.push(html.slice(last, match.index));
    last = match.index + match[0].length;
    const source = decode(match[1]);
    try {
      const svg = await mermaidSvg(source, options);
      parts.push(
        options.mode === 'image'
          ? `<figure class="diagram mermaid"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" alt="Mermaid diagram"></figure>`
          : `<figure class="diagram mermaid" data-diagram-zoom>${svg}</figure>`,
      );
    } catch (error) {
      parts.push(
        `<figure class="diagram mermaid diagram-invalid"><p class="diagram-error">Diagram could not be rendered: ${escapeHtml(error instanceof Error ? error.message : String(error)).slice(0, 200)}</p><pre class="mermaid">${escapeHtml(source)}</pre></figure>`,
      );
    }
  }
  parts.push(html.slice(last));
  return parts.join('');
}

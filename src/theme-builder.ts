import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WikiRoot, WikiWorkspace } from './workspace';
import {
  appearanceCss,
  contrast,
  fonts,
  presets,
  readableAccent,
  resolveAppearance,
  widths,
} from './core/themes';
import { contentCss, escapeHtml, renderPage } from './core/render';
import { tokensCss } from './core/design';
import { parsePage } from './core/markdown';
import { WikiIndex } from './core/index';
import { updateWikiConfig } from './i18n';
import type { WikiConfig } from './core/config';

const sample = `# Getting started

NoteSpace keeps your documentation in **Markdown**. Read the [installation guide](#) or jump to the [reference](#).

:::tip "Good to know"
Callouts, tabs and cards follow the theme's accent and corner radius.
:::

| Setting | Default |
| --- | --- |
| \`theme\` | system |
| \`width\` | normal |

\`\`\`bash
npm install && npm run build
\`\`\`

> Readable type and a comfortable measure matter more than decoration.
`;

/**
 * The previews must show the site, not the VS Code theme: every design token that VS Code would
 * override gets its own light/dark fallback, resolved by each pane's color-scheme.
 */
const neutralTokens = [
  ...(tokensCss.match(/^:root\{([\s\S]*?)\}/)?.[1] || '').matchAll(
    /(--ws-[\w-]+):([^;]+?)(?:;|$)/g,
  ),
]
  .map(([, name, value]) => {
    // VS Code-backed tokens fall back to their own light/dark values; derived tokens are
    // declared again so they are computed from each pane's colors.
    const fallback = /^var\(--vscode-[\w-]+,([\s\S]+)\)$/.exec(value.trim());
    return fallback
      ? `${name}:${fallback[1]}`
      : value.includes('var(--ws-')
        ? `${name}:${value}`
        : '';
  })
  .filter(Boolean)
  .join(';');

let panel: vscode.WebviewPanel | undefined;
/** Visual editor for the site's appearance (wiki.yaml `appearance`), with a live preview. */
export function openThemeBuilder(workspace: WikiWorkspace, root: WikiRoot): void {
  if (!root.config)
    throw new Error(
      'Themes are stored in wiki.yaml; this wiki has none. Run Create Wiki or Import Project first.',
    );
  panel ??= vscode.window.createWebviewPanel(
    'wikiStudio.theme',
    'Site Theme',
    vscode.ViewColumn.Active,
    { enableScripts: true },
  );
  panel.onDidDispose(() => (panel = undefined));
  const current = panel;
  current.title = `Site Theme: ${root.config.wiki.title}`;
  const index = new WikiIndex();
  const page = parsePage('theme', 'sample.md', 'theme:sample', sample);
  index.replace([page]);
  const preview = renderPage(page, index, { pageHref: () => '#' });
  const initial = { ...root.config.appearance };
  const nonce = randomBytes(16).toString('base64');
  const option = (value: string, label: string, selected: string) =>
    `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  current.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><title>Site Theme</title><style>${contentCss}
body{margin:0;background:var(--ws-bg);color:var(--ws-fg);font:13px var(--vscode-font-family,system-ui)}
.layout{display:grid;grid-template-columns:minmax(260px,320px) 1fr;min-height:100vh}
form{border-right:1px solid var(--ws-hairline);padding:16px;display:flex;flex-direction:column;gap:14px}
h1{font-size:15px;margin:0}fieldset{border:0;padding:0;margin:0}legend,label{font-weight:600;display:block;margin-bottom:6px}
.presets{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.preset{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px;border:1px solid var(--ws-border);border-radius:6px;background:var(--ws-surface);color:var(--ws-fg);cursor:pointer;text-align:left;font:inherit}
.preset[aria-pressed="true"]{outline:2px solid var(--ws-focus);outline-offset:1px}
.preset .swatch{width:100%;height:6px;border-radius:3px}.preset small{color:var(--ws-muted)}
select,input[type=text]{width:100%;box-sizing:border-box;height:28px;border-radius:4px;border:1px solid var(--vscode-input-border,var(--ws-border));background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));padding:0 6px;font:inherit}
.row{display:flex;gap:8px;align-items:center}.row input[type=color]{width:36px;height:28px;padding:0;border:1px solid var(--ws-border);border-radius:4px;background:none}
.contrast{font-size:12px;color:var(--ws-muted)}.contrast strong{color:var(--ws-fg)}
.actions{display:flex;gap:8px;margin-top:auto}
.btn{height:28px;padding:0 12px;border-radius:4px;border:1px solid transparent;background:var(--vscode-button-secondaryBackground,var(--ws-surface-2));color:var(--vscode-button-secondaryForeground,var(--ws-fg));cursor:pointer;font:inherit}
.btn.primary{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff)}
:focus-visible{outline:2px solid var(--ws-focus);outline-offset:1px}
.previews{display:grid;grid-template-columns:1fr 1fr;gap:0}
.pane{padding:20px 28px;overflow:auto}.pane h2.label{font:600 11px var(--vscode-font-family,system-ui);letter-spacing:.07em;text-transform:uppercase;margin:0 0 12px;color:var(--ws-muted)}
.pane{${neutralTokens};background:var(--ws-bg);color:var(--ws-fg)}
.pane.light{color-scheme:light}.pane.dark{color-scheme:dark}
.pane code{color:inherit}.pane blockquote{background:transparent;border-color:var(--ws-hairline)}.pane kbd{color:inherit;background:var(--ws-surface-2)}
@media (max-width:860px){.layout{grid-template-columns:1fr}.previews{grid-template-columns:1fr}}
</style><style id="live"></style></head><body><div class="layout"><form aria-label="Theme settings"><h1>Site theme</h1><p class="contrast">Used by the static site, PDF and the reader's type and width. Text colors always come from the light or dark scheme, so body text keeps WCAG AA contrast.</p>
<fieldset><legend>Presets</legend><div class="presets">${presets.map((p) => `<button type="button" class="preset" data-preset="${p.id}" aria-pressed="false"><span class="swatch" style="background:${p.accent}"></span><strong>${escapeHtml(p.label)}</strong><small>${escapeHtml(p.description)}</small></button>`).join('')}</div></fieldset>
<div><label for="accent">Accent color</label><div class="row"><input type="color" id="accent-picker" aria-label="Pick accent color"><input type="text" id="accent" pattern="#[0-9a-fA-F]{6}" maxlength="7"></div><p class="contrast" id="contrast" aria-live="polite"></p></div>
<div><label for="font">Typeface</label><select id="font">${Object.keys(fonts)
    .map((f) =>
      option(
        f,
        {
          system: 'System sans-serif',
          humanist: 'Humanist sans-serif',
          serif: 'Serif',
          mono: 'Monospace',
        }[f]!,
        initial.font,
      ),
    )
    .join('')}</select></div>
<div><label for="width">Content width</label><select id="width">${Object.entries(widths)
    .map(([w, px]) => option(w, `${w[0].toUpperCase()}${w.slice(1)} (${px})`, initial.width))
    .join('')}</select></div>
<div><label for="scheme">Color scheme</label><select id="scheme">${option('system', 'Follow the reader’s system', initial.theme)}${option('light', 'Always light', initial.theme)}${option('dark', 'Always dark', initial.theme)}</select></div>
<div class="actions"><button type="button" class="btn primary" id="save">Save to wiki.yaml</button><button type="button" class="btn" id="reset">Revert</button></div><p class="contrast" id="status" role="status"></p></form>
<div class="previews"><section class="pane light" aria-label="Light preview"><h2 class="label">Light</h2><div class="doc">${preview}</div></section><section class="pane dark" aria-label="Dark preview"><h2 class="label">Dark</h2><div class="doc">${preview}</div></section></div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const initial = ${JSON.stringify(initial).replace(/</g, '\\u003c')};
const presets = ${JSON.stringify(presets)};
let state = { ...initial };
const $ = (id) => document.getElementById(id);
function update() {
  for (const b of document.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === state.preset));
  $('accent').value = state.accent; $('accent-picker').value = state.accent;
  $('font').value = state.font; $('width').value = state.width; $('scheme').value = state.theme;
  vscode.postMessage({ type: 'preview', appearance: state });
}
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  const p = presets.find((x) => x.id === b.dataset.preset);
  state = { ...state, preset: p.id, accent: p.accent, font: p.font, width: p.width };
  update();
}));
$('accent').addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test($('accent').value)) { state.accent = $('accent').value.toLowerCase(); update(); } });
$('accent-picker').addEventListener('input', () => { state.accent = $('accent-picker').value; update(); });
for (const id of ['font', 'width']) $(id).addEventListener('change', () => { state[id] = $(id).value; update(); });
$('scheme').addEventListener('change', () => { state.theme = $('scheme').value; update(); });
$('save').addEventListener('click', () => vscode.postMessage({ type: 'save', appearance: state }));
$('reset').addEventListener('click', () => { state = { ...initial }; update(); });
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'css') { $('live').textContent = m.css; $('contrast').innerHTML = m.contrast; }
  if (m.type === 'saved') $('status').textContent = m.message;
});
update();
</script></body></html>`;
  const listener = current.webview.onDidReceiveMessage(
    async (m: { type?: string; appearance?: Partial<WikiConfig['appearance']> }) => {
      const a = m.appearance;
      if (!a || typeof a !== 'object') return;
      const appearance = {
        theme: (['system', 'light', 'dark'].includes(String(a.theme))
          ? a.theme
          : 'system') as WikiConfig['appearance']['theme'],
        accent: /^#[0-9a-f]{6}$/i.test(String(a.accent))
          ? String(a.accent).toLowerCase()
          : initial.accent,
        preset: presets.some((p) => p.id === a.preset) ? String(a.preset) : initial.preset,
        font: (String(a.font) in fonts ? a.font : initial.font) as WikiConfig['appearance']['font'],
        width: (String(a.width) in widths
          ? a.width
          : initial.width) as WikiConfig['appearance']['width'],
      };
      if (m.type === 'preview') {
        const resolved = resolveAppearance(appearance);
        const light = readableAccent(resolved.accent, '#ffffff'),
          dark = readableAccent(resolved.accent, '#1e1e1e');
        const vars = appearanceCss({ ...appearance, theme: 'system' })
          .replace(/^:root\{|\}$/g, '')
          .replace(/--ws-accent:[^;]+;/, '');
        const css = `.pane{${vars}}.pane.light{--ws-accent:${light}}.pane.dark{--ws-accent:${dark}}`;
        const note = (bg: string, value: string) => `${contrast(value, bg).toFixed(1)}:1`;
        await current.webview.postMessage({
          type: 'css',
          css,
          contrast: `Link contrast: <strong>${note('#ffffff', light)}</strong> light, <strong>${note('#1e1e1e', dark)}</strong> dark${light !== resolved.accent || dark !== resolved.accent ? ' (the accent is adjusted where needed to reach 4.5:1)' : ''}.`,
        });
      } else if (m.type === 'save') {
        try {
          await updateWikiConfig(workspace, root, (config) => {
            config.appearance = appearance;
          });
          Object.assign(initial, appearance);
          await current.webview.postMessage({
            type: 'saved',
            message: 'Saved. Rebuild the site or export a PDF to see it there.',
          });
        } catch (e) {
          await current.webview.postMessage({
            type: 'saved',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    },
  );
  current.onDidDispose(() => listener.dispose());
  current.reveal();
}

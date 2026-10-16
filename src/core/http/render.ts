import { parseHttpBlock } from './http-block';
import { ApiRequest } from './model';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export interface HttpRenderOptions {
  /** Interactive (reader, Studio): editable URL and body, environment, Send. Static otherwise. */
  interactive: boolean;
  /** Requests of `@collection` links, by `collection/path`. */
  linked?: Map<string, ApiRequest>;
  environments?: Array<{ id: string; name: string }>;
  activeEnvironment?: string;
}

/**
 * HTML for a ```http block. Nothing is sent by rendering: the interactive card has a Send button
 * that the host handles. The block's source travels in `data-source` so the host re-parses it
 * (the card never decides what is sent on its own).
 */
export function renderHttpBlock(source: string, options: HttpRenderOptions, id: string): string {
  let request: ApiRequest;
  let collection: string | undefined;
  try {
    const block = parseHttpBlock(source);
    collection = block.collection;
    const linked = collection ? options.linked?.get(collection) : undefined;
    if (collection && !linked) {
      return `<div class="http-block http-missing"><p class="diagram-error">Linked request not found: <code>${esc(collection)}</code>. It may have been renamed or deleted from its collection.</p></div>`;
    }
    request = linked || block.request;
  } catch (e) {
    return `<div class="http-block"><p class="diagram-error">HTTP block: ${esc(e instanceof Error ? e.message : String(e))}</p><pre><code>${esc(source)}</code></pre></div>`;
  }
  const headers = request.headers.filter((h) => h.enabled !== false && h.key);
  const body =
    request.body.type === 'json' || request.body.type === 'text' || request.body.type === 'xml'
      ? request.body.text || ''
      : '';
  const head = `<div class="http-head"><span class="http-method m-${esc(request.method.toLowerCase())}">${esc(request.method)}</span>${
    options.interactive
      ? `<input class="http-url" type="text" aria-label="Request URL" spellcheck="false" value="${esc(request.url)}">`
      : `<code class="http-url">${esc(request.url)}</code>`
  }${collection ? `<a class="http-link" href="#" data-collection="${esc(collection)}" title="Open in the API Client">${esc(collection)}</a>` : ''}</div>`;
  const headerList = headers.length
    ? `<ul class="http-headers">${headers.map((h) => `<li><code>${esc(h.key)}: ${esc(/^(authorization|cookie|x-api-key)$/i.test(h.key) && !/\{\{/.test(h.value) ? '•••' : h.value)}</code></li>`).join('')}</ul>`
    : '';
  const bodyHtml = body
    ? options.interactive
      ? `<textarea class="http-body" aria-label="Request body" spellcheck="false" rows="${Math.min(14, body.split('\n').length + 1)}">${esc(body)}</textarea>`
      : `<pre class="http-body"><code>${esc(body)}</code></pre>`
    : '';
  if (!options.interactive)
    return `<div class="http-block" data-method="${esc(request.method)}">${head}${request.name && request.name !== `${request.method} ${request.url}` ? `<p class="http-name">${esc(request.name)}</p>` : ''}${headerList}${bodyHtml}</div>`;
  const envs = options.environments || [];
  const envSelect = envs.length
    ? `<select class="http-env" aria-label="Environment"><option value="">No environment</option>${envs.map((e) => `<option value="${esc(e.id)}"${e.id === options.activeEnvironment ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`
    : '';
  return `<div class="http-block interactive" id="${esc(id)}" data-source="${esc(source)}">${head}${headerList}${bodyHtml}<div class="http-actions">${envSelect}<button type="button" class="http-send">Send</button><span class="http-note">Sends only when you press Send.</span></div><div class="http-response" aria-live="polite"></div></div>`;
}

export const httpBlockCss = `.http-block{border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);padding:8px 10px;margin:.8em 0;background:var(--ws-surface)}
.http-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.http-method{font:600 11px/18px var(--ws-mono);padding:0 6px;border-radius:4px;background:var(--ws-surface-2);color:var(--mc,var(--ws-fg))}
.m-get{--mc:var(--ws-green)}.m-post{--mc:var(--ws-orange)}.m-put{--mc:var(--ws-blue)}.m-patch{--mc:var(--ws-purple)}.m-delete{--mc:var(--ws-red)}
.http-url{flex:1;min-width:0;font:12.5px var(--ws-mono);overflow-wrap:anywhere}
input.http-url,textarea.http-body,.http-env{border:1px solid var(--vscode-input-border,var(--ws-border));background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));border-radius:var(--ws-r1);padding:3px 6px}
textarea.http-body{display:block;width:100%;box-sizing:border-box;margin-top:6px;font:12px/1.5 var(--ws-mono);resize:vertical}
.http-name{margin:4px 0 0;color:var(--ws-muted);font-size:.9em}
.http-headers{list-style:none;margin:6px 0 0;padding:0;font-size:12px;color:var(--ws-muted)}
.http-block pre.http-body{margin:6px 0 0}
.http-actions{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
.http-send{height:26px;padding:0 12px;border-radius:var(--ws-r1);border:0;background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff);cursor:pointer}
.http-send:disabled{opacity:.6}
.http-note{font-size:11.5px;color:var(--ws-muted)}
.http-link{font:11.5px var(--ws-mono)}
.http-response:empty{display:none}
.http-response{margin-top:8px;border-top:1px solid var(--ws-hairline);padding-top:6px}
.http-response pre{max-height:320px;overflow:auto;margin:4px 0 0}
.http-status{font:600 12px var(--ws-mono)}.http-status.ok{color:var(--ws-green)}.http-status.bad{color:var(--ws-red)}`;

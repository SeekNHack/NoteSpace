import { documentCss, tokensCss } from './core/design';
import { chartCss } from './core/charts';
import { notebookCss } from './core/notebook';
import { canvasCss } from './core/canvas';
import { blockColorToken } from './core/design';
import { apiCss } from './core/openapi';
import { dashboardCss } from './core/dashboard';
import { httpBlockCss } from './core/http/render';
import { iconUrl } from './core/icons';

/** Studio chrome: document bar, toolbar, floating menus and editor-only block affordances. */
export const visualShellCss = `${tokensCss}
body[data-embedded] .docbar .crumbs{visibility:hidden}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:var(--ws-bg);color:var(--ws-fg);font-family:var(--ws-font);font-size:var(--ws-ui-size)}
body[data-width=wide]{--ws-doc-width:960px}body[data-width=full]{--ws-doc-width:100%}
button,select,input{font:inherit;color:inherit}
.icon{display:block;flex:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:1px solid var(--ws-focus);outline-offset:-1px}
.chrome{position:sticky;top:0;z-index:20;background:var(--ws-bg)}
.docbar{display:flex;align-items:center;gap:var(--ws-s2);height:36px;padding:0 var(--ws-s3) 0 var(--ws-s4);border-bottom:1px solid var(--ws-hairline)}
.crumbs{display:flex;align-items:center;gap:2px;min-width:0;flex:1;color:var(--ws-muted);white-space:nowrap;overflow:hidden}
.crumbs span{overflow:hidden;text-overflow:ellipsis}
.crumbs .sep{flex:none;opacity:.55;width:14px;height:14px}
.crumbs .current{color:var(--ws-fg);font-weight:500}
.crumbs .wiki{flex:none;max-width:40%;font-weight:500;color:var(--ws-fg)}
.chip{display:inline-flex;align-items:center;gap:5px;height:22px;margin-left:8px;padding:0 8px;border:1px solid var(--ws-hairline);border-radius:999px;background:none;color:var(--ws-muted);font-size:12px;cursor:pointer}
.chip:hover{color:var(--ws-fg);background:var(--ws-hover)}
.sync{display:flex;align-items:center;gap:6px;color:var(--ws-muted);font-size:12px;white-space:nowrap;padding:0 var(--ws-s2)}
.sync::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ws-faint);flex:none}
.sync[data-tone=dirty]::before{background:var(--ws-orange)}
.sync[data-tone=busy]::before{background:var(--ws-blue);animation:pulse 1s ease-in-out infinite}
.sync[data-tone=saved]::before{background:var(--ws-green)}
.sync[data-tone=error]::before{background:var(--ws-red)}
@keyframes pulse{50%{opacity:.35}}
.segmented{display:flex;padding:2px;gap:2px;border-radius:var(--ws-r2);background:var(--ws-surface-2)}
.segmented button{display:flex;align-items:center;gap:5px;height:24px;padding:0 9px;border:0;border-radius:var(--ws-r1);background:none;color:var(--ws-muted);cursor:pointer;font-size:12px}
.segmented button:hover{color:var(--ws-fg)}
.segmented button[aria-pressed=true]{background:var(--ws-bg);color:var(--ws-fg);box-shadow:0 0 0 1px var(--ws-hairline)}
.tb{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--ws-r1);background:none;color:var(--ws-fg);cursor:pointer;flex:none;opacity:.86}
.tb:hover{background:var(--ws-hover);opacity:1}
.tb[aria-pressed=true]{background:var(--ws-pressed);color:var(--ws-accent);opacity:1}
.tb:disabled{opacity:.35;cursor:default;background:none}
.tb.text{width:auto;padding:0 8px;gap:4px;font-size:12px}
.toolbar{display:flex;height:38px;padding:0 var(--ws-s3);border-bottom:1px solid var(--ws-hairline);overflow-x:auto;scrollbar-width:none}
.toolbar-inner{display:flex;align-items:center;gap:2px;margin:0 auto;width:min(100%,calc(var(--ws-doc-width) + 104px))}
.toolbar::-webkit-scrollbar{display:none}
.toolbar .group{display:flex;align-items:center;gap:1px}
.toolbar .divider{width:1px;height:18px;background:var(--ws-hairline);margin:0 6px;flex:none}
.toolbar .group[hidden],.toolbar .divider[hidden]{display:none}
.toolbar .context{padding-left:6px;margin-left:4px;border-left:1px solid var(--ws-hairline)}
.toolbar .context .label{font-size:11px;color:var(--ws-muted);margin-right:4px;text-transform:uppercase;letter-spacing:.05em}
.blocktype{min-width:104px;justify-content:space-between}
.notice{display:flex;align-items:center;gap:var(--ws-s3);padding:8px var(--ws-s4);background:var(--vscode-inputValidation-warningBackground,color-mix(in srgb,var(--ws-orange) 14%,var(--ws-bg)));border-bottom:1px solid var(--vscode-inputValidation-warningBorder,var(--ws-orange));font-size:12px}
.notice[hidden]{display:none}
.notice p{margin:0;flex:1}
.btn{height:26px;padding:0 10px;border-radius:var(--ws-r1);border:1px solid transparent;background:var(--vscode-button-secondaryBackground,var(--ws-surface-2));color:var(--vscode-button-secondaryForeground,var(--ws-fg));cursor:pointer;white-space:nowrap;font-size:12px}
.btn:hover{background:var(--vscode-button-secondaryHoverBackground,var(--ws-hover))}
.btn.primary{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff)}
.btn.primary:hover{background:var(--vscode-button-hoverBackground,var(--ws-accent))}
.canvas{padding:var(--ws-s6) var(--ws-s7) 30vh;position:relative}
.page{max-width:var(--ws-doc-width);margin:0 auto;position:relative}
.ProseMirror{outline:none;min-height:50vh;caret-color:var(--ws-fg)}
.ProseMirror-focused{outline:none}
.ProseMirror p.is-empty::before,.ProseMirror h1.is-empty::before,.ProseMirror h2.is-empty::before,.ProseMirror h3.is-empty::before{content:attr(data-placeholder);color:var(--ws-faint);float:left;height:0;pointer-events:none}
.ProseMirror .selectedCell{background:var(--ws-selection)}
.ProseMirror .column-resize-handle{position:absolute;right:-2px;top:0;bottom:0;width:3px;background:var(--ws-accent);pointer-events:none}
.ProseMirror table{position:relative}
.ProseMirror.resize-cursor{cursor:col-resize}
.ProseMirror .ProseMirror-selectednode{outline:2px solid var(--ws-focus);outline-offset:2px;border-radius:var(--ws-r1)}
.ProseMirror img.ProseMirror-selectednode{outline-offset:0}
.ProseMirror-gapcursor{display:none;pointer-events:none;position:absolute}
.ProseMirror-gapcursor:after{content:"";display:block;position:absolute;top:-2px;width:20px;border-top:1px solid var(--ws-fg);animation:pulse 1.1s steps(2,start) infinite}
.ProseMirror-focused .ProseMirror-gapcursor{display:block}
.readonly-view[hidden],#editor[hidden]{display:none}
${documentCss}
${chartCss}
${notebookCss}
${canvasCss}
${apiCss}
${dashboardCss}
${httpBlockCss}
.doc .callout-head{position:relative}
.doc .callout-head select,.doc .callout-head input{background:transparent;border:0;border-radius:var(--ws-r1);padding:2px 4px;font-weight:600;color:var(--ws-fg);min-width:0}
.doc .callout-head select{appearance:none;-webkit-appearance:none;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:color-mix(in srgb,var(--c) 50%,var(--ws-fg));cursor:pointer;padding-right:4px;flex:none}
.doc .callout-head input{flex:1;font-size:inherit}
.doc .callout-head input::placeholder{color:var(--ws-faint);font-weight:500}
.doc .callout-head select:hover,.doc .callout-head input:hover{background:var(--ws-hover)}
.doc .callout-head select:focus,.doc .callout-head input:focus{outline:1px solid var(--ws-focus);background:var(--ws-bg)}
.doc .callout-head .tb{width:22px;height:22px;opacity:.6}
.doc .callout-head .tb:hover{opacity:1}
.doc .callout-head .collapse[aria-pressed=false] .icon{transform:rotate(-90deg)}
.doc .callout-head .color-dot{flex:none;width:14px;height:14px;padding:0;margin:0 2px;border-radius:50%;border:2px solid color-mix(in srgb,var(--c) 45%,var(--ws-bg));background:var(--c);cursor:pointer}
.doc .callout-head .color-dot:hover{transform:scale(1.15)}
.doc .callout-head .color-dot:focus-visible{outline:2px solid var(--ws-focus);outline-offset:2px}
.doc .callout-head .color-dot:disabled{cursor:default;opacity:.6}
.color-popover{--check:${iconUrl('check')};position:absolute;z-index:60;display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--ws-menu-bg);color:var(--ws-menu-fg);border:1px solid var(--ws-menu-border);border-radius:8px;box-shadow:var(--ws-shadow)}
.color-popover[hidden]{display:none}
.color-popover .swatches{display:grid;grid-template-columns:repeat(5,24px);gap:8px}
.color-popover .swatch{position:relative;width:24px;height:24px;padding:0;border-radius:50%;border:1px solid color-mix(in srgb,var(--ws-fg) 25%,transparent);cursor:pointer}
.color-popover .swatch[aria-checked=true]{box-shadow:0 0 0 2px var(--ws-menu-bg),0 0 0 4px var(--ws-fg)}
.color-popover .swatch[aria-checked=true]::after{content:"";position:absolute;inset:5px;background:#fff;-webkit-mask:var(--check) center/contain no-repeat;mask:var(--check) center/contain no-repeat}
.color-popover .swatch:focus-visible{outline:2px solid var(--ws-focus);outline-offset:3px}
.color-popover .reset{height:26px;padding:0 8px;border:0;border-radius:4px;background:none;color:var(--ws-menu-fg);text-align:left;cursor:pointer;font:inherit;font-size:12px}
.color-popover .reset:hover:not(:disabled),.color-popover .reset:focus-visible{background:var(--ws-menu-active);color:var(--ws-menu-active-fg)}
.color-popover .reset:disabled{opacity:.55;cursor:default}
${Object.entries(blockColorToken)
  .map(
    ([color, token]) => `.color-popover .swatch[data-color="${color}"]{background:var(${token})}`,
  )
  .join('')}
.doc [data-rich=hero] .rich-content{font-size:1.05em}
.ProseMirror section[data-rich]{display:block;margin:1.1em 0;padding:0 14px 1px;border:1px solid color-mix(in srgb,var(--c) 28%,transparent);border-left:3px solid var(--c);border-radius:var(--ws-r2);background:color-mix(in srgb,var(--c) 4%,var(--ws-bg))}
.ProseMirror section[data-rich]>.rich-content{display:block;border:0;margin:0;padding:2px 0}
.ProseMirror section[data-rich=tabs],.ProseMirror section[data-rich=stepper],.ProseMirror section[data-rich=timeline],.ProseMirror section[data-rich=grid],.ProseMirror section[data-rich=gallery]{background:transparent}
.ProseMirror section[data-rich=step]::before,.ProseMirror section[data-rich=event]::before{display:none}
.ProseMirror section[data-rich=step],.ProseMirror section[data-rich=event]{margin:.8em 0!important;padding:0 14px 1px!important;border:1px solid color-mix(in srgb,var(--c) 28%,transparent)!important;border-left:3px solid var(--c)!important;background:color-mix(in srgb,var(--c) 4%,var(--ws-bg))!important}
.ProseMirror section[data-rich=step]>.callout-head,.ProseMirror section[data-rich=event]>.callout-head{margin:0 -14px}
.doc .island[data-island=footnote]{font-size:.75em;vertical-align:super;line-height:0;padding:0 2px;color:var(--ws-accent);font-family:var(--ws-font);background:none}
.doc .code-view{margin:1em 0;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-code-bg);overflow:hidden}
.doc .code-view>pre{margin:0;border:0;border-radius:0;background:none}
.doc .code-view .code-head{display:flex;align-items:center;gap:4px;height:30px;padding:0 6px 0 10px;border-bottom:1px solid var(--ws-hairline);font-size:12px;color:var(--ws-muted)}
.doc .code-view .code-head select{background:transparent;border:0;color:var(--ws-muted);font-size:12px;padding:2px 4px;border-radius:var(--ws-r1);cursor:pointer}
.doc .code-view .code-head select:hover{background:var(--ws-hover);color:var(--ws-fg)}
.doc .code-view .code-head .spacer{flex:1}
.doc .code-view .code-head .tb{width:24px;height:24px;opacity:.65}
.doc .code-view .code-head .tb.text{width:auto;opacity:.8}
.doc .code-view .diagram{margin:0;border:0;border-top:1px solid var(--ws-hairline);border-radius:0;background:var(--ws-surface)}
.doc .code-view:is(.mermaid,.collection-view):not(.editing):not(.show-source).rendered>pre{display:none}
.doc .code-view.collection-view .diagram{text-align:left;padding:4px 12px}
.doc .code-view.collection-view .diagram .collection{border:0;background:none;padding:0}
.doc .code-view.mermaid:not(.editing):not(.show-source).rendered .diagram{border-top:0}
.doc .code-view .diagram:empty{display:none}
.doc .code-view .diagram.pending{opacity:.6}
.doc .island{display:inline;border-radius:var(--ws-r1);padding:0 1px;cursor:default;transition:box-shadow .1s}
.doc .island:hover{box-shadow:0 0 0 1px var(--ws-border)}
.doc .island.selected{box-shadow:0 0 0 2px var(--ws-focus)}
.doc .island.as-source{font-family:var(--ws-mono);font-size:.84em;color:var(--ws-muted);background:var(--ws-code-bg);padding:.1em .35em}
.doc .island[data-island=media].as-source{font-family:var(--ws-font);color:var(--ws-accent)}
.doc .island-block{margin:1em 0;border:1px dashed var(--ws-border);border-radius:var(--ws-r2);background:var(--ws-surface)}
.doc .island-block.selected{outline:2px solid var(--ws-focus);outline-offset:1px}
.doc .island-head{display:flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 10px;font-size:11px;color:var(--ws-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px dashed var(--ws-border)}
.doc .island-head .spacer,.doc .island-editor .spacer{flex:1}
.doc .island-head .tb{text-transform:none;letter-spacing:0;height:22px}
.doc .island-preview{padding:4px 14px}
.doc .island-preview>:first-child{margin-top:.5em}.doc .island-preview>:last-child{margin-bottom:.5em}
.doc .island-source{margin:.4em 0;padding:0;border:0;background:none;white-space:pre-wrap;font-size:12.5px;color:var(--ws-muted)}
.doc .island-source.pending{opacity:.7}
.doc .island-editor{padding:8px}
.doc .island-editor textarea{width:100%;font:12.5px/1.5 var(--ws-mono);color:var(--vscode-input-foreground,var(--ws-fg));background:var(--vscode-input-background,var(--ws-bg));border:1px solid var(--vscode-input-border,var(--ws-border));border-radius:var(--ws-r1);padding:6px 8px;resize:vertical}
.doc .island-editor textarea:focus{outline:1px solid var(--ws-focus);border-color:var(--ws-focus)}
.doc .island-editor .row{display:flex;align-items:center;gap:6px;margin-top:6px}
.doc .island-editor .hint,.sourcebox .hint{font-size:11.5px;color:var(--ws-muted)}
.sourcebox .hint{padding:6px 2px 2px}
.sourcebox input{font-family:var(--ws-mono)}
.doc .task-token{font-size:.82em;border-radius:999px;padding:.05em .45em;background:var(--ws-surface-2);color:var(--ws-muted);white-space:nowrap}
.doc .task-due{color:var(--ws-accent)}.doc .task-priority{color:var(--ws-orange)}.doc .task-tag{color:var(--ws-purple)}
.doc .task-id{opacity:.55}
.doc .code-view .run-output{border-top:1px solid var(--ws-hairline);padding:6px 12px;font-size:12.5px}
.doc .code-view .run-output pre{margin:4px 0;border:0;padding:0;background:none;white-space:pre-wrap}
.doc .code-view .run-stderr{color:var(--ws-orange)}
.doc .code-view .run-meta{color:var(--ws-muted);font-size:11.5px}
.doc .code-view .run-actions{display:flex;gap:6px;margin-top:4px}
.doc .code-view .tb.run{color:var(--ws-green)}
.handle{position:absolute;display:flex;gap:1px;z-index:5;opacity:0;transition:opacity .12s;pointer-events:none}
.handle.visible{opacity:1;pointer-events:auto}
.handle .tb{width:22px;height:24px;color:var(--ws-faint)}
.handle .tb:hover{color:var(--ws-fg)}
.handle .grip{cursor:grab}
.float{position:fixed;z-index:30;background:var(--ws-menu-bg);color:var(--ws-menu-fg);border:1px solid var(--ws-menu-border);border-radius:var(--ws-r3);box-shadow:var(--ws-shadow)}
.float[hidden]{display:none}
.bubble{display:flex;align-items:center;gap:1px;padding:3px}
.bubble .divider{width:1px;height:16px;background:var(--ws-hairline);margin:0 3px}
.menu{width:300px;max-height:min(360px,60vh);overflow-y:auto;padding:4px;outline:none}
.menu .heading{padding:8px 8px 4px;font-size:11px;font-weight:600;color:var(--ws-muted);text-transform:uppercase;letter-spacing:.05em}
.menu .item{display:flex;align-items:center;gap:10px;width:100%;padding:5px 8px;border:0;border-radius:var(--ws-r1);background:none;text-align:left;cursor:pointer;color:inherit}
.menu .item .glyph{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-bg);flex:none;color:var(--ws-muted)}
.menu .item .text{display:flex;flex-direction:column;min-width:0;flex:1}
.menu .item .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.menu .item .hint{font-size:11.5px;color:var(--ws-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.menu .item kbd{font:11px var(--ws-mono);color:var(--ws-muted)}
.menu .item[aria-selected=true]{background:var(--ws-menu-active);color:var(--ws-menu-active-fg);outline:1px dashed var(--vscode-contrastActiveBorder,transparent);outline-offset:-1px}
.menu .item[aria-selected=true] .hint,.menu .item[aria-selected=true] kbd{color:inherit;opacity:.8}
.menu .empty{padding:10px 8px;color:var(--ws-muted)}
.menu.compact{width:220px}
.menu.compact .item{padding:4px 8px}
.linkbox{width:340px;padding:6px}
.linkbox .row{display:flex;gap:4px;align-items:center}
.linkbox input{flex:1;height:28px;padding:0 8px;border-radius:var(--ws-r1);border:1px solid var(--vscode-input-border,var(--ws-border));background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg))}
.linkbox input:focus{outline:1px solid var(--ws-focus);border-color:var(--ws-focus)}
.linkbox .menu{width:auto;max-height:220px;padding:4px 0 0}
.hovercard{width:300px;padding:10px 12px;pointer-events:none}
.hovercard strong{display:block}
.hovercard small{display:block;color:var(--ws-muted);font-family:var(--ws-mono);font-size:11px;margin-top:1px}
.hovercard p{margin:6px 0 0;color:var(--ws-muted);font-size:12.5px;line-height:1.45}
.hovercard .hint{margin-top:8px;font-size:11px;color:var(--ws-faint)}
.hovercard .missing{color:var(--ws-error)}
@media (max-width:720px){.canvas{padding:var(--ws-s4) var(--ws-s4) 30vh}.crumbs .wiki{display:none}.chip{margin-left:0}.segmented button .label{display:none}.sync .label{display:none}.handle{display:none}.docbar{padding:0 var(--ws-s2)}}
@media (max-width:480px){.toolbar .optional{display:none}}
.collapse-chevron{mask:${iconUrl('chevron')}}
/* Block gallery */
.gallery-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;background:color-mix(in srgb,var(--ws-bg) 55%,transparent)}
.gallery-backdrop[hidden]{display:none}
.gallery{display:flex;flex-direction:column;width:min(1040px,100%);max-height:86vh;background:var(--ws-menu-bg);color:var(--ws-menu-fg);border:1px solid var(--ws-menu-border);border-radius:10px;box-shadow:var(--ws-shadow);overflow:hidden}
.gallery-head{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--ws-hairline)}
.gallery-head h2{margin:0;font-size:14px;font-weight:600;white-space:nowrap}
.gallery-search{flex:1;min-width:0;height:30px;padding:0 10px;font:inherit;border:1px solid var(--ws-border);border-radius:6px;background:var(--ws-bg);color:var(--ws-fg)}
.gallery-search:focus{outline:2px solid var(--ws-focus);outline-offset:0}
.gallery-close{font-size:18px;line-height:1}
.gallery-body{display:grid;grid-template-columns:170px 1fr;min-height:0;flex:1}
.gallery-cats{display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid var(--ws-hairline);overflow:auto}
.gallery-cat{border:0;background:none;color:inherit;font:inherit;font-size:12.5px;text-align:left;padding:6px 8px;border-radius:5px;cursor:pointer}
.gallery-cat:hover{background:var(--ws-hover)}.gallery-cat[aria-pressed=true]{background:var(--ws-menu-active);color:var(--ws-menu-active-fg)}
.gallery-cat:focus-visible,.gallery-card:focus-visible{outline:2px solid var(--ws-focus);outline-offset:1px}
.gallery-main{overflow:auto;padding:10px 14px 14px}
.gallery-status{margin:0 0 8px;font-size:12px;color:var(--ws-muted)}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.gallery-card{display:flex;flex-direction:column;gap:4px;padding:8px;text-align:left;font:inherit;color:inherit;background:var(--ws-bg);border:1px solid var(--ws-hairline);border-radius:8px;cursor:pointer;min-width:0}
.gallery-card[aria-selected=true]{border-color:var(--ws-accent);box-shadow:0 0 0 1px var(--ws-accent)}
.gallery-preview{height:118px;overflow:hidden;pointer-events:none;border-radius:5px;background:var(--ws-bg);padding:2px 6px;font-size:11px;line-height:1.4;position:relative;-webkit-mask:linear-gradient(#000 78%,transparent);mask:linear-gradient(#000 78%,transparent)}
.gallery-preview>*:first-child{margin-top:4px}
.gallery-preview h1,.gallery-preview h2,.gallery-preview h3{font-size:13px}
.gallery-preview.pending{background:var(--ws-surface)}
.gallery-pick{color:var(--ws-muted);font-size:11.5px;margin:30px 6px 0}
.gallery-label{font-weight:600;font-size:13px}
.gallery-desc{font-size:11.5px;color:var(--ws-muted)}
.gallery-keys{margin:0;padding:6px 14px;border-top:1px solid var(--ws-hairline);font-size:11px;color:var(--ws-muted)}
@media (max-width:640px){.gallery-body{grid-template-columns:1fr}.gallery-cats{flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--ws-hairline)}}
/* Block inspector */
.inspector{position:fixed;z-index:70;width:300px;max-width:calc(100vw - 16px);padding:10px 12px;background:var(--ws-menu-bg);color:var(--ws-menu-fg);border:1px solid var(--ws-menu-border);border-radius:8px;box-shadow:var(--ws-shadow);font-size:12.5px}
.inspector[hidden]{display:none}
.inspector h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--ws-muted)}
.insp-row{display:grid;grid-template-columns:96px 1fr auto;gap:4px 8px;align-items:center;margin:0 0 7px}
.insp-row label{color:var(--ws-muted)}
.insp-row input,.insp-row select{min-width:0;height:26px;padding:0 6px;font:inherit;border:1px solid var(--ws-border);border-radius:4px;background:var(--ws-bg);color:var(--ws-fg)}
.insp-row input:focus,.insp-row select:focus{outline:2px solid var(--ws-focus);outline-offset:0}
.insp-row small{grid-column:2/4;color:var(--ws-muted);font-size:11px}
.insp-row .btn{height:26px;padding:0 8px}
.insp-note{margin:4px 0 8px;font-size:11px;color:var(--ws-muted)}
.insp-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}`;

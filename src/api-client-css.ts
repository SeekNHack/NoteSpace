/** API Client styles on the shared design tokens (VS Code theme colors). */
export const apiClientCss = `
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{margin:0;height:100%;background:var(--ws-bg);color:var(--ws-fg);font:var(--ws-ui-size)/1.45 var(--ws-font)}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:1px solid var(--ws-focus);outline-offset:-1px}
.icon{display:inline-block;vertical-align:-3px;flex:none}
.app{display:grid;grid-template-columns:minmax(220px,270px) minmax(0,1fr);height:100vh}
.side{border-right:1px solid var(--ws-hairline);display:flex;flex-direction:column;min-height:0}
.side-tabs{display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--ws-hairline)}
.side-tabs button,.subtabs button{border:0;background:none;color:var(--ws-muted);padding:4px 8px;border-radius:var(--ws-r1);cursor:pointer}
.side-tabs button[aria-selected=true],.subtabs button[aria-selected=true]{background:var(--ws-pressed);color:var(--ws-fg);font-weight:600}
.side-body{flex:1;overflow:auto;padding:6px}
.side-actions{display:flex;gap:4px;margin:0 0 6px;flex-wrap:wrap}
.field{height:28px;padding:0 8px;border-radius:var(--ws-r1);border:1px solid var(--vscode-input-border,var(--ws-border));background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));min-width:0}
.field:focus{outline:1px solid var(--ws-focus);border-color:var(--ws-focus)}
textarea.field{height:auto;padding:6px 8px;font:12.5px/1.5 var(--ws-mono);resize:vertical;width:100%;min-height:160px;tab-size:2}
.btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--ws-r1);border:1px solid transparent;background:var(--vscode-button-secondaryBackground,var(--ws-surface-2));color:var(--vscode-button-secondaryForeground,var(--ws-fg));cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--vscode-button-secondaryHoverBackground,var(--ws-hover))}
.btn.primary{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff)}
.btn.ghost{background:none;color:var(--ws-muted)}.btn.ghost:hover{background:var(--ws-hover);color:var(--ws-fg)}
.btn.small{height:24px;padding:0 8px;font-size:12px}
.btn:disabled{opacity:.5;cursor:default}
.btn.danger{color:var(--ws-red)}
.tree{list-style:none;margin:0;padding:0}
.tree .tree{padding-left:12px}
.node{display:flex;align-items:center;gap:6px;width:100%;border:0;background:none;padding:3px 6px;border-radius:var(--ws-r1);cursor:pointer;text-align:left;min-width:0}
.node:hover{background:var(--ws-hover)}.node[aria-current=true]{background:var(--ws-menu-active);color:var(--ws-menu-active-fg)}
.node .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node.drop{box-shadow:inset 0 -2px 0 var(--ws-focus)}
.collection-head{font-weight:600}
.m{font:600 10px/16px var(--ws-mono);min-width:44px;text-align:center;border-radius:3px;padding:0 3px;flex:none;color:var(--mc,var(--ws-muted))}
.m-GET{--mc:var(--ws-green)}.m-POST{--mc:var(--ws-orange)}.m-PUT{--mc:var(--ws-blue)}.m-PATCH{--mc:var(--ws-purple)}.m-DELETE{--mc:var(--ws-red)}.m-HEAD,.m-OPTIONS{--mc:var(--ws-cyan)}
.muted{color:var(--ws-muted)}.small{font-size:12px}
.empty{padding:14px;border:1px dashed var(--ws-border);border-radius:var(--ws-r2);color:var(--ws-muted);text-align:center;font-size:12.5px}
.empty p{margin:0 0 8px}
.main{display:flex;flex-direction:column;min-width:0;min-height:0}
.tabs{display:flex;gap:1px;border-bottom:1px solid var(--ws-hairline);overflow-x:auto;min-height:34px;align-items:stretch}
.tab{display:flex;align-items:center;gap:6px;padding:0 6px 0 10px;border:0;border-right:1px solid var(--ws-hairline);background:none;cursor:pointer;max-width:220px;color:var(--ws-muted)}
.tab[data-selected=true]{background:var(--ws-surface);color:var(--ws-fg);box-shadow:inset 0 -2px 0 var(--ws-accent)}
.tab .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab .dirty{width:7px;height:7px;border-radius:50%;background:var(--ws-fg)}
.tab-list{display:flex;gap:1px;align-items:stretch}.tab-main{display:flex;align-items:center;gap:6px;border:0;background:none;color:inherit;cursor:pointer;padding:0;font:inherit;min-width:0;height:100%}
.tab .close{border:0;background:none;color:inherit;cursor:pointer;padding:0 4px;border-radius:3px}.tab .close:hover{background:var(--ws-hover)}
.request{padding:10px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;flex:1}
.urlbar{display:flex;gap:6px;align-items:center}
.urlbar .method{width:96px;font-weight:600}
.urlbar .url{flex:1;font-family:var(--ws-mono);font-size:12.5px}
.name-row{display:flex;gap:6px;align-items:center}
.name-row .field{flex:1}
.notice{font-size:12px;color:var(--ws-orange)}
.notice.error{color:var(--ws-red)}
.subtabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid var(--ws-hairline);padding-bottom:4px}
.subtabs .count{font-size:11px;margin-left:3px;color:var(--ws-muted)}
.kv{width:100%;border-collapse:collapse}
.kv td{padding:2px 3px}.kv td:first-child{width:24px}
.kv .field{width:100%}
.kv .del{width:28px}
.form-grid{display:grid;grid-template-columns:140px minmax(0,1fr);gap:6px 10px;align-items:center;max-width:640px}
.form-grid label{color:var(--ws-muted);font-size:12px}
pre.code{margin:0;padding:8px 10px;background:var(--ws-code-bg);border:1px solid var(--ws-hairline);border-radius:var(--ws-r1);font:12px/1.5 var(--ws-mono);white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
.response{border-top:1px solid var(--ws-hairline);display:flex;flex-direction:column;min-height:0;height:45%;}
.response-head{display:flex;gap:10px;align-items:center;padding:6px 14px;flex-wrap:wrap}
.status{font:600 12.5px var(--ws-mono);padding:1px 8px;border-radius:999px;background:var(--ws-surface-2)}
.status.s2{color:var(--ws-green)}.status.s3{color:var(--ws-blue)}.status.s4,.status.s5,.status.err{color:var(--ws-red)}
.response-body{flex:1;overflow:auto;padding:0 14px 12px}
.response-body pre.code{max-height:none}
.response-body img{max-width:100%;max-height:420px;border:1px solid var(--ws-hairline);background:repeating-conic-gradient(var(--ws-surface) 0 25%,var(--ws-bg) 0 50%) 0 0/16px 16px}
mark{background:color-mix(in srgb,var(--ws-orange) 40%,transparent);color:inherit}
.tests li{list-style:none;padding:2px 0;font-size:12.5px}.tests ul{margin:0;padding:0}
.pass{color:var(--ws-green)}.fail{color:var(--ws-red)}
.hist{display:flex;gap:6px;align-items:center;width:100%;border:0;background:none;padding:4px 6px;border-radius:var(--ws-r1);cursor:pointer;text-align:left;font-size:12px}
.hist:hover{background:var(--ws-hover)}
.hist .url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-family:var(--ws-mono)}
.env-row{display:grid;grid-template-columns:20px 1fr 1fr 70px 28px;gap:4px;align-items:center;margin:2px 0}
.welcome{padding:24px;max-width:640px}
.welcome h1{font-size:18px;margin:0 0 6px}
.welcome textarea{min-height:110px}
.menu{position:fixed;z-index:50;min-width:170px;padding:4px;background:var(--ws-menu-bg);color:var(--ws-menu-fg);border:1px solid var(--ws-menu-border);border-radius:6px;box-shadow:var(--ws-shadow)}
.menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:5px 8px;border-radius:4px;cursor:pointer;color:inherit}
.menu button:hover,.menu button:focus{background:var(--ws-menu-active);color:var(--ws-menu-active-fg);outline:none}
.menu .danger{color:var(--ws-red)}
.toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:var(--ws-menu-bg);border:1px solid var(--ws-menu-border);box-shadow:var(--ws-shadow);padding:8px 14px;border-radius:var(--ws-r2);z-index:60;max-width:90vw}
.toast.error{border-color:var(--ws-red)}
@media(max-width:760px){.app{grid-template-columns:1fr;grid-template-rows:auto 1fr}.side{max-height:38vh;border-right:0;border-bottom:1px solid var(--ws-hairline)}.form-grid{grid-template-columns:1fr}.response{height:auto;min-height:200px}}
`;

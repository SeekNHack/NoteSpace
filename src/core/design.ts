import {
  BlockColor,
  blockColors,
  calloutKinds,
  defaultBlockColor,
  layoutKinds,
} from './rich-blocks';
import { IconName, iconUrl } from './icons';

/**
 * NoteSpace design tokens. Inside VS Code every value comes from the active theme;
 * the light-dark() fallbacks only apply to static exports opened in a browser.
 * `--vscode-contrastBorder` exists only in high-contrast themes, so it doubles as an HC switch.
 */
export const tokensCss = `:root{color-scheme:light dark;
--ws-bg:var(--vscode-editor-background,light-dark(#ffffff,#1e1e1e));
--ws-fg:var(--vscode-editor-foreground,light-dark(#1f2328,#d4d4d4));
--ws-muted:var(--vscode-descriptionForeground,light-dark(#5f6b7a,#9da5b4));
--ws-faint:color-mix(in srgb,var(--ws-fg) 45%,var(--ws-bg));
--ws-hairline:var(--vscode-contrastBorder,color-mix(in srgb,var(--ws-fg) 12%,transparent));
--ws-border:var(--vscode-contrastBorder,color-mix(in srgb,var(--ws-fg) 20%,transparent));
--ws-surface:color-mix(in srgb,var(--ws-fg) 3.5%,var(--ws-bg));
--ws-surface-2:color-mix(in srgb,var(--ws-fg) 6%,var(--ws-bg));
--ws-code-bg:var(--vscode-textCodeBlock-background,color-mix(in srgb,var(--ws-fg) 6%,var(--ws-bg)));
--ws-hover:var(--vscode-toolbar-hoverBackground,color-mix(in srgb,var(--ws-fg) 9%,transparent));
--ws-pressed:var(--vscode-toolbar-activeBackground,color-mix(in srgb,var(--ws-fg) 14%,transparent));
--ws-accent:var(--vscode-textLink-foreground,light-dark(#0969da,#4daafc));
--ws-accent-hover:var(--vscode-textLink-activeForeground,var(--ws-accent));
--ws-focus:var(--vscode-focusBorder,light-dark(#0969da,#4daafc));
--ws-selection:var(--vscode-editor-selectionBackground,color-mix(in srgb,var(--ws-accent) 30%,transparent));
--ws-error:var(--vscode-errorForeground,light-dark(#cf222e,#f85149));
--ws-menu-bg:var(--vscode-menu-background,var(--vscode-editorWidget-background,var(--ws-bg)));
--ws-menu-fg:var(--vscode-menu-foreground,var(--ws-fg));
--ws-menu-border:var(--vscode-menu-border,var(--vscode-editorWidget-border,var(--ws-border)));
--ws-menu-active:var(--vscode-list-activeSelectionBackground,var(--ws-hover));
--ws-menu-active-fg:var(--vscode-list-activeSelectionForeground,var(--ws-fg));
--ws-shadow:0 6px 24px var(--vscode-widget-shadow,rgba(0,0,0,.18));
--ws-font:var(--vscode-font-family,system-ui,-apple-system,"Segoe UI",sans-serif);
--ws-mono:var(--vscode-editor-font-family,ui-monospace,"SF Mono",Menlo,Consolas,monospace);
--ws-ui-size:13px;--ws-text:15px;--ws-doc-width:760px;
--ws-s1:4px;--ws-s2:8px;--ws-s3:12px;--ws-s4:16px;--ws-s5:24px;--ws-s6:32px;--ws-s7:48px;
--ws-r1:4px;--ws-r2:6px;--ws-r3:8px;
--ws-blue:var(--vscode-editorInfo-foreground,light-dark(#1a7fd4,#3794ff));
--ws-cyan:var(--vscode-terminal-ansiCyan,light-dark(#0f8c99,#29b8db));
--ws-green:var(--vscode-gitDecoration-addedResourceForeground,light-dark(#2b8a3e,#73c991));
--ws-orange:var(--vscode-editorWarning-foreground,light-dark(#bf8803,#cca700));
--ws-red:var(--vscode-editorError-foreground,light-dark(#e51400,#f14c4c));
--ws-purple:var(--vscode-symbolIcon-functionForeground,light-dark(#652d90,#b180d7));
--ws-teal:light-dark(#0b7a6d,#4ec9b0);
--ws-pink:light-dark(#b0215f,#f48fb1);
--ws-indigo:light-dark(#3f51b5,#9fa8ff);
--ws-tok-keyword:var(--vscode-debugTokenExpression-name,light-dark(#8250df,#c586c0));
--ws-tok-string:var(--vscode-debugTokenExpression-string,light-dark(#a31515,#ce9178));
--ws-tok-number:var(--vscode-debugTokenExpression-number,light-dark(#098658,#b5cea8));
--ws-tok-literal:var(--vscode-debugTokenExpression-boolean,light-dark(#0000ff,#569cd6));
--ws-tok-title:var(--vscode-symbolIcon-functionForeground,light-dark(#795e26,#dcdcaa));
--ws-tok-attr:var(--vscode-symbolIcon-variableForeground,light-dark(#0451a5,#9cdcfe));
--ws-tok-comment:color-mix(in srgb,var(--ws-fg) 50%,var(--ws-bg))}
body.vscode-light{color-scheme:light}
body.vscode-dark,body.vscode-high-contrast{color-scheme:dark}
body.vscode-high-contrast-light{color-scheme:light}
::selection{background:var(--ws-selection)}
/* Native <select> popups (notably on Windows) ignore color-scheme and inherit muted text colors:
   give options the dropdown colors of the current theme so every entry is readable. */
select option,select optgroup{background-color:var(--vscode-dropdown-listBackground,var(--vscode-dropdown-background,Canvas));color:var(--vscode-dropdown-foreground,CanvasText)}`;

/** Theme token for each block color preset (see core/rich-blocks.ts). */
export const blockColorToken: Record<BlockColor, string> = {
  blue: '--ws-blue',
  cyan: '--ws-cyan',
  teal: '--ws-teal',
  green: '--ws-green',
  amber: '--ws-orange',
  red: '--ws-red',
  pink: '--ws-pink',
  purple: '--ws-purple',
  indigo: '--ws-indigo',
  gray: '--ws-muted',
};
const calloutIcon: Record<string, IconName> = {
  note: 'note',
  abstract: 'abstract',
  info: 'info',
  tip: 'tip',
  success: 'success',
  question: 'question',
  warning: 'warning',
  failure: 'failure',
  danger: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quoteIcon',
  important: 'important',
};

/** Per-kind color and icon. Studio uses [data-callout], the reader and export use .rich-<kind>. */
export const calloutCss =
  calloutKinds
    .map(
      (kind) =>
        `.doc .rich-${kind},.doc [data-callout="${kind}"]{--c:var(${blockColorToken[defaultBlockColor(kind)]});--c-icon:${iconUrl(calloutIcon[kind])}}`,
    )
    .join('') +
  // Layout blocks get their semantic default too; explicit overrides win over every kind.
  layoutKinds
    .map(
      (kind) =>
        `.doc .rich-${kind},.doc [data-rich="${kind}"]{--c:var(${blockColorToken[defaultBlockColor(kind)]})}`,
    )
    .join('') +
  blockColors
    .map((color) => `.doc [data-color][data-color="${color}"]{--c:var(${blockColorToken[color]})}`)
    .join('');

/** Typography and block styles shared by Studio (`.doc.ProseMirror`) and the reader (`.doc`). */
export const documentCss = `.doc{font-family:var(--ws-font);font-size:var(--ws-text);line-height:1.7;color:var(--ws-fg);overflow-wrap:break-word}
.doc>:first-child{margin-top:0}
.doc h1,.doc h2,.doc h3,.doc h4,.doc h5,.doc h6{line-height:1.3;font-weight:650;letter-spacing:-.005em;scroll-margin-top:72px}
.doc h1{font-size:1.85em;margin:0 0 .7em;letter-spacing:-.015em}
.doc h2{font-size:1.4em;margin:1.9em 0 .55em}
.doc h3{font-size:1.15em;margin:1.6em 0 .45em}
.doc h4{font-size:1em;margin:1.4em 0 .4em}
.doc h5,.doc h6{font-size:.9em;margin:1.3em 0 .4em;color:var(--ws-muted)}
.doc p{margin:.7em 0}
.doc ul,.doc ol{padding-left:1.55em;margin:.6em 0}
.doc li{margin:.2em 0}.doc li>p{margin:.2em 0}
.doc li::marker{color:var(--ws-muted)}
.doc ul[data-type=taskList],.doc ul.contains-task-list{list-style:none;padding-left:.2em}
.doc ul[data-type=taskList] li{display:flex;gap:.55em;align-items:flex-start}
.doc ul[data-type=taskList] li{margin:.1em 0}
.doc ul[data-type=taskList] li>label{flex:none;display:flex;align-items:center;height:1.7em}
.doc ul[data-type=taskList] li>div{flex:1;min-width:0}
.doc ul[data-type=taskList] li>div>p{margin:0}
.doc ul[data-type=taskList] li[data-checked=true]>div{color:var(--ws-muted);text-decoration:line-through;text-decoration-color:var(--ws-faint)}
.doc input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--ws-accent);cursor:pointer}
.doc a{color:var(--ws-accent);text-decoration:none;border-radius:2px}
.doc .code-ref{font-family:var(--ws-mono);font-size:.9em}
.doc :is(p,li,td,th,dd,dt,blockquote,figcaption,.footnotes) a:not(.doc-button):not(.permalink){text-decoration:underline;text-decoration-thickness:1px;text-decoration-color:color-mix(in srgb,currentColor 45%,transparent);text-underline-offset:2px}
.doc a:hover{text-decoration:underline;text-decoration-color:currentColor;text-underline-offset:2px;color:var(--ws-accent-hover)}
.doc a.wiki-link{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
.doc .broken-link{color:var(--ws-error);text-decoration:underline wavy;text-decoration-thickness:1px;text-underline-offset:3px}
.doc strong{font-weight:650}
.doc code{font-family:var(--ws-mono);font-size:.86em;background:var(--ws-code-bg);padding:.12em .38em;border-radius:var(--ws-r1)}
.doc pre{font-family:var(--ws-mono);font-size:13px;line-height:1.55;background:var(--ws-code-bg);border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);padding:12px 16px;margin:1em 0;overflow-x:auto;tab-size:4}
.doc pre code{background:none;padding:0;font-size:inherit;border-radius:0;white-space:pre}
.doc blockquote{margin:1em 0;padding:.1em 0 .1em 1em;border-left:3px solid var(--ws-border);color:var(--ws-muted)}
.doc hr{border:0;border-top:1px solid var(--ws-border);margin:2em 0}
.doc img{max-width:100%;height:auto;border-radius:var(--ws-r1)}
.doc table{border-collapse:collapse;margin:1em 0;font-size:.93em;display:block;max-width:100%;overflow-x:auto;width:max-content}
.doc th,.doc td{border:1px solid var(--ws-hairline);padding:6px 12px;text-align:left;vertical-align:top;min-width:3em}
.doc th{background:var(--ws-surface-2);font-weight:600}
.doc tr:nth-child(2n) td{background:var(--ws-surface)}
.doc td>p,.doc th>p{margin:0}
.doc mark{background:color-mix(in srgb,var(--ws-orange) 30%,transparent);color:inherit;border-radius:2px;padding:0 .1em}
.doc kbd{font-family:var(--ws-mono);font-size:.82em;padding:.1em .4em;border:1px solid var(--ws-border);border-bottom-width:2px;border-radius:var(--ws-r1);background:var(--ws-surface)}
.doc .footnotes{border-top:1px solid var(--ws-hairline);margin-top:2.5em;padding-top:1em;font-size:.9em;color:var(--ws-muted)}
.doc dl dt{font-weight:600}.doc dl dd{margin:0 0 .8em 1.4em}
.doc :where(.callout,[data-callout],.rich-block){--c:var(--ws-muted)}
.doc .callout,.doc [data-callout],.doc .rich-block:not(.rich-grid):not(.rich-gallery):not(.rich-tabs):not(.rich-stepper):not(.rich-timeline):not(.rich-caption):not(.rich-hero){position:relative;margin:1.1em 0;padding:0 14px 1px;border:1px solid color-mix(in srgb,var(--c) 28%,transparent);border-left:3px solid var(--c);border-radius:var(--ws-r2);background:color-mix(in srgb,var(--c) 6%,var(--ws-bg))}
.doc .rich-title,.doc details.rich-block>summary,.doc .callout-head{display:flex;align-items:center;gap:8px;margin:0 -14px;padding:7px 14px;font-weight:600;font-size:.94em;color:var(--ws-fg);background:color-mix(in srgb,var(--c) 10%,transparent);border-radius:0 var(--ws-r2) 0 0}
.doc .callout>.rich-title::before,.doc details.callout>summary::before,.doc .callout-head .callout-icon{content:"";flex:none;width:16px;height:16px;background:var(--c);-webkit-mask:var(--c-icon) center/contain no-repeat;mask:var(--c-icon) center/contain no-repeat}
.doc .rich-content{padding:2px 0}
.doc .rich-content>:first-child{margin-top:.6em}.doc .rich-content>:last-child{margin-bottom:.7em}
.doc details.rich-block>summary{cursor:pointer;list-style:none}
.doc details.rich-block>summary::-webkit-details-marker{display:none}
.doc details.rich-block>summary::after{content:"";margin-left:auto;width:14px;height:14px;background:var(--ws-muted);-webkit-mask:${iconUrl('chevron')} center/contain no-repeat;mask:${iconUrl('chevron')} center/contain no-repeat;transition:transform .15s}
.doc details.rich-block:not([open])>summary{border-radius:0 var(--ws-r2) var(--ws-r2) 0}
.doc details.rich-block:not([open])>summary::after{transform:rotate(-90deg)}
${calloutCss}
.doc .rich-grid,.doc .rich-gallery,.doc .rich-tabs,.doc .rich-stepper,.doc .rich-timeline{margin:1.2em 0}
.doc .rich-grid>.rich-content,.doc .rich-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px}
.doc .rich-grid>.rich-title,.doc .rich-tabs>.rich-title,.doc .rich-stepper>.rich-title,.doc .rich-timeline>.rich-title,.doc .rich-gallery>.rich-title{background:none;margin:0 0 6px;padding:0;font-size:.8em;text-transform:uppercase;letter-spacing:.06em;color:var(--ws-muted);grid-column:1/-1}
.doc .rich-card,.doc .rich-nav-card{border:1px solid color-mix(in srgb,var(--c) 32%,var(--ws-hairline))!important;border-left-width:1px!important;background:var(--ws-surface)!important;border-radius:var(--ws-r3)!important}
.doc .rich-card>.rich-title,.doc .rich-nav-card>.rich-title{background:none}
.doc .rich-nav-card{position:relative;transition:border-color .12s,background .12s}
.doc .rich-nav-card:hover,.doc .rich-nav-card:focus-within{border-color:var(--ws-accent)!important}
.doc .rich-nav-card a{font-weight:600}.doc .rich-nav-card a::after{content:" →"}
.doc .rich-nav-card .rich-content a:first-of-type::before{content:"";position:absolute;inset:0;border-radius:inherit}
.doc .rich-nav-card .rich-content a:first-of-type:focus-visible{outline:none}
.doc .rich-nav-card:focus-within{outline:1px solid var(--ws-focus);outline-offset:2px}
.doc .rich-tab-list{display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--ws-hairline);margin-bottom:4px}
.doc .rich-tab-button{font:inherit;font-size:.92em;color:var(--ws-muted);background:none;border:0;border-bottom:2px solid transparent;padding:6px 12px;margin-bottom:-1px;cursor:pointer;border-radius:var(--ws-r1) var(--ws-r1) 0 0}
.doc .rich-tab-button:hover{color:var(--ws-fg);background:var(--ws-hover)}
.doc .rich-tab-button[aria-selected=true]{color:var(--ws-fg);border-bottom-color:var(--ws-accent);font-weight:600}
.doc .rich-tab-panel{padding:4px 2px}.doc .rich-tab-panel[hidden]{display:none!important}
.doc .rich-stepper>.rich-content,.doc .rich-timeline>.rich-content{counter-reset:ws-step;border-left:2px solid var(--ws-hairline);margin:0 0 0 11px;padding:0 0 0 22px;list-style:none}
.doc .rich-step,.doc .rich-event{margin:0 0 1em}
.doc .rich-step,.doc .rich-event{position:relative;counter-increment:ws-step;--c:var(--ws-accent)!important;border:0!important;background:none!important;padding:0!important}
.doc .rich-step>.rich-title,.doc .rich-event>.rich-title{background:none;margin:0;padding:0}
.doc .rich-step::before{content:counter(ws-step);position:absolute;left:-35px;top:.15em;width:24px;height:24px;border-radius:50%;background:var(--ws-bg);border:2px solid var(--ws-accent);color:var(--ws-accent);font-size:12px;font-weight:700;display:grid;place-items:center;line-height:1}
.doc .rich-event::before{content:"";position:absolute;left:-29px;top:.5em;width:10px;height:10px;border-radius:50%;background:var(--ws-accent);box-shadow:0 0 0 3px var(--ws-bg)}
.doc .rich-caption{margin:1.2em 0;text-align:center}
.doc .rich-caption figcaption,.doc figure figcaption{font-size:.88em;color:var(--ws-muted);margin-top:6px}
.doc .rich-hero{margin:0 0 2em;padding:clamp(20px,5vw,44px);border:1px solid var(--ws-hairline);border-radius:var(--ws-r3);background:linear-gradient(160deg,color-mix(in srgb,var(--ws-accent) 9%,var(--ws-bg)),var(--ws-bg) 70%)}
.doc .rich-hero>.rich-title{display:block;background:none;margin:0 0 .4em;padding:0;font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.15;font-weight:700;letter-spacing:-.02em}
.doc .rich-hero .rich-content{font-size:1.06em;color:var(--ws-muted)}
.doc .rich-hero .rich-content a{display:inline-block;background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff);border-radius:var(--ws-r2);padding:6px 14px;margin:6px 8px 0 0;font-weight:600;text-decoration:none}
.doc .code-block{position:relative;margin:1em 0}
.doc .code-block pre{margin:0}
.doc .code-title{font-family:var(--ws-mono);font-size:12px;color:var(--ws-muted);padding:6px 16px;background:var(--ws-surface-2);border:1px solid var(--ws-hairline);border-bottom:0;border-radius:var(--ws-r2) var(--ws-r2) 0 0}
.doc .code-title+.copy-code+pre,.doc .code-title~pre{border-top-left-radius:0;border-top-right-radius:0}
.doc .copy-code{position:absolute;top:6px;right:6px;z-index:1;opacity:0;font:12px var(--ws-font);color:var(--ws-muted);background:var(--ws-bg);border:1px solid var(--ws-hairline);border-radius:var(--ws-r1);padding:2px 8px;cursor:pointer;transition:opacity .12s}
.doc .code-title+.copy-code{top:2px}
.doc .code-block:hover .copy-code,.doc .copy-code:focus-visible{opacity:1}
.doc .code-line{display:block;white-space:pre}
.doc .code-line[data-line]::before{content:attr(data-line);display:inline-block;min-width:3ch;margin-right:1.2em;text-align:right;color:var(--ws-faint);user-select:none}
.doc .code-line.highlighted{background:color-mix(in srgb,var(--ws-orange) 16%,transparent);margin:0 -16px;padding:0 16px}
.doc .hljs-keyword,.doc .hljs-selector-tag,.doc .hljs-built_in,.doc .hljs-meta .hljs-keyword{color:var(--ws-tok-keyword)}
.doc .hljs-string,.doc .hljs-regexp,.doc .hljs-template-string{color:var(--ws-tok-string)}
.doc .hljs-number{color:var(--ws-tok-number)}
.doc .hljs-literal,.doc .hljs-type,.doc .hljs-tag .hljs-name,.doc .hljs-name{color:var(--ws-tok-literal)}
.doc .hljs-title,.doc .hljs-title.function_,.doc .hljs-section{color:var(--ws-tok-title)}
.doc .hljs-attr,.doc .hljs-attribute,.doc .hljs-variable,.doc .hljs-params,.doc .hljs-property{color:var(--ws-tok-attr)}
.doc .hljs-comment,.doc .hljs-quote{color:var(--ws-tok-comment);font-style:italic}
.doc .hljs-deletion{color:var(--ws-red)}.doc .hljs-addition{color:var(--ws-green)}
.doc .diagram{margin:1.1em 0;padding:16px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface);overflow:auto;text-align:center;position:relative}
.doc .diagram svg,.doc .diagram img{max-width:100%;height:auto;display:inline-block;vertical-align:top}
.doc .diagram[data-diagram-zoom]{cursor:zoom-in}.doc .diagram.actual-size{cursor:zoom-out;text-align:left}
.doc .diagram.actual-size svg,.doc .diagram.actual-size img{max-width:none}
.doc .diagram svg{--bg:var(--ws-surface);--fg:var(--ws-fg);--accent:var(--ws-accent);--line:color-mix(in srgb,var(--ws-fg) 55%,var(--ws-surface));--surface:var(--ws-bg);--border:var(--ws-border);--muted:var(--ws-muted)}
.doc .diagram svg text{font-family:var(--ws-font)}
.doc .diagram-error{color:var(--ws-error);font-size:.85em;margin:0 0 6px}
.doc .diagram figcaption{margin:0}
.doc .collection{margin:1em 0;padding:10px 14px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
.doc .collection-title{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ws-muted);margin-bottom:6px}
.doc .collection-list{list-style:none;padding:0;margin:0}
.doc .collection-list li{margin:.25em 0}
.doc .collection-list li.done{color:var(--ws-muted)}
.doc .collection-list input{margin-right:6px;vertical-align:-2px}
.doc .task-meta,.doc .task-due{font-size:.8em;color:var(--ws-muted);background:var(--ws-surface-2);border-radius:999px;padding:0 .5em}
.doc .task-due.overdue{color:var(--ws-red)}
.doc .task-page{font-size:.85em;color:var(--ws-muted)}
.doc .collection-table{width:100%;display:table;margin:0}
.doc .collection-board{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:8px;overflow-x:auto}
.doc .collection-column h4{margin:0 0 6px;font-size:.85em}
.doc .collection-card{background:var(--ws-bg);border:1px solid var(--ws-hairline);border-radius:var(--ws-r1);padding:6px 8px;margin-bottom:6px;font-size:.92em}
.doc .collection-board.interactive .collection-column{border-radius:var(--ws-r1);padding:4px;transition:background .12s}
.doc .collection-board.interactive .collection-cards{min-height:36px}
.doc .collection-board.interactive .collection-card{cursor:grab;user-select:none}
.doc .collection-board.interactive .collection-card:hover{border-color:var(--ws-border-strong,var(--ws-muted))}
.doc .collection-board.interactive .collection-card:focus-visible{outline:2px solid var(--ws-accent);outline-offset:1px}
.doc .collection-card.dragging{opacity:.45}
.doc .collection-card.saving{border-style:dashed}
.doc .collection-column.drop-target{background:color-mix(in srgb,var(--ws-accent) 12%,transparent);outline:1px dashed var(--ws-accent)}
.doc .collection-help{font-size:.82em;margin:6px 0 0}
.doc .collection-status:empty{display:none}
.doc .collection-status{font-size:.82em;margin:2px 0 0;color:var(--ws-muted)}
.doc .collection-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.doc .collection-tile{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-bg);text-decoration:none!important;color:var(--ws-fg)}
.doc .collection-tile span{font-size:.85em;color:var(--ws-muted)}
.doc .collection-tile:hover{border-color:var(--ws-accent)}
.doc .math-block{overflow-x:auto;margin:1em 0}
.doc .doc-badge{display:inline-block;background:var(--ws-surface-2);border:1px solid var(--ws-hairline);border-radius:999px;padding:0 .55em;font-size:.82em;line-height:1.6}
.doc .doc-button{display:inline-block;background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff);padding:5px 12px;border-radius:var(--ws-r2);font-weight:600;text-decoration:none}
.doc .doc-tip{text-decoration:underline dotted;cursor:help}
.doc .permalink{margin-left:.4em;font-size:.7em;color:var(--ws-faint);opacity:0;text-decoration:none;transition:opacity .12s}
.doc h1:hover .permalink,.doc h2:hover .permalink,.doc h3:hover .permalink,.doc h4:hover .permalink,.doc .permalink:focus-visible{opacity:1}
.doc video,.doc audio{display:block;max-width:100%;margin:1em 0}
.doc .image-placeholder{color:var(--ws-muted);font-style:italic}
.doc .tag{display:inline-block;font-size:.8em;padding:1px 8px;border-radius:999px;background:var(--ws-surface-2);color:var(--ws-muted);margin:0 4px 4px 0}
.doc a:focus-visible,.doc button:focus-visible,.doc summary:focus-visible{outline:1px solid var(--ws-focus);outline-offset:2px}`;

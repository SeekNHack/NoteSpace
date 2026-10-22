import { tokensCss } from './core/design';

/** Workspace panel styles, built on the shared design tokens (VS Code theme colors). */
export const plannerCss = `${tokensCss}
:root{--bc-gray:var(--ws-muted);--bc-blue:var(--ws-blue);--bc-cyan:var(--ws-cyan);--bc-teal:var(--ws-teal);--bc-green:var(--ws-green);--bc-amber:var(--ws-orange);--bc-orange:var(--ws-orange);--bc-red:var(--ws-red);--bc-pink:var(--ws-pink);--bc-purple:var(--ws-purple)}
*{box-sizing:border-box}[hidden]{display:none!important}
body{--brand:var(--ws-accent)}
html,body{margin:0;padding:0;background:var(--ws-bg);color:var(--ws-fg);font:var(--ws-ui-size)/1.45 var(--ws-font)}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:1px solid var(--ws-focus);outline-offset:-1px}
.icon{display:inline-block;vertical-align:-3px;flex:none}
.spacer{flex:1}.muted{color:var(--ws-muted)}.small{font-size:12px}
.badge{font-size:11px;line-height:16px;min-width:16px;padding:0 5px;border-radius:999px;background:var(--ws-accent);color:var(--vscode-button-foreground,#fff);text-align:center}
/* Controls */
.field{height:28px;padding:0 8px;border-radius:var(--ws-r1);border:1px solid var(--vscode-input-border,var(--ws-border));background:var(--vscode-input-background,var(--ws-bg));color:var(--vscode-input-foreground,var(--ws-fg));min-width:0}
.field:focus{outline:1px solid var(--ws-focus);border-color:var(--ws-focus)}
.quick{flex:1;min-width:200px}
.btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:var(--ws-r1);border:1px solid transparent;background:var(--vscode-button-secondaryBackground,var(--ws-surface-2));color:var(--vscode-button-secondaryForeground,var(--ws-fg));cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--vscode-button-secondaryHoverBackground,var(--ws-hover))}
.btn:disabled,.btn[disabled]{opacity:.5;cursor:default}
.btn.primary{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff)}
.btn.primary:hover{background:var(--vscode-button-hoverBackground,var(--ws-accent-hover))}
.btn.ghost{background:none;color:var(--ws-muted)}.btn.ghost:hover{background:var(--ws-hover);color:var(--ws-fg)}
.btn.small{height:24px;padding:0 8px;font-size:12px}
.btn.icon-only{padding:0 6px;width:28px;justify-content:center}
.btn.danger{color:var(--ws-red)}
.flip svg{transform:rotate(180deg)}
.link{border:0;background:none;padding:0;color:var(--vscode-textLink-foreground,var(--ws-accent));cursor:pointer;text-align:left}
.link:hover{text-decoration:underline}
.segmented{display:inline-flex;gap:2px}.segmented .btn[aria-pressed=true]{background:var(--ws-pressed);color:var(--ws-fg)}
.tabs{display:flex;gap:2px;flex-wrap:wrap}
.tabs button{border:0;background:none;color:var(--ws-muted);padding:5px 10px;border-radius:var(--ws-r1);cursor:pointer}
.tabs button:hover{background:var(--ws-hover);color:var(--ws-fg)}
.tabs button[aria-selected=true]{background:var(--ws-pressed);color:var(--ws-fg);font-weight:600}
.tabs .count{font-size:11px;margin-left:4px;color:var(--ws-muted)}.tabs .count.alert{color:var(--ws-red)}
.bar{display:flex;align-items:center;gap:8px;padding:0 0 8px;flex-wrap:wrap}
.filters{display:flex;gap:6px;padding:0 0 10px;flex-wrap:wrap;align-items:center}
.filters select,.filters input{max-width:170px}
.section-head{display:flex;align-items:center;gap:8px;margin:4px 0 16px}.section-head h2{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0}
.sub-head{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ws-muted);margin:16px 0 8px}
.notice{padding:6px 10px;border-radius:var(--ws-r1);background:var(--ws-surface);border:1px solid var(--ws-hairline)}
/* Layout */
.layout{display:grid;grid-template-columns:minmax(0,1fr)}
.layout.with-detail{grid-template-columns:minmax(0,1fr) 320px}
.main{padding:16px 24px 48px;min-width:0;width:100%;max-width:1320px;margin:0 auto}
.main.dest-wiki,.main.dest-board{max-width:none}
.empty{padding:16px;border:1px dashed var(--ws-border);border-radius:var(--ws-r2);color:var(--ws-muted);text-align:center}
.empty p{margin:0 0 8px}.empty-actions{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}
/* Task rows */
.group{margin:0 0 16px}
.group h2,.home-card h3{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ws-muted);margin:0 0 4px}
.group h2.alert,.home-card h3.alert{color:var(--ws-red)}
.group .count{font-weight:400}
.rows{list-style:none;margin:0;padding:0}
.row{display:flex;align-items:center;gap:8px;min-height:32px;padding:3px 6px;border-radius:var(--ws-r1);cursor:pointer}
.row:hover{background:var(--ws-hover)}
.row[aria-current=true]{background:var(--ws-menu-active);color:var(--ws-menu-active-fg)}
.row input[type=checkbox],.card input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--ws-accent);cursor:pointer;flex:none}
.row .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text}
.row.done .title{color:var(--ws-muted);text-decoration:line-through}
.row .more{opacity:0}.row:hover .more,.row:focus-within .more{opacity:1}
.inline-edit{flex:1;width:100%}
.chips{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;flex:none;max-width:55%}
.chip{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;line-height:18px;padding:0 7px;border-radius:999px;background:var(--ws-surface-2);color:var(--ws-muted);white-space:nowrap}
.chip.overdue{color:var(--ws-fg);box-shadow:inset 0 0 0 1px var(--ws-red)}.chip.overdue .icon{color:var(--ws-red)}
.chip.today{color:var(--ws-fg);box-shadow:inset 0 0 0 1px var(--ws-accent)}
.chip.high,.chip.medium,.chip.low{color:var(--ws-fg)}
.chip.high::before,.chip.medium::before,.chip.low::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ws-red)}
.chip.medium::before{background:var(--ws-orange)}.chip.low::before{background:var(--ws-blue)}
.chip.page{background:none;padding:0 2px;color:var(--ws-fg)}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--ws-hairline);white-space:nowrap}
th{color:var(--ws-muted);font-weight:600;cursor:pointer;user-select:none}
th[aria-sort]:after{content:' ↑'}th[aria-sort=descending]:after{content:' ↓'}
td.title{white-space:normal;min-width:200px}
tbody tr{cursor:pointer}tbody tr:hover{background:var(--ws-hover)}
/* Detail panel */
.detail{border-left:1px solid var(--ws-hairline);padding:12px 14px;position:sticky;top:var(--top,41px);align-self:start;max-height:calc(100vh - var(--top,41px));overflow:auto}
.detail h2{font-size:13px;margin:0 0 6px;display:flex;align-items:center}
.detail label{display:block;font-size:11px;color:var(--ws-muted);margin:10px 0 3px;text-transform:uppercase;letter-spacing:.05em}
.detail .field{width:100%}
.detail .desc{white-space:pre-wrap;color:var(--ws-muted);font-size:12.5px;background:var(--ws-surface);border-radius:var(--ws-r1);padding:6px 8px;margin:0}
.detail .actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}
.detail-boards{display:flex;flex-direction:column;gap:6px}
.board-line{display:grid;grid-template-columns:1fr 130px;gap:6px;align-items:center;font-size:12.5px}
/* Home */
.home-card{border:1px solid var(--ws-hairline);border-radius:10px;padding:14px 16px;background:var(--ws-surface);min-width:0;transition:border-color .15s}
.home-card:hover{border-color:var(--ws-border)}
.home-card-head{display:flex;align-items:center;gap:6px;margin:0 0 6px}
.home-card h2{font-size:13px;margin:0}
.home-card h3{margin:10px 0 4px}
.home-card .rows .row{min-height:28px}
.home-card .quick{width:100%;margin:6px 0}
.progress-line{display:flex;align-items:center;gap:8px}
.progress{flex:1;height:6px;border-radius:999px;background:var(--ws-surface-2);overflow:hidden}
.progress span{display:block;height:100%;background:var(--ws-green)}
.cal-preview{display:grid;grid-template-columns:auto 1fr;gap:12px}
.mini-month{display:grid;grid-template-columns:repeat(7,30px);gap:2px}
.mini-month .dow{font-size:10.5px;color:var(--ws-muted);text-align:center}
.mini-day{position:relative;height:30px;border:0;border-radius:var(--ws-r1);background:none;cursor:pointer;font-size:12px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.mini-day:hover{background:var(--ws-hover)}.mini-day.other{color:var(--ws-muted)}
.mini-day.today span:first-child{color:var(--ws-accent);font-weight:700}
.mini-day.selected{background:var(--ws-pressed);font-weight:600}
.mini-day .dots{display:flex;gap:2px;position:absolute;bottom:3px}
.mini-day .dots i{width:4px;height:4px;border-radius:50%;background:var(--ws-accent)}.mini-day .dots i.note{background:var(--ws-green)}
.cal-day h3{text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--ws-fg)}
.compact-list{list-style:none;margin:0 0 6px;padding:0;font-size:12.5px}.compact-list li{padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.page-list{list-style:none;margin:0;padding:0}
.page-line{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:4px 6px;border-radius:var(--ws-r1);cursor:pointer;text-align:left;font-size:12.5px;min-width:0}
.page-line:hover{background:var(--ws-hover)}
.page-line .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.page-line .muted{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Home rows wrap their details under the title in narrow cards. */
.home-card .row{flex-wrap:wrap;row-gap:2px}
.home-card .row .title{flex:1 1 60%}
.home-card .row .chips{order:3;width:100%;max-width:none;justify-content:flex-start;padding-left:23px}
.home-card .board-card h3{text-transform:none;letter-spacing:0;font-size:13px;color:var(--ws-fg);margin:0}
.cal-day{min-width:0}.cal-day .link{white-space:normal}
/* Boards */
.board-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.board-grid.small{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.board-card{position:relative;border:1px solid var(--ws-hairline);border-left:3px solid var(--c);border-radius:var(--ws-r2);padding:8px 10px;background:var(--ws-bg);min-width:0}
.board-card:hover{border-color:var(--ws-border);border-left-color:var(--c)}
.board-card.archived{opacity:.7}
.board-card-head{display:flex;align-items:center;gap:6px;padding-right:56px}
.board-card h3{font-size:13px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.board-card h3 a{color:inherit;text-decoration:none}.board-card h3 a:hover{text-decoration:underline}
.board-card h3 a::after{content:"";position:absolute;inset:0}
.board-card .desc{margin:4px 0 0;font-size:12px;color:var(--ws-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.board-card .meta{margin:4px 0 0;font-size:12px;color:var(--ws-muted)}
.board-card-actions{position:absolute;top:4px;right:4px;display:flex;z-index:1}
.board-card-actions [aria-pressed=true]{color:var(--ws-orange)}
.board-icon{color:var(--c);display:inline-flex}
.archived-boards{margin-top:16px}.archived-boards summary{cursor:pointer;color:var(--ws-muted);margin-bottom:8px}
.board-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.board-switcher{font-weight:600;max-width:240px}
.board-meta{color:var(--ws-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px}
.board-head .field[type=search]{width:150px}
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:10px;overflow-x:auto;padding-bottom:8px;align-items:start}
.lane-title{font-size:12px;font-weight:600;color:var(--ws-muted);margin:12px 0 6px}
.board-hint{color:var(--ws-muted);font-size:12.5px;margin:8px 0}
.column{background:var(--ws-surface);border:1px solid var(--ws-hairline);border-top:3px solid var(--c);border-radius:var(--ws-r2);padding:6px;display:flex;flex-direction:column;gap:6px;min-height:110px}
.column.drop{outline:2px dashed var(--ws-focus);outline-offset:-2px}
.column header{display:flex;align-items:center;gap:6px;font-weight:600;padding:2px 2px 2px 0;min-height:26px}
.column header .grip{cursor:grab;color:var(--ws-faint);display:inline-flex}
.col-dot{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
.col-title{cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.column header .count{color:var(--ws-muted);font-weight:400}
.done-mark{color:var(--ws-green);display:inline-flex}
.default-mark{font-size:10.5px;font-weight:400;color:var(--ws-muted);border:1px solid var(--ws-hairline);border-radius:999px;padding:0 5px}
.cards{display:flex;flex-direction:column;gap:6px;min-height:8px}
.col-empty{margin:4px 2px;font-size:12px;color:var(--ws-muted)}
.card{background:var(--ws-bg);border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);padding:7px 8px;cursor:grab;display:flex;flex-direction:column;gap:5px}
.card:hover{border-color:var(--ws-border)}
.card[aria-current=true]{border-color:var(--ws-focus)}
.card.dragging{opacity:.45}
.card.drop-before{box-shadow:0 -3px 0 var(--ws-focus)}.card.drop-after{box-shadow:0 3px 0 var(--ws-focus)}
.card.done .card-title{color:var(--ws-muted);text-decoration:line-through}
.card-top{display:flex;align-items:flex-start;gap:6px}
.card-title{flex:1;min-width:0;cursor:text;overflow-wrap:anywhere}
.card-quick{display:flex;opacity:0;margin:-3px -4px 0 0}.card:hover .card-quick,.card:focus-within .card-quick{opacity:1}
.card-quick .btn{height:22px;width:22px;padding:0}
.card-desc{margin:0;font-size:12px;color:var(--ws-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .chips{justify-content:flex-start;max-width:none}
.card.compact{padding:5px 8px;gap:3px}
.column .add{margin-top:auto}
.col-preview{display:flex;gap:4px;flex-wrap:wrap;margin:-4px 0 8px}
.col-pill{font-size:11.5px;padding:1px 8px;border-radius:999px;border:1px solid var(--c);color:var(--ws-fg)}
/* Calendar */
.cal-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.cal-head h2{font-size:15px;margin:0 8px 0 0;min-width:140px}
.month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--ws-hairline);border-left:1px solid var(--ws-hairline)}
.month .dow{padding:4px 6px;font-size:11px;color:var(--ws-muted);text-transform:uppercase;border-right:1px solid var(--ws-hairline);border-bottom:1px solid var(--ws-hairline);background:var(--ws-surface)}
.day{min-height:88px;padding:3px 4px;border-right:1px solid var(--ws-hairline);border-bottom:1px solid var(--ws-hairline);display:flex;flex-direction:column;gap:2px;min-width:0}
.day:hover{background:var(--ws-hover)}.day.other{color:var(--ws-faint)}
.day .head{display:flex;align-items:center;gap:4px}
.day .num{border:0;background:none;font-size:12px;font-weight:600;padding:0 5px;border-radius:999px;cursor:pointer}
.day.today .num{background:var(--ws-accent);color:var(--vscode-button-foreground,#fff)}
.day .add-day{margin-left:auto;border:0;background:none;color:var(--ws-muted);cursor:pointer;opacity:0;padding:0 4px}
.day:hover .add-day,.day:focus-within .add-day{opacity:1}
.day.drop{outline:2px dashed var(--ws-focus);outline-offset:-2px}
.day .note{width:7px;height:7px;border-radius:50%;background:var(--ws-green)}
.day .item{display:block;width:100%;border:0;text-align:left;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:3px;padding:0 4px;background:var(--ws-surface-2);cursor:pointer}
.day .item.done{text-decoration:line-through;color:var(--ws-muted)}.day .item.overdue{color:var(--ws-red)}.day .item.start{background:none;box-shadow:inset 0 0 0 1px var(--ws-hairline)}
.day .more{font-size:11px;color:var(--ws-muted)}
.week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.week .col{border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);min-height:200px;padding:6px;min-width:0}
.week .col.today{border-color:var(--ws-accent)}
.week .col h3{font-size:12px;margin:0 0 6px;display:flex;justify-content:space-between;align-items:center;gap:4px}
.week .col .row{min-height:26px;padding:2px 4px}.week .col .row .chips,.week .col .row .more{display:none}
/* Insights */
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.tile{padding:14px 16px;border:1px solid var(--ws-hairline);border-radius:10px;background:var(--ws-surface)}
.tile strong{display:block;font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.25;font-variant-numeric:tabular-nums}.tile span{color:var(--ws-muted);font-size:12px}
.tile.good strong{color:var(--ws-green)}.tile.warn strong{color:var(--ws-orange)}.tile.bad strong{color:var(--ws-red)}
/* Menus and dialogs */
.menu{position:fixed;z-index:50;min-width:180px;max-width:320px;padding:4px;background:var(--ws-menu-bg);color:var(--ws-menu-fg);border:1px solid var(--ws-menu-border);border-radius:6px;box-shadow:var(--ws-shadow)}
.menu .item{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:5px 8px;border-radius:4px;text-align:left;cursor:pointer;color:inherit}
.menu .item:hover,.menu .item:focus{background:var(--ws-menu-active);color:var(--ws-menu-active-fg);outline:none}
.menu .item:disabled{opacity:.5;cursor:default}
.menu .item.danger{color:var(--ws-red)}
.menu .item[aria-checked=true]::after{content:"✓";margin-left:auto}
.menu .gap{width:14px;flex:none}.menu .sub{margin-left:auto}
.menu .sep{height:1px;background:var(--ws-menu-border);margin:4px 2px}
.modal-back{position:fixed;inset:0;z-index:40;background:color-mix(in srgb,var(--ws-bg) 60%,transparent);display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px}
.modal{width:min(440px,100%);background:var(--ws-menu-bg);color:var(--ws-menu-fg);border:1px solid var(--ws-menu-border);border-radius:8px;box-shadow:var(--ws-shadow);padding:14px 16px}
.modal h2{font-size:14px;margin:0 0 10px}
.modal p{margin:0 0 10px;font-size:12.5px}
.form-row{display:flex;flex-direction:column;gap:3px;margin:0 0 10px}
.form-row label{font-size:12px;color:var(--ws-muted)}
.form-row small{font-size:11.5px;color:var(--ws-muted)}
.modal .warn{display:block;color:var(--ws-red);margin:-6px 0 8px;min-height:0}
.modal .check{display:flex;align-items:center;gap:6px;font-size:12.5px;margin:0 0 10px}
.modal-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
.toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--ws-menu-bg);border:1px solid var(--ws-menu-border);box-shadow:var(--ws-shadow);padding:8px 14px;border-radius:var(--ws-r2);z-index:60;max-width:90vw}
.toast.error{border-color:var(--ws-red)}
/* Narrow editors collapse secondary controls instead of squeezing content. */
@media(max-width:900px){.layout.with-detail{grid-template-columns:minmax(0,1fr)}.detail{position:static;border-left:0;border-top:1px solid var(--ws-hairline);max-height:none}.chips{max-width:45%}.board-meta{display:none}}
@media(max-width:700px){.nav-item .label{display:none}.home-head .search{width:100%;order:3}.cal-preview{grid-template-columns:1fr}.board-head .field[aria-label="Card density"],.board-head .field[aria-label="Card order"],.board-head .field[aria-label=Swimlanes]{display:none}.filters select{display:none}}
@media(max-width:560px){.week{grid-template-columns:1fr}.day{min-height:56px}.day .item{display:none}.chips .chip.page,.chips .chip.tag{display:none}.main{padding:10px 10px 32px}.home-grid{grid-template-columns:1fr}}
/* Header, as on a documentation site: the wiki's name and search
   on top, the sections as tabs, a section's pages as a third row. --brand is the wiki's color. */
.top{position:sticky;top:0;z-index:6;background:var(--ws-bg);border-bottom:1px solid var(--ws-hairline)}
.nav{display:block}
.header-bar{display:flex;align-items:center;gap:8px;height:48px;padding:0 16px 0 10px}
.history{display:inline-flex;gap:0}
.history .btn[disabled]{opacity:.35;cursor:default;background:none}
.brand{display:inline-flex;align-items:center;gap:10px;min-width:0;border:0;background:none;padding:4px 8px 4px 4px;border-radius:var(--ws-r2);cursor:pointer;color:var(--ws-fg)}
.brand:hover{background:var(--ws-hover)}
.brand-mark{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:8px;color:var(--brand);background:color-mix(in srgb,var(--brand) 16%,transparent)}
.brand-name{font-size:15px;font-weight:650;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiki-switch{max-width:180px}
.finder-button{display:inline-flex;align-items:center;gap:8px;width:min(280px,32vw);height:32px;padding:0 6px 0 10px;border:1px solid var(--ws-hairline);border-radius:8px;background:var(--ws-surface);color:var(--ws-muted);cursor:pointer;text-align:left}
.finder-button:hover{border-color:var(--ws-border);color:var(--ws-fg)}
.finder-button .label{flex:1}
.finder-button kbd,.finder kbd{font:11px/16px var(--ws-font);padding:0 6px;border:1px solid var(--ws-hairline);border-radius:4px;background:var(--ws-bg);color:var(--ws-muted)}
.section-tabs{display:flex;align-items:stretch;gap:2px;height:38px;padding:0 12px;overflow-x:auto;scrollbar-width:none}
.section-tabs>.btn{align-self:center;margin-right:4px}
.nav-item{display:inline-flex;align-items:center;gap:7px;border:0;background:none;color:var(--ws-muted);padding:0 12px;cursor:pointer;white-space:nowrap;box-shadow:inset 0 -2px 0 transparent;border-radius:0}
.nav-item:hover{color:var(--ws-fg)}
.nav-item[aria-current=page]{color:var(--ws-fg);font-weight:600;box-shadow:inset 0 -2px 0 var(--brand)}
.nav-item[aria-current=page] .icon{color:var(--brand)}
.subnav{display:flex;align-items:center;gap:4px;padding:6px 16px;border-top:1px solid var(--ws-hairline);background:var(--ws-surface);overflow-x:auto}
.subnav-item{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:none;color:var(--ws-muted);padding:3px 12px;border-radius:999px;cursor:pointer;white-space:nowrap;font-size:12.5px}
.subnav-item:hover{color:var(--ws-fg);background:var(--ws-hover)}
.subnav-item[aria-current=page]{color:var(--ws-fg);font-weight:600;background:var(--ws-bg);border-color:var(--ws-hairline)}
@media(max-width:900px){.finder-button{width:32px;padding:0;justify-content:center}.finder-button .label,.finder-button kbd{display:none}}
@media(max-width:560px){.brand-name{display:none}.header-bar{padding:0 8px 0 4px}}
/* Wiki: navigation on the left, the page, its outline on the right */
.main.dest-wiki{padding:0}
.wiki{display:grid;grid-template-columns:272px minmax(0,1fr) 232px;align-items:start;min-height:calc(100vh - var(--top,41px));max-width:1440px;margin:0 auto}
.wiki.nav-hidden{grid-template-columns:minmax(0,1fr) 232px}
.wiki.nav-hidden .wiki-nav{display:none}
.wiki-nav{position:sticky;top:var(--top,41px);max-height:calc(100vh - var(--top,41px));overflow:auto;padding:20px 12px 32px 16px;font-size:13.5px;scrollbar-width:thin}
.wiki-side-head{display:flex;align-items:center;gap:0;margin:0 0 10px;padding-left:8px}
.wiki-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650;color:var(--ws-fg)}
.wiki-side-head .btn{width:24px;height:24px;color:var(--ws-muted)}
.wiki-nav>.field{width:100%;height:30px;margin:0 0 14px;border-radius:8px;background:var(--ws-surface);border-color:var(--ws-hairline)}
.wiki-tree{list-style:none;margin:0;padding:0}
.wiki-tree .wiki-tree{padding-left:12px}
.wiki-tree>li{margin:1px 0}
.wiki-node{display:flex;align-items:center;gap:4px;width:100%;min-height:28px;border-radius:6px}
.wiki-node.page{border:0;background:none;padding:4px 8px;text-align:left;cursor:pointer;color:var(--ws-muted)}
.wiki-node.page:hover,.wiki-node.section .wiki-link:hover{color:var(--ws-accent)}
.wiki-node.page span:first-child,.wiki-node.page svg+span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiki-node.page.current{color:var(--ws-accent);font-weight:600;background:color-mix(in srgb,var(--ws-accent) 9%,transparent)}
.wiki-node.section{padding-right:2px}
.wiki-node.section .wiki-link{flex:1;min-width:0;border:0;background:none;padding:4px 8px;text-align:left;cursor:pointer;font-weight:600;color:var(--ws-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiki-node.section.current{background:color-mix(in srgb,var(--ws-accent) 9%,transparent)}
.wiki-node.section.current .wiki-link{color:var(--ws-accent)}
.twisty{order:2;display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border:0;background:none;padding:0;color:var(--ws-muted);cursor:pointer;border-radius:4px}
.twisty:hover{color:var(--ws-fg);background:var(--ws-hover)}
.wiki-group{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ws-muted);margin:0 0 4px 8px}
.wiki-favorites{margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid var(--ws-hairline)}
.wiki-favorites .wiki-node.page{gap:8px}
.wiki-favorites .icon{color:var(--ws-orange)}
.wiki-node.file{gap:8px}
.wiki-node.drop,.wiki-name.drop{outline:1px dashed var(--ws-accent);background:color-mix(in srgb,var(--ws-accent) 10%,transparent)}
.wiki-content{min-width:0;padding:20px 48px 64px;max-width:calc(var(--ws-doc-width,760px) + 96px);width:100%;justify-self:center}
.wiki-head{display:flex;align-items:center;gap:2px;min-height:28px;margin:0 0 14px}
.wiki-head .btn{color:var(--ws-muted)}.wiki-head .btn:hover{color:var(--ws-accent)}
.wiki-crumbs{display:flex;align-items:center;gap:4px;min-width:0;flex-wrap:wrap;color:var(--ws-muted);font-size:12.5px}
.wiki-crumbs .icon{opacity:.6}
.wiki-crumbs .crumb{border:0;background:none;padding:0;color:var(--ws-muted);cursor:pointer}.wiki-crumbs .crumb:hover{color:var(--ws-accent)}
.wiki .wiki-article{font-size:var(--ws-text)}
.wiki .wiki-article :is(h1,h2,h3,h4,h5,h6){scroll-margin-top:calc(var(--top,41px) + 16px)}
.wiki .wiki-article h1{font-size:2.1em;font-weight:700;letter-spacing:-.025em;margin:0 0 .8em}
.wiki .wiki-article h2{font-size:1.5em;font-weight:650;letter-spacing:-.015em;margin-top:2em}
.wiki .wiki-article h3{font-size:1.2em;font-weight:650}
.wiki .wiki-article a{color:var(--ws-accent);text-decoration:none}.wiki-article a:hover{text-decoration:underline}
.wiki .wiki-article img{max-width:100%;border-radius:6px}
.wiki .wiki-article>.tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.wiki .wiki-article>.tags .tag{font-size:12px;padding:1px 10px;border-radius:999px;background:var(--ws-surface-2);color:var(--ws-muted)}
.wiki-updated{display:flex;align-items:center;gap:6px;margin:40px 0 0;color:var(--ws-muted);font-size:12.5px}
.wiki-backlinks{margin:16px 0 0;padding-top:16px;border-top:1px solid var(--ws-hairline);font-size:13px}
.wiki-backlinks h2{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ws-muted);margin:0 0 10px}
.wiki-backlinks ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.wiki-backlinks p{margin:0}
.chip-link{padding:3px 12px;border:1px solid var(--ws-hairline);border-radius:999px;background:none;cursor:pointer;color:var(--ws-fg)}.chip-link:hover{border-color:var(--ws-accent);color:var(--ws-accent)}
.wiki-pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:32px 0 0}
.wiki-pager .pager{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--ws-hairline);border-radius:10px;background:none;text-align:left;cursor:pointer;color:var(--ws-fg);min-width:0}
.wiki-pager .pager>span{min-width:0}
.wiki-pager .pager:hover{border-color:var(--ws-accent)}.wiki-pager .pager:hover .icon,.wiki-pager .pager:hover .title{color:var(--ws-accent)}
.wiki-pager .pager .icon{color:var(--ws-muted)}
.wiki-pager .pager small{display:block;color:var(--ws-muted);font-size:12px}
.wiki-pager .pager .title{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiki-pager .next{grid-column:2;flex-direction:row-reverse;text-align:right}
.wiki-toc{position:sticky;top:var(--top,41px);max-height:calc(100vh - var(--top,41px));overflow:auto;padding:24px 16px 32px 8px;font-size:12.5px;scrollbar-width:thin}
.wiki-toc strong{display:block;margin:0 0 10px;font-size:12.5px;font-weight:650;color:var(--ws-fg)}
.wiki-toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--ws-hairline)}
.wiki-toc a{display:block;margin-left:-1px;padding:3px 0 3px 12px;border-left:2px solid transparent;color:var(--ws-muted);text-decoration:none;line-height:1.4}
.wiki-toc a:hover{color:var(--ws-fg)}
.wiki-toc a.active{color:var(--ws-accent);border-left-color:var(--ws-accent)}
.wiki-toc .toc-3{padding-left:24px}.wiki-toc .toc-4{padding-left:36px}
@media(max-width:1100px){.wiki{grid-template-columns:240px minmax(0,1fr) 200px}.wiki.nav-hidden{grid-template-columns:minmax(0,1fr) 200px}.wiki-content{padding:20px 32px 56px}}
@media(max-width:960px){.wiki,.wiki.no-toc{grid-template-columns:240px minmax(0,1fr)}.wiki.nav-hidden,.wiki.nav-hidden.no-toc{grid-template-columns:minmax(0,1fr)}.wiki-toc{display:none}}
@media(max-width:720px){.wiki{grid-template-columns:minmax(0,1fr)!important}.wiki-nav{position:static;max-height:none;border-bottom:1px solid var(--ws-hairline)}.wiki-content{padding:16px 16px 40px}.nav .label{display:none}.wiki-pager{grid-template-columns:1fr}.wiki-pager .next{grid-column:1}}
/* Home: a landing page (greeting, search, today's numbers), then two columns */
.main.dest-home{max-width:1180px;padding-top:28px}
.home-head{margin:0 0 24px}
.home-hero{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:0 0 18px}
.home-title{flex:1;min-width:240px}
.home-greeting{margin:0 0 4px;font-size:12.5px;font-weight:600;letter-spacing:.02em;color:var(--brand,var(--ws-accent))}
.home-title h1{font-size:30px;font-weight:750;letter-spacing:-.03em;line-height:1.15;margin:0}
.home-title p.muted{margin:6px 0 0;font-size:14px}
.home-actions{display:flex;gap:8px}
.home-search{display:flex;align-items:center;gap:10px;width:100%;height:44px;padding:0 10px 0 14px;border:1px solid var(--ws-border);border-radius:12px;background:var(--ws-surface);color:var(--ws-muted);font-size:14px;cursor:text;text-align:left}
.home-search:hover{border-color:var(--ws-focus);color:var(--ws-fg)}
.home-search .label{flex:1}
.home-search kbd{font:11px/18px var(--ws-font);padding:0 7px;border:1px solid var(--ws-hairline);border-radius:4px;background:var(--ws-bg)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}
.stat{display:inline-flex;align-items:baseline;gap:6px;padding:6px 12px;border:1px solid var(--ws-hairline);border-radius:999px;background:none;color:var(--ws-muted);cursor:pointer;font-size:12.5px}
.stat strong{font-size:14px;color:var(--ws-fg);font-variant-numeric:tabular-nums}
.stat:hover{border-color:var(--ws-accent);color:var(--ws-fg)}
.stat.bad{border-color:color-mix(in srgb,var(--ws-red) 50%,transparent)}.stat.bad strong{color:var(--ws-red)}
.home-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr);gap:20px;align-items:start}
.home-col{display:flex;flex-direction:column;gap:20px;min-width:0}
@media(max-width:860px){.home-grid{grid-template-columns:minmax(0,1fr)}}
.home-card-head h2{font-size:14px;font-weight:650}
.home-hint{margin:8px 0 2px}
.page-cards{list-style:none;margin:4px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.page-card{position:relative;display:flex;border:1px solid var(--ws-hairline);border-radius:8px;background:var(--ws-bg);min-width:0}
.page-card:hover{border-color:var(--ws-accent)}
.page-card-open{flex:1;display:flex;align-items:flex-start;gap:10px;min-width:0;padding:10px 12px;border:0;background:none;cursor:pointer;text-align:left;color:var(--ws-fg)}
.page-card-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:7px;background:var(--ws-surface-2);color:var(--ws-muted)}
.page-card:hover .page-card-icon{color:var(--ws-accent);background:color-mix(in srgb,var(--ws-accent) 12%,transparent)}
.page-card-text{display:flex;flex-direction:column;min-width:0}
.page-card-text .title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.page-card-text .muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.page-card>.btn{position:absolute;top:6px;right:6px;width:24px;height:24px;opacity:0}
.page-card:hover>.btn,.page-card>.btn:focus-visible{opacity:1}
.section-cards{list-style:none;margin:4px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.section-card{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;width:100%;padding:12px;border:1px solid var(--ws-hairline);border-radius:8px;background:var(--ws-bg);cursor:pointer;text-align:left;color:var(--ws-fg)}
.section-card .icon{grid-row:span 2;color:var(--brand,var(--ws-accent))}
.section-card .title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.section-card:hover{border-color:var(--ws-accent)}
.agenda{list-style:none;margin:2px 0 0;padding:0}
.agenda-day{display:flex;gap:12px;padding:7px 0;border-top:1px solid var(--ws-hairline)}
.agenda-day:first-child{border-top:0}
.agenda-date{flex:none;width:30px;text-align:center}
.agenda-num{display:inline-block;min-width:28px;line-height:26px;border-radius:7px;background:var(--ws-surface-2);font-weight:650;font-variant-numeric:tabular-nums}
.agenda-day.empty-day .agenda-num{background:none;color:var(--ws-muted);font-weight:400}
.agenda-body{flex:1;min-width:0}
.agenda-head{display:flex;align-items:center;gap:6px;font-size:12.5px;line-height:26px}
.agenda-head .link{color:var(--ws-fg);font-weight:600}
.agenda-day.empty-day .agenda-head .link{color:var(--ws-muted);font-weight:400}
.agenda-head .icon{color:var(--ws-green)}
.agenda-body>.muted{display:none}
.agenda .compact-list{margin:0}
.board-lines{list-style:none;margin:2px 0 0;padding:0}
.board-line{display:grid;grid-template-columns:auto minmax(0,1fr) auto 64px;align-items:center;gap:10px;width:100%;padding:7px 6px;border:0;border-radius:6px;background:none;cursor:pointer;text-align:left;color:var(--ws-fg)}
.board-line:hover{background:var(--ws-hover)}
.board-line .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.board-dot{width:10px;height:10px;border-radius:3px;background:var(--c)}
.progress.mini{height:4px}
/* Page status, icons, cover, tags, mentions and link previews */
.status-badge{display:inline-flex;align-items:center;flex:none;height:18px;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:650;letter-spacing:.02em;line-height:1;color:var(--ws-fg);background:color-mix(in srgb,var(--tone,var(--ws-muted)) 18%,transparent);border:1px solid color-mix(in srgb,var(--tone,var(--ws-muted)) 45%,transparent)}
.status-new{--tone:var(--ws-green)}.status-updated{--tone:var(--ws-blue)}.status-beta{--tone:var(--ws-purple)}.status-deprecated{--tone:var(--ws-red)}.status-draft{--tone:var(--ws-orange)}
.wiki-node .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiki-node.section .wiki-link{display:flex;align-items:center;gap:6px}
.wiki-node .status-badge{height:16px;padding:0 6px;font-size:10px}
.page-emoji{display:inline-block;width:1.25em;text-align:center;flex:none;line-height:1}
.wiki-head .status-badge{margin-left:8px}
.wiki .wiki-article .title-icon{display:inline-flex;vertical-align:-.12em;margin-right:.35em;color:var(--brand,var(--ws-accent))}
.wiki .wiki-article .title-icon .page-emoji{width:auto}
.wiki .wiki-article .wiki-cover{display:block;width:100%;max-height:240px;object-fit:cover;border-radius:12px;margin:0 0 20px}
.wiki .wiki-article>.tags .tag,.wiki .tag-cloud .tag{border:1px solid transparent;cursor:pointer;font:inherit;font-size:12px}
.wiki .wiki-article>.tags .tag:hover,.wiki .tag-cloud .tag:hover{color:var(--ws-accent);border-color:color-mix(in srgb,var(--ws-accent) 40%,transparent)}
.tag-cloud{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 24px}
.wiki .tag-cloud .tag{display:inline-flex;gap:8px;align-items:center;padding:4px 12px;border-radius:999px;background:var(--ws-surface-2);color:var(--ws-fg)}
.wiki .tag-cloud .tag .count{font-size:11px;color:var(--ws-muted)}
.wiki .tag-cloud .tag[aria-pressed=true]{background:color-mix(in srgb,var(--ws-accent) 18%,transparent);border-color:var(--ws-accent)}
.wiki .wiki-article .tag-pages{list-style:none;padding:0;margin:0;border-top:1px solid var(--ws-hairline)}
.wiki .wiki-article .tag-pages li{margin:0}
.tag-page{display:flex;align-items:center;gap:10px;width:100%;padding:10px 6px;border:0;border-bottom:1px solid var(--ws-hairline);background:none;cursor:pointer;text-align:left;color:var(--ws-fg);font:inherit}
.tag-page:hover .title{color:var(--ws-accent)}
.tag-page .title{font-weight:600}.tag-page .muted{margin-left:auto}
.wiki-mentions{margin:16px 0 0;padding-top:16px;border-top:1px solid var(--ws-hairline);font-size:13px}
.wiki-mentions h2{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ws-muted);margin:0 0 8px}
.wiki-mentions ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.wiki-mentions li{padding:8px 10px;border:1px solid var(--ws-hairline);border-radius:8px}
.wiki-mentions .mention-head{display:flex;align-items:center;gap:8px}
.wiki-mentions p{margin:4px 0 0}
.wiki-preview{position:fixed;z-index:40;padding:12px 14px;border:1px solid var(--ws-menu-border);border-radius:10px;background:var(--ws-menu-bg);color:var(--ws-menu-fg);box-shadow:var(--ws-shadow);font-size:13px;line-height:1.5;pointer-events:none}
.wiki-preview .preview-head{display:flex;align-items:center;gap:8px;font-size:14px}
.wiki-preview p{margin:6px 0 0}
.wiki-preview .preview-path,.wiki-preview .preview-tags{font-size:11.5px;color:var(--ws-muted);margin-top:2px}
.discover{display:flex;flex-wrap:wrap;gap:8px}
.wiki-announcement{margin:0 0 16px;padding:8px 14px;border-radius:8px;font-size:13px;background:color-mix(in srgb,var(--brand,var(--ws-accent)) 14%,transparent);border:1px solid color-mix(in srgb,var(--brand,var(--ws-accent)) 35%,transparent)}
.wiki-announcement a{color:inherit;font-weight:600}
/* Page properties and folder databases */
.wiki-props-wrap{margin:-4px 0 18px;padding:6px 0 8px;border-bottom:1px solid var(--ws-hairline)}
.wiki-props{margin:0;display:grid;gap:1px}
.prop-row{display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr);align-items:center;min-height:30px}
.prop-row dt{display:flex;align-items:center;gap:6px;color:var(--ws-muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prop-row dd{display:flex;align-items:center;gap:4px;margin:0;min-width:0}
.prop-row dd>.btn{opacity:0;width:24px;height:24px}.prop-row:hover dd>.btn,.prop-row dd>.btn:focus-visible{opacity:1}
.prop-value{display:inline-flex;align-items:center;min-height:26px;max-width:100%;padding:2px 8px;border:0;border-radius:6px;background:none;color:var(--ws-fg);cursor:text;text-align:left;font:inherit;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prop-value:hover{background:var(--ws-hover)}
.prop-value.empty{color:var(--ws-faint)}
.prop-input{height:28px;width:100%;max-width:320px}
.prop-check{width:15px;height:15px;margin:0 8px;accent-color:var(--ws-accent)}
.prop-chips{display:inline-flex;flex-wrap:wrap;gap:4px}
.prop-chip{display:inline-block;padding:0 8px;border-radius:999px;font-size:11.5px;line-height:20px;background:var(--ws-surface-2);color:var(--ws-fg);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiki-props-wrap>.btn{margin-top:2px;color:var(--ws-muted)}
.wiki.wide{grid-template-columns:272px minmax(0,1fr)}.wiki.wide.nav-hidden{grid-template-columns:minmax(0,1fr)}
.wiki-content.db-content{max-width:none}
.db h1{display:flex;align-items:center;gap:10px;font-size:28px;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
.db h1 .title-icon{color:var(--brand,var(--ws-accent))}
.db>p.muted{margin:0 0 16px}
.db-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 14px}
.db-toolbar>.field{height:28px;max-width:200px}
.db-toolbar .desc svg{transform:rotate(90deg)}.db-toolbar .asc svg{transform:rotate(-90deg)}
.db-table-wrap{overflow-x:auto;border:1px solid var(--ws-hairline);border-radius:10px}
.db-table{width:100%;border-collapse:collapse;font-size:13px}
.db-table th{position:sticky;top:0;text-align:left;font-weight:500;color:var(--ws-muted);background:var(--ws-surface);border-bottom:1px solid var(--ws-hairline);padding:0 6px;height:34px;white-space:nowrap}
.db-table td{border-bottom:1px solid var(--ws-hairline);padding:2px 6px;height:36px;max-width:280px}
.db-table tr:last-child td{border-bottom:0}
.db-table tbody tr:hover{background:var(--ws-hover)}
.db-sort{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:inherit;cursor:pointer;font:inherit;padding:4px}
.db-sort:hover{color:var(--ws-fg)}
.db-title{display:inline-flex;align-items:center;gap:8px;border:0;background:none;padding:2px 4px;cursor:pointer;color:var(--ws-fg);font:inherit;font-weight:600;text-align:left;max-width:100%}
.db-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.db-title:hover span{color:var(--ws-accent);text-decoration:underline}
.db-gallery{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.db-card{border:1px solid var(--ws-hairline);border-radius:10px;overflow:hidden;background:var(--ws-surface);display:flex;flex-direction:column}
.db-card:hover{border-color:var(--ws-accent)}
.db-cover{display:flex;align-items:center;justify-content:center;width:100%;height:110px;object-fit:cover;background:var(--ws-surface-2);color:var(--ws-muted)}
.db-card-body{padding:10px 12px 12px;display:grid;gap:6px;min-width:0}
.db-card-body p{margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.db-card-props{display:flex;flex-wrap:wrap;gap:4px}
.db-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px}
.db-column{background:var(--ws-surface);border:1px solid var(--ws-hairline);border-radius:10px;padding:8px;min-height:120px;display:flex;flex-direction:column;gap:8px}
.db-column.drop{outline:2px dashed var(--ws-accent);outline-offset:-2px}
.db-column h3{display:flex;align-items:center;justify-content:space-between;margin:2px 4px;font-size:12.5px;font-weight:650}
.db-board-card{padding:8px 10px;border:1px solid var(--ws-hairline);border-radius:8px;background:var(--ws-bg);cursor:grab;display:grid;gap:4px}
.db-board-card:hover{border-color:var(--ws-accent)}
.modal.wide{width:min(860px,calc(100vw - 32px));max-width:none}
.template-gallery{display:grid;grid-template-columns:220px minmax(0,1fr);gap:12px;margin:0 0 12px;height:min(420px,55vh)}
.template-list{display:flex;flex-direction:column;gap:4px;overflow:auto}
.template-item{display:grid;gap:2px;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:none;text-align:left;cursor:pointer;color:var(--ws-fg)}
.template-item:hover{background:var(--ws-hover)}
.template-item[aria-checked=true]{border-color:var(--ws-accent);background:color-mix(in srgb,var(--ws-accent) 10%,transparent)}
.template-preview{overflow:auto;padding:12px 16px;border:1px solid var(--ws-hairline);border-radius:8px;background:var(--ws-bg);font-size:13px}
.template-preview h1{font-size:1.5em}
@media(max-width:640px){.template-gallery{grid-template-columns:1fr;height:auto}.template-preview{max-height:200px}}
/* Find (/) */
.finder-back{align-items:flex-start!important;padding-top:12vh}
.finder{width:min(620px,calc(100vw - 32px));background:var(--ws-menu-bg,var(--ws-bg));border:1px solid var(--ws-menu-border,var(--ws-border));border-radius:var(--ws-r3);box-shadow:var(--ws-shadow);overflow:hidden}
.finder .field{width:100%;height:40px;border:0;border-bottom:1px solid var(--ws-hairline);border-radius:0;padding:0 14px;font-size:14px;background:transparent}
.finder .field:focus{outline:none}
.finder-list{list-style:none;margin:0;padding:4px;max-height:min(420px,60vh);overflow:auto}
.finder-item{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:var(--ws-r1);cursor:pointer;color:var(--ws-menu-fg,var(--ws-fg))}
.finder-item[aria-selected=true]{background:var(--ws-menu-active,var(--ws-pressed));color:var(--ws-menu-active-fg,var(--ws-fg))}
.finder-label{flex:none;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.finder-detail{flex:1;min-width:0;color:var(--ws-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.finder-item[aria-selected=true] .finder-detail{color:inherit;opacity:.8}
.finder-kind{font-size:11px;color:var(--ws-muted);text-transform:uppercase;letter-spacing:.05em}
.finder-item[aria-selected=true] .finder-kind{color:inherit}
.finder-none{padding:12px;color:var(--ws-muted)}
/* Pages shown in frames (API Client, Content health, Link graph) */
.frame-host{position:fixed;left:0;right:0;top:var(--top,41px);bottom:0;z-index:5}
.frame-host iframe{display:block;width:100%;height:100%;border:0;background:var(--ws-bg)}
body.frame-visible{overflow:hidden}`;

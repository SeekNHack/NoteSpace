import { tokensCss } from './core/design';

/** Workspace panel styles, built on the shared design tokens (VS Code theme colors). */
export const plannerCss = `${tokensCss}
:root{--bc-gray:var(--ws-muted);--bc-blue:var(--ws-blue);--bc-cyan:var(--ws-cyan);--bc-teal:var(--ws-teal);--bc-green:var(--ws-green);--bc-amber:var(--ws-orange);--bc-orange:var(--ws-orange);--bc-red:var(--ws-red);--bc-pink:var(--ws-pink);--bc-purple:var(--ws-purple)}
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{margin:0;background:var(--ws-bg);color:var(--ws-fg);font:var(--ws-ui-size)/1.45 var(--ws-font)}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:1px solid var(--ws-focus);outline-offset:-1px}
.icon{display:inline-block;vertical-align:-3px;flex:none}
.spacer{flex:1}.muted{color:var(--ws-muted)}.small{font-size:12px}
/* Navigation */
.nav{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:2px;padding:6px 12px;background:var(--ws-bg);border-bottom:1px solid var(--ws-hairline);min-height:40px}
.nav-item{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:var(--ws-muted);padding:5px 10px;border-radius:var(--ws-r1);cursor:pointer;white-space:nowrap}
.nav-item:hover{background:var(--ws-hover);color:var(--ws-fg)}
.nav-item[aria-current=page]{background:var(--ws-pressed);color:var(--ws-fg);font-weight:600;box-shadow:inset 0 -2px 0 var(--ws-accent)}
.badge{font-size:11px;line-height:16px;min-width:16px;padding:0 5px;border-radius:999px;background:var(--ws-accent);color:var(--vscode-button-foreground,#fff);text-align:center}
.nav .field{max-width:180px}
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
.section-head{display:flex;align-items:center;gap:8px;margin:0 0 8px}.section-head h2{font-size:16px;margin:0}
.sub-head{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ws-muted);margin:16px 0 8px}
.notice{padding:6px 10px;border-radius:var(--ws-r1);background:var(--ws-surface);border:1px solid var(--ws-hairline)}
/* Layout */
.layout{display:grid;grid-template-columns:minmax(0,1fr)}
.layout.with-detail{grid-template-columns:minmax(0,1fr) 320px}
.main{padding:12px 16px 40px;min-width:0}
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
.detail{border-left:1px solid var(--ws-hairline);padding:12px 14px;position:sticky;top:41px;align-self:start;max-height:calc(100vh - 41px);overflow:auto}
.detail h2{font-size:13px;margin:0 0 6px;display:flex;align-items:center}
.detail label{display:block;font-size:11px;color:var(--ws-muted);margin:10px 0 3px;text-transform:uppercase;letter-spacing:.05em}
.detail .field{width:100%}
.detail .desc{white-space:pre-wrap;color:var(--ws-muted);font-size:12.5px;background:var(--ws-surface);border-radius:var(--ws-r1);padding:6px 8px;margin:0}
.detail .actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}
.detail-boards{display:flex;flex-direction:column;gap:6px}
.board-line{display:grid;grid-template-columns:1fr 130px;gap:6px;align-items:center;font-size:12.5px}
/* Home */
.home-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.home-title h1{font-size:18px;margin:0}.home-title p{margin:2px 0 0;font-size:12.5px}
.home-head .search{width:220px}
.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;align-items:start}
.home-card{border:1px solid var(--ws-hairline);border-radius:var(--ws-r3);padding:10px 12px;background:var(--ws-surface);min-width:0}
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
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.tile{padding:10px 12px;border:1px solid var(--ws-hairline);border-radius:var(--ws-r2);background:var(--ws-surface)}
.tile strong{display:block;font-size:20px;font-variant-numeric:tabular-nums}.tile span{color:var(--ws-muted);font-size:12px}
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
@media(max-width:700px){.nav-item .label{display:none}.nav-item{padding:5px 8px}.home-head .search{width:100%;order:3}.cal-preview{grid-template-columns:1fr}.board-head .field[aria-label="Card density"],.board-head .field[aria-label="Card order"],.board-head .field[aria-label=Swimlanes]{display:none}.filters select{display:none}}
@media(max-width:560px){.week{grid-template-columns:1fr}.day{min-height:56px}.day .item{display:none}.chips .chip.page,.chips .chip.tag{display:none}.main{padding:10px 10px 32px}.home-grid{grid-template-columns:1fr}}`;

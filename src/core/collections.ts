import { Page } from './model';
import { excerptOf } from './mentions';
import {
  compareTasks,
  inList,
  matchesFilter,
  PlannerList,
  statusLabels,
  Task,
  TaskStatus,
  taskStatuses,
} from './tasks';

/**
 * Collections are fenced blocks that show a live view over tasks or pages:
 *
 *   ```tasks
 *   project: Launch
 *   status: open
 *   view: board
 *   ```
 *
 * The block's source is the only thing stored in the page; the view is computed when rendered.
 */
export interface CollectionContext {
  tasks: Task[];
  pages: Page[];
  page: Page;
  today: string;
  pageHref: (page: Page) => string;
  /** False in exports that keep planner data private. */
  showTasks: boolean;
  /** Board cards can be dragged (or moved with Alt+arrows) to change their status. */
  interactive?: boolean;
}

export function parseSpec(source: string): Record<string, string> {
  const spec: Record<string, string> = {};
  for (const line of source.split('\n')) {
    const match = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (match) spec[match[1].toLowerCase()] = match[2];
  }
  return spec;
}

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

let boardSeq = 0;

export function renderCollection(
  kind: 'tasks' | 'collection',
  source: string,
  ctx: CollectionContext,
): string {
  const spec = parseSpec(source);
  const sourceKind = kind === 'tasks' ? 'tasks' : spec.source === 'pages' ? 'pages' : 'tasks';
  const title = spec.title ? `<div class="collection-title">${escape(spec.title)}</div>` : '';
  if (sourceKind === 'pages')
    return `<div class="collection">${title}${pageCollection(spec, ctx)}</div>`;
  if (!ctx.showTasks)
    return `<div class="collection collection-private"><p class="muted">Planner data is not included in this export.</p></div>`;
  const status = spec.status || (spec.view === 'board' ? 'all' : 'open');
  let tasks = ctx.tasks.filter((task) =>
    matchesFilter(task, {
      project: spec.project,
      tag: spec.tag,
      assignee: spec.assignee,
      priority: spec.priority as Task['priority'],
      status: status === 'all' ? undefined : (status as TaskStatus | 'open'),
      text: spec.search,
    }),
  );
  if (spec.page === 'this') tasks = tasks.filter((t) => t.pageId === ctx.page.id);
  else if (spec.page) tasks = tasks.filter((t) => t.pagePath === spec.page);
  if (spec.links === 'this')
    tasks = tasks.filter((t) =>
      t.links.some(
        (l) =>
          l === ctx.page.title ||
          ctx.page.path.replace(/\.md$/i, '').endsWith(l.replace(/^\//, '')),
      ),
    );
  if (spec.list) tasks = tasks.filter((t) => inList(t, spec.list as PlannerList, ctx.today));
  tasks.sort(compareTasks);
  const limit = Math.min(Number(spec.limit) || 200, 500);
  tasks = tasks.slice(0, limit);
  if (!tasks.length)
    return `<div class="collection">${title}<p class="muted">No matching tasks.</p></div>`;
  const pageOf = (task: Task) => ctx.pages.find((p) => p.id === task.pageId);
  const pageLink = (task: Task) => {
    const page = pageOf(task);
    return page
      ? `<a href="${escape(ctx.pageHref(page))}">${escape(task.pageTitle)}</a>`
      : escape(task.pageTitle);
  };
  const due = (task: Task) =>
    task.due
      ? `<span class="task-due${task.status !== 'done' && task.due.slice(0, 10) < ctx.today ? ' overdue' : ''}">${escape(task.due)}</span>`
      : '';
  const meta = (task: Task) =>
    [
      due(task),
      task.priority ? `<span class="task-meta">${task.priority}</span>` : '',
      task.project ? `<span class="task-meta">${escape(task.project)}</span>` : '',
      task.assignee ? `<span class="task-meta">@${escape(task.assignee)}</span>` : '',
    ]
      .filter(Boolean)
      .join(' ');
  const box = (task: Task) =>
    `<input type="checkbox" disabled${task.status === 'done' ? ' checked' : ''} aria-label="${task.status === 'done' ? 'Done' : 'Open'}">`;
  if (spec.view === 'table')
    return `<div class="collection">${title}<table class="collection-table"><thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Priority</th><th scope="col">Project</th><th scope="col">Page</th></tr></thead><tbody>${tasks
      .map(
        (t) =>
          `<tr><td>${escape(t.title)}</td><td>${statusLabels[t.status]}</td><td>${due(t)}</td><td>${t.priority || ''}</td><td>${escape(t.project || '')}</td><td>${pageLink(t)}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
  if (spec.view === 'board') {
    if (!ctx.interactive)
      return `<div class="collection">${title}<div class="collection-board" role="region" aria-label="Task board" tabindex="0">${taskStatuses
        .map((status) => {
          const column = tasks.filter((t) => t.status === status);
          return `<section class="collection-column" aria-label="${statusLabels[status]}"><h4>${statusLabels[status]} <span class="muted">${column.length}</span></h4>${column
            .map(
              (t) => `<div class="collection-card">${escape(t.title)}<div>${meta(t)}</div></div>`,
            )
            .join('')}</section>`;
        })
        .join('')}</div></div>`;
    // Cards carry the task key (URI-encoded: page ids contain NUL, which HTML would replace);
    // the host re-locates the line before writing the new status.
    const help = `board-help-${++boardSeq}`;
    return `<div class="collection">${title}<div class="collection-board interactive" role="region" aria-label="Task board" aria-describedby="${help}" tabindex="-1">${taskStatuses
      .map((status) => {
        const column = tasks.filter((t) => t.status === status);
        return `<section class="collection-column" data-status="${status}" aria-label="${statusLabels[status]}"><h4>${statusLabels[status]} <span class="muted collection-count">${column.length}</span></h4><div class="collection-cards" role="list">${column
          .map(
            (t) =>
              `<div class="collection-card" role="listitem" tabindex="0" draggable="true" data-task="${encodeURIComponent(t.key)}" data-title="${escape(t.title)}" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight">${escape(t.title)}<div>${meta(t)}</div></div>`,
          )
          .join('')}</div></section>`;
      })
      .join(
        '',
      )}</div><p class="collection-help muted" id="${help}">Drag a card to another column, or press Alt+← / Alt+→ on it, to change its status in the page.</p><p class="collection-status" role="status"></p></div>`;
  }
  return `<div class="collection">${title}<ul class="collection-list contains-task-list">${tasks
    .map(
      (t) =>
        `<li class="task-list-item${t.status === 'done' ? ' done' : ''}">${box(t)} ${escape(t.title)} ${meta(t)} <span class="task-page">· ${pageLink(t)}</span></li>`,
    )
    .join('')}</ul></div>`;
}

/** A post's date: front matter `date`, else a `YYYY-MM-DD` at the start of the file name. */
export function postDate(p: Page): string {
  const value = p.properties?.date?.slice(0, 10) || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return /(?:^|\/)(\d{4}-\d{2}-\d{2})[^/]*$/.exec(p.path)?.[1] || '';
}
const longDate = (date: string) =>
  new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

function pageCollection(spec: Record<string, string>, ctx: CollectionContext): string {
  let pages = ctx.pages.filter((p) => !p.draft && p.id !== ctx.page.id);
  if (spec.folder) pages = pages.filter((p) => p.path.startsWith(spec.folder.replace(/\/?$/, '/')));
  if (spec.tag) pages = pages.filter((p) => p.tags.includes(spec.tag.replace(/^#/, '')));
  // Posts (`view: posts`) are newest first; `sort:` names a property (`-` for descending).
  const sort = spec.sort || (spec.view === 'posts' ? '-date' : 'title');
  const key = sort.replace(/^-/, '');
  const value = (p: Page) =>
    key === 'title' ? p.title : key === 'date' ? postDate(p) : p.properties?.[key] || '';
  pages.sort(
    (a, b) =>
      (sort.startsWith('-') ? -1 : 1) *
        value(a).localeCompare(value(b), undefined, { numeric: true }) ||
      a.title.localeCompare(b.title),
  );
  pages = pages.slice(0, Math.min(Number(spec.limit) || 100, 500));
  if (!pages.length) return '<p class="muted">No matching pages.</p>';
  if (spec.view === 'posts')
    return `<div class="collection-posts">${pages
      .map((p) => {
        const date = postDate(p);
        const authors = (p.properties?.authors || p.properties?.author || '')
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean);
        const meta = [
          date ? `<time datetime="${escape(date)}">${escape(longDate(date))}</time>` : '',
          authors.length ? `<span>${escape(authors.join(', '))}</span>` : '',
          p.tags.length
            ? `<span class="post-tags">${p.tags.map((t) => `#${escape(t)}`).join(' ')}</span>`
            : '',
        ]
          .filter(Boolean)
          .join('<span aria-hidden="true"> · </span>');
        const summary = excerptOf(p, 260);
        return `<article class="post"><h3><a href="${escape(ctx.pageHref(p))}">${escape(p.title)}</a></h3>${meta ? `<p class="post-meta">${meta}</p>` : ''}${summary ? `<p>${escape(summary)}</p>` : ''}<a class="post-more" href="${escape(ctx.pageHref(p))}">Continue reading</a></article>`;
      })
      .join('')}</div>`;
  const excerpt = (p: Page) =>
    escape(
      p.body
        .replace(/^#.*$/gm, '')
        .replace(/[#*_`>[\]()|:-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140),
    );
  if (spec.view === 'gallery')
    return `<div class="collection-gallery">${pages
      .map(
        (p) =>
          `<a class="collection-tile" href="${escape(ctx.pageHref(p))}"><strong>${escape(p.title)}</strong><span>${excerpt(p)}</span></a>`,
      )
      .join('')}</div>`;
  if (spec.view === 'table')
    return `<table class="collection-table"><thead><tr><th scope="col">Page</th><th scope="col">Path</th><th scope="col">Tags</th></tr></thead><tbody>${pages
      .map(
        (p) =>
          `<tr><td><a href="${escape(ctx.pageHref(p))}">${escape(p.title)}</a></td><td>${escape(p.path)}</td><td>${escape(p.tags.map((t) => `#${t}`).join(' '))}</td></tr>`,
      )
      .join('')}</tbody></table>`;
  return `<ul class="collection-list">${pages.map((p) => `<li><a href="${escape(ctx.pageHref(p))}">${escape(p.title)}</a></li>`).join('')}</ul>`;
}

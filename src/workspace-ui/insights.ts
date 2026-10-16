import { button, emptyState, h, post, S } from './core';

export function insightsView(): HTMLElement {
  const data = S().insights;
  const wrap = h('div', { class: 'insights' });
  if (!data) {
    wrap.append(h('p', { class: 'muted', text: 'Computing…' }));
    return wrap;
  }
  const tile = (label: string, value: string | number, tone = '') =>
    h(
      'div',
      { class: `tile ${tone}` },
      h('strong', { text: String(value) }),
      h('span', { text: label }),
    );
  const pct = data.tasks.total ? Math.round((data.tasks.done / data.tasks.total) * 100) : 0;
  const list = (
    items: Array<{ title: string; path: string; uri: string; target?: string }>,
    more: number,
  ) =>
    h(
      'ul',
      { class: 'page-list' },
      ...items.map((i) => {
        const b = h(
          'button',
          { type: 'button', class: 'page-line' },
          h('span', { class: 'title', text: i.title }),
          h('span', { class: 'muted', text: i.target ? `→ ${i.target}` : i.path }),
        );
        b.addEventListener('click', () => post({ type: 'openPage', uri: i.uri }));
        return h('li', {}, b);
      }),
      more > items.length
        ? h('li', { class: 'muted small', text: `and ${more - items.length} more` })
        : undefined,
    );
  wrap.append(
    h(
      'div',
      { class: 'section-head' },
      h('h2', { text: 'Insights' }),
      h('span', { class: 'spacer' }),
      button(
        'Full content health report',
        () => post({ type: 'command', name: 'contentHealth' }),
        'btn',
      ),
      button('Link graph', () => post({ type: 'command', name: 'graph' }), 'btn ghost'),
    ),
    h('h3', { class: 'sub-head', text: 'Wiki health' }),
    h(
      'div',
      { class: 'tiles' },
      tile(
        'Health score',
        `${data.score}%`,
        data.score >= 90 ? 'good' : data.score >= 60 ? 'warn' : 'bad',
      ),
      tile('Broken links', data.brokenCount, data.brokenCount ? 'bad' : 'good'),
      tile('Pages without links to them', data.orphanCount, data.orphanCount ? 'warn' : 'good'),
      tile('Content issues', data.issues, data.issues ? 'warn' : 'good'),
    ),
    h('h3', { class: 'sub-head', text: 'Content' }),
    h(
      'div',
      { class: 'tiles' },
      tile('Pages', data.pages),
      tile('Words', data.words.toLocaleString()),
      tile('Folders', data.sections),
      tile('Daily notes', data.dailyNotes),
    ),
    h('h3', { class: 'sub-head', text: 'Tasks' }),
    h(
      'div',
      { class: 'tiles' },
      tile('Completed', `${pct}%`),
      tile('Open', data.tasks.open),
      tile('Overdue', data.tasks.overdue, data.tasks.overdue ? 'bad' : 'good'),
      tile('Done in the last 7 days', data.tasks.doneThisWeek),
    ),
  );
  if (data.brokenCount)
    wrap.append(
      h('h3', { class: 'sub-head', text: 'Broken links' }),
      list(data.broken, data.brokenCount),
    );
  if (data.orphanCount)
    wrap.append(
      h('h3', { class: 'sub-head', text: 'Pages without links to them' }),
      list(data.orphans, data.orphanCount),
    );
  if (!data.pages) wrap.append(emptyState('This wiki has no pages yet.'));
  return wrap;
}

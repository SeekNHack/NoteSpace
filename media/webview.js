/* The webview sends typed messages. The only workspace write is `taskMove` (a board embedded in a
   page changes a task's status), which the host validates and applies to the task's line. */
(() => {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || {};
  const data = JSON.parse(document.getElementById('wiki-data').textContent);
  document
    .querySelectorAll('[data-action]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        vscode.postMessage({ type: 'action', name: button.dataset.action }),
      ),
    );
  // Page-specific actions (the host only accepts a fixed list of commands).
  document.querySelectorAll('[data-command]').forEach((button) =>
    button.addEventListener('click', () =>
      vscode.postMessage({
        type: 'command',
        name: button.dataset.command,
        page: button.dataset.page,
        value: button.dataset.value,
      }),
    ),
  );
  document.querySelectorAll('[data-reveal]').forEach((button) =>
    button.addEventListener('click', () =>
      vscode.postMessage({
        type: 'revealSection',
        root: data.root,
        prefix: button.dataset.reveal,
      }),
    ),
  );
  document
    .querySelectorAll('[data-show-log]')
    .forEach((button) =>
      button.addEventListener('click', () => vscode.postMessage({ type: 'showLog' })),
    );
  document
    .getElementById('wiki-switch')
    ?.addEventListener('change', (event) =>
      vscode.postMessage({ type: 'switchWiki', id: event.target.value }),
    );
  const reader = document.querySelector('.reader-layout');
  const focus = document.getElementById('reader-focus');
  const outline = document.getElementById('reader-outline');
  if (reader && focus) {
    const apply = () => {
      reader.classList.toggle('focus', !!state.focus);
      reader.classList.toggle('no-outline', !state.outline && !state.focus);
      focus.setAttribute('aria-pressed', String(!!state.focus));
      if (outline) outline.setAttribute('aria-pressed', String(state.outline !== false));
    };
    if (state.outline === undefined) state.outline = true;
    focus.addEventListener('click', () => {
      state.focus = !state.focus;
      vscode.setState(state);
      apply();
    });
    outline?.addEventListener('click', () => {
      state.outline = !state.outline;
      vscode.setState(state);
      apply();
    });
    apply();
  }
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('#code:')) {
      event.preventDefault();
      vscode.postMessage({ type: 'code', target: decodeURIComponent(href.slice(6)) });
    } else if (href.startsWith('#asset:')) {
      event.preventDefault();
      vscode.postMessage({ type: 'asset', target: decodeURIComponent(href.slice(7)) });
    } else if (href.startsWith('#wiki:')) {
      event.preventDefault();
      const [id, query] = href.slice(6).split('?');
      const params = new URLSearchParams(query || '');
      const offset = params.get('offset');
      vscode.postMessage({
        type: data.mode === 'preview' && offset === null ? 'navigate' : 'open',
        id: decodeURIComponent(id),
        anchor: params.get('anchor'),
        ...(offset === null ? {} : { offset: Number(offset) }),
      });
    } else if (/^(https?:|mailto:)/i.test(href)) {
      event.preventDefault();
      vscode.postMessage({ type: 'external', href });
    }
  });
  const search = document.getElementById('wiki-search');
  if (search && data.mode === 'preview') {
    const results = document.getElementById('wiki-results');
    search.addEventListener('input', () => {
      const q = search.value.trim();
      results.replaceChildren();
      if (q) vscode.postMessage({ type: 'search', query: q });
    });
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'searchResults' || event.data.query !== search.value.trim()) return;
      results.replaceChildren();
      for (const page of event.data.pages || []) {
        const li = document.createElement('li'),
          a = document.createElement('a');
        a.textContent = page.title;
        a.href = `#wiki:${encodeURIComponent(page.id)}`;
        if (page.excerpt) a.title = page.excerpt;
        li.append(a);
        results.append(li);
      }
    });
  }
  // Boards embedded in pages: drag or Alt+arrows change a task's status (dist/task-board.js).
  if (window.wikiTaskBoards)
    window.wikiTaskBoards((message) => vscode.postMessage(message), {
      focus: state.focusTask,
      remember: (card) => {
        state.focusTask = card;
        vscode.setState(state);
      },
    });
  // Interactive ```http blocks: nothing is sent until Send; responses are shown as text.
  document.addEventListener(
    'click',
    (event) => {
      const send = event.target.closest && event.target.closest('.http-block .http-send');
      if (send) {
        event.preventDefault();
        const block = send.closest('.http-block');
        send.disabled = true;
        send.textContent = 'Sending…';
        block.querySelector('.http-response').replaceChildren();
        vscode.postMessage({
          type: 'httpSend',
          id: block.id,
          source: block.dataset.source,
          url: block.querySelector('input.http-url')?.value,
          body: block.querySelector('textarea.http-body')?.value,
          environment: block.querySelector('.http-env')?.value,
        });
        return;
      }
      const link = event.target.closest && event.target.closest('.http-link[data-collection]');
      if (link) {
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage({ type: 'httpOpen', collection: link.dataset.collection });
      }
    },
    true,
  );
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m || m.type !== 'httpResponse') return;
    const block = document.getElementById(m.id);
    if (!block) return;
    const send = block.querySelector('.http-send');
    send.disabled = false;
    send.textContent = 'Send';
    const out = block.querySelector('.http-response');
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      e.className = cls;
      e.textContent = text;
      return e;
    };
    out.replaceChildren();
    if (m.error) return out.append(el('p', 'http-status bad', m.error));
    const line = document.createElement('p');
    line.append(
      el(
        'span',
        'http-status ' + (m.status < 400 ? 'ok' : 'bad'),
        m.status + ' ' + (m.statusText || ''),
      ),
      el(
        'span',
        'http-note',
        ' ' + m.ms + ' ms · ' + m.size + ' B' + (m.truncated ? ' (truncated)' : ''),
      ),
    );
    out.append(line);
    if (m.missing && m.missing.length)
      out.append(
        el(
          'p',
          'http-note',
          'No value for ' +
            m.missing.map((x) => '{{' + x + '}}').join(', ') +
            ': choose an environment.',
        ),
      );
    for (const t of m.tests || [])
      out.append(
        el(
          'p',
          'http-status ' + (t.pass ? 'ok' : 'bad'),
          (t.pass ? '✓ ' : '✗ ') + t.source + ' — ' + t.message,
        ),
      );
    const pre = document.createElement('pre');
    pre.append(
      el(
        'code',
        '',
        m.binary
          ? 'Binary response: open it in the API Client to download it.'
          : m.text || '(empty body)',
      ),
    );
    out.append(pre);
  });
  document.querySelectorAll('.copy-code').forEach((button) =>
    button.addEventListener('click', async () => {
      const code = button.parentElement.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 1800);
      } catch {
        button.textContent = 'Unavailable';
      }
    }),
  );
  // Large diagrams: click to toggle between fit-to-width and actual size (scrollable).
  document.querySelectorAll('.diagram[data-diagram-zoom]').forEach((figure) => {
    figure.tabIndex = 0;
    figure.title = 'Click to toggle actual size';
    const toggle = () => figure.classList.toggle('actual-size');
    figure.addEventListener('click', toggle);
    figure.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
  const svg = document.querySelector('svg.graph');
  if (!svg) {
    requestAnimationFrame(() => window.scrollTo(0, state.scroll || 0));
    let timer;
    window.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.scroll = window.scrollY;
        vscode.setState(state);
      }, 100);
    });
    return;
  }
  const filter = document.getElementById('filter'),
    list = document.querySelector('.page-list');
  filter.value = state.filter || '';
  const element = (name, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  // Local mode: the active page and pages within 1–2 links in either direction.
  const modes = document.querySelectorAll('input[name="graph-mode"]'),
    depthSelect = document.getElementById('graph-depth');
  const mode = () => (data.focus && state.mode === 'local' ? 'local' : 'all');
  modes.forEach((input) => {
    input.checked = input.value === mode();
    input.addEventListener('change', () => {
      state.mode = input.value;
      render();
    });
  });
  if (depthSelect) {
    depthSelect.value = String(state.depth || 1);
    depthSelect.addEventListener('change', () => {
      state.depth = Number(depthSelect.value);
      render();
    });
  }
  function neighborhood() {
    const distance = new Map([[data.focus.id, 0]]);
    let frontier = [data.focus.id];
    for (let d = 1; d <= (state.depth || 1); d++) {
      const next = [];
      for (const edge of data.edges)
        for (const [a, b] of [
          [edge.source, edge.target],
          [edge.target, edge.source],
        ])
          if (frontier.includes(a) && !distance.has(b)) {
            distance.set(b, d);
            next.push(b);
          }
      frontier = next;
    }
    return distance;
  }
  function render() {
    const local = mode() === 'local' ? neighborhood() : undefined;
    const query = filter.value.toLocaleLowerCase(),
      matches = data.nodes.filter(
        (n) =>
          (!local || local.has(n.id)) && `${n.title} ${n.path}`.toLocaleLowerCase().includes(query),
      );
    const visible = matches.slice(0, 150),
      points = new Map();
    const width = Math.max(svg.clientWidth, 280),
      height = Math.max(svg.clientHeight, 220);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    list.replaceChildren();
    document.getElementById('empty').hidden = matches.length > 0;
    if (local) {
      // Rings by distance around the active page.
      const rings = [[], [], []];
      for (const node of visible) rings[local.get(node.id)].push(node);
      rings.forEach((ring, d) =>
        ring.forEach((node, i) => {
          const angle = (i * 2 * Math.PI) / Math.max(ring.length, 1) + d * 0.4;
          const radius = d === 0 ? 0 : d === 1 ? 0.5 : 0.9;
          points.set(node.id, {
            x: width / 2 + Math.cos(angle) * width * 0.43 * radius,
            y: height / 2 + Math.sin(angle) * height * 0.43 * radius,
          });
        }),
      );
    } else
      visible.forEach((node, i) => {
        const angle = (i * 2 * Math.PI) / Math.max(visible.length, 1);
        const radius = visible.length === 1 ? 0 : 0.7 + (i % 2) * 0.15;
        points.set(node.id, {
          x: width / 2 + Math.cos(angle) * width * 0.43 * radius,
          y: height / 2 + Math.sin(angle) * height * 0.43 * radius,
        });
      });
    for (const edge of data.edges) {
      const a = points.get(edge.source),
        b = points.get(edge.target);
      if (a && b) svg.append(element('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    }
    for (const node of visible) {
      const p = points.get(node.id),
        group = element('g', {
          class: `graph-node${local && node.id === data.focus.id ? ' center' : ''}`,
          tabindex: '0',
          role: 'button',
          'aria-label': `Open ${node.title}`,
          transform: `translate(${p.x} ${p.y})`,
        });
      group.append(element('circle', { r: 6 }));
      const title = element('title', {});
      title.textContent = `${node.title} (${node.path})`;
      group.append(title);
      if (visible.length <= 35) {
        const label = element('text', {
          x: p.x > width / 2 ? -12 : 12,
          y: 4,
          'text-anchor': p.x > width / 2 ? 'end' : 'start',
        });
        label.textContent = node.title.length > 24 ? node.title.slice(0, 23) + '…' : node.title;
        group.append(label);
      }
      const open = () => vscode.postMessage({ type: 'open', id: node.id });
      group.addEventListener('click', open);
      group.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
      svg.append(group);
    }
    for (const node of matches) {
      const li = document.createElement('li'),
        button = document.createElement('button');
      button.textContent = node.title;
      button.title = node.path;
      button.addEventListener('click', () => vscode.postMessage({ type: 'open', id: node.id }));
      li.append(button);
      list.append(li);
    }
    vscode.setState({ ...state, filter: filter.value });
  }
  filter.addEventListener('input', render);
  new ResizeObserver(() => requestAnimationFrame(render)).observe(svg);
  render();
})();

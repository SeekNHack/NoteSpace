/**
 * Client side of interactive ```http blocks (Studio; the reader has the same code in
 * media/webview.js). The host re-parses the block's source; the card only sends the edited URL,
 * body and environment, and shows the response with text nodes (never as HTML).
 */
export function wireHttpBlocks(post: (m: unknown) => void, root: Document = document) {
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const send = target?.closest<HTMLButtonElement>('.http-block .http-send');
    if (send) {
      event.preventDefault();
      event.stopPropagation();
      const block = send.closest<HTMLElement>('.http-block')!;
      send.disabled = true;
      send.textContent = 'Sending…';
      block.querySelector('.http-response')?.replaceChildren();
      post({
        type: 'httpSend',
        id: block.id,
        source: block.dataset.source,
        url: block.querySelector<HTMLInputElement>('input.http-url')?.value,
        body: block.querySelector<HTMLTextAreaElement>('textarea.http-body')?.value,
        environment: block.querySelector<HTMLSelectElement>('.http-env')?.value,
      });
      return;
    }
    const link = target?.closest<HTMLElement>('.http-link[data-collection]');
    if (link) {
      event.preventDefault();
      post({ type: 'httpOpen', collection: link.dataset.collection });
    }
  });
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m?.type !== 'httpResponse') return;
    showHttpResponse(m);
  });
}

export function showHttpResponse(m: {
  id: string;
  error?: string;
  status?: number;
  statusText?: string;
  ms?: number;
  size?: number;
  text?: string;
  binary?: boolean;
  truncated?: boolean;
  missing?: string[];
  tests?: Array<{ pass: boolean; source: string; message: string }>;
}) {
  const block = document.getElementById(m.id);
  if (!block) return;
  const send = block.querySelector<HTMLButtonElement>('.http-send');
  if (send) {
    send.disabled = false;
    send.textContent = 'Send';
  }
  const out = block.querySelector('.http-response');
  if (!out) return;
  const el = (tag: string, cls: string, text: string) => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };
  out.replaceChildren();
  if (m.error) {
    out.append(el('p', 'http-status bad', m.error));
    return;
  }
  const line = document.createElement('p');
  line.append(
    el(
      'span',
      `http-status ${(m.status || 0) < 400 ? 'ok' : 'bad'}`,
      `${m.status} ${m.statusText || ''}`,
    ),
    el('span', 'http-note', ` ${m.ms} ms · ${m.size} B${m.truncated ? ' (truncated)' : ''}`),
  );
  out.append(line);
  if (m.missing?.length)
    out.append(
      el(
        'p',
        'http-note',
        `No value for ${m.missing.map((x) => `{{${x}}}`).join(', ')}: choose an environment.`,
      ),
    );
  for (const t of m.tests || [])
    out.append(
      el(
        'p',
        t.pass ? 'http-status ok' : 'http-status bad',
        `${t.pass ? '✓' : '✗'} ${t.source} — ${t.message}`,
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
}

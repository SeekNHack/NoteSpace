/**
 * Interactive blocks of a rendered page, shared by the Reader and the workspace panel: ```http
 * blocks (nothing is sent until Send), Copy on code blocks and zoom on large diagrams. Events
 * are delegated to the document, so pages inserted later work without wiring them again.
 */
export function wireReaderBlocks(post: (message: unknown) => void) {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      const send = target?.closest?.<HTMLButtonElement>('.http-block .http-send');
      if (send) {
        event.preventDefault();
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
      const link = target?.closest?.<HTMLElement>('.http-link[data-collection]');
      if (link) {
        event.preventDefault();
        event.stopPropagation();
        post({ type: 'httpOpen', collection: link.dataset.collection });
        return;
      }
      const copy = target?.closest?.<HTMLButtonElement>('.copy-code');
      if (copy) {
        const code = copy.parentElement?.querySelector('code')?.textContent || '';
        navigator.clipboard.writeText(code).then(
          () => {
            copy.textContent = 'Copied';
            setTimeout(() => (copy.textContent = 'Copy'), 1800);
          },
          () => (copy.textContent = 'Unavailable'),
        );
        return;
      }
      target?.closest?.('.diagram[data-diagram-zoom]')?.classList.toggle('actual-size');
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    const figure = (event.target as HTMLElement | null)?.closest?.('.diagram[data-diagram-zoom]');
    if (figure && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      figure.classList.toggle('actual-size');
    }
  });
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m?.type === 'httpResponse') showResponse(m);
  });
}

/** Makes the zoomable diagrams of a page focusable (call after inserting a page). */
export function enhanceReaderBlocks(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.diagram[data-diagram-zoom]').forEach((figure) => {
    figure.tabIndex = 0;
    figure.title = 'Click to toggle actual size';
  });
}

interface HttpResponse {
  id: string;
  error?: string;
  status: number;
  statusText?: string;
  ms: number;
  size: number;
  truncated?: boolean;
  missing?: string[];
  tests?: Array<{ pass: boolean; source: string; message: string }>;
  binary?: boolean;
  text?: string;
}
function showResponse(m: HttpResponse) {
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
    el('span', `http-status ${m.status < 400 ? 'ok' : 'bad'}`, `${m.status} ${m.statusText || ''}`),
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
        `http-status ${t.pass ? 'ok' : 'bad'}`,
        `${t.pass ? '✓ ' : '✗ '}${t.source} — ${t.message}`,
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

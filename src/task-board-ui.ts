/**
 * Boards embedded in pages (```tasks with `view: board`) in the reader and Studio. A card is
 * dragged to another column, or moved with Alt+←/Alt+→, and the host writes the new status to
 * the task's line. The move shows at once and is undone if the host reports an error.
 */
export interface MovedCard {
  title: string;
  status: string;
  /** Date.now() of the move; focus follows the card through re-renders for a few seconds. */
  at: number;
}
const FOLLOW_MS = 4000;

export function wireTaskBoards(
  post: (m: unknown) => void,
  options: { focus?: MovedCard; remember?: (card: MovedCard | undefined) => void } = {},
) {
  let dragged: HTMLElement | null = null;
  let refocus =
    options.focus && Date.now() - options.focus.at < FOLLOW_MS ? options.focus : undefined;
  const pending = new Map<string, { card: HTMLElement; parent: Element; next: Element | null }>();
  const boardOf = (el: Element) => el.closest<HTMLElement>('.collection-board.interactive');
  const columns = (board: Element) =>
    Array.from(board.querySelectorAll<HTMLElement>('.collection-column[data-status]'));
  const counts = (board: Element) =>
    columns(board).forEach((c) => {
      const n = c.querySelector('.collection-count');
      if (n) n.textContent = String(c.querySelectorAll('.collection-card').length);
    });
  const announce = (board: Element, text: string) => {
    const status = board.parentElement?.querySelector('.collection-status');
    if (status) status.textContent = text;
  };
  const card = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest?.<HTMLElement>(
      '.collection-board.interactive .collection-card[data-task]',
    ) || null;

  const move = (item: HTMLElement, column: HTMLElement, before: Element | null) => {
    const board = boardOf(item);
    const from = item.closest('.collection-column');
    // Order inside a status column is not stored in the page, so only column changes count.
    if (!board || from === column || boardOf(column) !== board) return;
    const key = item.dataset.task!;
    // Moving a node in the DOM drops its focus, so check before moving it.
    const hadFocus = document.activeElement === item;
    pending.set(key, { card: item, parent: item.parentElement!, next: item.nextElementSibling });
    column.querySelector('.collection-cards')!.insertBefore(item, before);
    item.classList.add('saving');
    counts(board);
    const label = column.getAttribute('aria-label') || column.dataset.status!;
    announce(board, `Moved “${item.dataset.title}” to ${label}.`);
    const moved = {
      title: item.dataset.title || '',
      status: column.dataset.status!,
      at: Date.now(),
    };
    refocus = hadFocus ? moved : undefined;
    options.remember?.(refocus);
    setTimeout(() => {
      if (refocus === moved) {
        refocus = undefined;
        options.remember?.(undefined);
      }
    }, FOLLOW_MS);
    post({ type: 'taskMove', key, status: column.dataset.status, keyboard: !!refocus });
  };

  const clearTargets = () =>
    document
      .querySelectorAll('.collection-column.drop-target')
      .forEach((c) => c.classList.remove('drop-target'));

  document.addEventListener('dragstart', (event) => {
    const item = card(event.target);
    if (!item) return;
    event.stopPropagation();
    dragged = item;
    item.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', item.dataset.title || '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragover', (event) => {
    if (!dragged) return;
    const column = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
      '.collection-column[data-status]',
    );
    if (!column || boardOf(column) !== boardOf(dragged)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (!column.classList.contains('drop-target')) {
      clearTargets();
      column.classList.add('drop-target');
    }
  });
  document.addEventListener('drop', (event) => {
    if (!dragged) return;
    const column = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
      '.collection-column[data-status]',
    );
    if (!column) return;
    event.preventDefault();
    event.stopPropagation();
    const before =
      Array.from(column.querySelectorAll<HTMLElement>('.collection-card')).find((c) => {
        if (c === dragged) return false;
        const r = c.getBoundingClientRect();
        return event.clientY < r.top + r.height / 2;
      }) || null;
    move(dragged, column, before);
  });
  document.addEventListener('dragend', () => {
    dragged?.classList.remove('dragging');
    dragged = null;
    clearTargets();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      const item = card(event.target);
      if (!item || !event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'))
        return;
      event.preventDefault();
      event.stopPropagation();
      const board = boardOf(item)!;
      const all = columns(board);
      const index = all.indexOf(item.closest<HTMLElement>('.collection-column')!);
      const target = all[index + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (!target) return;
      move(item, target, null);
      item.focus();
    },
    true,
  );
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m?.type !== 'taskMoved' || typeof m.key !== 'string') return;
    const entry = pending.get(m.key);
    pending.delete(m.key);
    if (!entry) return;
    entry.card.classList.remove('saving');
    if (!m.error) return;
    // Undo the optimistic move.
    if (entry.next?.parentElement === entry.parent)
      entry.parent.insertBefore(entry.card, entry.next);
    else entry.parent.append(entry.card);
    const board = boardOf(entry.card);
    if (board) {
      counts(board);
      announce(board, `Not moved: ${m.error}`);
    }
    refocus = undefined;
    options.remember?.(undefined);
  });
  // The page is rendered again after the edit; keep keyboard focus on the moved card.
  const restore = () => {
    if (!refocus) return;
    if (document.activeElement?.closest?.('.collection-board.interactive')) return;
    const target = Array.from(
      document.querySelectorAll<HTMLElement>(
        `.collection-board.interactive .collection-column[data-status="${CSS.escape(refocus.status)}"] .collection-card`,
      ),
    ).find((c) => c.dataset.title === refocus!.title);
    // Kept until FOLLOW_MS: saving the page can render it more than once.
    if (target) target.focus();
  };
  restore();
  new MutationObserver(restore).observe(document.body, { childList: true, subtree: true });
}

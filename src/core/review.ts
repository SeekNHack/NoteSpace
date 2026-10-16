/**
 * Human review comments in a portable file next to the wiki: `.reviews/<page path>.json`.
 * Plain JSON, one file per page, so reviews travel with the docs through Git or a copy.
 * There is no server and no real-time sync: whoever edits the file last wins, like any file.
 */
export const REVIEW_SCHEMA = 'wiki-studio.review/1';
export const REVIEW_DIR = '.reviews';

export interface ReviewComment {
  id: string;
  author: string;
  /** ISO 8601. */
  created: string;
  body: string;
}
export interface ReviewThread {
  id: string;
  status: 'open' | 'resolved';
  /** 0-based line and the line's text when the thread was anchored, used to follow edits. */
  anchor: { line: number; quote: string };
  comments: ReviewComment[];
}
export interface ReviewFile {
  schema: typeof REVIEW_SCHEMA;
  page: string;
  threads: ReviewThread[];
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

export function parseReview(text: string, page: string): ReviewFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid review file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const d = data as Partial<ReviewFile>;
  if (!d || d.schema !== REVIEW_SCHEMA || !Array.isArray(d.threads))
    throw new Error(`Not a ${REVIEW_SCHEMA} file.`);
  const threads: ReviewThread[] = [];
  for (const t of d.threads as Partial<ReviewThread>[]) {
    if (
      !t ||
      !str(t.id, 64) ||
      !t.anchor ||
      typeof t.anchor.line !== 'number' ||
      !str(t.anchor.quote, 10000) ||
      !Array.isArray(t.comments)
    )
      continue;
    const comments = (t.comments as Partial<ReviewComment>[]).filter(
      (c) => c && str(c.id, 64) && str(c.author, 200) && str(c.created, 64) && str(c.body, 100000),
    ) as ReviewComment[];
    if (!comments.length) continue;
    threads.push({
      id: t.id!,
      status: t.status === 'resolved' ? 'resolved' : 'open',
      anchor: { line: Math.max(0, Math.floor(t.anchor.line)), quote: t.anchor.quote! },
      comments,
    });
  }
  return { schema: REVIEW_SCHEMA, page: typeof d.page === 'string' ? d.page : page, threads };
}

export const serializeReview = (file: ReviewFile) => `${JSON.stringify(file, null, 2)}\n`;

/**
 * Where a thread's anchor is now: the line with the same text nearest the old position, or
 * the old line (clamped) marked `moved: false` when the quoted text no longer exists.
 */
export function reanchor(
  anchor: ReviewThread['anchor'],
  lines: string[],
): { line: number; found: boolean } {
  const quote = anchor.quote.trim();
  if (lines[anchor.line]?.trim() === quote) return { line: anchor.line, found: true };
  let best = -1;
  if (quote)
    for (let i = 0; i < lines.length; i++)
      if (
        lines[i].trim() === quote &&
        (best < 0 || Math.abs(i - anchor.line) < Math.abs(best - anchor.line))
      )
        best = i;
  return best >= 0
    ? { line: best, found: true }
    : { line: Math.min(anchor.line, Math.max(0, lines.length - 1)), found: false };
}

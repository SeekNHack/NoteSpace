import { mergeVisualEdit } from './core/source-merge';

/** Larger bodies skip the verification parse and use Studio's serialization directly. */
const VERIFY_LIMIT = 512 * 1024;

/**
 * The Markdown body Studio should write. Untouched source lines stay byte-identical when the
 * merged result provably parses to the same document Studio shows (`normalize` is the Studio
 * schema's parse + serialize). Runs in the webview, which owns the Tiptap schema.
 */
export function studioBody(
  sourceBody: string,
  next: string,
  baseline: string | undefined,
  normalize: (markdown: string) => string,
): string {
  // Studio keeps an empty trailing paragraph for typing; trailing blank lines carry no meaning.
  next = next.replace(/\s+$/, '');
  baseline = baseline?.replace(/\s+$/, '');
  const same = (a: string, b: string) =>
    normalize(a).replace(/\s+$/, '') === normalize(b).replace(/\s+$/, '');
  const crlf = sourceBody.includes('\r\n') && !/(^|[^\r])\n/.test(sourceBody);
  const lf = crlf ? sourceBody.replace(/\r\n/g, '\n') : sourceBody;
  let candidate = next;
  if (baseline !== undefined && lf.length <= VERIFY_LIMIT && next.length <= VERIFY_LIMIT) {
    const merged = mergeVisualEdit(lf.replace(/\s+$/, ''), baseline, next);
    if (merged !== next) {
      try {
        if (same(merged, next)) candidate = merged;
      } catch {
        candidate = next;
      }
    }
  }
  if (/\n$/.test(lf) && !candidate.endsWith('\n')) candidate += '\n';
  return crlf ? candidate.replace(/\n/g, '\r\n') : candidate;
}

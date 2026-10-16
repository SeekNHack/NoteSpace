/**
 * Studio serializes the whole document, which normalizes Markdown the user never touched
 * (table padding, list markers, blank lines). This applies only the lines that changed
 * between the last serialization Studio sent (`baseline`) and the new one (`next`) to the
 * original `source`, keeping every untouched source line byte-identical.
 *
 * The result is a candidate. Callers must verify it parses to the same document as `next`
 * and fall back to `next` otherwise.
 */
type Pair = [number, number];

const MAX_CELLS = 4_000_000;

/** Equal-line pairs of the longest common subsequence, or undefined when too large. */
function commonLines(a: string[], b: string[]): Pair[] | undefined {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start,
    m = endB - start;
  if (n * m > MAX_CELLS) return undefined;
  const pairs: Pair[] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  if (n && m) {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

const lines = (text: string): string[] => text.split('\n');

export function mergeVisualEdit(source: string, baseline: string, next: string): string {
  if (baseline === next) return source;
  if (source === baseline) return next;
  const s = lines(source),
    a = lines(baseline),
    b = lines(next);
  const toSource = commonLines(a, s),
    toNext = commonLines(a, b);
  if (!toSource || !toNext) return next;
  const anchor = new Map<number, number>(toSource);
  const kept = new Map<number, number>(toNext);
  // Solid lines are identical in baseline, source and next; both maps are monotonic.
  const solid: Array<[number, number, number]> = [[-1, -1, -1]];
  for (let i = 0; i < a.length; i++)
    if (anchor.has(i) && kept.has(i)) solid.push([i, anchor.get(i)!, kept.get(i)!]);
  solid.push([a.length, s.length, b.length]);
  const out: string[] = [];
  for (let k = 1; k < solid.length; k++) {
    const [pa, ps, pb] = solid[k - 1],
      [qa, qs, qb] = solid[k];
    if (qs < ps || qb < pb) return next;
    const between = a.slice(pa + 1, qa),
      changed = b.slice(pb + 1, qb);
    // Untouched by the user: keep the original source text, whatever Studio normalized.
    const untouched =
      between.length === changed.length && between.every((line, i) => line === changed[i]);
    out.push(...(untouched ? s.slice(ps + 1, qs) : changed));
    if (qa < a.length) out.push(s[qs]);
  }
  return out.join('\n');
}

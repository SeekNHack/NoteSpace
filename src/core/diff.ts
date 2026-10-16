/** Line diff (Myers, O((N+M)·D)) with hunks for review views. */
export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
  /** 1-based line numbers in the old / new text. */
  a?: number;
  b?: number;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n?/g, '\n').split('\n'),
    b = newText.replace(/\r\n?/g, '\n').split('\n');
  if (a[a.length - 1] === '' && b[b.length - 1] === '') {
    a.pop();
    b.pop();
  }
  const n = a.length,
    m = b.length,
    max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])
          ? v[k + 1 + max]
          : v[k - 1 + max] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }
  // Backtrack through the saved frontiers.
  const out: DiffLine[] = [];
  let x = n,
    y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const frontier = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && frontier[k - 1 + max] < frontier[k + 1 + max]) ? k + 1 : k - 1;
    const prevX = frontier[prevK + max],
      prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ type: 'same', text: a[x - 1], a: x, b: y });
      x--;
      y--;
    }
    if (d === 0) break;
    if (x === prevX) out.push({ type: 'add', text: b[y - 1], b: y });
    else out.push({ type: 'del', text: a[x - 1], a: x });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    out.push({ type: 'same', text: a[x - 1], a: x, b: y });
    x--;
    y--;
  }
  return out.reverse();
}

export interface Hunk {
  lines: DiffLine[];
}
/** Groups changes with `context` unchanged lines around them. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const changed = lines.map((l, i) => (l.type === 'same' ? -1 : i)).filter((i) => i >= 0);
  const result: Hunk[] = [];
  let start = -1,
    end = -1;
  for (const i of changed) {
    if (start >= 0 && i - context <= end + context) end = i;
    else {
      if (start >= 0)
        result.push({
          lines: lines.slice(
            Math.max(0, start - context),
            Math.min(lines.length, end + context + 1),
          ),
        });
      start = end = i;
    }
  }
  if (start >= 0)
    result.push({
      lines: lines.slice(Math.max(0, start - context), Math.min(lines.length, end + context + 1)),
    });
  return result;
}

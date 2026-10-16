/**
 * Approximate cursor mapping between Studio and Markdown source. Studio only knows rendered
 * text, so we search the source for it, tolerating Markdown markers between words, and pick
 * the match closest to the cursor's relative position in the document.
 */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function locateText(source: string, text: string, ratio = 0): number | undefined {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)?.slice(0, 8);
  if (!words?.length) return undefined;
  const target = Math.max(0, Math.min(1, ratio)) * source.length;
  for (let count = words.length; count >= 1; count--) {
    const pattern = new RegExp(
      words.slice(0, count).map(escapeRegExp).join('[\\s*_`~\\[\\]()!|=<>:#-]+'),
      'gu',
    );
    let best: number | undefined;
    for (const match of source.matchAll(pattern))
      if (best === undefined || Math.abs(match.index! - target) < Math.abs(best - target))
        best = match.index!;
    if (best !== undefined && (count >= 2 || words.length === 1 || words[0].length > 3))
      return best;
  }
  return undefined;
}

/** The visible text of a Markdown source line, without block markers. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|:::[\w-]+\s*)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/[*_`~=]+/g, '')
    .trim();
}

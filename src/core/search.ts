import type { Heading, Page } from './model';

/**
 * Incremental inverted index over page sections (the blocks between headings). Updating a
 * page only re-indexes that page. Ranking is BM25 per section; a page's score is its best
 * section plus title/path boosts, and results carry that section's heading for deep links.
 */
interface Doc {
  pageId: string;
  /** Title and path: lets every term match them, but is never shown as the hit. */
  meta?: boolean;
  heading?: Heading;
  text: string;
  length: number;
}
export interface SectionHit {
  pageId: string;
  heading?: Heading;
  score: number;
  text: string;
}

export const tokenize = (text: string): string[] =>
  text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) || [];

export function sections(page: Page): Array<{ heading?: Heading; text: string }> {
  const out: Array<{ heading?: Heading; text: string }> = [];
  const headings = [...page.headings].sort((a, b) => a.offset - b.offset);
  const bodyStart = page.text.length - page.body.length;
  let start = bodyStart,
    current: Heading | undefined;
  for (const heading of headings) {
    if (heading.offset > start || current)
      out.push({ heading: current, text: page.text.slice(start, heading.offset) });
    current = heading;
    start = heading.offset;
  }
  out.push({ heading: current, text: page.text.slice(start) });
  return out.filter((s) => s.heading || s.text.trim());
}

export class SearchIndex {
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly docs: Array<Doc | undefined> = [];
  private readonly pageDocs = new Map<string, number[]>();
  private readonly free: number[] = [];
  private totalLength = 0;
  private count = 0;

  update(page: Page): void {
    this.remove(page.id);
    const ids: number[] = [];
    const meta = { text: `${page.title}\n${page.path.replace(/[/._-]+/g, ' ')}`, meta: true };
    for (const section of [meta, ...sections(page)] as Array<{
      heading?: Heading;
      text: string;
      meta?: boolean;
    }>) {
      const tokens = tokenize(section.text);
      const id = this.free.pop() ?? this.docs.length;
      this.docs[id] = {
        pageId: page.id,
        heading: section.heading,
        text: section.text,
        length: tokens.length,
        meta: section.meta,
      };
      this.totalLength += tokens.length;
      this.count++;
      const tf = new Map<string, number>();
      for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
      for (const [token, n] of tf) {
        let list = this.postings.get(token);
        if (!list) this.postings.set(token, (list = new Map()));
        list.set(id, n);
      }
      ids.push(id);
    }
    this.pageDocs.set(page.id, ids);
  }

  remove(pageId: string): void {
    for (const id of this.pageDocs.get(pageId) || []) {
      const doc = this.docs[id]!;
      for (const token of new Set(tokenize(doc.text))) {
        const list = this.postings.get(token);
        list?.delete(id);
        if (list && !list.size) this.postings.delete(token);
      }
      this.totalLength -= doc.length;
      this.count--;
      this.docs[id] = undefined;
      this.free.push(id);
    }
    this.pageDocs.delete(pageId);
  }

  clear(): void {
    this.postings.clear();
    this.docs.length = 0;
    this.pageDocs.clear();
    this.free.length = 0;
    this.totalLength = 0;
    this.count = 0;
  }

  /** Tokens of the vocabulary containing `term`; whole-word matches weigh more than partial ones. */
  private expand(term: string): Array<[string, number]> {
    if (this.postings.has(term) && term.length < 3) return [[term, 1]];
    const out: Array<[string, number]> = [];
    for (const token of this.postings.keys())
      if (token === term) out.push([token, 1]);
      else if (token.startsWith(term)) out.push([token, 0.7]);
      else if (term.length >= 3 && token.includes(term)) out.push([token, 0.4]);
    return out;
  }

  /**
   * Best section per page for which every term matches somewhere in the page (AND across the
   * page, so terms may sit in different sections). `pages` limits the candidates.
   */
  query(terms: string[], pages?: Set<string>): Map<string, SectionHit> {
    const words = terms.flatMap((t) => tokenize(t));
    const result = new Map<string, SectionHit>();
    if (!words.length) return result;
    const avg = this.count ? this.totalLength / this.count : 1;
    const k1 = 1.2,
      b = 0.75;
    let candidates: Set<string> | undefined;
    const sectionScores = new Map<number, number>();
    for (const word of words) {
      const pagesWithWord = new Set<string>();
      for (const [token, weight] of this.expand(word)) {
        const list = this.postings.get(token)!;
        const idf = Math.log(1 + (this.count - list.size + 0.5) / (list.size + 0.5));
        for (const [id, tf] of list) {
          const doc = this.docs[id]!;
          if (pages && !pages.has(doc.pageId)) continue;
          pagesWithWord.add(doc.pageId);
          const score =
            weight * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / avg)));
          sectionScores.set(id, (sectionScores.get(id) || 0) + score);
        }
      }
      candidates = candidates
        ? new Set([...candidates].filter((p) => pagesWithWord.has(p)))
        : pagesWithWord;
      if (!candidates.size) return result;
    }
    const meta = new Map<string, number>();
    const best = new Map<string, { id: number; score: number }>();
    for (const [id, score] of sectionScores) {
      const doc = this.docs[id]!;
      if (!candidates!.has(doc.pageId)) continue;
      if (doc.meta) meta.set(doc.pageId, score);
      else if (score > (best.get(doc.pageId)?.score ?? -1)) best.set(doc.pageId, { id, score });
    }
    for (const pageId of candidates!) {
      const section = best.get(pageId);
      const doc = section && this.docs[section.id]!;
      result.set(pageId, {
        pageId,
        heading: doc?.heading,
        text: doc?.text || '',
        score: Math.max(section?.score || 0, meta.get(pageId) || 0),
      });
    }
    return result;
  }
}

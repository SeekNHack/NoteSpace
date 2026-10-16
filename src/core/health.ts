import { WikiIndex } from './index';
import { isExternal, splitTarget } from './paths';

/** Page-link health for the dashboard; asset validation belongs to Validate Wiki. */
export function wikiHealth(index: WikiIndex): {
  pages: number;
  drafts: number;
  unresolvedPages: number;
  withoutIncoming: number;
} {
  const pages = index.all();
  const linked = new Set<string>();
  let unresolvedPages = 0;
  for (const page of pages)
    for (const link of page.links) {
      if (link.kind === 'image' || isExternal(link.target)) continue;
      if (link.kind === 'markdown') {
        const path = splitTarget(link.target).path;
        if (/\.[a-z\d]+$/i.test(path) && !/\.md$/i.test(path)) continue;
      }
      const result = index.resolve(page, link.target, link.kind);
      if (result.error) unresolvedPages++;
      if (result.page && result.page.id !== page.id) linked.add(result.page.id);
    }
  return {
    pages: pages.length,
    drafts: pages.filter((page) => page.draft).length,
    unresolvedPages,
    withoutIncoming: pages.filter((page) => !linked.has(page.id)).length,
  };
}

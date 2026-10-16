import { WikiIndex } from './index';
import { Page } from './model';
import { parsePage } from './markdown';

const directive =
  /^\{\{[ \t]*include[ \t]+"([^"\r\n]{1,240}\.md)"((?:[ \t]+[a-zA-Z][\w-]*="[^"\r\n]{0,240}")*)[ \t]*\}\}[ \t]*$/;
const parameter = /[ \t]+([a-zA-Z][\w-]*)="([^"\r\n]*)"/g;

/** Expand local indexed pages only; no filesystem escape, network, or executable templates. */
export function expandIncludes(
  page: Page,
  index: WikiIndex,
  warn: (message: string) => void = () => {},
): string {
  const expand = (current: Page, body: string, ancestry: Set<string>): string => {
    let fence = '';
    return body
      .split('\n')
      .map((line) => {
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fenceMatch) {
          if (!fence) fence = fenceMatch[1];
          else if (fence[0] === fenceMatch[1][0] && fenceMatch[1].length >= fence.length)
            fence = '';
        }
        if (fence) return line;
        const match = directive.exec(line.replace(/\r$/, ''));
        if (!match) return line;
        const target = match[1];
        const resolved = index.resolve(current, target, 'markdown');
        const included = resolved.page;
        if (!included || resolved.error || included.root !== page.root) {
          warn(`Unavailable include: ${target}`);
          return `> Include unavailable: ${target}`;
        }
        if (ancestry.has(included.id) || ancestry.size >= 12) {
          warn(`Include cycle or depth limit: ${target}`);
          return `> Include cycle or depth limit: ${target}`;
        }
        const values = new Map<string, string>();
        for (const param of match[2].matchAll(parameter)) values.set(param[1], param[2]);
        const substituted = included.body.replace(
          /\{\{([a-zA-Z][\w-]*)\}\}/g,
          (original, key: string) => values.get(key) ?? original,
        );
        return expand(included, substituted, new Set([...ancestry, included.id]));
      })
      .join('\n');
  };
  return expand(page, page.body, new Set([page.id]));
}

export function pageWithIncludes(
  page: Page,
  index: WikiIndex,
  warn?: (message: string) => void,
): Page {
  const body = expandIncludes(page, index, warn);
  if (body === page.body) return page;
  const parsed = parsePage(page.root, page.path, page.uri, body);
  return { ...page, body, headings: parsed.headings, links: parsed.links };
}

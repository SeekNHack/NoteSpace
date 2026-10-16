import type { ApiSpec } from './openapi';
import type { Page } from './model';
import { posix, splitTarget } from './paths';

export interface OperationCoverage {
  id: string;
  method: string;
  path: string;
  summary?: string;
  /** Pages that document the operation: an `openapi` embed of the file, its operationId, or `METHOD /path`. */
  documentedBy: Page[];
}
export interface SpecCoverage {
  /** Path of the description relative to the wiki content root. */
  file: string;
  title: string;
  operations: OperationCoverage[];
  documented: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Documentation coverage of OpenAPI operations, derived only from what the files say: the
 * parsed description on one side, page text and ```openapi embeds on the other.
 */
export function apiCoverage(
  specs: Array<{ file: string; spec: ApiSpec }>,
  pages: Page[],
): SpecCoverage[] {
  return specs.map(({ file, spec }) => {
    const embedding = pages.filter((page) =>
      [...page.text.matchAll(/^```openapi[^\n]*\n([\s\S]*?)^```/gm)].some((match) => {
        const target = /^\s*path\s*:\s*(.+?)\s*$/m.exec(match[1])?.[1];
        if (!target) return false;
        const path = splitTarget(target).path;
        return (
          posix.normalize(
            path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(page.path), path),
          ) === file
        );
      }),
    );
    const operations = spec.operations.map((op) => {
      const id = new RegExp(`(^|[^\\w-])${escapeRegExp(op.id)}([^\\w-]|$)`);
      const route = new RegExp(`\\b${op.method}\\s+\`?${escapeRegExp(op.path)}(?![\\w/{])`, 'i');
      const documentedBy = [
        ...new Set([
          ...embedding,
          ...pages.filter((p) => !embedding.includes(p) && (id.test(p.body) || route.test(p.body))),
        ]),
      ];
      return { id: op.id, method: op.method, path: op.path, summary: op.summary, documentedBy };
    });
    return {
      file,
      title: spec.title,
      operations,
      documented: operations.filter((o) => o.documentedBy.length).length,
    };
  });
}

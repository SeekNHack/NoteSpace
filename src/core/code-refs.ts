/**
 * Code references are ordinary Markdown links to source files, so they stay readable on any
 * Markdown host:
 *
 *   [parsePage](../src/core/markdown.ts#parsePage)          a symbol (function, class, method)
 *   [WikiIndex.search](../src/core/index.ts#WikiIndex.search)  a member, dotted
 *   [the loop](../src/workspace.ts#L120-L140)              lines
 *   [workspace.ts](../src/workspace.ts)                    the file
 */
export const SOURCE_FILE =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|pyi|go|rs|java|kt|kts|cs|fs|cpp|cc|cxx|c|h|hpp|hh|rb|php|swift|scala|sh|bash|zsh|ps1|sql|vue|svelte|dart|lua|r|jl|ex|exs|erl|hs|ml|clj|groovy|gradle|toml|proto|graphql|tf)$/i;

export interface CodeRef {
  path: string;
  symbol?: string;
  line?: number;
  endLine?: number;
}

export function parseCodeRef(target: string): CodeRef | undefined {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) return undefined;
  const hash = target.indexOf('#');
  let path = hash >= 0 ? target.slice(0, hash) : target;
  const fragment = hash >= 0 ? target.slice(hash + 1) : '';
  try {
    path = decodeURI(path);
  } catch {
    /* keep as written */
  }
  if (!SOURCE_FILE.test(path)) return undefined;
  const lines = /^L(\d+)(?:-L?(\d+))?$/.exec(fragment);
  if (lines)
    return { path, line: Number(lines[1]), endLine: lines[2] ? Number(lines[2]) : undefined };
  if (fragment && /^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u.test(fragment))
    return { path, symbol: fragment };
  return { path };
}

export interface SymbolNode {
  name: string;
  /** 0-based line range. */
  start: number;
  end: number;
  children?: SymbolNode[];
}
/** Finds `A.b.c` in a symbol tree (as reported by the language's symbol provider). */
export function findSymbol(symbols: SymbolNode[], path: string): SymbolNode | undefined {
  const parts = path.split('.');
  const clean = (name: string) => name.replace(/\(.*$/, '').trim();
  const walk = (nodes: SymbolNode[], i: number): SymbolNode | undefined => {
    for (const node of nodes) {
      if (clean(node.name) !== parts[i]) continue;
      if (i === parts.length - 1) return node;
      const found = walk(node.children || [], i + 1);
      if (found) return found;
    }
    return undefined;
  };
  const direct = walk(symbols, 0);
  if (direct || parts.length > 1) return direct;
  // A bare name may also refer to a nested member when it is unique.
  const all: SymbolNode[] = [];
  const collect = (nodes: SymbolNode[]) =>
    nodes.forEach((n) => (all.push(n), collect(n.children || [])));
  collect(symbols);
  const matches = all.filter((n) => clean(n.name) === parts[0]);
  return matches.length === 1 ? matches[0] : undefined;
}

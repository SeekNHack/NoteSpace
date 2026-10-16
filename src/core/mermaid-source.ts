/**
 * The bundled renderer only recognises flowchart edges written with spaces (`A --> B`); Mermaid
 * itself accepts `A-->B`. Spaces are added around edge operators outside labels, brackets and
 * quotes before rendering. The page's source is never changed.
 */
const EDGE = /\s*(<?(?:-{2,}|={2,}|-\.+-|~{3,})(?:>|o\b|x\b)?)(\|[^|]*\|)?\s*/g;

export function normalizeMermaid(source: string): string {
  const lines = source.split('\n');
  const first = lines.find((l) => l.trim() && !l.trim().startsWith('%%'))?.trim() || '';
  if (!/^(graph|flowchart)\b/.test(first)) return source;
  return lines
    .map((line) => {
      if (
        /^\s*(%%|graph\b|flowchart\b|subgraph\b|end\b|style\b|classDef\b|class\b|click\b|linkStyle\b)/.test(
          line,
        )
      )
        return line;
      // Split into code and protected segments ([...], (...), {...}, "...", |...|).
      let out = '',
        depth = 0,
        quote = false,
        segment = '';
      const flush = () => {
        out += segment.replace(EDGE, (match, op: string, label = '') =>
          match.trim() ? ` ${op}${label} ` : match,
        );
        segment = '';
      };
      for (const ch of line) {
        if (!quote && depth === 0 && (ch === '[' || ch === '(' || ch === '{' || ch === '"')) {
          flush();
          if (ch === '"') quote = true;
          else depth++;
          out += ch;
          continue;
        }
        if (quote) {
          out += ch;
          if (ch === '"') quote = false;
          continue;
        }
        if (depth > 0) {
          out += ch;
          if (ch === '[' || ch === '(' || ch === '{') depth++;
          else if (ch === ']' || ch === ')' || ch === '}') depth--;
          continue;
        }
        segment += ch;
      }
      flush();
      // Keep indentation; collapse the spaces this introduced at the ends.
      const indent = /^\s*/.exec(line)![0];
      return indent + out.trim().replace(/ {2,}/g, ' ');
    })
    .join('\n');
}

/** Rewrite one page URI after a page or containing folder moves. */
export function movedUri(uri: string, from: string, to: string): string {
  if (uri === from) return to;
  if (uri.startsWith(`${from}/`)) return `${to}${uri.slice(from.length)}`;
  return uri;
}

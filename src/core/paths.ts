import path from 'node:path';
export const posix = path.posix;
export const pageId = (root: string, file: string): string => `${root}\0${file}`;
export function safeRelative(value: string, allowDot = false): string {
  const s = value.trim().replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[a-z]:/i.test(s) || /[\x00-\x1f<>:"|?*#%\[\]]/.test(s))
    throw new Error('Use a relative path without reserved characters.');
  if (
    s
      .split('/')
      .some(
        (p) =>
          p === '..' ||
          (/[. ]$/.test(p) && p !== '.') ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw new Error('The path contains an unsafe or reserved name.');
  const normalized = posix.normalize(s);
  if (normalized === '.' && !allowDot) throw new Error('Enter a page name.');
  return normalized;
}
export function pagePath(value: string): string {
  const p = safeRelative(value);
  if (p.split('/').includes('.notespace-trash'))
    throw new Error('Wiki Trash is reserved for deleted pages.');
  return /\.md$/i.test(p) ? p : `${p}.md`;
}
export function splitTarget(target: string): { path: string; anchor: string } {
  const i = target.indexOf('#');
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return {
    path: decode(i < 0 ? target : target.slice(0, i)),
    anchor: decode(i < 0 ? '' : target.slice(i + 1)),
  };
}
export function isExternal(target: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}
export function insidePath(file: string): boolean {
  return (
    file !== '..' &&
    !file.startsWith('../') &&
    !posix.isAbsolute(file) &&
    !file.includes('\\') &&
    !/[\x00-\x1f]/.test(file)
  );
}
export function encodePath(file: string): string {
  return file.split('/').map(encodeURIComponent).join('/');
}
export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
    .replace(/\s/g, '-');
}
function nameSegment(part: string): string {
  const segment = slug(part.replace(/\./g, '-')).replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!segment) throw new Error('Use letters or numbers in every page or folder name.');
  return segment;
}
/** Turn a user-facing title or nested title into a safe Markdown page path. */
export function namedPage(value: string): { path: string; title: string } {
  const raw = value.trim().replace(/\.md$/i, '');
  const parts = raw.split('/');
  if (parts.some((part) => !part.trim() || /^\.{1,2}$/.test(part.trim())))
    throw new Error('Enter a valid page name.');
  const title = parts.at(-1)!.trim();
  const path = pagePath(parts.map(nameSegment).join('/'));
  return { path, title };
}
/** Folder names use the same slugging rules, but have no Markdown suffix. */
export function namedSection(value: string): { path: string; title: string } {
  const parts = value.trim().split('/');
  if (parts.some((part) => !part.trim() || /^\.{1,2}$/.test(part.trim())))
    throw new Error('Enter a valid folder name.');
  const title = parts.at(-1)!.trim();
  const path = parts.map(nameSegment).join('/');
  pagePath(`${path}/index`);
  return { path, title };
}
/**
 * The path of a URI for comparisons. VS Code hands out the same Windows file as `/C:/…` (from
 * workspace folders) and `/c:/…` (from file search and events); the drive letter is folded so
 * prefix checks and relative paths agree.
 */
export const uriPath = (uri: { path: string }): string =>
  uri.path.replace(/^\/([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}:`);

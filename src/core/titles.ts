/**
 * Readable labels from file and folder names, for the Pages view: `getting-started` →
 * “Getting Started”, `api_reference` → “API Reference”. Pages keep their real title for links;
 * this only changes what the explorer shows for pages whose title is their file name.
 */
export const defaultAcronyms = [
  'API',
  'CLI',
  'CSS',
  'CSV',
  'FAQ',
  'HTML',
  'HTTP',
  'HTTPS',
  'ID',
  'JSON',
  'JWT',
  'OAuth',
  'PDF',
  'REST',
  'SDK',
  'SQL',
  'SSO',
  'UI',
  'URL',
  'UX',
  'XML',
  'YAML',
];

export function humanize(name: string, acronyms: string[] = defaultAcronyms): string {
  const known = new Map(acronyms.map((a) => [a.toLocaleLowerCase(), a]));
  const words = name
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return name;
  return words
    .map((w) => {
      const acronym = known.get(w.toLocaleLowerCase());
      if (acronym) return acronym;
      // Words that already carry capitals (iOS, McDonald, v2API) are left as written.
      if (/\p{Lu}/u.test(w)) return w;
      return w.charAt(0).toLocaleUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** Directory entries in the Pages view: index and README pages first, then the chosen order. */
export type DirectorySort = 'folders-first' | 'files-first' | 'mixed';
export const isFolderIndex = (path: string): boolean => /(^|\/)(index|readme)\.md$/i.test(path);

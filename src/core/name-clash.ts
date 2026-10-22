import { folderPage } from './nav-tree';

export interface NameClash {
  message: string;
  /** `info` explains what will happen; `warning` points at a name that will be confusing. */
  severity: 'info' | 'warning';
}
interface NamedPage {
  id: string;
  path: string;
  title: string;
}

const stem = (path: string) =>
  path.replace(/\/$/, '').replace(/^.*\//, '').replace(/\.md$/i, '').toLowerCase();
const parentOf = (path: string) => path.replace(/\/$/, '').replace(/[^/]*$/, '');

/**
 * Names that differ only in case from what is already in the same folder ("Ciao" next to
 * "ciao"), for a new page (`guide/setup.md`) or a new folder (`guide/setup/`). Exact
 * duplicates are refused elsewhere; this only explains or warns.
 */
export function nameClash(pages: NamedPage[], path: string): NameClash | undefined {
  const folder = path.endsWith('/');
  const parent = parentOf(path);
  const name = stem(path);
  const inParent = pages.filter(
    (p) => p.path.startsWith(parent) && !p.path.slice(parent.length).includes('/'),
  );
  const folders = new Set(
    pages
      .filter((p) => p.path.startsWith(parent) && p.path.slice(parent.length).includes('/'))
      .map((p) => p.path.slice(parent.length).split('/')[0]),
  );
  const sameFolder = [...folders].find((f) => f.toLowerCase() === name);
  if (folder) {
    if (sameFolder)
      return { message: `A folder “${sameFolder}” is already here.`, severity: 'warning' };
    const page = inParent.find((p) => stem(p.path) === name);
    if (page)
      return {
        message: `“${page.title}” will become this folder’s page.`,
        severity: 'info',
      };
    return undefined;
  }
  if (sameFolder) {
    const own = folderPage(pages, `${parent}${sameFolder}/`);
    return own && stem(own.path) !== name
      ? {
          message: `The folder “${sameFolder}” already has its own page, “${own.title}”.`,
          severity: 'warning',
        }
      : { message: `This page will be the page of the folder “${sameFolder}”.`, severity: 'info' };
  }
  const sameTitle = inParent.find((p) => p.title.toLowerCase() === name);
  if (sameTitle)
    return { message: `A page titled “${sameTitle.title}” is already here.`, severity: 'warning' };
  // A page named like the folder it is in: the folder's own page, unless it has one.
  const here = parent.replace(/\/$/, '').replace(/^.*\//, '');
  if (here && here.toLowerCase() === name) {
    const own = folderPage(pages, parent);
    if (own)
      return {
        message: `“${here}” already has its own page, “${own.title}”; this one will be listed inside it.`,
        severity: 'warning',
      };
  }
  return undefined;
}

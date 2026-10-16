import * as vscode from 'vscode';
import { WikiRoot, WikiWorkspace } from './workspace';
import { Page } from './core/model';
import { parseConfig, updateConfig, WikiConfig } from './core/config';
import { contentHash, scopeOf, scopedPath, VERSIONS_DIR } from './core/scopes';
import { withFrontMatter } from './core/frontmatter';
import { posix } from './core/paths';

const configUri = (root: WikiRoot) => {
  if (!root.projectUri || !root.config)
    throw new Error(
      'Languages and versions need a wiki with a wiki.yaml file (run Create Wiki or Import Project).',
    );
  return vscode.Uri.joinPath(root.projectUri, 'wiki.yaml');
};

/** Edits wiki.yaml in place, keeping comments and unrelated settings. */
export async function updateWikiConfig(
  workspace: WikiWorkspace,
  root: WikiRoot,
  change: (config: WikiConfig) => void,
): Promise<void> {
  const uri = configUri(root);
  const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  const config = parseConfig(source);
  change(config);
  const text = updateConfig(source, config);
  parseConfig(text);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  await workspace.refresh();
}

export async function addLanguage(
  workspace: WikiWorkspace,
  root: WikiRoot,
  code: string,
): Promise<void> {
  await updateWikiConfig(workspace, root, (config) => {
    if (!config.i18n.languages.includes(code)) config.i18n.languages.push(code);
  });
}

/** Source page of a translation (same logical path, default language, same version). */
export function translationSource(workspace: WikiWorkspace, page: Page): Page | undefined {
  const root = workspace.rootFor(page);
  const scope = scopeOf(page.path, root.config);
  if (!scope.language) return undefined;
  return workspace.index
    .all(root.id)
    .find((p) => p.path === scopedPath(scope.logical, scope.version));
}

/**
 * Creates `<lang>/<path>` from the source page and records which source text it was made
 * from (`translated_from`), so coverage can tell when the source changes. Never overwrites.
 */
export async function createTranslation(
  workspace: WikiWorkspace,
  page: Page,
  language: string,
): Promise<vscode.Uri> {
  const root = workspace.rootFor(page);
  if (!root.config?.i18n.languages.includes(language))
    throw new Error(
      `“${language}” is not a language of this wiki. Add it with NoteSpace: Add Language.`,
    );
  const scope = scopeOf(page.path, root.config);
  if (scope.language) throw new Error('Open the page in the default language to translate it.');
  const target = scopedPath(scope.logical, scope.version, language);
  const existing = workspace.index.all(root.id).find((p) => p.path === target);
  if (existing) return vscode.Uri.parse(existing.uri);
  const text = withFrontMatter(page.text, { translated_from: contentHash(page.body) });
  return workspace.createPage(root, target, text);
}

/** Records that a translation matches the current source text. */
export async function markTranslationCurrent(
  workspace: WikiWorkspace,
  translation: Page,
): Promise<void> {
  const source = translationSource(workspace, translation);
  if (!source) throw new Error('This page is not a translation of an existing page.');
  const uri = vscode.Uri.parse(translation.uri);
  const document = await vscode.workspace.openTextDocument(uri);
  const text = withFrontMatter(document.getText(), { translated_from: contentHash(source.body) });
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text,
  );
  if (!(await vscode.workspace.applyEdit(edit)))
    throw new Error('VS Code could not update the page.');
  await document.save();
}

/**
 * Copies the current docs (every file under the content root except other archived versions)
 * to `_versions/<id>/` and lists the version in wiki.yaml. Existing files are never replaced.
 */
export async function archiveVersion(
  workspace: WikiWorkspace,
  root: WikiRoot,
  id: string,
  nextCurrent?: string,
): Promise<vscode.Uri> {
  configUri(root);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(id))
    throw new Error('Use letters, digits, dots, dashes or underscores (for example 1.0).');
  if (root.config!.versions.archived.includes(id))
    throw new Error(`Version ${id} is already archived.`);
  const target = vscode.Uri.joinPath(root.uri, VERSIONS_DIR, id);
  try {
    await vscode.workspace.fs.stat(target);
    throw new Error(`${posix.join(VERSIONS_DIR, id)} already exists.`);
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError)) throw e;
  }
  await workspace.assertNoSymlink(root, target);
  await vscode.workspace.fs.createDirectory(target);
  let files = 0;
  const copy = async (from: vscode.Uri, to: vscode.Uri) => {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(from)) {
      if (
        name.startsWith('.') ||
        (from.toString() === root.uri.toString() && name === VERSIONS_DIR)
      )
        continue;
      if (type & vscode.FileType.SymbolicLink) continue;
      const source = vscode.Uri.joinPath(from, name),
        destination = vscode.Uri.joinPath(to, name);
      if (type === vscode.FileType.Directory) {
        await vscode.workspace.fs.createDirectory(destination);
        await copy(source, destination);
      } else if (type === vscode.FileType.File) {
        await vscode.workspace.fs.copy(source, destination, { overwrite: false });
        files++;
      }
    }
  };
  await copy(root.uri, target);
  await updateWikiConfig(workspace, root, (config) => {
    config.versions.archived.push(id);
    if (nextCurrent !== undefined) config.versions.current = nextCurrent;
  });
  workspace.log.appendLine(`Archived ${files} files as version ${id}.`);
  return target;
}

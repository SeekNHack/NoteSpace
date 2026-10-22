import * as vscode from 'vscode';
import { createConfig, defaultConfig, wikiColors } from './core/config';
import { posix, uriPath } from './core/paths';
import type { WikiRoot, WikiWorkspace } from './workspace';

/**
 * Gives a wiki without wiki.yaml its settings file, in place: wiki.yaml is written in the
 * workspace folder and points at the folder the pages are already in, so nothing moves. The
 * name, description, icon and color set for the folder carry over.
 */
export async function createConfigInPlace(
  workspace: WikiWorkspace,
  root: WikiRoot,
): Promise<WikiRoot> {
  if (root.config) return root;
  const relative = posix.relative(uriPath(root.folder.uri), uriPath(root.uri));
  if (!relative || relative === '.' || relative.startsWith('..'))
    throw new Error(
      `“${root.name}” keeps its pages at the top of the workspace folder, where wiki.yaml cannot sit beside them. Move the pages into a subfolder (such as wiki/) and set notespace.root to it, or run Create Wiki.`,
    );
  const configUri = vscode.Uri.joinPath(root.folder.uri, 'wiki.yaml');
  try {
    await vscode.workspace.fs.stat(configUri);
    throw new Error(`${configUri.fsPath} already exists.`);
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError)) throw error;
  }
  const config = defaultConfig(root.name);
  config.content.root = relative;
  config.wiki.description = root.look?.description || '';
  if (root.look?.icon && /^[a-z0-9-]{1,40}$/.test(root.look.icon))
    config.wiki.icon = root.look.icon;
  if (root.look?.color && wikiColors.includes(root.look.color)) config.wiki.color = root.look.color;
  // The site is built next to wiki.yaml; it must not land inside the pages.
  if (relative === 'dist' || relative.startsWith('dist/')) config.build.output = 'site';
  await vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(createConfig(config)));
  await workspace.refresh();
  const next = workspace.roots.find((r) => r.id === configUri.toString());
  if (!next?.config) throw new Error('wiki.yaml was written but could not be read back.');
  return next;
}

/**
 * Settings that live in wiki.yaml (site settings, themes, languages, versions, the configured
 * build) ask once to create it for a wiki that has none, instead of failing.
 */
export async function ensureConfig(
  workspace: WikiWorkspace,
  root: WikiRoot,
  feature: string,
): Promise<WikiRoot | undefined> {
  if (root.config) return root;
  const choice = await vscode.window.showInformationMessage(
    `${feature} are stored in wiki.yaml, which “${root.name}” does not have yet. Create it now? Your pages stay where they are.`,
    { modal: true },
    'Create wiki.yaml',
  );
  if (choice !== 'Create wiki.yaml') return undefined;
  return createConfigInPlace(workspace, root);
}

import * as vscode from 'vscode';
import { templates } from './templates';
import type { WikiRoot, WikiWorkspace } from './workspace';

export interface Template {
  label: string;
  description: string;
  body: string;
}

/** The built-in templates and the wiki's own (`.templates/*.md`, up to 1 MiB each). */
export async function listTemplates(
  workspace: WikiWorkspace,
  root: WikiRoot,
  log: (message: string) => void = () => undefined,
): Promise<Template[]> {
  const custom: Template[] = [];
  const templateDir = vscode.Uri.joinPath(root.uri, '.templates');
  try {
    await workspace.assertNoSymlink(root, templateDir);
    for (const [name, type] of await vscode.workspace.fs.readDirectory(templateDir)) {
      if (type !== vscode.FileType.File || !/\.md$/i.test(name)) continue;
      const uri = vscode.Uri.joinPath(templateDir, name);
      if ((await vscode.workspace.fs.stat(uri)).size > 1024 * 1024) continue;
      custom.push({
        label: name.replace(/\.md$/i, ''),
        description: 'Workspace template',
        body: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
      });
    }
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound'))
      log(`Templates: ${String(e)}`);
  }
  return [...templates, ...custom];
}

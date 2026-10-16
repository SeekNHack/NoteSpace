import * as vscode from 'vscode';
import { createConfig, defaultConfig } from './core/config';
import { planMkDocsImport, unsupportedMkDocsSyntax } from './core/import-project';
import { posix, uriPath } from './core/paths';
import { Page } from './core/model';
import { WikiRoot, WikiWorkspace } from './workspace';

export interface ImportedProject {
  pages: number;
  warnings: string[];
  homepage?: Page;
}

/** Import in place. No Markdown source file is rewritten. */
export async function importMarkdownProject(
  workspace: WikiWorkspace,
  projectUri: vscode.Uri,
): Promise<ImportedProject> {
  const folder = vscode.workspace.getWorkspaceFolder(projectUri);
  if (!folder) throw new Error('Choose a project inside an open workspace folder.');
  const configUri = vscode.Uri.joinPath(projectUri, 'wiki.yaml');
  try {
    await vscode.workspace.fs.stat(configUri);
    throw new Error('This project already has wiki.yaml; its configuration was not changed.');
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound')) throw e;
  }
  const mkdocsUri = vscode.Uri.joinPath(projectUri, 'mkdocs.yml');
  let plan: ReturnType<typeof planMkDocsImport>;
  try {
    const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(mkdocsUri));
    plan = planMkDocsImport(source);
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound')) throw e;
    plan = {
      config: defaultConfig(projectUri.path.split('/').at(-1) || 'Documentation'),
      warnings: [],
    };
  }
  const docsUri = vscode.Uri.joinPath(projectUri, plan.config.content.root);
  const stat = await vscode.workspace.fs.stat(docsUri);
  if (!(stat.type & vscode.FileType.Directory))
    throw new Error('The documentation root is not a folder.');
  const root: WikiRoot = {
    id: configUri.toString(),
    name: plan.config.wiki.title,
    folder,
    uri: docsUri,
    projectUri,
    config: plan.config,
  };
  await workspace.assertNoSymlink(root, docsUri);
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(docsUri, '**/*.md'),
    '**/{node_modules,.git}/**',
    2001,
  );
  if (!files.length) throw new Error('No Markdown pages were found in the documentation folder.');
  if (files.length > 2000)
    throw new Error('Import contains more than 2,000 pages; narrow the project first.');
  const paths = files.map((uri) => posix.relative(uriPath(docsUri), uriPath(uri))).sort();
  plan.config.content.homepage = paths.includes('index.md') ? 'index.md' : paths[0];
  for (const file of files) {
    await workspace.assertNoSymlink(root, file);
    const stat = await vscode.workspace.fs.stat(file);
    if (stat.type !== vscode.FileType.File) throw new Error(`Not a regular page: ${uriPath(file)}`);
    if (stat.size > 1024 * 1024) {
      plan.warnings.push(
        `${file.path}: page was not scanned for MkDocs-specific syntax (over 1 MiB).`,
      );
      continue;
    }
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    plan.warnings.push(
      ...unsupportedMkDocsSyntax(posix.relative(uriPath(docsUri), uriPath(file)), text),
    );
  }
  await vscode.workspace.fs.writeFile(
    configUri,
    new TextEncoder().encode(createConfig(plan.config)),
  );
  await workspace.refresh();
  const homepage = workspace.index
    .all(root.id)
    .find((page) => page.path === plan.config.content.homepage);
  return { pages: files.length, warnings: plan.warnings, homepage };
}

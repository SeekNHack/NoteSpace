import * as vscode from 'vscode';
import { WikiWorkspace } from './workspace';
import { createConfig, defaultConfig } from './core/config';
import { importReport, planVaultImport } from './core/obsidian';
import { posix } from './core/paths';

const MAX_FILES = 5000;

async function walk(
  base: vscode.Uri,
  rel = '',
): Promise<Array<{ path: string; type: vscode.FileType }>> {
  const out: Array<{ path: string; type: vscode.FileType }> = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(
    rel ? vscode.Uri.joinPath(base, rel) : base,
  )) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const path = rel ? `${rel}/${name}` : name;
    if (type & vscode.FileType.SymbolicLink) continue;
    if (type === vscode.FileType.Directory) out.push(...(await walk(base, path)));
    else if (type === vscode.FileType.File) out.push({ path, type });
    if (out.length > MAX_FILES)
      throw new Error(`The vault has more than ${MAX_FILES} files; import a smaller folder.`);
  }
  return out;
}

/** Reads a vault and returns the conversion plan without writing anything. */
export async function planObsidianImport(vault: vscode.Uri) {
  const files = await walk(vault);
  const notes = [];
  for (const f of files.filter((f) => /\.md$/i.test(f.path))) {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vault, f.path));
    if (bytes.length > 2 * 1024 * 1024) continue;
    notes.push({ path: f.path, text: new TextDecoder().decode(bytes) });
  }
  if (!notes.length) throw new Error('No Markdown notes were found in this folder.');
  return planVaultImport(
    notes,
    files.filter((f) => !/\.md$/i.test(f.path)).map((f) => f.path),
  );
}

/**
 * Creates a new wiki at `target` (which must not exist): `wiki.yaml`, `docs/` with converted
 * notes and copied attachments, and `import-report.md`. The vault is only read.
 */
export async function importObsidianVault(
  workspace: WikiWorkspace,
  vault: vscode.Uri,
  target: vscode.Uri,
  plan?: Awaited<ReturnType<typeof planObsidianImport>>,
): Promise<{ pages: number; attachments: number; warnings: string[]; report: vscode.Uri }> {
  if (!vscode.workspace.getWorkspaceFolder(target))
    throw new Error('Choose a destination inside an open workspace folder.');
  if (target.path === vault.path || target.path.startsWith(vault.path.replace(/\/$/, '') + '/'))
    throw new Error('Choose a destination outside the vault so the vault stays untouched.');
  try {
    await vscode.workspace.fs.stat(target);
    throw new Error(`${posix.basename(target.path)} already exists; choose a new folder name.`);
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError)) throw e;
  }
  plan ??= await planObsidianImport(vault);
  const docs = vscode.Uri.joinPath(target, 'docs');
  await vscode.workspace.fs.createDirectory(docs);
  for (const note of plan.notes) {
    const uri = vscode.Uri.joinPath(docs, note.path);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(note.text));
  }
  for (const file of plan.attachments) {
    const uri = vscode.Uri.joinPath(docs, file);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.copy(vscode.Uri.joinPath(vault, file), uri, { overwrite: false });
  }
  const config = defaultConfig(posix.basename(vault.path) || 'Imported vault');
  config.wiki.description = 'Imported from an Obsidian vault';
  const paths = plan.notes.map((n) => n.path);
  config.content.homepage =
    paths.find((p) => /^(index|home|readme)\.md$/i.test(p)) || paths.sort()[0];
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(target, 'wiki.yaml'),
    new TextEncoder().encode(createConfig(config)),
  );
  const report = vscode.Uri.joinPath(target, 'import-report.md');
  await vscode.workspace.fs.writeFile(
    report,
    new TextEncoder().encode(
      importReport(plan, vault.fsPath || vault.path, target.fsPath || target.path),
    ),
  );
  await workspace.refresh();
  return {
    pages: plan.notes.length,
    attachments: plan.attachments.length,
    warnings: plan.warnings,
    report,
  };
}

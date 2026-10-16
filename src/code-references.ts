import * as vscode from 'vscode';
import { WikiWorkspace } from './workspace';
import { Page } from './core/model';
import { CodeRef, findSymbol, parseCodeRef, SymbolNode } from './core/code-refs';
import { posix } from './core/paths';

/** Resolves a code reference relative to its page; it must stay inside the page's workspace folder. */
export function codeUri(page: Page, ref: CodeRef): vscode.Uri {
  const pageUri = vscode.Uri.parse(page.uri);
  const folder = vscode.workspace.getWorkspaceFolder(pageUri);
  const uri =
    ref.path.startsWith('/') && folder
      ? vscode.Uri.joinPath(folder.uri, ref.path)
      : vscode.Uri.joinPath(pageUri, '..', ref.path);
  if (folder && !uri.path.startsWith(folder.uri.path.replace(/\/$/, '') + '/'))
    throw new Error(`“${ref.path}” is outside the workspace folder.`);
  return uri;
}

const toNodes = (symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation>): SymbolNode[] =>
  symbols.map((s) =>
    'children' in s
      ? {
          name: s.name,
          start: s.range.start.line,
          end: s.range.end.line,
          children: toNodes(s.children),
        }
      : { name: s.name, start: s.location.range.start.line, end: s.location.range.end.line },
  );

export type CodeRefStatus =
  | { ok: true; uri: vscode.Uri; range?: vscode.Range }
  | {
      ok: false;
      reason: 'missing-file' | 'missing-symbol' | 'no-symbols' | 'bad-lines' | 'outside';
      message: string;
      uri?: vscode.Uri;
    };

/**
 * Checks a reference with what VS Code knows: the file must exist; symbols are looked up with
 * the language's document symbol provider. Without one (no language extension), the symbol
 * cannot be verified and that is reported as such, not as an error.
 */
export async function checkCodeRef(page: Page, ref: CodeRef): Promise<CodeRefStatus> {
  let uri: vscode.Uri;
  try {
    uri = codeUri(page, ref);
  } catch (e) {
    return { ok: false, reason: 'outside', message: e instanceof Error ? e.message : String(e) };
  }
  let lineCount: number;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) return { ok: true, uri };
    const document = await vscode.workspace.openTextDocument(uri);
    lineCount = document.lineCount;
    if (ref.line !== undefined) {
      const end = ref.endLine ?? ref.line;
      if (ref.line < 1 || end < ref.line || end > lineCount)
        return {
          ok: false,
          reason: 'bad-lines',
          message: `Lines ${ref.line}${ref.endLine ? `–${ref.endLine}` : ''} are outside ${posix.basename(uri.path)} (${lineCount} lines).`,
          uri,
        };
      return { ok: true, uri, range: new vscode.Range(ref.line - 1, 0, end - 1, 0) };
    }
    if (!ref.symbol) return { ok: true, uri };
    const symbols = await vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol | vscode.SymbolInformation>
    >('vscode.executeDocumentSymbolProvider', uri);
    if (!symbols?.length) {
      // Fall back to a declaration search in the text, which works for most languages.
      const text = document.getText();
      const name = ref.symbol.split('.').pop()!;
      const declaration = new RegExp(
        `(?:^|[^\\w$])(?:function|class|interface|type|enum|def|fn|func|struct|trait|const|let|var|val|module|namespace|public|private|protected|static|export)\\s+(?:[\\w$<>,\\[\\]*&]+\\s+)*${name.replace(/\$/g, '\\$')}\\b`,
        'm',
      );
      const match = declaration.exec(text);
      if (match) {
        const line = document.positionAt(match.index + match[0].length).line;
        return { ok: true, uri, range: new vscode.Range(line, 0, line, 0) };
      }
      return {
        ok: false,
        reason: 'no-symbols',
        message: `Cannot verify “${ref.symbol}”: no symbol information is available for ${posix.basename(uri.path)} (install the language's extension).`,
        uri,
      };
    }
    const found = findSymbol(toNodes(symbols), ref.symbol);
    if (!found)
      return {
        ok: false,
        reason: 'missing-symbol',
        message: `“${ref.symbol}” was not found in ${posix.basename(uri.path)}; it may have been renamed or removed.`,
        uri,
      };
    return { ok: true, uri, range: new vscode.Range(found.start, 0, found.end, 0) };
  } catch (e) {
    if (e instanceof vscode.FileSystemError || /ENOENT|not found|nonexistent/i.test(String(e)))
      return { ok: false, reason: 'missing-file', message: `Source file not found: ${ref.path}.` };
    throw e;
  }
}

export async function openCodeRef(page: Page, target: string): Promise<void> {
  const ref = parseCodeRef(target);
  if (!ref) throw new Error(`“${target}” is not a source file reference.`);
  const status = await checkCodeRef(page, ref);
  if (!status.ok && !status.uri) throw new Error(status.message);
  if (!status.ok) void vscode.window.showWarningMessage(status.message);
  const editor = await vscode.window.showTextDocument(status.uri!, { preview: true });
  if (status.ok && status.range) {
    editor.selection = new vscode.Selection(status.range.start, status.range.start);
    editor.revealRange(status.range, vscode.TextEditorRevealType.AtTop);
  }
}

/** Diagnostics, links in Code mode and commands for code references. */
export function registerCodeReferences(
  context: vscode.ExtensionContext,
  workspace: WikiWorkspace,
): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('wikiStudio.code');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const validate = async () => {
    const current = ++revision;
    const out: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];
    for (const page of workspace.index.all()) {
      if (workspace.isArchived(page)) continue;
      const items: vscode.Diagnostic[] = [];
      const refs = page.links.filter((l) => l.kind === 'markdown' && parseCodeRef(l.target));
      if (!refs.length) continue;
      const offsets = [0];
      for (let i = 0; i < page.text.length; i++) if (page.text[i] === '\n') offsets.push(i + 1);
      const pos = (offset: number) => {
        let line = offsets.findIndex((o) => o > offset) - 1;
        if (line < 0) line = offsets.length - 1;
        return new vscode.Position(line, offset - offsets[line]);
      };
      for (const link of refs) {
        const status = await checkCodeRef(page, parseCodeRef(link.target)!);
        if (status.ok) continue;
        const d = new vscode.Diagnostic(
          new vscode.Range(pos(link.targetStart), pos(link.targetEnd)),
          status.message,
          status.reason === 'no-symbols'
            ? vscode.DiagnosticSeverity.Information
            : vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'NoteSpace';
        d.code = `code-ref-${status.reason}`;
        items.push(d);
      }
      out.push([vscode.Uri.parse(page.uri), items]);
      if (current !== revision) return;
    }
    if (current !== revision) return;
    diagnostics.clear();
    diagnostics.set(out);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => void validate().catch((e) => workspace.log.appendLine(`[code refs] ${String(e)}`)),
      800,
    );
  };
  const sourceWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    diagnostics,
    sourceWatcher,
    workspace.onDidChange(schedule),
    // Renamed or deleted symbols show up when source files change.
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (!workspace.index.byUri(d.uri.toString())) schedule();
    }),
    sourceWatcher.onDidDelete(schedule),
    vscode.languages.registerDocumentLinkProvider(
      { language: 'markdown' },
      {
        provideDocumentLinks(document) {
          const page = workspace.index.byUri(document.uri.toString());
          if (!page) return [];
          return page.links
            .filter((l) => l.kind === 'markdown' && parseCodeRef(l.target))
            .map((l) => {
              const link = new vscode.DocumentLink(
                new vscode.Range(
                  document.positionAt(l.targetStart),
                  document.positionAt(l.targetEnd),
                ),
                vscode.Uri.parse(
                  `command:wikiStudio.openCodeRef?${encodeURIComponent(JSON.stringify([page.uri, l.target]))}`,
                ),
              );
              link.tooltip = 'Open the referenced source';
              return link;
            });
        },
      },
    ),
  );
  schedule();
}

/** Pages whose code references point at `file`. */
export function pagesReferencing(
  workspace: WikiWorkspace,
  file: vscode.Uri,
): Array<{ page: Page; target: string }> {
  const out: Array<{ page: Page; target: string }> = [];
  for (const page of workspace.index.all()) {
    for (const link of page.links) {
      const ref = link.kind === 'markdown' ? parseCodeRef(link.target) : undefined;
      if (!ref) continue;
      try {
        if (codeUri(page, ref).toString() === file.toString())
          out.push({ page, target: link.target });
      } catch {
        /* outside the workspace */
      }
    }
  }
  return out;
}

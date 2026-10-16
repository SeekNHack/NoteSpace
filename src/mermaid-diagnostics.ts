import * as vscode from 'vscode';
import { mermaidSvg } from './diagrams';
import { WikiWorkspace } from './workspace';

/**
 * Parses ```mermaid fences of open wiki pages (debounced) and reports render errors as
 * diagnostics on the fence, so Code mode shows the same problems as Studio's preview.
 */
export function registerMermaidDiagnostics(workspace: WikiWorkspace): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection('notespace.mermaid');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const check = async (document: vscode.TextDocument) => {
    if (!workspace.index.byUri(document.uri.toString())) return;
    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    for (const match of text.matchAll(/^(`{3,}|~{3,})mermaid[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm)) {
      try {
        await mermaidSvg(match[2]);
      } catch (error) {
        const start = document.positionAt(match.index!);
        const end = document.positionAt(match.index! + match[0].length);
        const d = new vscode.Diagnostic(
          new vscode.Range(start, end),
          `Mermaid: ${error instanceof Error ? error.message : String(error)}`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'NoteSpace';
        d.code = 'mermaid';
        diagnostics.push(d);
      }
    }
    if (document.getText() === text) collection.set(document.uri, diagnostics);
  };
  const schedule = (document: vscode.TextDocument) => {
    if (document.languageId !== 'markdown') return;
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => void check(document).catch(() => undefined), 600),
    );
  };
  vscode.workspace.textDocuments.forEach(schedule);
  const subscriptions = [
    collection,
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri)),
  ];
  return new vscode.Disposable(() => {
    timers.forEach((t) => clearTimeout(t));
    subscriptions.forEach((s) => s.dispose());
  });
}

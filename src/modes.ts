import * as vscode from 'vscode';

export const STUDIO_VIEW_TYPE = 'notespace.visual';
export type EditorMode = 'studio' | 'code' | 'split';

const same = (a: vscode.Uri, b: vscode.Uri) => a.toString() === b.toString();
const isStudioTab = (tab: vscode.Tab, uri: vscode.Uri) =>
  tab.input instanceof vscode.TabInputCustom &&
  tab.input.viewType === STUDIO_VIEW_TYPE &&
  same(tab.input.uri, uri);
const isCodeTab = (tab: vscode.Tab, uri: vscode.Uri) =>
  tab.input instanceof vscode.TabInputText && same(tab.input.uri, uri);

function groupFor(column?: vscode.ViewColumn): vscode.TabGroup | undefined {
  const groups = vscode.window.tabGroups.all;
  if (!column || column === vscode.ViewColumn.Active) return vscode.window.tabGroups.activeTabGroup;
  return groups.find((group) => group.viewColumn === column);
}

/** The mode a resource is shown in, judged from visible tabs across editor groups. */
export function modeOf(uri: vscode.Uri): EditorMode | undefined {
  const visible = vscode.window.tabGroups.all.flatMap((group) =>
    group.activeTab ? [group.activeTab] : [],
  );
  const studio = visible.some((tab) => isStudioTab(tab, uri));
  const code = visible.some((tab) => isCodeTab(tab, uri));
  if (studio && code) return 'split';
  if (studio) return 'studio';
  if (code) return 'code';
  return undefined;
}

/** Column that currently shows Studio for `uri`, if any. */
export function studioColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
  return vscode.window.tabGroups.all.find((group) => group.tabs.some((t) => isStudioTab(t, uri)))
    ?.viewColumn;
}

/** Closes companion tabs for `uri`; unsaved content is protected by `preserving`. */
async function closeReplaced(
  uri: vscode.Uri,
  column: vscode.ViewColumn | undefined,
  match: (tab: vscode.Tab) => boolean,
): Promise<void> {
  // Tab objects are snapshots; look them up again right before closing.
  const tabs = vscode.window.tabGroups.all
    .filter((group) => column === undefined || group.viewColumn === column)
    .flatMap((group) => group.tabs.filter(match));
  if (tabs.length) await preserving(uri, () => vscode.window.tabGroups.close(tabs, true));
}

let reopenCommands: Promise<{ generic: boolean; text: boolean }> | undefined;
/** VS Code's own "Reopen Editor With" replaces the active editor in place and keeps dirty state. */
async function reopenActive(override: 'default' | typeof STUDIO_VIEW_TYPE): Promise<boolean> {
  reopenCommands ||= Promise.resolve(vscode.commands.getCommands(true)).then((all) => ({
    generic: all.includes('reopenActiveEditorWith'),
    text: all.includes('workbench.action.reopenTextEditor'),
  }));
  const available = await reopenCommands;
  if (available.generic) {
    await vscode.commands.executeCommand('reopenActiveEditorWith', override);
    return true;
  }
  if (override === 'default' && available.text) {
    await vscode.commands.executeCommand('workbench.action.reopenTextEditor');
    return true;
  }
  return false;
}
/**
 * Some VS Code versions revert a dirty custom text editor when "Reopen Editor With" replaces
 * it. Snapshot the text and, if the platform reverted it, re-apply the snapshot as one edit so
 * the user's unsaved content and dirty state survive the mode switch.
 */
async function preserving<T>(uri: vscode.Uri, action: () => Thenable<T> | Promise<T>): Promise<T> {
  const before = vscode.workspace.textDocuments.find((doc) => same(doc.uri, uri));
  const snapshot = before?.isDirty ? before.getText() : undefined;
  const result = await action();
  if (snapshot === undefined) return result;
  const document = await vscode.workspace.openTextDocument(uri);
  const current = document.getText();
  if (current !== snapshot) {
    let start = 0;
    while (start < current.length && start < snapshot.length && current[start] === snapshot[start])
      start++;
    let endCurrent = current.length,
      endSnapshot = snapshot.length;
    while (
      endCurrent > start &&
      endSnapshot > start &&
      current[endCurrent - 1] === snapshot[endSnapshot - 1]
    ) {
      endCurrent--;
      endSnapshot--;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(start), document.positionAt(endCurrent)),
      snapshot.slice(start, endSnapshot),
    );
    await vscode.workspace.applyEdit(edit);
  }
  return result;
}
const activeIs = (uri: vscode.Uri, kind: 'studio' | 'code') => {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return !!tab && (kind === 'studio' ? isStudioTab(tab, uri) : isCodeTab(tab, uri));
};

/** Shows the native text editor, replacing a Studio tab in the same group. */
export async function showCode(
  uri: vscode.Uri,
  options: {
    column?: vscode.ViewColumn;
    selection?: vscode.Range;
    replace?: boolean;
    preserveFocus?: boolean;
  } = {},
): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(uri);
  const group = groupFor(options.column);
  if (
    options.replace &&
    activeIs(uri, 'studio') &&
    group === vscode.window.tabGroups.activeTabGroup
  )
    await preserving(uri, () => reopenActive('default'));
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: options.column ?? group?.viewColumn,
    preview: false,
    preserveFocus: options.preserveFocus,
    selection: options.selection,
  });
  if (options.selection)
    editor.revealRange(options.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  if (options.replace) await closeReplaced(uri, editor.viewColumn, (tab) => isStudioTab(tab, uri));
  return editor;
}

/** Shows Studio, replacing a native text tab for the same file in the same group. */
export async function showStudio(
  uri: vscode.Uri,
  options: { column?: vscode.ViewColumn; replace?: boolean; preserveFocus?: boolean } = {},
): Promise<void> {
  const group = groupFor(options.column);
  // Studio is single-instance per page: reveal an existing Studio tab instead of duplicating it.
  const existing = options.column === undefined ? studioColumn(uri) : undefined;
  const column = options.column ?? existing ?? group?.viewColumn;
  if (existing !== undefined && !options.replace) {
    await vscode.commands.executeCommand('vscode.openWith', uri, STUDIO_VIEW_TYPE, {
      viewColumn: existing,
      preview: false,
      preserveFocus: options.preserveFocus,
    });
    return;
  }
  if (
    options.replace &&
    activeIs(uri, 'code') &&
    group === vscode.window.tabGroups.activeTabGroup &&
    (await preserving(uri, () => reopenActive(STUDIO_VIEW_TYPE)))
  )
    return;
  await vscode.commands.executeCommand('vscode.openWith', uri, STUDIO_VIEW_TYPE, {
    viewColumn: column,
    preview: false,
    preserveFocus: options.preserveFocus,
  });
  if (options.replace)
    await closeReplaced(uri, studioColumn(uri) ?? column, (tab) => isCodeTab(tab, uri));
}

/** Studio on the left, native Markdown beside it; both edit the same TextDocument. */
export async function showSplit(uri: vscode.Uri, selection?: vscode.Range): Promise<void> {
  const column = studioColumn(uri) ?? groupFor()?.viewColumn ?? vscode.ViewColumn.One;
  if (!studioColumn(uri)) await showStudio(uri, { column, replace: true });
  const studioAt = studioColumn(uri) ?? column;
  // Prefer an existing Code tab in another group; otherwise open one beside Studio.
  const beside = vscode.window.tabGroups.all.find(
    (group) => group.viewColumn !== studioAt && group.tabs.some((tab) => isCodeTab(tab, uri)),
  );
  await showCode(uri, {
    column: beside?.viewColumn ?? ((studioAt + 1) as vscode.ViewColumn),
    selection,
    preserveFocus: true,
  });
  await closeReplaced(uri, studioAt, (tab) => isCodeTab(tab, uri));
}

/** Leaves Split mode by closing the companion editor and keeping `keep` in place. */
export async function closeCompanion(uri: vscode.Uri, keep: 'studio' | 'code'): Promise<boolean> {
  await closeReplaced(uri, undefined, (tab) =>
    keep === 'studio' ? isCodeTab(tab, uri) : isStudioTab(tab, uri),
  );
  return true;
}

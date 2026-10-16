import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { diffLines, hunks } from './core/diff';
import { escapeHtml } from './core/render';
import { tokensCss } from './core/design';

/**
 * Page history from Git. Only read-only Git commands are ever run; "restore" replaces the
 * editor text with an older version as an ordinary, undoable edit — no checkout, reset or commit.
 */
const READ_ONLY = new Set(['rev-parse', 'log', 'show', 'status', 'for-each-ref', 'ls-tree']);

export function git(args: string[], cwd: string): Promise<string> {
  const allowed = READ_ONLY.has(args[0]) || (args[0] === 'config' && args[1] === '--get');
  if (!allowed) return Promise.reject(new Error(`git ${args[0]} is not allowed here.`));
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 15000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          reject(
            new Error(
              code === 'ENOENT'
                ? 'Git is not installed or not on PATH.'
                : (stderr || error.message).trim(),
            ),
          );
        } else resolve(stdout);
      },
    ),
  );
}

export interface Commit {
  sha: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  /** Repository-relative path of the file in that commit (follows renames). */
  path: string;
}

/** Repository containing a folder (repositoryOf looks at a file's folder). */
export const repositoryOfFolder = (folder: vscode.Uri): Promise<string | undefined> =>
  repositoryOf(vscode.Uri.joinPath(folder, '.notespace-probe'));
export async function repositoryOf(file: vscode.Uri): Promise<string | undefined> {
  if (file.scheme !== 'file') return undefined;
  try {
    return (
      (await git(['rev-parse', '--show-toplevel'], path.dirname(file.fsPath))).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export async function pageHistory(
  file: vscode.Uri,
  limit = 200,
): Promise<{ repo: string; relative: string; commits: Commit[]; modified: boolean } | undefined> {
  const repo = await repositoryOf(file);
  if (!repo) return undefined;
  const relative = path.relative(repo, file.fsPath).split(path.sep).join('/');
  const out = await git(
    [
      'log',
      '--follow',
      `--max-count=${limit}`,
      '--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s',
      '--name-only',
      '--',
      relative,
    ],
    repo,
  );
  const commits: Commit[] = [];
  for (const record of out.split('\x1e').slice(1)) {
    const [head, ...rest] = record.split('\n');
    const [sha, short, author, date, subject] = head.split('\x1f');
    const paths = rest.map((l) => l.trim()).filter(Boolean);
    commits.push({ sha, short, author, date, subject, path: paths[paths.length - 1] || relative });
  }
  const status = await git(['status', '--porcelain', '--', relative], repo);
  return { repo, relative, commits, modified: !!status.trim() };
}

export const contentAt = (repo: string, sha: string, file: string) =>
  git(['show', `${sha}:${file}`], repo);

/** `wiki-git:` documents: read-only text of a file at a commit, for VS Code's diff editor. */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'wiki-git';
  static uri(repo: string, sha: string, file: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: GitContentProvider.scheme,
      path: `/${file}`,
      query: JSON.stringify({ repo, sha, file }),
    });
  }
  provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { repo, sha, file } = JSON.parse(uri.query) as {
      repo: string;
      sha: string;
      file: string;
    };
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('Invalid commit.');
    return contentAt(repo, sha, file);
  }
}

/** Replaces the page text with `text` as one undoable edit; the file is not saved. */
export async function restoreText(file: vscode.Uri, text: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(file);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    file,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text,
  );
  if (!(await vscode.workspace.applyEdit(edit)))
    throw new Error('VS Code could not apply the restored text.');
}

const relativeDate = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days <= 0
    ? 'today'
    : days === 1
      ? 'yesterday'
      : days < 31
        ? `${days} days ago`
        : new Date(iso).toLocaleDateString();
};

export function diffHtml(before: string, after: string): string {
  const groups = hunks(diffLines(before, after));
  if (!groups.length) return '<p class="muted">No differences.</p>';
  return groups
    .map(
      (h) =>
        `<table class="diff" role="table"><tbody>${h.lines
          .map(
            (l) =>
              `<tr class="${l.type}"><td class="n">${l.a ?? ''}</td><td class="n">${l.b ?? ''}</td><td class="sign" aria-label="${l.type === 'add' ? 'added' : l.type === 'del' ? 'removed' : 'unchanged'}">${l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</td><td class="t">${escapeHtml(l.text) || ' '}</td></tr>`,
          )
          .join('')}</tbody></table>`,
    )
    .join('<div class="gap" aria-hidden="true">⋯</div>');
}

let panel: vscode.WebviewPanel | undefined;
let listener: vscode.Disposable | undefined;
/** A visual history: commits on the left, what changed on the right, actions to compare or restore. */
export async function showPageHistory(file: vscode.Uri, title: string): Promise<void> {
  const history = await pageHistory(file);
  if (!history) throw new Error('This page is not inside a Git repository.');
  if (!history.commits.length) throw new Error('This page has no committed history yet.');
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'notespace.history',
      'Page History',
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      listener?.dispose();
    });
  }
  listener?.dispose();
  const current = panel;
  current.title = `History: ${title}`;
  let selected = 0,
    mode: 'commit' | 'current' = 'commit';
  const render = async () => {
    const commit = history.commits[selected];
    const parent = history.commits[selected + 1];
    const atCommit = await contentAt(history.repo, commit.sha, commit.path);
    const document = await vscode.workspace.openTextDocument(file);
    const before =
      mode === 'commit'
        ? parent
          ? await contentAt(history.repo, parent.sha, parent.path)
          : ''
        : atCommit;
    const after = mode === 'commit' ? atCommit : document.getText();
    const nonce = randomBytes(16).toString('base64');
    current.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><title>History: ${escapeHtml(title)}</title><style>${tokensCss}
body{margin:0;background:var(--ws-bg);color:var(--ws-fg);font:13px var(--ws-font)}
.layout{display:grid;grid-template-columns:minmax(220px,300px) 1fr;height:100vh}
nav{border-right:1px solid var(--ws-hairline);overflow:auto;padding:12px 8px}
nav h1{font-size:14px;margin:0 6px 2px}nav p{margin:0 6px 10px;color:var(--ws-muted);font-size:12px}
nav ol{list-style:none;margin:0;padding:0}
nav button{display:block;width:100%;text-align:left;border:0;background:none;color:var(--ws-fg);padding:6px 8px;border-radius:var(--ws-r1);cursor:pointer;font:inherit}
nav button:hover{background:var(--ws-hover)}nav button[aria-current="true"]{background:var(--ws-selection)}
nav .meta{display:block;color:var(--ws-muted);font-size:11.5px}nav button[aria-current="true"] .meta{color:inherit}
main{overflow:auto;padding:16px 20px}
main h2{font-size:15px;margin:0 0 4px}.muted{color:var(--ws-muted)}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.btn{height:28px;padding:0 12px;border-radius:var(--ws-r1);border:1px solid transparent;background:var(--vscode-button-secondaryBackground,var(--ws-surface-2));color:var(--vscode-button-secondaryForeground,var(--ws-fg));cursor:pointer;font:inherit}
.btn.primary{background:var(--vscode-button-background,var(--ws-accent));color:var(--vscode-button-foreground,#fff)}
.btn[aria-pressed="true"]{outline:1px solid var(--ws-focus)}
:focus-visible{outline:1px solid var(--ws-focus);outline-offset:1px}
.diff{border-collapse:collapse;width:100%;font:12px var(--ws-mono);margin:6px 0}
.diff td{padding:0 6px;vertical-align:top;white-space:pre-wrap;word-break:break-word}
.diff .n{width:3.5em;text-align:right;color:var(--ws-muted);user-select:none}.diff .sign{width:1em;user-select:none}
.diff tr.add{background:color-mix(in srgb,var(--ws-green) 16%,transparent)}.diff tr.del{background:color-mix(in srgb,var(--ws-red) 16%,transparent)}
.gap{color:var(--ws-muted);padding:2px 8px}
.note{padding:6px 10px;border-left:3px solid var(--ws-orange);background:var(--ws-surface)}
</style></head><body><div class="layout"><nav aria-label="Commits"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(history.relative)} · ${history.commits.length} commit${history.commits.length === 1 ? '' : 's'}</p>${history.modified ? '<p class="note">The page has uncommitted changes.</p>' : ''}<ol>${history.commits
      .map(
        (c, i) =>
          `<li><button data-index="${i}" aria-current="${i === selected}">${escapeHtml(c.subject || '(no message)')}<span class="meta">${escapeHtml(c.short)} · ${escapeHtml(c.author)} · ${escapeHtml(relativeDate(c.date))}${c.path !== history.relative ? ` · was ${escapeHtml(c.path)}` : ''}</span></button></li>`,
      )
      .join(
        '',
      )}</ol></nav><main><h2>${escapeHtml(commit.subject || '(no message)')}</h2><p class="muted">${escapeHtml(commit.short)} by ${escapeHtml(commit.author)}, ${escapeHtml(new Date(commit.date).toLocaleString())}</p><div class="actions" role="toolbar" aria-label="Compare"><button class="btn" data-mode="commit" aria-pressed="${mode === 'commit'}">Changes in this commit</button><button class="btn" data-mode="current" aria-pressed="${mode === 'current'}">From this version to now</button><button class="btn" data-action="diff">Open in diff editor</button><button class="btn primary" data-action="restore">Restore this version…</button></div><section aria-live="polite" aria-label="Differences">${diffHtml(before, after)}</section></main></div><script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-index]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'select',index:Number(b.dataset.index)})));document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'mode',mode:b.dataset.mode})));document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:b.dataset.action})));</script></body></html>`;
  };
  listener = current.webview.onDidReceiveMessage(
    async (m: { type?: string; index?: number; mode?: string }) => {
      try {
        if (m.type === 'select' && typeof m.index === 'number' && history.commits[m.index])
          selected = m.index;
        else if (m.type === 'mode' && (m.mode === 'commit' || m.mode === 'current')) mode = m.mode;
        else if (m.type === 'diff') {
          const c = history.commits[selected];
          await vscode.commands.executeCommand(
            'vscode.diff',
            GitContentProvider.uri(history.repo, c.sha, c.path),
            file,
            `${title} (${c.short}) ↔ current`,
          );
          return;
        } else if (m.type === 'restore') {
          const c = history.commits[selected];
          const choice = await vscode.window.showWarningMessage(
            `Replace the page text with the version from ${c.short}?`,
            {
              modal: true,
              detail:
                'The page text is replaced and saved as a normal edit. Undo in the editor reverts it; Git history is not modified (no checkout, reset or commit).',
            },
            'Restore',
          );
          if (choice !== 'Restore') return;
          await restoreText(file, await contentAt(history.repo, c.sha, c.path));
          const restored = await vscode.workspace.openTextDocument(file);
          const saved = await restored.save();
          void vscode.window.showInformationMessage(
            saved
              ? `Restored the version from ${c.short} and saved the page. Undo in the editor reverts it.`
              : `Restored ${c.short} as unsaved changes.`,
          );
          mode = 'current';
        }
        await render();
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
  );
  await render();
  current.reveal();
}

/**
 * Last commit date of every file under `folder`, from one `git log` over the latest 5000
 * commits. Files not committed in that window (or not committed at all) are left out.
 */
export async function lastCommitDates(
  folder: vscode.Uri,
): Promise<{ repo: string; dates: Map<string, string> } | undefined> {
  const repo = await repositoryOfFolder(folder);
  if (!repo) return undefined;
  const relative = path.relative(repo, folder.fsPath).split(path.sep).join('/') || '.';
  const out = await git(
    ['log', '--max-count=5000', '--format=%x1e%aI', '--name-only', '--no-renames', '--', relative],
    repo,
  );
  const dates = new Map<string, string>();
  for (const record of out.split('\x1e')) {
    const [date, ...files] = record.trim().split('\n');
    if (!date) continue;
    for (const file of files) {
      const absolute = path.join(repo, file.trim());
      if (file.trim() && !dates.has(absolute)) dates.set(absolute, date.trim());
    }
  }
  return { repo, dates };
}

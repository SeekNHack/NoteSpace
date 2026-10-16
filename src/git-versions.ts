import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { git, GitContentProvider, repositoryOfFolder, diffHtml, repoRelative } from './git-history';
import { WikiRoot, WikiWorkspace } from './workspace';
import { parsePage } from './core/markdown';
import { WikiIndex } from './core/index';
import { Page } from './core/model';
import { posix } from './core/paths';
import { contentCss, escapeHtml, renderPage } from './core/render';

/**
 * Documentation as it was at a Git tag or branch. Everything is read with read-only Git
 * commands (`for-each-ref`, `rev-parse`, `ls-tree`, `show`) into an in-memory snapshot pinned to
 * one commit: nothing is checked out and no file in the working tree is written.
 */
export interface GitRef {
  name: string;
  kind: 'tag' | 'branch';
  date: string;
}

const SAFE_REF = /^(?!-)[\w][\w./@+-]{0,199}$/;
const MAX_PAGES = 3000;

export async function listRefs(repo: string): Promise<GitRef[]> {
  const out = await git(
    [
      'for-each-ref',
      '--sort=-creatordate',
      '--format=%(refname)%09%(creatordate:short)',
      'refs/tags',
      'refs/heads',
    ],
    repo,
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, date] = line.split('\t');
      const tag = ref.startsWith('refs/tags/');
      return {
        name: ref.replace(/^refs\/(tags|heads)\//, ''),
        kind: tag ? 'tag' : 'branch',
        date: date || '',
      } as GitRef;
    })
    .filter((r) => SAFE_REF.test(r.name));
}

export interface Snapshot {
  ref: string;
  sha: string;
  repo: string;
  /** Content root relative to the repository. */
  base: string;
  index: WikiIndex;
  pages: Page[];
  truncated: boolean;
}

export async function loadSnapshot(root: WikiRoot, ref: string): Promise<Snapshot> {
  if (!SAFE_REF.test(ref)) throw new Error(`“${ref}” is not a branch or tag name.`);
  const repo = await repositoryOfFolder(root.uri);
  if (!repo) throw new Error('This wiki is not inside a Git repository.');
  const sha = (
    await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).catch(() => '')
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${ref} does not name a commit.`);
  const base = await repoRelative(repo, root.uri.fsPath);
  const listing = await git(['ls-tree', '-r', '-z', '--name-only', sha, '--', base || '.'], repo);
  const files = listing
    .split('\0')
    .filter(
      (f) => /\.md$/i.test(f) && !/(^|\/)(\.notespace-trash|_versions|node_modules)\//.test(f),
    );
  const truncated = files.length > MAX_PAGES;
  const pages: Page[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < Math.min(files.length, MAX_PAGES)) {
        const file = files[cursor++];
        const text = await git(['show', `${sha}:${file}`], repo);
        const relative = base ? file.slice(base.length + 1) : file;
        pages.push(parsePage(`git:${sha}`, relative, `wiki-snapshot:/${sha}/${relative}`, text));
      }
    }),
  );
  const index = new WikiIndex();
  index.replace(pages);
  return { ref, sha, repo, base, index, pages: index.all(), truncated };
}

/** Pages only in the snapshot, only in the working tree, and changed between the two. */
export function compareSnapshot(snapshot: Snapshot, current: Page[]) {
  const now = new Map(current.map((p) => [p.path, p]));
  const then = new Map(snapshot.pages.map((p) => [p.path, p]));
  return {
    removed: snapshot.pages.filter((p) => !now.has(p.path)),
    added: current.filter((p) => !then.has(p.path)),
    changed: snapshot.pages.filter(
      (p) =>
        now.has(p.path) &&
        now.get(p.path)!.text.replace(/\r\n/g, '\n') !== p.text.replace(/\r\n/g, '\n'),
    ),
  };
}

let panel: vscode.WebviewPanel | undefined;
let listener: vscode.Disposable | undefined;

export async function browseGitVersion(
  workspace: WikiWorkspace,
  root: WikiRoot,
  ref: string,
): Promise<Snapshot> {
  const snapshot = await loadSnapshot(root, ref);
  const current = workspace.index.all(root.id).filter((p) => !workspace.isArchived(p));
  const diff = compareSnapshot(snapshot, current);
  const removed = new Set(diff.removed.map((p) => p.path));
  const changed = new Set(diff.changed.map((p) => p.path));
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'notespace.gitVersion',
      'Version',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      listener?.dispose();
    });
  }
  listener?.dispose();
  const view = panel;
  view.title = `${root.name} @ ${ref}`;
  const short = snapshot.sha.slice(0, 7);
  const homepage = root.config?.content.homepage || 'index.md';
  let selected = snapshot.index.all().find((p) => p.path === homepage) || snapshot.pages[0];
  let mode: 'page' | 'diff' = 'page';
  const pageHref = (p: Page, anchor?: string) =>
    `#snap:${encodeURIComponent(p.path)}${anchor ? `#${anchor}` : ''}`;
  const nav = (query: string) => {
    const list = query.trim() ? snapshot.index.search(query).map((r) => r.page) : snapshot.pages;
    return list
      .slice(0, 400)
      .map(
        (p) =>
          `<li><a href="${escapeHtml(pageHref(p))}"${p.path === selected?.path ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a>${removed.has(p.path) ? ' <span class="badge removed" title="Not in the working tree">removed since</span>' : changed.has(p.path) ? ' <span class="badge changed" title="Different in the working tree">changed since</span>' : ''}<small>${escapeHtml(p.path)}</small></li>`,
      )
      .join('');
  };
  const body = async () => {
    if (!selected)
      return '<p class="muted">This version has no Markdown pages in the content root.</p>';
    const head = `<div class="snap-actions">${removed.has(selected.path) ? '<span class="badge removed">Not in the working tree</span>' : `<button class="btn" data-action="compare" aria-pressed="${mode === 'diff'}">${mode === 'diff' ? 'Show page' : 'Compare with working tree'}</button><button class="btn" data-action="diffEditor">Open in diff editor</button>`}<button class="btn" data-action="source">Open source (read-only)</button></div>`;
    if (mode === 'diff' && !removed.has(selected.path)) {
      const working = current.find((p) => p.path === selected!.path)!;
      return `${head}<h1>${escapeHtml(selected.title)} <small class="muted">${escapeHtml(ref)} → working tree</small></h1>${diffHtml(selected.text, working.text)}`;
    }
    return `${head}${renderPage(selected, snapshot.index, { pageHref })}`;
  };
  const render = async (query = '', anchor = '') => {
    const nonce = randomBytes(16).toString('base64');
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><title>${escapeHtml(root.name)} @ ${escapeHtml(ref)}</title><style>${contentCss}
.layout{display:grid;grid-template-columns:minmax(220px,300px) 1fr;height:100vh}
nav{border-right:1px solid var(--ws-hairline);overflow:auto;padding:12px 10px}
nav h1{font-size:14px;margin:0 0 2px}nav .meta{color:var(--ws-muted);font-size:12px;margin:0 0 8px}
nav input{width:100%;box-sizing:border-box;height:28px;padding:0 8px;font:inherit;border:1px solid var(--ws-border);border-radius:var(--ws-r1);background:var(--ws-surface);color:var(--ws-fg);margin:0 0 8px}
nav input:focus{outline:2px solid var(--ws-focus)}
nav ul{list-style:none;margin:0;padding:0}nav li{margin:0 0 6px;font-size:13px}nav li small{display:block;color:var(--ws-muted);font-size:11px}
nav a{color:var(--ws-fg);text-decoration:none}nav a:hover{color:var(--ws-accent)}nav a[aria-current]{color:var(--ws-accent);font-weight:600}
.summary{font-size:12px;color:var(--ws-muted);margin:0 0 10px}
.summary details{margin-top:4px}.summary ul{margin:4px 0 0 16px;padding:0}
.badge{font-size:10.5px;padding:1px 6px;border-radius:999px;background:var(--ws-surface-2);white-space:nowrap}
.badge.removed{color:var(--ws-red)}.badge.changed{color:var(--ws-orange)}
main{overflow:auto;padding:0 28px 40px}
.snapshot-banner{position:sticky;top:0;z-index:1;margin:0 -28px 12px;padding:8px 28px;background:var(--ws-surface);border-bottom:1px solid var(--ws-hairline);font-size:12.5px}
.snap-actions{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}
.btn{height:26px;padding:0 10px;border-radius:var(--ws-r1);border:1px solid var(--ws-border);background:var(--ws-surface);color:var(--ws-fg);cursor:pointer;font:inherit;font-size:12px}
.btn:focus-visible{outline:2px solid var(--ws-focus)}
table.diff{border-collapse:collapse;width:100%;font:12px var(--ws-mono)}table.diff td{padding:0 6px;vertical-align:top;white-space:pre-wrap}
table.diff .n{color:var(--ws-muted);text-align:right;width:1%}tr.add{background:color-mix(in srgb,var(--ws-green) 14%,transparent)}tr.del{background:color-mix(in srgb,var(--ws-red) 14%,transparent)}
.gap{color:var(--ws-muted);text-align:center}
</style></head><body><div class="layout"><nav aria-label="Pages in ${escapeHtml(ref)}"><h1>${escapeHtml(root.name)}</h1><p class="meta">${escapeHtml(ref)} · ${short} · ${snapshot.pages.length} page${snapshot.pages.length === 1 ? '' : 's'}${snapshot.truncated ? ` (first ${MAX_PAGES})` : ''}</p>
<div class="summary">${diff.changed.length} changed · ${diff.removed.length} removed · ${diff.added.length} added since ${escapeHtml(ref)}${
      diff.added.length
        ? `<details><summary>Pages missing in ${escapeHtml(ref)}</summary><ul>${diff.added
            .slice(0, 50)
            .map((p) => `<li>${escapeHtml(p.path)}</li>`)
            .join('')}</ul></details>`
        : ''
    }</div>
<input id="q" type="search" placeholder="Search this version" aria-label="Search this version" value="${escapeHtml(query)}"><ul id="pages">${nav(query)}</ul></nav>
<main><p class="snapshot-banner" role="note">Read-only snapshot of <strong>${escapeHtml(ref)}</strong> (commit ${short}). Nothing was checked out; your working tree is unchanged.</p>${await body()}</main></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#snap:"]');
  if (a) { e.preventDefault(); const [p, anchor] = a.getAttribute('href').slice(6).split('#'); vscode.postMessage({ type: 'open', path: decodeURIComponent(p), anchor, query: document.getElementById('q').value }); return; }
  const b = e.target.closest('[data-action]');
  if (b) vscode.postMessage({ type: b.dataset.action, query: document.getElementById('q').value });
});
let t; document.getElementById('q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => vscode.postMessage({ type: 'search', query: e.target.value }), 150); });
window.addEventListener('message', (e) => { if (e.data.type === 'pages') document.getElementById('pages').innerHTML = e.data.html; });
const anchor = ${JSON.stringify(anchor).replace(/</g, '\\u003c')}; if (anchor) document.getElementById(decodeURIComponent(anchor))?.scrollIntoView();
</script></body></html>`;
  };
  listener = view.webview.onDidReceiveMessage(async (m: Record<string, unknown>) => {
    const query = typeof m.query === 'string' ? m.query.slice(0, 500) : '';
    if (m.type === 'open' && typeof m.path === 'string') {
      selected = snapshot.pages.find((p) => p.path === m.path) || selected;
      mode = 'page';
      await render(query, typeof m.anchor === 'string' ? m.anchor : '');
    } else if (m.type === 'search') {
      // Only the list changes: the open page and the search box keep their state.
      await view.webview.postMessage({ type: 'pages', html: nav(query) });
    } else if (m.type === 'compare') {
      mode = mode === 'diff' ? 'page' : 'diff';
      await render(query);
    } else if (m.type === 'diffEditor' && selected) {
      const working = current.find((p) => p.path === selected!.path);
      if (!working) return;
      await vscode.commands.executeCommand(
        'vscode.diff',
        GitContentProvider.uri(
          snapshot.repo,
          snapshot.sha,
          posix.join(snapshot.base, selected.path),
        ),
        vscode.Uri.parse(working.uri),
        `${posix.basename(selected.path)} (${ref} ↔ working tree)`,
      );
    } else if (m.type === 'source' && selected) {
      const doc = await vscode.workspace.openTextDocument(
        GitContentProvider.uri(
          snapshot.repo,
          snapshot.sha,
          posix.join(snapshot.base, selected.path),
        ),
      );
      await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
      });
    }
  });
  await render();
  view.reveal();
  return snapshot;
}

import { randomUUID } from 'node:crypto';
import { GitignoreMatcher } from './core/gitignore';
import * as vscode from 'vscode';
import { scopeOf, scopedPath } from './core/scopes';
import { WikiIndex } from './core/index';
import { parsePage } from './core/markdown';
import { Page } from './core/model';
import {
  pagePath,
  posix,
  safeRelative,
  splitTarget,
  isExternal,
  encodePath,
  uriPath,
} from './core/paths';
import { WikiConfig, parseConfig } from './core/config';
export interface WikiRoot {
  id: string;
  name: string;
  uri: vscode.Uri;
  folder: vscode.WorkspaceFolder;
  projectUri?: vscode.Uri;
  config?: WikiConfig;
  /** Description, icon and color of a wiki without wiki.yaml (settings of its folder). */
  look?: { description?: string; icon?: string; color?: string };
}
export class WikiWorkspace implements vscode.Disposable {
  /** `.gitignore` rules per workspace folder, when `notespace.respectGitignore` is on. */
  private ignoreRules = new Map<string, GitignoreMatcher>();
  readonly index = new WikiIndex();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly moveEmitter = new vscode.EventEmitter<{ from: string; to: string }>();
  readonly onDidMove = this.moveEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.emitter, this.moveEmitter];
  private timer?: ReturnType<typeof setTimeout>;
  private fileTimer?: ReturnType<typeof setTimeout>;
  private readonly fileEvents = new Map<string, 'upsert' | 'delete'>();
  /** Size and modification time of each indexed file when it was read. */
  private readonly fileStats = new Map<string, string>();
  private reconciling = false;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;
  roots: WikiRoot[] = [];
  /** Wikis removed from NoteSpace (their files stay); see setHidden. */
  private hidden = new Set<string>();
  /** The wiki used when a command could apply to several (`Set as Default Wiki`). */
  defaultRoot?: string;
  /** Wikis found on disk but removed from NoteSpace by the user. */
  hiddenRoots: WikiRoot[] = [];
  /** Removes wikis (by root id) from NoteSpace without touching their files. */
  setHidden(ids: Iterable<string>): void {
    this.hidden = new Set(ids);
  }
  issues: string[] = [];
  constructor(readonly log: vscode.OutputChannel) {
    this.index.scope = (page) => {
      const config = this.roots.find((r) => r.id === page.root)?.config;
      if (!config) return '';
      const scope = scopeOf(page.path, config);
      return scopedPath('', scope.version, scope.language);
    };
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.[mM][dD]');
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/wiki.yaml');
    const ignoreWatcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
    const ignoreChanged = () => {
      if (this.ignoreRules.size) this.schedule();
    };
    this.disposables.push(
      watcher,
      configWatcher,
      ignoreWatcher,
      ignoreWatcher.onDidCreate(ignoreChanged),
      ignoreWatcher.onDidChange(ignoreChanged),
      ignoreWatcher.onDidDelete(ignoreChanged),
      configWatcher.onDidCreate(() => this.schedule()),
      configWatcher.onDidChange(() => this.schedule()),
      configWatcher.onDidDelete(() => this.schedule()),
      watcher.onDidCreate((uri) => this.scheduleFile(uri, 'upsert')),
      watcher.onDidDelete((uri) => this.scheduleFile(uri, 'delete')),
      watcher.onDidChange((uri) => this.scheduleFile(uri, 'upsert')),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('notespace')) this.schedule();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.updateDocument(e.document)) this.notify();
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => this.scheduleFile(doc.uri, 'upsert')),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) void this.reconcile();
      }),
    );
    // File watchers can miss events (busy hosts, network drives, WSL and container mounts).
    // A cheap stat comparison every few seconds (and on window focus) catches what they missed.
    this.reconcileTimer = setInterval(() => void this.reconcile(), 5000);
  }
  private notify(): void {
    if (!this.disposed) this.emitter.fire();
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.refresh().catch((e) => this.log.appendLine(String(e)));
    }, 180);
  }
  private scheduleFile(uri: vscode.Uri, kind: 'upsert' | 'delete'): void {
    if (!/\.md$/i.test(uri.path)) return;
    this.fileEvents.set(uri.toString(), kind);
    if (this.fileTimer) clearTimeout(this.fileTimer);
    this.fileTimer = setTimeout(() => {
      this.fileTimer = undefined;
      const events = [...this.fileEvents];
      this.fileEvents.clear();
      this.pending = this.pending
        .catch(() => {})
        .then(async () => {
          for (const [key, event] of events) await this.updateFile(vscode.Uri.parse(key), event);
          await vscode.commands.executeCommand(
            'setContext',
            'notespace.hasPages',
            this.index.pages.size > 0,
          );
          this.notify();
        });
      void this.pending.catch((e) => this.log.appendLine(String(e)));
    }, 120);
  }
  private async loadIgnoreRules(roots: WikiRoot[]): Promise<void> {
    const rules = new Map<string, GitignoreMatcher>();
    for (const folder of new Set(roots.map((r) => r.folder))) {
      if (
        !vscode.workspace
          .getConfiguration('notespace', folder.uri)
          .get<boolean>('respectGitignore', false)
      )
        continue;
      const files = new Map<string, string>();
      for (const uri of await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/.gitignore'),
        '**/{node_modules,.git}/**',
        1000,
      )) {
        try {
          const dir = posix.relative(uriPath(folder.uri), posix.dirname(uriPath(uri)));
          files.set(
            dir === '.' ? '' : dir,
            new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
          );
        } catch (e) {
          this.log.appendLine(`${uri.path}: ${String(e)}`);
        }
      }
      rules.set(folder.uri.toString(), new GitignoreMatcher(files));
    }
    this.ignoreRules = rules;
  }
  /** True when Git ignores the file and the wiki is set to follow `.gitignore`. */
  isGitIgnored(root: WikiRoot, uri: vscode.Uri): boolean {
    const matcher = this.ignoreRules.get(root.folder.uri.toString());
    if (!matcher || matcher.empty) return false;
    return matcher.ignores(posix.relative(uriPath(root.folder.uri), uriPath(uri)));
  }
  private async updateFile(uri: vscode.Uri, kind: 'upsert' | 'delete'): Promise<void> {
    if (this.disposed) return;
    const root = this.roots.find(
      (r) =>
        uri.scheme === r.uri.scheme &&
        uri.authority === r.uri.authority &&
        uriPath(uri).startsWith(uriPath(r.uri).replace(/\/$/, '') + '/'),
    );
    if (!root) return;
    if (kind === 'delete') {
      this.index.remove(uri.toString());
      return;
    }
    const relative = posix.relative(uriPath(root.uri), uriPath(uri));
    if (
      relative
        .split('/')
        .some((part) => ['.notespace-trash', '.templates', 'node_modules', '.git'].includes(part))
    )
      return;
    const config = vscode.workspace.getConfiguration('notespace', root.folder.uri);
    const old = this.index.byUri(uri.toString());
    if (!old) {
      const matches = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root.uri, relative),
        config.get<string>('exclude', ''),
        1,
      );
      if (!matches.some((found) => found.toString() === uri.toString())) return;
      if (this.isGitIgnored(root, uri)) return;
      if (this.index.all(root.id).length >= config.get<number>('maxPages', 10000)) {
        this.schedule();
        return;
      }
    }
    try {
      await this.assertNoSymlink(root, uri);
      const stat = await vscode.workspace.fs.stat(uri);
      this.fileStats.set(uri.toString(), `${stat.size}:${stat.mtime}`);
      if (stat.size > config.get<number>('maxFileSizeKB', 1024) * 1024) {
        this.schedule();
        return;
      }
      // A clean cached document may lag behind an external change; only unsaved edits beat disk.
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString() && d.isDirty,
      );
      const text = doc
        ? doc.getText()
        : new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(uri));
      const currentBytes =
        [...this.index.pages.values()]
          .filter((p) => p.root === root.id)
          .reduce((sum, p) => sum + Buffer.byteLength(p.text), 0) -
        (old ? Buffer.byteLength(old.text) : 0);
      if (
        currentBytes + Buffer.byteLength(text) >
        config.get<number>('maxIndexSizeMB', 64) * 1024 * 1024
      ) {
        this.schedule();
        return;
      }
      this.index.upsert(parsePage(root.id, relative, uri.toString(), text));
    } catch (e) {
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound')
        this.index.remove(uri.toString());
      else {
        this.index.remove(uri.toString());
        this.log.appendLine(`${uri.path}: ${String(e)}`);
      }
    }
  }
  /** Last modification time on disk (ms) as last seen by the index, when known. */
  modifiedAt(uri: string): number | undefined {
    const stat = this.fileStats.get(uri);
    return stat ? Number(stat.split(':')[1]) || undefined : undefined;
  }
  /** Pages of archived versions are kept out of search, tasks, health and navigation. */
  isArchived(page: Page): boolean {
    return !!scopeOf(page.path, this.roots.find((r) => r.id === page.root)?.config).version;
  }
  /** Translations and archived versions: copies of pages, not separate work items. */
  isVariant(page: Page): boolean {
    const scope = scopeOf(page.path, this.roots.find((r) => r.id === page.root)?.config);
    return !!(scope.version || scope.language);
  }
  rootFor(page: Page): WikiRoot {
    const root = this.roots.find((r) => r.id === page.root);
    if (!root) throw new Error('The wiki workspace is no longer open.');
    return root;
  }
  private updateDocument(doc: vscode.TextDocument): boolean {
    const old = this.index.byUri(doc.uri.toString());
    if (!old || doc.isClosed) return false;
    this.index.upsert(parsePage(old.root, old.path, old.uri, doc.getText()));
    return true;
  }
  refresh(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.fileTimer) {
      clearTimeout(this.fileTimer);
      this.fileTimer = undefined;
    }
    this.fileEvents.clear();
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        if (this.disposed) return;
        const roots: WikiRoot[] = [],
          issues: string[] = [],
          pages: Page[] = [];
        for (const folder of vscode.workspace.workspaceFolders || []) {
          try {
            const configs = await vscode.workspace.findFiles(
              new vscode.RelativePattern(folder, '**/wiki.yaml'),
              '**/{node_modules,.git,dist,.notespace-export}/**',
              21,
            );
            for (const configUri of configs) {
              try {
                const projectUri = vscode.Uri.joinPath(configUri, '..');
                const source = new TextDecoder().decode(
                  await vscode.workspace.fs.readFile(configUri),
                );
                const parsed = parseConfig(source);
                const uri = vscode.Uri.joinPath(projectUri, parsed.content.root);
                const root: WikiRoot = {
                  id: configUri.toString(),
                  name: parsed.wiki.title,
                  folder,
                  uri,
                  projectUri,
                  config: parsed,
                };
                await this.assertNoSymlink(root, uri);
                roots.push(root);
              } catch (e) {
                issues.push(`${configUri.path}: ${String(e)}`);
              }
            }
            if (configs.length) continue;
            const relative = safeRelative(
              vscode.workspace
                .getConfiguration('notespace', folder.uri)
                .get<string>('root', 'wiki'),
              true,
            );
            roots.push({
              id: folder.uri.toString(),
              // Wikis without wiki.yaml are named after their folder unless renamed.
              name:
                vscode.workspace
                  .getConfiguration('notespace', folder.uri)
                  .get<string>('wikiName', '')
                  .trim()
                  .slice(0, 80) || folder.name,
              look: (() => {
                const settings = vscode.workspace.getConfiguration('notespace', folder.uri);
                const text = (key: string, max: number) =>
                  settings.get<string>(key, '').trim().slice(0, max) || undefined;
                return {
                  description: text('wikiDescription', 400),
                  icon: text('wikiIcon', 40),
                  color: text('wikiColor', 20),
                };
              })(),
              folder,
              uri: vscode.Uri.joinPath(folder.uri, relative),
            });
          } catch (e) {
            issues.push(`${folder.name}: ${String(e)}`);
          }
        }
        // Wikis the user removed from NoteSpace are not indexed; their files are untouched.
        this.hiddenRoots = roots.filter((r) => this.hidden.has(r.id));
        roots.splice(0, roots.length, ...roots.filter((r) => !this.hidden.has(r.id)));
        await this.loadIgnoreRules(roots);
        for (const root of roots) {
          const config = vscode.workspace.getConfiguration('notespace', root.folder.uri);
          const max = config.get<number>('maxPages', 10000),
            limit = config.get<number>('maxFileSizeKB', 1024) * 1024;
          try {
            await this.assertNoSymlink(root, root.uri);
            const exclude = config.get<string>('exclude', '');
            const uris = await vscode.workspace.findFiles(
              new vscode.RelativePattern(root.uri, '**/*.[mM][dD]'),
              exclude,
              max + 1,
            );
            if (this.ignoreRules.has(root.folder.uri.toString())) {
              const kept = uris.filter((uri) => !this.isGitIgnored(root, uri));
              uris.splice(0, uris.length, ...kept);
            }
            if (uris.length > max)
              issues.push(
                `${root.name}: index limited to ${max} pages. Raise notespace.maxPages to include more.`,
              );
            let cursor = 0,
              totalBytes = 0;
            const budget = config.get<number>('maxIndexSizeMB', 64) * 1024 * 1024;
            await Promise.all(
              Array.from({ length: Math.min(12, uris.length) }, async () => {
                while (cursor < Math.min(uris.length, max)) {
                  const uri = uris[cursor++];
                  if (
                    posix
                      .relative(uriPath(root.uri), uriPath(uri))
                      .split('/')
                      .includes('.notespace-trash')
                  )
                    continue;
                  try {
                    await this.assertNoSymlink(root, uri);
                    const stat = await vscode.workspace.fs.stat(uri);
                    this.fileStats.set(uri.toString(), `${stat.size}:${stat.mtime}`);
                    if (stat.size > limit) {
                      issues.push(`${uri.path}: skipped (exceeds size limit).`);
                      continue;
                    }
                    if (totalBytes + stat.size > budget) {
                      issues.push(`${uri.path}: skipped (wiki index size budget exceeded).`);
                      continue;
                    }
                    totalBytes += stat.size;
                    // Only unsaved edits beat disk; a clean cached document can be stale.
                    const doc = vscode.workspace.textDocuments.find(
                      (d) => d.uri.toString() === uri.toString() && d.isDirty,
                    );
                    const text = doc
                      ? doc.getText()
                      : new TextDecoder('utf-8', { fatal: true }).decode(
                          await vscode.workspace.fs.readFile(uri),
                        );
                    pages.push(
                      parsePage(
                        root.id,
                        posix.relative(uriPath(root.uri), uriPath(uri)),
                        uri.toString(),
                        text,
                      ),
                    );
                  } catch (e) {
                    issues.push(`${uri.path}: ${String(e)}`);
                  }
                }
              }),
            );
          } catch (e) {
            issues.push(`${root.name}: ${String(e)}`);
          }
        }
        if (this.disposed) return;
        this.roots = roots;
        this.index.replace(pages);
        // Unsaved buffers win over disk; clean cached documents may be stale.
        for (const doc of vscode.workspace.textDocuments) if (doc.isDirty) this.updateDocument(doc);
        if (issues.join('\n') !== this.issues.join('\n'))
          for (const issue of issues) this.log.appendLine(issue);
        this.issues = issues;
        await vscode.commands.executeCommand('setContext', 'notespace.hasPages', pages.length > 0);
        this.notify();
      });
    return this.pending;
  }
  async assertNoSymlink(root: WikiRoot, uri: vscode.Uri): Promise<void> {
    if (
      uri.scheme !== root.folder.uri.scheme ||
      uri.authority !== root.folder.uri.authority ||
      !(
        uriPath(uri) === uriPath(root.folder.uri) ||
        uriPath(uri).startsWith(uriPath(root.folder.uri).replace(/\/$/, '') + '/')
      )
    )
      throw new Error('Path is outside the workspace.');
    const relative = posix.relative(uriPath(root.folder.uri), uriPath(uri));
    let current = root.folder.uri;
    for (const part of relative.split('/').filter(Boolean)) {
      current = vscode.Uri.joinPath(current, part);
      try {
        const stat = await vscode.workspace.fs.stat(current);
        if (stat.type & vscode.FileType.SymbolicLink)
          throw new Error('Symbolic links are not supported inside a wiki.');
      } catch (e) {
        if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') return;
        throw e;
      }
    }
  }
  private async assertMissing(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (e) {
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') return;
      throw e;
    }
    throw new Error('A file already exists at the destination.');
  }
  private async assertPortableCase(root: WikiRoot, relative: string): Promise<void> {
    let parent = root.uri;
    for (const part of relative.split('/')) {
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(parent);
      } catch (e) {
        if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') return;
        throw e;
      }
      const matching = entries.find(
        ([name]) => name.toLocaleLowerCase() === part.toLocaleLowerCase(),
      );
      if (!matching) return;
      if (matching[0] !== part)
        throw new Error(`A path differing only by letter case already exists: ${matching[0]}`);
      parent = vscode.Uri.joinPath(parent, part);
    }
  }
  async createPage(root: WikiRoot, name: string, content: string): Promise<vscode.Uri> {
    const file = pagePath(name),
      uri = vscode.Uri.joinPath(root.uri, file);
    await this.assertNoSymlink(root, uri);
    await this.assertPortableCase(root, file);
    if (
      this.index.all(root.id).some((p) => p.path.toLocaleLowerCase() === file.toLocaleLowerCase())
    )
      throw new Error('A page with this name already exists.');
    await this.assertMissing(uri);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    edit.insert(uri, new vscode.Position(0, 0), content);
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not create the page.');
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!(await doc.save())) throw new Error('The new page could not be saved.');
    await this.refresh();
    return uri;
  }
  async createSection(root: WikiRoot, name: string, title?: string): Promise<vscode.Uri> {
    const file = pagePath(`${name}/placeholder`).replace(/\/placeholder\.md$/, '');
    const uri = vscode.Uri.joinPath(root.uri, file);
    await this.assertNoSymlink(root, uri);
    await this.assertPortableCase(root, file);
    await this.assertMissing(uri);
    await vscode.workspace.fs.createDirectory(uri);
    await this.createPage(
      root,
      `${file}/index.md`,
      `# ${(title || posix.basename(file)).replace(/[\r\n]/g, ' ').trim()}\n`,
    );
    return uri;
  }
  async renamePage(page: Page, name: string): Promise<vscode.Uri> {
    const root = this.rootFor(page),
      file = pagePath(name),
      uri = vscode.Uri.joinPath(root.uri, file);
    if (file === page.path) return uri;
    await this.assertNoSymlink(root, uri);
    await this.assertPortableCase(root, file);
    if (
      this.index.all(root.id).some((p) => p.path.toLocaleLowerCase() === file.toLocaleLowerCase())
    )
      throw new Error('A page with this name already exists.');
    await this.assertMissing(uri);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    const edit = new vscode.WorkspaceEdit();
    const versions = new Map<vscode.TextDocument, number>();
    for (const [source, changes] of this.index.renameChanges(page, file)) {
      const expected = this.index.byUri(source)?.text;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(source));
      if (doc.getText() !== expected)
        throw new Error('A linked page changed during rename. Refresh the index and try again.');
      versions.set(doc, doc.version);
      for (const change of changes)
        edit.replace(
          doc.uri,
          new vscode.Range(doc.positionAt(change.start), doc.positionAt(change.end)),
          change.text,
        );
    }
    for (const [doc, version] of versions)
      if (doc.version !== version)
        throw new Error('A linked page changed during rename. Try again.');
    edit.renameFile(vscode.Uri.parse(page.uri), uri, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not rename the page and update its links.');
    this.moveEmitter.fire({ from: page.uri, to: uri.toString() });
    await this.refresh();
    return uri;
  }
  async moveSection(
    root: WikiRoot,
    oldPrefix: string,
    name: string,
  ): Promise<{ uri: vscode.Uri; warnings: string[] }> {
    const from = safeRelative(oldPrefix.replace(/\/$/, ''));
    const to = safeRelative(name);
    if (to.split('/').includes('.notespace-trash')) throw new Error('Wiki Trash is reserved.');
    if (to === from || to.startsWith(`${from}/`))
      throw new Error('Choose a different destination outside the section.');
    const pages = this.index.all(root.id).filter((p) => p.path.startsWith(`${from}/`));
    if (!pages.length) throw new Error('Section has no indexed Markdown pages.');
    const map = new Map(pages.map((p) => [p.path, `${to}/${p.path.slice(from.length + 1)}`]));
    if (
      this.index
        .all(root.id)
        .some(
          (p) =>
            !map.has(p.path) &&
            [...map.values()].some((v) => v.toLowerCase() === p.path.toLowerCase()),
        )
    )
      throw new Error('A page already exists at the destination.');
    const fromUri = vscode.Uri.joinPath(root.uri, from),
      toUri = vscode.Uri.joinPath(root.uri, to);
    await this.assertNoSymlink(root, fromUri);
    await this.assertNoSymlink(root, toUri);
    await this.assertPortableCase(root, to);
    await this.assertMissing(toUri);
    const warnings: string[] = [],
      edit = new vscode.WorkspaceEdit();
    const versions = new Map<vscode.TextDocument, number>();
    for (const source of this.index.all(root.id)) {
      const sourceNewPath = map.get(source.path) || source.path;
      const moved = sourceNewPath !== source.path;
      const changes: Array<{ start: number; end: number; text: string }> = [];
      for (const link of source.links) {
        if (isExternal(link.target)) continue;
        const target = splitTarget(link.target);
        if (!target.path) continue;
        const resolved =
          link.kind === 'image'
            ? undefined
            : this.index.resolve(source, link.target, link.kind).page;
        const mapped = resolved && map.get(resolved.path);
        if (!moved && !mapped) continue;
        let destination = mapped || resolved?.path;
        if (!destination && moved && link.kind !== 'wiki' && !target.path.startsWith('/'))
          destination = posix.normalize(posix.join(posix.dirname(source.path), target.path));
        if (!destination) {
          warnings.push(`${source.path}: could not rewrite ${link.target}`);
          continue;
        }
        const anchor = link.target.includes('#') ? link.target.slice(link.target.indexOf('#')) : '';
        const replacement =
          link.kind === 'wiki'
            ? `/${destination.replace(/\.md$/i, '')}${anchor}`
            : `${encodePath(posix.relative(posix.dirname(sourceNewPath), destination))}${anchor}`;
        if (replacement !== link.target)
          changes.push({ start: link.targetStart, end: link.targetEnd, text: replacement });
      }
      if (!changes.length) continue;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(source.uri));
      if (doc.getText() !== source.text)
        throw new Error('A linked page changed during section move. Refresh and try again.');
      versions.set(doc, doc.version);
      for (const change of changes)
        edit.replace(
          doc.uri,
          new vscode.Range(doc.positionAt(change.start), doc.positionAt(change.end)),
          change.text,
        );
    }
    for (const [doc, version] of versions)
      if (doc.version !== version)
        throw new Error('A linked page changed during section move. Try again.');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(toUri, '..'));
    edit.renameFile(fromUri, toUri, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not move the section and rewrite links.');
    this.moveEmitter.fire({ from: fromUri.toString(), to: toUri.toString() });
    await this.refresh();
    return { uri: toUri, warnings };
  }
  async trashSection(root: WikiRoot, prefix: string): Promise<vscode.Uri> {
    const section = safeRelative(prefix.replace(/\/$/, ''));
    const pages = this.index.all(root.id).filter((p) => p.path.startsWith(`${section}/`));
    if (!pages.length) throw new Error('Section has no indexed Markdown pages.');
    const from = vscode.Uri.joinPath(root.uri, section);
    await this.assertNoSymlink(root, from);
    for (const page of pages) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === page.uri);
      if (doc?.isDirty && !(await doc.save()))
        throw new Error('Save modified pages before deleting the section.');
    }
    const to = vscode.Uri.joinPath(
      root.uri,
      '.notespace-trash',
      `${Date.now()}-${randomUUID()}`,
      section,
    );
    await this.assertNoSymlink(root, to);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(to, '..'));
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(from, to, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not move this section to Wiki Trash.');
    await this.refresh();
    return to;
  }
  async trashPage(page: Page): Promise<vscode.Uri> {
    const root = this.rootFor(page),
      source = vscode.Uri.parse(page.uri);
    await this.assertNoSymlink(root, source);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === page.uri);
    if (doc?.isDirty && !(await doc.save()))
      throw new Error('Save the page before moving it to Wiki Trash.');
    const uri = vscode.Uri.joinPath(
      root.uri,
      '.notespace-trash',
      `${Date.now()}-${randomUUID()}`,
      page.path,
    );
    await this.assertNoSymlink(root, uri);
    await this.assertMissing(uri);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(source, uri, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not move this page to Wiki Trash.');
    await this.refresh();
    return uri;
  }
  async deletedPages(root: WikiRoot): Promise<{ path: string; uri: vscode.Uri }[]> {
    await this.assertNoSymlink(root, vscode.Uri.joinPath(root.uri, '.notespace-trash'));
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root.uri, '.notespace-trash/**/*.[mM][dD]'),
      null,
    );
    return uris
      .map((uri) => ({
        uri,
        path: posix.relative(uriPath(root.uri), uriPath(uri)).split('/').slice(2).join('/'),
      }))
      .sort((a, b) => b.uri.path.localeCompare(a.uri.path));
  }
  async restorePage(root: WikiRoot, trashUri: vscode.Uri): Promise<vscode.Uri> {
    const entry = (await this.deletedPages(root)).find(
      (p) => p.uri.toString() === trashUri.toString(),
    );
    if (!entry) throw new Error('The deleted page is no longer in Wiki Trash.');
    const file = pagePath(entry.path),
      uri = vscode.Uri.joinPath(root.uri, file);
    await this.assertNoSymlink(root, trashUri);
    await this.assertNoSymlink(root, uri);
    if (
      this.index.all(root.id).some((p) => p.path.toLocaleLowerCase() === file.toLocaleLowerCase())
    )
      throw new Error(
        'A page already exists at the original path. Rename it before restoring this page.',
      );
    await this.assertMissing(uri);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(trashUri, uri, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not restore this page.');
    await this.refresh();
    return uri;
  }
  /** Re-reads indexed pages whose size or modification time changed on disk. */
  private reconcileTicks = 0;
  async reconcile(): Promise<void> {
    if (this.reconciling || this.disposed) return;
    this.reconciling = true;
    try {
      // Every 30 s also look for pages that appeared or vanished without a watcher event.
      if (++this.reconcileTicks % 6 === 0)
        for (const root of this.roots) {
          const config = vscode.workspace.getConfiguration('notespace', root.folder.uri);
          const found = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root.uri, '**/*.[mM][dD]'),
            config.get<string>('exclude', '') || undefined,
            config.get<number>('maxPages', 10000),
          );
          const known = new Set(this.index.all(root.id).map((p) => p.uri));
          for (const uri of found)
            if (
              !known.has(uri.toString()) &&
              !this.fileEvents.has(uri.toString()) &&
              !this.isGitIgnored(root, uri)
            )
              this.scheduleFile(uri, 'upsert');
        }
      const dirty = new Set(
        vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => d.uri.toString()),
      );
      for (const page of [...this.index.pages.values()]) {
        if (dirty.has(page.uri) || this.fileEvents.has(page.uri)) continue;
        const known = this.fileStats.get(page.uri);
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.parse(page.uri));
          if (known && known !== `${stat.size}:${stat.mtime}`)
            this.scheduleFile(vscode.Uri.parse(page.uri), 'upsert');
        } catch (e) {
          if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound')
            this.scheduleFile(vscode.Uri.parse(page.uri), 'delete');
        }
      }
    } finally {
      this.reconciling = false;
    }
  }
  dispose(): void {
    this.disposed = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.timer) clearTimeout(this.timer);
    if (this.fileTimer) clearTimeout(this.fileTimer);
    for (const d of this.disposables) d.dispose();
  }
}

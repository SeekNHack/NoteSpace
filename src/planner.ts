import * as vscode from 'vscode';
import { WikiRoot, WikiWorkspace } from './workspace';
import { Page } from './core/model';
import {
  completeTaskLine,
  journalStreak,
  newTaskId,
  parseTasks,
  quickAddLine,
  Task,
  TaskChange,
  TaskStatus,
  taskStatuses,
  todayIn,
  isValidZone,
  addDays,
  updateTaskLine,
} from './core/tasks';
import { fillTemplate, templates } from './templates';
import { posix } from './core/paths';
import { renderCollection } from './core/collections';

export interface PlannerConfig {
  dailyFolder: string;
  dailyTemplate: string;
  timeZone?: string;
  inbox: string;
  upcomingDays: number;
}

/**
 * Tasks are read from every indexed page and written back as single-line `WorkspaceEdit`s, so
 * VS Code undo, dirty state and other open editors all see the same change. A document that was
 * clean before a planner edit is saved again; a document with unsaved user edits stays unsaved.
 */
export class PlannerService implements vscode.Disposable {
  private readonly cache = new Map<string, { text: string; tasks: Task[] }>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];
  constructor(private readonly workspace: WikiWorkspace) {
    this.subscriptions = [
      workspace.onDidChange(() => this.emitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('wikiStudio.dailyNotes') ||
          event.affectsConfiguration('wikiStudio.planner')
        )
          this.emitter.fire();
      }),
    ];
  }

  config(root?: WikiRoot): PlannerConfig {
    const settings = vscode.workspace.getConfiguration('wikiStudio', root?.folder.uri);
    const zone = settings.get<string>('planner.timeZone', '').trim();
    const folder =
      settings
        .get<string>('dailyNotes.folder', 'daily')
        .trim()
        .replace(/^\/+|\/+$/g, '') || 'daily';
    return {
      dailyFolder: folder,
      dailyTemplate: settings.get<string>('dailyNotes.template', '').trim(),
      timeZone: zone && isValidZone(zone) ? zone : undefined,
      inbox: settings.get<string>('planner.inbox', 'Inbox.md').trim() || 'Inbox.md',
      upcomingDays: Math.max(1, Math.min(90, settings.get<number>('planner.upcomingDays', 14))),
    };
  }

  today(root?: WikiRoot): string {
    return todayIn(this.config(root).timeZone);
  }

  /** All tasks of a wiki (or all wikis), parsed from current index text with a per-page cache. */
  tasks(rootId?: string): Task[] {
    const result: Task[] = [];
    for (const page of this.workspace.index.all(rootId)) {
      // Tasks live in the current version's default-language pages; translations copy them.
      if (this.workspace.isVariant(page)) continue;
      const folder = this.config(this.workspace.rootFor(page)).dailyFolder;
      let entry = this.cache.get(page.id);
      if (!entry || entry.text !== page.text) {
        entry = { text: page.text, tasks: parseTasks(page, folder) };
        this.cache.set(page.id, entry);
      }
      result.push(...entry.tasks);
    }
    return result;
  }

  /** Daily notes by date for one wiki. */
  dailyNotes(root: WikiRoot): Map<string, Page> {
    const folder = this.config(root).dailyFolder;
    const pattern = new RegExp(
      `^${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d{4}-\\d{2}-\\d{2})\\.md$`,
    );
    const notes = new Map<string, Page>();
    for (const page of this.workspace.index.all(root.id)) {
      const date = pattern.exec(page.path)?.[1];
      if (date) notes.set(date, page);
    }
    return notes;
  }

  streak(root: WikiRoot): number {
    return journalStreak(this.dailyNotes(root).keys(), this.today(root));
  }

  /** Returns the daily note for `date`, creating it from the configured template if needed. */
  async ensureDaily(root: WikiRoot, date: string): Promise<vscode.Uri> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use a date such as 2026-10-14.');
    const existing = this.dailyNotes(root).get(date);
    if (existing) return vscode.Uri.parse(existing.uri);
    const config = this.config(root);
    let body = templates.find((t) => t.label === 'Daily note')!.body;
    if (config.dailyTemplate) {
      const template = this.workspace.index
        .all(root.id)
        .find((p) => p.path === config.dailyTemplate);
      if (template) body = template.text;
      else {
        try {
          const uri = vscode.Uri.joinPath(root.uri, config.dailyTemplate);
          await this.workspace.assertNoSymlink(root, uri);
          body = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch {
          void vscode.window.showWarningMessage(
            `Daily note template “${config.dailyTemplate}” was not found; using the built-in template.`,
          );
        }
      }
    }
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`),
    );
    const filled = fillTemplate(
      body
        .replace(/{{weekday}}/g, weekday)
        .replace(/{{yesterday}}/g, addDays(date, -1))
        .replace(/{{tomorrow}}/g, addDays(date, 1)),
      date,
      date,
    );
    return this.workspace.createPage(root, `${config.dailyFolder}/${date}.md`, filled);
  }

  private pageFor(key: string): Page {
    const pageId = key.split(/[#@](?=[^#@]*$)/)[0];
    const page = this.workspace.index.pages.get(pageId);
    if (!page) throw new Error('The page of this task is no longer in the wiki.');
    return page;
  }

  /** Finds a task in the current document buffer, by id or by its unchanged line. */
  async locate(key: string): Promise<{ document: vscode.TextDocument; task: Task; page: Page }> {
    const page = this.pageFor(key);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(page.uri));
    const folder = this.config(this.workspace.rootFor(page)).dailyFolder;
    const current = parseTasks({ ...page, text: document.getText() }, folder);
    const known = this.tasks(page.root).find((t) => t.key === key);
    const task =
      current.find((t) => t.key === key) ||
      (known && current.find((t) => t.raw === known.raw && Math.abs(t.line - known.line) < 50));
    if (!task) throw new Error('This task changed in its page. The planner has been refreshed.');
    return { document, task, page };
  }

  async edit(
    document: vscode.TextDocument,
    changes: Array<{ line: number; text: string | null; after?: string }>,
  ): Promise<void> {
    const wasDirty = document.isDirty;
    const edit = new vscode.WorkspaceEdit();
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    for (const change of changes) {
      const line = document.lineAt(change.line);
      if (change.text === null) edit.delete(document.uri, line.rangeIncludingLineBreak);
      else
        edit.replace(
          document.uri,
          line.range,
          change.text + (change.after ? `${eol}${change.after}` : ''),
        );
    }
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code rejected the task edit.');
    if (!wasDirty) await document.save();
  }

  async update(key: string, change: TaskChange): Promise<void> {
    const { document, task } = await this.locate(key);
    await this.edit(document, [
      { line: task.line, text: updateTaskLine(document.lineAt(task.line).text, change) },
    ]);
  }

  async complete(key: string, done = true): Promise<void> {
    const { document, task, page } = await this.locate(key);
    const line = document.lineAt(task.line).text;
    if (!done) {
      await this.edit(document, [
        { line: task.line, text: updateTaskLine(line, { checked: false, done: null }) },
      ]);
      return;
    }
    const result = completeTaskLine(line, this.today(this.workspace.rootFor(page)));
    const indent = /^\s*/.exec(line)![0];
    await this.edit(document, [
      {
        line: task.line,
        text: result.line,
        after: result.next ? indent + result.next.trimStart() : undefined,
      },
    ]);
  }

  /**
   * `taskMove` from a board embedded in a page (reader or Studio). It can only change the
   * status of an existing task; the reply lets the page undo its optimistic move on failure.
   */
  async handleMove(
    m: Record<string, unknown>,
    reply: (message: unknown) => Thenable<boolean>,
  ): Promise<boolean> {
    if (m.type !== 'taskMove') return false;
    let key = '';
    try {
      key = typeof m.key === 'string' ? decodeURIComponent(m.key.slice(0, 1200)) : '';
    } catch {
      /* malformed: refused below */
    }
    const status = taskStatuses.find((s) => s === m.status);
    try {
      if (!key || !status) throw new Error('Unknown task or column.');
      await this.setStatus(key, status);
      await reply({ type: 'taskMoved', key: m.key, status });
    } catch (error) {
      await reply({
        type: 'taskMoved',
        key: m.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  /** Moves a task to a status column: Done completes it (recurrence included), others reopen it. */
  async setStatus(key: string, status: TaskStatus): Promise<void> {
    const { task } = await this.locate(key);
    if (task.status === status) return;
    if (status === 'done') await this.complete(key, true);
    // Reopening a completed task also drops its completion date.
    else await this.update(key, task.checked ? { status, done: null } : { status });
  }

  async remove(key: string): Promise<void> {
    const { document, task } = await this.locate(key);
    await this.edit(document, [{ line: task.line, text: null }]);
  }

  /** Persists card order on a board column with `order:` and stable ids. */
  async reorder(keys: string[]): Promise<void> {
    const byDocument = new Map<
      string,
      { document: vscode.TextDocument; changes: Array<{ line: number; text: string }> }
    >();
    for (const [index, key] of keys.entries()) {
      const { document, task } = await this.locate(key);
      const entry = byDocument.get(document.uri.toString()) || { document, changes: [] };
      entry.changes.push({
        line: task.line,
        text: updateTaskLine(document.lineAt(task.line).text, {
          order: index + 1,
          id: task.id || newTaskId(),
        }),
      });
      byDocument.set(document.uri.toString(), entry);
    }
    for (const { document, changes } of byDocument.values()) await this.edit(document, changes);
  }

  /** Adds a task to the inbox page, a daily note or a given page. Returns its location. */
  async add(
    root: WikiRoot,
    text: string,
    target: { kind: 'inbox' } | { kind: 'daily'; date: string } | { kind: 'page'; pageId: string },
    fields: TaskChange = {},
  ): Promise<{ uri: vscode.Uri; line: number }> {
    const today = this.today(root);
    const line = updateTaskLine(quickAddLine(text, today), fields);
    let uri: vscode.Uri;
    if (target.kind === 'daily') uri = await this.ensureDaily(root, target.date);
    else if (target.kind === 'page') {
      const page = this.workspace.index.pages.get(target.pageId);
      if (!page) throw new Error('That page is no longer in the wiki.');
      uri = vscode.Uri.parse(page.uri);
    } else {
      const inbox = this.config(root).inbox;
      const page = this.workspace.index.all(root.id).find((p) => p.path === inbox);
      uri = page
        ? vscode.Uri.parse(page.uri)
        : await this.workspace.createPage(root, inbox, '# Inbox\n\n');
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const wasDirty = document.isDirty;
    const text0 = document.getText();
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    // Append after the last task of the page when there is one, else at the end.
    const lines = text0.split(/\r?\n/);
    let at = -1;
    for (let i = lines.length - 1; i >= 0; i--)
      if (/^\s*[-*+] \[[ xX]\] /.test(lines[i])) {
        at = i;
        break;
      }
    const edit = new vscode.WorkspaceEdit();
    if (at >= 0) edit.insert(uri, document.lineAt(at).range.end, `${eol}${line}`);
    else {
      const ending = text0.length && !/\n$/.test(text0) ? eol : '';
      const gap = text0.trim() && !/\n\s*\n$/.test(text0) ? eol : '';
      edit.insert(uri, document.positionAt(text0.length), `${ending}${gap}${line}${eol}`);
    }
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code rejected the new task.');
    if (!wasDirty) await document.save();
    return { uri, line: document.getText().split(/\r?\n/).lastIndexOf(line) };
  }

  /** Renderer for ```tasks / ```collection blocks on `page`. */
  collection(
    page: Page,
    pageHref: (target: Page) => string,
    showTasks = true,
    interactive = false,
  ) {
    const root = this.workspace.rootFor(page);
    return (kind: 'tasks' | 'collection', source: string) =>
      renderCollection(kind, source, {
        tasks: this.tasks(page.root),
        pages: this.workspace.index.all(page.root),
        page,
        today: this.today(root),
        pageHref,
        showTasks,
        interactive,
      });
  }

  /** Root of the wiki that contains `key`, for date computations. */
  rootOf(key: string): WikiRoot {
    return this.workspace.rootFor(this.pageFor(key));
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}

export const dailyPath = (config: PlannerConfig, date: string) =>
  posix.join(config.dailyFolder, `${date}.md`);

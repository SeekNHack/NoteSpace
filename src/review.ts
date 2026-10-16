import * as vscode from 'vscode';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { WikiWorkspace } from './workspace';
import { Page } from './core/model';
import {
  parseReview,
  reanchor,
  REVIEW_DIR,
  REVIEW_SCHEMA,
  ReviewFile,
  ReviewThread,
  serializeReview,
} from './core/review';
import { git, repositoryOf } from './git-history';

type Thread = vscode.CommentThread & { reviewId?: string };
class Note implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  contextValue = 'reviewComment';
  constructor(
    readonly id: string,
    public body: vscode.MarkdownString,
    readonly author: vscode.CommentAuthorInformation,
    readonly timestamp: Date,
  ) {}
}

/**
 * Review threads for wiki pages, shown with VS Code's comment UI in Code mode and stored in
 * `<wiki>/.reviews/<page>.json`. Nothing is sent anywhere; sharing happens through the files.
 */
export class ReviewController implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController(
    'notespace.review',
    'Wiki review',
  );
  private readonly threads = new Map<string, Thread[]>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private author?: string;

  constructor(private readonly workspace: WikiWorkspace) {
    this.controller.options = {
      placeHolder: 'Write a review comment',
      prompt: 'Add a review comment',
    };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) =>
        this.pageOf(document.uri)
          ? [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)]
          : [],
    };
    this.subscriptions = [
      this.controller,
      vscode.workspace.onDidOpenTextDocument(
        (d) => void this.load(d.uri).catch((e) => workspace.log.appendLine(String(e))),
      ),
      vscode.workspace.onDidSaveTextDocument(
        (d) => void this.saveAnchors(d).catch((e) => workspace.log.appendLine(String(e))),
      ),
      workspace.onDidChange(() => {
        for (const d of vscode.workspace.textDocuments)
          if (!this.threads.has(d.uri.toString())) void this.load(d.uri).catch(() => {});
      }),
    ];
    for (const d of vscode.workspace.textDocuments) void this.load(d.uri).catch(() => {});
  }

  private pageOf(uri: vscode.Uri): Page | undefined {
    return this.workspace.index.byUri(uri.toString());
  }
  reviewUri(page: Page): vscode.Uri {
    return vscode.Uri.joinPath(this.workspace.rootFor(page).uri, REVIEW_DIR, `${page.path}.json`);
  }
  async read(page: Page): Promise<ReviewFile> {
    try {
      return parseReview(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(this.reviewUri(page))),
        page.path,
      );
    } catch (e) {
      if (e instanceof vscode.FileSystemError)
        return { schema: REVIEW_SCHEMA, page: page.path, threads: [] };
      throw e;
    }
  }
  private async write(page: Page, file: ReviewFile): Promise<void> {
    const uri = this.reviewUri(page);
    await this.workspace.assertNoSymlink(this.workspace.rootFor(page), uri);
    if (!file.threads.length) {
      await vscode.workspace.fs.delete(uri).then(undefined, () => {});
    } else {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(serializeReview(file)));
    }
    this.emitter.fire();
  }
  private async whoAmI(uri: vscode.Uri): Promise<string> {
    if (this.author) return this.author;
    const repo = await repositoryOf(uri);
    const name = repo
      ? (await git(['config', '--get', 'user.name'], repo).catch(() => '')).trim()
      : '';
    return (this.author = name || os.userInfo().username || 'Reviewer');
  }

  /** Shows the stored threads of a page in its open editors. */
  async load(uri: vscode.Uri): Promise<void> {
    const page = this.pageOf(uri);
    if (!page) return;
    const key = uri.toString();
    for (const thread of this.threads.get(key) || []) thread.dispose();
    const file = await this.read(page);
    const document = await vscode.workspace.openTextDocument(uri);
    const lines = document.getText().split(/\r?\n/);
    this.threads.set(
      key,
      file.threads.map((t) => {
        const at = reanchor(t.anchor, lines);
        const thread = this.controller.createCommentThread(
          uri,
          new vscode.Range(at.line, 0, at.line, 0),
          [],
        ) as Thread;
        thread.reviewId = t.id;
        thread.label = at.found ? undefined : 'The commented text changed';
        this.fill(thread, t);
        return thread;
      }),
    );
  }
  private fill(thread: Thread, t: ReviewThread) {
    thread.comments = t.comments.map(
      (c) =>
        new Note(c.id, new vscode.MarkdownString(c.body), { name: c.author }, new Date(c.created)),
    );
    thread.state =
      t.status === 'resolved'
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
    thread.contextValue = t.status === 'resolved' ? 'reviewResolved' : 'reviewOpen';
    thread.canReply = t.status === 'open';
    thread.collapsibleState =
      t.status === 'resolved'
        ? vscode.CommentThreadCollapsibleState.Collapsed
        : vscode.CommentThreadCollapsibleState.Expanded;
  }
  private async update(
    uri: vscode.Uri,
    change: (file: ReviewFile, lines: string[]) => void,
  ): Promise<void> {
    const page = this.pageOf(uri);
    if (!page) throw new Error('Review comments are available for wiki pages.');
    const file = await this.read(page);
    const lines = (await vscode.workspace.openTextDocument(uri)).getText().split(/\r?\n/);
    change(file, lines);
    await this.write(page, file);
    await this.load(uri);
  }

  /** New thread on `line`, or a reply to an existing thread. */
  async comment(uri: vscode.Uri, line: number, body: string, threadId?: string): Promise<string> {
    if (!body.trim()) throw new Error('The comment is empty.');
    const author = await this.whoAmI(uri);
    const id = threadId || randomBytes(6).toString('hex');
    await this.update(uri, (file, lines) => {
      const comment = {
        id: randomBytes(6).toString('hex'),
        author,
        created: new Date().toISOString(),
        body,
      };
      const existing = file.threads.find((t) => t.id === threadId);
      if (existing) existing.comments.push(comment);
      else
        file.threads.push({
          id,
          status: 'open',
          anchor: { line, quote: lines[line] ?? '' },
          comments: [comment],
        });
    });
    return id;
  }
  async setStatus(uri: vscode.Uri, threadId: string, status: 'open' | 'resolved'): Promise<void> {
    await this.update(uri, (file) => {
      const thread = file.threads.find((t) => t.id === threadId);
      if (thread) thread.status = status;
    });
  }
  async deleteComment(uri: vscode.Uri, threadId: string, commentId: string): Promise<void> {
    await this.update(uri, (file) => {
      const thread = file.threads.find((t) => t.id === threadId);
      if (!thread) return;
      thread.comments = thread.comments.filter((c) => c.id !== commentId);
      if (!thread.comments.length) file.threads = file.threads.filter((t) => t !== thread);
    });
  }
  /** After a save, anchors follow their quoted line to its new position. */
  private async saveAnchors(document: vscode.TextDocument): Promise<void> {
    const page = this.pageOf(document.uri);
    if (!page) return;
    const file = await this.read(page);
    if (!file.threads.length) return;
    const lines = document.getText().split(/\r?\n/);
    let changed = false;
    for (const thread of file.threads) {
      const at = reanchor(thread.anchor, lines);
      if (at.found && at.line !== thread.anchor.line) {
        thread.anchor = { line: at.line, quote: lines[at.line] };
        changed = true;
      }
    }
    if (changed) {
      await this.write(page, file);
      await this.load(document.uri);
    }
  }
  async openThreads(page: Page): Promise<ReviewThread[]> {
    return (await this.read(page)).threads.filter((t) => t.status === 'open');
  }

  /** Command handlers for the comment widget menus. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(command: (name: string, fn: (...args: any[]) => unknown) => void): void {
    const run = async (reply: vscode.CommentReply) => {
      const thread = reply.thread as Thread;
      await this.comment(thread.uri, thread.range?.start.line ?? 0, reply.text, thread.reviewId);
      // A brand-new thread is replaced by the stored one that load() just created.
      if (!thread.reviewId) thread.dispose();
    };
    command('review.comment', (reply: vscode.CommentReply) => run(reply));
    command(
      'review.resolve',
      (thread: Thread) =>
        thread.reviewId && this.setStatus(thread.uri, thread.reviewId, 'resolved'),
    );
    command(
      'review.reopen',
      (thread: Thread) => thread.reviewId && this.setStatus(thread.uri, thread.reviewId, 'open'),
    );
    command('review.delete', (comment: Note) => {
      for (const [key, threads] of this.threads)
        for (const thread of threads)
          if (thread.reviewId && thread.comments.includes(comment))
            return this.deleteComment(vscode.Uri.parse(key), thread.reviewId, comment.id);
    });
  }
  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    for (const list of this.threads.values()) list.forEach((t) => t.dispose());
    this.emitter.dispose();
  }
}

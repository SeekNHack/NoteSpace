import * as vscode from 'vscode';
import { Page } from './core/model';
import { WikiWorkspace } from './workspace';
import { movedUri } from './core/activity-uris';

/** Workspace-local UI state. Missing or moved pages are ignored when read. */
export class WikiActivity implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly renameSubscription: vscode.Disposable;
  private readonly moveSubscription: vscode.Disposable;
  readonly onDidChange = this.emitter.event;
  private favorites: string[];
  private recent: string[];
  private visited: Record<string, number>;
  private pending: Promise<void> = Promise.resolve();
  activeUri?: string;
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspace: WikiWorkspace,
  ) {
    this.favorites = context.workspaceState.get<string[]>('favorites', []);
    this.recent = context.workspaceState.get<string[]>('recent', []);
    this.visited = context.workspaceState.get<Record<string, number>>('recentVisited', {});
    this.renameSubscription = vscode.workspace.onDidRenameFiles((event) => {
      void this.renameFiles(event.files).catch(() => {});
    });
    this.moveSubscription = workspace.onDidMove(({ from, to }) => {
      void this.moved(from, to).catch(() => {});
    });
  }
  isFavorite(page: Page): boolean {
    return this.favorites.includes(page.uri);
  }
  favoritePages(): Page[] {
    return this.favorites.flatMap((uri) => this.workspace.index.byUri(uri) || []);
  }
  recentPages(): Page[] {
    return this.recent.flatMap((uri) => this.workspace.index.byUri(uri) || []);
  }
  /** When the page was last opened in this workspace, if known. */
  visitedAt(page: Page): number | undefined {
    return this.visited[page.uri];
  }
  private persist(): Promise<void> {
    const favorites = [...this.favorites],
      recent = [...this.recent],
      visited = Object.fromEntries(
        recent.filter((uri) => this.visited[uri]).map((uri) => [uri, this.visited[uri]]),
      );
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await this.context.workspaceState.update('favorites', favorites);
        await this.context.workspaceState.update('recent', recent);
        await this.context.workspaceState.update('recentVisited', visited);
      });
    return this.pending;
  }
  async toggleFavorite(page: Page): Promise<void> {
    this.favorites = this.isFavorite(page)
      ? this.favorites.filter((uri) => uri !== page.uri)
      : [page.uri, ...this.favorites];
    await this.persist();
    this.emitter.fire();
  }
  async opened(page: Page): Promise<void> {
    this.activeUri = page.uri;
    this.recent = [page.uri, ...this.recent.filter((uri) => uri !== page.uri)].slice(0, 30);
    this.visited[page.uri] = Date.now();
    await this.persist();
    this.emitter.fire();
  }
  async moved(from: string, to: string): Promise<void> {
    this.favorites = this.favorites.map((uri) => movedUri(uri, from, to));
    this.visited = Object.fromEntries(
      Object.entries(this.visited).map(([uri, at]) => [movedUri(uri, from, to), at]),
    );
    this.recent = this.recent.map((uri) => movedUri(uri, from, to));
    if (this.activeUri) this.activeUri = movedUri(this.activeUri, from, to);
    await this.persist();
    this.emitter.fire();
  }
  private async renameFiles(
    files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  ): Promise<void> {
    const translate = (uri: string) => {
      for (const file of files) {
        const old = file.oldUri.toString(),
          next = file.newUri.toString();
        const moved = movedUri(uri, old, next);
        if (moved !== uri) return moved;
      }
      return uri;
    };
    this.favorites = this.favorites.map(translate);
    this.visited = Object.fromEntries(
      Object.entries(this.visited).map(([uri, at]) => [translate(uri), at]),
    );
    this.recent = this.recent.map(translate);
    if (this.activeUri) this.activeUri = translate(this.activeUri);
    await this.persist();
    this.emitter.fire();
  }
  dispose(): void {
    this.renameSubscription.dispose();
    this.moveSubscription.dispose();
    this.emitter.dispose();
  }
}

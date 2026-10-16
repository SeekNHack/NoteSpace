import * as vscode from 'vscode';
import { WikiWorkspace } from './workspace';
import { PlannerService } from './planner';
import { inList } from './core/tasks';
import type { BoardService } from './boards';

interface Node {
  id: string;
  label: string;
  icon: string;
  description?: string;
  tooltip?: string;
  command?: vscode.Command;
  children?: () => Node[];
}

/**
 * The Workspace view in the NoteSpace sidebar: the destinations of the workspace panel and
 * the boards, next to the Pages tree. One entry per destination, not a second application.
 */
export class PlannerTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly planner: PlannerService,
    private readonly boards?: () => BoardService | undefined,
  ) {
    this.subscription = planner.onDidChange(() => this.emitter.fire(undefined));
  }
  getTreeItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `workspace:${node.id}`;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.command = node.command;
    item.contextValue = node.id.startsWith('board:') ? 'wikiBoard' : undefined;
    return item;
  }
  getChildren(node?: Node): Node[] {
    if (node?.children) return node.children();
    if (!this.workspace.roots.length) return [];
    const today = this.planner.today();
    const tasks = this.planner.tasks();
    const count = (list: 'today' | 'overdue' | 'upcoming') =>
      tasks.filter((t) => inList(t, list, today)).length;
    const overdue = count('overdue');
    const note = this.planner.dailyNotes(this.workspace.roots[0]).has(today);
    const open = (command: string, title: string, args: unknown[] = []): vscode.Command => ({
      command,
      title,
      arguments: args,
    });
    return [
      { id: 'home', label: 'Home', icon: 'home', command: open('notespace.home', 'Open Home') },
      {
        id: 'wiki',
        label: 'Wiki',
        icon: 'book',
        tooltip: 'Open the wiki homepage',
        command: open('notespace.openWikiHome', 'Open Wiki Homepage'),
      },
      {
        id: 'tasks',
        label: 'Tasks',
        icon: 'checklist',
        description: `${count('today')} today${overdue ? ` · ${overdue} overdue` : ''}`,
        command: open('notespace.planner', 'Open Tasks', ['today']),
      },
      {
        id: 'boards',
        label: 'Boards',
        icon: 'project',
        command: open('notespace.boards', 'Open Boards'),
        children: () => {
          const service = this.boards?.();
          const boards = service ? service.boards().filter((b) => !b.archived) : [];
          return [
            ...boards.map((b) => ({
              id: `board:${b.id}`,
              label: b.name,
              icon: 'project',
              description: b.pagePath,
              command: open('notespace.openBoard', 'Open Board', [b.id]),
            })),
            {
              id: 'board:status',
              label: 'Status board',
              icon: 'list-tree',
              description: 'all tasks',
              command: open('notespace.openBoard', 'Open Board', ['status']),
            },
            {
              id: 'board:new',
              label: 'New board…',
              icon: 'add',
              command: open('notespace.newBoard', 'New Board'),
            },
          ];
        },
      },
      {
        id: 'calendar',
        label: 'Calendar',
        icon: 'calendar',
        description: `${count('upcoming')} upcoming`,
        command: open('notespace.calendar', 'Open Calendar'),
      },
      {
        id: 'insights',
        label: 'Insights',
        icon: 'graph',
        command: open('notespace.insights', 'Open Insights'),
      },
      {
        id: 'api',
        label: 'API Client',
        icon: 'globe',
        command: open('notespace.apiClient', 'Open API Client'),
      },
      {
        id: 'daily',
        label: note ? "Today's note" : "Create today's note",
        icon: 'notebook',
        description: today,
        command: open('notespace.dailyNote', 'Open Daily Note'),
      },
    ];
  }
  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

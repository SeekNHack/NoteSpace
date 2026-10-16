import * as vscode from 'vscode';
import { WikiRoot, WikiWorkspace } from './workspace';
import { PlannerService } from './planner';
import {
  Board,
  BoardColumn,
  BoardConfig,
  boardFileName,
  boardTemplates,
  columnId,
  columnOf,
  isMember,
  moveChange,
  newBoardText,
  parseBoard,
  STATUS_BOARD,
  subtaskKeys,
  writeBoardConfig,
} from './core/boards';
import {
  completeTaskLine,
  newTaskId,
  Task,
  TaskStatus,
  taskStatuses,
  updateTaskLine,
} from './core/tasks';
import { posix } from './core/paths';

/**
 * Boards over the planner's tasks. Settings live in each board page's front matter; cards are
 * the task lines themselves. Every change is a `WorkspaceEdit` (undoable, visible to open
 * editors, saved only when the document had no unsaved edits).
 */
export class BoardService {
  private readonly cache = new Map<string, { text: string; config?: BoardConfig }>();
  constructor(
    private readonly workspace: WikiWorkspace,
    private readonly planner: PlannerService,
  ) {}

  boards(rootId?: string): Board[] {
    const out: Board[] = [];
    for (const page of this.workspace.index.all(rootId)) {
      if (
        this.workspace.isVariant(page) ||
        (!page.text.startsWith('---') && !page.text.startsWith('﻿---'))
      )
        continue;
      let entry = this.cache.get(page.id);
      if (!entry || entry.text !== page.text) {
        entry = { text: page.text, config: parseBoard(page.text) };
        this.cache.set(page.id, entry);
      }
      if (entry.config)
        out.push({ ...entry.config, pageId: page.id, pagePath: page.path, root: page.root });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  board(id: string, rootId?: string): Board {
    const board = this.boards(rootId).find((b) => b.id === id);
    if (!board)
      throw new Error(
        'This board no longer exists. It may have been deleted or renamed outside NoteSpace.',
      );
    return board;
  }

  tasksOf(board: Board): Task[] {
    const tasks = this.planner.tasks(board.root);
    const subtasks = subtaskKeys(tasks);
    return tasks.filter((t) => isMember(t, board) && (!subtasks.has(t.key) || !!t.board));
  }

  private rootOf(board: Board): WikiRoot {
    const root = this.workspace.roots.find((r) => r.id === board.root);
    if (!root) throw new Error('The wiki of this board is no longer open.');
    return root;
  }

  async create(
    root: WikiRoot,
    options: {
      name: string;
      path?: string;
      template?: string;
      columns?: BoardColumn[];
      color?: BoardConfig['color'];
      icon?: string;
      description?: string;
    },
  ): Promise<Board> {
    const name = options.name.trim().slice(0, 120);
    if (!name) throw new Error('A board needs a name.');
    const folder = vscode.workspace
      .getConfiguration('notespace', root.folder.uri)
      .get<string>('boards.folder', 'boards');
    const path = (options.path?.trim() || boardFileName(name, folder)).replace(/^\/+/, '');
    if (!/\.md$/i.test(path)) throw new Error('A board file must be a Markdown file (.md).');
    const columns = (
      options.columns?.length
        ? options.columns
        : (boardTemplates.find((t) => t.id === options.template) || boardTemplates[0]).columns
    ).map((c) => ({ ...c }));
    const config: BoardConfig = {
      id: `b-${newTaskId().slice(2)}`,
      name,
      ...(options.description?.trim()
        ? { description: options.description.trim().slice(0, 500) }
        : {}),
      ...(options.color ? { color: options.color } : {}),
      ...(options.icon ? { icon: options.icon } : {}),
      columns,
      defaultColumn: (columns.find((c) => !c.completed) || columns[0]).id,
    };
    const uri = await this.workspace.createPage(root, path, newBoardText(config));
    const page = this.workspace.index.byUri(uri.toString());
    if (!page) throw new Error('The board file was created but could not be indexed.');
    return { ...config, pageId: page.id, pagePath: page.path, root: root.id };
  }

  /** Rewrites a board's settings in its page (front matter only). */
  async configure(
    boardId: string,
    mutate: (config: BoardConfig) => BoardConfig | void,
  ): Promise<Board> {
    const board = this.board(boardId);
    const page = this.workspace.index.pages.get(board.pageId)!;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(page.uri));
    const current = parseBoard(document.getText());
    if (!current || current.id !== boardId)
      throw new Error('The board file changed. Reopen the board and try again.');
    const copy: BoardConfig = JSON.parse(JSON.stringify(current));
    const next = mutate(copy) || copy;
    const text = document.getText();
    const updated = writeBoardConfig(text, next);
    if (updated === text) return board;
    // Replace only the front matter: the body (the cards) is not touched.
    const oldEnd = /^(﻿)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0].length ?? 0;
    const newEnd = /^(﻿)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(updated)![0].length;
    const wasDirty = document.isDirty;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(oldEnd)),
      updated.slice(0, newEnd),
    );
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code rejected the board change.');
    if (!wasDirty) await document.save();
    await this.workspace.refresh();
    return this.board(boardId);
  }

  addColumn(boardId: string, title: string, completed = false) {
    return this.configure(boardId, (c) => {
      const clean = title.trim().slice(0, 80);
      if (!clean) throw new Error('A column needs a title.');
      c.columns.push({
        id: columnId(
          clean,
          c.columns.map((x) => x.id),
        ),
        title: clean,
        ...(completed ? { completed: true } : {}),
      });
    });
  }

  updateColumn(
    boardId: string,
    id: string,
    change: Partial<Omit<BoardColumn, 'id'>> & { isDefault?: boolean },
  ) {
    return this.configure(boardId, (c) => {
      const column = c.columns.find((x) => x.id === id);
      if (!column) throw new Error('That column is no longer on the board.');
      if (change.title !== undefined) {
        const title = change.title.trim().slice(0, 80);
        if (!title) throw new Error('A column needs a title.');
        column.title = title;
      }
      if (change.color !== undefined) {
        if (change.color) column.color = change.color;
        else delete column.color;
      }
      if (change.icon !== undefined) {
        if (change.icon) column.icon = change.icon;
        else delete column.icon;
      }
      if (change.completed !== undefined) {
        if (change.completed) column.completed = true;
        else delete column.completed;
      }
      if (change.isDefault) c.defaultColumn = id;
      if (c.columns.find((x) => x.id === c.defaultColumn)?.completed)
        c.defaultColumn = (c.columns.find((x) => !x.completed) || c.columns[0]).id;
    });
  }

  reorderColumns(boardId: string, ids: string[]) {
    return this.configure(boardId, (c) => {
      const byId = new Map(c.columns.map((x) => [x.id, x]));
      if (ids.length !== c.columns.length || ids.some((id) => !byId.has(id)))
        throw new Error('The columns changed. Try again.');
      c.columns = ids.map((id) => byId.get(id)!);
    });
  }

  /** Removes a column. Its cards move to `moveTo`; a column with cards is never removed without one. */
  async removeColumn(boardId: string, id: string, moveTo?: string): Promise<Board> {
    const board = this.board(boardId);
    if (board.columns.length < 2) throw new Error('A board needs at least one column.');
    const cards = this.tasksOf(board).filter((t) => columnOf(t, board) === id);
    if (cards.length) {
      if (!moveTo || moveTo === id || !board.columns.some((c) => c.id === moveTo))
        throw new Error(
          `This column has ${cards.length} card${cards.length === 1 ? '' : 's'}. Choose a column to move ${cards.length === 1 ? 'it' : 'them'} to.`,
        );
      await this.moveMany(
        cards.map((t) => t.key),
        board,
        moveTo,
      );
    }
    return this.configure(boardId, (c) => {
      c.columns = c.columns.filter((x) => x.id !== id);
      if (c.defaultColumn === id)
        c.defaultColumn = (c.columns.find((x) => !x.completed) || c.columns[0]).id;
    });
  }

  private async moveMany(keys: string[], board: BoardConfig, column: string): Promise<void> {
    const byDocument = new Map<
      string,
      { document: vscode.TextDocument; changes: Array<{ line: number; text: string }> }
    >();
    for (const key of keys) {
      const { document, task } = await this.planner.locate(key);
      const entry = byDocument.get(document.uri.toString()) || { document, changes: [] };
      entry.changes.push({
        line: task.line,
        text: updateTaskLine(document.lineAt(task.line).text, moveChange(board, column)),
      });
      byDocument.set(document.uri.toString(), entry);
    }
    for (const { document, changes } of byDocument.values())
      await this.planner.edit(document, changes);
  }

  /**
   * Moves a card to a column (and position). Entering a completed column completes the task
   * (with `done:` and the next occurrence of a recurring task); leaving it reopens it.
   */
  async moveCard(boardId: string, key: string, column: string, order?: string[]): Promise<void> {
    if (boardId === STATUS_BOARD) {
      if (!taskStatuses.includes(column as TaskStatus)) throw new Error('Unknown status column.');
      await this.planner.setStatus(key, column as TaskStatus);
    } else {
      const board = this.board(boardId);
      const target = board.columns.find((c) => c.id === column);
      if (!target) throw new Error('That column is no longer on the board.');
      const { document, task, page } = await this.planner.locate(key);
      const line = document.lineAt(task.line).text;
      if (target.completed && !task.checked) {
        const result = completeTaskLine(line, this.planner.today(this.workspace.rootFor(page)));
        const indent = /^\s*/.exec(line)![0];
        await this.planner.edit(document, [
          {
            line: task.line,
            text: updateTaskLine(result.line, { column: target.id }),
            // The next occurrence of a recurring task starts in the default column.
            after: result.next
              ? indent + updateTaskLine(result.next, { column: null }).trimStart()
              : undefined,
          },
        ]);
      } else if (columnOf(task, board) !== column || task.column !== column) {
        const change = moveChange(board, column);
        await this.planner.edit(document, [
          {
            line: task.line,
            text: updateTaskLine(
              line,
              target.completed ? { column: target.id } : { ...change, done: null },
            ),
          },
        ]);
      }
    }
    if (order?.length) await this.planner.reorder(order);
  }

  /** Writes a new card to the board's file (status board: the inbox, as before). */
  async addCard(boardId: string, text: string, column?: string, rootId?: string): Promise<void> {
    if (boardId === STATUS_BOARD) {
      const root = this.workspace.roots.find((r) => r.id === rootId) || this.workspace.roots[0];
      if (!root) throw new Error('Open a wiki first.');
      const status = taskStatuses.includes(column as TaskStatus) ? (column as TaskStatus) : 'todo';
      await this.planner.add(
        root,
        text,
        { kind: 'inbox' },
        status === 'todo' ? {} : status === 'done' ? { checked: true } : { status },
      );
      return;
    }
    const board = this.board(boardId);
    const target =
      board.columns.find((c) => c.id === column) ||
      board.columns.find((c) => c.id === board.defaultColumn)!;
    await this.planner.add(
      this.rootOf(board),
      text,
      { kind: 'page', pageId: board.pageId },
      { column: target.id, ...(target.completed ? { checked: true } : {}) },
    );
  }

  /**
   * Adds a task that lives elsewhere (a note) to a board with `board:<id>`, or removes that
   * membership (`boardId` null). The line stays in its page.
   */
  async assign(key: string, boardId: string | null, column?: string): Promise<void> {
    const { document, task, page } = await this.planner.locate(key);
    const line = document.lineAt(task.line).text;
    if (boardId === null) {
      const inFile = this.boards(page.root).some((b) => b.pageId === page.id);
      if (inFile && !task.board)
        throw new Error(
          'This task is written in a board file. Move it to another page to take it off the board.',
        );
      await this.planner.edit(document, [
        { line: task.line, text: updateTaskLine(line, { board: null, column: null }) },
      ]);
      return;
    }
    const board = this.board(boardId, page.root);
    const own = board.pageId === page.id;
    const target =
      board.columns.find((c) => c.id === column) ||
      board.columns.find((c) => c.id === board.defaultColumn)!;
    await this.planner.edit(document, [
      {
        line: task.line,
        text: updateTaskLine(line, {
          board: own ? null : board.id,
          ...moveChange(board, target.id),
          ...(target.completed ? {} : { done: null }),
        }),
      },
    ]);
  }

  /**
   * Explicitly moves a task (with its description and subtasks) into a board's file. Its
   * `board:` word is no longer needed there and is removed.
   */
  async moveToBoardFile(key: string, boardId: string): Promise<void> {
    const { document, task, page } = await this.planner.locate(key);
    const board = this.board(boardId, page.root);
    if (board.pageId === page.id) return;
    const target = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(this.workspace.index.pages.get(board.pageId)!.uri),
    );
    // The block: the task line and following lines indented deeper (description, subtasks).
    const indent = /^\s*/.exec(document.lineAt(task.line).text)![0].length;
    let end = task.line + 1;
    while (end < document.lineCount) {
      const text = document.lineAt(end).text;
      if (text.trim() && /^\s*/.exec(text)![0].length <= indent) break;
      if (
        !text.trim() &&
        (end + 1 >= document.lineCount ||
          /^\s*/.exec(document.lineAt(end + 1).text)![0].length <= indent)
      )
        break;
      end++;
    }
    const lines: string[] = [];
    for (let i = task.line; i < end; i++)
      lines.push(
        document
          .lineAt(i)
          .text.slice(Math.min(indent, /^\s*/.exec(document.lineAt(i).text)![0].length)),
      );
    lines[0] = updateTaskLine(lines[0], {
      board: null,
      column:
        task.column && board.columns.some((c) => c.id === task.column)
          ? task.column
          : columnOf(task, board),
    });
    const eol = target.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const targetText = target.getText();
    const ending = targetText.length && !/\n$/.test(targetText) ? eol : '';
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      target.uri,
      target.positionAt(targetText.length),
      `${ending}${lines.join(eol)}${eol}`,
    );
    // Remove the block with its line break (at the end of the file: with the previous one).
    const range =
      end < document.lineCount
        ? new vscode.Range(task.line, 0, end, 0)
        : new vscode.Range(
            task.line > 0 ? document.lineAt(task.line - 1).range.end : new vscode.Position(0, 0),
            document.lineAt(end - 1).range.end,
          );
    edit.delete(document.uri, range);
    const dirty = [document.isDirty, target.isDirty];
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('VS Code rejected the move.');
    if (!dirty[0]) await document.save();
    if (!dirty[1]) await target.save();
  }

  async duplicateTask(key: string): Promise<void> {
    const { document, task } = await this.planner.locate(key);
    const line = document.lineAt(task.line).text.replace(/(^|\s)\^[A-Za-z0-9-]+(?=\s|$)/, '');
    const copy = updateTaskLine(line, { checked: false, done: null, order: null });
    await this.planner.edit(document, [
      { line: task.line, text: document.lineAt(task.line).text, after: copy },
    ]);
  }

  async duplicate(boardId: string, name: string, path?: string): Promise<Board> {
    const board = this.board(boardId);
    return this.create(this.rootOf(board), {
      name,
      path,
      columns: board.columns,
      color: board.color,
      icon: board.icon,
      description: board.description,
    });
  }

  /** Board file and the number of cards that live in it (shown before deleting). */
  describe(boardId: string): { board: Board; inFile: number; linked: number } {
    const board = this.board(boardId);
    const tasks = this.tasksOf(board);
    return {
      board,
      inFile: tasks.filter((t) => t.pageId === board.pageId).length,
      linked: tasks.filter((t) => t.pageId !== board.pageId).length,
    };
  }

  /** Moves the board's file to Wiki Trash (restorable). Tasks in other pages keep their lines. */
  async remove(boardId: string): Promise<vscode.Uri> {
    const board = this.board(boardId);
    const page = this.workspace.index.pages.get(board.pageId)!;
    return this.workspace.trashPage(page);
  }

  relativePath(board: Board): string {
    return posix.join(this.rootOf(board).name, board.pagePath);
  }
}

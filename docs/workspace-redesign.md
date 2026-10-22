# Unified workspace, boards and planner — audit and design

This document records the audit done before the unified-workspace work (1.11.0) and the design that came out of it. User documentation is in [planner.md](planner.md).

## Audit (state before 1.11.0)

| Area                         | Finding                                                                                                                                                                                                                                                                           | Reused?                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Task model (`core/tasks.ts`) | Tasks are Markdown task-list lines in any page. Metadata is plain `key:value` words (`due:`, `start:`, `priority:`, `status:`, `repeat:`, `project:`, `order:`), `@person`, `#tag`, and a block id `^t-xxxxxx`. A task's key is `pageId#id`, or `pageId@line:hash` without an id. | Yes — extended with `board:` and `col:`                         |
| Writes (`planner.ts`)        | Every change is a one-line `WorkspaceEdit` on the page's document; clean documents are saved again, dirty ones stay dirty; tasks are re-located in the live buffer before editing.                                                                                                | Yes — boards use the same path                                  |
| Inbox                        | `PlannerService.add` writes to `notespace.planner.inbox` (default `Inbox.md`) unless the target is a daily note. Every board card was therefore created in the inbox.                                                                                                             | Kept for global capture only                                    |
| Board                        | One global board whose columns are the four statuses (`todo`, `doing`, `blocked`, `done`); column order is a per-workspace preference; cards move by rewriting `status:`.                                                                                                         | Kept as the built-in **Status board**                           |
| Calendar, lists, table       | One webview (`planner-ui.ts`) with eight tabs over the same task array.                                                                                                                                                                                                           | Yes                                                             |
| Home                         | A separate dashboard webview (`webviews.ts`) with health numbers, structure, favorites, recent pages and today's tasks.                                                                                                                                                           | Data sources reused; the page is replaced by the workspace Home |
| Sidebar                      | Pages tree, Planner tree (counts, shortcuts), Page view.                                                                                                                                                                                                                          | Planner tree becomes the **Workspace** tree                     |
| Tests                        | Unit tests for parsing/updating lines, extension-host planner tests, a code-server Planner journey. No coverage for multiple boards (none existed).                                                                                                                               | Extended                                                        |

Constraints: everything must work in VS Code desktop and code-server (webviews, no Node APIs in the webview), stay local, keep Markdown readable and keep untouched lines byte-identical.

## Design

**One workspace panel.** The Planner panel becomes the _NoteSpace_ panel. Since the sidebar redesign its navigation has five sections — **Home, Wiki, Tasks** (List, Boards, Calendar), **API, Insights** (Overview, Content health, Link graph) — and the sidebar only launches it. _Wiki_ reads the wiki's pages in the panel with an MkDocs-style page tree (Edit opens the real document). The other destinations render in the same tab, so switching keeps filters, scroll and drafts.

**Boards are Markdown files.** A board is a page whose front matter has a `notespace` block of `type: board`:

```markdown
---
notespace:
  type: board
  id: board-k3x9q2
  name: Development
  color: blue
  icon: code
  default_column: backlog
  columns:
    - { id: backlog, title: Backlog, color: gray }
    - { id: dev, title: Developing, color: blue }
    - { id: released, title: Released, color: green, completed: true }
---

# Development

- [ ] Implement new homepage col:dev ^t-a1b2c3
- [ ] Add task filtering ^t-d4e5f6
```

- Board, column and task identities are stable ids; titles can change freely.
- A task **belongs** to a board when it carries `board:<id>`, or, without that word, when it is written in the board's file. Membership never requires moving or copying a line.
- Its **column** is `col:<id>`. Without it: checked tasks go to the first completed column, open tasks to the default column (or a column whose id matches their `status:`).
- Moving to a column marked `completed` checks the box; moving out unchecks it. Other metadata is untouched.
- New cards are written to the board's file. Quick capture elsewhere still writes to the inbox (or today's note, or the current page).
- Only the `notespace` key of the front matter is rewritten when a board's settings change; other front matter, headings and notes stay as written.

**Built-in Status board.** The previous global board stays available as _Status board_: all tasks of the wiki in `To do / In progress / Blocked / Done`, moved by `status:` as before. Nothing is migrated: existing pages, `Inbox.md`, statuses and ids keep working.

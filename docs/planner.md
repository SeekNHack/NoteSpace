# Workspace: Home, tasks, boards, calendar and daily notes

Everything the workspace shows lives in ordinary Markdown pages. There is no database, account or server, and nothing is copied: the Today/Upcoming/Inbox/Overdue/Done lists, the board, the calendar, the table, page embeds, search and the dashboard all read the same task lines.

## Task schema

A task is a Markdown task-list item anywhere in a wiki page (fenced code is ignored). Optional metadata are plain words after the title:

```md
- [ ] Write the release notes due:2026-10-20 priority:high status:doing project:Launch_Plan #docs @alice ^t-k3x9q2
      Notes for the task are indented lines under it.
```

| Field         | Syntax                                                                                                    | Notes                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Title         | text after the checkbox                                                                                   | Tags and `[[wiki links]]` stay part of the title                                   |
| Done          | `[x]`                                                                                                     | Checked items are always `done`                                                    |
| Status        | `status:doing` \| `status:blocked`                                                                        | `todo` and `done` need no token                                                    |
| Priority      | `priority:high` \| `medium` \| `low`                                                                      |                                                                                    |
| Due date      | `due:YYYY-MM-DD` or `due:YYYY-MM-DDTHH:MM`                                                                | A calendar date, optionally with a local time                                      |
| Start date    | `start:YYYY-MM-DD`                                                                                        | The task appears in Today from this date                                           |
| Completed on  | `done:YYYY-MM-DD`                                                                                         | Written when the Planner completes a task                                          |
| Recurrence    | `repeat:daily` \| `weekdays` \| `weekly` \| `monthly` \| `yearly` \| `every-N-days\|weeks\|months\|years` |                                                                                    |
| Project       | `project:Name`                                                                                            | Underscores stand for spaces                                                       |
| Assignee      | `@name`                                                                                                   | Free text, no account                                                              |
| Tags          | `#tag`                                                                                                    |                                                                                    |
| Board         | `board:<board id>`                                                                                        | Puts a task from any page on a board; tasks written in a board's file need none    |
| Column        | `col:<column id>`                                                                                         | The task's column on its board (stable id, not the column title)                   |
| Board order   | `order:N`                                                                                                 | Written when cards are reordered                                                   |
| Stable id     | `^t-xxxxxx`                                                                                               | Added only when the Planner needs to find the task again (board order, recurrence) |
| Description   | indented lines under the item                                                                             | Read-only in the Planner; edit them in the page                                    |
| Page relation | the page that contains the task, plus `[[links]]` in its title                                            |                                                                                    |

Unknown words and invalid values (for example `due:tomorrow` typed into a page, or `priority:urgent`) stay in the line as text and are ignored as metadata. Studio shows metadata words as chips without changing the Markdown.

**Quick add** (Home, Tasks, **Add Task**, **Ctrl/Cmd+Alt+T**) accepts relative dates — `today`, `tomorrow`, `yesterday`, `+3d`, `+2w`, `+1m`, `mon`…`sun` — and writes absolute dates.

**Where new tasks are written**

| Created from                                  | Written to                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Quick capture (Home, Tasks, Add Task command) | the inbox page (`notespace.planner.inbox`, default `Inbox.md`), or today's daily note when `notespace.tasks.captureTo` is `daily` |
| A board's column (“+ Add a card”)             | the **board's file**, with `col:<column>`                                                                                         |
| The calendar (a day)                          | the inbox page, with `due:` or `start:` that day                                                                                  |
| A page (typed in Studio or Code)              | that page                                                                                                                         |
| The Status board                              | the inbox page, with the column's status (as before)                                                                              |

Moving a card between columns changes only its `col:` word (and its checkbox for completed columns) — never its file. Adding a task to another board adds `board:<id>`; the line stays where it is. **Move into board file** (card or task menu) is the explicit way to move a task's line (with its notes and subtasks) into a board's file.

## Dates, time zones and recurrence

Due and start dates are calendar dates without a time zone. Which day is _today_ is decided in `notespace.planner.timeZone` (an IANA zone such as `Europe/Rome`), or in the machine's zone when empty; the Planner shows the zone it uses. Day boundaries follow that zone, including daylight-saving changes (`today follows the configured time zone across the day boundary` unit test).

Completing a recurring task keeps the completed line (with `done:`) as history and inserts the next occurrence right after it, with the due date (and start date, keeping the same lead time) moved by the rule. Monthly and yearly rules clamp to the last day of shorter months (31 Jan → 28 Feb). Overdue recurring tasks advance from their due date, not from today.

## Daily notes

One page per date in `notespace.dailyNotes.folder` (default `daily`), named `YYYY-MM-DD.md`. New notes use `notespace.dailyNotes.template` (a page relative to the wiki root) or the built-in template; placeholders: `{{title}}`, `{{date}}`, `{{weekday}}`, `{{yesterday}}`, `{{tomorrow}}`. Commands: **Open Today's Daily Note** (**Ctrl/Cmd+Alt+D**), **Previous/Next Daily Note** (to the nearest existing note, or the adjacent day; also in the editor title of a daily note), **Open Daily Note for Date…** (accepts dates and relative words). Daily notes are normal pages: Studio, Code and Split, links and backlinks all apply. Tasks in a daily note appear in Today on that date. The calendar marks days with notes; the journal streak and the 12-week activity strip count actual note files.

## The workspace panel

**Open NoteSpace** (the NoteSpace icon in the activity bar, the status bar, or the Command Palette) opens one editor tab that works like a small website. Its navigation has five sections (**Alt+1…5**):

- **Home** — today's tasks, the calendar, recent pages and boards.
- **Wiki** — the pages, read in place MkDocs-style: the page tree on the left (folders are sections; a folder's `index.md` or `README.md` is the section's page; notebooks and canvases are listed too), the page with breadcrumbs, previous/next and backlinks, and its outline on the right. Links stay in the panel; **Edit** opens the Markdown file, **Open in Reader** opens the Reader beside. The tree is the wiki's file manager: right-click (or Shift+F10) a page or folder to edit, rename, move, duplicate, copy its link, add it to Favorites (listed at the top), see its history or delete it; drag pages and folders onto a folder (or onto the wiki's name for the top level) to move them. The **⋯** menu has the wiki's settings, export, import and removal.
- **Tasks** — one set of tasks, three pages: **List** (today, upcoming, overdue, inbox, all, completed; list or table), **Boards** (every board and the built-in status board) and **Calendar**.
- **API** — the API Client; open requests and drafts are kept while you switch.
- **Insights** — **Overview** (numbers), **Content health** (the full report) and **Link graph**; selecting a page in the graph opens it in the Wiki.

A section opens on the page last shown in it; choosing it again goes to its first page. **Back** and **Forward** (the arrows at the left of the navigation, **Alt+←/→** or the mouse side buttons) move through the places visited. **Search** (or **/**) finds pages, tasks, boards and the panel's own pages. With several wikis, a selector in the navigation picks the wiki. Clicking the NoteSpace icon closes the sidebar to give the tab the space (`notespace.sidebar.openPanel`).

- **Home** — workspace name and description, search, **Create** (wiki page, note, folder, task, board, daily note, page from template), **Today** (overdue and due today, progress, quick add, inline completion), a **calendar preview** (dots for tasks and daily notes, the selected day's tasks, upcoming deadlines; double-click a day to open it), **Continue working** (recently edited pages with their folder and time, favorites) and **My boards** (pinned, then recently used).
- **Tasks** — Today, Upcoming, Overdue, Inbox, All open and Completed as a list or a table, grouped by board, page, priority or project, filtered by text, board, label, project, assignee and priority. **Saved views** keep a list, layout, grouping and filters under a name.
- **Boards** — every board as a card (task count, in-progress count, open count), pin, rename and settings, duplicate (columns only), archive, open file, delete. The built-in **Status board** shows every task by status, as the earlier Planner board did.
- **Calendar** — month, week and day; due dates and start dates (▸); double-click a day (or press **N** on it) to add a task due or starting that day; drag a task to another day; click a task to edit it.
- **Insights** — wiki health score, broken links, pages without links to them (daily notes, the inbox and boards are exempt), content issues, pages, words, folders, daily notes, task completion, overdue tasks and tasks done in the last 7 days, with the full Content Health report one click away.

Earlier **Open Planner**, **Open Kanban Board** and the list commands still work and open the matching destination.

## Boards

A board is a Markdown page with a `notespace` block in its front matter; the cards are its task lines (and tasks from other pages that carry `board:<id>`):

```markdown
---
notespace:
  type: board
  id: b-k3x9q2
  name: Development
  color: blue
  default_column: backlog
  columns:
    - { id: backlog, title: Backlog, color: gray }
    - { id: developing, title: Developing, color: blue }
    - { id: released, title: Released, color: green, completed: true }
---

# Development

- [ ] Implement new homepage col:developing ^t-a1b2c3
- [ ] Add task filtering
```

- **Create** a board from **Create → Kanban board**, **Boards → New board**, the board switcher or **New Board** (Command Palette): name, file (suggested as `boards/<name>.md`, folder `notespace.boards.folder`), starting columns (To do/Doing/Done, Development, Personal, Content) and color. An existing file is never overwritten.
- **Columns** are specific to each board: add, rename inline (click the title, or **F2**), recolor, choose an icon, set the default column for new cards, mark a column as _completed_, reorder by dragging the grip or **Alt+Shift+←/→**, delete. A column that still has cards is deleted only after you choose where its cards go; no task is ever deleted with a column.
- **Cards**: click the title to edit it inline (**Enter** saves, **Escape** cancels); the checkbox completes it (moving it to the completed column); hover buttons change priority and due date; the **…** menu or right-click offers details, labels, priority, due date, move to column, add to another board, move into board file, duplicate, open the source page and delete. Drag cards between columns and within a column (a line shows where they will land), or use **Alt+←/→** and **Alt+↑/↓**. Changes appear at once and are undone if the file cannot be written. Cards show the description's first line, priority, due date, labels, assignee, the source page of linked tasks and subtask progress; **Compact cards** shows less. Tasks indented under another task are its checklist, not separate cards.
- **Order**: manual (persisted with `order:`), by due date or by priority. Optional swimlanes by project or priority. Board settings (name, description, icon, color, density, order, archived) are written to the board's front matter; only the `notespace` block changes — other front matter and the page body stay as written.
- **Delete** moves the board's file (with the tasks written in it) to Wiki Trash, where it can be restored; tasks of other pages keep their lines.

**Add Task to Board** (Command Palette, with the cursor on a task line) and the task menus put a task from any note on a board with `board:<id>`.

**Task details** (click a task or press **Enter**) edits title, status, priority, due and start dates, recurrence, project, assignee and board membership (the column on each board); **Complete**, **Open in page**, **Delete** (confirmed). Shortcuts: **n** focuses quick add, **/** the filter, **c** opens Create, **Esc** closes details, **Space** completes the focused task, **F2** renames it, **Shift+F10** opens its menu.

### Persistence

Each Planner action is one `WorkspaceEdit` on the affected line(s), so VS Code undo works in the page, other open editors (Studio, Code, Split) update immediately, and a page with unsaved edits stays unsaved. A page that was clean is saved after the edit. If a task line changed elsewhere in the meantime, the Planner refuses the edit and refreshes instead of guessing. External file changes (another tool, Git) are picked up by every view.

## Collections in pages

A fenced block shows a live view in the reader, in Studio's preview and, if allowed, in exports:

````md
```tasks
project: Launch
status: open
view: list | table | board
```

```collection
source: pages
folder: projects
view: list | table | gallery
```
````

Task options: `status` (`open` default, `todo`, `doing`, `blocked`, `done`, `all`), `project`, `tag`, `assignee`, `priority`, `list` (`today`, `upcoming`, `overdue`, `inbox`, `completed`), `page: this`, `links: this` (tasks that link to this page), `search`, `limit`, `title`. Page options: `folder`, `tag`, `view`, `limit`. **Search Pages** includes matching tasks.

With `view: board` the cards can be moved in the reader and in Studio: drag a card to another status column, or focus it and press **Alt+←** / **Alt+→**. The move rewrites only that task's line in its page (Done checks it and adds `done:`, with the next occurrence for recurring tasks; moving out of Done unchecks it and removes `done:`), shows at once and is undone with a message if the line changed meanwhile. Order inside a column follows the task order and is not changed by dragging. Exported pages show the board read-only.

## Static export and privacy

By default, exports and builds leave out daily notes, the inbox page and task embeds (shown as "Planner data is not included in this export"). Set `features.plannerExport: true` in `wiki.yaml` to include them; the export then also contains `planner.html`, a read-only snapshot of overdue, today, upcoming and the board.

## Reminders

`notespace.planner.reminders` (off by default) shows at most one notification per day for tasks due today or overdue, checked every ten minutes while VS Code is running. Nothing is scheduled outside the extension host: no reminder fires while VS Code or code-server is closed, or while the browser tab of code-server is disconnected.

## Compatibility

Existing `- [ ] task` lists, daily notes created by earlier versions in `daily/`, and pages without metadata keep working unchanged; metadata is optional and additive.

Upgrading to 1.11 needs no migration: nothing is moved or rewritten. The previous single board is the **Status board**; `Inbox.md` keeps receiving quick capture; the saved Planner view maps to the matching destination. New words (`board:`, `col:`) are written only when you use boards. Earlier versions ignore those words as metadata and show them as part of the task text.

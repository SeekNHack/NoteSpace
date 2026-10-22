// The guide (?): every feature in short topics with their own search. The topics are bundled
// with the panel, not pages of the wiki, so Find and the wiki's search never list them.
import { h, svg } from './core';

interface Topic {
  id: string;
  group: string;
  title: string;
  /** Extra words that should find the topic (Italian synonyms included). */
  keywords: string;
  /** Static HTML written here, never user content. */
  html: string;
}

const code = (text: string) =>
  `<pre><code>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;

const topics: Topic[] = [
  // Getting around
  {
    id: 'tab',
    group: 'Getting around',
    title: 'The NoteSpace tab',
    keywords: 'navigation sections home wiki tasks api insights back forward scheda navigazione',
    html: `<p>NoteSpace opens as one tab that works like a small website. The sections are <b>Home</b>, <b>Wiki</b>, <b>Tasks</b>, <b>API</b> and <b>Insights</b> (<kbd>Alt+1</kbd>…<kbd>Alt+5</kbd>). Each section reopens on the page last shown in it.</p>
<ul><li><b>Back / Forward</b>: the arrows at the left, <kbd>Alt+←</kbd> / <kbd>Alt+→</kbd> or the mouse side buttons.</li>
<li><b>Search</b> (<kbd>/</kbd>) finds pages, tasks, boards and the tab's own pages.</li>
<li><b>+</b> (<kbd>C</kbd>) creates a page, a task, a board, a daily note, a blog post, a clip or a page from a template.</li>
<li>Click the <b>wiki's name</b> at the top left to rename it.</li></ul>`,
  },
  {
    id: 'find',
    group: 'Getting around',
    title: 'Find (/)',
    keywords: 'search cerca ricerca trova quick open',
    html: `<p>Press <kbd>/</kbd> or click <b>Search</b> in the header. Results group pages, tasks, boards and places of the tab; <kbd>↑</kbd>/<kbd>↓</kbd> move and <kbd>Enter</kbd> opens. Typing a tag lists its pages.</p>
<p>This guide is not part of the search: use the search box above to look through it.</p>`,
  },
  {
    id: 'keys',
    group: 'Getting around',
    title: 'Keyboard shortcuts',
    keywords: 'keys keyboard shortcuts scorciatoie tastiera hotkeys',
    html: `<table><tbody>
<tr><td><kbd>/</kbd></td><td>Search</td></tr>
<tr><td><kbd>?</kbd></td><td>This guide</td></tr>
<tr><td><kbd>C</kbd></td><td>Create menu</td></tr>
<tr><td><kbd>N</kbd></td><td>Quick add a task</td></tr>
<tr><td><kbd>F</kbd></td><td>Filter the current list</td></tr>
<tr><td><kbd>Alt+1</kbd>…<kbd>Alt+5</kbd></td><td>Home, Wiki, Tasks, API, Insights</td></tr>
<tr><td><kbd>Alt+←</kbd> / <kbd>Alt+→</kbd></td><td>Back / Forward (on a focused card: move it between columns)</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+H</kbd></td><td>Open NoteSpace</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+W</kbd></td><td>Search pages</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+D</kbd></td><td>Today's daily note</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+T</kbd></td><td>Add a task</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+E</kbd></td><td>Switch a page between Studio and Code</td></tr>
</tbody></table>`,
  },
  {
    id: 'rename',
    group: 'Getting around',
    title: 'Name, icon and color of the wiki',
    keywords: 'rename wiki name title icon color rinomina nome colore icona settings impostazioni',
    html: `<p>Click the wiki's name at the top left, type the new name and press <kbd>Enter</kbd> (<kbd>Esc</kbd> cancels). A wiki with <code>wiki.yaml</code> stores it as <code>wiki.title</code>; otherwise it is the <code>notespace.wikiName</code> setting of the folder.</p>
<p>The <b>…</b> menu at the top of the page tree has <b>Wiki Settings</b>, <b>Edit Description…</b>, <b>Change Icon…</b>, <b>Change Color…</b> and the export and import commands.</p>`,
  },
  // Wiki
  {
    id: 'pages',
    group: 'Wiki',
    title: 'Pages and the page tree',
    keywords:
      'page tree folder sidebar move drag rename duplicate delete favorites pagina cartella preferiti',
    html: `<p>Every page is a Markdown file. Folders are sections. A folder's own page is its <code>index.md</code> or <code>README.md</code>, or a page with the folder's name beside it (<code>Guide.md</code> next to <code>Guide/</code>) or inside it (<code>Guide/Guide.md</code>). When you name a new page or folder like one already there (even with different capitals), NoteSpace tells you what will happen.</p>
<ul><li>Right-click a page or folder (or its <b>…</b>) for edit, open beside, rename, move, duplicate, favorites, properties, history, export as PDF and delete.</li>
<li>Drag pages and folders to move them.</li>
<li><b>Filter pages</b> narrows the tree; <b>Favorites</b> are listed on top.</li>
<li>The panel button left of the wiki's name hides the tree; the one at the top left of the page brings it back.</li>
<li>The book icon opens a page in the Reader beside.</li></ul>`,
  },
  {
    id: 'editing',
    group: 'Wiki',
    title: 'Editing pages',
    keywords: 'edit modify write editor studio inline done save modifica scrivi salva',
    html: `<p>The pencil above a page edits it right there, in the Wiki: the visual editor (Studio) takes the page's place with its formatting bar, <kbd>/</kbd> menu and <code>[[</code> link completion. The page tree stays beside it.</p>
<ul><li><b>Done</b> saves the page and shows it again. Going to another page or section also saves.</li>
<li>The panel icon next to Done opens the page in an editor tab, where you can switch between Studio, Code (the Markdown source) and Split.</li>
<li>Links you follow while editing open their page in the Wiki.</li>
<li>Pages with syntax the visual editor cannot keep exactly are shown read-only there; edit them as Code.</li></ul>`,
  },
  {
    id: 'links',
    group: 'Wiki',
    title: 'Links, backlinks and previews',
    keywords: 'link wiki link backlink mentions unlinked preview hover collegamenti',
    html: `${code('[[Page]]   [[Page|label]]   [[/folder/Page]]   [[Page#Heading]]\n[a relative link](../guide/setup.md)')}
<ul><li>A leading <code>/</code> starts from the wiki root; bare names are found by path, then title or file name.</li>
<li>Hovering a link shows a preview of the page.</li>
<li>Under each page: <b>Linked from</b> (backlinks) and <b>Unlinked mentions</b>, pages that write its title without a link — <b>Link</b> turns the text into <code>[[Title]]</code>.</li></ul>`,
  },
  {
    id: 'properties',
    group: 'Wiki',
    title: 'Front matter and properties',
    keywords:
      'front matter yaml properties status icon cover tags draft order description proprietà',
    html: `${code('---\ntitle: Installation\ndescription: Install the product\norder: 1\nicon: rocket        # an icon name or an emoji\nstatus: new         # new, updated, beta, deprecated, draft\ncover: images/banner.png\ntags: [guide, setup]\ndraft: false\npager: true         # Previous / Next links\n---')}
<p>Under the title, the other front matter keys are <b>properties</b> you can edit in place (text, number, checkbox, date, list, link); <b>Add property</b> adds one. Covers are PNG, JPG, GIF or WebP images.</p>`,
  },
  {
    id: 'pager',
    group: 'Wiki',
    title: 'Previous / Next links',
    keywords: 'pager next previous successivo precedente navigation boxes',
    html: `<p>Pages end with <b>Previous</b> and <b>Next</b> boxes only when they ask for them with <code>pager: true</code> in the front matter. To add or remove them:</p>
<ul><li>the page's menu in the Wiki tree → <b>Previous / Next Links</b>;</li>
<li>the Command Palette → <b>NoteSpace: Toggle Previous / Next Links on This Page</b>.</li></ul>
<p>The order follows the page tree. The Reader and the exported site follow the same setting.</p>`,
  },
  {
    id: 'tags',
    group: 'Wiki',
    title: 'Tags and random page',
    keywords: 'tags tag index random discover etichette',
    html: `<p>Add <code>tags: [a, b]</code> to a page's front matter. The tag button above the page tree (or a tag on a page) opens the <b>tag index</b>. <b>Random Page</b> in the <b>…</b> menu above the page tree (and on Home under Discover) opens any page.</p>`,
  },
  {
    id: 'databases',
    group: 'Wiki',
    title: 'Folders as databases',
    keywords: 'database table gallery board notion properties folder tabella galleria',
    html: `<p>Any folder can be shown as a database: <b>Database</b> above a folder's index page, or <b>Open as Database</b> in the folder's menu. Every property used by its pages is a column.</p>
<ul><li><b>Table</b>: edit cells in place, sort by any column.</li>
<li><b>Gallery</b>: cards with each page's <code>cover:</code>.</li>
<li><b>Board</b>: grouped by a property (<code>status</code> by default); moving a card writes the value.</li></ul>
<p><b>New page</b> adds a page to the folder. Only the folder's own pages are listed, not those of subfolders.</p>`,
  },
  {
    id: 'templates',
    group: 'Wiki',
    title: 'Templates and template buttons',
    keywords: 'template modelli gallery button meeting',
    html: `<p><b>+</b> → <b>Page from template</b> opens a gallery with a preview of each template. Your own templates are pages in the wiki's <code>.templates</code> folder.</p>
<p>A link to <code>template:Name</code> in a page becomes a button that creates a page from that template:</p>
${code('[New meeting](template:Meeting)')}`,
  },
  {
    id: 'daily',
    group: 'Wiki',
    title: 'Daily notes',
    keywords: 'daily note journal today diario giornaliero oggi',
    html: `<p><b>Today's note</b> on Home or <kbd>Ctrl/Cmd+Alt+D</kbd> opens <code>daily/YYYY-MM-DD.md</code>, created from <code>notespace.dailyNotes.template</code> or the built-in template. Tasks in a daily note show in Today on that date; the calendar marks days with notes.</p>`,
  },
  {
    id: 'clips',
    group: 'Wiki',
    title: 'Web clips',
    keywords: 'clip web page url bookmark salva pagina web',
    html: `<p><b>+</b> → <b>Clip a web page</b> (or <b>NoteSpace: Clip a Web Page…</b>) asks for an address and saves the page's title, summary, first paragraphs and source link as a note in <code>clips/</code>. Images are not saved.</p>`,
  },
  {
    id: 'blog',
    group: 'Wiki',
    title: 'Blog posts and page lists',
    keywords: 'blog post collection list posts news articoli',
    html: `<p><b>+</b> → <b>Blog post</b> creates a dated post in <code>blog/</code>. A page can list pages of a folder:</p>
${code('```collection\nsource: pages\nfolder: blog\nview: posts      # or list, table, gallery\nsort: title      # optional\n```')}
<p><code>view: posts</code> shows the newest first with date, authors, tags and a summary.</p>`,
  },
  // Writing
  {
    id: 'callouts',
    group: 'Writing',
    title: 'Callouts and layout blocks',
    keywords: 'callout admonition note tip warning tabs details accordion grid card hero blocchi',
    html: `${code(':::warning "Before deployment" collapsed\nKeep a **backup**.\n:::')}
<p>Callouts: <code>note</code>, <code>abstract</code>, <code>info</code>, <code>tip</code>, <code>success</code>, <code>question</code>, <code>warning</code>, <code>failure</code>, <code>danger</code>, <code>bug</code>, <code>example</code>, <code>quote</code>, <code>important</code>. Layout: <code>tabs</code>/<code>tab</code>, <code>details</code>, <code>accordion</code>, <code>stepper</code>/<code>step</code>, <code>timeline</code>/<code>event</code>, <code>grid</code>, <code>card</code>, <code>nav-card</code>, <code>hero</code>, <code>gallery</code>, <code>caption</code>.</p>
<p>Add <code>{color=amber}</code> at the end of the opening line to change the color. In Studio, <kbd>/</kbd> inserts any block.</p>`,
  },
  {
    id: 'inline',
    group: 'Writing',
    title: 'Inline formatting',
    keywords: 'highlight keys badge button tooltip footnote math abbreviation formattazione',
    html: `<table><tbody>
<tr><td><code>==text==</code></td><td>Highlight</td></tr>
<tr><td><code>++Ctrl+K++</code></td><td>Keys</td></tr>
<tr><td><code>{badge:New}</code></td><td>Badge</td></tr>
<tr><td><code>{button:Read guide|guide.md}</code></td><td>Link as a button</td></tr>
<tr><td><code>{tip:API|Application interface}</code></td><td>Explanation on hover</td></tr>
<tr><td><code>{icon:check}</code>, <code>{emoji:smile}</code></td><td>Symbols</td></tr>
<tr><td><code>[^1]</code></td><td>Footnote</td></tr>
<tr><td><code>$x^2$</code>, <code>$$…$$</code></td><td>Math</td></tr>
<tr><td><code>*[API]: Application Programming Interface</code></td><td>Abbreviation</td></tr>
</tbody></table>`,
  },
  {
    id: 'code',
    group: 'Writing',
    title: 'Code blocks and annotations',
    keywords: 'code fence annotate annotations mermaid diagram highlight lines codice',
    html: `${code('```ts title="app.ts" linenums="1" hl_lines="2"\nconst a = 1;\nconst b = 2;\n```')}
<p>Add <code>annotate</code> after the language and end comments with <code>(1)</code>, <code>(2)</code>…; the numbered list right after the block holds the notes, shown as popovers:</p>
${code('```yaml annotate\nport: 8080  # (1)\n```\n\n1. The port the server listens on.')}
<p>A <code>mermaid</code> block is drawn as a diagram.</p>`,
  },
  {
    id: 'blocks',
    group: 'Writing',
    title: 'Block references and embeds',
    keywords: 'block reference embed transclusion include ^id incorpora',
    html: `<p>End a paragraph or list item with <code>^an-id</code>. Then:</p>
${code('[[Page#^an-id]]        link to the block\n![[Page#^an-id]]       show the block here\n![[Page#Heading]]      show a section\n![[Page]]              show a whole page')}
<p>An embed must be alone on its line. To reuse text with placeholders, use <code>{{ include "snippet.md" name="Value" }}</code>.</p>`,
  },
  {
    id: 'mentions',
    group: 'Writing',
    title: 'Date and people mentions',
    keywords: 'mention date person @today @tomorrow menzioni data persona',
    html: `<p><code>@2026-10-22</code>, <code>@today</code> and <code>@tomorrow</code> read as dates and open that day in the calendar. <code>@name</code> is a person and opens their tasks; in a task line it is the assignee.</p>`,
  },
  // Tasks
  {
    id: 'task-syntax',
    group: 'Tasks',
    title: 'Writing tasks',
    keywords:
      'task todo checkbox due priority status repeat project assignee attività scadenza priorità',
    html: `<p>Any <code>- [ ]</code> line in any page is a task. Words after the title add details:</p>
${code('- [ ] Write the notes due:2026-10-20 priority:high status:doing project:Launch #docs @alice')}
<table><tbody>
<tr><td><code>due:YYYY-MM-DD</code></td><td>Due date (optionally <code>THH:MM</code>)</td></tr>
<tr><td><code>priority:high|medium|low</code></td><td>Priority</td></tr>
<tr><td><code>status:doing|blocked</code></td><td>Status (to do and done need nothing)</td></tr>
<tr><td><code>repeat:daily|weekdays|weekly|monthly|yearly</code></td><td>Repeats when completed</td></tr>
<tr><td><code>project:Name</code>, <code>#tag</code>, <code>@person</code></td><td>Grouping</td></tr>
<tr><td><code>board:id</code></td><td>Puts the task on a board</td></tr>
</tbody></table>
<p>In pages, tasks show as checkboxes with badges; ticking one writes the line.</p>`,
  },
  {
    id: 'quick-add',
    group: 'Tasks',
    title: 'Quick add',
    keywords: 'quick add capture inbox new task aggiungi',
    html: `<p>Type a task on Home (Today), in Tasks, with <kbd>N</kbd> or with <kbd>Ctrl/Cmd+Alt+T</kbd>. Relative dates are turned into real ones: <code>today</code>, <code>tomorrow</code>, <code>+3d</code>, <code>+2w</code>, <code>+1m</code>, <code>mon</code>…<code>sun</code>. New tasks go to the inbox page.</p>`,
  },
  {
    id: 'boards',
    group: 'Tasks',
    title: 'Boards',
    keywords: 'board kanban columns cards bacheca colonne schede',
    html: `<p><b>Tasks → Boards → New board</b> creates a board: a Markdown file with its own columns. The <b>Status board</b> shows every task by status.</p>
<ul><li>Drag cards between columns, or focus one and press <kbd>Alt+←/→</kbd> (<kbd>Alt+↑/↓</kbd> to reorder).</li>
<li>Click a title to edit it; the checkbox completes the card.</li>
<li>Column titles: click or <kbd>F2</kbd> to rename; <kbd>Alt+Shift+←/→</kbd> moves a column.</li>
<li>The star on a board's card pins it to Home.</li></ul>`,
  },
  {
    id: 'calendar',
    group: 'Tasks',
    title: 'List and calendar',
    keywords: 'calendar list today upcoming overdue calendario elenco',
    html: `<p><b>Tasks → List</b> shows tasks with filters; <b>Calendar</b> shows them by due date and marks days with daily notes. Double-click a day (or press <kbd>N</kbd> on it) to add a task there; drag a task to another day to change its due date.</p>`,
  },
  {
    id: 'task-views',
    group: 'Tasks',
    title: 'Task lists inside pages',
    keywords: 'tasks block embedded board kanban in page query',
    html: `${code('```tasks\nproject: Launch\nstatus: open\nview: board      # or list, table\n```')}
<p>The block shows a live list or board in the page. Options: <code>status</code>, <code>project</code>, <code>tag</code>, <code>assignee</code>, <code>priority</code>, <code>list</code> (today, upcoming, overdue, inbox, completed), <code>page: this</code>, <code>search</code>, <code>limit</code>.</p>`,
  },
  // API and Insights
  {
    id: 'api',
    group: 'API and Insights',
    title: 'API client',
    keywords: 'api http request rest postman collection environment client richieste',
    html: `<p><b>API</b> (<kbd>Alt+4</kbd>) sends HTTP requests. Requests, collections and environments are files in your workspace; secret values stay in VS Code's secret storage. <kbd>Ctrl/Cmd+Enter</kbd> sends, <kbd>Ctrl/Cmd+S</kbd> saves.</p>
<p>A <code>\`\`\`http</code> block in a page can be sent from the page with <b>Send</b>.</p>`,
  },
  {
    id: 'insights',
    group: 'API and Insights',
    title: 'Insights and the link graph',
    keywords: 'insights health broken links orphan graph statistics statistiche grafo',
    html: `<p><b>Insights</b> (<kbd>Alt+5</kbd>) has an <b>Overview</b> of pages and tasks, <b>Content health</b> (broken links, pages nothing links to, stale pages) and the <b>Link graph</b>. Home's <b>Needs attention</b> card shows the most urgent issues.</p>`,
  },
  // Publishing
  {
    id: 'pdf',
    group: 'Publishing',
    title: 'Export to PDF',
    keywords: 'pdf export print stampa esporta',
    html: `<p>Export a page, its section or the whole wiki as a PDF with a cover and a table of contents:</p>
<ul><li>the download icon above a page in the Wiki;</li>
<li><b>Export as PDF…</b> in the menu of a page or folder in the Wiki tree;</li>
<li>the <b>…</b> menu of an open Markdown page, or right-click a <code>.md</code> file in the Explorer;</li>
<li>the Command Palette → <b>NoteSpace: Export PDF (Page, Section or Wiki)</b>.</li></ul>
<p>It prints with an installed Chrome, Edge, Chromium or Brave (or <code>notespace.export.browserPath</code>). Without one, it saves an HTML page ready to print.</p>`,
  },
  {
    id: 'site',
    group: 'Publishing',
    title: 'Export a website or EPUB',
    keywords: 'static site html export build epub publish sito announcement',
    html: `<p>The wiki's <b>…</b> menu → <b>Export</b> builds a static website (search, navigation, tag index, Open Graph previews) or an EPUB book. Settings in <code>wiki.yaml</code>:</p>
${code('wiki:\n  announcement: "Version 2 is out — **read more**"\nbuild:\n  url: https://docs.example.com/')}
<p>Drafts (<code>draft: true</code>) are left out.</p>`,
  },
];

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = new Map<string, string>();
const textOf = (topic: Topic) => {
  let text = searchText.get(topic.id);
  if (text === undefined) {
    const div = document.createElement('div');
    div.innerHTML = topic.html;
    text = fold(`${topic.title} ${topic.group} ${topic.keywords} ${div.textContent || ''}`);
    searchText.set(topic.id, text);
  }
  return text;
};
/** Topics matching every word of the query, title matches first. */
function matching(query: string): Topic[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return topics;
  return topics
    .filter((t) => words.every((w) => textOf(t).includes(w)))
    .sort(
      (a, b) =>
        Number(words.some((w) => fold(b.title).includes(w))) -
        Number(words.some((w) => fold(a.title).includes(w))),
    );
}

let lastTopic = topics[0].id;

/** Opens the guide; Escape or the close button closes it. */
export function openHelp(query = '') {
  if (document.querySelector('.help-back')) return;
  const previous = document.activeElement as HTMLElement | null;
  const search = h('input', {
    type: 'search',
    class: 'help-search',
    placeholder: 'Search the guide',
    'aria-label': 'Search the guide',
    value: query,
  }) as HTMLInputElement;
  const list = h('nav', { class: 'help-list', 'aria-label': 'Topics' });
  const content = h('article', { class: 'doc help-content', tabindex: '-1' });
  const count = h('span', { class: 'help-count muted small', 'aria-live': 'polite' });
  const close = h(
    'button',
    { type: 'button', class: 'btn ghost icon-only', 'aria-label': 'Close the guide' },
    svg('close', 16),
  );
  const box = h(
    'div',
    { class: 'help', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'NoteSpace guide' },
    h(
      'header',
      { class: 'help-head' },
      h('h2', {}, svg('help', 18), 'Guide'),
      h('div', { class: 'help-search-wrap' }, svg('search', 14), search),
      count,
      close,
    ),
    h('div', { class: 'help-body' }, list, content),
  );
  const back = h('div', { class: 'modal-back help-back' }, box);

  const show = (topic: Topic | undefined, words: string[]) => {
    content.replaceChildren();
    if (!topic) {
      content.append(
        h('p', {
          class: 'muted',
          text: 'No topic matches. Try another word, such as board, pdf or link.',
        }),
      );
      return;
    }
    lastTopic = topic.id;
    content.append(
      h('p', { class: 'help-group', text: topic.group }),
      h('h1', { text: topic.title }),
    );
    const body = h('div');
    body.innerHTML = topic.html;
    if (words.length) markWords(body, words);
    content.append(body);
    content.scrollTop = 0;
    for (const b of Array.from(list.querySelectorAll<HTMLElement>('.help-topic')))
      b.setAttribute('aria-current', String(b.dataset.id === topic.id));
  };
  const refresh = () => {
    const found = matching(search.value);
    const words = fold(search.value).split(/\s+/).filter(Boolean);
    list.replaceChildren();
    let group = '';
    for (const topic of found) {
      if (!search.value.trim() && topic.group !== group) {
        group = topic.group;
        list.append(h('p', { class: 'help-list-group', text: group }));
      }
      const b = h('button', {
        type: 'button',
        class: 'help-topic',
        'data-id': topic.id,
        text: topic.title,
      });
      b.addEventListener('click', () => show(topic, words));
      list.append(b);
    }
    count.textContent = search.value.trim()
      ? `${found.length} topic${found.length === 1 ? '' : 's'}`
      : '';
    show(search.value.trim() ? found[0] : found.find((t) => t.id === lastTopic) || found[0], words);
  };
  const dismiss = () => {
    back.remove();
    previous?.focus?.();
  };
  search.addEventListener('input', refresh);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.querySelector<HTMLElement>('.help-topic')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      list.querySelector<HTMLElement>('.help-topic')?.click();
    }
  });
  list.addEventListener('keydown', (e) => {
    const buttons = Array.from(list.querySelectorAll<HTMLElement>('.help-topic'));
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next =
      e.key === 'ArrowDown' ? buttons[at + 1] : e.key === 'ArrowUp' ? buttons[at - 1] : undefined;
    if (next) {
      e.preventDefault();
      next.focus();
      next.click();
    } else if (e.key === 'ArrowUp' && at === 0) {
      e.preventDefault();
      search.focus();
    }
  });
  back.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  });
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) dismiss();
  });
  close.addEventListener('click', dismiss);
  document.body.append(back);
  refresh();
  search.focus();
}

/** Highlights the searched words in the topic's text (not inside code blocks' markup). */
function markWords(root: HTMLElement, words: string[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    const folded = fold(text);
    // NFD folding keeps one character per letter for Latin text, so offsets line up.
    if (folded.length !== text.length) continue;
    const ranges: Array<[number, number]> = [];
    for (const w of words) {
      let i = folded.indexOf(w);
      while (i >= 0) {
        ranges.push([i, i + w.length]);
        i = folded.indexOf(w, i + w.length);
      }
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    const parts: Node[] = [];
    let at = 0;
    for (const [start, end] of ranges) {
      if (start < at) continue;
      parts.push(document.createTextNode(text.slice(at, start)));
      parts.push(h('mark', { text: text.slice(start, end) }));
      at = end;
    }
    parts.push(document.createTextNode(text.slice(at)));
    node.replaceWith(...parts);
  }
}

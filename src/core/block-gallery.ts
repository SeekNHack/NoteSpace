/**
 * Block Gallery catalog. `sample` is Markdown in the wiki's own syntax: the live preview renders
 * it with the reader's renderer and inserting it adds exactly what the preview shows. Entries
 * that need a file (`pick`) run the matching `/` menu command, which asks for it.
 */
export interface GalleryEntry {
  id: string;
  /** Studio command id run on insert. */
  command: string;
  label: string;
  category: string;
  description: string;
  sample: string;
  keywords?: string;
  /** Inserted through the command's file picker instead of the sample. */
  pick?: boolean;
}

export const galleryCategories = [
  'Callouts',
  'Disclosure',
  'Layout & navigation',
  'Steps & time',
  'Content',
  'Diagrams & data',
  'API',
] as const;

const callout = (kind: string, label: string, title: string, text: string): GalleryEntry => ({
  id: `callout-${kind}`,
  command: `callout-${kind}`,
  label,
  category: 'Callouts',
  description: `${label} admonition with a title; its color can be changed from the header.`,
  sample: `:::${kind} "${title}"\n${text}\n:::`,
  keywords: `callout admonition ${kind}`,
});

export const galleryEntries: GalleryEntry[] = [
  callout('note', 'Note', 'Note', 'Background a reader may need.'),
  callout('tip', 'Tip', 'Tip', 'A shortcut that saves time.'),
  callout('info', 'Info', 'Good to know', 'Extra context for this step.'),
  callout('warning', 'Warning', 'Before you continue', 'This step restarts the service.'),
  callout('danger', 'Danger', 'Data loss', 'Deleting a project cannot be undone.'),
  callout('success', 'Success', 'Done', 'The agent is installed.'),
  callout('example', 'Example', 'Example', 'A worked example.'),
  callout('quote', 'Quote', 'Quote', 'Simple things should be simple.'),
  {
    id: 'details',
    command: 'layout-details',
    label: 'Details',
    category: 'Disclosure',
    description: 'Collapsible section that starts open or collapsed.',
    sample: ':::details "Advanced options" collapsed\nHidden until the reader opens it.\n:::',
    keywords: 'collapsible disclosure expand toggle',
  },
  {
    id: 'spoiler',
    command: 'layout-spoiler',
    label: 'Spoiler',
    category: 'Disclosure',
    description: 'Content revealed on demand.',
    sample: ':::spoiler "Answer"\nIt is 42.\n:::',
    keywords: 'reveal hide answer',
  },
  {
    id: 'faq',
    command: 'layout-accordion',
    label: 'FAQ',
    category: 'Disclosure',
    description: 'Questions and answers as an accordion; add one Details block per question.',
    sample:
      ':::accordion "FAQ"\n:::details "Does it work offline?"\nYes, everything stays in your files.\n:::\n:::details "Can I export it?"\nAs a static site, PDF or EPUB.\n:::\n:::',
    keywords: 'faq questions answers accordion',
  },
  {
    id: 'hero',
    command: 'layout-hero',
    label: 'Hero',
    category: 'Layout & navigation',
    description: 'Landing-page header; links in its body become buttons.',
    sample:
      ':::hero "Agent documentation"\nInstall, configure and operate the agent.\n\n[Get started](#) [API reference](#)\n:::',
    keywords: 'landing banner header',
  },
  {
    id: 'nav-card',
    command: 'layout-nav-card',
    label: 'Navigation card',
    category: 'Layout & navigation',
    description: 'A fully clickable card that links to a page.',
    sample: ':::nav-card "Installation"\n[Set up the agent in five minutes](#)\n:::',
    keywords: 'card link navigation',
  },
  {
    id: 'grid',
    command: 'layout-grid',
    label: 'Card grid',
    category: 'Layout & navigation',
    description: 'Cards side by side, wrapping on narrow screens.',
    sample:
      ':::grid\n:::card "Guides"\nStep-by-step tasks.\n:::\n:::card "Reference"\nEvery option.\n:::\n:::',
    keywords: 'cards columns grid layout',
  },
  {
    id: 'tabs',
    command: 'layout-tabs',
    label: 'Tabs',
    category: 'Layout & navigation',
    description: 'Alternatives such as operating systems or languages; keyboard accessible.',
    sample:
      ':::tabs\n:::tab "macOS"\n`brew install agent`\n:::\n:::tab "Linux"\n`apt install agent`\n:::\n:::',
    keywords: 'tabs alternatives platforms',
  },
  {
    id: 'steps',
    command: 'layout-stepper',
    label: 'Steps',
    category: 'Steps & time',
    description: 'A numbered procedure.',
    sample:
      ':::stepper\n:::step "Install"\nRun the installer.\n:::\n:::step "Configure"\nEdit agent.yaml.\n:::\n:::',
    keywords: 'stepper procedure how to numbered',
  },
  {
    id: 'timeline',
    command: 'layout-timeline',
    label: 'Timeline',
    category: 'Steps & time',
    description: 'Dated events such as releases or incidents.',
    sample:
      ':::timeline\n:::event "2026-01"\nFirst release.\n:::\n:::event "2026-06"\nVersion 2.\n:::\n:::',
    keywords: 'history releases changelog events',
  },
  {
    id: 'code',
    command: 'code',
    label: 'Code block',
    category: 'Content',
    description: 'Syntax-highlighted code with copy, title and line options.',
    sample: '```python\nimport agent\nagent.start(port=8080)\n```',
    keywords: 'code snippet source',
  },
  {
    id: 'table',
    command: 'table',
    label: 'Table',
    category: 'Content',
    description: 'Editable table with header row.',
    sample: '| Option | Default |\n| --- | --- |\n| `port` | 8080 |\n| `debug` | false |',
    keywords: 'table grid rows columns',
  },
  {
    id: 'image',
    pick: true,
    command: 'image',
    label: 'Image',
    category: 'Content',
    description: 'Insert or paste an image; it is stored in the wiki’s assets.',
    sample: '![Architecture diagram](#)',
    keywords: 'picture screenshot photo',
  },
  {
    id: 'math',
    command: 'block-math',
    label: 'Math',
    category: 'Content',
    description: 'LaTeX formula block.',
    sample: '$$\nE = mc^2\n$$',
    keywords: 'latex formula equation',
  },
  {
    id: 'mermaid',
    command: 'mermaid',
    label: 'Mermaid diagram',
    category: 'Diagrams & data',
    description: 'Flowcharts and sequence diagrams from text.',
    sample: '```mermaid\nflowchart LR\n  A[Request] --> B[Agent] --> C[Store]\n```',
    keywords: 'diagram flowchart sequence',
  },
  {
    id: 'chart',
    command: 'chart',
    label: 'Data chart',
    category: 'Diagrams & data',
    description: 'Bar, line, area, scatter or pie chart from CSV or JSON.',
    sample:
      '```chart\ntype: bar\ntitle: Weekly visits\nx: week\ny: visits\n---\nweek,visits\nW1,120\nW2,180\nW3,150\n```',
    keywords: 'chart graph plot data csv',
  },
  {
    id: 'dashboard',
    pick: true,
    command: 'dashboard-embed',
    label: 'Dashboard embed',
    category: 'Diagrams & data',
    description: 'A live dashboard or one of its widgets; you pick the file.',
    sample: '',
    keywords: 'dashboard kpi metric widget excel',
  },
  {
    id: 'kanban',
    pick: true,
    command: 'kanban',
    label: 'Task board',
    category: 'Diagrams & data',
    description: 'Planner tasks of this page as a board.',
    sample: '',
    keywords: 'kanban board tasks planner',
  },
  {
    id: 'http',
    command: 'http-request',
    label: 'HTTP request',
    category: 'API',
    description: 'An endpoint readers can send from the page (only when they press Send).',
    sample:
      '```http\n# @name Create user\nPOST {{baseUrl}}/api/users\nContent-Type: application/json\n\n{ "name": "Mario" }\n```',
    keywords: 'http api request rest endpoint curl send',
  },
  {
    id: 'api',
    pick: true,
    command: 'openapi-embed',
    label: 'API endpoint reference',
    category: 'API',
    description: 'Endpoints, models and samples from an OpenAPI 3 file; you pick the file.',
    sample: '',
    keywords: 'openapi swagger endpoint rest',
  },
];

/** Entries matching every word of `query` (label, category, description, keywords). */
export function searchGallery(query: string, entries = galleryEntries): GalleryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    const hay = `${e.label} ${e.category} ${e.description} ${e.keywords || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

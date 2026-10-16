export const templates = [
  { label: 'Blank page', description: 'A title and room to think', body: '# {{title}}\n\n' },
  {
    label: 'Project',
    description: 'Overview, decisions and next steps',
    body: '# {{title}}\n\n## Overview\n\n## Goals\n\n- [ ] Define success\n\n## Decisions\n\n## Next steps\n\n- [ ] First step\n\n## Related pages\n\n',
  },
  {
    label: 'Meeting',
    description: 'Agenda, notes and action items',
    body: '# {{title}}\n\nDate: {{date}}\n\n## Attendees\n\n## Agenda\n\n## Notes\n\n## Action items\n\n- [ ] Follow up\n',
  },
  {
    label: 'Daily note',
    description: 'A daily log',
    body: '# {{title}}\n\n## Focus\n\n- [ ] \n\n## Notes\n\n## Reflection\n\n',
  },
];
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function fillTemplate(body: string, title: string, date = localDate()): string {
  return body.replace(/{{(title|date)}}/g, (_, key: string) => (key === 'title' ? title : date));
}

export function homepageTemplate(title: string, description: string, withGuide: boolean): string {
  const heading = JSON.stringify(`Welcome to ${title}`);
  const intro = description.trim() || 'Your documentation starts here.';
  return `:::hero ${heading}\n${intro}\n${withGuide ? '\n[Get started](guides/getting-started.md)\n' : ''}:::\n\n## About this wiki\n\nEdit this page to introduce your project. Add pages from the NoteSpace sidebar, then link them here.\n`;
}

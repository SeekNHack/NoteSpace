import { isMap, parseDocument, stringify } from 'yaml';
import { idPattern } from './tasks';
import {
  BoardColor,
  boardColors,
  BoardColumn,
  BoardConfig,
  boardTemplates,
  checkBoard,
} from './board-model';
export * from './board-model';

const FM = /^(﻿)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Board settings from a page's text, or undefined when the page is not a board. */
export function parseBoard(pageText: string): BoardConfig | undefined {
  const fm = FM.exec(pageText);
  if (!fm) return undefined;
  let data: unknown;
  try {
    const doc = parseDocument(fm[2], { uniqueKeys: false });
    if (doc.errors.length) return undefined;
    data = doc.toJS({ maxAliasCount: 0 });
  } catch {
    return undefined;
  }
  // `wiki_studio:` is the key written under the project's earlier name; it is migrated on save.
  const ws = obj(obj(data).notespace ?? obj(data).wiki_studio);
  if (ws.type !== 'board') return undefined;
  const id = typeof ws.id === 'string' && idPattern.test(ws.id) ? ws.id : undefined;
  if (!id) return undefined;
  const seen = new Set<string>();
  const columns: BoardColumn[] = [];
  for (const raw of Array.isArray(ws.columns) ? ws.columns : []) {
    const c = obj(raw);
    const cid = typeof c.id === 'string' && idPattern.test(c.id) ? c.id : undefined;
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    columns.push({
      id: cid,
      title: text(c.title, 80) || cid,
      ...(boardColors.includes(c.color as BoardColor) ? { color: c.color as BoardColor } : {}),
      ...(text(c.icon, 40) ? { icon: text(c.icon, 40) } : {}),
      ...(c.completed === true ? { completed: true } : {}),
    });
  }
  if (!columns.length) columns.push(...boardTemplates[0].columns.map((c) => ({ ...c })));
  const requested = typeof ws.default_column === 'string' ? ws.default_column : '';
  const defaultColumn = columns.some((c) => c.id === requested)
    ? requested
    : (columns.find((c) => !c.completed) || columns[0]).id;
  return {
    id,
    name: text(ws.name, 120) || id,
    ...(text(ws.description, 500) ? { description: text(ws.description, 500) } : {}),
    ...(text(ws.icon, 40) ? { icon: text(ws.icon, 40) } : {}),
    ...(boardColors.includes(ws.color as BoardColor) ? { color: ws.color as BoardColor } : {}),
    columns,
    defaultColumn,
    ...(ws.density === 'compact' || ws.density === 'comfortable' ? { density: ws.density } : {}),
    ...(['manual', 'due', 'priority'].includes(ws.sort as string)
      ? { sort: ws.sort as BoardConfig['sort'] }
      : {}),
    ...(ws.archived === true ? { archived: true } : {}),
  };
}

const toYaml = (config: BoardConfig): Record<string, unknown> => ({
  type: 'board',
  id: config.id,
  name: config.name,
  ...(config.description ? { description: config.description } : {}),
  ...(config.icon ? { icon: config.icon } : {}),
  ...(config.color ? { color: config.color } : {}),
  default_column: config.defaultColumn,
  ...(config.density ? { density: config.density } : {}),
  ...(config.sort ? { sort: config.sort } : {}),
  ...(config.archived ? { archived: true } : {}),
  columns: config.columns.map((c) => ({
    id: c.id,
    title: c.title,
    ...(c.color ? { color: c.color } : {}),
    ...(c.icon ? { icon: c.icon } : {}),
    ...(c.completed ? { completed: true } : {}),
  })),
});

/**
 * Returns `pageText` with the board settings replaced. Only the `notespace` key of the front
 * matter changes; other keys, comments and the body are kept as written.
 */
export function writeBoardConfig(pageText: string, config: BoardConfig): string {
  checkBoard(config);
  const fm = FM.exec(pageText);
  const eol = pageText.includes('\r\n') ? '\r\n' : '\n';
  const block = stringify({ notespace: toYaml(config) }, { lineWidth: 0 })
    .trimEnd()
    .split('\n');
  if (!fm) return `---${eol}${block.join(eol)}${eol}---${eol}${pageText}`;
  const doc = parseDocument(fm[2]);
  if (doc.errors.length)
    throw new Error(`The front matter cannot be read: ${doc.errors[0].message}`);
  if (!isMap(doc.contents)) throw new Error('The front matter is not a mapping.');
  // Replace the `notespace:` (or legacy `wiki_studio:`) block textually so every other line stays byte-identical.
  const lines = fm[2].split(/\r?\n/);
  const at = lines.findIndex((l) => /^(?:notespace|wiki_studio)\s*:/.test(l));
  if (at < 0) lines.push(...block);
  else {
    let end = at + 1;
    while (end < lines.length && (/^\s/.test(lines[end]) || lines[end] === '')) end++;
    // Blank lines that separate the block from the next key stay.
    while (end > at + 1 && lines[end - 1] === '') end--;
    lines.splice(at, end - at, ...block);
  }
  return `${fm[1] || ''}---${eol}${lines.join(eol)}${eol}---${eol}${pageText.slice(fm[0].length)}`;
}

export function newBoardText(config: BoardConfig): string {
  checkBoard(config);
  return writeBoardConfig(
    `# ${config.name}\n\n${config.description ? `${config.description}\n\n` : ''}`,
    config,
  );
}

import { unzip } from './unzip';

/**
 * Read-only `.xlsx` reader. It reads cell values only: macros (`.xlsm` parts, VBA) are never
 * loaded or executed, and Excel formulas are never evaluated. A formula cell exposes the
 * result Excel cached when the file was last saved (`cached: true`), or no value at all
 * (`cached: false`) when the producing tool did not store one.
 */
export type CellValue = string | number | boolean | Date | null;
export interface Cell {
  value: CellValue;
  /** Present for formula cells: the formula text as stored by Excel. */
  formula?: string;
  /** For formula cells: whether `value` is a result cached by Excel. */
  cached?: boolean;
  /** Excel error such as #DIV/0!. */
  error?: string;
}
export interface Sheet {
  name: string;
  /** Dense rows from A1 to the last used cell. */
  rows: (Cell | undefined)[][];
}
export interface Workbook {
  sheets: Sheet[];
  /** Excel tables (ListObjects): name, sheet and A1 range. */
  tables: Array<{ name: string; sheet: string; ref: string }>;
  /** Workbook-level defined names: name → `Sheet!$A$1:$C$9`. */
  names: Record<string, string>;
  date1904: boolean;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const xmlText = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
        )
      : (entities[e] ?? all),
  );
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlText(m[1]) : undefined;
};
/** Concatenated text of all <t> elements (rich text runs and phonetic hints excluded). */
const texts = (xml: string) =>
  [
    ...xml
      .replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
      .matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g),
  ]
    .map((m) => xmlText(m[1] || ''))
    .join('');

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function parseRef(ref: string): { col: number; row: number } {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim());
  if (!m) throw new Error(`Invalid cell reference ${ref}.`);
  return { col: columnIndex(m[1]), row: Number(m[2]) - 1 };
}

const builtInDates = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const isDateFormat = (code: string) => {
  const cleaned = code.replace(/\[[^\]]*\]|"[^"]*"|\\./g, '');
  return /[dmyhs]/i.test(cleaned) && !/^[#0.,%E+-]*$/i.test(cleaned);
};
/** Excel serial date → JavaScript Date (UTC). */
export function excelDate(serial: number, date1904 = false): Date {
  const days = date1904 ? serial + 1462 : serial;
  // Excel's 1900 system counts a non-existent 1900-02-29.
  const adjusted = !date1904 && days < 60 ? days + 1 : days;
  return new Date(Math.round((adjusted - 25569) * 86400000));
}

const resolveTarget = (base: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
};
function relationships(zip: ReturnType<typeof unzip>, part: string): Map<string, string> {
  const dir = part.split('/').slice(0, -1).join('/');
  const file = `${dir ? `${dir}/` : ''}_rels/${part.split('/').pop()}.rels`;
  const xml = zip.text(file) || '';
  const map = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'),
      target = attr(m[0], 'Target'),
      mode = attr(m[0], 'TargetMode');
    if (id && target && mode !== 'External') map.set(id, resolveTarget(part, target));
  }
  return map;
}

export function readXlsx(bytes: Uint8Array, limits = { maxCells: 5_000_000 }): Workbook {
  const zip = unzip(bytes);
  const workbookXml = zip.text('xl/workbook.xml');
  if (!workbookXml) throw new Error('This is not an Excel workbook (xl/workbook.xml is missing).');
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbookXml);
  const rels = relationships(zip, 'xl/workbook.xml');
  const shared = [
    ...(zip.text('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g),
  ].map((m) => texts(m[1] || ''));
  // Styles: which cell formats are dates.
  const stylesXml = zip.text('xl/styles.xml') || '';
  const customFormats = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g))
    customFormats.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') || '');
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
  const dateStyles = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') || 0);
    return builtInDates.has(id) || (customFormats.has(id) && isDateFormat(customFormats.get(id)!));
  });
  const names: Record<string, string> = {};
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g))
    if (!/\bhidden="1"/.test(m[1])) names[attr(`<x ${m[1]}>`, 'name') || ''] = xmlText(m[2]);
  delete names[''];
  const sheets: Sheet[] = [];
  const tables: Workbook['tables'] = [];
  let cells = 0;
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') || `Sheet${sheets.length + 1}`;
    const target = rels.get(attr(m[0], 'r:id') || '');
    if (!target) continue;
    const xml = zip.text(target);
    if (!xml) continue;
    const rows: (Cell | undefined)[][] = [];
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const body = row[2] || '';
      for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (++cells > limits.maxCells)
          throw new Error(`The workbook has more than ${limits.maxCells.toLocaleString()} cells.`);
        const tag = `<c ${c[1]}>`;
        const inner = c[2] || '';
        const ref = attr(tag, 'r');
        if (!ref) continue;
        const { col, row: r } = parseRef(ref);
        const type = attr(tag, 't') || 'n';
        const style = Number(attr(tag, 's') || 0);
        const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
        const hasFormula = formula !== undefined || /<f\b[^>]*\/>/.test(inner);
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const cell: Cell = { value: null };
        if (type === 'inlineStr') cell.value = texts(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] || '');
        else if (raw !== undefined) {
          const v = xmlText(raw);
          if (type === 's') cell.value = shared[Number(v)] ?? '';
          else if (type === 'str') cell.value = v;
          else if (type === 'b') cell.value = v === '1';
          else if (type === 'e') cell.error = v;
          else if (type === 'd') cell.value = new Date(v);
          else {
            const n = Number(v);
            cell.value = Number.isFinite(n) ? (dateStyles[style] ? excelDate(n, date1904) : n) : v;
          }
        }
        if (hasFormula) {
          cell.formula = xmlText(formula || '');
          cell.cached = raw !== undefined || type === 'inlineStr';
        }
        (rows[r] ||= [])[col] = cell;
      }
    }
    // Make rows dense so row indexes match spreadsheet rows.
    for (let i = 0; i < rows.length; i++) rows[i] ||= [];
    sheets.push({ name, rows });
    for (const [id, tablePart] of relationships(zip, target)) {
      void id;
      if (!/\/tables\/[^/]+\.xml$/.test(tablePart)) continue;
      const tableXml = zip.text(tablePart) || '';
      const tableTag = /<table\b[^>]*>/.exec(tableXml)?.[0] || '';
      const tableName = attr(tableTag, 'displayName') || attr(tableTag, 'name');
      const tableRef = attr(tableTag, 'ref');
      if (tableName && tableRef) tables.push({ name: tableName, sheet: name, ref: tableRef });
    }
  }
  if (!sheets.length) throw new Error('The workbook has no readable sheets.');
  return { sheets, tables, names, date1904 };
}

/** Cells of an A1 range (`A1:D20`) on a sheet. */
export function sheetRange(sheet: Sheet, ref: string): (Cell | undefined)[][] {
  const [a, b] = ref.replace(/^.*!/, '').split(':');
  const start = parseRef(a),
    end = parseRef(b || a);
  const out: (Cell | undefined)[][] = [];
  for (let r = start.row; r <= end.row; r++)
    out.push(
      (sheet.rows[r] || [])
        .slice(start.col, end.col + 1)
        .concat(
          Array(
            Math.max(
              0,
              end.col - start.col + 1 - (sheet.rows[r] || []).slice(start.col, end.col + 1).length,
            ),
          ).fill(undefined),
        ),
    );
  return out;
}

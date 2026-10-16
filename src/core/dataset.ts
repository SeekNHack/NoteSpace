import { CellValue, readXlsx, sheetRange, Workbook } from './xlsx';
import { ColumnAccess, compileRow, FormulaError, parseFormula, Value } from './formula';

/**
 * Columnar, typed table loaded from a local file. Values are numbers, strings, booleans or
 * null; dates are UTC epoch milliseconds in columns typed `date`.
 */
export type ColumnType = 'number' | 'string' | 'date' | 'boolean';
export interface Column {
  name: string;
  type: ColumnType;
  values: Value[];
  /** Spreadsheet provenance for this column. */
  formulas?: { cached: number; uncached: number };
}
export interface Dataset {
  columns: Column[];
  rowCount: number;
  warnings: string[];
}
export type SourceType = 'csv' | 'tsv' | 'json' | 'jsonl' | 'xlsx';
export interface SourceOptions {
  /** 1-based header row (spreadsheets and delimited files). 0 = no header row. */
  headerRow?: number;
  sheet?: string;
  /** Excel table name or defined name or A1 range like `A1:F500`. */
  range?: string;
  /** Text treated as missing. */
  missing?: string[];
  /** How to read slash dates: `dmy` (31/12/2026) or `mdy` (12/31/2026). */
  dateOrder?: 'dmy' | 'mdy';
  /** Decimal separator in text numbers. */
  decimal?: '.' | ',';
  /** Overrides detected column types. */
  types?: Record<string, ColumnType>;
  maxRows?: number;
}

const DEFAULT_MISSING = ['', 'na', 'n/a', 'null', 'none', '-', '—', '#n/a'];

export function parseDelimited(text: string, delimiter: string, maxRows = 1_000_000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      if (rows.length > maxRows)
        throw new Error(`The file has more than ${maxRows.toLocaleString()} rows.`);
    } else field += c;
  }
  if (quoted)
    throw new Error('A quoted field is not closed (the file may still be being written).');
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return rows;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;
function parseDate(text: string, order: 'dmy' | 'mdy'): number | null {
  const iso = ISO.exec(text);
  if (iso) {
    const t = Date.parse(
      iso[4] && !iso[7] ? `${text.replace(' ', 'T')}Z` : iso[4] ? text : `${text}T00:00:00Z`,
    );
    return Number.isFinite(t) ? t : null;
  }
  const slash = SLASH.exec(text);
  if (slash) {
    const [a, b] = [Number(slash[1]), Number(slash[2])];
    const [d, m] = order === 'dmy' ? [a, b] : [b, a];
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const t = Date.UTC(Number(slash[3]), m - 1, d);
    return new Date(t).getUTCDate() === d ? t : null;
  }
  return null;
}
function parseNumber(text: string, decimal: '.' | ','): number | null {
  const t = text.trim().replace(/\s/g, '');
  const normalized =
    decimal === ','
      ? t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
      : t.replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/i.test(normalized)) return null;
  const n = Number(normalized.replace('%', ''));
  return Number.isFinite(n) ? (normalized.endsWith('%') ? n / 100 : n) : null;
}

/** Builds typed columns from raw cells (strings from text files, typed values from Excel). */
export function buildDataset(
  header: string[],
  rows: CellValue[][],
  options: SourceOptions = {},
  provenance?: Array<{ cached: number; uncached: number }>,
): Dataset {
  const missing = new Set((options.missing || DEFAULT_MISSING).map((m) => m.toLowerCase()));
  const order = options.dateOrder || 'dmy',
    decimal = options.decimal || '.';
  const warnings: string[] = [];
  const names: string[] = [];
  header.forEach((raw, i) => {
    let name = String(raw ?? '').trim() || `Column ${i + 1}`;
    for (let n = 2; names.includes(name); n++)
      name = `${String(raw ?? '').trim() || `Column ${i + 1}`} (${n})`;
    if (name !== String(raw ?? '').trim())
      warnings.push(`Column ${i + 1} was renamed to “${name}”.`);
    names.push(name);
  });
  const columns: Column[] = names.map((name, c) => {
    const raw = rows.map((r) => {
      const v = r[c];
      if (v === undefined || v === null) return null;
      if (typeof v === 'string' && missing.has(v.trim().toLowerCase())) return null;
      return v;
    });
    const present = raw.filter((v) => v !== null);
    const forced = options.types?.[name];
    const detect = (): ColumnType => {
      if (!present.length) return 'string';
      if (
        present.every(
          (v) =>
            v instanceof Date || (typeof v === 'string' && parseDate(v.trim(), order) !== null),
        )
      )
        return 'date';
      if (
        present.every(
          (v) =>
            typeof v === 'number' || (typeof v === 'string' && parseNumber(v, decimal) !== null),
        )
      )
        return 'number';
      if (
        present.every(
          (v) =>
            typeof v === 'boolean' ||
            (typeof v === 'string' && /^(true|false|yes|no)$/i.test(v.trim())),
        )
      )
        return 'boolean';
      return 'string';
    };
    const type = forced || detect();
    let invalid = 0;
    const values = raw.map((v): Value => {
      if (v === null) return null;
      if (type === 'date') {
        const t =
          v instanceof Date
            ? v.getTime()
            : typeof v === 'number'
              ? v
              : parseDate(String(v).trim(), order);
        if (t === null || !Number.isFinite(t)) invalid++;
        return t !== null && Number.isFinite(t) ? t : null;
      }
      if (type === 'number') {
        const n =
          typeof v === 'number'
            ? v
            : typeof v === 'boolean'
              ? Number(v)
              : parseNumber(String(v), decimal);
        if (n === null) invalid++;
        return n;
      }
      if (type === 'boolean')
        return typeof v === 'boolean' ? v : /^(true|yes)$/i.test(String(v).trim());
      return v instanceof Date ? v.toISOString() : String(v);
    });
    if (invalid)
      warnings.push(
        `${invalid} value(s) in “${name}” are not valid ${type === 'date' ? 'dates' : 'numbers'} and are treated as empty.`,
      );
    return {
      name,
      type,
      values,
      ...(provenance?.[c] && (provenance[c].cached || provenance[c].uncached)
        ? { formulas: provenance[c] }
        : {}),
    };
  });
  for (const col of columns)
    if (col.formulas?.uncached)
      warnings.push(
        `“${col.name}” has ${col.formulas.uncached} Excel formula cell(s) without a saved result; they are empty here. Open and save the workbook in Excel to store results — NoteSpace does not recalculate Excel formulas.`,
      );
  return { columns, rowCount: rows.length, warnings };
}

export function loadDataset(
  type: SourceType,
  bytes: Uint8Array,
  options: SourceOptions = {},
): Dataset {
  const maxRows = options.maxRows ?? 500_000;
  if (type === 'xlsx') return datasetFromWorkbook(readXlsx(bytes), options, maxRows);
  const text = new TextDecoder('utf-8').decode(bytes);
  if (type === 'json' || type === 'jsonl') {
    let records: unknown[];
    try {
      if (type === 'jsonl')
        records = text
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l, i) => {
            try {
              return JSON.parse(l);
            } catch {
              throw new Error(`Line ${i + 1} is not valid JSON.`);
            }
          });
      else {
        const parsed = JSON.parse(text);
        records = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.data)
            ? parsed.data
            : Array.isArray(parsed?.rows)
              ? parsed.rows
              : [];
      }
    } catch (e) {
      throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (records.length > maxRows)
      throw new Error(`The file has more than ${maxRows.toLocaleString()} rows.`);
    const objects = records.filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
    );
    const header = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    const rows = objects.map((o) =>
      header.map((h) => {
        const v = o[h];
        return v === undefined
          ? null
          : typeof v === 'object' && v !== null
            ? JSON.stringify(v)
            : (v as CellValue);
      }),
    );
    const dataset = buildDataset(header, rows, options);
    if (objects.length < records.length)
      dataset.warnings.push(
        `${records.length - objects.length} record(s) are not objects and were skipped.`,
      );
    return dataset;
  }
  const rows = parseDelimited(text, type === 'tsv' ? '\t' : guessDelimiter(text), maxRows);
  const headerRow = options.headerRow ?? 1;
  const header = headerRow
    ? rows[headerRow - 1] || []
    : (rows[0] || []).map((_, i) => `Column ${i + 1}`);
  const body = rows.slice(headerRow || 0);
  const width = Math.max(header.length, ...body.map((r) => r.length));
  while (header.length < width) header.push('');
  return buildDataset(header, body, options);
}

/** `,` unless the first line clearly uses `;` (common with comma decimals). */
const guessDelimiter = (text: string) => {
  const first = text.slice(0, text.indexOf('\n') >>> 0 || 2000);
  return (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
};

export function datasetFromWorkbook(
  book: Workbook,
  options: SourceOptions,
  maxRows: number,
): Dataset {
  let sheetName = options.sheet;
  let range = options.range;
  const table = range && book.tables.find((t) => t.name.toLowerCase() === range!.toLowerCase());
  const named = range && !table && book.names[range];
  if (table) {
    sheetName = table.sheet;
    range = table.ref;
  } else if (named) {
    const m = /^'?(.+?)'?!(.+)$/.exec(named);
    if (!m) throw new Error(`The name “${options.range}” does not refer to a cell range.`);
    sheetName = m[1];
    range = m[2].replace(/\$/g, '');
  }
  const sheet = sheetName ? book.sheets.find((s) => s.name === sheetName) : book.sheets[0];
  if (!sheet)
    throw new Error(
      `The workbook has no sheet named “${sheetName}”. Sheets: ${book.sheets.map((s) => s.name).join(', ')}.`,
    );
  const grid = range ? sheetRange(sheet, range) : sheet.rows;
  const headerRow = options.headerRow ?? 1;
  const width = Math.max(0, ...grid.map((r) => r.length));
  const header = headerRow
    ? (grid[headerRow - 1] || []).map((c) =>
        c?.value instanceof Date ? c.value.toISOString().slice(0, 10) : String(c?.value ?? ''),
      )
    : [];
  while (header.length < width) header.push(headerRow ? '' : `Column ${header.length + 1}`);
  const body = grid
    .slice(headerRow || 0)
    .filter((r) => r.some((c) => c && (c.value !== null || c.formula !== undefined)));
  if (body.length > maxRows)
    throw new Error(`The sheet has more than ${maxRows.toLocaleString()} rows.`);
  const provenance = header.map((_, c) => {
    let cached = 0,
      uncached = 0;
    for (const r of body) if (r[c]?.formula !== undefined) r[c]!.cached ? cached++ : uncached++;
    return { cached, uncached };
  });
  const errors = body.reduce((n, r) => n + r.filter((c) => c?.error).length, 0);
  const dataset = buildDataset(
    header,
    body.map((r) => header.map((_, c) => (r[c]?.error ? null : (r[c]?.value ?? null)))),
    options,
    provenance,
  );
  if (errors)
    dataset.warnings.push(
      `${errors} cell(s) contain Excel errors (such as #DIV/0!) and are treated as empty.`,
    );
  return dataset;
}

export const accessOf = (dataset: Dataset): ColumnAccess => ({
  names: dataset.columns.map((c) => c.name),
  get: (index, row) => dataset.columns[index].values[row],
  isDate: (index) => dataset.columns[index].type === 'date',
});

/** Adds a calculated column computed with a row formula. */
export function addCalculatedColumn(
  dataset: Dataset,
  name: string,
  formula: string,
  type?: ColumnType,
): Dataset {
  if (dataset.columns.some((c) => c.name === name))
    throw new FormulaError(`A column named “${name}” already exists.`);
  const node = parseFormula(
    formula,
    dataset.columns.map((c) => c.name),
  );
  const f = compileRow(node, accessOf(dataset));
  const values: Value[] = new Array(dataset.rowCount);
  for (let r = 0; r < dataset.rowCount; r++) values[r] = f(r);
  const present = values.filter((v) => v !== null);
  const detected: ColumnType = present.every((v) => typeof v === 'number')
    ? 'number'
    : present.every((v) => typeof v === 'boolean')
      ? 'boolean'
      : 'string';
  return { ...dataset, columns: [...dataset.columns, { name, type: type || detected, values }] };
}

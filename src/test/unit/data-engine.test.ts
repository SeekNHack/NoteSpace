import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readXlsx, excelDate } from '../../core/xlsx';
import { zip } from '../../core/zip';
import { accessOf, addCalculatedColumn, loadDataset } from '../../core/dataset';
import { checkFormula, compileRow, evaluateAggregate, parseFormula } from '../../core/formula';

const fixture = readFileSync(path.join(__dirname, '../fixtures/vulnerabilities.xlsx'));
const enc = (s: string) => new TextEncoder().encode(s);

/** A tiny hand-made workbook with cached formula results, an error and inline text. */
function cachedWorkbook() {
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>a &amp; b</t></is></c><c r="B2"><f>1+1</f><v>2</v></c></row>
<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>
<row r="4"><c r="A4" t="b"><v>1</v></c><c r="B4" s="1"><v>45580</v></c></row>
</sheetData></worksheet>`;
  return zip([
    { name: '[Content_Types].xml', data: enc('<Types/>') },
    {
      name: 'xl/workbook.xml',
      data: enc(
        '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
    },
    {
      name: 'xl/sharedStrings.xml',
      data: enc(
        '<sst><si><t>Name</t></si><si><r><t>Va</t></r><r><t>lue</t></r></si><si><t xml:space="preserve"> spaced </t></si></sst>',
      ),
    },
    {
      name: 'xl/styles.xml',
      data: enc(
        '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: enc(sheet) },
    { name: 'xl/vbaProject.bin', data: enc('macro bytes are never read') },
  ]);
}

test('XLSX reader returns values, cached formula results, errors and dates without evaluating anything', () => {
  const book = readXlsx(cachedWorkbook());
  const rows = book.sheets[0].rows;
  assert.equal(rows[0][1]?.value, 'Value', 'rich text runs are joined');
  assert.equal(rows[1][0]?.value, 'a & b');
  assert.deepEqual(rows[1][1], { value: 2, formula: '1+1', cached: true });
  assert.equal(rows[2][1]?.error, '#DIV/0!');
  assert.equal(rows[2][0]?.value, ' spaced ');
  assert.equal(rows[3][0]?.value, true);
  assert.equal((rows[3][1]?.value as Date).toISOString().slice(0, 10), '2024-10-15');
  assert.equal(excelDate(1).toISOString().slice(0, 10), '1900-01-01');
  assert.equal(excelDate(61).toISOString().slice(0, 10), '1900-03-01');
});

test('a workbook made by another tool: sheets, tables, defined names and formulas without cached results', () => {
  const book = readXlsx(fixture);
  assert.deepEqual(
    book.sheets.map((s) => s.name),
    ['Export', 'Calc'],
  );
  assert.deepEqual(book.tables, [{ name: 'Findings', sheet: 'Export', ref: 'A1:H121' }]);
  assert.equal(book.names.TopRows, 'Export!$A$1:$H$11');
  const data = loadDataset('xlsx', fixture, { sheet: 'Export' });
  assert.equal(data.rowCount, 120);
  assert.deepEqual(
    data.columns.map((c) => `${c.name}:${c.type}`),
    [
      'ID:string',
      'Application:string',
      'Team:string',
      'Severity:string',
      'Status:string',
      'DetectedDate:date',
      'ResolvedDate:date',
      'Cost:number',
    ],
  );
  assert.equal(
    new Date(data.columns[5].values[0] as number).toISOString().slice(0, 10),
    '2025-01-06',
  );
  assert.equal(
    data.columns[6].values.filter((v) => v === null).length,
    40,
    'missing dates are null',
  );
  assert.equal(loadDataset('xlsx', fixture, { range: 'Findings' }).rowCount, 120, 'Excel table');
  assert.equal(loadDataset('xlsx', fixture, { range: 'TopRows' }).rowCount, 10, 'defined name');
  const calc = loadDataset('xlsx', fixture, { sheet: 'Calc' });
  assert.deepEqual(calc.columns[2].values, [null, null]);
  assert.deepEqual(calc.columns[2].formulas, { cached: 0, uncached: 2 });
  assert.match(
    calc.warnings.join('\n'),
    /2 Excel formula cell\(s\) without a saved result.*does not recalculate/,
  );
  assert.throws(
    () => loadDataset('xlsx', fixture, { sheet: 'Missing' }),
    /no sheet named “Missing”. Sheets: Export, Calc/,
  );
  assert.throws(() => readXlsx(fixture.subarray(0, 2000)), /Not a ZIP container/);
});

test('delimited and JSON sources detect types, locales and missing values', () => {
  const csv = loadDataset(
    'csv',
    enc(
      '\uFEFFName,Amount,When,Flag\n"Smith, J","1,234.5",31/12/2026,yes\nLee,N/A,2026-01-02,no\n',
    ),
  );
  assert.deepEqual(
    csv.columns.map((c) => c.type),
    ['string', 'number', 'date', 'boolean'],
  );
  assert.deepEqual(csv.columns[0].values, ['Smith, J', 'Lee'], 'quoted commas stay in the field');
  assert.deepEqual(
    csv.columns[1].values,
    [1234.5, null],
    'thousands separators and missing markers',
  );
  const semicolon = loadDataset(
    'csv',
    enc('Name;Amount;When\nA;1.234,5;31/12/2026\nB;-;01/02/2026\n'),
    { decimal: ',' },
  );
  assert.deepEqual(
    semicolon.columns.map((c) => c.type),
    ['string', 'number', 'date'],
  );
  assert.deepEqual(semicolon.columns[1].values, [1234.5, null]);
  assert.equal(
    new Date(semicolon.columns[2].values[1] as number).toISOString().slice(0, 10),
    '2026-02-01',
    'day/month order',
  );
  assert.equal(
    new Date(
      loadDataset('csv', enc('d\n01/02/2026\n'), { dateOrder: 'mdy' }).columns[0]
        .values[0] as number,
    )
      .toISOString()
      .slice(0, 10),
    '2026-01-02',
  );
  const tsv = loadDataset('tsv', enc('a\tb\n1\ttrue\n'));
  assert.deepEqual(
    tsv.columns.map((c) => c.type),
    ['number', 'boolean'],
  );
  const jsonl = loadDataset('jsonl', enc('{"x":1,"tags":["a"]}\n{"x":2,"y":"z"}\n'));
  assert.deepEqual(
    jsonl.columns.map((c) => c.name),
    ['x', 'tags', 'y'],
  );
  assert.deepEqual(jsonl.columns[1].values, ['["a"]', null]);
  assert.throws(() => loadDataset('jsonl', enc('{"x":1}\n{oops\n')), /Line 2 is not valid JSON/);
  assert.equal(loadDataset('json', enc('{"data":[{"a":1},{"a":2}]}')).rowCount, 2);
  assert.throws(
    () => loadDataset('csv', enc('a,b\n"unterminated,1\n')),
    /quoted field is not closed/,
  );
  const dup = loadDataset('csv', enc('a,a,\n1,2,3\n'));
  assert.deepEqual(
    dup.columns.map((c) => c.name),
    ['a', 'a (2)', 'Column 3'],
  );
});

test('formulas compute row values and aggregates with documented null handling', () => {
  const data = addCalculatedColumn(
    loadDataset('xlsx', fixture, { sheet: 'Export' }),
    'DaysOpen',
    'DAYS_BETWEEN(DetectedDate, ResolvedDate)',
  );
  const access = accessOf(data);
  const all = Uint32Array.from({ length: data.rowCount }, (_, i) => i);
  const agg = (f: string) => evaluateAggregate(parseFormula(f, access.names), access, all);
  assert.equal(agg('COUNT(rows)'), 120);
  assert.equal(agg('COUNT_IF(Severity = "Critical")'), 30);
  assert.equal(agg('COUNT_IF(severity = "critical")'), 30, 'text comparison ignores case');
  assert.equal(agg('COUNT_DISTINCT(Application)'), 3);
  assert.equal(agg('COUNT(ResolvedDate)'), 80, 'COUNT(column) skips empty values');
  assert.equal(agg('COUNT_IF(Status = "Resolved") / COUNT(rows) * 100'), (80 / 120) * 100);
  assert.equal(
    agg('COUNT_IF(Severity IN ("Critical", "High") AND YEAR(DetectedDate) = 2025)'),
    data.columns[3].values.filter(
      (s, i) =>
        ['Critical', 'High'].includes(s as string) &&
        new Date(data.columns[5].values[i] as number).getUTCFullYear() === 2025,
    ).length,
  );
  const days = data.columns
    .find((c) => c.name === 'DaysOpen')!
    .values.filter((v): v is number => v !== null);
  assert.equal(days.length, 80, 'unresolved rows have no duration');
  assert.equal(agg('AVG(DaysOpen)'), days.reduce((s, v) => s + v, 0) / days.length);
  assert.equal(
    agg('SUM_IF(Cost, Application = "Mobile")'),
    (data.columns[7].values as number[])
      .filter((_, i) => data.columns[1].values[i] === 'Mobile')
      .reduce((s, v) => s + v, 0),
  );
  assert.equal(agg('MAX(Cost)'), Math.max(...(data.columns[7].values as number[])));
  assert.equal(
    agg('AVG_IF(Cost, Severity = "Nope")'),
    null,
    'average of nothing is empty, not zero',
  );
  assert.equal(agg('SUM(Cost) / 0'), null, 'division by zero is empty');
  const row = compileRow(
    parseFormula(
      'IF(ISNULL(ResolvedDate), "open " & Team, YEAR_MONTH(ResolvedDate))',
      access.names,
    ),
    access,
  );
  assert.equal(row(2), 'open Team A');
  assert.equal(row(0), '2025-01');
});

test('formula validation explains mistakes and never runs code', () => {
  const cols = ['Severity', 'Cost', 'Detected Date'];
  assert.deepEqual(checkFormula('COUNT(rows)', cols, 'aggregate'), { ok: true, kind: 'aggregate' });
  assert.match(
    checkFormula('SUM(Costs)', cols).error!,
    /Unknown column “Costs”. Did you mean “Cost”/,
  );
  assert.match(
    checkFormula('YEAR([Detected Date])', cols, 'aggregate').error!,
    /must summarize rows/,
  );
  assert.match(
    checkFormula('Cost + SUM(Cost)', cols).error!,
    /“Cost” is used outside an aggregate/,
  );
  assert.match(checkFormula('SUM(COUNT(rows))', cols).error!, /cannot be nested/);
  assert.match(checkFormula('SUM(Cost', cols).error!, /Expected “\)”/);
  assert.match(checkFormula('EVAL("1")', cols).error!, /Unknown function EVAL/);
  assert.match(
    checkFormula('constructor.constructor("x")()', cols).error!,
    /Unknown function|Unknown column|Unexpected/,
  );
  assert.match(checkFormula('"open', cols).error!, /Unclosed text/);
  assert.match(checkFormula('rows', cols).error!, /only be used inside COUNT\(rows\)/);
  assert.equal(checkFormula('YEAR([Detected Date]) >= 2025', cols, 'row').ok, true);
});

test('aggregations stay fast on 100,000 rows', () => {
  const n = 100_000;
  const header = 'Severity,Cost,Day\n';
  const body = Array.from(
    { length: n },
    (_, i) =>
      `${['Critical', 'High', 'Low'][i % 3]},${i % 1000},2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
  ).join('\n');
  let start = performance.now();
  const data = loadDataset('csv', enc(header + body));
  const loadMs = performance.now() - start;
  const access = accessOf(data);
  const all = Uint32Array.from({ length: n }, (_, i) => i);
  start = performance.now();
  for (const f of [
    'COUNT(rows)',
    'COUNT_IF(Severity = "Critical")',
    'AVG(Cost)',
    'COUNT_DISTINCT(Day)',
    'SUM_IF(Cost, Severity = "High")',
  ])
    evaluateAggregate(parseFormula(f, access.names), access, all);
  const aggMs = performance.now() - start;
  console.log(`100k rows: load ${loadMs.toFixed(0)} ms, five metrics ${aggMs.toFixed(0)} ms`);
  assert.ok(loadMs < 4000 && aggMs < 1500, `${loadMs} / ${aggMs}`);
});

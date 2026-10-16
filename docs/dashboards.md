# Live data dashboards

A dashboard is a `.wiki-dashboard.json` file next to your data. It stores **where the data is, the formulas, the filters and the layout — never the data itself**. NoteSpace reads the source files on your machine, computes the numbers in the extension and shows them in a builder that opens like any other editor. Nothing is uploaded, nothing is sent to an AI service, and Excel macros are never run.

## Create one

- **NoteSpace: New Dashboard**, or right-click a `.xlsx`, `.csv`, `.tsv`, `.json` or `.jsonl` file in the Explorer → **New Dashboard**. You choose the file and a title; the dashboard is created next to it with a row-count card and a first chart.
- Open an existing `*.wiki-dashboard.json` and it opens in the builder. **Reopen Editor With… → Text Editor** shows the JSON, which is validated against `media/dashboard.schema.json` (VS Code underlines unknown or invalid properties).

## Data sources

| Type          | Notes                                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Excel `.xlsx` | Read-only. Choose a sheet, an Excel table, a defined name or an A1 range, and the header row. Formula cells use the value Excel saved with the file; columns whose formula cells have no saved value are reported. Dates stored as serial numbers become dates. |
| CSV / TSV     | Delimiter detected; quoted fields, BOM and Windows line endings handled.                                                                                                                                                                                        |
| JSON / JSONL  | An array of objects (or one object per line). Nested objects and arrays are kept as JSON text in their column.                                                                                                                                                  |

Column types (number, text, date, true/false) are inferred and can be overridden. Number and date parsing follows a locale setting (`1.234,5` or `1,234.5`; `31/12/2026` or `12/31/2026`). Values listed as **missing** (for example `N/A`, `-`) become empty. Files larger than 50 MB are refused with a clear message.

**Calculated columns** add a column per row with a row formula, for example `DAYS_BETWEEN(DetectedDate, ResolvedDate)` or `IF(Severity IN ("Critical", "High"), "Urgent", "Normal")`.

## Formulas

Formulas are parsed and evaluated by NoteSpace's own small interpreter — no `eval`, no JavaScript, no Excel engine. Column names are written as is, or in brackets when they contain spaces: `[Detected Date]`. Text is quoted with `"`. Operators: `+ - * / %`, `&` (join text), `= <> != < <= > >=`, `AND`, `OR`, `NOT`, `IN (…)`, `NOT IN (…)`.

**Metric (aggregate) functions:** `COUNT(rows)`, `COUNT_IF(condition)`, `COUNT_DISTINCT(column)`, `SUM(expr)`, `SUM_IF(expr, condition)`, `AVG(expr)`, `AVG_IF(expr, condition)`, `MEDIAN(expr)`, `MIN(expr)`, `MAX(expr)`. Aggregates can be combined: `COUNT_IF(Status = "Resolved") / COUNT(rows) * 100`.

**Row functions:** `IF`, `AND`, `OR`, `NOT`, `ISNULL`, `COALESCE`, `ROUND`, `ABS`, `FLOOR`, `CEIL`, `NUMBER`, `GREATEST`, `LEAST`, `TEXT`, `LOWER`, `UPPER`, `TRIM`, `LEN`, `CONCAT`, `CONTAINS`, `STARTS_WITH`, `DATE`, `TODAY`, `YEAR`, `MONTH`, `DAY`, `QUARTER`, `WEEKDAY`, `YEAR_MONTH`, `DAYS_BETWEEN`.

The data dialog checks a formula before it is saved and names the problem (“Unknown column “Severty”. Did you mean “Severity”?”). Division by zero gives an empty value, not an error.

## Widgets and layout

| Widget      | Shows                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric card | One metric, formatted as number, percent, currency or days                                                                                                             |
| Progress    | A metric against a target number or another metric                                                                                                                     |
| Chart       | Bar, line, area, pie, donut, scatter, histogram or time series; group by a column or by day/week/month/quarter/year; several metrics; small slices folded into “Other” |
| Table       | Rows with chosen columns, in pages of 5–200 rows                                                                                                                       |
| Filter      | Select, date range or search control                                                                                                                                   |
| Text        | Markdown notes                                                                                                                                                         |

Widgets sit on a 12-column grid. Drag the header to move, drag the corner to resize, or use the keyboard: focus a widget and press the **arrow keys** to move it, **Shift+arrow keys** to resize it and **Delete** to remove it. Overlaps are resolved when the dashboard is shown, without rewriting your file. Builder changes are ordinary document edits: **Undo/Redo**, dirty state and **Save** work as in any editor.

**Interaction:** clicking a bar, slice or point adds a filter (shown as a removable chip) and every widget updates (**cross-filtering**). **Rows** on a chart opens the records behind it, with the current filters (drill-down). Each widget exports **CSV** (cells starting with `=`, `+`, `-` or `@` are prefixed so spreadsheets do not run them), **SVG** or **PNG**.

## Refresh

By default the dashboard follows its source files: a save in Excel or another tool refreshes it within about a second. With `"refresh": { "auto": false }` the numbers stay as they are and a note says that a source changed; **Refresh** (or your next change to the dashboard) loads the new data. Partially written files are retried; if a file cannot be read, **the last valid data stays on screen** with a message saying when it was loaded and why the refresh failed. **Refresh** in the toolbar reloads on demand.

## In pages

Studio's `/Dashboard` command embeds a whole dashboard or one widget:

````markdown
```dashboard
path: ../data/Security-Overview.wiki-dashboard.json
widget: metric-critical
```
````

The embed is live in Studio and the reader. In **static exports, dashboards are not included** unless the dashboard file opts in with `"export": { "snapshots": true }`; then the export contains a static, aggregated snapshot (cards and charts as computed at export time). Tables, which show individual rows, additionally need `"tables": true`. Without these flags the export shows a note instead of any data.

## Limits

- Excel: `.xlsx` only (not `.xls` or `.xlsb`); pivot tables, charts and formatting are ignored; formula results come from the values saved by Excel.
- Formulas are the documented subset above, not Excel's language.
- 100,000 rows load in about 0.13 s and compute metrics in about 20 ms on the test machine (`src/test/unit/data-engine.test.ts`); much larger files work but get slower.

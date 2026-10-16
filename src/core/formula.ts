/**
 * Safe formula language for dashboards. Formulas are parsed into a small syntax tree and
 * evaluated by this module only — no `eval`, `Function` or other dynamic code. It is not Excel:
 * the supported functions are listed in `functions` below and documented in docs/dashboards.md.
 *
 *   COUNT(rows)                         COUNT_IF(Severity = "Critical")
 *   AVG(DAYS_BETWEEN(DetectedDate, ResolvedDate))
 *   COUNT_IF(Status = "Resolved") / COUNT(rows) * 100
 *   IF(Severity IN ("Critical", "High"), "Urgent", "Normal")      (row formula)
 */
export type Value = number | string | boolean | null;
export interface ColumnAccess {
  names: string[];
  /** Value of column `index` in row `row`; dates are epoch milliseconds. */
  get(index: number, row: number): Value;
  isDate(index: number): boolean;
}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'rows' }
  | { t: 'col'; name: string; index: number }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'in'; a: Node; list: Node[]; not: boolean }
  | { t: 'call'; name: string; args: Node[] };

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly at?: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Tokenizer and parser
// ---------------------------------------------------------------------------------------------
type Token = { k: 'num' | 'str' | 'id' | 'op' | 'col' | 'end'; v: string; at: number };
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ k: 'num', v: m[0], at });
      i += m[0].length;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1,
        value = '';
      for (; j < src.length; j++) {
        if (src[j] === ch && src[j + 1] === ch) {
          value += ch;
          j++;
        } else if (src[j] === ch) break;
        else value += src[j];
      }
      if (j >= src.length) throw new FormulaError('Unclosed text: add the closing quote.', at);
      out.push({ k: 'str', v: value, at });
      i = j + 1;
    } else if (ch === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new FormulaError('Unclosed [column name].', at);
      out.push({ k: 'col', v: src.slice(i + 1, j), at });
      i = j + 1;
    } else if (/[\p{L}_]/u.test(ch)) {
      const m = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0], at });
      i += m[0].length;
    } else {
      const op = ['<=', '>=', '<>', '!=', '==', '&&', '||'].find((o) => src.startsWith(o, i)) || ch;
      if (!'+-*/%&=<>!(),'.includes(op[0]))
        throw new FormulaError(`Unexpected character “${ch}”.`, at);
      out.push({ k: 'op', v: op, at });
      i += op.length;
    }
  }
  out.push({ k: 'end', v: '', at: src.length });
  return out;
}

export function parseFormula(src: string, columns: string[]): Node {
  if (src.length > 2000) throw new FormulaError('The formula is too long.');
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const kw = (word: string) => peek().k === 'id' && peek().v.toUpperCase() === word;
  const expect = (v: string) => {
    if (peek().v !== v)
      throw new FormulaError(
        `Expected “${v}”${peek().k === 'end' ? ' at the end' : ` before “${peek().v}”`}.`,
        peek().at,
      );
    p++;
  };
  const column = (name: string, at: number): Node => {
    const index = columns.findIndex((c) => c === name);
    const loose =
      index >= 0 ? index : columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    if (loose < 0) {
      const near = columns
        .filter((c) => c.toLowerCase().includes(name.toLowerCase().slice(0, 3)))
        .slice(0, 3);
      throw new FormulaError(
        `Unknown column “${name}”.${near.length ? ` Did you mean ${near.map((n) => `“${n}”`).join(', ')}?` : ''}`,
        at,
      );
    }
    return { t: 'col', name: columns[loose], index: loose };
  };
  const or = (): Node => {
    let a = and();
    while (kw('OR') || peek().v === '||') {
      p++;
      a = { t: 'bin', op: 'or', a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = not();
    while (kw('AND') || peek().v === '&&') {
      p++;
      a = { t: 'bin', op: 'and', a, b: not() };
    }
    return a;
  };
  const not = (): Node => {
    if (kw('NOT') && tokens[p + 1].v !== '(') {
      p++;
      return { t: 'un', op: 'not', a: not() };
    }
    if (peek().v === '!') {
      p++;
      return { t: 'un', op: 'not', a: not() };
    }
    return cmp();
  };
  const cmp = (): Node => {
    const a = add();
    const op = peek().v;
    if (['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(op) && peek().k === 'op') {
      p++;
      return { t: 'bin', op: op === '==' ? '=' : op === '<>' ? '!=' : op, a, b: add() };
    }
    const negate = kw('NOT') && tokens[p + 1].k === 'id' && tokens[p + 1].v.toUpperCase() === 'IN';
    if (kw('IN') || negate) {
      p += negate ? 2 : 1;
      expect('(');
      const list: Node[] = [];
      if (peek().v !== ')')
        do list.push(add());
        while (peek().v === ',' && ++p);
      expect(')');
      return { t: 'in', a, list, not: negate };
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (['+', '-', '&'].includes(peek().v) && peek().k === 'op') {
      const op = tokens[p++].v;
      a = { t: 'bin', op, a, b: mul() };
    }
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (['*', '/', '%'].includes(peek().v) && peek().k === 'op') {
      const op = tokens[p++].v;
      a = { t: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (peek().v === '-' && peek().k === 'op') {
      p++;
      return { t: 'un', op: 'neg', a: unary() };
    }
    if (peek().v === '+' && peek().k === 'op') {
      p++;
      return unary();
    }
    return primary();
  };
  const primary = (): Node => {
    const tok = tokens[p++];
    if (tok.k === 'num') return { t: 'num', v: Number(tok.v) };
    if (tok.k === 'str') return { t: 'str', v: tok.v };
    if (tok.k === 'col') return column(tok.v, tok.at);
    if (tok.k === 'op' && tok.v === '(') {
      const inner = or();
      expect(')');
      return inner;
    }
    if (tok.k === 'id') {
      const upper = tok.v.toUpperCase();
      if (peek().v === '(') {
        p++;
        const fn = functions[upper];
        if (!fn)
          throw new FormulaError(
            `Unknown function ${tok.v}(). See the list of supported functions.`,
            tok.at,
          );
        const args: Node[] = [];
        if (peek().v !== ')')
          do args.push(upper.startsWith('COUNT') && kw('ROWS') && ++p ? { t: 'rows' } : or());
          while (peek().v === ',' && ++p);
        expect(')');
        if (args.length < fn.min || args.length > fn.max)
          throw new FormulaError(
            `${upper}() takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max === Infinity ? 'many' : fn.max}`} argument${fn.max === 1 ? '' : 's'}.`,
            tok.at,
          );
        return { t: 'call', name: upper, args };
      }
      if (upper === 'TRUE' || upper === 'FALSE') return { t: 'bool', v: upper === 'TRUE' };
      if (upper === 'NULL') return { t: 'null' };
      if (upper === 'ROWS')
        throw new FormulaError('“rows” can only be used inside COUNT(rows).', tok.at);
      return column(tok.v, tok.at);
    }
    throw new FormulaError(
      tok.k === 'end' ? 'The formula ends too early.' : `Unexpected “${tok.v}”.`,
      tok.at,
    );
  };
  const tree = or();
  if (peek().k !== 'end') throw new FormulaError(`Unexpected “${peek().v}”.`, peek().at);
  return tree;
}

// ---------------------------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------------------------
const DAY = 86400000;
const num = (v: Value): number | null =>
  v === null || v === ''
    ? null
    : typeof v === 'number'
      ? v
      : typeof v === 'boolean'
        ? Number(v)
        : Number.isFinite(Number(v))
          ? Number(v)
          : null;
const text = (v: Value) => (v === null ? '' : String(v));
const truthy = (v: Value) => v !== null && v !== false && v !== 0 && v !== '';
const date = (v: Value) =>
  typeof v === 'number' ? new Date(v) : typeof v === 'string' && v ? new Date(v) : null;

interface Fn {
  min: number;
  max: number;
  aggregate?: boolean;
  /** Scalar implementation (row formulas). */
  run?: (args: Value[]) => Value;
}
export const functions: Record<string, Fn> = {
  // Aggregates (metric formulas)
  COUNT: { min: 1, max: 1, aggregate: true },
  COUNT_DISTINCT: { min: 1, max: 1, aggregate: true },
  COUNT_IF: { min: 1, max: 1, aggregate: true },
  SUM: { min: 1, max: 1, aggregate: true },
  SUM_IF: { min: 2, max: 2, aggregate: true },
  AVG: { min: 1, max: 1, aggregate: true },
  AVG_IF: { min: 2, max: 2, aggregate: true },
  MEDIAN: { min: 1, max: 1, aggregate: true },
  MIN: { min: 1, max: 1, aggregate: true },
  MAX: { min: 1, max: 1, aggregate: true },
  // Logic
  IF: { min: 2, max: 3, run: ([c, a, b]) => (truthy(c) ? a : (b ?? null)) },
  AND: { min: 1, max: Infinity, run: (a) => a.every(truthy) },
  OR: { min: 1, max: Infinity, run: (a) => a.some(truthy) },
  NOT: { min: 1, max: 1, run: ([a]) => !truthy(a) },
  ISNULL: { min: 1, max: 1, run: ([a]) => a === null || a === '' },
  COALESCE: { min: 1, max: Infinity, run: (a) => a.find((v) => v !== null && v !== '') ?? null },
  // Numbers
  ROUND: {
    min: 1,
    max: 2,
    run: ([a, d]) =>
      num(a) === null ? null : Math.round(num(a)! * 10 ** (num(d) ?? 0)) / 10 ** (num(d) ?? 0),
  },
  ABS: { min: 1, max: 1, run: ([a]) => (num(a) === null ? null : Math.abs(num(a)!)) },
  FLOOR: { min: 1, max: 1, run: ([a]) => (num(a) === null ? null : Math.floor(num(a)!)) },
  CEIL: { min: 1, max: 1, run: ([a]) => (num(a) === null ? null : Math.ceil(num(a)!)) },
  NUMBER: { min: 1, max: 1, run: ([a]) => num(a) },
  GREATEST: {
    min: 1,
    max: Infinity,
    run: (a) => {
      const ns = a.map(num).filter((v): v is number => v !== null);
      return ns.length ? Math.max(...ns) : null;
    },
  },
  LEAST: {
    min: 1,
    max: Infinity,
    run: (a) => {
      const ns = a.map(num).filter((v): v is number => v !== null);
      return ns.length ? Math.min(...ns) : null;
    },
  },
  // Text
  TEXT: { min: 1, max: 1, run: ([a]) => text(a) },
  LOWER: { min: 1, max: 1, run: ([a]) => text(a).toLowerCase() },
  UPPER: { min: 1, max: 1, run: ([a]) => text(a).toUpperCase() },
  TRIM: { min: 1, max: 1, run: ([a]) => text(a).trim() },
  LEN: { min: 1, max: 1, run: ([a]) => text(a).length },
  CONCAT: { min: 1, max: Infinity, run: (a) => a.map(text).join('') },
  CONTAINS: {
    min: 2,
    max: 2,
    run: ([a, b]) => text(a).toLowerCase().includes(text(b).toLowerCase()),
  },
  STARTS_WITH: {
    min: 2,
    max: 2,
    run: ([a, b]) => text(a).toLowerCase().startsWith(text(b).toLowerCase()),
  },
  // Dates (values are UTC epoch milliseconds)
  DATE: {
    min: 3,
    max: 3,
    run: ([y, m, d]) =>
      [y, m, d].some((v) => num(v) === null) ? null : Date.UTC(num(y)!, num(m)! - 1, num(d)!),
  },
  TODAY: { min: 0, max: 0, run: () => Math.floor(Date.now() / DAY) * DAY },
  YEAR: { min: 1, max: 1, run: ([a]) => date(a)?.getUTCFullYear() ?? null },
  MONTH: { min: 1, max: 1, run: ([a]) => (date(a) ? date(a)!.getUTCMonth() + 1 : null) },
  DAY: { min: 1, max: 1, run: ([a]) => date(a)?.getUTCDate() ?? null },
  QUARTER: {
    min: 1,
    max: 1,
    run: ([a]) => (date(a) ? Math.floor(date(a)!.getUTCMonth() / 3) + 1 : null),
  },
  WEEKDAY: {
    min: 1,
    max: 1,
    run: ([a]) => (date(a) ? ((date(a)!.getUTCDay() + 6) % 7) + 1 : null),
  },
  YEAR_MONTH: {
    min: 1,
    max: 1,
    run: ([a]) => (date(a) ? date(a)!.toISOString().slice(0, 7) : null),
  },
  DAYS_BETWEEN: {
    min: 2,
    max: 2,
    run: ([a, b]) => {
      const x = date(a),
        y = date(b);
      return x && y ? Math.round((y.getTime() - x.getTime()) / DAY) : null;
    },
  },
};

/** A formula is an aggregate when it uses an aggregate function outside another aggregate. */
export function isAggregate(node: Node): boolean {
  if (node.t === 'call' && functions[node.name].aggregate) return true;
  if (node.t === 'un') return isAggregate(node.a);
  if (node.t === 'bin') return isAggregate(node.a) || isAggregate(node.b);
  if (node.t === 'in') return isAggregate(node.a) || node.list.some(isAggregate);
  if (node.t === 'call') return node.args.some(isAggregate);
  return false;
}

function compare(op: string, a: Value, b: Value): boolean {
  if (a === null || b === null) return op === '!=' ? a !== b : op === '=' ? a === b : false;
  if (typeof a === 'string' || typeof b === 'string') {
    const x = text(a).toLowerCase(),
      y = text(b).toLowerCase();
    return op === '='
      ? x === y
      : op === '!='
        ? x !== y
        : op === '<'
          ? x < y
          : op === '<='
            ? x <= y
            : op === '>'
              ? x > y
              : x >= y;
  }
  const x = Number(a),
    y = Number(b);
  return op === '='
    ? x === y
    : op === '!='
      ? x !== y
      : op === '<'
        ? x < y
        : op === '<='
          ? x <= y
          : op === '>'
            ? x > y
            : x >= y;
}

/** Compiles a row formula into a fast evaluator over a row index. */
export function compileRow(node: Node, data: ColumnAccess): (row: number) => Value {
  switch (node.t) {
    case 'num':
    case 'str':
    case 'bool': {
      const v = node.v;
      return () => v;
    }
    case 'null':
      return () => null;
    case 'rows':
      throw new FormulaError('“rows” can only be used inside COUNT(rows).');
    case 'col': {
      const i = node.index;
      return (r) => data.get(i, r);
    }
    case 'un': {
      const a = compileRow(node.a, data);
      return node.op === 'not'
        ? (r) => !truthy(a(r))
        : (r) => (num(a(r)) === null ? null : -num(a(r))!);
    }
    case 'in': {
      const a = compileRow(node.a, data),
        list = node.list.map((n) => compileRow(n, data));
      return (r) => {
        const v = a(r);
        const found = list.some((f) => compare('=', v, f(r)));
        return node.not ? !found : found;
      };
    }
    case 'bin': {
      const a = compileRow(node.a, data),
        b = compileRow(node.b, data);
      switch (node.op) {
        case 'and':
          return (r) => truthy(a(r)) && truthy(b(r));
        case 'or':
          return (r) => truthy(a(r)) || truthy(b(r));
        case '&':
          return (r) => text(a(r)) + text(b(r));
        case '+':
        case '-':
        case '*':
        case '/':
        case '%':
          return (r) => {
            const x = num(a(r)),
              y = num(b(r));
            if (x === null || y === null) return null;
            if ((node.op === '/' || node.op === '%') && y === 0) return null;
            return node.op === '+'
              ? x + y
              : node.op === '-'
                ? x - y
                : node.op === '*'
                  ? x * y
                  : node.op === '/'
                    ? x / y
                    : x % y;
          };
        default:
          return (r) => compare(node.op, a(r), b(r));
      }
    }
    case 'call': {
      const fn = functions[node.name];
      if (fn.aggregate)
        throw new FormulaError(
          `${node.name}() summarizes many rows; it cannot be used in a calculated column or filter.`,
        );
      const args = node.args.map((n) => compileRow(n, data));
      // IF evaluates lazily so only the chosen branch runs.
      if (node.name === 'IF')
        return (r) => (truthy(args[0](r)) ? args[1](r) : args[2] ? args[2](r) : null);
      return (r) => fn.run!(args.map((f) => f(r)));
    }
  }
}

/** Evaluates an aggregate formula over the given rows. */
export function evaluateAggregate(node: Node, data: ColumnAccess, rows: ArrayLike<number>): Value {
  switch (node.t) {
    case 'call': {
      const fn = functions[node.name];
      if (!fn.aggregate) return fn.run!(node.args.map((a) => evaluateAggregate(a, data, rows)));
      const values = (arg: Node, predicate?: Node) => {
        const f = compileRow(arg, data);
        const keep = predicate && compileRow(predicate, data);
        const out: Value[] = [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (keep && !truthy(keep(r))) continue;
          out.push(f(r));
        }
        return out;
      };
      const numbers = (vs: Value[]) => vs.map(num).filter((v): v is number => v !== null);
      switch (node.name) {
        case 'COUNT':
          return node.args[0].t === 'rows'
            ? rows.length
            : values(node.args[0]).filter((v) => v !== null && v !== '').length;
        case 'COUNT_IF': {
          const keep = compileRow(node.args[0], data);
          let n = 0;
          for (let i = 0; i < rows.length; i++) if (truthy(keep(rows[i]))) n++;
          return n;
        }
        case 'COUNT_DISTINCT':
          return new Set(
            values(node.args[0])
              .filter((v) => v !== null && v !== '')
              .map((v) => (typeof v === 'string' ? v.toLowerCase() : v)),
          ).size;
        case 'SUM':
        case 'SUM_IF':
          return numbers(values(node.args[0], node.args[1])).reduce((s, v) => s + v, 0);
        case 'AVG':
        case 'AVG_IF': {
          const ns = numbers(values(node.args[0], node.args[1]));
          return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : null;
        }
        case 'MEDIAN': {
          const ns = numbers(values(node.args[0])).sort((a, b) => a - b);
          if (!ns.length) return null;
          const mid = ns.length >> 1;
          return ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
        }
        case 'MIN':
        case 'MAX': {
          const ns = numbers(values(node.args[0]));
          let best: number | null = null;
          for (const v of ns)
            if (best === null || (node.name === 'MIN' ? v < best : v > best)) best = v;
          return best;
        }
      }
      return null;
    }
    case 'bin':
    case 'un':
    case 'in': {
      // Combine aggregate results with the row operators on a one-row view.
      const value = (n: Node) => evaluateAggregate(n, data, rows);
      const constant: ColumnAccess = { names: [], get: () => null, isDate: () => false };
      const wrap = (v: Value): Node =>
        v === null
          ? { t: 'null' }
          : typeof v === 'number'
            ? { t: 'num', v }
            : typeof v === 'boolean'
              ? { t: 'bool', v }
              : { t: 'str', v: String(v) };
      if (node.t === 'bin')
        return compileRow({ ...node, a: wrap(value(node.a)), b: wrap(value(node.b)) }, constant)(0);
      if (node.t === 'un') return compileRow({ ...node, a: wrap(value(node.a)) }, constant)(0);
      return compileRow(
        { ...node, a: wrap(value(node.a)), list: node.list.map((n) => wrap(value(n))) },
        constant,
      )(0);
    }
    case 'col':
      throw new FormulaError(
        `“${node.name}” is a column; summarize it, for example SUM(${node.name}) or COUNT_DISTINCT(${node.name}).`,
      );
    default:
      return compileRow(node, data)(0);
  }
}

export interface FormulaInfo {
  ok: boolean;
  kind?: 'row' | 'aggregate';
  error?: string;
  at?: number;
}
/** Parses and classifies a formula for inline validation. */
export function checkFormula(
  src: string,
  columns: string[],
  expect?: 'row' | 'aggregate',
): FormulaInfo {
  try {
    const node = parseFormula(src, columns);
    const kind = isAggregate(node) ? 'aggregate' : 'row';
    if (kind === 'aggregate') {
      const nested = (n: Node, inside: boolean): boolean =>
        n.t === 'call'
          ? (functions[n.name].aggregate && inside) ||
            n.args.some((a) => nested(a, inside || !!functions[n.name].aggregate))
          : n.t === 'bin'
            ? nested(n.a, inside) || nested(n.b, inside)
            : n.t === 'un'
              ? nested(n.a, inside)
              : n.t === 'in'
                ? nested(n.a, inside) || n.list.some((x) => nested(x, inside))
                : false;
      if (nested(node, false))
        return {
          ok: false,
          kind,
          error: 'Aggregates cannot be nested (for example SUM(COUNT(rows))).',
        };
      const bare = (n: Node, inside: boolean): string | undefined =>
        n.t === 'col' && !inside
          ? n.name
          : n.t === 'call'
            ? n.args.map((a) => bare(a, inside || !!functions[n.name].aggregate)).find(Boolean)
            : n.t === 'bin'
              ? bare(n.a, inside) || bare(n.b, inside)
              : n.t === 'un'
                ? bare(n.a, inside)
                : n.t === 'in'
                  ? bare(n.a, inside) || n.list.map((x) => bare(x, inside)).find(Boolean)
                  : undefined;
      const column = bare(node, false);
      if (column)
        return {
          ok: false,
          kind,
          error: `“${column}” is used outside an aggregate; wrap it, for example MAX(${column}).`,
        };
    }
    if (expect && kind !== expect)
      return {
        ok: false,
        kind,
        error:
          expect === 'aggregate'
            ? 'A metric must summarize rows, for example COUNT(rows) or SUM(Amount).'
            : `${kind === 'aggregate' ? 'Aggregates' : 'This'} cannot be used in a calculated column or filter.`,
      };
    return { ok: true, kind };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      at: e instanceof FormulaError ? e.at : undefined,
    };
  }
}

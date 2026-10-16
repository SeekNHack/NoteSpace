/**
 * Request tests: one assertion or extraction per line, evaluated by this module — never as
 * JavaScript. Lines starting with `#` are comments.
 *
 *   status == 200                      status in 200..299
 *   time < 500                         size < 10000
 *   header content-type contains json  header x-request-id exists
 *   json $.id exists                   json $.items.length >= 1
 *   json $.user.name == "Mario"        json $.tags[0] matches ^v\d+
 *   body contains "ok"
 *   schema $                           (checks the JSON body against the request's response schema)
 *   set token = json $.access_token    (a runtime variable for the next requests, not saved)
 *   set userId = header x-user-id
 */
export interface TestResponse {
  status: number;
  headers: Array<[string, string]>;
  /** Body as text (truncated bodies are tested as received). */
  body: string;
  ms: number;
  size: number;
}
export interface TestResult {
  line: number;
  source: string;
  pass: boolean;
  message: string;
}
export interface TestRun {
  results: TestResult[];
  /** Variables extracted with `set`. */
  variables: Record<string, string>;
}

type Op =
  '==' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'matches' | 'exists' | 'in' | 'notexists';

/** JSONPath subset: `$`, `.name`, `['name']`, `[0]`, and `.length` on arrays and strings. */
export function jsonPath(value: unknown, path: string): { found: boolean; value?: unknown } {
  const p = path.trim();
  if (!p.startsWith('$')) throw new Error(`A JSON path starts with $ (got “${path}”).`);
  let current: unknown = value;
  const re = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\]/y;
  let i = 1;
  while (i < p.length) {
    re.lastIndex = i;
    const m = re.exec(p);
    if (!m) throw new Error(`Cannot read the JSON path “${path}” at “${p.slice(i)}”.`);
    i = re.lastIndex;
    const key = m[1] ?? m[3];
    if (m[2] !== undefined) {
      if (!Array.isArray(current) || Number(m[2]) >= current.length) return { found: false };
      current = current[Number(m[2])];
    } else if (key === 'length' && (Array.isArray(current) || typeof current === 'string'))
      current = current.length;
    else if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      Object.prototype.hasOwnProperty.call(current, key!)
    )
      current = (current as Record<string, unknown>)[key!];
    else return { found: false };
  }
  return { found: true, value: current };
}

const literal = (raw: string): unknown => {
  const t = raw.trim();
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
};
const show = (v: unknown) =>
  typeof v === 'string' ? JSON.stringify(v) : v === undefined ? 'nothing' : JSON.stringify(v);

function compare(actual: unknown, op: Op, expected: string): boolean {
  const e = literal(expected);
  switch (op) {
    case '==':
      return (
        JSON.stringify(actual) === JSON.stringify(e) ||
        (typeof actual === 'number' && Number(e) === actual) ||
        String(actual) === String(e)
      );
    case '!=':
      return !compare(actual, '==', expected);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const a = Number(actual),
        b = Number(e);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
    }
    case 'contains':
      return Array.isArray(actual)
        ? actual.some((x) => JSON.stringify(x) === JSON.stringify(e) || x === e)
        : String(actual ?? '')
            .toLowerCase()
            .includes(String(e).toLowerCase());
    case 'matches':
      try {
        return new RegExp(String(e)).test(String(actual ?? ''));
      } catch {
        throw new Error(`“${expected}” is not a valid regular expression.`);
      }
    case 'in': {
      const range = /^(-?\d+)\.\.(-?\d+)$/.exec(expected.trim());
      if (range) return Number(actual) >= Number(range[1]) && Number(actual) <= Number(range[2]);
      return expected
        .split(',')
        .map((x) => literal(x))
        .some((x) => String(x) === String(actual));
    }
    default:
      return false;
  }
}

/** A minimal JSON Schema check (type, required, properties, items, enum) for `schema`. */
export function checkSchema(
  value: unknown,
  schema: Record<string, unknown>,
  at = '$',
  errors: string[] = [],
): string[] {
  if (errors.length > 20 || !schema || typeof schema !== 'object') return errors;
  const type = schema.type;
  const typeOf = (v: unknown) =>
    v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
  if (typeof type === 'string') {
    const t = typeOf(value);
    const ok =
      t === type ||
      (type === 'number' && t === 'integer') ||
      (schema.nullable === true && value === null);
    if (!ok) {
      errors.push(`${at}: expected ${type}, got ${t}`);
      return errors;
    }
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((x) => JSON.stringify(x) === JSON.stringify(value))
  )
    errors.push(`${at}: not one of ${schema.enum.map((x) => JSON.stringify(x)).join(', ')}`);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Array.isArray(schema.required) ? schema.required : [])
      if (!(key in (value as object))) errors.push(`${at}.${key}: required`);
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    for (const [k, s] of Object.entries(props))
      if (k in (value as object))
        checkSchema((value as Record<string, unknown>)[k], s, `${at}.${k}`, errors);
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object')
    value
      .slice(0, 50)
      .forEach((x, i) =>
        checkSchema(x, schema.items as Record<string, unknown>, `${at}[${i}]`, errors),
      );
  return errors;
}

export function runTests(
  source: string | undefined,
  response: TestResponse,
  schema?: Record<string, unknown>,
): TestRun {
  const results: TestResult[] = [];
  const variables: Record<string, string> = {};
  let json: unknown;
  let jsonError: string | undefined;
  const parsed = () => {
    if (json === undefined && !jsonError)
      try {
        json = JSON.parse(response.body);
      } catch (e) {
        jsonError = `The response body is not JSON${e instanceof Error ? ` (${e.message})` : ''}.`;
      }
    if (jsonError) throw new Error(jsonError);
    return json;
  };
  const header = (name: string) =>
    response.headers
      .filter(([k]) => k.toLowerCase() === name.toLowerCase())
      .map(([, v]) => v)
      .join(', ') || undefined;
  const lines = (source || '').split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const result = (pass: boolean, message: string) =>
      results.push({ line: index + 1, source: line, pass, message });
    try {
      const set =
        /^set\s+([A-Za-z_][\w.-]{0,63})\s*=\s*(json\s+(\S+)|header\s+(\S+)|status)$/i.exec(line);
      if (set) {
        let value: unknown;
        if (set[3]) {
          const r = jsonPath(parsed(), set[3]);
          if (!r.found)
            return result(false, `${set[3]} is not in the response; ${set[1]} was not set.`);
          value = r.value;
        } else if (set[4]) {
          value = header(set[4]);
          if (value === undefined)
            return result(false, `The response has no ${set[4]} header; ${set[1]} was not set.`);
        } else value = response.status;
        variables[set[1]] = typeof value === 'string' ? value : JSON.stringify(value);
        return result(true, `${set[1]} set (${String(variables[set[1]]).length} characters).`);
      }
      if (/^schema(\s+\$)?$/i.test(line)) {
        if (!schema)
          return result(
            false,
            'No response schema is known for this request (import it from OpenAPI to get one).',
          );
        const errors = checkSchema(parsed(), schema);
        return result(
          !errors.length,
          errors.length ? errors.slice(0, 5).join('; ') : 'The body matches the response schema.',
        );
      }
      const m =
        /^(status|time|size|body|header\s+(\S+)|json\s+(\S+))\s+(==|!=|<=|>=|<|>|contains|matches|exists|in|not\s+exists)(?:\s+(.+))?$/i.exec(
          line,
        );
      if (!m)
        return result(
          false,
          'Not understood. Examples: status == 200, json $.id exists, header content-type contains json, time < 500, set token = json $.token',
        );
      const op = m[4].toLowerCase().replace(/\s+/, '') as Op;
      const expected = m[5] ?? '';
      if (op !== 'exists' && op !== 'notexists' && !expected)
        return result(false, `${m[4]} needs a value.`);
      let actual: unknown;
      let found = true;
      const subject = m[1].toLowerCase();
      if (subject === 'status') actual = response.status;
      else if (subject === 'time') actual = response.ms;
      else if (subject === 'size') actual = response.size;
      else if (subject === 'body') actual = response.body;
      else if (m[2]) {
        actual = header(m[2]);
        found = actual !== undefined;
      } else {
        const r = jsonPath(parsed(), m[3]);
        found = r.found;
        actual = r.value;
      }
      if (op === 'exists') return result(found, found ? 'Present.' : 'Missing.');
      if (op === 'notexists')
        return result(!found, found ? `Present: ${show(actual)}.` : 'Absent.');
      if (!found) return result(false, `Missing (expected ${m[4]} ${expected}).`);
      const pass = compare(actual, op, expected);
      return result(
        pass,
        pass
          ? `${show(actual)} ${m[4]} ${expected}`
          : `Expected ${m[4]} ${expected}, got ${show(actual)}.`,
      );
    } catch (e) {
      result(false, e instanceof Error ? e.message : String(e));
    }
  });
  return { results, variables };
}

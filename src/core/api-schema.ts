/** Schema helpers shared by the reference renderer and the playground webview (no YAML). */
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};

export interface SchemaRow {
  /** Dotted path; array items end in `[]`. */
  name: string;
  type: string;
  required: boolean;
  description?: string;
}
/** Flattens a schema's properties into rows for model tables (depth-limited). */
export function schemaRows(
  schema: Obj,
  prefix = '',
  depth = 0,
  out: SchemaRow[] = [],
): SchemaRow[] {
  if (depth > 4 || out.length > 200) return out;
  const merged: Obj = Array.isArray(schema.allOf)
    ? Object.assign({}, ...schema.allOf.map((s) => obj(s)), { ...schema, allOf: undefined })
    : schema;
  const props = obj(merged.properties);
  const required = new Set(Array.isArray(merged.required) ? merged.required.map(String) : []);
  for (const [name, raw] of Object.entries(props)) {
    const s = obj(raw);
    const path = `${prefix}${name}`;
    out.push({
      name: path,
      type: typeName(s),
      required: required.has(name),
      description: typeof s.description === 'string' ? s.description : undefined,
    });
    if (s.type === 'object' || s.properties) schemaRows(s, `${path}.`, depth + 1, out);
    else if (s.type === 'array' && obj(s.items).properties)
      schemaRows(obj(s.items), `${path}[].`, depth + 1, out);
  }
  if (
    !prefix &&
    !Object.keys(props).length &&
    merged.type === 'array' &&
    obj(merged.items).properties
  )
    schemaRows(obj(merged.items), '[].', depth + 1, out);
  return out;
}
export function typeName(s: Obj): string {
  const variants = (Array.isArray(s.oneOf) && s.oneOf) || (Array.isArray(s.anyOf) && s.anyOf);
  if (variants) return variants.map((v) => typeName(obj(v))).join(' | ');
  let type = Array.isArray(s.type)
    ? s.type.join(' | ')
    : typeof s.type === 'string'
      ? s.type
      : s.properties
        ? 'object'
        : '';
  if (type === 'array') type = `${typeName(obj(s.items)) || 'any'}[]`;
  if (typeof s.format === 'string') type += ` (${s.format})`;
  if (Array.isArray(s.enum))
    type += `: ${s.enum
      .slice(0, 8)
      .map((v) => JSON.stringify(v))
      .join(', ')}`;
  if (typeof s.description === 'string' && /^\(recursive /.test(s.description))
    return s.description.slice(1, -1);
  return type;
}

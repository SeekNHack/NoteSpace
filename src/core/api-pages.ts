import { ApiOperation, ApiSpec, curlSample, schemaRows, typeName } from './openapi';
import { contentHash } from './scopes';
import { slug } from './paths';

/**
 * Reference pages generated from an OpenAPI description. The generated part of each page sits
 * between markers that record its source and a hash of what was generated:
 *
 *   <!-- wiki-studio:generated source="../openapi.yaml" hash="…" -->
 *   …
 *   <!-- /wiki-studio:generated -->
 *
 * Text outside the markers is never touched. Regenerating compares the current generated part
 * with the recorded hash: unchanged parts are replaced, edited parts are a conflict the user
 * resolves explicitly.
 */
export interface GeneratedPage {
  /** Path relative to the target folder. */
  file: string;
  title: string;
  body: string;
}

const START = /<!-- wiki-studio:generated source="([^"]*)" hash="([0-9a-f]+)" -->\r?\n?/;
const END = /\r?\n?<!-- \/wiki-studio:generated -->/;

const cell = (s: string) =>
  s
    .replace(/\|/g, '\\|')
    .replace(/\r?\n+/g, ' ')
    .trim();
const fence = (lang: string, value: string) => {
  const ticks = '`'.repeat(Math.max(3, ...(value.match(/`+/g) || []).map((t) => t.length + 1)));
  return `${ticks}${lang}\n${value}\n${ticks}`;
};
const json = (v: unknown) => (typeof v === 'string' ? v : (JSON.stringify(v, null, 2) ?? ''));
const fileFor = (tag: string) => `${slug(tag) || 'endpoints'}.md`;

function modelSection(schema: Record<string, unknown> | undefined): string {
  const rows = schema ? schemaRows(schema) : [];
  if (!rows.length) return '';
  return `| Field | Type | Required | Description |\n| --- | --- | --- | --- |\n${rows
    .map(
      (r) =>
        `| \`${cell(r.name)}\` | \`${cell(r.type)}\` | ${r.required ? 'yes' : ''} | ${cell(r.description || '')} |`,
    )
    .join('\n')}\n`;
}
const modelRef = (name?: string) =>
  name ? ` — model [\`${name}\`](schemas.md#${slug(name.replace(/\[\]$/, ''))})` : '';

function operationMarkdown(spec: ApiSpec, op: ApiOperation): string {
  const out = [`### ${op.method} \`${op.path}\`${op.summary ? ` — ${op.summary}` : ''}`, ''];
  if (op.description) out.push(op.description.trim(), '');
  out.push(`Operation ID: \`${op.id}\``, '');
  if (op.security.length)
    out.push(`Authentication: ${op.security.map((s) => `\`${s}\``).join(', ')}`, '');
  if (op.parameters.length) {
    out.push(
      '| Parameter | In | Type | Required | Description |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const p of op.parameters)
      out.push(
        `| \`${cell(p.name)}\` | ${p.in} | \`${cell(typeName(p.schema || {}))}\` | ${p.required ? 'yes' : ''} | ${cell(p.description || '')} |`,
      );
    out.push('');
  }
  if (op.requestBody) {
    out.push(
      `**Request body** \`${op.requestBody.contentType}\`${op.requestBody.required ? ' (required)' : ''}${modelRef(op.requestBody.schemaName)}`,
      '',
    );
    if (!op.requestBody.schemaName) {
      const model = modelSection(op.requestBody.schema);
      if (model) out.push(model);
    }
    if (op.requestBody.example !== undefined)
      out.push(fence('json', json(op.requestBody.example)), '');
  }
  if (op.responses.length) {
    out.push('**Responses**', '');
    for (const r of op.responses) {
      out.push(`- \`${r.status}\` ${r.description || ''}${modelRef(r.schemaName)}`.trimEnd());
      if (r.example !== undefined)
        out.push('', fence('json', json(r.example)).replace(/^/gm, '  '), '');
    }
    out.push('');
  }
  out.push('**Example request**', '', fence('bash', curlSample(spec, op)), '');
  return out.join('\n');
}

export function generateApiPages(spec: ApiSpec): GeneratedPage[] {
  const groups = new Map<string, ApiOperation[]>();
  for (const op of spec.operations) {
    const tag = op.tags[0] || 'Endpoints';
    groups.set(tag, [...(groups.get(tag) || []), op]);
  }
  const pages: GeneratedPage[] = [];
  const index = [`# ${spec.title}`, ''];
  if (spec.version) index.push(`Version ${spec.version}`, '');
  if (spec.description) index.push(spec.description.trim(), '');
  if (spec.servers.length)
    index.push(
      '## Servers',
      '',
      ...spec.servers.map((s) => `- \`${s.url}\`${s.description ? ` — ${s.description}` : ''}`),
      '',
    );
  if (spec.schemes.length)
    index.push(
      '## Authentication',
      '',
      ...spec.schemes.map(
        (s) =>
          `- \`${s.name}\`: ${s.type === 'apiKey' ? `API key in ${s.in} \`${s.parameter}\`` : s.type === 'http' ? `HTTP ${s.scheme}` : s.type}${s.description ? ` — ${cell(s.description)}` : ''}`,
      ),
      '',
    );
  index.push('## Endpoints', '');
  for (const [tag, ops] of groups) {
    index.push(
      `- [${tag}](${fileFor(tag)}) — ${ops.length} operation${ops.length === 1 ? '' : 's'}`,
    );
    pages.push({
      file: fileFor(tag),
      title: tag,
      body: [`# ${tag}`, '', ...ops.map((op) => operationMarkdown(spec, op))].join('\n'),
    });
  }
  if (spec.schemas.length) {
    index.push(
      `- [Schemas](schemas.md) — ${spec.schemas.length} model${spec.schemas.length === 1 ? '' : 's'}`,
    );
    pages.push({
      file: 'schemas.md',
      title: 'Schemas',
      body: [
        '# Schemas',
        '',
        ...spec.schemas.map((m) =>
          [
            `## ${m.name}`,
            '',
            ...(m.description ? [m.description.trim(), ''] : []),
            `Type: \`${typeName(m.schema) || 'object'}\``,
            '',
            modelSection(m.schema),
          ].join('\n'),
        ),
      ].join('\n'),
    });
  }
  pages.unshift({ file: 'index.md', title: spec.title, body: index.join('\n') });
  // Folder files for tags that slug to the same name get a numeric suffix.
  const seen = new Map<string, number>();
  for (const page of pages) {
    const n = seen.get(page.file) || 0;
    seen.set(page.file, n + 1);
    if (n) page.file = page.file.replace(/\.md$/, `-${n + 1}.md`);
  }
  return pages;
}

export function wrapGenerated(source: string, body: string): string {
  const content = body.trim();
  return `<!-- wiki-studio:generated source="${source.replace(/"/g, '%22')}" hash="${contentHash(content)}" -->\n${content}\n<!-- /wiki-studio:generated -->`;
}

export interface GeneratedPart {
  source: string;
  hash: string;
  start: number;
  end: number;
  content: string;
}
export function findGenerated(text: string): GeneratedPart | undefined {
  const start = START.exec(text);
  if (!start) return undefined;
  const rest = text.slice(start.index + start[0].length);
  const end = END.exec(rest);
  if (!end) return undefined;
  const closeEnd = start.index + start[0].length + end.index + end[0].length;
  return {
    source: start[1],
    hash: start[2],
    start: start.index,
    end: closeEnd,
    content: rest.slice(0, end.index),
  };
}

export type RegenerationPlan =
  | { action: 'create'; text: string }
  | { action: 'unchanged' }
  | { action: 'update'; text: string }
  /** The generated part was edited by hand; `text` is what replacing it would produce. */
  | { action: 'conflict'; text: string }
  /** The file exists without markers (written by hand); it is never replaced. */
  | { action: 'unmanaged' };

export function planRegeneration(
  existing: string | undefined,
  source: string,
  body: string,
): RegenerationPlan {
  const block = wrapGenerated(source, body);
  if (existing === undefined) return { action: 'create', text: `${block}\n` };
  const part = findGenerated(existing);
  if (!part) return { action: 'unmanaged' };
  const text = existing.slice(0, part.start) + block + existing.slice(part.end);
  if (contentHash(part.content) !== part.hash) return { action: 'conflict', text };
  return text === existing ? { action: 'unchanged' } : { action: 'update', text };
}

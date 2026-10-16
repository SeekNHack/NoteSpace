/**
 * NoteSpace MCP server (stdio). Started by an MCP client, never by NoteSpace itself;
 * it opens no network port. It serves one wiki: `node mcp-server.js --wiki <folder> [--allow-write]`.
 *
 * Tools: list_pages, read_page, search_pages, get_backlinks, and — only with --allow-write —
 * write_page, which refuses paths outside the content root, non-Markdown files, hidden folders,
 * symlinks and stale overwrites (the caller must pass the sha256 of the text it read).
 */
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { parsePage } from './core/markdown';
import { WikiIndex } from './core/index';
import { parseConfig } from './core/config';
import { insidePath, posix } from './core/paths';
import { Page } from './core/model';

const VERSION = '1.6.0';
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const allowWrite = flag('--allow-write');
const MAX_PAGE = 1024 * 1024;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function contentRoot(): Promise<{ root: string; title: string }> {
  const given = option('--wiki');
  if (!given) throw new Error('Usage: mcp-server.js --wiki <wiki folder> [--allow-write]');
  // The native realpath matches fs.realpath below (the JS one keeps Windows 8.3 short names).
  const base = realpathSync.native(path.resolve(given));
  try {
    const config = parseConfig(await fs.readFile(path.join(base, 'wiki.yaml'), 'utf8'));
    return {
      root: realpathSync.native(path.join(base, config.content.root)),
      title: config.wiki.title,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return { root: base, title: path.basename(base) };
    throw e;
  }
}

let wiki: { root: string; title: string };
const cache = new Map<string, { mtime: number; page: Page }>();
const index = new WikiIndex();

async function walk(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink())
      continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), child)));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(child);
    if (out.length > 20000) break;
  }
  return out;
}

/** Re-reads only files whose modification time changed since the last call. */
async function refresh(): Promise<void> {
  const files = await walk(wiki.root);
  const seen = new Set(files);
  for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key);
  for (const file of files) {
    const full = path.join(wiki.root, file);
    const stat = await fs.stat(full);
    if (stat.size > MAX_PAGE) continue;
    const cached = cache.get(file);
    if (cached && cached.mtime === stat.mtimeMs) continue;
    const text = await fs.readFile(full, 'utf8');
    cache.set(file, { mtime: stat.mtimeMs, page: parsePage('wiki', file, `file://${full}`, text) });
  }
  index.replace([...cache.values()].map((c) => c.page));
}

class InvalidParams extends Error {}
type Schema = {
  type: 'object';
  properties: Record<
    string,
    { type: string; description: string; maxLength?: number; minimum?: number; maximum?: number }
  >;
  required?: string[];
  additionalProperties: false;
};
function validate(schema: Schema, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new InvalidParams('Arguments must be an object.');
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value))
    if (!schema.properties[key]) throw new InvalidParams(`Unknown argument “${key}”.`);
  for (const key of schema.required || [])
    if (value[key] === undefined) throw new InvalidParams(`Missing argument “${key}”.`);
  for (const [key, rule] of Object.entries(schema.properties)) {
    const v = value[key];
    if (v === undefined) continue;
    if (
      rule.type === 'string' &&
      (typeof v !== 'string' || (rule.maxLength && v.length > rule.maxLength))
    )
      throw new InvalidParams(
        `“${key}” must be a string${rule.maxLength ? ` of at most ${rule.maxLength} characters` : ''}.`,
      );
    if (
      rule.type === 'integer' &&
      (!Number.isInteger(v) ||
        (rule.minimum !== undefined && (v as number) < rule.minimum) ||
        (rule.maximum !== undefined && (v as number) > rule.maximum))
    )
      throw new InvalidParams(
        `“${key}” must be an integer between ${rule.minimum} and ${rule.maximum}.`,
      );
  }
  return value;
}

/** A page path from a client: relative, inside the content root, Markdown, no hidden parts. */
function safePagePath(raw: string): string {
  const normalized = posix.normalize(raw.replace(/\\/g, '/').replace(/^\.\//, ''));
  if (
    !normalized ||
    normalized.startsWith('/') ||
    !insidePath(normalized) ||
    /[\x00-\x1f]/.test(normalized)
  )
    throw new InvalidParams('The path must be relative to the wiki and stay inside it.');
  if (normalized.split('/').some((part) => part.startsWith('.')))
    throw new InvalidParams('Hidden files and folders are not accessible.');
  if (!/\.md$/i.test(normalized))
    throw new InvalidParams('Only Markdown pages (.md) are accessible.');
  return normalized;
}
/** `child` is `root` or inside it (case-insensitive on Windows, like its file system). */
function within(child: string, root: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const c = fold(child);
  const r = fold(root);
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}
async function assertInside(full: string): Promise<void> {
  // Resolve the deepest existing ancestor so symlinked folders cannot escape the wiki.
  let probe = full;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (!within(real, wiki.root))
        throw new InvalidParams('The path leaves the wiki through a symbolic link.');
      if (probe === full && (await fs.lstat(full)).isSymbolicLink())
        throw new InvalidParams('Symbolic links are not accessible.');
      return;
    } catch (e) {
      if (e instanceof InvalidParams) throw e;
      const parent = path.dirname(probe);
      if (parent === probe) throw e;
      probe = parent;
    }
  }
}

const str = (description: string, maxLength = 1000) => ({ type: 'string', description, maxLength });
const tools: Array<{
  name: string;
  description: string;
  inputSchema: Schema;
  write?: boolean;
  run: (a: Record<string, unknown>) => Promise<unknown>;
}> = [
  {
    name: 'list_pages',
    description: 'List wiki pages (path, title, tags). Optional folder prefix.',
    inputSchema: {
      type: 'object',
      properties: { prefix: str('Folder prefix, for example guide/') },
      additionalProperties: false,
    },
    run: async (a) =>
      index
        .all()
        .filter((p) => !a.prefix || p.path.startsWith(String(a.prefix)))
        .map((p) => ({
          path: p.path,
          title: p.title,
          tags: p.tags,
          ...(p.draft ? { draft: true } : {}),
        })),
  },
  {
    name: 'read_page',
    description: 'Read a page as Markdown. Returns its text and sha256 (needed to update it).',
    inputSchema: {
      type: 'object',
      properties: { path: str('Page path relative to the wiki, for example guide/setup.md') },
      required: ['path'],
      additionalProperties: false,
    },
    run: async (a) => {
      const file = safePagePath(String(a.path));
      const full = path.join(wiki.root, file);
      await assertInside(full);
      const text = await fs.readFile(full, 'utf8').catch(() => {
        throw new InvalidParams(`No page at ${file}.`);
      });
      return { path: file, sha256: sha256(text), text };
    },
  },
  {
    name: 'search_pages',
    description:
      'Full-text search. Every word must match; #tag filters by tag. Returns the best section of each page.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Words and #tags', 500),
        limit: { type: 'integer', description: 'Maximum results (1–50)', minimum: 1, maximum: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: async (a) =>
      index
        .search(String(a.query))
        .slice(0, Number(a.limit || 20))
        .map((r) => ({
          path: r.page.path,
          title: r.page.title,
          section: r.heading?.text,
          excerpt: r.excerpt,
        })),
  },
  {
    name: 'get_backlinks',
    description: 'Pages that link to a page.',
    inputSchema: {
      type: 'object',
      properties: { path: str('Page path') },
      required: ['path'],
      additionalProperties: false,
    },
    run: async (a) => {
      const file = safePagePath(String(a.path));
      const page = index.all().find((p) => p.path === file);
      if (!page) throw new InvalidParams(`No page at ${file}.`);
      return [
        ...new Map(
          index
            .backlinks(page)
            .map((b) => [b.page.path, { path: b.page.path, title: b.page.title }]),
        ).values(),
      ];
    },
  },
  {
    name: 'write_page',
    description:
      'Create a page, or replace one you read first (pass its sha256 to avoid overwriting newer edits). Only available when the server was started with --allow-write.',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: str('Page path relative to the wiki (.md)'),
        content: str('Full Markdown text', MAX_PAGE),
        expected_sha256: str('sha256 from read_page; required when the page exists', 64),
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    run: async (a) => {
      const file = safePagePath(String(a.path));
      const full = path.join(wiki.root, file);
      await assertInside(full);
      const current = await fs.readFile(full, 'utf8').catch(() => undefined);
      if (current !== undefined && a.expected_sha256 !== sha256(current))
        throw new InvalidParams(
          current !== undefined && !a.expected_sha256
            ? 'The page exists: read it first and pass expected_sha256.'
            : 'The page changed since it was read; read it again.',
        );
      await fs.mkdir(path.dirname(full), { recursive: true });
      await assertInside(path.dirname(full));
      const temp = `${full}.notespace-${process.pid}.tmp`;
      await fs.writeFile(temp, String(a.content), { flag: 'wx' });
      await fs.rename(temp, full);
      return { path: file, created: current === undefined, sha256: sha256(String(a.content)) };
    },
  },
];

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
type Request = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

async function handle(request: Request): Promise<void> {
  const reply = (result: unknown) =>
    request.id !== undefined && send({ jsonrpc: '2.0', id: request.id, result });
  const fail = (code: number, message: string) =>
    request.id !== undefined && send({ jsonrpc: '2.0', id: request.id, error: { code, message } });
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string')
    return void fail(-32600, 'Invalid request.');
  switch (request.method) {
    case 'initialize':
      return void reply({
        protocolVersion:
          typeof request.params?.protocolVersion === 'string'
            ? request.params.protocolVersion
            : '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'notespace', version: VERSION },
        instructions: `Wiki “${wiki.title}”. Pages are Markdown files; paths are relative to the wiki.${allowWrite ? '' : ' This server is read-only.'}`,
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;
    case 'ping':
      return void reply({});
    case 'tools/list':
      return void reply({
        tools: tools
          .filter((t) => !t.write || allowWrite)
          .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === request.params?.name && (!t.write || allowWrite));
      if (!tool) return void fail(-32602, `Unknown tool: ${String(request.params?.name)}`);
      try {
        const input = validate(tool.inputSchema, request.params?.arguments ?? {});
        await refresh();
        const result = await tool.run(input);
        return void reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        if (e instanceof InvalidParams)
          return void reply({ content: [{ type: 'text', text: e.message }], isError: true });
        return void reply({
          content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        });
      }
    }
    default:
      return void fail(-32601, `Method not found: ${request.method}`);
  }
}

async function main() {
  wiki = await contentRoot();
  let queue = Promise.resolve();
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let request: Request;
    try {
      request = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
      return;
    }
    // Requests run one at a time so a write is never interleaved with another call.
    queue = queue
      .then(() => handle(request))
      .catch((e) => void process.stderr.write(`${String(e)}\n`));
  });
}
main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

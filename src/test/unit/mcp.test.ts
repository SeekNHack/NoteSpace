import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function server(wiki: string, write = false) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/mcp-server.ts', '--wiki', wiki, ...(write ? ['--allow-write'] : [])],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const waiting = new Map<number, (v: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let id = 0;
  const call = (method: string, params?: unknown) =>
    new Promise<Record<string, any>>((resolve) => {
      const n = ++id;
      waiting.set(n, resolve as never);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  const tool = async (name: string, args: unknown) => {
    const r = await call('tools/call', { name, arguments: args });
    const text = r.result.content[0].text as string;
    return {
      error: !!r.result.isError,
      text,
      json: r.result.isError ? undefined : JSON.parse(text),
    };
  };
  return { call, tool, close: () => child.kill() };
}

test('MCP stdio server reads, searches and writes a wiki safely', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wiki-mcp-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wiki-mcp-outside-'));
  try {
    await writeFile(
      path.join(dir, 'wiki.yaml'),
      'schemaVersion: 1\nwiki:\n  title: MCP Docs\ncontent:\n  root: docs\n',
    );
    await mkdir(path.join(dir, 'docs/guide'), { recursive: true });
    await writeFile(path.join(dir, 'docs/index.md'), '# Home\n\nSee [[Setup]].\n');
    await writeFile(
      path.join(dir, 'docs/guide/Setup.md'),
      '---\ntags: [ops]\n---\n# Setup\n\n## Docker\n\nRun compose up.\n',
    );
    await writeFile(path.join(dir, 'secret.md'), 'outside the content root');
    await writeFile(path.join(outside, 'x.md'), 'outside');
    await symlink(outside, path.join(dir, 'docs/linked'));
    const ro = await server(dir);
    const init = await ro.call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
    assert.equal(init.result.serverInfo.name, 'notespace');
    assert.match(init.result.instructions, /read-only/);
    const list = await ro.call('tools/list');
    assert.deepEqual(
      list.result.tools.map((t: { name: string }) => t.name),
      ['list_pages', 'read_page', 'search_pages', 'get_backlinks'],
    );
    assert.deepEqual(
      (await ro.tool('list_pages', {})).json.map((p: { path: string }) => p.path),
      ['guide/Setup.md', 'index.md'],
    );
    const read = await ro.tool('read_page', { path: 'guide/Setup.md' });
    assert.match(read.json.text, /Run compose up/);
    const search = await ro.tool('search_pages', { query: 'compose #ops' });
    assert.deepEqual(search.json, [
      { path: 'guide/Setup.md', title: 'Setup', section: 'Docker', excerpt: 'Run compose up.' },
    ]);
    assert.deepEqual((await ro.tool('get_backlinks', { path: 'guide/Setup.md' })).json, [
      { path: 'index.md', title: 'Home' },
    ]);
    for (const bad of [
      '../secret.md',
      '/etc/passwd.md',
      '.obsidian/x.md',
      'guide/Setup.txt',
      'linked/x.md',
    ])
      assert.equal((await ro.tool('read_page', { path: bad })).error, true, bad);
    assert.equal(
      (await ro.tool('read_page', { path: 'x.md', extra: 1 })).error,
      true,
      'unknown arguments are rejected',
    );
    assert.equal(
      (await ro.tool('search_pages', { query: 'x', limit: 500 })).error,
      true,
      'limits are validated',
    );
    assert.equal(
      (
        await ro.call('tools/call', {
          name: 'write_page',
          arguments: { path: 'a.md', content: 'x' },
        })
      ).error.code,
      -32602,
      'no write tool without --allow-write',
    );
    assert.equal((await ro.call('nope')).error.code, -32601);
    ro.close();

    const rw = await server(dir, true);
    await rw.call('initialize', {});
    assert.ok(
      (await rw.call('tools/list')).result.tools.some(
        (t: { name: string }) => t.name === 'write_page',
      ),
    );
    const created = await rw.tool('write_page', { path: 'guide/New.md', content: '# New\n' });
    assert.equal(created.json.created, true);
    assert.equal(await readFile(path.join(dir, 'docs/guide/New.md'), 'utf8'), '# New\n');
    assert.match(
      (await rw.tool('write_page', { path: 'guide/Setup.md', content: 'x' })).text,
      /read it first/,
    );
    assert.match(
      (
        await rw.tool('write_page', {
          path: 'guide/Setup.md',
          content: 'x',
          expected_sha256: 'f'.repeat(64),
        })
      ).text,
      /changed since/,
    );
    const sha = createHash('sha256').update(read.json.text).digest('hex');
    assert.equal(
      (
        await rw.tool('write_page', {
          path: 'guide/Setup.md',
          content: '# Setup v2\n',
          expected_sha256: sha,
        })
      ).error,
      false,
    );
    assert.equal(await readFile(path.join(dir, 'docs/guide/Setup.md'), 'utf8'), '# Setup v2\n');
    assert.equal(
      (await rw.tool('write_page', { path: 'linked/evil.md', content: 'x' })).error,
      true,
      'symlinked folders cannot be written',
    );
    assert.equal((await rw.tool('write_page', { path: '../escape.md', content: 'x' })).error, true);
    assert.equal(await readFile(path.join(outside, 'x.md'), 'utf8'), 'outside');
    rw.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertNote, importReport, planVaultImport, vaultResolver } from '../../core/obsidian';
import { parseReview, reanchor, REVIEW_SCHEMA, serializeReview } from '../../core/review';
import { withFrontMatter } from '../../core/frontmatter';

test('Obsidian notes convert embeds, callouts, comments and block links', () => {
  const resolve = vaultResolver([
    'notes/Daily.md',
    'Projects/Plan.md',
    'assets/pic one.png',
    'deep/x/Plan.md',
  ]);
  const note = convertNote(
    {
      path: 'notes/Daily.md',
      text: [
        '---',
        'aliases: [today]',
        '---',
        '# Daily',
        '![[pic one.png|300]] and ![[pic one.png|A photo]]',
        '![[Plan]]',
        'See [[Plan#^abc123|the plan]] and [[Plan#Goals]] %%private note%%',
        '> [!WARNING]- Careful',
        '> Body with ==highlight==',
        '> ![[pic one.png]]',
        'After',
        '```dataview',
        'TABLE file.name',
        '```',
        '> [!custom]',
        '> x',
      ].join('\n'),
    },
    resolve,
  );
  assert.equal(
    note.text,
    [
      '---',
      'aliases: [today]',
      '---',
      '# Daily',
      '![pic one](../assets/pic%20one.png) and ![A photo](../assets/pic%20one.png)',
      '{{ include "../Projects/Plan.md" }}',
      'See [[Plan|the plan]] and [[Plan#Goals]] <!--private note-->',
      ':::warning "Careful" collapsed',
      'Body with ==highlight==',
      '![pic one](../assets/pic%20one.png)',
      ':::',
      'After',
      '```dataview',
      'TABLE file.name',
      '```',
      ':::note',
      'x',
      ':::',
    ].join('\n'),
  );
  assert.ok(note.warnings.some((w) => /Dataview/.test(w)));
  assert.ok(note.warnings.some((w) => /size “300”/.test(w)));
  assert.ok(note.warnings.some((w) => /“custom” became a note/.test(w)));
  assert.ok(note.changes.includes('callouts converted: 2'));
  // Shortest path wins for duplicate names, as in Obsidian.
  assert.equal(resolve('Plan'), 'Projects/Plan.md');
  const plan = planVaultImport(
    [{ path: 'a.md', text: '![[missing.png]]' }],
    ['img.png', 'tool.exe'],
  );
  assert.deepEqual(plan.attachments, ['img.png']);
  assert.match(
    plan.warnings.join('\n'),
    /missing\.png.*could not be resolved[\s\S]*tool\.exe: not copied/,
  );
  assert.match(importReport(plan, '/vault', '/wiki'), /Source vault: `\/vault` \(not modified\)/);
});

test('review files validate input and anchors follow moved lines', () => {
  const file = {
    schema: REVIEW_SCHEMA,
    page: 'a.md',
    threads: [
      {
        id: 't1',
        status: 'open',
        anchor: { line: 2, quote: 'Target line' },
        comments: [{ id: 'c1', author: 'Ann', created: '2026-01-01T00:00:00Z', body: 'Fix?' }],
      },
      { id: 'bad', anchor: { line: 'x' }, comments: [] },
    ],
  };
  const parsed = parseReview(JSON.stringify(file), 'a.md');
  assert.equal(parsed.threads.length, 1, 'malformed threads are dropped');
  assert.equal(parseReview(serializeReview(parsed), 'a.md').threads[0].comments[0].body, 'Fix?');
  assert.throws(
    () => parseReview('{"schema":"other","threads":[]}', 'a.md'),
    /Not a notespace.review\/1/,
  );
  assert.throws(() => parseReview('nope', 'a.md'), /Invalid review file/);
  assert.deepEqual(
    reanchor({ line: 2, quote: 'Target line' }, ['new', 'lines', 'here', 'Target line']),
    { line: 3, found: true },
  );
  assert.deepEqual(reanchor({ line: 9, quote: 'gone' }, ['a', 'b']), { line: 1, found: false });
});

test('front matter edits keep comments, other keys, BOM and CRLF', () => {
  assert.equal(
    withFrontMatter('# A\n', { translated_from: 'abc' }),
    '---\ntranslated_from: abc\n---\n# A\n',
  );
  assert.equal(
    withFrontMatter('﻿---\r\ntitle: A # keep\r\n---\r\nBody', { translated_from: 'x' }),
    '﻿---\r\ntitle: A # keep\r\ntranslated_from: x\r\n---\r\nBody',
  );
  assert.equal(withFrontMatter('---\na: 1\n---\nB', { a: null }), 'B');
  assert.throws(() => withFrontMatter('---\na: [\n---\nB', { b: 1 }), /front matter first/);
});

test('credential-like values are redacted before text reaches a model', async () => {
  const { redactSecrets } = await import('../../core/redact');
  const input = [
    'password: hunter2secret',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    'aws AKIAABCDEFGHIJKLMNOP',
    'token ghp_' + 'a'.repeat(36),
    'key sk-proj-' + 'b'.repeat(30),
    'db postgres://admin:s3cretpw@db.example.com/x',
    '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    'Normal text about passwords and tokens stays.',
  ].join('\n');
  const { text, count } = redactSecrets(input);
  assert.equal(count, 7);
  for (const secret of [
    'hunter2secret',
    'abcdefghijklmnopqrstuvwxyz123456',
    'AKIAABCDEFGHIJKLMNOP',
    'ghp_',
    'sk-proj-',
    's3cretpw',
    'BEGIN RSA PRIVATE KEY-----\nabc',
  ])
    assert.ok(!text.includes(secret), secret);
  assert.match(text, /password: \[REDACTED\]/);
  assert.match(text, /postgres:\/\/admin:\[REDACTED\]@db/);
  assert.match(text, /Normal text about passwords and tokens stays\./);
});

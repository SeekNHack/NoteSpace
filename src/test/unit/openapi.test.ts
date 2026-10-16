import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, exampleFor, parseOpenApi, renderApiReference } from '../../core/openapi';

const yaml = `openapi: 3.0.3
info:
  title: Pets <API>
  version: 1.2.0
servers:
  - url: https://api.example.com/v1
security:
  - token: []
paths:
  /pets/{petId}:
    parameters:
      - $ref: '#/components/parameters/PetId'
    get:
      operationId: getPet
      tags: [Pets]
      summary: Get a pet
      parameters:
        - name: verbose
          in: query
          schema: { type: boolean }
      responses:
        '200':
          description: The pet
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
  /pets:
    post:
      tags: [Pets]
      security: [{ key: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
      responses:
        '201': { description: Created }
components:
  parameters:
    PetId: { name: petId, in: path, schema: { type: string } }
  schemas:
    Pet:
      type: object
      properties:
        name: { type: string, example: Rex }
        age: { type: integer, minimum: 1 }
        parent: { $ref: '#/components/schemas/Pet' }
  securitySchemes:
    token: { type: http, scheme: bearer }
    key: { type: apiKey, in: header, name: X-API-Key }
`;

test('OpenAPI 3 documents parse with local $refs, recursion guards and security', () => {
  const spec = parseOpenApi(yaml);
  assert.equal(spec.title, 'Pets <API>');
  assert.equal(spec.operations.length, 2);
  const get = spec.operations.find((o) => o.id === 'getPet')!;
  assert.deepEqual(
    get.parameters.map((p) => [p.name, p.in, p.required]),
    [
      ['petId', 'path', true],
      ['verbose', 'query', false],
    ],
  );
  assert.deepEqual(get.security, ['token']);
  const example = get.responses[0].example as Record<string, unknown>;
  assert.equal(example.name, 'Rex');
  assert.equal(example.age, 1);
  const post = spec.operations.find((o) => o.method === 'POST')!;
  assert.deepEqual(post.security, ['key']);
  assert.equal(post.requestBody?.required, true);
  assert.throws(() => parseOpenApi('swagger: "2.0"'), /Only OpenAPI 3/);
  assert.throws(() => parseOpenApi('{bad'), /Invalid OpenAPI document/);
  assert.deepEqual(exampleFor({ type: 'array', items: { type: 'string', format: 'date' } }), [
    '2026-01-01',
  ]);
});

test('requests encode path parameters and apply credentials by scheme', () => {
  const spec = parseOpenApi(yaml);
  const get = spec.operations.find((o) => o.id === 'getPet')!;
  const request = buildRequest(
    get,
    {
      server: 'https://api.example.com/v1/',
      path: { petId: 'a/b c' },
      query: { verbose: 'true' },
      headers: {},
    },
    [{ scheme: spec.schemes.find((s) => s.name === 'token')!, value: 'secret-token' }],
  );
  assert.equal(request.url, 'https://api.example.com/v1/pets/a%2Fb%20c?verbose=true');
  assert.equal(request.headers.Authorization, 'Bearer secret-token');
  assert.equal(request.body, undefined);
  const post = spec.operations.find((o) => o.method === 'POST')!;
  const created = buildRequest(
    post,
    {
      server: 'http://localhost:1',
      path: {},
      query: {},
      headers: { 'bad header': 'x' },
      body: '{"name":"Rex"}',
    },
    [{ scheme: spec.schemes.find((s) => s.name === 'key')!, value: 'k' }],
  );
  assert.deepEqual(created.headers, { 'X-API-Key': 'k', 'Content-Type': 'application/json' });
  assert.throws(
    () => buildRequest(get, { server: 'https://x', path: {}, query: {}, headers: {} }),
    /petId/,
  );
  assert.throws(
    () => buildRequest(post, { server: 'file:///etc', path: {}, query: {}, headers: {} }),
    /http\(s\)/,
  );
});

test('the static reference escapes content and contains no credentials', () => {
  const html = renderApiReference(parseOpenApi(yaml), (md) => md);
  assert.match(html, /Pets &lt;API&gt;/);
  assert.match(html, /<span class="api-method m-get">GET<\/span> <code>\/pets\/\{petId\}<\/code>/);
  assert.match(html, /&quot;name&quot;: &quot;Rex&quot;/);
  assert.doesNotMatch(html, /secret|Bearer /);
});

test('schemas, response models, auth and curl samples are part of the reference', async () => {
  const { curlSample, schemaRows, typeName } = await import('../../core/openapi');
  const spec = parseOpenApi(yaml);
  assert.deepEqual(
    spec.schemas.map((s) => s.name),
    ['Pet'],
  );
  const get = spec.operations.find((o) => o.id === 'getPet')!;
  assert.equal(get.responses[0].schemaName, 'Pet');
  assert.ok(schemaRows(get.responses[0].schema!).some((r) => r.name === 'name'));
  assert.equal(
    typeName({ type: 'array', items: { type: 'string', format: 'uuid' } }),
    'string (uuid)[]',
  );
  assert.equal(typeName({ oneOf: [{ type: 'string' }, { type: 'integer' }] }), 'string | integer');
  const curl = curlSample(spec, get);
  assert.match(curl, /^curl -X GET 'https:\/\/api\.example\.com\/v1\/pets\/%7BpetId%7D'/);
  assert.ok(!/sk-|secret/i.test(curl), 'credentials are placeholders');
  const html = renderApiReference(
    spec,
    (md) => md,
    (lang, code) => `<b data-lang="${lang}">${code.length}</b>`,
  );
  assert.match(html, /<h3>Schemas<\/h3>/);
  assert.match(html, /id="schema-Pet"/);
  assert.match(html, /href="#schema-Pet">Pet<\/a>/);
  assert.match(html, /<h3>Authentication<\/h3>/);
  assert.match(html, /data-lang="bash"/, 'curl samples go through the highlighter');
});

test('generated reference pages keep manual edits and report conflicts', async () => {
  const { generateApiPages, planRegeneration, findGenerated } =
    await import('../../core/api-pages');
  const spec = parseOpenApi(yaml);
  const pages = generateApiPages(spec);
  assert.deepEqual(
    pages.map((p) => p.file),
    ['index.md', 'pets.md', 'schemas.md'],
  );
  const pets = pages.find((p) => p.file === 'pets.md')!;
  assert.match(pets.body, /^### GET `\/pets\/\{petId\}` — Get a pet$/m);
  assert.match(pets.body, /\| `verbose` \| query \| `boolean` \|/);
  assert.match(pets.body, /model \[`Pet`\]\(schemas\.md#pet\)/);
  assert.match(pets.body, /```bash\ncurl -X GET/);
  const created = planRegeneration(undefined, '../pets.yaml', pets.body);
  assert.equal(created.action, 'create');
  const text = (created as { text: string }).text;
  assert.equal(findGenerated(text)?.source, '../pets.yaml');
  // Notes outside the markers survive regeneration.
  const withNotes = `---\nowner: api-team\n---\n${text}\n## Notes\n\nKeep this.\n`;
  assert.equal(planRegeneration(withNotes, '../pets.yaml', pets.body).action, 'unchanged');
  const changed = planRegeneration(
    withNotes,
    '../pets.yaml',
    pets.body.replace('Get a pet', 'Fetch a pet'),
  );
  assert.equal(changed.action, 'update');
  const updated = (changed as { text: string }).text;
  assert.match(updated, /Fetch a pet/);
  assert.match(updated, /^owner: api-team$/m);
  assert.match(updated, /## Notes\n\nKeep this\.\n$/);
  // Editing inside the generated part is a conflict; CRLF line endings are not an edit.
  const edited = withNotes.replace('Get a pet', 'Get one pet (edited)');
  const conflict = planRegeneration(edited, '../pets.yaml', pets.body);
  assert.equal(conflict.action, 'conflict');
  assert.match((conflict as { text: string }).text, /Get a pet/);
  assert.equal(
    planRegeneration(withNotes.replace(/\n/g, '\r\n'), '../pets.yaml', pets.body).action,
    'update',
  );
  assert.equal(planRegeneration('# Hand written\n', '../pets.yaml', pets.body).action, 'unmanaged');
});

test('playground targets: metadata services are refused, local networks are recognised', async () => {
  const { classifyAddress, classifyHost, changesData, worstKind } =
    await import('../../core/net-safety');
  assert.equal(classifyHost('169.254.169.254'), 'metadata');
  assert.equal(classifyHost('metadata.google.internal'), 'metadata');
  assert.equal(classifyHost('localhost'), 'loopback');
  assert.equal(classifyHost('api.localhost'), 'loopback');
  assert.equal(classifyHost('127.0.0.1'), 'loopback');
  assert.equal(classifyHost('[::1]'), 'loopback');
  assert.equal(classifyHost('printer.local'), 'private');
  assert.equal(classifyAddress('10.1.2.3'), 'private');
  assert.equal(classifyAddress('172.20.0.1'), 'private');
  assert.equal(classifyAddress('172.32.0.1'), 'public');
  assert.equal(classifyAddress('192.168.1.10'), 'private');
  assert.equal(classifyAddress('::ffff:192.168.1.10'), 'private');
  assert.equal(classifyAddress('fd12:3456::1'), 'private');
  assert.equal(classifyAddress('fe80::1'), 'link-local');
  assert.equal(classifyAddress('169.254.10.1'), 'link-local');
  assert.equal(classifyAddress('93.184.216.34'), 'public');
  assert.equal(worstKind(['public', 'private', 'loopback']), 'private');
  assert.deepEqual(['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE', 'patch'].map(changesData), [
    false,
    false,
    false,
    true,
    true,
    true,
  ]);
});

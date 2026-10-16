import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonPath, runTests, checkSchema } from '../../core/http/tests';
import { prettyXml } from '../../core/http/format';
import {
  buildCollection,
  bundleCollection,
  parseEnvironment,
  readBundle,
  serializeEnvironment,
  serializeRequest,
  parseRequest,
  walkRequests,
} from '../../core/http/collection';
import { parseHttpBlock, serializeHttpBlock } from '../../core/http/http-block';
import { collectionFromOpenApi } from '../../core/http/openapi-import';
import { parseOpenApi } from '../../core/openapi';
import { emptyRequest, mergeVariables } from '../../core/http/model';

const response = {
  status: 201,
  headers: [
    ['content-type', 'application/json; charset=utf-8'],
    ['x-request-id', 'r-1'],
  ] as Array<[string, string]>,
  body: JSON.stringify({
    id: 7,
    user: { name: 'Mario' },
    items: [{ v: 'v12' }, { v: 'x' }],
    token: 'abc',
  }),
  ms: 42,
  size: 120,
};

test('assertions and extractions run without JavaScript', () => {
  const run = runTests(
    [
      '# comment',
      'status == 201',
      'status in 200..299',
      'time < 500',
      'header content-type contains json',
      'header x-missing exists',
      'json $.id exists',
      'json $.user.name == "Mario"',
      'json $.items.length >= 2',
      'json $.items[0].v matches ^v\\d+',
      'json $.nope not exists',
      'body contains mario',
      'set token = json $.token',
      'set rid = header x-request-id',
      'status = 200',
      'process.exit(1)',
    ].join('\n'),
    response,
  );
  assert.deepEqual(
    run.results.map((r) => r.pass),
    [true, true, true, true, false, true, true, true, true, true, true, true, true, false, false],
  );
  assert.match(run.results[4].message, /Missing/);
  assert.match(run.results[13].message, /Not understood/);
  assert.match(run.results[14].message, /Not understood/, 'no code is executed');
  assert.deepEqual(run.variables, { token: 'abc', rid: 'r-1' });
  assert.match(
    runTests('json $.id exists', { ...response, body: '<html>' }).results[0].message,
    /not JSON/,
  );
  assert.deepEqual(jsonPath({ a: [{ 'b-c': 1 }] }, "$.a[0]['b-c']"), { found: true, value: 1 });
  assert.throws(() => jsonPath({}, 'a.b'), /starts with \$/);
});

test('schema checks report the first differences', () => {
  const schema = {
    type: 'object',
    required: ['id', 'email'],
    properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
  };
  assert.deepEqual(checkSchema({ id: 'x', tags: ['a', 2] }, schema), [
    '$.email: required',
    '$.id: expected integer, got string',
    '$.tags[1]: expected string, got integer',
  ]);
  assert.equal(
    runTests('schema', response, { type: 'object', required: ['id'] }).results[0].pass,
    true,
  );
  assert.match(runTests('schema', response).results[0].message, /No response schema/);
});

test('collections are folders of readable files with order, ids and safe bundles', () => {
  const login = {
    ...emptyRequest('auth/login', 'Login'),
    method: 'POST' as const,
    url: '{{baseUrl}}/login',
    body: { type: 'json' as const, text: '{}' },
    tests: 'set token = json $.token',
  };
  const files = new Map([
    [
      'collection.json',
      JSON.stringify({
        schemaVersion: 1,
        name: 'My APIs',
        variables: [{ key: 'baseUrl', value: 'http://localhost' }],
        order: ['users', 'auth'],
      }),
    ],
    ['auth/folder.json', JSON.stringify({ name: 'Authentication', order: ['logout', 'login'] })],
    ['auth/login.request.json', serializeRequest(login)],
    [
      'auth/logout.request.json',
      serializeRequest({
        ...emptyRequest(),
        name: 'Logout',
        method: 'POST',
        url: '{{baseUrl}}/logout',
      }),
    ],
    [
      'users/get.request.json',
      serializeRequest({ ...emptyRequest(), name: 'Get users', url: '{{baseUrl}}/users' }),
    ],
    ['users/broken.request.json', '{nope'],
  ]);
  const c = buildCollection('my-apis', files);
  assert.equal(c.meta.name, 'My APIs');
  assert.deepEqual(
    c.items.map((i) => (i.kind === 'folder' ? i.name : i.request.name)),
    ['users', 'Authentication'],
  );
  const auth = c.items[1];
  assert.ok(auth.kind === 'folder');
  assert.deepEqual(
    auth.items.map((i) => i.path),
    ['auth/logout', 'auth/login'],
  );
  assert.deepEqual(
    [...walkRequests(c.items)].map((r) => r.id),
    ['users/get', 'auth/logout', 'auth/login'],
  );
  assert.match(c.problems[0], /users\/broken\.request\.json: Invalid JSON/);
  assert.deepEqual(
    parseRequest(serializeRequest(login), 'auth/login'),
    login,
    'requests round-trip',
  );
  assert.throws(() => parseRequest('{"schemaVersion": 99}', 'x'), /newer/);
  // Environments never write secret values.
  const env = parseEnvironment(
    '{"name":"Prod","variables":[{"key":"baseUrl","value":"https://api"},{"key":"token","value":"leak","secret":true}]}',
    'x',
  );
  assert.deepEqual(env.variables[1], { key: 'token', value: '', secret: true });
  assert.doesNotMatch(
    serializeEnvironment({
      ...env,
      variables: [...env.variables, { key: 'pw', value: 'p4ss', secret: true }],
    }),
    /p4ss|leak/,
  );
  // Bundles refuse unsafe paths.
  const bundle = bundleCollection(c.meta, files);
  assert.equal(readBundle(JSON.stringify(bundle)).meta.name, 'My APIs');
  assert.throws(
    () => readBundle(JSON.stringify({ ...bundle, files: { '../evil.request.json': '{}' } })),
    /Unsafe path/,
  );
  assert.throws(
    () => readBundle(JSON.stringify({ ...bundle, files: { 'run.sh': 'x' } })),
    /Unexpected file/,
  );
  assert.deepEqual(
    mergeVariables({
      global: { a: 'g', b: 'g' },
      collection: { b: 'c', c: 'c' },
      environment: { c: 'e' },
      runtime: { d: 'r' },
      request: { a: 'q' },
    }),
    { a: 'q', b: 'c', c: 'e', d: 'r' },
  );
});

test('```http blocks parse into requests and back', () => {
  const block = parseHttpBlock(
    '# @name Create user\n# @test status == 201\nPOST {{baseUrl}}/api/users\nContent-Type: application/json\nCookie: a=1; b=2\n\n{\n  "name": "Mario"\n}\n',
  );
  assert.equal(block.request.name, 'Create user');
  assert.equal(block.request.method, 'POST');
  assert.equal(block.request.url, '{{baseUrl}}/api/users');
  assert.deepEqual(block.request.headers, []);
  assert.deepEqual(block.request.cookies, [
    { key: 'a', value: '1' },
    { key: 'b', value: '2' },
  ]);
  assert.deepEqual(block.request.body, { type: 'json', text: '{\n  "name": "Mario"\n}' });
  assert.equal(block.request.tests, 'status == 201');
  assert.deepEqual(parseHttpBlock(serializeHttpBlock(block)).request, block.request);
  assert.equal(parseHttpBlock('https://x.example.com/health').request.method, 'GET');
  assert.equal(
    parseHttpBlock('GET https://x.example.com/a\n  ?q=1\n  &r=2').request.url,
    'https://x.example.com/a?q=1&r=2',
  );
  assert.deepEqual(
    parseHttpBlock('# @collection my-apis/users/get').collection,
    'my-apis/users/get',
  );
  assert.deepEqual(parseHttpBlock('collection: my-apis/users/get').collection, 'my-apis/users/get');
  assert.throws(() => parseHttpBlock('FETCH https://x'), /not a supported method/);
  assert.throws(() => parseHttpBlock('POST https://x\nnot a header'), /not a header/);
});

test('OpenAPI 3 becomes a collection with variables, auth placeholders and schema tests', () => {
  const spec = parseOpenApi(`openapi: 3.0.3
info: {title: Pets, version: "1"}
servers: [{url: "https://api.pets.example/v1"}]
components:
  securitySchemes:
    bearer: {type: http, scheme: bearer}
  schemas:
    Pet: {type: object, required: [id], properties: {id: {type: integer}, name: {type: string}}}
security: [{bearer: []}]
paths:
  /pets/{petId}:
    get:
      tags: [Pets]
      summary: Get a pet
      parameters:
        - {name: petId, in: path, required: true, schema: {type: integer}}
        - {name: verbose, in: query, schema: {type: boolean}, example: true}
      responses:
        "200": {description: ok, content: {application/json: {schema: {$ref: "#/components/schemas/Pet"}}}}
  /pets:
    post:
      tags: [Pets]
      summary: Create a pet
      requestBody: {content: {application/json: {schema: {$ref: "#/components/schemas/Pet"}, example: {id: 1, name: Rex}}}}
      responses: {"201": {description: created}}
`);
  const preview = collectionFromOpenApi(spec);
  assert.deepEqual(
    preview.requests.map((r) => `${r.method} ${r.url}`),
    ['GET {{baseUrl}}/pets/{{petId}}', 'POST {{baseUrl}}/pets'],
  );
  const c = buildCollection('pets', preview.files);
  assert.equal(c.meta.variables[0].value, 'https://api.pets.example/v1');
  const [get, post] = [...walkRequests(c.items)];
  assert.deepEqual(get.auth, { type: 'bearer', token: '{{accessToken}}' });
  assert.deepEqual(get.params, [{ key: 'verbose', value: 'true', enabled: false }]);
  assert.equal(get.tests, 'status == 200\nschema');
  assert.deepEqual(get.responseSchema?.required, ['id']);
  assert.deepEqual(JSON.parse(post.body.text!), { id: 1, name: 'Rex' });
  assert.equal(post.tests, 'status == 201');
  assert.deepEqual(c.problems, []);
});

test('prettyXml indents nested elements and keeps text, comments and malformed input', () => {
  assert.equal(
    prettyXml(
      '<?xml version="1.0"?><users><!-- all --><user id="1"><name>Mario</name><tags/></user></users>',
    ),
    '<?xml version="1.0"?>\n<users>\n  <!-- all -->\n  <user id="1">\n    <name>Mario</name>\n    <tags/>\n  </user>\n</users>',
  );
  assert.equal(prettyXml('<a><b></a>'), '<a><b></a>');
  assert.equal(prettyXml('plain'), 'plain');
});

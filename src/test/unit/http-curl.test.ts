import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCurl, tokenize } from '../../core/http/curl';
import { toCurl, toPython } from '../../core/http/codegen';
import { emptyRequest, redactUrl, resolveRequest } from '../../core/http/model';

const chrome = `curl 'https://api.example.com/v1/users?page=2&sort=name' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc.def' \\
  -H 'content-type: application/json' \\
  -b 'session=s3cr3t; theme=dark' \\
  --data-raw $'{"name":"Mario","bio":"It\\'s me"}' \\
  --compressed`;

test('curl from browser DevTools becomes an editable request', () => {
  const { request, warnings } = parseCurl(chrome);
  assert.equal(request.method, 'POST', 'data implies POST');
  assert.equal(request.url, 'https://api.example.com/v1/users');
  assert.deepEqual(request.params, [
    { key: 'page', value: '2' },
    { key: 'sort', value: 'name' },
  ]);
  assert.deepEqual(request.headers, [
    { key: 'accept', value: 'application/json' },
    { key: 'authorization', value: 'Bearer abc.def' },
  ]);
  assert.deepEqual(request.cookies, [
    { key: 'session', value: 's3cr3t' },
    { key: 'theme', value: 'dark' },
  ]);
  assert.equal(request.body.type, 'json');
  assert.deepEqual(JSON.parse(request.body.text!), { name: 'Mario', bio: "It's me" });
  assert.deepEqual(warnings, []);
});

test('curl options: methods, forms, files, auth, GET data, quoting and unsupported flags', () => {
  const form = parseCurl(
    `curl -X PUT "http://localhost:8080/items/1" -u admin:p@ss -d 'a=1&b=two%20words' -H "X-Trace: \\"x\\""`,
  ).request;
  assert.equal(form.method, 'PUT');
  assert.deepEqual(form.auth, { type: 'basic', username: 'admin', password: 'p@ss' });
  assert.deepEqual(form.body, {
    type: 'form',
    fields: [
      { key: 'a', value: '1' },
      { key: 'b', value: 'two words' },
    ],
  });
  assert.deepEqual(form.headers, [{ key: 'X-Trace', value: '"x"' }]);
  const multi = parseCurl(
    `curl https://up.example.com/files -F 'title=Report' -F 'file=@./report.pdf;type=application/pdf'`,
  ).request;
  assert.deepEqual(multi.body, {
    type: 'multipart',
    fields: [
      { key: 'title', value: 'Report' },
      { key: 'file', value: './report.pdf', file: true },
    ],
  });
  const get = parseCurl(
    `curl -G https://s.example.com/search --data-urlencode 'q=hello world' -d lang=it`,
  ).request;
  assert.equal(get.method, 'GET');
  assert.deepEqual(get.params, [
    { key: 'lang', value: 'it' },
    { key: 'q', value: 'hello world' },
  ]);
  const { warnings, request } = parseCurl(
    'curl -k -L --max-time 5 --proxy http://p:3128 https://x.example.com',
  );
  assert.equal(request.timeoutMs, 5000);
  assert.equal(request.followRedirects, true);
  assert.match(warnings.join('\n'), /certificates are always verified/);
  assert.match(warnings.join('\n'), /Proxy/);
  assert.equal(
    parseCurl('curl --request=DELETE --url=https://x.example.com/a').request.method,
    'DELETE',
  );
  assert.equal(parseCurl('curl -XPATCH https://x.example.com/a -d "{}"').request.method, 'PATCH');
  assert.deepEqual(tokenize("curl 'a b' \"c\\\"d\" e\\ f $'g\\nh'"), [
    'curl',
    'a b',
    'c"d',
    'e f',
    'g\nh',
  ]);
  assert.throws(() => parseCurl('wget https://x.example.com'), /starts with curl/);
  assert.throws(() => parseCurl("curl 'https://x"), /Unclosed/);
  assert.throws(() => parseCurl('curl -H "A: b"'), /no URL/);
});

test('Python requests: url, params, headers, cookies and body as dicts', () => {
  const code = toPython(parseCurl(chrome).request);
  assert.equal(
    code,
    `import requests

url = "https://api.example.com/v1/users"

params = {
    "page": "2",
    "sort": "name",
}

payload = {
    "name": "Mario",
    "bio": "It's me",
}

headers = {
    "accept": "application/json",
    "authorization": "Bearer abc.def",
}

cookies = {
    "session": "s3cr3t",
    "theme": "dark",
}

response = requests.post(
    url,
    params=params,
    json=payload,
    headers=headers,
    cookies=cookies,
    timeout=30,
)

print(response.status_code)
print(response.json())
`,
  );
  const basic = toPython(
    parseCurl(`curl -u bob:secret https://x.example.com/a -F f=@data.csv -F n=1`).request,
  );
  assert.match(basic, /auth=\("bob", "secret"\)/);
  assert.match(basic, /files = \{\n {4}"f": open\("data\.csv", "rb"\),\n\}/);
  assert.match(basic, /data = \{\n {4}"n": "1",\n\}/);
  const nested = toPython(
    {
      ...emptyRequest(),
      method: 'POST',
      url: '{{baseUrl}}/x',
      body: { type: 'json', text: '{"a":[1,true,null,{"b":"c"}]}' },
    },
    { baseUrl: 'https://h.example.com' },
  );
  assert.match(nested, /url = "https:\/\/h\.example\.com\/x"/);
  assert.match(nested, /"a": \[\n {8}1,\n {8}True,\n {8}None,/);
});

test('curl export round-trips through the importer', () => {
  const original = parseCurl(chrome).request;
  const again = parseCurl(toCurl(original)).request;
  assert.equal(again.method, original.method);
  assert.deepEqual(again.params, original.params);
  assert.deepEqual(JSON.parse(again.body.text!), JSON.parse(original.body.text!));
  assert.deepEqual(again.cookies, original.cookies);
});

test('requests resolve variables by precedence; secrets are redacted for history', () => {
  const req = {
    ...emptyRequest(),
    method: 'POST' as const,
    url: '{{baseUrl}}/api/{{apiVersion}}/users/{{userId}}',
    params: [
      { key: 'q', value: '{{query}}' },
      { key: 'off', value: 'x', enabled: false },
    ],
    headers: [{ key: 'X-Env', value: '{{env}}' }],
    body: { type: 'json' as const, text: '{"id": "{{userId}}"}' },
    auth: { type: 'bearer' as const, token: '{{accessToken}}' },
  };
  const r = resolveRequest(req, {
    baseUrl: 'https://api.example.com',
    apiVersion: 'v1',
    userId: '42',
    env: 'dev',
    accessToken: 't0k',
  });
  assert.equal(r.url, 'https://api.example.com/api/v1/users/42?q=%7B%7Bquery%7D%7D');
  assert.deepEqual(r.missing, ['query']);
  assert.deepEqual(r.headers, [
    ['X-Env', 'dev'],
    ['Authorization', 'Bearer t0k'],
    ['Content-Type', 'application/json'],
  ]);
  assert.deepEqual(r.body, { kind: 'text', text: '{"id": "42"}' });
  assert.throws(
    () => resolveRequest({ ...req, body: { type: 'json', text: '{bad' } }, {}),
    /JSON body is not valid/,
  );
  assert.throws(
    () => resolveRequest({ ...req, url: 'file:///etc/passwd' }, {}),
    /Only http and https/,
  );
  assert.equal(
    redactUrl('https://u:p@x.example.com/a?token=abc&page=2&api_key=k'),
    'https://***:***@x.example.com/a?token=***&page=2&api_key=***',
  );
});

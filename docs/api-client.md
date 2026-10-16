# API Client and interactive API documentation

NoteSpace includes an HTTP client (in the spirit of Postman, Bruno or Thunder Client) that keeps everything in your workspace: requests and collections are small JSON files you can review and commit, environments are files too, and secret values stay in VS Code's SecretStorage. Pages can contain ` ```http ` blocks that readers send from the documentation itself — only when they press **Send**.

Open it with **NoteSpace: Open API Client**, the **API** destination of the NoteSpace workspace (Alt+7) or **API Client** in the Workspace view.

## Requests

A request tab has the method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS), the URL and these sections:

| Section  | Contents                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Params   | Query parameters, kept in sync with the URL; each row can be turned off                                                                                                                                   |
| Auth     | None, inherit from the collection, API key (header or query), Basic, Bearer, OAuth 2.0 (client credentials, authorization code with PKCE)                                                                 |
| Headers  | Request headers, each row can be turned off                                                                                                                                                               |
| Body     | None, JSON (with formatting), text, XML, form URL-encoded, multipart (text fields and workspace files), binary (a workspace file)                                                                         |
| Cookies  | Cookies sent with the request (the `Cookie` header)                                                                                                                                                       |
| Tests    | Assertions and extractions, see [Tests and chaining](#tests-and-chaining)                                                                                                                                 |
| Settings | Timeout, following redirects                                                                                                                                                                              |
| Code     | The request as **curl** or **Python requests**: URL, `params`, `headers` and `cookies` dicts, `json=` / `data=` / `files=`, `auth=` and `timeout=`. `{{variables}}` stay as written; secrets never appear |

**Ctrl/Cmd+Enter** sends, **Ctrl/Cmd+S** saves, **Esc** cancels a running request, **Enter** in the URL sends. Tabs show unsaved changes with a dot; **Delete** closes the focused tab.

The response viewer shows status, time, size, headers, cookies and test results; the body pretty-printed (JSON and XML) or raw, HTML as source text (never rendered or run), images as images; search inside it, copy it or download it to a file you choose. Responses larger than `notespace.api.maxResponseMB` (10 MB) are truncated and marked as such.

## Paste a curl command

Paste a curl command (for example from the browser's _Copy as cURL_) in the API Client's import box, or run **NoteSpace: Import curl Command** with it in the clipboard. Every part becomes a field: method (`-X`, or POST when there is a body, `-I` for HEAD, `-G` to move data into the query), URL and query parameters, headers (`-H`), cookies (`-b`), body (`-d`, `--data-raw`, `--data-binary`, `--data-urlencode`, `--json`, `$'…'` strings, multipart `-F` with `@file`), Basic auth (`-u`), `-A` user agent, `-e` referer, `-m` timeout, `-L` redirects. Options NoteSpace does not apply are reported, never silently honoured: `-k/--insecure` (certificates are always verified) and `--proxy`.

Header values pasted this way (for example `Authorization: Bearer …`) are kept as written; the Headers and Cookies sections warn when a credential is a plain value, because saving would store it in the request file. Replace it with a secret environment variable such as `{{token}}` before saving a request you will commit.

## Collections

A collection is a folder under `api/` (setting `notespace.api.folder`) in the first workspace folder:

```text
api/
  my-apis/
    collection.json            name, description, variables, default auth, order
    authentication/
      folder.json              folder name and order
      login.request.json       one request
    get-users.request.json
  environments/
    local.env.json             variables; secret values are not in the file
```

Files carry `schemaVersion: 1` and contain only what you typed, sorted and indented for readable Git diffs. From the sidebar you can create, rename, duplicate, move between folders by dragging, reorder (**Move up/Move down** or dragging), delete (to the system Trash where available), search, run a whole collection or folder in order, and export or import a collection as one JSON bundle. Exports never contain secret values.

**Import OpenAPI as API Collection** (also on `.yaml`/`.json` files in the Explorer) previews the endpoints and creates one request per operation, grouped by tag, with `{{baseUrl}}`, path parameters as `{{variables}}`, example bodies, the security scheme as an auth placeholder and tests for the documented status and response schema.

## Environments and variables

`{{name}}` works in the URL, params, headers, cookies, body, auth and tests. Values are resolved from these scopes, the later winning:

1. **Global** variables (this workspace),
2. **Collection** variables (`collection.json`),
3. the active **environment**,
4. **runtime** variables extracted by tests during this session (never saved),
5. **request** variables.

Unknown variables are left as written and listed next to the response. An environment variable marked **secret** is stored in SecretStorage (key scoped to the workspace folder and environment); the file only records that the variable exists. Secret values are never sent to the webview, written to files, included in exports or history, or shown in generated code.

## Tests and chaining

Tests are lines of a small language evaluated by NoteSpace — never JavaScript:

```text
status == 201
status in 200..299
time < 500
header content-type contains json
json $.id exists
json $.items.length >= 1
json $.user.name == "Mario"
body contains "ok"
schema $
set token = json $.access_token
set userId = header x-user-id
```

Operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `matches` (regular expression), `exists`, `not exists`, `in a..b`. `json` uses a JSONPath subset (`$`, `.name`, `['name']`, `[0]`, `.length`). `schema` checks the body against the response schema imported from OpenAPI. `set` stores a runtime variable, so a login request can feed `{{token}}` to the next ones; running a collection runs its requests in order with these variables. Expected values may use `{{variables}}`.

## HTTP blocks in pages

````markdown
```http
# @name Create user
# @test status == 201
POST {{baseUrl}}/api/users
Content-Type: application/json

{ "name": "Mario" }
```
````

In the reader and Studio the block shows the method badge, an editable URL and body, an environment selector and **Send**; the response and test results appear under it as text. Opening or exporting a page never sends anything. `# @collection my-apis/authentication/login` (or a `collection: …` line) links the block to a saved request instead of repeating it, with a link that opens it in the API Client. Insert one with `/HTTP request` or the Block Gallery. Static exports show the request without a Send button.

Because pages can come from other people, the first request from documentation to each origin asks for approval (remembered for the workspace), and every POST/PUT/PATCH/DELETE from a page is confirmed with its method and address.

## Security

- Requests go out only on **Send**, from the extension host (not the webview), and only in trusted workspaces.
- TLS certificates are always verified; there is no switch to disable verification. Self-signed certificates must be trusted by the system or through `NODE_EXTRA_CA_CERTS`.
- Cloud metadata services (for example `169.254.169.254`) are always refused, including after DNS resolution and redirects.
- Redirects (up to 10) are followed hop by hop; `Authorization`, `Proxy-Authorization` and `Cookie` are dropped when a redirect changes origin, and 303 (or 301/302 after POST) becomes GET.
- Files for multipart and binary bodies must be inside the workspace and are refused if they are symlinks.
- **History** (`notespace.api.historyLimit`, 200 entries, 0 disables it) keeps method, redacted URL (credentials and token-like query parameters masked), status, time and size — never bodies or headers. **Clear history** removes it.
- OAuth 2.0 tokens are kept in memory for the session only.

## Limits

- OAuth 2.0: client credentials and authorization code with PKCE are supported. The implicit and password grants (deprecated by OAuth 2.1), device code, token refresh and mTLS client certificates are not. The authorization code flow listens on a `127.0.0.1` loopback port: with code-server or remote development the browser must reach that port on the machine running the extension host.
- No proxy support, no WebSocket, gRPC or GraphQL-specific editors (GraphQL works as a JSON POST), no scripts in pre-request or test hooks (by design).
- Cookies set by responses are shown but not stored in a cookie jar; add them to the request's Cookies when needed.
- Collections live in the first workspace folder.
- Postman/Insomnia collection import is not implemented; curl, OpenAPI 3 and NoteSpace bundles are.

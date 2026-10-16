import * as vscode from 'vscode';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ResolvedRequest } from './core/http/model';
import { classifyAddress, classifyHost, TargetKind, worstKind } from './core/net-safety';

/**
 * HTTP execution for the API client. Requests run in the extension host (no CORS, no webview
 * network access) with Node's fetch: TLS certificates are always verified, redirects are
 * followed by hand so credentials never travel to another origin, bodies are read as a stream
 * up to a size limit, and every request can be cancelled.
 */
export interface ApiResponse {
  status: number;
  statusText: string;
  url: string;
  headers: Array<[string, string]>;
  cookies: Array<{ name: string; value: string; attributes: string }>;
  ms: number;
  size: number;
  contentType: string;
  /** Text bodies (JSON, XML, HTML, text) as received. */
  text?: string;
  /** Other bodies (images, binary) as base64, for preview or download. */
  base64?: string;
  truncated: boolean;
  redirects: Array<{ status: number; url: string }>;
}

export async function targetKind(url: URL): Promise<TargetKind> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const named = classifyHost(host);
  if (named !== 'public' || isIP(host)) return named;
  try {
    return worstKind(
      (await lookup(host, { all: true, verbatim: true })).map((a) => classifyAddress(a.address)),
    );
  } catch {
    return 'public';
  }
}

/** A workspace-relative file for a body or form field, refusing paths outside the workspace. */
async function workspaceFile(relative: string): Promise<{ bytes: Uint8Array; name: string }> {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) throw new Error('Open a workspace folder to send files.');
  const clean = relative.replace(/^\.\//, '');
  if (path.isAbsolute(clean) || clean.split(/[\\/]/).includes('..'))
    throw new Error(`“${relative}” must be a path inside the workspace.`);
  for (const folder of folders) {
    const uri = vscode.Uri.joinPath(folder.uri, clean);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      continue;
    }
    if (uri.scheme === 'file') {
      // Symbolic links must not lead outside the workspace folder.
      const real = await realpath(uri.fsPath);
      const base = await realpath(folder.uri.fsPath);
      if (real !== base && !real.startsWith(base + path.sep))
        throw new Error(`“${relative}” leads outside the workspace.`);
    }
    return { bytes: await vscode.workspace.fs.readFile(uri), name: path.basename(clean) };
  }
  throw new Error(`File not found in the workspace: ${relative}`);
}

const textual = (type: string) =>
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|[\w.+-]+\+(json|xml))|image\/svg\+xml)/i.test(
    type,
  ) || !type;

function networkError(error: unknown, url: string): Error {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code || (error as { code?: string })?.code || '';
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const messages: Record<string, string> = {
    ENOTFOUND: `The host ${host} was not found (DNS).`,
    EAI_AGAIN: `The host ${host} could not be resolved right now (DNS).`,
    ECONNREFUSED: `${host} refused the connection. Is the server running?`,
    ECONNRESET: `${host} closed the connection.`,
    ETIMEDOUT: `Connecting to ${host} timed out.`,
    EHOSTUNREACH: `${host} is unreachable.`,
    CERT_HAS_EXPIRED: `The TLS certificate of ${host} has expired.`,
    DEPTH_ZERO_SELF_SIGNED_CERT: `${host} uses a self-signed TLS certificate. Certificates are always verified; trust it in your system or Node certificate store (NODE_EXTRA_CA_CERTS).`,
    SELF_SIGNED_CERT_IN_CHAIN: `The TLS certificate chain of ${host} contains a self-signed certificate that is not trusted.`,
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: `The TLS certificate of ${host} could not be verified.`,
    ERR_TLS_CERT_ALTNAME_INVALID: `The TLS certificate does not match ${host}.`,
  };
  if (/bad port/i.test(cause?.message || (error instanceof Error ? error.message : '')))
    return new Error(
      `The port of ${host} is on the list of ports browsers and Node refuse to use (for example 1, 25 or 6667).`,
    );
  return new Error(
    messages[code] ||
      `Request failed: ${cause?.message || (error instanceof Error ? error.message : String(error))}`,
  );
}

export interface SendOptions {
  signal?: AbortSignal;
  maxBytes?: number;
  /** Called for every target (redirects too); throw to stop. */
  check?: (url: URL, kind: TargetKind) => Promise<void> | void;
}

export async function send(
  request: ResolvedRequest,
  options: SendOptions = {},
): Promise<ApiResponse> {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), request.timeoutMs);
  const abort = () => timeout.abort();
  options.signal?.addEventListener('abort', abort);
  const started = Date.now();
  let url = request.url;
  let method: string = request.method;
  let headers = [...request.headers];
  let body: BodyInit | undefined;
  if (request.body?.kind === 'text') body = request.body.text;
  else if (request.body?.kind === 'form')
    body = new URLSearchParams(request.body.fields).toString();
  else if (request.body?.kind === 'multipart') {
    const form = new FormData();
    for (const f of request.body.fields) {
      if (f.file) {
        const file = await workspaceFile(f.value);
        form.append(f.name, new Blob([new Uint8Array(file.bytes)]), file.name);
      } else form.append(f.name, f.value);
    }
    body = form;
  } else if (request.body?.kind === 'file')
    body = new Uint8Array((await workspaceFile(request.body.path)).bytes);
  const redirects: ApiResponse['redirects'] = [];
  try {
    for (let hop = 0; ; hop++) {
      const target = new URL(url);
      const kind = await targetKind(target);
      if (kind === 'metadata')
        throw new Error(
          `${target.hostname} is a cloud metadata service; NoteSpace never sends requests there.`,
        );
      await options.check?.(target, kind);
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: timeout.signal,
        });
      } catch (error) {
        if (timeout.signal.aborted)
          throw new Error(
            options.signal?.aborted
              ? 'Request cancelled.'
              : `The request timed out after ${Math.round(request.timeoutMs / 100) / 10} s.`,
          );
        throw networkError(error, url);
      }
      const location = response.headers.get('location');
      if (
        request.followRedirects &&
        location &&
        [301, 302, 303, 307, 308].includes(response.status)
      ) {
        if (hop >= 10) throw new Error('Too many redirects (more than 10).');
        void response.body?.cancel();
        const next = new URL(location, url);
        redirects.push({ status: response.status, url: next.toString() });
        if (next.origin !== target.origin)
          // Credentials and cookies are not forwarded to another origin.
          headers = headers.filter(
            ([k]) => !/^(authorization|proxy-authorization|cookie)$/i.test(k),
          );
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) && method === 'POST')
        ) {
          method = 'GET';
          body = undefined;
          headers = headers.filter(([k]) => !/^content-(type|length)$/i.test(k));
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:')
          throw new Error(`Redirect to an unsupported address: ${next.protocol}`);
        url = next.toString();
        continue;
      }
      // Read the body as a stream, stopping at the size limit.
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      const reader = response.body?.getReader();
      if (reader)
        for (;;) {
          let part: ReadableStreamReadResult<Uint8Array>;
          try {
            part = await reader.read();
          } catch (error) {
            if (timeout.signal.aborted)
              throw new Error(
                options.signal?.aborted
                  ? 'Request cancelled.'
                  : `The response timed out after ${Math.round(request.timeoutMs / 100) / 10} s.`,
              );
            throw networkError(error, url);
          }
          if (part.done) break;
          size += part.value.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(part.value.subarray(0, part.value.length - (size - maxBytes)));
            void reader.cancel();
            break;
          }
          chunks.push(part.value);
        }
      const bytes = new Uint8Array(Math.min(size, maxBytes));
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      const responseHeaders: Array<[string, string]> = [];
      response.headers.forEach((value, key) => responseHeaders.push([key, value]));
      const setCookies =
        (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
      const contentType = response.headers.get('content-type') || '';
      return {
        status: response.status,
        statusText: response.statusText,
        url,
        headers: responseHeaders,
        cookies: setCookies.map((c) => {
          const [pair, ...attributes] = c.split(';');
          const eq = pair.indexOf('=');
          return {
            name: pair.slice(0, eq).trim(),
            value: pair.slice(eq + 1).trim(),
            attributes: attributes.join(';').trim(),
          };
        }),
        ms: Date.now() - started,
        size,
        contentType,
        ...(textual(contentType)
          ? { text: new TextDecoder().decode(bytes) }
          : { base64: Buffer.from(bytes).toString('base64') }),
        truncated,
        redirects,
      };
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

import * as vscode from 'vscode';
import { ApiStore } from './api-store';
import { ApiClientPanel } from './api-client';
import { parseHttpBlock } from './core/http/http-block';
import { renderHttpBlock } from './core/http/render';
import { ApiRequest } from './core/http/model';
import { changesData } from './core/net-safety';

const DOC_ORIGINS = 'wikiStudio.api.documentOrigins';

/**
 * Interactive ```http blocks in the reader and Studio. Opening a page never sends anything:
 * a request goes out only when its Send button is pressed. Because pages can come from other
 * people, the first request from documentation to each origin asks for approval, and every
 * request that may change data is confirmed.
 */
export class HttpBlocks {
  private seq = 0;
  constructor(
    private readonly store: ApiStore,
    private readonly client: ApiClientPanel,
    private readonly memento: vscode.Memento,
  ) {}

  private async linked(text: string): Promise<Map<string, ApiRequest>> {
    const out = new Map<string, ApiRequest>();
    for (const m of text.matchAll(/^(?:#|\/\/)\s*@collection\s+(\S+)|^collection:\s*(\S+)/gm)) {
      const ref = m[1] || m[2];
      if (out.has(ref)) continue;
      const [collection, ...rest] = ref.split('/');
      try {
        out.set(ref, await this.store.request(collection, rest.join('/')));
      } catch {
        /* reported in the block */
      }
    }
    return out;
  }

  /** A renderer for the ```http blocks of `text` (the page or snippet being rendered). */
  async renderer(text: string, interactive = true): Promise<(source: string) => string> {
    const linked = await this.linked(text);
    let environments: Array<{ id: string; name: string }> = [];
    try {
      environments = (await this.store.environments()).map((e) => ({ id: e.id, name: e.name }));
    } catch {
      /* no workspace folder */
    }
    const activeEnvironment = this.store.activeEnvironment();
    return (source) =>
      renderHttpBlock(
        source,
        { interactive, linked, environments, activeEnvironment },
        `http-${++this.seq}`,
      );
  }

  /** Handles `httpSend` / `httpOpen` from a webview; returns true when the message was one. */
  async handle(
    message: Record<string, unknown>,
    reply: (m: unknown) => Thenable<boolean>,
  ): Promise<boolean> {
    if (message.type === 'httpOpen' && typeof message.collection === 'string') {
      const [collection, ...rest] = message.collection.split('/');
      await this.client.show({ collection, path: rest.join('/') });
      return true;
    }
    if (
      message.type !== 'httpSend' ||
      typeof message.source !== 'string' ||
      typeof message.id !== 'string'
    )
      return false;
    const id = message.id.slice(0, 40);
    try {
      const block = parseHttpBlock(message.source.slice(0, 200000));
      let request = block.request;
      let collection: string | undefined;
      if (block.collection) {
        const [c, ...rest] = block.collection.split('/');
        collection = c;
        request = await this.store.request(c, rest.join('/'));
      }
      // The reader can edit the URL and body before sending; nothing else changes.
      if (typeof message.url === 'string' && message.url.trim())
        request = { ...request, url: message.url.slice(0, 8000) };
      if (
        typeof message.body === 'string' &&
        (request.body.type === 'json' ||
          request.body.type === 'text' ||
          request.body.type === 'xml')
      )
        request = { ...request, body: { ...request.body, text: message.body.slice(0, 1000000) } };
      const environment =
        typeof message.environment === 'string' ? message.environment || undefined : undefined;
      if (environment !== undefined && environment !== this.store.activeEnvironment())
        await this.store.setActiveEnvironment(environment);
      let confirmedWrite = false;
      const result = await this.store.send(
        request,
        { collection, environment, origin: 'document', ref: block.collection },
        async (url, kind) => {
          const allowed = this.memento.get<string[]>(DOC_ORIGINS, []);
          if (!allowed.includes(url.origin)) {
            const where =
              kind === 'loopback'
                ? ' (this machine)'
                : kind === 'private' || kind === 'link-local'
                  ? ' (your local network)'
                  : '';
            const choice = await vscode.window.showWarningMessage(
              `Allow requests from documentation pages to ${url.origin}${where}?`,
              {
                modal: true,
                detail:
                  'This page asks to send an HTTP request. Requests from pages are sent only when you press Send; this approval is remembered for this workspace.',
              },
              'Allow',
            );
            if (choice !== 'Allow') throw new Error('Not sent: the origin was not allowed.');
            await this.memento.update(DOC_ORIGINS, [...allowed, url.origin]);
          }
          if (changesData(request.method) && !confirmedWrite) {
            const choice = await vscode.window.showWarningMessage(
              `Send ${request.method} ${url.origin}${url.pathname}?`,
              {
                modal: true,
                detail: `${request.method} requests may create, change or delete data on the server.`,
              },
              'Send',
            );
            if (choice !== 'Send') throw new Error('Not sent.');
            confirmedWrite = true;
          }
        },
      );
      const r = result.response;
      await reply({
        type: 'httpResponse',
        id,
        error: result.error,
        missing: result.missing,
        tests: result.tests.results,
        ...(r
          ? {
              status: r.status,
              statusText: r.statusText,
              ms: r.ms,
              size: r.size,
              contentType: r.contentType,
              text:
                r.text !== undefined ? pretty(r.text, r.contentType).slice(0, 200000) : undefined,
              binary: r.text === undefined,
              truncated: r.truncated,
            }
          : {}),
      });
    } catch (e) {
      await reply({ type: 'httpResponse', id, error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }
}

function pretty(text: string, type: string): string {
  if (!/json/.test(type)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

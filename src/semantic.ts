import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { WikiRoot, WikiWorkspace } from './workspace';
import { sections } from './core/search';
import { Page, Heading } from './core/model';
import { endpointUrl, isLoopback, postJson } from './ai';
import { redactSecrets } from './core/redact';

/**
 * Optional semantic search with an embedding model the user runs and names (for example a
 * local Ollama model). Off until `notespace.semanticSearch.model` is set; NoteSpace never
 * downloads a model. Vectors are cached in VS Code's workspace storage, not in the wiki.
 */
interface Entry {
  hash: string;
  vector: number[];
}
interface Store {
  model: string;
  endpoint: string;
  entries: Record<string, Entry>;
}
export interface SemanticHit {
  page: Page;
  heading?: Heading;
  score: number;
  text: string;
}

const MAX_CHUNK = 2000;
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export class SemanticSearch {
  private stores = new Map<string, Store>();
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspace: WikiWorkspace,
  ) {}

  settings() {
    const ai = vscode.workspace.getConfiguration('notespace');
    return {
      endpoint: ai.get<string>('ai.endpoint', ''),
      model: ai.get<string>('semanticSearch.model', ''),
    };
  }
  private file(root: WikiRoot): vscode.Uri {
    const base = this.context.storageUri || this.context.globalStorageUri;
    return vscode.Uri.joinPath(base, `semantic-${hash(root.id)}.json`);
  }
  private async load(root: WikiRoot): Promise<Store> {
    const { endpoint, model } = this.settings();
    let store = this.stores.get(root.id);
    if (!store) {
      try {
        store = JSON.parse(
          new TextDecoder().decode(await vscode.workspace.fs.readFile(this.file(root))),
        ) as Store;
      } catch {
        store = undefined;
      }
    }
    // A different model or endpoint means different vector spaces: start over.
    if (!store || store.model !== model || store.endpoint !== endpoint)
      store = { model, endpoint, entries: {} };
    this.stores.set(root.id, store);
    return store;
  }
  private chunks(root: WikiRoot) {
    return this.workspace.index
      .all(root.id)
      .filter((p) => !this.workspace.isArchived(p) && !p.draft)
      .flatMap((page) =>
        sections(page).map((s, i) => {
          const text = redactSecrets(
            `${page.title}${s.heading ? ` — ${s.heading.text}` : ''}\n${s.text}`.slice(
              0,
              MAX_CHUNK,
            ),
          ).text;
          return { key: `${page.id}#${i}`, page, heading: s.heading, text, hash: hash(text) };
        }),
      );
  }
  private async embed(texts: string[], token?: vscode.CancellationToken): Promise<number[][]> {
    const { endpoint, model } = this.settings();
    const data = (await postJson(
      this.context,
      endpointUrl(endpoint, 'embeddings'),
      { model, input: texts },
      token,
    )) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const rows = data.data || [];
    if (rows.length !== texts.length || rows.some((r) => !Array.isArray(r.embedding)))
      throw new Error('The embedding endpoint returned an unexpected answer.');
    return rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((r) => r.embedding!);
  }
  /** Asks before the first upload of page text for this endpoint and model. */
  async authorized(): Promise<boolean> {
    const { endpoint, model } = this.settings();
    if (!model)
      throw new Error(
        'Semantic search is off. Set notespace.semanticSearch.model to an embedding model you run (for example nomic-embed-text in Ollama).',
      );
    const key = `${endpoint}\0${model}`;
    if (this.context.workspaceState.get<string>('semantic.approved') === key) return true;
    const choice = await vscode.window.showWarningMessage(
      `Send the text of this wiki's pages to ${model} at ${endpoint} to build a semantic index?`,
      {
        modal: true,
        detail: `${isLoopback(endpoint) ? 'The endpoint is on this machine.' : 'Warning: the endpoint is NOT on this machine, so page text leaves this computer.'} Drafts and archived versions are skipped and credential-like values are redacted. Vectors are stored in VS Code's workspace storage.`,
      },
      'Build Index',
    );
    if (choice !== 'Build Index') return false;
    await this.context.workspaceState.update('semantic.approved', key);
    return true;
  }
  /** Embeds new or changed sections only. */
  async update(
    root: WikiRoot,
    progress?: (done: number, total: number) => void,
    token?: vscode.CancellationToken,
  ): Promise<number> {
    const store = await this.load(root);
    const chunks = this.chunks(root);
    const live = new Set(chunks.map((c) => c.key));
    for (const key of Object.keys(store.entries)) if (!live.has(key)) delete store.entries[key];
    const missing = chunks.filter((c) => store.entries[c.key]?.hash !== c.hash);
    for (let i = 0; i < missing.length; i += 32) {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      const batch = missing.slice(i, i + 32);
      const vectors = await this.embed(
        batch.map((c) => c.text),
        token,
      );
      batch.forEach((c, k) => (store.entries[c.key] = { hash: c.hash, vector: vectors[k] }));
      progress?.(Math.min(i + 32, missing.length), missing.length);
    }
    const file = this.file(root);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(store)));
    return missing.length;
  }
  async query(
    root: WikiRoot,
    text: string,
    limit = 20,
    token?: vscode.CancellationToken,
  ): Promise<SemanticHit[]> {
    const store = await this.load(root);
    const [vector] = await this.embed([redactSecrets(text).text], token);
    const best = new Map<string, SemanticHit>();
    for (const chunk of this.chunks(root)) {
      const entry = store.entries[chunk.key];
      if (!entry || entry.hash !== chunk.hash) continue;
      const score = cosine(vector, entry.vector);
      if (score > (best.get(chunk.page.id)?.score ?? -Infinity))
        best.set(chunk.page.id, {
          page: chunk.page,
          heading: chunk.heading,
          score,
          text: chunk.text,
        });
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

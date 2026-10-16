import * as vscode from 'vscode';
import { WikiWorkspace } from './workspace';
import { redactSecrets } from './core/redact';
import { posix } from './core/paths';

/**
 * Optional AI assistance. Nothing is sent unless the user runs an AI command and confirms what
 * goes where. Providers: VS Code's language models (for example from an installed chat
 * extension) or an explicitly configured OpenAI-compatible endpoint such as a local Ollama.
 * Every result is a proposal shown in a diff editor; files change only on “Apply”.
 */
export type Provider = {
  label: string;
  send: (system: string, user: string, token: vscode.CancellationToken) => Promise<string>;
};
export const ENDPOINT_SECRET = 'notespace.ai.endpointKey';

const config = () => vscode.workspace.getConfiguration('notespace.ai');

/** Base URL like http://127.0.0.1:11434/v1 → full URL for `path`. */
export const endpointUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path}`;
export const isLoopback = (url: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

export async function postJson(
  context: vscode.ExtensionContext,
  url: string,
  body: unknown,
  token?: vscode.CancellationToken,
): Promise<unknown> {
  if (!/^https?:\/\//i.test(url)) throw new Error('The AI endpoint must be an http(s) URL.');
  const key = await context.secrets.get(ENDPOINT_SECRET);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120000);
  const cancel = token?.onCancellationRequested(() => abort.abort());
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: abort.signal,
      redirect: 'error',
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`The AI endpoint answered ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new vscode.CancellationError();
    throw e;
  } finally {
    clearTimeout(timer);
    cancel?.dispose();
  }
}

export async function chooseProvider(context: vscode.ExtensionContext): Promise<Provider> {
  const provider = config().get<string>('provider', 'vscode');
  if (provider === 'off') throw new Error('AI assistance is turned off (notespace.ai.provider).');
  if (provider === 'endpoint') {
    const base = config().get<string>('endpoint', '');
    const model = config().get<string>('model', '');
    if (!base || !model)
      throw new Error(
        'Set notespace.ai.endpoint and notespace.ai.model to use an OpenAI-compatible endpoint.',
      );
    return {
      label: `${model} at ${new URL(base).host}`,
      send: async (system, user, token) => {
        const data = (await postJson(
          context,
          endpointUrl(base, 'chat/completions'),
          {
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          },
          token,
        )) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw new Error('The AI endpoint returned no text.');
        return text;
      },
    };
  }
  const models = await vscode.lm.selectChatModels();
  if (!models.length)
    throw new Error(
      'No language model is available in VS Code. Install a chat extension that provides models, or configure an OpenAI-compatible endpoint (notespace.ai.provider: endpoint).',
    );
  const model =
    models.length === 1
      ? models[0]
      : (
          await vscode.window.showQuickPick(
            models.map((m) => ({ label: m.name, description: m.vendor, model: m })),
            { title: 'Choose a language model' },
          )
        )?.model;
  if (!model) throw new vscode.CancellationError();
  return {
    label: `${model.name} (${model.vendor})`,
    send: async (system, user, token) => {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(`${system}\n\n${user}`)],
        {
          justification:
            'NoteSpace sends the text you selected to propose documentation changes for your review.',
        },
        token,
      );
      let text = '';
      for await (const part of response.text) text += part;
      return text;
    },
  };
}

const approved = new Set<string>();
/** Asks once per provider and session; always reports redactions. */
async function consent(
  provider: Provider,
  what: string,
  size: number,
  redacted: number,
): Promise<boolean> {
  if (approved.has(provider.label) && !redacted) return true;
  const choice = await vscode.window.showWarningMessage(
    `Send ${what} (${size.toLocaleString()} characters) to ${provider.label}?`,
    {
      modal: true,
      detail: `${redacted ? `${redacted} credential-like value(s) were replaced with [REDACTED] before sending. ` : ''}Only this text is sent. The answer is shown as a proposal; nothing changes until you apply it.`,
    },
    'Send',
  );
  if (choice !== 'Send') return false;
  approved.add(provider.label);
  return true;
}

/** Removes a wrapping ```markdown fence that chat models like to add. */
export const unwrap = (text: string) => {
  const m = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
  return (m ? m[1] : text).replace(/^\s+|\s+$/g, '') + '\n';
};

interface Proposal {
  target: vscode.Uri;
  version: number;
  original: string;
  text: string;
  range?: vscode.Range;
  create?: boolean;
}
export class AiProposals implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'wiki-ai';
  private readonly proposals = new Map<string, Proposal>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private next = 0;
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.proposals.get(uri.toString())?.text ?? '';
  }
  /** Shows `text` against the target in a diff editor and remembers what it would replace. */
  async propose(proposal: Proposal, title: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.from({
      scheme: AiProposals.scheme,
      path: `/${++this.next}/${posix.basename(proposal.target.path)}`,
    });
    this.proposals.set(uri.toString(), proposal);
    const left = proposal.create
      ? vscode.Uri.from({ scheme: AiProposals.scheme, path: `/${this.next}/empty` })
      : proposal.target;
    if (proposal.create) this.proposals.set(left.toString(), { ...proposal, text: '' });
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      uri,
      `${title} (AI proposal — review, then Apply)`,
    );
    return uri;
  }
  get(uri: vscode.Uri): Proposal | undefined {
    return this.proposals.get(uri.toString());
  }
  /** Applies a proposal unless the target changed after it was made. */
  async apply(uri: vscode.Uri, workspace: WikiWorkspace): Promise<vscode.Uri> {
    const proposal = this.proposals.get(uri.toString());
    if (!proposal) throw new Error('This AI proposal is no longer available.');
    if (proposal.create) {
      try {
        await vscode.workspace.fs.stat(proposal.target);
        throw new Error(`${posix.basename(proposal.target.path)} already exists.`);
      } catch (e) {
        if (!(e instanceof vscode.FileSystemError)) throw e;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(proposal.target, { overwrite: false });
      edit.insert(proposal.target, new vscode.Position(0, 0), proposal.text);
      if (!(await vscode.workspace.applyEdit(edit)))
        throw new Error('VS Code could not create the page.');
    } else {
      const document = await vscode.workspace.openTextDocument(proposal.target);
      if (
        document.version !== proposal.version &&
        document.getText(proposal.range) !== proposal.original
      )
        throw new Error('The page changed after the proposal was made. Run the AI command again.');
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        proposal.target,
        proposal.range ||
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        proposal.range ? proposal.text.replace(/\n$/, '') : proposal.text,
      );
      if (!(await vscode.workspace.applyEdit(edit)))
        throw new Error('VS Code could not apply the proposal.');
    }
    // Applying is the explicit decision to write: save it (Undo in the editor still reverts it).
    await (await vscode.workspace.openTextDocument(proposal.target)).save();
    this.proposals.delete(uri.toString());
    await workspace.refresh();
    return proposal.target;
  }
  discard(uri: vscode.Uri): void {
    this.proposals.delete(uri.toString());
  }
}

export const prompts = {
  improve: (instruction: string) =>
    `You edit Markdown documentation. ${instruction} Keep the meaning, facts, links, code blocks, front matter, ::: containers, {{ include }} lines and [[wiki links]] exactly as they are. Answer with the revised Markdown only, no commentary.`,
  translate: (language: string) =>
    `Translate this Markdown documentation page into the language with code “${language}”. Translate prose, headings and link labels. Keep front matter keys, code blocks, URLs, link targets, [[wiki link]] targets, ::: container kinds and {{ include }} lines unchanged. Answer with the translated Markdown only.`,
  docsFromCode: (language: string) =>
    `Write a documentation page in Markdown for the following ${language} source file: purpose, usage with short examples, public functions or classes with their parameters, and caveats. Only describe what the code shows; do not invent behavior. Start with a # heading. Answer with Markdown only.`,
  review: () =>
    'Review this Markdown documentation page for accuracy risks, unclear passages, missing steps, broken structure and inconsistent terminology. Answer with a Markdown bullet list of concrete suggestions, each quoting the passage it refers to. Do not rewrite the page.',
};

/** Runs one AI request with consent, redaction and cancellation. */
export async function ask(
  context: vscode.ExtensionContext,
  what: string,
  system: string,
  text: string,
): Promise<string | undefined> {
  const provider = await chooseProvider(context);
  const { text: safe, count } = redactSecrets(text);
  if (!(await consent(provider, what, safe.length, count))) return undefined;
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Asking ${provider.label}…`,
      cancellable: true,
    },
    (_progress, token) => provider.send(system, safe, token),
  );
}

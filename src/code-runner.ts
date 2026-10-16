import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { findPython } from './python-kernel';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  runtime: string;
}

const MAX_OUTPUT = 200_000;
type Runtime = { command: string; args: (code: string) => string[]; label: string };

function runtimes(): Record<string, Runtime | undefined> {
  const python = findPython();
  const py: Runtime | undefined = python
    ? { command: python, args: (code) => ['-c', code], label: python }
    : undefined;
  const node: Runtime = {
    command: process.execPath,
    args: (code) => ['-e', code],
    label: `node ${process.version}`,
  };
  const bash: Runtime = { command: 'bash', args: (code) => ['-c', code], label: 'bash' };
  return { python: py, py, javascript: { ...node }, js: { ...node }, bash, sh: bash, shell: bash };
}

/**
 * Explicit, trusted execution of documentation code blocks. Nothing runs from the reader or
 * from exports; Studio asks the host, which checks the setting, Workspace Trust and a
 * once-per-session confirmation for each runtime.
 */
export class CodeRunner {
  private readonly approved = new Set<string>();
  /** Languages that may be offered a Run button right now. */
  available(): Record<string, string> {
    if (!this.enabled()) return {};
    const result: Record<string, string> = {};
    for (const [language, runtime] of Object.entries(runtimes()))
      if (runtime) result[language] = runtime.label;
    return result;
  }
  enabled(): boolean {
    return (
      vscode.workspace.isTrusted &&
      vscode.workspace.getConfiguration('notespace').get<boolean>('codeRunner.enabled', false)
    );
  }
  async run(language: string, code: string, cwd: string): Promise<RunResult | undefined> {
    if (!vscode.workspace.isTrusted) throw new Error('Running code requires a trusted workspace.');
    if (!this.enabled())
      throw new Error('Enable “notespace.codeRunner.enabled” to run code blocks.');
    const runtime = runtimes()[language.toLowerCase()];
    if (!runtime) throw new Error(`No runtime is available for “${language}”.`);
    if (code.length > 100_000) throw new Error('The code block is too large to run.');
    if (!this.approved.has(runtime.label)) {
      const choice = await vscode.window.showWarningMessage(
        `Run this ${language} block with ${runtime.label}?`,
        {
          modal: true,
          detail: `It runs on ${vscode.env.remoteName ? 'the remote host' : 'this machine'} with your permissions in ${cwd}. You will not be asked again for ${runtime.label} in this session.`,
        },
        'Run',
      );
      if (choice !== 'Run') return undefined;
      this.approved.add(runtime.label);
    }
    const timeout =
      Math.min(
        Math.max(
          vscode.workspace
            .getConfiguration('notespace')
            .get<number>('codeRunner.timeoutSeconds', 20),
          1,
        ),
        300,
      ) * 1000;
    const started = Date.now();
    return new Promise<RunResult>((resolve) => {
      const child = spawn(runtime.command, runtime.args(code), { cwd, env: process.env });
      let stdout = '',
        stderr = '',
        timedOut = false;
      const append = (current: string, chunk: Buffer) =>
        current.length >= MAX_OUTPUT ? current : (current + chunk.toString()).slice(0, MAX_OUTPUT);
      child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, chunk)));
      child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, chunk)));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: `${stderr}${error.message}`,
          exitCode: null,
          timedOut,
          durationMs: Date.now() - started,
          runtime: runtime.label,
        });
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode,
          timedOut,
          durationMs: Date.now() - started,
          runtime: runtime.label,
        });
      });
    });
  }
}

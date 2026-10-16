import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

/**
 * A small Python kernel for VS Code's notebook editor when the Jupyter extension is absent.
 * Cells run only when the user runs them, only in trusted workspaces, in one persistent
 * `python3` process per notebook (so variables carry over like in Jupyter).
 */
const DRIVER = String.raw`
import sys, json, io, ast, base64, traceback, contextlib, os
os.environ.setdefault('MPLBACKEND', 'Agg')
import builtins
ns = {'__name__': '__main__'}
out = sys.__stdout__
requests = sys.stdin
# User code must never read the request pipe: stdin is empty and input() fails clearly.
sys.stdin = io.StringIO('')
def no_input(*args, **kwargs):
    raise RuntimeError('input() is not supported by the NoteSpace Python kernel.')
builtins.input = no_input
def send(obj):
    out.write(json.dumps(obj) + '\n'); out.flush()
for line in requests:
    req = json.loads(line)
    stdout, stderr = io.StringIO(), io.StringIO()
    reply = {'id': req['id']}
    try:
        tree = ast.parse(req['code'], '<cell>', 'exec')
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exec(compile(tree, '<cell>', 'exec'), ns)
            value = eval(compile(last, '<cell>', 'eval'), ns) if last else None
        if value is not None:
            reply['result'] = repr(value)
            try:
                html = value._repr_html_() if hasattr(value, '_repr_html_') else None
                if isinstance(html, str): reply['html'] = html
            except Exception:
                pass
        plt = sys.modules.get('matplotlib.pyplot')
        if plt is not None:
            images = []
            for num in plt.get_fignums():
                buf = io.BytesIO(); plt.figure(num).savefig(buf, format='png', bbox_inches='tight')
                images.append(base64.b64encode(buf.getvalue()).decode())
            plt.close('all')
            if images: reply['images'] = images
    except BaseException as e:
        tb = traceback.format_exception(type(e), e, e.__traceback__)
        reply['error'] = {'name': type(e).__name__, 'message': str(e), 'stack': ''.join(tb[1:] if len(tb) > 1 else tb)}
    reply['stdout'] = stdout.getvalue(); reply['stderr'] = stderr.getvalue()
    send(reply)
`;

interface Reply {
  id: number;
  stdout: string;
  stderr: string;
  result?: string;
  html?: string;
  images?: string[];
  error?: { name: string; message: string; stack: string };
}

class Session {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (reply: Reply) => void>();
  private next = 1;
  exited = false;
  constructor(python: string, cwd: string) {
    this.process = spawn(python, ['-u', '-c', DRIVER], {
      cwd,
      env: { ...process.env, MPLBACKEND: 'Agg' },
    });
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      try {
        const reply = JSON.parse(line) as Reply;
        this.waiting.get(reply.id)?.(reply);
        this.waiting.delete(reply.id);
      } catch {
        /* Ignore stray output; user output is captured inside the driver. */
      }
    });
    this.process.on('exit', () => {
      this.exited = true;
      for (const resolve of this.waiting.values())
        resolve({
          id: 0,
          stdout: '',
          stderr: '',
          error: { name: 'KernelExit', message: 'The Python process stopped.', stack: '' },
        });
      this.waiting.clear();
    });
  }
  run(code: string): Promise<Reply> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.process.stdin.write(`${JSON.stringify({ id, code })}\n`);
    });
  }
  kill(): void {
    this.process.kill();
  }
}

let pythonCache: { value: string | undefined } | undefined;
/** Probes `python3 --version` once per session (only in trusted workspaces). */
export function findPython(): string | undefined {
  if (!vscode.workspace.isTrusted) return undefined;
  pythonCache ??= { value: probePython() };
  return pythonCache.value;
}
function probePython(): string | undefined {
  for (const candidate of ['python3', 'python']) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 3000 });
      if (/Python 3\./.test(version)) return candidate;
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

export function registerPythonKernel(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.getConfiguration('notespace').get<boolean>('notebooks.pythonKernel', true))
    return;
  // Untrusted workspaces never probe for or run Python; trusting the folder registers the kernel.
  if (!vscode.workspace.isTrusted) {
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => registerPythonKernel(context)),
    );
    return;
  }
  const python = findPython();
  if (!python) return;
  const sessions = new Map<string, Session>();
  const controller = vscode.notebooks.createNotebookController(
    'notespace-python',
    'jupyter-notebook',
    'NoteSpace Python',
  );
  controller.supportedLanguages = ['python'];
  controller.description = `${python} · runs only when you run a cell`;
  controller.detail =
    'Local Python without Jupyter. Variables persist per notebook until it is closed or interrupted.';
  controller.supportsExecutionOrder = true;
  let order = 0;
  controller.interruptHandler = (notebook) => {
    sessions.get(notebook.uri.toString())?.kill();
    sessions.delete(notebook.uri.toString());
  };
  controller.executeHandler = async (cells, notebook) => {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        'NoteSpace runs notebook cells only in a trusted workspace.',
      );
      return;
    }
    const key = notebook.uri.toString();
    let session = sessions.get(key);
    if (!session || session.exited) {
      session = new Session(python, path.dirname(notebook.uri.fsPath));
      sessions.set(key, session);
    }
    for (const cell of cells) {
      const execution = controller.createNotebookCellExecution(cell);
      execution.executionOrder = ++order;
      execution.start(Date.now());
      await execution.clearOutput();
      const reply = await session.run(cell.document.getText());
      const outputs: vscode.NotebookCellOutput[] = [];
      if (reply.stdout)
        outputs.push(
          new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(reply.stdout)]),
        );
      if (reply.stderr)
        outputs.push(
          new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(reply.stderr)]),
        );
      for (const image of reply.images || [])
        outputs.push(
          new vscode.NotebookCellOutput([
            new vscode.NotebookCellOutputItem(Buffer.from(image, 'base64'), 'image/png'),
          ]),
        );
      if (reply.result !== undefined)
        outputs.push(
          new vscode.NotebookCellOutput([
            ...(reply.html ? [vscode.NotebookCellOutputItem.text(reply.html, 'text/html')] : []),
            vscode.NotebookCellOutputItem.text(reply.result, 'text/plain'),
          ]),
        );
      if (reply.error) {
        const error = new Error(reply.error.message);
        error.name = reply.error.name;
        error.stack = reply.error.stack;
        outputs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]));
      }
      await execution.replaceOutput(outputs);
      execution.end(!reply.error, Date.now());
      if (reply.error?.name === 'KernelExit') break;
    }
  };
  context.subscriptions.push(
    controller,
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      sessions.get(notebook.uri.toString())?.kill();
      sessions.delete(notebook.uri.toString());
    }),
    { dispose: () => sessions.forEach((s) => s.kill()) },
  );
}

// Prepares the validators used by the PDF/EPUB integration test, once, in a cache folder:
// a Python virtual environment with pypdf and W3C EPUBCheck 5.1.0 (run with the system Java).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const toolsDir = path.join(os.homedir(), '.cache', 'notespace-tools');
const windows = process.platform === 'win32';
export const pythonPath = path.join(
  toolsDir,
  'venv',
  windows ? 'Scripts' : 'bin',
  windows ? 'python.exe' : 'python',
);
const epubcheckJar = path.join(toolsDir, 'epubcheck-5.1.0', 'epubcheck.jar');
const EPUBCHECK = 'https://github.com/w3c/epubcheck/releases/download/v5.1.0/epubcheck-5.1.0.zip';

/** Installs what is missing; failures are reported and leave the test to fail with its message. */
export async function ensureTestTools() {
  await mkdir(toolsDir, { recursive: true });
  try {
    if (!existsSync(pythonPath)) {
      const system = windows ? 'python' : 'python3';
      execFileSync(system, ['-m', 'venv', path.join(toolsDir, 'venv')], { stdio: 'inherit' });
    }
    execFileSync(pythonPath, ['-c', 'import pypdf'], { stdio: 'ignore' });
  } catch {
    try {
      execFileSync(pythonPath, ['-m', 'pip', 'install', '--quiet', 'pypdf'], { stdio: 'inherit' });
    } catch (e) {
      console.warn(`Could not install pypdf: ${e.message}`);
    }
  }
  if (!existsSync(epubcheckJar)) {
    try {
      const response = await fetch(EPUBCHECK);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const zip = path.join(toolsDir, 'epubcheck.zip');
      await writeFile(zip, Buffer.from(await response.arrayBuffer()));
      execFileSync(pythonPath, ['-m', 'zipfile', '-e', zip, toolsDir], { stdio: 'inherit' });
    } catch (e) {
      console.warn(`Could not download EPUBCheck: ${e.message}`);
    }
  }
}

// Shared code-server + Playwright harness for the visual review and smoke scripts.
// It installs the packaged VSIX into an isolated profile; the user's code-server is untouched.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const poll = async (fn, label, timeout = 30000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${label}`);
};

/** Starts an isolated code-server with the packaged extension and opens `workspace`. */
export async function launchCodeServer({ files, settings = {}, viewport }) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'notespace-review-'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const env = { ...process.env };
  delete env.VSCODE_IPC_HOOK_CLI;
  delete env.VSCODE_PROXY_URI;
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(tmp, 'workspace', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await mkdir(path.join(tmp, 'user/User'), { recursive: true });
  await writeFile(
    path.join(tmp, 'user/User/settings.json'),
    JSON.stringify({
      'workbench.startupEditor': 'none',
      'security.workspace.trust.enabled': false,
      'window.dialogStyle': 'custom',
      'files.simpleDialog.enable': true,
      'workbench.colorTheme': 'Default Dark Modern',
      'chat.disableAIFeatures': true,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      ...settings,
    }),
  );
  const config = path.join(tmp, 'config.yaml');
  await writeFile(config, '{}\n');
  const args = [
    '--config',
    config,
    '--user-data-dir',
    path.join(tmp, 'user'),
    '--extensions-dir',
    path.join(tmp, 'extensions'),
  ];
  execFileSync(
    'code-server',
    [...args, '--install-extension', path.resolve(`${pkg.name}-${pkg.version}.vsix`), '--force'],
    { stdio: 'ignore', env },
  );
  const port = 19000 + Math.floor(Math.random() * 10000);
  const app = spawn(
    'code-server',
    [
      ...args,
      '--bind-addr',
      `127.0.0.1:${port}`,
      '--auth',
      'none',
      '--disable-telemetry',
      '--disable-update-check',
      '--disable-workspace-trust',
      path.join(tmp, 'workspace'),
    ],
    { stdio: 'ignore', env },
  );
  await poll(async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).ok, 'code-server');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: viewport || { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  await page.goto(
    `http://127.0.0.1:${port}/?folder=${encodeURIComponent(path.join(tmp, 'workspace'))}`,
  );
  await page.locator('.monaco-workbench').waitFor();
  const close = async () => {
    await browser.close().catch(() => {});
    app.kill();
    if (app.exitCode === null) await new Promise((r) => app.once('exit', r));
    await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return { tmp, page, browser, close, workspace: path.join(tmp, 'workspace') };
}

/** Runs a Command Palette command by its full title. */
export async function runCommand(page, title) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(300);
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget input[type=text]');
    await input.waitFor({ state: 'visible' });
    // An editor that finishes opening can take focus and close the palette: try again.
    const typed = await input
      .focus({ timeout: 3000 })
      .then(() => input.fill(`>${title}`, { timeout: 3000 }))
      .then(() => true)
      .catch(() => false);
    if (!typed) continue;
    const row = page
      .locator('.quick-input-list .monaco-list-row')
      .filter({ hasText: title })
      .first();
    if (
      await row
        .waitFor({ timeout: 3000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Escape');
  }
  throw new Error(`Command not visible in palette: ${title}`);
}

/** Finds the first webview frame that matches `selector`. */
export const frameWith = (page, selector, label, filter) =>
  poll(async () => {
    for (const frame of page.frames()) {
      const locator = frame.locator(selector);
      if (!(await locator.count())) continue;
      if (filter && !(await filter(frame))) continue;
      return frame;
    }
  }, label);

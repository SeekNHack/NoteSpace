import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { symlink, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WikiStudioApi } from '../../extension';
import { createConfig, defaultConfig, parseConfig, updateConfig } from '../../core/config';
import { importImage, importAttachment } from '../../assets';
import { showPage, WikiTree } from '../../views';
import { importMarkdownProject } from '../../import-project';
import { addDays } from '../../core/tasks';
import { createServer } from 'node:http';
import { CodeRunner } from '../../code-runner';
import { importNotebook } from '../../notebooks';
import { secretKey, sendApiRequest } from '../../api-playground';
import { parseOpenApi } from '../../core/openapi';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { addLanguage, archiveVersion, createTranslation, markTranslationCurrent } from '../../i18n';
import { contentHash } from '../../core/scopes';
import { GitContentProvider, pageHistory, restoreText } from '../../git-history';
import { importObsidianVault } from '../../obsidian-import';
import { chooseProvider } from '../../ai';
import { exportEpub, exportPdf } from '../../publish';
import { sharedDashboards, toCsv } from '../../dashboards';
import { newDashboard } from '../../dashboard-editor';
import { parseDashboard, serializeDashboard } from '../../core/dashboard';
import { existsSync } from 'node:fs';
const waitFor = async (
  check: () => boolean | Promise<boolean>,
  message: string,
  timeout = 15000,
) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`Timed out: ${message}`);
};
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<WikiStudioApi>('notespace.notespace');
  assert.ok(extension);
  const api = await extension.activate();
  const ws = api.workspace;
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      // On GitHub Actions, failures also become annotations (readable without the full log).
      const text = error instanceof Error ? error.stack || error.message : String(error);
      console.error(`FAIL ${passed + 1}: ${name}\n${text}`);
      if (process.env.GITHUB_ACTIONS)
        console.log(
          `::error title=Integration test ${passed + 1} failed::${name}: ${text.slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`,
        );
      throw error;
    }
    console.log(`PASS ${++passed}: ${name}`);
  };
  await test('activates all commands with two isolated wiki roots', async () => {
    assert.equal(ws.roots.length, 2);
    const commands = await vscode.commands.getCommands(true);
    for (const name of [
      'initialize',
      'newPage',
      'dailyNote',
      'search',
      'preview',
      'graph',
      'renamePage',
      'deletePage',
      'export',
      'refresh',
      'insertLink',
      'openPage',
    ])
      assert.ok(commands.includes(`notespace.${name}`), name);
  });
  const root = ws.roots[0],
    other = ws.roots[1];
  let home: vscode.Uri, target: vscode.Uri;
  await test('creates persistent pages, folders and parses metadata', async () => {
    home = await ws.createPage(
      root,
      'Home',
      '---\ntags: [start]\n---\n# Home\n\n[[folder/Target#details|Target]] and [Target](folder/Target.md#details)\n\n[[Missing]]\n',
    );
    target = await ws.createPage(
      root,
      'folder/Target',
      '# Target\n\n## Details\n\n[Home](../Home.md)\n\nUse `<script>alert(1)</script>` as an example.\n\n```md\n:::unknown\n[ref]: Guide.md\n```\n',
    );
    await ws.createPage(other, 'Home', '# Other Home\n');
    assert.equal(ws.index.pages.size, 3);
    assert.deepEqual(ws.index.byUri(home.toString())?.tags, ['start']);
    assert.match(Buffer.from(await vscode.workspace.fs.readFile(target)).toString(), /# Target/);
  });
  await test('prevents overwrite and unsafe paths without modifying data', async () => {
    await assert.rejects(ws.createPage(root, '../outside', 'bad'));
    await assert.rejects(ws.createPage(root, 'Home', 'bad'));
    assert.match(Buffer.from(await vscode.workspace.fs.readFile(home)).toString(), /# Home/);
  });
  await test('rejects case-only folder collisions across filesystems', async () => {
    const existing = await ws.createPage(other, 'Projects/Existing', '# Existing\n');
    await assert.rejects(ws.createPage(other, 'projects/New', '# New\n'), /letter case/);
    await assert.rejects(ws.createSection(other, 'projects'), /letter case/);
    assert.match(Buffer.from(await vscode.workspace.fs.readFile(existing)).toString(), /Existing/);
  });
  await test('dropping on empty Explorer space uses the dragged page’s wiki root', async () => {
    const source = await ws.createPage(other, 'nested/MoveMe', '# Move me\n');
    const page = ws.index.byUri(source.toString())!;
    const tree = new WikiTree(ws, 'pages', api.activity);
    try {
      const transfer = new vscode.DataTransfer();
      tree.handleDrag([{ label: page.title, root: page.root, page }], transfer);
      await tree.handleDrop(undefined, transfer);
      const destination = vscode.Uri.joinPath(other.uri, 'MoveMe.md');
      assert.ok(ws.index.byUri(destination.toString()));
      assert.equal(ws.index.byUri(source.toString()), undefined);
      assert.equal(
        ws.index.byUri(vscode.Uri.joinPath(root.uri, 'MoveMe.md').toString()),
        undefined,
      );
    } finally {
      tree.dispose();
    }
  });
  await test('resolves links through the real definition, references, hover and completion APIs', async () => {
    const doc = await vscode.workspace.openTextDocument(home);
    await vscode.window.showTextDocument(doc);
    const pos = doc.positionAt(doc.getText().indexOf('folder/Target') + 4);
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      home,
      pos,
    );
    assert.ok(
      definitions?.some((d) => d.uri.toString() === target.toString() && d.range.start.line === 2),
    );
    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      target,
      new vscode.Position(0, 3),
    );
    assert.ok(refs.length >= 2);
    const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      home,
      pos,
    );
    assert.ok(hover.length > 0);
    const items = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      home,
      doc.positionAt(doc.getText().indexOf('folder/Target') + 1),
      '[',
    );
    assert.ok(items.items.some((i) => i.label === 'Target'));
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      target,
    );
    assert.ok(symbols.some((s) => s.name === 'Details'));
  });
  await test('opening Code mode preserves an existing source cursor', async () => {
    const doc = await vscode.workspace.openTextDocument(home);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const cursor = doc.positionAt(doc.getText().indexOf('folder/Target') + 4);
    editor.selection = new vscode.Selection(cursor, cursor);
    await showPage(home);
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), home.toString());
    assert.deepEqual(vscode.window.activeTextEditor?.selection.active, cursor);
  });
  await test('reports broken links and updates diagnostics from unsaved edits', async () => {
    await waitFor(
      () =>
        vscode.languages
          .getDiagnostics(home)
          .some((d) => d.source === 'NoteSpace' && d.message.includes('Missing')),
      'broken-link diagnostic',
    );
    const doc = await vscode.workspace.openTextDocument(home),
      edit = new vscode.WorkspaceEdit();
    const offset = doc.getText().indexOf('[[Missing]]');
    edit.replace(
      home,
      new vscode.Range(doc.positionAt(offset), doc.positionAt(offset + 11)),
      '[[folder/Target]]',
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
    await waitFor(
      () => !vscode.languages.getDiagnostics(home).some((d) => d.source === 'NoteSpace'),
      'live diagnostics clear',
    );
    assert.equal(doc.isDirty, true);
    assert.equal(ws.index.backlinks(ws.index.byUri(target.toString())!).length, 3);
    await doc.save();
  });
  await test('renames and rewrites incoming and outgoing links as one workspace edit', async () => {
    const before = ws.index.byUri(target.toString())!;
    await api.activity.toggleFavorite(before);
    target = await ws.renamePage(before, 'moved/Deep/Renamed');
    await waitFor(
      () => api.activity.favoritePages().some((favorite) => favorite.uri === target.toString()),
      'favorite follows page rename',
    );
    const homeDoc = await vscode.workspace.openTextDocument(home),
      targetDoc = await vscode.workspace.openTextDocument(target);
    assert.match(homeDoc.getText(), /\[\[\/moved\/Deep\/Renamed#details\|Target\]\]/);
    assert.match(homeDoc.getText(), /\]\(moved\/Deep\/Renamed.md#details\)/);
    assert.match(targetDoc.getText(), /\]\(\.\.\/\.\.\/Home.md\)/);
    assert.equal(ws.index.byUri(target.toString())?.path, 'moved/Deep/Renamed.md');
    await vscode.workspace.saveAll(false);
    await ws.refresh();
    assert.equal(
      ws.index.resolve(ws.index.byUri(home.toString())!, '/moved/Deep/Renamed').page?.uri,
      target.toString(),
    );
  });
  await test('reacts to files created, changed and removed outside the editor', async () => {
    const uri = vscode.Uri.joinPath(root.uri, 'External.md');
    await vscode.workspace.fs.writeFile(uri, Buffer.from('# External\n[[Home]]'));
    await waitFor(() => !!ws.index.byUri(uri.toString()), 'external create');
    await vscode.workspace.fs.writeFile(uri, Buffer.from('# Updated\n'));
    await waitFor(() => ws.index.byUri(uri.toString())?.title === 'Updated', 'external edit');
    await vscode.workspace.fs.delete(uri);
    await waitFor(() => !ws.index.byUri(uri.toString()), 'external delete');
  });
  await test('opens real webview panels and navigates via the public command', async () => {
    await vscode.commands.executeCommand('notespace.openPage', target.toString());
    await waitFor(
      () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some(
            (tab) =>
              tab.input instanceof vscode.TabInputCustom &&
              tab.input.viewType === 'notespace.visual' &&
              tab.input.uri.toString() === target.toString(),
          ),
      'supported Markdown opens in Studio',
    );
    // Wiki links round-trip in Studio, so a page that only uses them opens visually too.
    await vscode.commands.executeCommand('notespace.openPage', home.toString());
    await waitFor(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input instanceof vscode.TabInputCustom && input.uri.toString() === home.toString();
    }, 'wiki-link page opens in Studio');
    await vscode.commands.executeCommand('notespace.preview');
    api.panels.openGraph(root.id);
    await api.panels.refresh();
    await waitFor(() => {
      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
      return (
        tabs.some((t) => t.label === 'Preview: Home') &&
        tabs.some((t) => t.label === 'Wiki Link Graph')
      );
    }, 'webview tab titles');
  });
  await test('mode switching replaces the tab in place and keeps unsaved edits', async () => {
    const tabsFor = (uri: vscode.Uri) =>
      vscode.window.tabGroups.all.flatMap((group) =>
        group.tabs
          .filter(
            (tab) =>
              (tab.input instanceof vscode.TabInputCustom ||
                tab.input instanceof vscode.TabInputText) &&
              tab.input.uri.toString() === uri.toString(),
          )
          .map((tab) => ({ tab, group: group.viewColumn })),
      );
    await vscode.commands.executeCommand('notespace.openPage', home.toString());
    await waitFor(
      () => tabsFor(home).some((t) => t.tab.input instanceof vscode.TabInputCustom),
      'Studio tab',
    );
    const doc = await vscode.workspace.openTextDocument(home);
    const original = doc.getText();
    const edit = new vscode.WorkspaceEdit();
    edit.insert(home, doc.positionAt(original.length), '\nUnsaved mode-switch line\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(doc.isDirty);
    await vscode.commands.executeCommand('notespace.source');
    await waitFor(
      () => tabsFor(home).length === 1 && tabsFor(home)[0].tab.input instanceof vscode.TabInputText,
      'Code mode replaces the Studio tab',
    );
    assert.ok(doc.isDirty);
    assert.match(doc.getText(), /Unsaved mode-switch line/);
    await vscode.commands.executeCommand('notespace.visual');
    await waitFor(
      () =>
        tabsFor(home).length === 1 && tabsFor(home)[0].tab.input instanceof vscode.TabInputCustom,
      'Studio replaces the Code tab',
    );
    assert.match(doc.getText(), /Unsaved mode-switch line/);
    await vscode.commands.executeCommand('notespace.split');
    await waitFor(() => {
      const tabs = tabsFor(home);
      return (
        tabs.length === 2 &&
        tabs.some((t) => t.tab.input instanceof vscode.TabInputCustom) &&
        tabs.some((t) => t.tab.input instanceof vscode.TabInputText) &&
        new Set(tabs.map((t) => t.group)).size === 2
      );
    }, 'Split shows Studio and Code side by side');
    assert.match(doc.getText(), /Unsaved mode-switch line/);
    assert.ok(doc.isDirty, 'Split keeps unsaved edits');
    // Closing the native companion while Studio stays open must not discard the edits.
    await vscode.commands.executeCommand('notespace.split');
    await waitFor(
      () =>
        tabsFor(home).length === 1 && tabsFor(home)[0].tab.input instanceof vscode.TabInputCustom,
      'running Split again returns to Studio only',
    );
    assert.ok(
      doc.isDirty && /Unsaved mode-switch line/.test(doc.getText()),
      'leaving Split keeps edits',
    );
    const revert = new vscode.WorkspaceEdit();
    revert.replace(
      home,
      new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
      original,
    );
    assert.ok(await vscode.workspace.applyEdit(revert));
    await doc.save();
    // Close only this test's tabs: other pages still hold unsaved rename edits from earlier tests.
    await vscode.window.tabGroups.close(tabsFor(home).map((t) => t.tab));
  });
  await test('exports a self-contained snapshot with working links, images and report', async () => {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root.uri, 'images'));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(root.uri, 'images', 'dot.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const doc = await vscode.workspace.openTextDocument(home),
      edit = new vscode.WorkspaceEdit();
    edit.insert(home, doc.positionAt(doc.getText().length), '\n![Dot](images/dot.png)\n');
    await vscode.workspace.applyEdit(edit);
    const exported = await api.exportWiki(
      ws,
      root,
      vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports')),
    );
    assert.equal(exported.pages, 2);
    assert.deepEqual(exported.warnings, []);
    const read = async (file: string) =>
      Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(exported.uri, file)),
      ).toString();
    assert.match(await read('index.html'), /pages\/Home.html/);
    assert.match(await read('pages/Home.html'), /href="moved\/Deep\/Renamed.html#details"/);
    assert.match(await read('pages/Home.html'), /src="\.\.\/assets\/images\/dot.png"/);
    assert.ok(
      (await vscode.workspace.fs.stat(vscode.Uri.joinPath(exported.uri, 'assets/images/dot.png')))
        .size > 0,
    );
    assert.deepEqual(JSON.parse(await read('export-report.json')).warnings, []);
  });
  await test('cancellation cleans partial exports and keeps existing files', async () => {
    const parent = vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports')),
      before = await vscode.workspace.fs.readDirectory(parent),
      cts = new vscode.CancellationTokenSource();
    cts.cancel();
    await assert.rejects(api.exportWiki(ws, root, parent, cts.token), vscode.CancellationError);
    cts.dispose();
    assert.deepEqual(await vscode.workspace.fs.readDirectory(parent), before);
  });
  await test('symlink writes cannot leave the wiki', async () => {
    if (process.platform === 'win32') return;
    const link = vscode.Uri.joinPath(root.uri, 'linked');
    await symlink(other.uri.fsPath, link.fsPath);
    await assert.rejects(ws.createPage(root, 'linked/Unsafe', 'unsafe'), /Symbolic links/);
    await assert.rejects(readFile(path.join(other.uri.fsPath, 'Unsafe.md')));
    await vscode.workspace.fs.delete(link);
  });
  await test('portable trash preserves unsaved content, restores links and refuses overwrite', async () => {
    const uri = await ws.createPage(root, 'TrashMe', '# Trash me\n');
    const doc = await vscode.workspace.openTextDocument(uri),
      edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(1, 0), 'Unsaved content');
    await vscode.workspace.applyEdit(edit);
    assert.equal(doc.isDirty, true);
    const trashed = await ws.trashPage(ws.index.byUri(uri.toString())!);
    assert.equal(ws.index.byUri(uri.toString()), undefined);
    assert.equal((await ws.deletedPages(root)).length, 1);
    const config = vscode.workspace.getConfiguration('notespace', root.folder.uri);
    await config.update(
      'exclude',
      '**/node_modules/**',
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await ws.refresh();
    assert.ok(ws.index.all(root.id).every((p) => !p.path.includes('.notespace-trash')));
    await config.update('exclude', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    assert.match(
      Buffer.from(await vscode.workspace.fs.readFile(trashed)).toString(),
      /Unsaved content/,
    );
    await ws.createPage(root, 'TrashMe', '# Replacement');
    await assert.rejects(ws.restorePage(root, trashed), /already exists/);
    await vscode.workspace.fs.delete(uri);
    await ws.refresh();
    await ws.restorePage(root, trashed);
    assert.match(ws.index.byUri(uri.toString())!.text, /Unsaved content/);
    await vscode.workspace.fs.delete(uri);
    await ws.refresh();
  });
  await test('size budgets skip oversized input with actionable warnings', async () => {
    const config = vscode.workspace.getConfiguration('notespace');
    const large = vscode.Uri.joinPath(root.uri, 'Large.md');
    await vscode.workspace.fs.writeFile(large, Buffer.alloc(2048, 120));
    await config.update('maxFileSizeKB', 1, vscode.ConfigurationTarget.Workspace);
    await ws.refresh();
    assert.equal(ws.index.byUri(large.toString()), undefined);
    assert.ok(ws.issues.some((i) => i.includes('exceeds size limit')));
    await config.update('maxFileSizeKB', undefined, vscode.ConfigurationTarget.Workspace);
    const second = vscode.Uri.joinPath(root.uri, 'Large2.md');
    await vscode.workspace.fs.writeFile(large, Buffer.alloc(600 * 1024, 120));
    await vscode.workspace.fs.writeFile(second, Buffer.alloc(600 * 1024, 120));
    await config.update('maxIndexSizeMB', 1, vscode.ConfigurationTarget.Workspace);
    await ws.refresh();
    assert.ok(ws.issues.some((i) => i.includes('index size budget exceeded')));
    assert.ok([large, second].filter((uri) => ws.index.byUri(uri.toString())).length <= 1);
    await vscode.workspace.fs.delete(large);
    await vscode.workspace.fs.delete(second);
    await config.update('maxIndexSizeMB', undefined, vscode.ConfigurationTarget.Workspace);
    await ws.refresh();
  });
  await test('configuration changes rebuild the index without leaking previous diagnostics', async () => {
    await vscode.workspace
      .getConfiguration('notespace')
      .update('diagnostics', false, vscode.ConfigurationTarget.Workspace);
    await waitFor(
      () =>
        vscode.languages
          .getDiagnostics()
          .every(([, ds]) => ds.every((d) => d.source !== 'NoteSpace')),
      'diagnostics disabled',
    );
    await vscode.workspace
      .getConfiguration('notespace', other.folder.uri)
      .update('root', 'notes', vscode.ConfigurationTarget.WorkspaceFolder);
    await waitFor(() => !ws.index.all(other.id).length, 'root changed');
    assert.equal(ws.index.all(root.id).length, 2);
  });
  await test('moves a section and rewrites internal and incoming links', async () => {
    const a = await ws.createPage(root, 'chapter/First', '# First\n\n[Second](Second.md)\n');
    await api.activity.toggleFavorite(ws.index.byUri(a.toString())!);
    await ws.createPage(root, 'chapter/Second', '# Second\n\n[First](First.md)\n');
    const outside = await ws.createPage(
      root,
      'Outside',
      '# Outside\n\n[First](chapter/First.md)\n',
    );
    const moved = await ws.moveSection(root, 'chapter/', 'reference');
    assert.deepEqual(moved.warnings, []);
    const newA = vscode.Uri.joinPath(root.uri, 'reference', 'First.md');
    await waitFor(
      () => api.activity.favoritePages().some((favorite) => favorite.uri === newA.toString()),
      'favorite follows section move',
    );
    assert.equal(ws.index.byUri(a.toString()), undefined);
    assert.ok(ws.index.byUri(newA.toString()));
    assert.match(
      (await vscode.workspace.openTextDocument(outside)).getText(),
      /reference\/First\.md/,
    );
    assert.match((await vscode.workspace.openTextDocument(newA)).getText(), /Second\.md/);
    await vscode.workspace.saveAll(false);
    const trashed = await ws.trashSection(root, 'reference/');
    assert.equal(ws.index.byUri(newA.toString()), undefined);
    assert.ok((await vscode.workspace.fs.stat(trashed)).type & vscode.FileType.Directory);
  });
  await test('discovers a versioned wiki, creates sections, and exports draft-free pages', async () => {
    const project = vscode.Uri.joinPath(root.folder.uri, 'product-docs');
    const config = defaultConfig('Product Docs');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(project, 'docs'));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(project, 'wiki.yaml'),
      Buffer.from(createConfig(config)),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(project, 'docs', 'index.md'),
      Buffer.from(
        '# Product Docs\n\n:::note\nWelcome\n:::\n\n```mermaid\nflowchart TD\n A --> B\n```\n',
      ),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(project, 'docs', 'draft.md'),
      Buffer.from('---\ndraft: true\n---\n# Secret\n'),
    );
    await ws.refresh();
    const versioned = ws.roots.find((r) => r.projectUri?.toString() === project.toString());
    assert.ok(versioned);
    assert.equal(versioned.name, 'Product Docs');
    const section = await ws.createSection(versioned, 'guide');
    assert.equal(section.path, vscode.Uri.joinPath(project, 'docs', 'guide').path);
    assert.ok(ws.index.all(versioned.id).some((p) => p.path === 'guide/index.md'));
    const imageSource = vscode.Uri.joinPath(root.folder.uri, 'test-image.png');
    await vscode.workspace.fs.writeFile(
      imageSource,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const imagePath = await importImage(
      ws,
      versioned,
      ws.index.all(versioned.id).find((p) => p.path === 'index.md')!,
      imageSource,
    );
    assert.equal(imagePath, '../assets/images/test-image.png');
    const imageFile = vscode.Uri.joinPath(project, 'assets', 'images', 'test-image.png');
    assert.ok((await vscode.workspace.fs.stat(imageFile)).size > 0);
    const attachmentSource = vscode.Uri.joinPath(root.folder.uri, 'notes.txt');
    await vscode.workspace.fs.writeFile(attachmentSource, Buffer.from('Portable attachment\n'));
    const attachmentPath = await importAttachment(
      ws,
      versioned,
      ws.index.all(versioned.id).find((p) => p.path === 'index.md')!,
      attachmentSource,
    );
    assert.equal(attachmentPath, '../assets/attachments/notes.txt');
    const homepage = vscode.Uri.joinPath(project, 'docs', 'index.md');
    const homepageDoc = await vscode.workspace.openTextDocument(homepage);
    const imageEdit = new vscode.WorkspaceEdit();
    imageEdit.insert(
      homepage,
      homepageDoc.positionAt(homepageDoc.getText().length),
      `\n![Test](${imagePath})\n\n[Notes](${attachmentPath})\n`,
    );
    await vscode.workspace.applyEdit(imageEdit);
    await homepageDoc.save();
    const output = vscode.Uri.joinPath(root.folder.uri, 'versioned-export');
    await vscode.workspace.fs.createDirectory(output);
    const result = await api.exportWiki(ws, versioned, output);
    assert.equal(result.pages, 2);
    const html = Buffer.from(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(result.uri, 'pages', 'index.html')),
    ).toString();
    assert.match(html, /class="callout note rich-block rich-note"/);
    assert.match(html, /data:image\/svg\+xml;base64/);
    assert.match(html, /site\.css/);
    assert.match(html, /assets\/images\/test-image\.png/);
    assert.match(html, /assets\/attachments\/notes\.txt/);
    assert.equal(
      Buffer.from(
        await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(result.uri, 'assets', 'attachments', 'notes.txt'),
        ),
      ).toString(),
      'Portable attachment\n',
    );
    assert.ok(
      (
        await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(result.uri, 'assets', 'images', 'test-image.png'),
        )
      ).size > 0,
    );
    await assert.rejects(async () =>
      vscode.workspace.fs.stat(vscode.Uri.joinPath(result.uri, 'pages', 'draft.html')),
    );
    await vscode.workspace.fs.delete(output, { recursive: true });
  });
  await test('imports MkDocs and generic Markdown in place with safe reporting', async () => {
    const project = vscode.Uri.joinPath(root.folder.uri, 'import-fixture');
    const docs = vscode.Uri.joinPath(project, 'docs');
    await vscode.workspace.fs.createDirectory(docs);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(project, 'mkdocs.yml'),
      Buffer.from(
        'site_name: Imported Docs\nsite_description: Example\ntheme:\n  name: material\nnav:\n  - Home: index.md\n',
      ),
    );
    const source = '# Imported\n\n{{ include "snippet.md" name="Reader" }}\n';
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(docs, 'index.md'), Buffer.from(source));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(docs, 'snippet.md'),
      Buffer.from('Hello **{{name}}**.\n\n![Dot](dot.png)\n\n{{ include "index.md" }}\n'),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(docs, 'dot.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const result = await importMarkdownProject(ws, project);
    assert.equal(result.pages, 2);
    assert.equal(result.homepage?.path, 'index.md');
    assert.ok(result.warnings.some((warning) => warning.includes('nav')));
    assert.equal(
      Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(docs, 'index.md')),
      ).toString(),
      source,
    );
    const imported = ws.roots.find((r) => r.projectUri?.toString() === project.toString())!;
    assert.equal(imported.name, 'Imported Docs');
    const output = vscode.Uri.joinPath(root.folder.uri, 'import-output');
    await vscode.workspace.fs.createDirectory(output);
    const exported = await api.exportWiki(ws, imported, output);
    const html = Buffer.from(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(exported.uri, 'pages', 'index.html')),
    ).toString();
    assert.match(html, /Hello <strong>Reader<\/strong>/);
    assert.match(html, /assets\/dot\.png/);
    assert.match(html, /Include cycle or depth limit/);
    assert.ok(exported.warnings.some((warning) => warning.includes('Include cycle')));
    assert.ok(
      (await vscode.workspace.fs.stat(vscode.Uri.joinPath(exported.uri, 'assets', 'dot.png')))
        .size > 0,
    );
    await assert.rejects(importMarkdownProject(ws, project), /already has wiki.yaml/);
    const generic = vscode.Uri.joinPath(root.folder.uri, 'generic-fixture');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(generic, 'docs'));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(generic, 'docs', 'readme.md'),
      Buffer.from('# Generic\n'),
    );
    const genericResult = await importMarkdownProject(ws, generic);
    assert.equal(genericResult.pages, 1);
    assert.equal(genericResult.homepage?.path, 'readme.md');
    await assert.rejects(
      importMarkdownProject(ws, vscode.Uri.file('/tmp/not-in-workspace')),
      /inside an open workspace/,
    );
  });
  await test('planner adds, edits, completes and undoes tasks through page Markdown', async () => {
    const planner = api.planner;
    // Earlier tests turn the first folder into a versioned wiki; use the wiki as it is now.
    const root = ws.roots[0];
    const today = planner.today(root);
    const tomorrow = addDays(today, 1);
    // Quick add creates the inbox page and resolves relative dates.
    const added = await planner.add(root, 'Call Bob due:tomorrow #sales', { kind: 'inbox' });
    const inbox = (await readFile(added.uri.fsPath, 'utf8')).split('\n');
    assert.equal(inbox[added.line], `- [ ] Call Bob due:${tomorrow} #sales`);
    await waitFor(
      () => planner.tasks(root.id).some((t) => t.title === 'Call Bob #sales'),
      'task indexed',
    );
    // A page with unsaved user edits stays unsaved; only the task line changes.
    const plan = await ws.createPage(
      root,
      'planning/Board',
      '# Board\n\n- [ ] Draft spec due:2026-01-10 priority:high ^t-spec01\n- [ ] Water plants due:2026-01-05 repeat:weekly ^t-water1\n\nNotes stay here.\n',
    );
    await waitFor(
      () => planner.tasks(root.id).some((t) => t.id === 't-spec01'),
      'page tasks indexed',
    );
    const doc = await vscode.workspace.openTextDocument(plan);
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(plan, doc.positionAt(doc.getText().length), 'Unsaved user line.\n');
    await vscode.workspace.applyEdit(edit);
    const spec = planner.tasks(root.id).find((t) => t.id === 't-spec01')!;
    await planner.update(spec.key, { status: 'doing', due: '2026-01-12' });
    assert.ok(doc.isDirty, 'unsaved user edits are not saved by the planner');
    assert.equal(
      doc.lineAt(2).text,
      '- [ ] Draft spec due:2026-01-12 priority:high status:doing ^t-spec01',
    );
    assert.match(doc.getText(), /Unsaved user line\./);
    // Native undo reverts the planner's edit.
    await vscode.commands.executeCommand('undo');
    assert.equal(doc.lineAt(2).text, '- [ ] Draft spec due:2026-01-10 priority:high ^t-spec01');
    await doc.save();
    // Completing a recurring task keeps history and inserts the next occurrence.
    await waitFor(
      () => planner.tasks(root.id).some((t) => t.id === 't-water1'),
      'recurring task indexed',
    );
    const water = planner.tasks(root.id).find((t) => t.id === 't-water1')!;
    await planner.complete(water.key);
    const lines = doc.getText().split('\n');
    assert.equal(
      lines[3],
      `- [x] Water plants due:2026-01-05 repeat:weekly done:${today} ^t-water1`,
    );
    assert.match(lines[4], /^- \[ \] Water plants due:2026-01-12 repeat:weekly \^t-[a-z0-9]{6}$/);
    assert.equal(doc.isDirty, false, 'a clean page is saved after a planner edit');
    // External edits on disk (another tool, Git) are picked up by every view.
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    // Written with Node's fs, like Git or another editor would, right after VS Code's save.
    await writeFile(
      plan.fsPath,
      (await readFile(plan.fsPath, 'utf8')).replace('Draft spec', 'Draft the spec'),
    );
    await waitFor(
      () => planner.tasks(root.id).some((t) => t.title === 'Draft the spec'),
      'external edit visible',
    );
  });
  await test('daily notes use the configured folder and template and navigate by date', async () => {
    const planner = api.planner;
    const root = ws.roots[0];
    await ws.createPage(
      root,
      '.templates/Day.md',
      '# {{title}}\n\n{{weekday}} · [[/journal/{{yesterday}}|Yesterday]]\n\n## Tasks\n',
    );
    const settings = vscode.workspace.getConfiguration('notespace', root.folder.uri);
    await settings.update(
      'dailyNotes.folder',
      'journal',
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await settings.update(
      'dailyNotes.template',
      '.templates/Day.md',
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    try {
      const uri = await planner.ensureDaily(root, '2026-10-14');
      assert.match(uri.path, /journal\/2026-10-14\.md$/);
      assert.equal(
        await readFile(uri.fsPath, 'utf8'),
        '# 2026-10-14\n\nWednesday · [[/journal/2026-10-13|Yesterday]]\n\n## Tasks\n',
      );
      await planner.ensureDaily(root, '2026-10-10');
      await waitFor(() => planner.dailyNotes(root).size === 2, 'daily notes indexed');
      await vscode.commands.executeCommand('notespace.openPage', uri.toString());
      await vscode.commands.executeCommand('notespace.dailyNotePrevious');
      await waitFor(() => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as
          { uri?: vscode.Uri } | undefined;
        return !!input?.uri?.path.endsWith('journal/2026-10-10.md');
      }, 'previous daily note opens the earlier existing note');
      assert.equal(planner.dailyNotes(root).get('2026-10-14')?.path, 'journal/2026-10-14.md');
      await assert.rejects(planner.ensureDaily(root, '14/10/2026'));
    } finally {
      await settings.update(
        'dailyNotes.folder',
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await settings.update(
        'dailyNotes.template',
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    }
  });
  await test('exports keep daily notes, the inbox and task embeds private unless enabled', async () => {
    const root = ws.roots[0];
    const planner = api.planner;
    await planner.ensureDaily(root, '2026-10-13');
    await ws.createPage(root, 'planning/Status', '# Status\n\n```tasks\nstatus: open\n```\n');
    await waitFor(
      () => ws.index.all(root.id).some((p) => p.path === 'planning/Status.md'),
      'status page',
    );
    const parent = vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports'));
    const privateExport = await api.exportWiki(ws, root, parent, undefined, { planner });
    const files = async (dir: vscode.Uri): Promise<string[]> =>
      (await vscode.workspace.fs.readDirectory(dir)).flatMap(([name]) => [name]);
    assert.ok(!(await files(vscode.Uri.joinPath(privateExport.uri, 'pages'))).includes('daily'));
    assert.ok(
      !(await files(vscode.Uri.joinPath(privateExport.uri, 'pages'))).includes('Inbox.html'),
    );
    assert.ok(!(await files(privateExport.uri)).includes('planner.html'));
    const status = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(privateExport.uri, 'pages/planning/Status.html'),
      ),
    );
    assert.match(status, /Planner data is not included in this export/);
    assert.doesNotMatch(status, /Call Bob/);
    console.log(
      `planner export opt-in branch: ${root.projectUri ? 'runs' : 'skipped (no wiki.yaml)'}`,
    );
    if (!root.projectUri) return;
    // Opting in exports journals, the inbox, task embeds and a read-only planner snapshot.
    const configUri = vscode.Uri.joinPath(root.projectUri, 'wiki.yaml');
    const original = new TextDecoder().decode(await vscode.workspace.fs.readFile(configUri));
    const config = parseConfig(original);
    config.features.plannerExport = true;
    await vscode.workspace.fs.writeFile(
      configUri,
      new TextEncoder().encode(updateConfig(original, config)),
    );
    try {
      await ws.refresh();
      const current = ws.roots[0];
      // Refreshing rebuilds the index in the background; export once the journal and tasks are back.
      await waitFor(
        () =>
          ws.index.all(current.id).some((p) => p.path.endsWith('2026-10-13.md')) &&
          planner.tasks(current.id).some((t) => t.title.startsWith('Call Bob')),
        'index rebuilt after enabling planner export',
      );
      const shared = await api.exportWiki(ws, current, parent, undefined, { planner });
      assert.ok((await files(vscode.Uri.joinPath(shared.uri, 'pages'))).includes('daily'));
      const snapshot = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(shared.uri, 'planner.html')),
      );
      assert.match(snapshot, /Read-only snapshot/);
      assert.match(snapshot, /Call Bob/);
      const embed = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(shared.uri, 'pages/planning/Status.html'),
        ),
      );
      assert.match(embed, /Call Bob/);
      assert.match(embed, /disabled/);
    } finally {
      await vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(original));
      await ws.refresh();
    }
  });
  await test('notebooks open without a kernel and import, charts, canvases and APIs export statically', async () => {
    const root = ws.roots[0];
    const notebook = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
      cells: [
        { cell_type: 'markdown', metadata: {}, source: ['# Analysis\n', 'Notes'] },
        {
          cell_type: 'code',
          metadata: {},
          execution_count: 1,
          source: ['print(6 * 7)'],
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['42\n'] }],
        },
        {
          cell_type: 'code',
          metadata: {},
          execution_count: 2,
          source: ['html()'],
          outputs: [
            {
              output_type: 'display_data',
              metadata: {},
              data: { 'text/html': '<b>bold</b><script>alert(1)</script>' },
            },
          ],
        },
      ],
    });
    const outside = vscode.Uri.file(
      path.join(process.env.WIKI_TEST_DIR!, 'exports', 'Analysis.ipynb'),
    );
    await vscode.workspace.fs.writeFile(outside, new TextEncoder().encode(notebook));
    const imported = await importNotebook(ws, root, outside);
    assert.match(imported.path, /\/notebooks\/Analysis\.ipynb$/);
    const again = await importNotebook(ws, root, outside);
    assert.match(again.path, /Analysis-1\.ipynb$/, 'import never overwrites');
    await vscode.workspace.fs.delete(again);
    // VS Code's built-in notebook editor opens it; no kernel is needed to view saved outputs.
    await vscode.commands.executeCommand('notespace.openNotebook', { uri: imported });
    await waitFor(
      () => vscode.window.activeNotebookEditor?.notebook.uri.toString() === imported.toString(),
      'notebook editor',
    );
    assert.equal(vscode.window.activeNotebookEditor!.notebook.cellCount, 3);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(root.uri, 'data/visits.csv'),
      new TextEncoder().encode('week,visits\nW1,10\nW2,20\n'),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(root.uri, 'canvases/Map.canvas'),
      new TextEncoder().encode(
        JSON.stringify({
          nodes: [{ id: 'a', type: 'text', text: 'Idea card', x: 0, y: 0, width: 200, height: 60 }],
          edges: [],
          custom: 1,
        }),
      ),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(root.uri, 'api/pets.yaml'),
      new TextEncoder().encode(
        'openapi: 3.0.3\ninfo: {title: Pets, version: "1"}\npaths:\n  /pets:\n    get:\n      operationId: listPets\n      summary: List pets\n      responses: {"200": {description: OK}}\n',
      ),
    );
    await ws.createPage(
      root,
      'Visuals',
      '# Visuals\n\n```chart\ntype: bar\ntitle: Visits\ndata: data/visits.csv\nx: week\ny: visits\n```\n\n```notebook\npath: notebooks/Analysis.ipynb\n```\n\n```canvas\npath: canvases/Map.canvas\n```\n\n```openapi\npath: api/pets.yaml\n```\n',
    );
    await waitFor(() => ws.index.all(root.id).some((p) => p.path === 'Visuals.md'), 'visuals page');
    const parent = vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports'));
    const result = await api.exportWiki(ws, root, parent, undefined, { planner: api.planner });
    const html = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(result.uri, 'pages/Visuals.html')),
    );
    assert.match(html, /<desc id="[^"]+">bar chart of visits by week, 2 data points\.<\/desc>/);
    assert.match(html, />42\n?</);
    assert.match(html, /<b>bold<\/b>/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /Idea card/);
    assert.match(html, /api-method m-get/);
    assert.match(html, /List pets/);
    const nb = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(result.uri, 'notebooks/notebooks/Analysis.html'),
      ),
    );
    assert.match(nb, /42/);
    // The canvas file round-trips unknown fields untouched on disk.
    assert.match(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root.uri, 'canvases/Map.canvas')),
      ),
      /"custom":1/,
    );
  });
  await test('API playground sends real requests with stored secrets that never reach files or exports', async () => {
    const root = ws.roots[0];
    const secret = 'sk-test-' + Math.random().toString(36).slice(2);
    const received: Array<{ url?: string; auth?: string; body: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ url: req.url, auth: req.headers.authorization, body });
        res.writeHead(201, {
          'content-type': 'application/json',
          'x-trace': 'abc',
          'set-cookie': 'session=1',
        });
        res.end(JSON.stringify({ id: 7, ok: true }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const specText = `openapi: 3.0.3\ninfo: {title: Local, version: "1"}\nservers: [{url: "http://127.0.0.1:${port}/v1"}]\ncomponents:\n  securitySchemes:\n    token: {type: http, scheme: bearer}\nsecurity: [{token: []}]\npaths:\n  /items/{id}:\n    post:\n      operationId: saveItem\n      parameters: [{name: id, in: path, required: true, schema: {type: string}}, {name: q, in: query, schema: {type: string}}]\n      requestBody: {content: {application/json: {schema: {type: object, properties: {name: {type: string}}}}}}\n      responses: {"201": {description: Created}}\n`;
      const specUri = vscode.Uri.joinPath(root.uri, 'api/local.yaml');
      await vscode.workspace.fs.writeFile(specUri, new TextEncoder().encode(specText));
      const spec = parseOpenApi(specText);
      await api.context.secrets.store(secretKey(specUri, 'token'), secret);
      const input = {
        server: spec.servers[0].url,
        path: { id: 'a b' },
        query: { q: 'x' },
        headers: {},
        body: '{"name":"Rex"}',
      };
      const questions: string[] = [];
      const answer = (yes: boolean) => async (q: { message: string; detail: string }) => {
        questions.push(`${q.message} ${q.detail}`);
        return yes;
      };
      assert.equal(
        await sendApiRequest(api.context, specUri, spec, 'saveItem', input, answer(false)),
        undefined,
      );
      assert.equal(received.length, 0, 'nothing is sent before the origin is approved');
      assert.match(questions[0], /127\.0\.0\.1.*loopback/, 'loopback targets are named as such');
      // A public approval does not cover a local target.
      const allowed = api.context.workspaceState.get<string[]>('api.allowedOrigins', []);
      await api.context.workspaceState.update('api.allowedOrigins', [
        ...allowed,
        `http://127.0.0.1:${port}`,
      ]);
      questions.length = 0;
      assert.equal(
        await sendApiRequest(api.context, specUri, spec, 'saveItem', input, answer(false)),
        undefined,
      );
      assert.match(questions[0], /Allow NoteSpace/);
      // Approving the origin still leaves the POST to confirm.
      questions.length = 0;
      let step = 0;
      assert.equal(
        await sendApiRequest(api.context, specUri, spec, 'saveItem', input, async (q) => {
          questions.push(q.message);
          return step++ === 0;
        }),
        undefined,
      );
      assert.match(questions[1], /^Send POST http:\/\/127\.0\.0\.1:\d+\/v1\/items\/a%20b\?$/);
      assert.equal(received.length, 0, 'a declined POST is not sent');
      questions.length = 0;
      const response = await sendApiRequest(
        api.context,
        specUri,
        spec,
        'saveItem',
        input,
        answer(true),
      );
      assert.deepEqual(
        questions.length,
        1,
        'the origin is remembered; the POST is confirmed every time',
      );
      const metadata = { ...input, server: 'http://169.254.169.254/latest' };
      await assert.rejects(
        sendApiRequest(api.context, specUri, spec, 'saveItem', metadata, answer(true)),
        /cloud metadata service/,
      );
      assert.equal(response?.status, 201);
      assert.match(response!.body, /"id": 7/);
      assert.ok(response!.headers.some(([k]) => k === 'x-trace'));
      assert.ok(!response!.headers.some(([k]) => k === 'set-cookie'), 'cookies are not shown');
      assert.equal(received[0].url, '/v1/items/a%20b?q=x');
      assert.equal(received[0].auth, `Bearer ${secret}`);
      assert.equal(received[0].body, '{"name":"Rex"}');
      // The secret is only in SecretStorage: not in the wiki, its config, or an export.
      const result = await api.exportWiki(
        ws,
        root,
        vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports')),
        undefined,
        { planner: api.planner },
      );
      const scan = async (dir: vscode.Uri): Promise<void> => {
        for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
          const child = vscode.Uri.joinPath(dir, name);
          if (type === vscode.FileType.Directory) await scan(child);
          else
            assert.ok(
              !new TextDecoder().decode(await vscode.workspace.fs.readFile(child)).includes(secret),
              child.path,
            );
        }
      };
      await scan(root.projectUri || root.uri);
      await scan(result.uri);
      await api.context.secrets.delete(secretKey(specUri, 'token'));
      await vscode.workspace.fs.delete(specUri);
    } finally {
      server.close();
    }
  });
  await test('the Python kernel runs cells only on request and outputs persist in the .ipynb', async () => {
    const root = ws.roots[0];
    const uri = vscode.Uri.joinPath(root.uri, 'notebooks/Kernel.ipynb');
    const cell = (source: string) => ({
      cell_type: 'code',
      metadata: {},
      execution_count: null,
      source: [source],
      outputs: [],
    });
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(
        JSON.stringify({
          nbformat: 4,
          nbformat_minor: 5,
          metadata: {
            kernelspec: { name: 'python3', display_name: 'Python 3' },
            language_info: { name: 'python' },
          },
          cells: [
            cell('x = 6 * 7\nprint(x)'),
            cell('x + 1'),
            cell('1 / 0'),
            cell("input('name? ')"),
            cell('x * 2'),
          ],
        }),
      ),
    );
    const notebook = await vscode.workspace.openNotebookDocument(uri);
    await vscode.window.showNotebookDocument(notebook);
    // Opening never executes anything.
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(
      notebook.getCells().every((c) => c.outputs.length === 0),
      'nothing runs on open',
    );
    await vscode.commands.executeCommand('notebook.selectKernel', {
      id: 'notespace-python',
      extension: 'notespace.notespace',
    });
    await vscode.commands.executeCommand('notebook.execute');
    await waitFor(() => notebook.cellAt(4).outputs.length > 0, 'cells executed');
    const text = (i: number) =>
      notebook
        .cellAt(i)
        .outputs.flatMap((o) =>
          o.items.map((item) => `${item.mime}:${new TextDecoder().decode(item.data)}`),
        )
        .join('\n');
    assert.match(text(0), /application\/vnd\.code\.notebook\.stdout:42/);
    assert.match(text(1), /text\/plain:43/, 'variables persist between cells');
    assert.match(
      text(2),
      /application\/vnd\.code\.notebook\.error:[\s\S]*"name": "ZeroDivisionError"/,
    );
    // input() cannot read the kernel's request channel; later cells still run.
    assert.match(text(3), /input\(\) is not supported/);
    assert.match(text(4), /text\/plain:84/);
    await notebook.save();
    const saved = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
    assert.deepEqual(saved.cells[0].outputs[0].text, ['42\n']);
    assert.deepEqual(saved.cells[1].outputs[0].data['text/plain'], ['43']);
    assert.equal(saved.cells[2].outputs[0].ename, 'ZeroDivisionError');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.workspace.fs.delete(uri);
  });
  await test('code blocks never run unless the setting is enabled', async () => {
    const runner = new CodeRunner();
    assert.equal(vscode.workspace.getConfiguration('notespace').get('codeRunner.enabled'), false);
    assert.deepEqual(runner.available(), {});
    await assert.rejects(
      runner.run('javascript', 'console.log(1)', process.env.WIKI_TEST_DIR!),
      /Enable/,
    );
  });

  await test('languages and archived versions: translations, coverage markers, routes and export', async () => {
    const root = ws.roots.find((r) => r.config?.wiki.title === 'Product Docs')!;
    assert.ok(root?.projectUri, 'versioned test wiki');
    const configUri = vscode.Uri.joinPath(root.projectUri!, 'wiki.yaml');
    const original = new TextDecoder().decode(await vscode.workspace.fs.readFile(configUri));
    const created: vscode.Uri[] = [];
    try {
      await ws.createPage(
        root,
        'i18n/Setup',
        '# Setup\n\nInstall it. See [[Install]].\n\n- [ ] Versioned task due:2026-01-01\n',
      );
      await ws.createPage(root, 'i18n/Install', '# Install\n\nSteps.\n');
      await addLanguage(ws, root, 'it');
      const current = () => ws.roots.find((r) => r.id === root.id)!;
      assert.deepEqual(current().config!.i18n.languages, ['it']);
      assert.match(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(configUri)),
        /i18n:\n {2}languages:\n {4}- it/,
      );
      const setup = ws.index.all(root.id).find((p) => p.path === 'i18n/Setup.md')!;
      const translated = await createTranslation(ws, setup, 'it');
      created.push(vscode.Uri.joinPath(root.uri, 'it'));
      const itText = new TextDecoder().decode(await vscode.workspace.fs.readFile(translated));
      assert.match(
        itText,
        new RegExp(`^---\\ntranslated_from: ${contentHash(setup.body)}\\n---\\n# Setup`),
      );
      assert.equal(
        (await createTranslation(ws, setup, 'it')).toString(),
        translated.toString(),
        'never overwritten',
      );
      await ws.createPage(current(), 'it/i18n/Install', '# Installa\n');
      await ws.refresh();
      const itSetup = ws.index.byUri(translated.toString())!;
      assert.equal(
        ws.index.resolve(itSetup, 'Install').page?.path,
        'it/i18n/Install.md',
        'links stay in the language',
      );
      // Changing the source makes the translation outdated until it is marked current.
      await writeFile(
        vscode.Uri.parse(setup.uri).fsPath,
        '# Setup\n\nInstall it now. See [[Install]].\n\n- [ ] Versioned task due:2026-01-01\n',
      );
      await waitFor(
        () => /now/.test(ws.index.all(root.id).find((p) => p.path === 'i18n/Setup.md')!.body),
        'source updated',
      );
      const { translationCoverage } = await import('../../core/scopes');
      const outdated = () =>
        translationCoverage(ws.index.all(root.id), current().config!).languages[0].outdated.map(
          (o) => o.translation.path,
        );
      assert.deepEqual(outdated(), ['it/i18n/Setup.md']);
      await markTranslationCurrent(ws, ws.index.byUri(translated.toString())!);
      await waitFor(() => outdated().length === 0, 'translation marked current');

      const target = await archiveVersion(ws, current(), '1.0', '2.0');
      created.push(target);
      const config = current().config!;
      assert.deepEqual(config.versions, { current: '2.0', archived: ['1.0'] });
      await waitFor(
        () => ws.index.all(root.id).some((p) => p.path === '_versions/1.0/i18n/Setup.md'),
        'archived pages indexed',
      );
      const archived = ws.index.all(root.id).find((p) => p.path === '_versions/1.0/i18n/Setup.md')!;
      assert.equal(ws.isArchived(archived), true);
      assert.equal(
        ws.index.resolve(archived, 'Install').page?.path,
        '_versions/1.0/i18n/Install.md',
      );
      assert.ok(
        !api.planner.tasks(root.id).some((t) => t.pageId === archived.id),
        'archived tasks stay out of the planner',
      );
      assert.equal(
        api.planner.tasks(root.id).filter((t) => t.title === 'Versioned task').length,
        1,
        'translations and archived copies do not duplicate tasks',
      );
      assert.match(archived.text, /Versioned task/);
      await assert.rejects(archiveVersion(ws, current(), '1.0'), /already archived/);
      assert.ok(
        !ws.index
          .search('Setup', root.id, (p) => !ws.isArchived(p))
          .some((r) => ws.isArchived(r.page)),
      );

      const result = await api.exportWiki(
        ws,
        current(),
        vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports')),
        undefined,
        { planner: api.planner },
      );
      const read = async (file: string) =>
        new TextDecoder().decode(
          await vscode.workspace.fs.readFile(vscode.Uri.joinPath(result.uri, file)),
        );
      const old = await read('pages/_versions/1.0/i18n/Setup.html');
      assert.match(old, /class="archived-banner"/);
      assert.match(
        old,
        /<nav class="site-variants" aria-label="Version"><a href="\.\.\/\.\.\/\.\.\/i18n\/Setup\.html">2\.0<\/a><span aria-current="true">1\.0<\/span>/,
      );
      const it = await read('pages/it/i18n/Setup.html');
      assert.match(it, /^<!doctype html><html lang="it">/);
      assert.match(
        it,
        /<a href="\.\.\/\.\.\/i18n\/Setup\.html" hreflang="en">en<\/a><span aria-current="true">it<\/span>/,
      );
      assert.doesNotMatch(
        it.split('<main')[0],
        />Setup<\/a><\/li>.*_versions/,
        'navigation stays in scope',
      );
      const index = JSON.parse(await read('search-index.json')) as Array<{
        path: string;
        scope: string;
      }>;
      assert.equal(index.find((e) => e.path === 'pages/it/i18n/Setup.html')?.scope, 'it');
      assert.equal(
        index.find((e) => e.path === 'pages/_versions/1.0/i18n/Setup.html')?.scope,
        '_versions/1.0',
      );
      assert.match(
        await read('index.html'),
        /<section aria-label="Archived versions"><h2>Archived versions<\/h2><ul><li><a href="pages\/_versions\/1\.0\//,
      );
      // Version aliases: latest/ opens the live docs, versions.json lists every version.
      assert.match(
        await read('latest/index.html'),
        /<meta http-equiv="refresh" content="0; url=\.\.\/index\.html">/,
      );
      const versions = JSON.parse(await read('versions.json'));
      assert.equal(versions.latest.id, '2.0');
      assert.match(
        versions.archived.find((v: { id: string }) => v.id === '1.0').href,
        /^pages\/_versions\/1\.0\//,
      );
    } finally {
      for (const uri of created)
        await vscode.workspace.fs.delete(uri, { recursive: true }).then(undefined, () => {});
      for (const file of ['i18n/Setup.md', 'i18n/Install.md'])
        await vscode.workspace.fs
          .delete(vscode.Uri.joinPath(root.uri, file))
          .then(undefined, () => {});
      await vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(original));
      await ws.refresh();
    }
  });
  await test('page history reads Git without changing it and restores as an undoable edit', async () => {
    const root = ws.roots[0];
    const repo = root.uri.fsPath;
    const gitRun = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: repo,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Ann',
          GIT_AUTHOR_EMAIL: 'a@x',
          GIT_COMMITTER_NAME: 'Ann',
          GIT_COMMITTER_EMAIL: 'a@x',
        },
      }).toString();
    const outsideRepo = ws.index.all(root.id)[0];
    assert.equal(
      await pageHistory(vscode.Uri.parse(outsideRepo.uri)),
      undefined,
      'not a repository yet',
    );
    gitRun('init', '-q');
    try {
      const first = await ws.createPage(
        root,
        'history/Old name',
        '# Notes\n\nFirst version.\nShared line one.\nShared line two.\nShared line three.\nShared line four.\n',
      );
      gitRun('add', 'history');
      gitRun('commit', '-q', '-m', 'Add notes');
      await vscode.workspace.fs.rename(first, vscode.Uri.joinPath(root.uri, 'history/Notes ü.md'));
      const file = vscode.Uri.joinPath(root.uri, 'history/Notes ü.md');
      await vscode.workspace.fs.writeFile(
        file,
        new TextEncoder().encode(
          '# Notes\n\nSecond version.\nShared line one.\nShared line two.\nShared line three.\nShared line four.\n',
        ),
      );
      gitRun('add', '-A', 'history');
      gitRun('commit', '-q', '-m', 'Rename and rewrite\n\nwith a body');
      const head = gitRun('rev-parse', 'HEAD');
      const history = (await pageHistory(file))!;
      assert.deepEqual(
        history.commits.map((c) => [c.subject, c.path, c.author]),
        [
          ['Rename and rewrite', 'history/Notes ü.md', 'Ann'],
          ['Add notes', 'history/Old name.md', 'Ann'],
        ],
      );
      assert.equal(history.modified, false);
      const old = history.commits[1];
      const doc = await vscode.workspace.openTextDocument(
        GitContentProvider.uri(history.repo, old.sha, old.path),
      );
      assert.equal(
        doc.getText(),
        '# Notes\n\nFirst version.\nShared line one.\nShared line two.\nShared line three.\nShared line four.\n',
      );
      await restoreText(file, doc.getText());
      const editor = await vscode.workspace.openTextDocument(file);
      assert.equal(
        editor.getText(),
        '# Notes\n\nFirst version.\nShared line one.\nShared line two.\nShared line three.\nShared line four.\n',
      );
      assert.equal(editor.isDirty, true, 'restore is not saved automatically');
      assert.equal(gitRun('rev-parse', 'HEAD'), head, 'no commit, reset or checkout');
      await vscode.window.showTextDocument(editor);
      await vscode.commands.executeCommand('undo');
      assert.equal(
        editor.getText(),
        '# Notes\n\nSecond version.\nShared line one.\nShared line two.\nShared line three.\nShared line four.\n',
        'undo reverts the restore',
      );
      await editor.save();
      const { git } = await import('../../git-history');
      await assert.rejects(git(['checkout', '.'], repo), /not allowed/);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'history'), {
        recursive: true,
      });
    } finally {
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(repo, '.git')), {
        recursive: true,
      });
      await ws.refresh();
    }
  });
  await test('Git tags and branches are browsed as read-only snapshots without checkout', async () => {
    const root = ws.roots[0];
    const repo = root.uri.fsPath;
    const gitRun = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: repo,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Ann',
          GIT_AUTHOR_EMAIL: 'a@x',
          GIT_COMMITTER_NAME: 'Ann',
          GIT_COMMITTER_EMAIL: 'a@x',
        },
      }).toString();
    const { listRefs, loadSnapshot, compareSnapshot, browseGitVersion } =
      await import('../../git-versions');
    gitRun('init', '-q', '-b', 'main');
    try {
      const guide = await ws.createPage(
        root,
        'versions/Guide',
        '# Guide\n\nInstall with the old script.\n\nSee [[Old]].\n',
      );
      await ws.createPage(root, 'versions/Old', '# Old\n\nRetired feature.\n');
      gitRun('add', 'versions');
      gitRun('commit', '-q', '-m', 'v1 docs');
      gitRun('tag', 'v1.0');
      gitRun('branch', 'release-1');
      await vscode.workspace.fs.writeFile(
        guide,
        new TextEncoder().encode('# Guide\n\nInstall with the installer.\n'),
      );
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'versions/Old.md'));
      await ws.createPage(root, 'versions/New', '# New\n\nNew feature.\n');
      gitRun('add', '-A', 'versions');
      gitRun('commit', '-q', '-m', 'v2 docs');
      await ws.refresh();
      const head = gitRun('rev-parse', 'HEAD');
      const status = gitRun('status', '--porcelain');
      const refs = await listRefs(repo);
      assert.deepEqual(
        refs
          .filter((r) => ['v1.0', 'release-1'].includes(r.name))
          .map((r) => `${r.kind}:${r.name}`)
          .sort(),
        ['branch:release-1', 'tag:v1.0'],
      );
      const snapshot = await browseGitVersion(ws, root, 'v1.0');
      const old = snapshot.pages.find((p) => p.path === 'versions/Guide.md')!;
      assert.match(old.text, /old script/);
      assert.equal(
        snapshot.index.resolve(old, 'Old').page?.path,
        'versions/Old.md',
        'links resolve inside the snapshot',
      );
      assert.deepEqual(
        snapshot.index.search('script').map((r) => r.page.path),
        ['versions/Guide.md'],
        'search sees that version only',
      );
      const diff = compareSnapshot(snapshot, ws.index.all(root.id));
      assert.deepEqual(
        diff.removed.map((p) => p.path),
        ['versions/Old.md'],
      );
      assert.ok(diff.added.some((p) => p.path === 'versions/New.md'));
      assert.deepEqual(
        diff.changed.map((p) => p.path),
        ['versions/Guide.md'],
      );
      assert.equal((await loadSnapshot(root, 'release-1')).sha, snapshot.sha);
      await assert.rejects(loadSnapshot(root, '--output=/tmp/x'), /not a branch or tag name/);
      await assert.rejects(
        loadSnapshot(root, 'no-such-tag'),
        /does not name a commit|unknown revision|fatal/,
      );
      // Comparing a page opens VS Code's diff editor against the tag.
      await vscode.commands.executeCommand('notespace.compareWithGitVersion', guide, 'v1.0');
      await waitFor(
        () =>
          vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof
          vscode.TabInputTextDiff,
        'diff editor',
      );
      const input = vscode.window.tabGroups.activeTabGroup.activeTab!
        .input as vscode.TabInputTextDiff;
      assert.equal(input.original.scheme, GitContentProvider.scheme);
      assert.match(
        (await vscode.workspace.openTextDocument(input.original)).getText(),
        /old script/,
      );
      assert.equal(input.modified.toString(), guide.toString());
      // Nothing was checked out or written.
      assert.equal(gitRun('rev-parse', 'HEAD'), head);
      assert.equal(gitRun('status', '--porcelain'), status);
      assert.match(await readFile(guide.fsPath, 'utf8'), /installer/);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'versions'), {
        recursive: true,
      });
    } finally {
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(repo, '.git')), {
        recursive: true,
      });
      await ws.refresh();
    }
  });
  await test('review comments are stored as portable JSON and follow edited lines', async () => {
    const root = ws.roots[0];
    const uri = await ws.createPage(
      root,
      'reviewed/Page',
      '# Page\n\nFirst paragraph.\n\nSecond paragraph.\n',
    );
    const page = () => ws.index.byUri(uri.toString())!;
    const thread = await api.review.comment(uri, 4, 'Is this still true?');
    const file = api.review.reviewUri(page());
    assert.match(file.path, /\/\.reviews\/reviewed\/Page\.md\.json$/);
    const stored = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
    assert.equal(stored.schema, 'notespace.review/1');
    assert.deepEqual(stored.threads[0].anchor, { line: 4, quote: 'Second paragraph.' });
    await api.review.comment(uri, 4, 'Yes, checked.', thread);
    await api.review.setStatus(uri, thread, 'resolved');
    let review = await api.review.read(page());
    assert.equal(review.threads[0].comments.length, 2);
    assert.equal(review.threads[0].status, 'resolved');
    // Inserting lines above moves the anchor when the page is saved.
    // Comment threads follow edits in a visible editor (Code mode).
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(2, 0), 'New intro.\n\n');
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    await waitFor(
      async () => (await api.review.read(page())).threads[0].anchor.line === 6,
      'anchor moved',
    );
    const result = await api.exportWiki(
      ws,
      root,
      vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports')),
      undefined,
      { planner: api.planner },
    );
    const all: string[] = [];
    const walk = async (dir: vscode.Uri, prefix = '') => {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(dir))
        if (type === vscode.FileType.Directory)
          await walk(vscode.Uri.joinPath(dir, name), `${prefix}${name}/`);
        else all.push(prefix + name);
    };
    await walk(result.uri);
    assert.ok(!all.some((f) => f.includes('.reviews')), 'reviews are not exported');
    review = await api.review.read(page());
    for (const c of review.threads[0].comments) await api.review.deleteComment(uri, thread, c.id);
    await assert.rejects(
      Promise.resolve(vscode.workspace.fs.stat(file)),
      'empty review files are removed',
    );
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'reviewed'), {
      recursive: true,
    });
    await ws.refresh();
  });
  await test('Obsidian vault import converts a copy and leaves the vault untouched', async () => {
    const vault = vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports', 'vault'));
    const files: Record<string, string> = {
      'Home.md':
        '# Home\n\n[[Projects/Plan|Plan]] ![[diagram.png]]\n\n> [!tip] Remember\n> Back up.\n',
      'Projects/Plan.md': '# Plan\n\n%%draft%% ![[Home]]\n```dataview\nLIST\n```\n',
      'diagram.png': 'PNG',
      '.obsidian/app.json': '{}',
    };
    for (const [name, text] of Object.entries(files)) {
      const uri = vscode.Uri.joinPath(vault, name);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    }
    const target = vscode.Uri.joinPath(ws.roots[0].folder.uri, 'imported-vault');
    const result = await importObsidianVault(ws, vault, target);
    assert.equal(result.pages, 2);
    assert.equal(result.attachments, 1);
    const read = async (uri: vscode.Uri) =>
      new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    assert.equal(
      await read(vscode.Uri.joinPath(target, 'docs/Home.md')),
      '# Home\n\n[[Projects/Plan|Plan]] ![diagram](diagram.png)\n\n:::tip "Remember"\nBack up.\n:::\n',
    );
    assert.match(
      await read(vscode.Uri.joinPath(target, 'docs/Projects/Plan.md')),
      /<!--draft--> \{\{ include "\.\.\/Home\.md" \}\}/,
    );
    assert.match(await read(result.report), /Dataview query/);
    for (const [name, text] of Object.entries(files))
      assert.equal(await read(vscode.Uri.joinPath(vault, name)), text, `${name} unchanged`);
    await assert.rejects(
      Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.joinPath(target, 'docs/.obsidian'))),
    );
    await waitFor(
      () => ws.roots.some((r) => r.projectUri?.toString() === target.toString()),
      'imported wiki discovered',
    );
    await assert.rejects(importObsidianVault(ws, vault, target), /already exists/);
    await vscode.workspace.fs.delete(target, { recursive: true });
    await ws.refresh();
  });
  await test('AI and semantic search use only an explicitly configured endpoint and propose before changing files', async () => {
    const config = vscode.workspace.getConfiguration('notespace');
    await assert.rejects(chooseProvider(api.context), /No language model is available/);
    const requests: Array<{ url?: string; body: Record<string, unknown> }> = [];
    const vector = (text: string) =>
      ['docker', 'kernel', 'planner', 'export'].map(
        (w) => (text.toLowerCase().match(new RegExp(w, 'g')) || []).length + 0.01,
      );
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw);
        requests.push({ url: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/v1/embeddings')
          res.end(
            JSON.stringify({
              data: (body.input as string[]).map((t, index) => ({ index, embedding: vector(t) })),
            }),
          );
        else
          res.end(
            JSON.stringify({
              choices: [{ message: { content: '```markdown\n# Improved\n\nClear text.\n```' } }],
            }),
          );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const root = ws.roots[0];
    try {
      await config.update('ai.provider', 'endpoint', vscode.ConfigurationTarget.Global);
      await config.update(
        'ai.endpoint',
        `http://127.0.0.1:${port}/v1`,
        vscode.ConfigurationTarget.Global,
      );
      await config.update('ai.model', 'test-model', vscode.ConfigurationTarget.Global);
      const provider = await chooseProvider(api.context);
      assert.equal(provider.label, `test-model at 127.0.0.1:${port}`);
      const uri = await ws.createPage(root, 'ai/Draft', '# Draft\n\nmessy text\n');
      const doc = await vscode.workspace.openTextDocument(uri);
      const { unwrap } = await import('../../ai');
      const answer = unwrap(
        await provider.send('system', doc.getText(), new vscode.CancellationTokenSource().token),
      );
      assert.equal(requests[0].url, '/v1/chat/completions');
      assert.equal((requests[0].body as { model: string }).model, 'test-model');
      const proposal = await api.proposals.propose(
        { target: uri, version: doc.version, original: doc.getText(), text: answer },
        'Draft',
      );
      assert.equal(doc.getText(), '# Draft\n\nmessy text\n', 'nothing changes before Apply');
      assert.equal(
        (await vscode.workspace.openTextDocument(proposal)).getText(),
        '# Improved\n\nClear text.\n',
      );
      await api.proposals.apply(proposal, ws);
      assert.equal(doc.getText(), '# Improved\n\nClear text.\n');
      assert.equal(doc.isDirty, false, 'Apply saves the page');
      // A stale proposal is refused.
      const stale = await api.proposals.propose(
        { target: uri, version: doc.version, original: doc.getText(), text: 'x\n' },
        'Draft',
      );
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), 'Edited meanwhile\n');
      await vscode.workspace.applyEdit(edit);
      await assert.rejects(api.proposals.apply(stale, ws), /changed after the proposal/);
      await doc.save();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');

      await assert.rejects(api.semantic.authorized(), /Semantic search is off/);
      await config.update('semanticSearch.model', 'embed-test', vscode.ConfigurationTarget.Global);
      await ws.createPage(
        root,
        'ai/Containers',
        '# Containers\n\nDocker compose and docker images.\n\n## Secrets\n\npassword: supersecret123\n',
      );
      await ws.createPage(root, 'ai/Kernels', '# Kernels\n\nThe kernel runs notebook cells.\n');
      await api.context.workspaceState.update(
        'semantic.approved',
        `http://127.0.0.1:${port}/v1\0embed-test`,
      );
      assert.equal(await api.semantic.authorized(), true);
      const embedded = await api.semantic.update(root);
      assert.ok(embedded > 3);
      const sent = requests
        .filter((r) => r.url === '/v1/embeddings')
        .flatMap((r) => r.body.input as string[])
        .join('\n');
      assert.ok(!sent.includes('supersecret123'), 'secrets are redacted before embedding');
      assert.equal(await api.semantic.update(root), 0, 'unchanged sections are not embedded again');
      const hits = await api.semantic.query(root, 'how do I use docker');
      assert.equal(hits[0].page.path, 'ai/Containers.md');
    } finally {
      server.close();
      for (const key of ['ai.provider', 'ai.endpoint', 'ai.model', 'semanticSearch.model'])
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.fs
        .delete(vscode.Uri.joinPath(root.uri, 'ai'), { recursive: true })
        .then(undefined, () => {});
      await ws.refresh();
    }
  });
  await test('the bundled MCP server serves the real wiki over stdio', async () => {
    const root = ws.roots.find((r) => r.projectUri)!;
    const child = spawn(process.env.WIKI_NODE || 'node', [
      path.resolve(__dirname, '../dist/mcp-server.js'),
      '--wiki',
      root.projectUri!.fsPath,
    ]);
    try {
      const lines = createInterface({ input: child.stdout });
      const replies: Record<string, unknown>[] = [];
      lines.on('line', (l) => replies.push(JSON.parse(l)));
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n',
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list_pages', arguments: {} },
        }) + '\n',
      );
      await waitFor(() => replies.length === 2, 'MCP replies');
      const pages = JSON.parse(
        (replies[1] as { result: { content: Array<{ text: string }> } }).result.content[0].text,
      ) as Array<{ path: string }>;
      assert.deepEqual(
        pages.map((p) => p.path).sort(),
        ws.index
          .all(root.id)
          .map((p) => p.path)
          .sort(),
      );
    } finally {
      child.kill();
    }
  });

  await test('PDF and EPUB exports reuse the site rendering and pass real validators', async () => {
    const root = ws.roots[0];
    const tools = process.env.WIKI_TOOLS || '';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
      'base64',
    );
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root.uri, 'publish/pic.png'), png);
    await ws.createPage(
      root,
      'publish/Intro',
      '# Publishing intro\n\nFirst page with ![A red square](pic.png) and [the next page](Details.md).\n\n:::warning "Collapsed callout" collapsed\nHidden body text appears in print.\n:::\n\n$$\nE = mc^2\n$$\n\n```mermaid\ngraph TD\n  A-->B\n```\n',
    );
    await ws.createPage(
      root,
      'publish/Details',
      '# Second chapter\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] Done task\n',
    );
    const config = vscode.workspace.getConfiguration('notespace');
    const out = vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports'));
    try {
      assert.ok(
        process.env.WIKI_CHROMIUM && existsSync(process.env.WIKI_CHROMIUM),
        'a Chromium is available for this test',
      );
      await config.update(
        'export.browserPath',
        process.env.WIKI_CHROMIUM,
        vscode.ConfigurationTarget.Global,
      );
      const pdfUri = vscode.Uri.joinPath(out, 'publish.pdf');
      const pdf = await exportPdf(
        ws,
        root,
        pdfUri,
        (p) => p.path.startsWith('publish/'),
        'Publishing guide',
        api.planner,
      );
      assert.equal(pdf.pages, 2);
      const bytes = Buffer.from(await vscode.workspace.fs.readFile(pdfUri));
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      const python = process.env.WIKI_PYTHON || path.join(tools, 'venv', 'bin', 'python');
      assert.ok(existsSync(python), 'pypdf tool installed');
      const text = execFileSync(python, [
        '-c',
        'import sys,pypdf;r=pypdf.PdfReader(sys.argv[1]);print(len(r.pages));print("\\n".join(p.extract_text() for p in r.pages))',
        pdfUri.fsPath,
      ]).toString();
      const [count, ...rest] = text.split('\n');
      const content = rest.join('\n');
      assert.ok(Number(count) >= 2, `pages: ${count}`);
      for (const expected of [
        'Publishing guide',
        'Contents',
        'Publishing intro',
        'Hidden body text appears in print',
        'Second chapter',
        'Done task',
      ])
        assert.ok(content.includes(expected), `PDF contains “${expected}”`);
      // Without a browser: an intelligible fallback instead of a failure.
      await config.update(
        'export.browserPath',
        '/nonexistent/browser',
        vscode.ConfigurationTarget.Global,
      );
      const fallback = await exportPdf(
        ws,
        root,
        vscode.Uri.joinPath(out, 'nobrowser.pdf'),
        (p) => p.path === 'publish/Intro.md',
        'Intro',
        api.planner,
      );
      assert.ok(fallback.printHtml && !fallback.pdf);
      assert.match(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(fallback.printHtml!)),
        /Publishing intro/,
      );

      const epubUri = vscode.Uri.joinPath(out, 'wiki.epub');
      const epub = await exportEpub(ws, root, epubUri, api.planner);
      assert.ok(epub.pages >= 2);
      const jar = path.join(tools, 'epubcheck-5.1.0', 'epubcheck.jar');
      assert.ok(existsSync(jar), 'epubcheck installed');
      let report = '';
      try {
        report = execFileSync('java', ['-jar', jar, epubUri.fsPath], { stdio: 'pipe' }).toString();
      } catch (e) {
        const error = e as { stdout?: Buffer; stderr?: Buffer };
        assert.fail(`epubcheck failed:\n${error.stdout}\n${error.stderr}`);
      }
      assert.match(report, /No errors or warnings detected/);
    } finally {
      await config.update('export.browserPath', undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'publish'), {
        recursive: true,
      });
      await ws.refresh();
    }
  });

  await test('dashboards read workbooks, refresh on change, keep the last valid data and export only when allowed', async () => {
    const root = ws.roots.find((r) => r.projectUri)!;
    const fixtures = path.resolve(__dirname, '../src/test/fixtures');
    const dataDir = vscode.Uri.joinPath(root.projectUri!, 'data');
    const workbook = vscode.Uri.joinPath(dataDir, 'vulnerabilities.xlsx');
    await vscode.workspace.fs.writeFile(
      workbook,
      await readFile(path.join(fixtures, 'vulnerabilities.xlsx')),
    );
    const uri = await newDashboard(root.projectUri!, workbook, 'Security Overview');
    const dashboard = parseDashboard(
      new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
    ).dashboard;
    assert.deepEqual(dashboard.sources, [
      { id: 'data', type: 'xlsx', path: 'data/vulnerabilities.xlsx', sheet: 'Export' },
    ]);
    dashboard.metrics.push({
      id: 'critical',
      source: 'data',
      formula: 'COUNT_IF(Severity = "Critical")',
      label: 'Critical',
    });
    dashboard.widgets.push({
      id: 'critical-card',
      type: 'metric',
      metric: 'critical',
      title: 'Critical findings',
    });
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(serializeDashboard(dashboard)),
    );
    const value = async (id: string) =>
      (await sharedDashboards.compute(uri, dashboard, {})).results.find((r) => r.id === id);
    assert.equal((await value('rows-card'))?.value, '120');
    assert.equal((await value('critical-card'))?.value, '30');
    const trend = await value('trend');
    assert.ok(
      trend?.html?.includes('<svg') && trend.labels?.[0] === '2025-01',
      'monthly trend from DetectedDate',
    );
    const filtered = await sharedDashboards.compute(uri, dashboard, {
      values: { category: ['Mobile'] },
    });
    assert.equal(
      filtered.results.find((r) => r.id === 'rows-card')?.value,
      '40',
      'filters apply to every widget',
    );
    // The workbook changes on disk: the dashboard is told and recomputes.
    const changed = new Promise<string>((resolve) => {
      const sub = sharedDashboards.onDidChangeSource((u) => {
        sub.dispose();
        resolve(u);
      });
    });
    await writeFile(
      workbook.fsPath,
      await readFile(path.join(fixtures, 'vulnerabilities-v2.xlsx')),
    );
    assert.equal(await changed, uri.toString());
    assert.equal((await value('rows-card'))?.value, '150');
    assert.equal((await value('critical-card'))?.value, '60');
    // A half-written file: the last valid data stays, marked as not current.
    await writeFile(
      workbook.fsPath,
      (await readFile(path.join(fixtures, 'vulnerabilities.xlsx'))).subarray(0, 3000),
    );
    sharedDashboards.invalidate();
    const broken = await sharedDashboards.compute(uri, dashboard, {});
    assert.equal(broken.results.find((r) => r.id === 'rows-card')?.value, '150');
    assert.equal(broken.sources[0].status, 'error');
    assert.equal(broken.sources[0].stale, true);
    assert.match(broken.sources[0].error!, /Not a ZIP container/);
    await writeFile(workbook.fsPath, await readFile(path.join(fixtures, 'vulnerabilities.xlsx')));
    sharedDashboards.invalidate();
    assert.equal((await value('rows-card'))?.value, '120');
    // Embeds: shown in the reader, withheld from exports unless the dashboard allows snapshots.
    const dashboardFile = path.posix.basename(uri.path);
    await ws.createPage(
      root,
      'reports/Security',
      `# Security\n\n\`\`\`dashboard\npath: ${path.posix.relative(path.posix.dirname(vscode.Uri.joinPath(root.uri, 'reports/Security.md').path), uri.path)}\nwidget: critical-card\n\`\`\`\n`,
    );
    await waitFor(
      () =>
        !!ws.index
          .all(root.id)
          .find((p) => p.path === 'reports/Security.md')
          ?.text.includes(dashboardFile),
      'page updated',
    );
    const out = vscode.Uri.file(path.join(process.env.WIKI_TEST_DIR!, 'exports'));
    let site = await api.exportWiki(ws, root, out, undefined, { planner: api.planner });
    let html = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(site.uri, 'pages/reports/Security.html'),
      ),
    );
    assert.match(html, /is not included in exports/);
    assert.doesNotMatch(html, /dash-metric-value/);
    dashboard.export = { snapshots: true };
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(serializeDashboard(dashboard)),
    );
    site = await api.exportWiki(ws, root, out, undefined, { planner: api.planner });
    html = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(site.uri, 'pages/reports/Security.html'),
      ),
    );
    assert.match(
      html,
      /<span class="dash-metric-value">30<\/span><span class="dash-metric-label">Critical findings<\/span>/,
    );
    assert.match(html, /snapshot of data loaded/);
    assert.equal(
      toCsv(['a'], [['=HYPERLINK("x")'], ['-5'], ['-cmd']]),
      'a\r\n"\'=HYPERLINK(""x"")"\r\n-5\r\n"\'-cmd"\r\n',
      'CSV export neutralises formulas',
    );
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'reports'), { recursive: true });
    await vscode.workspace.fs.delete(uri);
    await vscode.workspace.fs.delete(dataDir, { recursive: true });
    await ws.refresh();
  });

  await test('code references navigate to symbols and report renamed or missing code', async () => {
    const root = ws.roots[0];
    const src = vscode.Uri.joinPath(root.folder.uri, 'src-demo/billing.ts');
    await vscode.workspace.fs.writeFile(
      src,
      new TextEncoder().encode(
        'export class Invoice {\n  total(): number {\n    return 1;\n  }\n}\n\nexport function chargeCard(amount: number) {\n  return amount;\n}\n',
      ),
    );
    const rel = path.posix.relative(
      path.posix.dirname(vscode.Uri.joinPath(root.uri, 'code/Billing.md').path),
      src.path,
    );
    const uri = await ws.createPage(
      root,
      'code/Billing',
      `# Billing\n\n[charge](${rel}#chargeCard), [total](${rel}#Invoice.total), [gone](${rel}#refundCard), [lines](${rel}#L2-L4), [too far](${rel}#L50), [missing](${rel.replace('billing', 'nothing')})\n`,
    );
    const codes = () =>
      vscode.languages
        .getDiagnostics(uri)
        .filter((d) => String(d.code).startsWith('code-ref'))
        .map((d) => `${d.code}:${d.message}`);
    await waitFor(() => codes().length >= 3, 'code reference diagnostics');
    await new Promise((r) => setTimeout(r, 1500));
    const found = codes();
    assert.ok(
      found.some((c) => /refundCard/.test(c) && /code-ref-(missing-symbol|no-symbols)/.test(c)),
      found.join('\n'),
    );
    assert.ok(
      found.some(
        (c) => c.startsWith('code-ref-bad-lines:') && /outside billing\.ts \(10 lines\)/.test(c),
      ),
    );
    assert.ok(found.some((c) => c.startsWith('code-ref-missing-file:')));
    assert.ok(
      !found.some((c) => /chargeCard|Invoice\.total|L2/.test(c)),
      'valid references raise nothing',
    );
    const page = ws.index.byUri(uri.toString())!;
    await vscode.commands.executeCommand('notespace.openCodeRef', page.uri, `${rel}#chargeCard`);
    await waitFor(
      () => vscode.window.activeTextEditor?.document.uri.toString() === src.toString(),
      'source opened',
    );
    assert.equal(
      vscode.window.activeTextEditor!.selection.active.line,
      6,
      'opened at the function',
    );
    const { pagesReferencing } = await import('../../code-references');
    assert.equal(
      pagesReferencing(ws, src).length,
      5,
      'every reference to billing.ts (not the missing file)',
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.folder.uri, 'src-demo'), {
      recursive: true,
    });
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'code'), { recursive: true });
    await ws.refresh();
  });
  await test('content quality findings come with quick fixes that edit the page', async () => {
    const root = ws.roots.find((r) => r.config?.wiki.title === 'Product Docs')!;
    const current = () => ws.roots.find((r) => r.id === root.id)!;
    const configUri = vscode.Uri.joinPath(root.projectUri!, 'wiki.yaml');
    const original = await vscode.workspace.fs.readFile(configUri);
    const { parseConfig, updateConfig } = await import('../../core/config');
    const yaml = new TextDecoder().decode(original);
    const config = parseConfig(yaml);
    config.quality = {
      rules: [{ folder: 'quality', fields: ['owner'], sections: ['Overview'] }],
      staleDays: 0,
    };
    await vscode.workspace.fs.writeFile(
      configUri,
      new TextEncoder().encode(updateConfig(yaml, config)),
    );
    // An earlier test turns diagnostics off for the workspace.
    const settings = vscode.workspace.getConfiguration('notespace');
    const before = settings.inspect<boolean>('diagnostics')?.workspaceValue;
    await settings.update('diagnostics', true, vscode.ConfigurationTarget.Workspace);
    try {
      await ws.refresh();
      await waitFor(() => !!current().config?.quality.rules.length, 'quality rules loaded');
      const uri = await ws.createPage(
        current(),
        'quality/Checklist',
        '# Checklist\n\n![](images/deploy-flow.png)\n\n#### Deep\n\n## Steps\n\none\n\n## Steps\n\ntwo\n',
      );
      const document = await vscode.workspace.openTextDocument(uri);
      const kinds = () => vscode.languages.getDiagnostics(uri).map((d) => String(d.code));
      const expected = [
        'missing-alt',
        'heading-skip',
        'duplicate-heading',
        'missing-field',
        'missing-section',
      ];
      await waitFor(
        () => expected.every((k) => kinds().includes(k)),
        `quality diagnostics (${expected.join(', ')})`,
      ).catch((e) => {
        throw new Error(
          `${e.message}; got ${vscode.languages
            .getDiagnostics(uri)
            .map((d) => `${d.code}: ${d.message}`)
            .join(' | ')}`,
        );
      });
      for (const kind of expected) {
        const diagnostic = vscode.languages.getDiagnostics(uri).find((d) => d.code === kind)!;
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider',
          uri,
          diagnostic.range,
        );
        const titles: Record<string, RegExp> = {
          'missing-alt': /^Use “deploy flow” as alternative text$/,
          'heading-skip': /^Change to a level 2 heading$/,
          'duplicate-heading': /^Rename to “Steps \(2\)”$/,
          'missing-field': /^Add front matter field “owner”$/,
          'missing-section': /^Add section “Overview”$/,
        };
        const fix = actions.find((a) => titles[kind].test(a.title) && a.edit);
        assert.ok(fix, `quick fix for ${kind}: ${actions.map((a) => a.title).join(', ')}`);
        assert.ok(await vscode.workspace.applyEdit(fix.edit!));
        await document.save();
        if (kind === 'missing-field')
          // The field now exists; it stays reported until it has a value.
          await waitFor(
            () =>
              vscode.languages
                .getDiagnostics(uri)
                .some((d) => d.code === kind && /“owner” is empty/.test(d.message)),
            'owner added',
          );
        else await waitFor(() => !kinds().includes(kind), `${kind} fixed`);
      }
      const text = document.getText();
      assert.match(text, /!\[deploy flow\]\(images\/deploy-flow\.png\)/);
      assert.match(text, /^## Deep$/m);
      assert.match(text, /^## Steps \(2\)$/m);
      assert.match(text, /^---\nowner: \n---\n/);
      assert.match(text, /\n## Overview\n$/);
    } finally {
      await settings.update('diagnostics', before, vscode.ConfigurationTarget.Workspace);
      await vscode.workspace.fs.writeFile(configUri, original);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs
        .delete(vscode.Uri.joinPath(root.uri, 'quality'), { recursive: true, useTrash: false })
        .then(undefined, () => undefined);
      await ws.refresh();
    }
  });
  await test('API reference pages are generated, kept in sync and never overwrite manual edits silently', async () => {
    const root = ws.roots[0];
    const { generateApiReference, staleGeneratedPages } = await import('../../api-playground');
    const specUri = vscode.Uri.joinPath(root.uri, 'specs/shop.yaml');
    const spec = (summary: string) =>
      `openapi: 3.0.3\ninfo: {title: Shop, version: "1"}\nservers: [{url: "https://shop.example.com"}]\npaths:\n  /orders:\n    get:\n      operationId: listOrders\n      tags: [Orders]\n      summary: ${summary}\n      responses:\n        "200":\n          description: Orders\n          content: {application/json: {schema: {type: array, items: {$ref: "#/components/schemas/Order"}}}}\ncomponents:\n  schemas:\n    Order: {type: object, required: [id], properties: {id: {type: string}, total: {type: number}}}\n`;
    await vscode.workspace.fs.writeFile(specUri, new TextEncoder().encode(spec('List orders')));
    const folder = vscode.Uri.joinPath(root.uri, 'reference/shop');
    const conflicts: string[] = [];
    const first = await generateApiReference(ws, specUri, folder, async (file) => {
      conflicts.push(file.path);
      return 'keep';
    });
    assert.deepEqual(first.created.sort(), ['index.md', 'orders.md', 'schemas.md']);
    const orders = vscode.Uri.joinPath(folder, 'orders.md');
    const read = async (uri: vscode.Uri) =>
      new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    assert.match(await read(orders), /### GET `\/orders` — List orders/);
    assert.match(
      await read(vscode.Uri.joinPath(folder, 'schemas.md')),
      /\| `id` \| `string` \| yes \|/,
    );
    assert.ok(ws.index.byUri(orders.toString()), 'generated pages are wiki pages');
    // Notes added below the generated section survive regeneration.
    await vscode.workspace.fs.writeFile(
      orders,
      new TextEncoder().encode(`${await read(orders)}\n## Notes\n\nAsk the shop team.\n`),
    );
    await vscode.workspace.fs.writeFile(specUri, new TextEncoder().encode(spec('List all orders')));
    await ws.refresh();
    assert.deepEqual(
      (await staleGeneratedPages(ws, specUri)).map((p) => p.path),
      ['reference/shop/orders.md'],
    );
    const second = await generateApiReference(ws, specUri, folder, async () => 'keep');
    assert.deepEqual(second.updated, ['orders.md']);
    assert.deepEqual(second.unchanged.sort(), ['index.md', 'schemas.md']);
    let text = await read(orders);
    assert.match(text, /List all orders/);
    assert.match(text, /## Notes\n\nAsk the shop team\./);
    // A hand edit inside the generated section is a conflict: kept unless the user replaces it.
    await vscode.workspace.fs.writeFile(
      orders,
      new TextEncoder().encode(text.replace('Operation ID', 'Operation identifier')),
    );
    await vscode.workspace.fs.writeFile(
      specUri,
      new TextEncoder().encode(spec('List every order')),
    );
    const third = await generateApiReference(ws, specUri, folder, async (file) => {
      conflicts.push(posixPath(file));
      return 'keep';
    });
    assert.deepEqual([third.kept, conflicts], [['orders.md'], ['reference/shop/orders.md']]);
    text = await read(orders);
    assert.match(text, /Operation identifier/);
    assert.doesNotMatch(text, /List every order/);
    const fourth = await generateApiReference(ws, specUri, folder, async () => 'replace');
    assert.deepEqual(fourth.updated, ['orders.md']);
    text = await read(orders);
    assert.match(text, /List every order/);
    assert.doesNotMatch(text, /Operation identifier/);
    assert.match(text, /Ask the shop team/);
    // A hand-written page with the same name is never replaced.
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(folder, 'index.md'),
      new TextEncoder().encode('# Shop API\n\nWritten by hand.\n'),
    );
    assert.deepEqual(
      (await generateApiReference(ws, specUri, folder, async () => 'replace')).skipped,
      ['index.md'],
    );
    assert.match(await read(vscode.Uri.joinPath(folder, 'index.md')), /Written by hand/);
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'reference'), {
      recursive: true,
      useTrash: false,
    });
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, 'specs'), {
      recursive: true,
      useTrash: false,
    });
    await ws.refresh();
    function posixPath(file: vscode.Uri) {
      return path.posix.relative(root.uri.path, file.path);
    }
  });
  await test('discovery follows .gitignore per folder, shows readable names and orders folders', async () => {
    const primary = ws.roots[0];
    // A wiki in the other workspace folder (several roots can share a folder).
    const second = ws.roots.find((r) => r.folder.uri.toString() !== primary.folder.uri.toString())!;
    const folderOf = (r: typeof primary) => r.folder.uri;
    const write = (uri: vscode.Uri, text: string) =>
      vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    const wikiRel = path.posix.relative(folderOf(primary).path, primary.uri.path);
    const settings = vscode.workspace.getConfiguration('notespace', folderOf(primary));
    const explorerSettings = vscode.workspace.getConfiguration(
      'notespace.explorer',
      folderOf(primary),
    );
    const nav = vscode.Uri.joinPath(primary.uri, 'nav');
    const otherNav = vscode.Uri.joinPath(second.uri, 'nav');
    const rootIgnore = vscode.Uri.joinPath(folderOf(primary), '.gitignore');
    const otherIgnore = vscode.Uri.joinPath(folderOf(second), '.gitignore');
    try {
      await write(
        rootIgnore,
        `${wikiRel}/nav/ignored.md\n${wikiRel}/nav/private/\n!${wikiRel}/nav/private/keep.md\n`,
      );
      await write(vscode.Uri.joinPath(nav, 'sub/.gitignore'), '*.draft.md\n');
      await write(vscode.Uri.joinPath(nav, 'README.md'), 'Section overview.\n');
      await write(vscode.Uri.joinPath(nav, 'getting-started.md'), 'No heading here.\n');
      await write(vscode.Uri.joinPath(nav, 'api_reference.md'), '# Custom Title\n');
      await write(vscode.Uri.joinPath(nav, 'ignored.md'), '# Ignored\n');
      await write(vscode.Uri.joinPath(nav, 'private/x.md'), '# Private\n');
      await write(vscode.Uri.joinPath(nav, 'private/keep.md'), '# Keep\n');
      await write(vscode.Uri.joinPath(nav, 'sub/a.draft.md'), '# Draft\n');
      await write(vscode.Uri.joinPath(nav, 'sub/b.md'), '# B\n');
      // The other workspace folder has its own .gitignore but does not opt in.
      await write(otherIgnore, '*.md\n');
      await write(vscode.Uri.joinPath(otherNav, 'kept.md'), '# Kept\n');
      await settings.update('respectGitignore', true, vscode.ConfigurationTarget.WorkspaceFolder);
      await ws.refresh();
      const indexed = (r: typeof primary) =>
        ws.index
          .all(r.id)
          .map((p) => p.path)
          .filter((p) => p.startsWith('nav/'))
          .sort();
      const expected = [
        'nav/README.md',
        'nav/api_reference.md',
        'nav/getting-started.md',
        'nav/sub/b.md',
      ];
      await waitFor(
        () => JSON.stringify(indexed(primary)) === JSON.stringify(expected),
        'ignored pages left out',
      );
      assert.deepEqual(
        indexed(second),
        ['nav/kept.md'],
        'rules and the setting stay per workspace folder',
      );
      // Incremental updates apply the same rules.
      await write(vscode.Uri.joinPath(nav, 'private/late.md'), '# Late private\n');
      await write(vscode.Uri.joinPath(nav, 'late.md'), '# Late\n');
      await waitFor(
        () => indexed(primary).includes('nav/late.md'),
        'new page indexed',
        // Watcher events can be dropped on busy hosts; the 30 s reconciliation applies the same rules.
        40000,
      );
      await new Promise((r) => setTimeout(r, 800));
      assert.ok(!indexed(primary).includes('nav/private/late.md'), 'new ignored page left out');
      // Editing .gitignore re-applies the rules.
      await write(rootIgnore, `${wikiRel}/nav/private/\n`);
      await waitFor(() => indexed(primary).includes('nav/ignored.md'), '.gitignore change applied');

      const tree = new WikiTree(ws, 'pages', api.activity);
      try {
        const labels = async () => {
          const roots = await tree.getChildren();
          const wiki = roots.find((n) => n.root === primary.id && n.prefix === '')!;
          const folder = (await tree.getChildren(wiki)).find((n) => n.prefix === 'nav/')!;
          return {
            folder: folder.label,
            children: (await tree.getChildren(folder)).map((n) => n.label),
          };
        };
        assert.deepEqual(await labels(), {
          folder: 'Nav',
          children: ['README', 'Sub', 'Custom Title', 'Getting Started', 'Ignored', 'Late'],
        });
        await explorerSettings.update(
          'directorySort',
          'files-first',
          vscode.ConfigurationTarget.WorkspaceFolder,
        );
        assert.deepEqual((await labels()).children, [
          'README',
          'Custom Title',
          'Getting Started',
          'Ignored',
          'Late',
          'Sub',
        ]);
        await explorerSettings.update(
          'humanizeNames',
          false,
          vscode.ConfigurationTarget.WorkspaceFolder,
        );
        assert.deepEqual(await labels(), {
          folder: 'nav',
          children: ['README', 'Custom Title', 'getting-started', 'Ignored', 'Late', 'sub'],
        });
      } finally {
        tree.dispose();
      }

      // Following the active editor needs a rendered tree: covered by test:phase08 (browser).
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      for (const key of ['directorySort', 'humanizeNames', 'autoReveal'])
        await explorerSettings.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      await settings.update(
        'respectGitignore',
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      for (const uri of [nav, otherNav, rootIgnore, otherIgnore])
        await vscode.workspace.fs
          .delete(uri, { recursive: true, useTrash: false })
          .then(undefined, () => undefined);
      await ws.refresh();
    }
  });
  await test('multiple boards keep their own columns and files; tasks stay single-sourced across views', async () => {
    const { BoardService } = await import('../../boards');
    const { parseBoard } = await import('../../core/boards');
    const planner = api.planner;
    const root = ws.roots.find((r) => !r.config)!;
    const boards = new BoardService(ws, planner);
    const read = async (path: string) =>
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root.uri, path)),
      );
    const created: string[] = [];
    try {
      // Two independent boards, each a Markdown file with its own columns.
      const dev = await boards.create(root, { name: 'Dev Board', template: 'development' });
      const life = await boards.create(root, {
        name: 'Personal',
        path: 'plans/personal.md',
        template: 'personal',
      });
      created.push(dev.pagePath, life.pagePath);
      assert.equal(dev.pagePath, 'boards/dev-board.md');
      assert.notEqual(dev.id, life.id);
      assert.deepEqual(
        dev.columns.map((c) => c.id),
        ['backlog', 'planned', 'developing', 'testing', 'released'],
      );
      await boards.addCard(dev.id, 'Implement homepage priority:high', 'developing');
      await boards.addCard(life.id, 'Book dentist');
      await waitFor(
        () =>
          boards.tasksOf(boards.board(dev.id)).length === 1 &&
          boards.tasksOf(boards.board(life.id)).length === 1,
        'cards indexed',
      );
      assert.match(
        await read(dev.pagePath),
        /\n- \[ \] Implement homepage priority:high col:developing\n/,
      );
      assert.match(await read(life.pagePath), /\n- \[ \] Book dentist col:ideas\n/);
      assert.doesNotMatch(
        await read(planner.config(root).inbox).catch(() => ''),
        /Implement homepage|Book dentist/,
        'board cards are not written to the inbox',
      );

      // Rename the board and a column: ids stay, other content stays byte-identical.
      const before = await read(dev.pagePath);
      await boards.configure(dev.id, (c) => void (c.name = 'Website Development'));
      await boards.updateColumn(dev.id, 'developing', { title: 'In development', color: 'teal' });
      const after = await read(dev.pagePath);
      assert.equal(
        after.slice(after.indexOf('\n---\n')),
        before.slice(before.indexOf('\n---\n')),
        'the body is untouched',
      );
      const config = parseBoard(after)!;
      assert.equal(config.name, 'Website Development');
      assert.deepEqual(
        config.columns.find((c) => c.id === 'developing'),
        { id: 'developing', title: 'In development', color: 'teal' },
      );

      // Moving to a completed column checks the box with a done date; moving back reopens it.
      const card = boards.tasksOf(boards.board(dev.id))[0];
      await boards.moveCard(dev.id, card.key, 'released');
      await waitFor(
        async () =>
          /- \[x\] Implement homepage priority:high col:released done:\d{4}-\d{2}-\d{2}/.test(
            await read(dev.pagePath),
          ),
        'completed move',
      );
      const done = boards.tasksOf(boards.board(dev.id))[0];
      await boards.moveCard(dev.id, done.key, 'testing');
      await waitFor(
        async () =>
          /- \[ \] Implement homepage priority:high col:testing\n/.test(await read(dev.pagePath)),
        'reopened move',
      );

      // Reordering inside a column persists with order: words and stable ids.
      await boards.addCard(dev.id, 'Second card', 'testing');
      await waitFor(() => boards.tasksOf(boards.board(dev.id)).length === 2, 'second card');
      const [first, second] = boards.tasksOf(boards.board(dev.id));
      await boards.moveCard(dev.id, second.key, 'testing', [second.key, first.key]);
      await waitFor(
        async () =>
          /Second card col:testing order:1 \^t-[a-z0-9]{6}/.test(await read(dev.pagePath)),
        'order persisted',
      );

      // Editing from another view (calendar due date, inline title) updates the same line.
      const homepage = boards
        .tasksOf(boards.board(dev.id))
        .find((t) => t.title.startsWith('Implement'))!;
      await planner.update(homepage.key, { due: '2026-11-02', title: 'Implement new homepage' });
      await waitFor(
        () =>
          boards
            .tasksOf(boards.board(dev.id))
            .some((t) => t.title === 'Implement new homepage' && t.due === '2026-11-02'),
        'calendar edit visible on the board',
      );
      assert.equal(
        planner.tasks(root.id).filter((t) => t.title === 'Implement new homepage').length,
        1,
        'one task, not a copy per view',
      );

      // A task in an ordinary note joins a board without moving; later it is moved on request.
      await ws.createPage(
        root,
        'notes/Ideas',
        '# Ideas\n\n- [ ] Write the launch post #content\n- [ ] Stays here\n',
      );
      created.push('notes/Ideas.md');
      await waitFor(
        () => planner.tasks(root.id).some((t) => t.title === 'Write the launch post #content'),
        'note task',
      );
      const idea = planner
        .tasks(root.id)
        .find((t) => t.title === 'Write the launch post #content')!;
      await boards.assign(idea.key, life.id, 'todo');
      await waitFor(
        async () =>
          /- \[ \] Write the launch post #content board:[\w-]+ col:todo\n/.test(
            await read('notes/Ideas.md'),
          ),
        'linked',
      );
      await waitFor(
        () => boards.tasksOf(boards.board(life.id)).some((t) => t.pagePath === 'notes/Ideas.md'),
        'board shows the note task',
      );
      const linked = boards
        .tasksOf(boards.board(life.id))
        .find((t) => t.pagePath === 'notes/Ideas.md')!;
      await boards.moveToBoardFile(linked.key, life.id);
      await waitFor(
        async () =>
          !/launch post/.test(await read('notes/Ideas.md')) &&
          /\n- \[ \] Write the launch post #content col:todo\n/.test(await read(life.pagePath)),
        'moved into the board file',
      );
      assert.match(await read('notes/Ideas.md'), /- \[ \] Stays here/);

      // Unsaved edits in the board file survive a board change, and the file stays unsaved.
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(root.uri, life.pagePath),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, doc.positionAt(doc.getText().length), '\nUnsaved thought.\n');
      await vscode.workspace.applyEdit(edit);
      await boards.addCard(life.id, 'Call the bank', 'doing');
      assert.ok(doc.isDirty, 'still unsaved');
      assert.match(doc.getText(), /Unsaved thought\./);
      assert.match(doc.getText(), /- \[ \] Call the bank col:doing/);
      assert.doesNotMatch(
        await read(life.pagePath),
        /Unsaved thought/,
        'not written to disk behind the user',
      );
      await doc.save();

      // A column with cards is removed only by moving them; nothing is deleted.
      await assert.rejects(boards.removeColumn(life.id, 'doing'), /Choose a column/);
      await boards.removeColumn(life.id, 'doing', 'waiting');
      await waitFor(
        async () =>
          /Call the bank col:waiting/.test(await read(life.pagePath)) &&
          !parseBoard(await read(life.pagePath))!.columns.some((c) => c.id === 'doing'),
        'column removed, cards moved',
      );

      // Reload: everything comes back from the files.
      await ws.refresh();
      const reloaded = new BoardService(ws, planner);
      assert.deepEqual(
        reloaded
          .boards(root.id)
          .map((b) => b.name)
          .sort(),
        ['Personal', 'Website Development'],
      );
      assert.equal(reloaded.tasksOf(reloaded.board(life.id)).length, 3);

      // Multi-root isolation: another wiki does not see these boards.
      const other = ws.roots.find((r) => r.id !== root.id)!;
      assert.equal(
        reloaded.boards(other.id).some((b) => b.id === dev.id || b.id === life.id),
        false,
      );

      // The legacy status board still works on every task, writing new cards to the inbox.
      const stays = planner.tasks(root.id).find((t) => t.title === 'Stays here')!;
      await boards.moveCard('status', stays.key, 'doing');
      await waitFor(
        async () => /- \[ \] Stays here status:doing/.test(await read('notes/Ideas.md')),
        'status move',
      );
      await boards.addCard('status', 'Quick capture', 'doing', root.id);
      await waitFor(
        async () =>
          /- \[ \] Quick capture status:doing/.test(await read(planner.config(root).inbox)),
        'status board capture',
      );
      created.push(planner.config(root).inbox);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      for (const path of created)
        await vscode.workspace.fs
          .delete(vscode.Uri.joinPath(root.uri, path), { useTrash: false })
          .then(undefined, () => undefined);
      await ws.refresh();
    }
  });
  await test('wikis are removed from NoteSpace without touching files, and deleted only by name', async () => {
    const folder = vscode.workspace.workspaceFolders![0].uri;
    const project = vscode.Uri.joinPath(folder, 'throwaway-wiki');
    const enc = (t: string) => new TextEncoder().encode(t);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(project, 'wiki.yaml'),
      enc('schemaVersion: 1\nwiki:\n  title: Throwaway\ncontent:\n  root: docs\n'),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(project, 'docs/index.md'),
      enc('# Throwaway\n'),
    );
    await ws.refresh();
    const find = () => ws.roots.find((r) => r.config?.wiki.title === 'Throwaway');
    assert.ok(find(), 'wiki discovered');
    const window = vscode.window as unknown as {
      showWarningMessage: (...args: unknown[]) => Promise<unknown>;
      showInformationMessage: (...args: unknown[]) => Promise<unknown>;
      showInputBox: (options?: {
        validateInput?: (v: string) => unknown;
      }) => Promise<string | undefined>;
    };
    const original = {
      warn: window.showWarningMessage,
      info: window.showInformationMessage,
      input: window.showInputBox,
    };
    const asked: string[] = [];
    let typed: string | undefined;
    // Answer every confirmation with its action button (the last argument).
    window.showWarningMessage = async (...args: unknown[]) => (
      asked.push(String(args[0])),
      args[args.length - 1]
    );
    window.showInformationMessage = async (...args: unknown[]) => (
      asked.push(String(args[0])),
      args.length > 2 ? args[args.length - 1] : undefined
    );
    window.showInputBox = async () => typed;
    try {
      // Remove: the wiki leaves NoteSpace, its files stay, and it can be restored.
      await vscode.commands.executeCommand('notespace.removeWiki', {
        label: 'Throwaway',
        root: find()!.id,
        prefix: '',
      });
      await waitFor(() => !find(), 'wiki removed from NoteSpace');
      assert.ok(
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(project, 'docs/index.md')),
        'files stay on disk',
      );
      assert.ok(ws.hiddenRoots.some((r) => r.config?.wiki.title === 'Throwaway'));
      const picks = vscode.window as unknown as {
        showQuickPick: (...args: unknown[]) => Promise<unknown>;
      };
      const originalPick = picks.showQuickPick;
      picks.showQuickPick = async (items: unknown) => items as unknown[];
      try {
        await vscode.commands.executeCommand('notespace.restoreWikis');
      } finally {
        picks.showQuickPick = originalPick;
      }
      await waitFor(() => !!find(), 'wiki restored');
      // Delete: nothing happens unless the exact name is typed.
      typed = 'throwaway';
      await vscode.commands.executeCommand('notespace.deleteWiki', {
        label: 'Throwaway',
        root: find()!.id,
        prefix: '',
      });
      assert.ok(await vscode.workspace.fs.stat(project), 'a wrong name deletes nothing');
      typed = 'Throwaway';
      await vscode.commands.executeCommand('notespace.deleteWiki', {
        label: 'Throwaway',
        root: find()!.id,
        prefix: '',
      });
      await waitFor(() => !find(), 'wiki deleted');
      await assert.rejects(
        Promise.resolve(vscode.workspace.fs.stat(project)),
        'the project folder is gone',
      );
      // A wiki that is the whole workspace folder is never deleted from here.
      const whole = ws.roots.find(
        (r) =>
          !r.projectUri &&
          r.uri.toString().replace(/\/$/, '') === r.folder.uri.toString().replace(/\/$/, ''),
      );
      if (whole) {
        typed = whole.name;
        await assert
          .rejects(
            Promise.resolve(
              vscode.commands.executeCommand('notespace.deleteWiki', {
                label: whole.name,
                root: whole.id,
                prefix: '',
              }),
            ),
            /whole workspace folder/,
          )
          .catch(() => undefined);
        assert.ok(await vscode.workspace.fs.stat(whole.folder.uri), 'workspace folder intact');
      }
    } finally {
      window.showWarningMessage = original.warn;
      window.showInformationMessage = original.info;
      window.showInputBox = original.input;
      await api.context.workspaceState.update('notespace.removedWikis', []);
      ws.setHidden([]);
      await vscode.workspace.fs
        .delete(project, { recursive: true, useTrash: false })
        .then(undefined, () => undefined);
      await ws.refresh();
    }
  });
  await test('boards embedded in pages move tasks between status columns', async () => {
    const planner = api.planner;
    const root = ws.roots[0];
    const uri = await ws.createPage(
      root,
      'planning/Embedded board',
      '# Embedded board\n\n- [ ] Plan launch\n- [ ] Book venue status:doing\n\n```tasks\npage: this\nview: board\n```\n',
    );
    await waitFor(
      () =>
        planner.tasks(root.id).filter((t) => t.pagePath === 'planning/Embedded board.md').length ===
        2,
      'embedded board tasks indexed',
    );
    const replies: Array<Record<string, unknown>> = [];
    // The page sends keys as they appear in the card's data-task attribute.
    const enc = encodeURIComponent;
    const reply = async (m: unknown) => (replies.push(m as Record<string, unknown>), true);
    const task = (title: string) =>
      planner
        .tasks(root.id)
        .find((t) => t.pagePath === 'planning/Embedded board.md' && t.title === title)!;
    // The rendered board carries each task's key for the page to send back.
    const page = ws.index.all(root.id).find((p) => p.path === 'planning/Embedded board.md')!;
    const html = planner.collection(
      page,
      () => '#',
      true,
      true,
    )('tasks', 'page: this\nview: board');
    assert.ok(html.includes(`data-task="${encodeURIComponent(task('Plan launch').key)}"`));
    assert.equal(
      await planner.handleMove(
        { type: 'taskMove', key: enc(task('Plan launch').key), status: 'blocked' },
        reply,
      ),
      true,
    );
    assert.equal(replies.at(-1)!.error, undefined, String(replies.at(-1)!.error));
    assert.match(await readFile(uri.fsPath, 'utf8'), /^- \[ \] Plan launch status:blocked$/m);
    await waitFor(() => task('Plan launch')?.status === 'blocked', 'status re-indexed');
    // Done completes the task (checkbox and date); moving out of Done reopens it.
    await planner.handleMove(
      { type: 'taskMove', key: enc(task('Book venue').key), status: 'done' },
      reply,
    );
    assert.match(
      await readFile(uri.fsPath, 'utf8'),
      new RegExp(`^- \\[x\\] Book venue done:${planner.today(root)}$`, 'm'),
    );
    await waitFor(() => task('Book venue')?.status === 'done', 'done re-indexed');
    await planner.handleMove(
      { type: 'taskMove', key: enc(task('Book venue').key), status: 'todo' },
      reply,
    );
    assert.match(await readFile(uri.fsPath, 'utf8'), /^- \[ \] Book venue$/m);
    // Unknown statuses and stale keys are refused with a readable error; nothing is written.
    const before = await readFile(uri.fsPath, 'utf8');
    await planner.handleMove(
      { type: 'taskMove', key: enc(task('Plan launch').key), status: 'archived' },
      reply,
    );
    assert.match(String(replies.at(-1)!.error), /Unknown task or column/);
    await planner.handleMove(
      { type: 'taskMove', key: `${page.id}@99:zzzz`, status: 'doing' },
      reply,
    );
    assert.ok(replies.at(-1)!.error);
    assert.equal(await readFile(uri.fsPath, 'utf8'), before);
    assert.equal(await planner.handleMove({ type: 'other' }, reply), false);
    await vscode.workspace.fs.delete(uri, { useTrash: false });
  });
  await test('API client: collections, secrets, real requests, tests and chaining against local servers', async () => {
    const { ApiStore } = await import('../../api-store');
    const { HttpBlocks } = await import('../../http-blocks');
    const { emptyRequest } = await import('../../core/http/model');
    const store = new ApiStore(api.context);
    const seen: Array<{
      method?: string;
      url?: string;
      headers: Record<string, unknown>;
      body: string;
    }> = [];
    const other = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, headers: { ...req.headers }, body: '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ landed: true }));
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()));
    const otherPort = (other.address() as { port: number }).port;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
        const url = new URL(req.url || '/', 'http://x');
        if (url.pathname === '/login') {
          res.writeHead(200, {
            'content-type': 'application/json',
            'set-cookie': 'sid=abc; HttpOnly',
          });
          return res.end(JSON.stringify({ access_token: 'tok-123', user: { id: 42 } }));
        }
        if (url.pathname === '/profile') {
          res.writeHead(req.headers.authorization === 'Bearer tok-123' ? 200 : 401, {
            'content-type': 'application/json',
          });
          return res.end(JSON.stringify({ id: 42, name: 'Mario' }));
        }
        if (url.pathname === '/redirect') {
          res.writeHead(302, { location: `http://localhost:${otherPort}/elsewhere` });
          return res.end();
        }
        if (url.pathname === '/slow') return void setTimeout(() => res.end('late'), 3000);
        if (url.pathname === '/big') {
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end('x'.repeat(3 * 1024 * 1024));
        }
        res.writeHead(201, { 'content-type': 'application/json', 'x-trace': 't1' });
        res.end(
          JSON.stringify({
            method: req.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            type: req.headers['content-type'] || null,
            cookie: req.headers.cookie || null,
            body,
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    try {
      // Collections are folders of JSON files in api/.
      const id = await store.createCollection('Test APIs');
      const folder = await store.createFolder(id, '', 'Auth');
      const loginPath = await store.saveRequest(
        id,
        {
          ...emptyRequest('new', 'Login'),
          method: 'POST',
          url: '{{baseUrl}}/login',
          body: { type: 'json', text: '{"user":"mario","password":"{{password}}"}' },
          tests: 'status == 200\nset token = json $.access_token\nset userId = json $.user.id',
        },
        folder,
      );
      const profilePath = await store.saveRequest(
        id,
        {
          ...emptyRequest('new', 'Profile'),
          url: '{{baseUrl}}/profile',
          auth: { type: 'bearer', token: '{{token}}' },
          tests: 'status == 200\njson $.id == {{userId}}',
        },
        folder,
      );
      assert.equal(loginPath, 'auth/login');
      const file = vscode.Uri.joinPath(store.root(), id, 'auth', 'login.request.json');
      assert.match(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(file)),
        /"url": "\{\{baseUrl\}\}\/login"/,
      );
      await store.updateCollection(id, { variables: [{ key: 'baseUrl', value: base }] });
      // A secret environment variable lives in SecretStorage, not in the file.
      const envId = await store.saveEnvironment(undefined, {
        schemaVersion: 1,
        name: 'Local',
        variables: [{ key: 'password', value: '', secret: true }],
        secretValues: { password: 'p4ss-w0rd' },
      });
      await store.setActiveEnvironment(envId);
      const envText = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(store.root(), 'environments', `${envId}.env.json`),
        ),
      );
      assert.doesNotMatch(envText, /p4ss-w0rd/);
      // Chaining: login extracts the token, the profile request uses it.
      const login = await store.send(await store.request(id, loginPath), {
        collection: id,
        origin: 'client',
        ref: `${id}/${loginPath}`,
      });
      assert.equal(login.response?.status, 200, login.error);
      assert.deepEqual(
        login.tests.results.map((r) => r.pass),
        [true, true, true],
      );
      assert.equal(
        JSON.parse(seen.at(-1)!.body).password,
        'p4ss-w0rd',
        'secret resolved at send time',
      );
      assert.deepEqual(
        login.response?.cookies.map((c) => c.name),
        ['sid'],
      );
      const profile = await store.send(await store.request(id, profilePath), {
        collection: id,
        origin: 'client',
      });
      assert.equal(profile.response?.status, 200);
      assert.ok(
        profile.tests.results.every((r) => r.pass),
        JSON.stringify(profile.tests.results),
      );
      // Methods, query, headers, cookies, form, multipart, API key in the query.
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'upload.txt'),
        new TextEncoder().encode('file body'),
      );
      const cases = await Promise.all([
        store.send(
          {
            ...emptyRequest(),
            method: 'PUT',
            url: `${base}/items/1`,
            params: [{ key: 'q', value: 'a b' }],
            headers: [{ key: 'X-One', value: '1' }],
            cookies: [{ key: 'c', value: '2' }],
            body: { type: 'form', fields: [{ key: 'a', value: '1' }] },
            auth: { type: 'apikey', key: 'api_key', value: 'k-9', in: 'query' },
          },
          { origin: 'client' },
        ),
        store.send(
          {
            ...emptyRequest(),
            method: 'POST',
            url: `${base}/upload`,
            body: {
              type: 'multipart',
              fields: [
                { key: 'name', value: 'n' },
                { key: 'file', value: 'upload.txt', file: true },
              ],
            },
            auth: { type: 'basic', username: 'u', password: 'p' },
          },
          { origin: 'client' },
        ),
        store.send(
          { ...emptyRequest(), method: 'DELETE', url: `${base}/items/1` },
          { origin: 'client' },
        ),
        store.send(
          { ...emptyRequest(), method: 'HEAD', url: `${base}/items/1` },
          { origin: 'client' },
        ),
      ]);
      const put = JSON.parse(cases[0].response!.text!);
      assert.deepEqual(
        [put.method, put.query, put.type, put.cookie, put.body],
        ['PUT', { q: 'a b', api_key: 'k-9' }, 'application/x-www-form-urlencoded', 'c=2', 'a=1'],
      );
      const multipart = JSON.parse(cases[1].response!.text!);
      assert.match(multipart.type, /^multipart\/form-data; boundary=/);
      assert.match(multipart.body, /filename="upload\.txt"[\s\S]*file body/);
      assert.equal(
        seen.find((x) => x.url === '/upload')!.headers.authorization,
        `Basic ${Buffer.from('u:p').toString('base64')}`,
      );
      assert.equal(cases[2].response?.status, 201);
      assert.equal(cases[3].response?.text, '', 'HEAD has no body');
      // Redirects to another origin drop credentials.
      const redirected = await store.send(
        {
          ...emptyRequest(),
          url: `${base}/redirect`,
          headers: [{ key: 'Authorization', value: 'Bearer secret' }],
        },
        { origin: 'client' },
      );
      assert.equal(redirected.response?.status, 200);
      assert.equal(seen.at(-1)!.url, '/elsewhere');
      assert.equal(
        seen.at(-1)!.headers.authorization,
        undefined,
        'no credentials on the other origin',
      );
      // Timeout, cancellation and size limits.
      const slow = await store.send(
        { ...emptyRequest(), url: `${base}/slow`, timeoutMs: 300 },
        { origin: 'client' },
      );
      assert.match(slow.error!, /timed out after 0\.3 s/);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 200);
      const cancelled = await store.send(
        { ...emptyRequest(), url: `${base}/slow` },
        { origin: 'client', signal: controller.signal },
      );
      assert.match(cancelled.error!, /cancelled/);
      const settings = vscode.workspace.getConfiguration('notespace');
      await settings.update('api.maxResponseMB', 1, vscode.ConfigurationTarget.Global);
      const big = await store.send({ ...emptyRequest(), url: `${base}/big` }, { origin: 'client' });
      await settings.update('api.maxResponseMB', undefined, vscode.ConfigurationTarget.Global);
      assert.equal(big.response?.truncated, true);
      assert.equal(big.response?.text?.length, 1024 * 1024);
      // Cloud metadata services are refused; errors are clear.
      const meta = await store.send(
        { ...emptyRequest(), url: 'http://169.254.169.254/latest/meta-data' },
        { origin: 'client' },
      );
      assert.match(meta.error!, /cloud metadata service/);
      const closed = createServer();
      await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
      const closedPort = (closed.address() as { port: number }).port;
      await new Promise((r) => closed.close(r));
      const refused = await store.send(
        { ...emptyRequest(), url: `http://127.0.0.1:${closedPort}/` },
        { origin: 'client' },
      );
      assert.match(refused.error!, /refused the connection/);
      // History: method, redacted URL, status — no bodies, no credentials.
      const history = store.history();
      assert.ok(history.some((h) => h.ref === `${id}/${loginPath}` && h.status === 200));
      assert.ok(history.some((h) => /api_key=\*\*\*/.test(h.url)));
      assert.doesNotMatch(JSON.stringify(history), /k-9|tok-123|p4ss-w0rd/);
      // Export leaves secrets out; import creates a new collection.
      const exported = await store.exportCollection(id);
      assert.doesNotMatch(exported, /p4ss-w0rd|tok-123/);
      const copy = await store.importBundle(exported);
      assert.equal((await store.collection(copy)).items.length, 1);
      // Markdown ```http blocks: sent only on Send, with approval for documentation origins.
      const blocks = new HttpBlocks(
        store,
        { show: async () => undefined } as never,
        api.context.workspaceState,
      );
      const html = (await blocks.renderer('x'))(
        `POST ${base}/doc\nContent-Type: application/json\n\n{"a":1}`,
      );
      assert.match(html, /class="http-block interactive"/);
      assert.match(html, /<button type="button" class="http-send">Send<\/button>/);
      const before = seen.length;
      const window = vscode.window as unknown as {
        showWarningMessage: (...args: unknown[]) => Promise<unknown>;
      };
      const original = window.showWarningMessage;
      const asked: string[] = [];
      window.showWarningMessage = async (...args: unknown[]) => (
        asked.push(String(args[0])),
        args[args.length - 1]
      );
      let reply: Record<string, unknown> = {};
      try {
        await blocks.handle(
          {
            type: 'httpSend',
            id: 'h1',
            source: `POST ${base}/doc\nContent-Type: application/json\n\n{"a":1}`,
            body: '{"a":2}',
          },
          async (m) => ((reply = m as Record<string, unknown>), true),
        );
      } finally {
        window.showWarningMessage = original;
      }
      assert.equal(seen.length, before + 1, 'sent once after Send');
      assert.equal(JSON.parse(seen.at(-1)!.body).a, 2, 'the edited body is sent');
      assert.equal(reply.status, 201);
      assert.match(asked[0], /Allow requests from documentation pages/);
      assert.match(asked[1], /^Send POST/);
      await store.deleteCollection(id);
      await store.deleteCollection(copy);
      await store.deleteEnvironment(envId);
      await store.clearHistory();
    } finally {
      server.close();
      other.close();
      await vscode.workspace.fs
        .delete(store.root(), { recursive: true, useTrash: false })
        .then(undefined, () => undefined);
      await vscode.workspace.fs
        .delete(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'upload.txt'))
        .then(undefined, () => undefined);
      store.dispose();
    }
  });
  await test('API client: OAuth 2.0 client credentials and authorization code with PKCE', async () => {
    const { ApiStore } = await import('../../api-store');
    const { emptyRequest } = await import('../../core/http/model');
    const { createHash } = await import('node:crypto');
    const http = await import('node:http');
    const store = new ApiStore(api.context);
    const tokenCalls: Array<{ form: URLSearchParams; auth?: string }> = [];
    let challenge = '';
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = new URL(req.url || '/', 'http://x');
        if (url.pathname === '/token') {
          const form = new URLSearchParams(body);
          tokenCalls.push({ form, auth: req.headers.authorization });
          let token = '';
          if (
            form.get('grant_type') === 'client_credentials' &&
            req.headers.authorization === `Basic ${Buffer.from('app:s3cret').toString('base64')}`
          )
            token = 'cc-token';
          if (
            form.get('grant_type') === 'authorization_code' &&
            form.get('code') === 'code-1' &&
            createHash('sha256')
              .update(form.get('code_verifier') || '')
              .digest('base64url') === challenge
          )
            token = 'pkce-token';
          res.writeHead(token ? 200 : 400, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify(
              token ? { access_token: token, expires_in: 3600 } : { error: 'invalid_grant' },
            ),
          );
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ auth: req.headers.authorization || null }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const env = vscode.env as unknown as { openExternal: (uri: vscode.Uri) => Thenable<boolean> };
    const openExternal = env.openExternal;
    try {
      // Client credentials: the client secret goes in Basic auth to the token endpoint only.
      const cc = await store.send(
        {
          ...emptyRequest('cc', 'Me'),
          url: `${base}/me`,
          auth: {
            type: 'oauth2',
            grant: 'client_credentials',
            tokenUrl: `${base}/token`,
            clientId: 'app',
            clientSecret: 's3cret',
            scope: 'read',
          },
        },
        { origin: 'client' },
      );
      assert.equal(cc.response?.status, 200, cc.error);
      assert.equal(JSON.parse(cc.response!.text!).auth, 'Bearer cc-token');
      assert.equal(tokenCalls[0].form.get('scope'), 'read');
      assert.equal(tokenCalls[0].form.get('client_secret'), null, 'the secret is not in the form');
      // The token is cached for the session: a second request does not ask again.
      await store.send(
        {
          ...emptyRequest('cc', 'Me'),
          url: `${base}/me`,
          auth: {
            type: 'oauth2',
            grant: 'client_credentials',
            tokenUrl: `${base}/token`,
            clientId: 'app',
            clientSecret: 's3cret',
            scope: 'read',
          },
        },
        { origin: 'client' },
      );
      assert.equal(tokenCalls.length, 1);
      // Authorization code + PKCE: the browser is "opened"; the provider redirects to the loopback listener.
      const opened: string[] = [];
      env.openExternal = async (uri: vscode.Uri) => {
        const target = new URL(uri.toString(true));
        opened.push(target.toString());
        challenge = target.searchParams.get('code_challenge') || '';
        const back = new URL(target.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'code-1');
        back.searchParams.set('state', target.searchParams.get('state')!);
        void fetch(back);
        return true;
      };
      assert.equal(
        vscode.env.openExternal,
        env.openExternal,
        'openExternal can be replaced in tests',
      );
      const pkce = await store.send(
        {
          ...emptyRequest('pk', 'Me'),
          url: `${base}/me`,
          auth: {
            type: 'oauth2',
            grant: 'authorization_code',
            authUrl: `${base}/authorize`,
            tokenUrl: `${base}/token`,
            clientId: 'web',
          },
        },
        { origin: 'client' },
      );
      assert.equal(pkce.response?.status, 200, pkce.error);
      assert.equal(JSON.parse(pkce.response!.text!).auth, 'Bearer pkce-token');
      const authorize = new URL(opened[0]);
      assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
      assert.match(
        authorize.searchParams.get('redirect_uri')!,
        /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
      );
      assert.equal(
        tokenCalls.at(-1)!.form.get('redirect_uri'),
        authorize.searchParams.get('redirect_uri'),
      );
      // Tokens never reach the history.
      assert.doesNotMatch(JSON.stringify(store.history()), /cc-token|pkce-token|s3cret/);
      // Plain http token endpoints other than localhost are refused.
      const refused = await store
        .send(
          {
            ...emptyRequest('x', 'X'),
            url: `${base}/me`,
            auth: {
              type: 'oauth2',
              grant: 'client_credentials',
              tokenUrl: 'http://example.com/token',
              clientId: 'a',
            },
          },
          { origin: 'client' },
        )
        .then(
          (r) => r.error,
          (e: Error) => e.message,
        );
      assert.match(refused || '', /must use https/);
    } finally {
      env.openExternal = openExternal;
      server.close();
      await store.clearHistory();
      store.dispose();
    }
  });
  if (process.env.WIKI_BENCHMARK === '1')
    await test('benchmarks 1,000 documents through the real workspace and exporter', async () => {
      const versioned = ws.roots.find((r) => r.config?.wiki.title === 'Product Docs')!;
      const folder = vscode.Uri.joinPath(versioned.uri, 'benchmark');
      await vscode.workspace.fs.createDirectory(folder);
      let cursor = 0;
      const start = performance.now();
      await Promise.all(
        Array.from({ length: 16 }, async () => {
          while (cursor < 998) {
            const i = cursor++;
            await vscode.workspace.fs.writeFile(
              vscode.Uri.joinPath(folder, `page-${String(i).padStart(4, '0')}.md`),
              Buffer.from(
                `---\ntitle: Benchmark page ${i}\norder: ${i}\n---\n# Benchmark page ${i}\n\nSearchable documentation content for page ${i}.\n\n[Home](../index.md)\n`,
              ),
            );
          }
        }),
      );
      const filesMs = performance.now() - start;
      const openStart = performance.now();
      await ws.refresh();
      const openMs = performance.now() - openStart;
      assert.ok(ws.index.all(versioned.id).length >= 1000);
      const searchStart = performance.now();
      const matches = ws.index.search('Searchable documentation 997');
      const searchMs = performance.now() - searchStart;
      assert.ok(matches.length > 0);
      const parent = vscode.Uri.joinPath(versioned.projectUri!, 'benchmark-output');
      await vscode.workspace.fs.createDirectory(parent);
      const exportStart = performance.now();
      const result = await api.exportWiki(ws, versioned, parent);
      const exportMs = performance.now() - exportStart;
      assert.ok(result.pages >= 1000, `${result.pages} pages`);
      const epubStart = performance.now();
      const epub = await exportEpub(
        ws,
        versioned,
        vscode.Uri.joinPath(parent, 'benchmark.epub'),
        api.planner,
      );
      const epubMs = performance.now() - epubStart;
      assert.ok(epub.pages >= 1000);
      let pdfMs: number | undefined;
      if (process.env.WIKI_CHROMIUM) {
        await vscode.workspace
          .getConfiguration('notespace')
          .update(
            'export.browserPath',
            process.env.WIKI_CHROMIUM,
            vscode.ConfigurationTarget.Global,
          );
        const pdfStart = performance.now();
        const pdf = await exportPdf(
          ws,
          versioned,
          vscode.Uri.joinPath(parent, 'benchmark.pdf'),
          () => true,
          'Benchmark',
          api.planner,
        );
        pdfMs = performance.now() - pdfStart;
        assert.ok(pdf.pages >= 1000);
        await vscode.workspace
          .getConfiguration('notespace')
          .update('export.browserPath', undefined, vscode.ConfigurationTarget.Global);
      }
      const report = {
        pages: result.pages,
        fixtureCreationMs: Math.round(filesMs),
        wikiOpenAndIndexMs: Math.round(openMs),
        searchMs: Math.round(searchMs * 10) / 10,
        staticExportMs: Math.round(exportMs),
        epubExportMs: Math.round(epubMs),
        ...(pdfMs === undefined ? {} : { pdfExportMs: Math.round(pdfMs) }),
        environment: process.platform,
      };
      console.log('WIKI_BENCHMARK ' + JSON.stringify(report));
      if (process.env.WIKI_BENCHMARK_REPORT)
        await writeFile(process.env.WIKI_BENCHMARK_REPORT, JSON.stringify(report, null, 2) + '\n');
    });
  await vscode.workspace.saveAll(false);
  console.log(`NoteSpace: ${passed} extension-host integration tests passed.`);
}

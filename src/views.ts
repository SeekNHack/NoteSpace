import * as vscode from 'vscode';
import { Page } from './core/model';
import { WikiWorkspace } from './workspace';
import { posix } from './core/paths';
import { resolveImage, resolveAttachment } from './assets';
import { pageQuality, QualityIssue, rulesFor } from './core/quality';
import { scopeOf } from './core/scopes';
/** A page or a folder that a command acts on (from the Wiki tree, menus or the active tab). */
export interface PageNode {
  label: string;
  root: string;
  /** A folder (`guides/`); '' is the wiki's top level. */
  prefix?: string;
  page?: Page;
  uri?: vscode.Uri;
}
export async function showPage(
  uri: string | vscode.Uri,
  offset?: number,
  viewColumn?: vscode.ViewColumn,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(
    typeof uri === 'string' ? vscode.Uri.parse(uri) : uri,
  );
  await vscode.window.showTextDocument(doc, {
    ...(offset === undefined
      ? {}
      : { selection: new vscode.Range(doc.positionAt(offset), doc.positionAt(offset)) }),
    viewColumn,
    preview: false,
  });
}
const qualityFixes = new Set([
  'missing-alt',
  'heading-skip',
  'multiple-h1',
  'missing-field',
  'missing-section',
  'duplicate-heading',
]);
/** Quick fixes for content quality findings; each is a single, reviewable text edit. */
function qualityActions(
  doc: vscode.TextDocument,
  page: Page,
  diagnostics: vscode.Diagnostic[],
  issues: QualityIssue[],
): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const text = doc.getText();
  for (const d of diagnostics) {
    const issue = issues.find((i) => i.kind === d.code && i.message === d.message);
    if (!issue) continue;
    const edit = new vscode.WorkspaceEdit();
    let title = '';
    if (issue.kind === 'missing-alt' && issue.offset !== undefined) {
      const link = page.links.find((l) => l.kind === 'image' && l.start === issue.offset);
      if (!link) continue;
      const name = posix
        .basename(link.target.split(/[?#]/)[0], posix.extname(link.target.split(/[?#]/)[0]))
        .replace(/[-_]+/g, ' ')
        .trim();
      const bracket = text.indexOf('[', link.start);
      if (bracket < 0 || bracket > link.targetStart) continue;
      edit.insert(doc.uri, doc.positionAt(bracket + 1), name || 'Image');
      title = `Use “${name || 'Image'}” as alternative text`;
    } else if (
      (issue.kind === 'heading-skip' || issue.kind === 'multiple-h1') &&
      issue.offset !== undefined
    ) {
      const marks = /^#+/.exec(text.slice(issue.offset))?.[0];
      if (!marks) continue;
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(issue.offset), doc.positionAt(issue.offset + marks.length)),
        '#'.repeat(Number(issue.detail)),
      );
      title = `Change to a level ${issue.detail} heading`;
    } else if (issue.kind === 'duplicate-heading' && issue.offset !== undefined) {
      const heading = page.headings.find((h) => h.offset === issue.offset);
      if (!heading) continue;
      const lineEnd = text.indexOf('\n', heading.offset);
      const line = text
        .slice(heading.offset, lineEnd < 0 ? text.length : lineEnd)
        .replace(/\r$/, '');
      const taken = new Set(page.headings.map((h) => h.text.toLocaleLowerCase()));
      let n = 2;
      while (taken.has(`${heading.text} (${n})`.toLocaleLowerCase())) n++;
      const at = line.lastIndexOf(heading.text);
      if (at < 0) continue;
      edit.insert(doc.uri, doc.positionAt(heading.offset + at + heading.text.length), ` (${n})`);
      title = `Rename to “${heading.text} (${n})”`;
    } else if (
      issue.kind === 'missing-field' &&
      issue.detail &&
      !(issue.detail in (page.properties || {}))
    ) {
      const key = /^[A-Za-z_][\w-]*$/.test(issue.detail)
        ? issue.detail
        : JSON.stringify(issue.detail);
      const fm = /^(\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      if (fm) {
        const close = fm[0].search(/\r?\n---(?:\r?\n|$)/);
        edit.insert(doc.uri, doc.positionAt(close), `${eol}${key}: `);
      } else edit.insert(doc.uri, new vscode.Position(0, 0), `---${eol}${key}: ${eol}---${eol}`);
      title = `Add front matter field “${issue.detail}”`;
    } else if (issue.kind === 'missing-section' && issue.detail) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const ending = text.endsWith('\n') ? '' : eol;
      edit.insert(doc.uri, doc.positionAt(text.length), `${ending}${eol}## ${issue.detail}${eol}`);
      title = `Add section “${issue.detail}”`;
    } else continue;
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [d];
    action.edit = edit;
    action.isPreferred = true;
    actions.push(action);
  }
  return actions;
}
export function registerLanguageFeatures(workspace: WikiWorkspace): vscode.Disposable {
  const selector = { language: 'markdown' },
    index = workspace.index;
  const pageAt = (doc: vscode.TextDocument) => index.byUri(doc.uri.toString());
  const linkAt = (doc: vscode.TextDocument, pos: vscode.Position) =>
    pageAt(doc)?.links.find((l) => doc.offsetAt(pos) >= l.start && doc.offsetAt(pos) <= l.end);
  const diagnostics = vscode.languages.createDiagnosticCollection('notespace');
  const issuesOf = (page: Page, sameScope: Page[]): QualityIssue[] => {
    const config = workspace.rootFor(page).config;
    return pageQuality(
      page,
      sameScope,
      config ? rulesFor(config.quality.rules, scopeOf(page.path, config).logical) : [],
    );
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const update = async () => {
    const current = ++revision;
    const output: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];
    // Duplicate titles only matter within one wiki, language and version.
    const groups = new Map<string, Page[]>();
    for (const page of index.all()) {
      const key = `${page.root}\0${index.scope?.(page) ?? ''}`;
      groups.set(key, [...(groups.get(key) || []), page]);
    }
    for (const page of index.all()) {
      if (
        !vscode.workspace
          .getConfiguration('notespace', vscode.Uri.parse(page.uri))
          .get('diagnostics', true)
      )
        continue;
      const offsets = [0];
      for (let i = 0; i < page.text.length; i++) if (page.text[i] === '\n') offsets.push(i + 1);
      const position = (offset: number) => {
        let lo = 0,
          hi = offsets.length;
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1;
          if (offsets[mid] <= offset) lo = mid;
          else hi = mid;
        }
        return new vscode.Position(lo, offset - offsets[lo]);
      };
      const items: vscode.Diagnostic[] = [];
      if (page.metadataError) {
        const d = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 3),
          `Invalid front matter: ${page.metadataError}`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'NoteSpace';
        items.push(d);
      }
      for (const link of page.links) {
        if (link.kind === 'image') {
          if (/^(?:[a-z]+:|\/\/)/i.test(link.target)) continue;
          const uri = await resolveImage(workspace, workspace.rootFor(page), page, link.target);
          if (!uri) {
            const d = new vscode.Diagnostic(
              new vscode.Range(position(link.targetStart), position(link.targetEnd)),
              `Local image not found or unsupported: ${link.target}`,
              vscode.DiagnosticSeverity.Warning,
            );
            d.source = 'NoteSpace';
            d.code = 'image';
            items.push(d);
          }
          continue;
        }
        // Non-Markdown file links are not page links.
        if (
          link.kind === 'markdown' &&
          /\.[a-z\d]+(?:#.*)?$/i.test(link.target) &&
          !/\.md(?:#.*)?$/i.test(link.target)
        ) {
          if (
            /\.(?:pdf|txt|csv|zip|docx|xlsx|pptx)(?:#.*)?$/i.test(link.target) &&
            !(await resolveAttachment(workspace, workspace.rootFor(page), page, link.target))
          ) {
            const d = new vscode.Diagnostic(
              new vscode.Range(position(link.targetStart), position(link.targetEnd)),
              `Local attachment not found: ${link.target}`,
              vscode.DiagnosticSeverity.Warning,
            );
            d.source = 'NoteSpace';
            d.code = 'attachment';
            items.push(d);
          }
          continue;
        }
        const result = index.resolve(page, link.target, link.kind);
        if (!result.error) continue;
        const messages = {
          missing: 'Page not found',
          ambiguous: 'Ambiguous page name; use a path',
          heading: 'Heading not found',
          unsafe: 'Link escapes the wiki or contains an unsafe path',
        };
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(position(link.targetStart), position(link.targetEnd)),
          `${messages[result.error]}: ${link.target}`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.code = result.error;
        diagnostic.source = 'NoteSpace';
        items.push(diagnostic);
      }
      for (const issue of issuesOf(
        page,
        groups.get(`${page.root}\0${index.scope?.(page) ?? ''}`) || [],
      )) {
        const lineEnd = issue.offset === undefined ? -1 : page.text.indexOf('\n', issue.offset);
        const d = new vscode.Diagnostic(
          issue.offset === undefined
            ? new vscode.Range(0, 0, 0, 0)
            : new vscode.Range(
                position(issue.offset),
                position(lineEnd < 0 ? page.text.length : lineEnd),
              ),
          issue.message,
          issue.kind === 'empty' || issue.kind === 'missing-section'
            ? vscode.DiagnosticSeverity.Information
            : vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'NoteSpace';
        d.code = issue.kind;
        items.push(d);
      }
      output.push([vscode.Uri.parse(page.uri), items]);
    }
    if (current !== revision) return;
    diagnostics.clear();
    diagnostics.set(output);
  };
  const subscriptions = [
    diagnostics,
    workspace.onDidChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void update();
      }, 120);
    }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems(doc, pos) {
          const page = pageAt(doc);
          if (!page) return;
          const line = doc.lineAt(pos).text.slice(0, pos.character),
            match = /\[\[([^\]\n|]*)$/.exec(line);
          if (!match) return;
          const prefix = match[1],
            hash = prefix.indexOf('#');
          const range = new vscode.Range(
            pos.line,
            pos.character - prefix.length,
            pos.line,
            pos.character,
          );
          if (hash >= 0) {
            const target = index.resolve(page, prefix.slice(0, hash)).page;
            if (!target) return;
            return target.headings.map((h) => {
              const item = new vscode.CompletionItem(h.text, vscode.CompletionItemKind.Reference);
              item.insertText = `${prefix.slice(0, hash)}#${h.slug}`;
              item.range = range;
              item.filterText = `${prefix.slice(0, hash)}#${h.text}`;
              return item;
            });
          }
          return index.all(page.root).map((p) => {
            const item = new vscode.CompletionItem(p.title, vscode.CompletionItemKind.File);
            item.detail = p.path;
            item.insertText = `/${p.path.replace(/\.md$/i, '')}`;
            item.filterText = `${p.title} /${p.path}`;
            item.range = range;
            return item;
          });
        },
      },
      '[',
      '/',
      '#',
    ),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(doc, pos) {
        const page = pageAt(doc),
          link = linkAt(doc, pos);
        if (!page || !link || link.kind === 'image') return;
        const r = index.resolve(page, link.target, link.kind);
        if (!r.page) return;
        const before = r.page.text.slice(0, r.heading?.offset || 0).split('\n');
        return new vscode.Location(
          vscode.Uri.parse(r.page.uri),
          new vscode.Position(before.length - 1, before.at(-1)!.length),
        );
      },
    }),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(doc, pos) {
        const page = pageAt(doc),
          link = linkAt(doc, pos);
        if (!page || !link || link.kind === 'image') return;
        const r = index.resolve(page, link.target, link.kind);
        if (!r.page) return;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${r.page.title.replace(/[\\*_[\]`]/g, '\\$&')}**  \n`);
        md.appendText(r.page.path);
        md.appendMarkdown('\n\n');
        const excerpt = r.page.body
          .replace(/^(?:#{1,6}\s+.*|\s*)\n/gm, '')
          .trim()
          .slice(0, 350);
        md.appendText(excerpt || 'Empty page');
        if (r.page.tags.length) {
          md.appendMarkdown('\n\n');
          md.appendText(r.page.tags.map((tag) => `#${tag}`).join(' '));
        }
        return new vscode.Hover(md);
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      provideReferences(doc, pos, context) {
        const page = pageAt(doc);
        if (!page) return;
        const link = linkAt(doc, pos),
          target = link ? index.resolve(page, link.target, link.kind).page : page;
        if (!target) return;
        const refs = index.backlinks(target).map((b) => {
          const lines = b.page.text.slice(0, b.link.start).split('\n');
          return new vscode.Location(
            vscode.Uri.parse(b.page.uri),
            new vscode.Position(lines.length - 1, lines.at(-1)!.length),
          );
        });
        if (context.includeDeclaration)
          refs.unshift(
            new vscode.Location(vscode.Uri.parse(target.uri), new vscode.Position(0, 0)),
          );
        return refs;
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(doc) {
        return pageAt(doc)?.headings.map((h) => {
          const p = doc.positionAt(h.offset),
            range = new vscode.Range(p, doc.lineAt(p).range.end);
          return new vscode.DocumentSymbol(h.text, '', vscode.SymbolKind.String, range, range);
        });
      },
    }),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(doc, range, context) {
          const page = pageAt(doc);
          if (!page) return;
          const quality = context.diagnostics.filter(
            (d) =>
              d.source === 'NoteSpace' && typeof d.code === 'string' && qualityFixes.has(d.code),
          );
          const fixes = quality.length
            ? qualityActions(doc, page, quality, issuesOf(page, []))
            : [];
          return fixes.concat(
            context.diagnostics
              .filter((d) => d.source === 'NoteSpace' && d.code === 'missing')
              .flatMap((d) => {
                const link = linkAt(doc, range.start);
                if (!link || link.kind !== 'wiki') return [];
                const raw = link.target.split('#')[0];
                if (!raw) return [];
                const name = raw.startsWith('/')
                  ? raw.slice(1)
                  : /^\.{1,2}\//.test(raw)
                    ? posix.join(posix.dirname(page.path), raw)
                    : raw;
                const action = new vscode.CodeAction(
                  `Create page “${name}”`,
                  vscode.CodeActionKind.QuickFix,
                );
                action.diagnostics = [d];
                action.command = {
                  command: 'notespace.newPage',
                  title: 'Create Page',
                  arguments: [name, page.root],
                };
                return [action];
              }),
          );
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  ];
  void update();
  return new vscode.Disposable(() => {
    if (timer) clearTimeout(timer);
    subscriptions.forEach((s) => s.dispose());
  });
}

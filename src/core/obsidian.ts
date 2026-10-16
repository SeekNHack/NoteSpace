import { posix } from './paths';

/**
 * Obsidian vault → NoteSpace conversion. Pure functions over text so the result can be
 * previewed before anything is written. The vault itself is never modified.
 *
 * Converted: `![[image.png|300]]` → `![image](path)`, `![[Note]]` → `{{ include "Note.md" }}`,
 * `> [!kind]± Title` callouts → `:::kind "Title"`, `%%comments%%` → HTML comments,
 * `[[Note#^block]]` → `[[Note]]`. Kept as is (already supported): `[[links|labels]]`,
 * `[[Note#Heading]]`, `==highlight==`, tags, front matter. Reported: Dataview queries,
 * block ids, nested callouts, unknown embeds.
 */
export interface VaultFile {
  path: string;
  text: string;
}
export interface ConvertedNote {
  path: string;
  text: string;
  changes: string[];
  warnings: string[];
}
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const MEDIA = /\.(mp4|webm|mp3|ogg)$/i;
const calloutKinds: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'info',
  tip: 'tip',
  hint: 'tip',
  important: 'important',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

/** Obsidian resolves `[[name]]` by file name anywhere in the vault: shortest path wins. */
export function vaultResolver(files: string[]) {
  const byName = new Map<string, string[]>();
  for (const file of files) {
    for (const key of [
      posix.basename(file).toLowerCase(),
      posix.basename(file).replace(/\.md$/i, '').toLowerCase(),
      file.toLowerCase(),
      file.replace(/\.md$/i, '').toLowerCase(),
    ])
      byName.set(key, [...(byName.get(key) || []), file]);
  }
  return (name: string): string | undefined => {
    const matches = byName.get(name.trim().replace(/^\//, '').toLowerCase());
    return matches
      ?.slice()
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
  };
}

const rel = (from: string, to: string) => {
  const r = posix.relative(posix.dirname(from), to);
  return r.split('/').map(encodeURIComponent).join('/');
};

export function convertNote(
  file: VaultFile,
  resolve: (name: string) => string | undefined,
): ConvertedNote {
  const changes: string[] = [],
    warnings: string[] = [];
  const count = (label: string, n: number) => n && changes.push(`${label}: ${n}`);
  const lines = file.text.split('\n');
  const out: string[] = [];
  let fence: string | undefined;
  let callout: { depth: number } | undefined;
  let callouts = 0,
    embeds = 0,
    includes = 0,
    comments = 0,
    blockRefs = 0;
  const inline = (line: string) =>
    line
      .replace(
        /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
        (all, target: string, size?: string) => {
          const found = resolve(target);
          if (found && (IMAGE.test(found) || MEDIA.test(found))) {
            embeds++;
            const alt = posix.basename(found).replace(/\.[^.]+$/, '');
            if (size && !/^\d+(x\d+)?$/.test(size)) return `![${size}](${rel(file.path, found)})`;
            if (size)
              warnings.push(`${file.path}: image size “${size}” for ${target} was dropped.`);
            return `![${alt}](${rel(file.path, found)})`;
          }
          if (found && /\.md$/i.test(found)) {
            includes++;
            return `{{ include "${posix.relative(posix.dirname(file.path), found)}" }}`;
          }
          warnings.push(`${file.path}: embed ${all} could not be resolved and was kept as text.`);
          return all;
        },
      )
      .replace(
        /\[\[([^\]|#]*)#\^[A-Za-z0-9-]+(\|[^\]]*)?\]\]/g,
        (_all, target: string, label = '') => {
          blockRefs++;
          return `[[${target}${label}]]`;
        },
      )
      .replace(/%%([\s\S]*?)%%/g, (_all, body: string) => {
        comments++;
        return `<!--${body.replace(/--/g, '- -')}-->`;
      });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = undefined;
      out.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      if (/^\s*(`{3,}|~{3,})\s*dataview(js)?\b/.test(line))
        warnings.push(
          `${file.path}: Dataview query (line ${i + 1}) is kept as a code block; it does not run in NoteSpace.`,
        );
      if (callout) {
        out.push(':::');
        callout = undefined;
      }
      out.push(line);
      continue;
    }
    const start = /^>\s*\[!([A-Za-z]+)\]([+-]?)\s*(.*)$/.exec(line);
    if (start && !callout) {
      const kind = calloutKinds[start[1].toLowerCase()];
      if (!kind) warnings.push(`${file.path}: callout type “${start[1]}” became a note.`);
      const title = start[3].trim();
      out.push(
        `:::${kind || 'note'}${title ? ` ${JSON.stringify(inline(title))}` : ''}${start[2] === '-' ? ' collapsed' : ''}`,
      );
      callout = { depth: 1 };
      callouts++;
      continue;
    }
    if (callout) {
      if (/^>/.test(line)) {
        const inner = line.replace(/^>\s?/, '');
        if (/^>\s*\[!/.test(inner))
          warnings.push(`${file.path}: nested callout (line ${i + 1}) is kept as a quote.`);
        out.push(inline(inner));
        continue;
      }
      out.push(':::');
      callout = undefined;
    }
    out.push(inline(line));
  }
  if (callout) out.push(':::');
  if (/(^|\s)\^[A-Za-z0-9-]{2,}\s*$/m.test(file.text))
    warnings.push(
      `${file.path}: block ids (^id) are kept as text; links to them now point to the page.`,
    );
  count('callouts converted', callouts);
  count('image/media embeds converted', embeds);
  count('note embeds converted to includes', includes);
  count('comments converted', comments);
  count('block references simplified', blockRefs);
  return { path: file.path, text: out.join('\n'), changes, warnings };
}

export function planVaultImport(notes: VaultFile[], others: string[]) {
  const resolve = vaultResolver([...notes.map((n) => n.path), ...others]);
  const converted = notes.map((n) => convertNote(n, resolve));
  const attachments = others.filter(
    (p) => IMAGE.test(p) || MEDIA.test(p) || /\.(pdf|csv|json|canvas|ipynb|txt|zip)$/i.test(p),
  );
  const skipped = others.filter((p) => !attachments.includes(p));
  return {
    notes: converted,
    attachments,
    skipped,
    warnings: [
      ...converted.flatMap((c) => c.warnings),
      ...skipped.map((p) => `${p}: not copied (unsupported file type).`),
    ],
  };
}

export function importReport(
  plan: ReturnType<typeof planVaultImport>,
  source: string,
  target: string,
): string {
  const changed = plan.notes.filter((n) => n.changes.length);
  return `# Obsidian import report\n\nSource vault: \`${source}\` (not modified)\nNew wiki: \`${target}\`\n\n- Pages: ${plan.notes.length} (${changed.length} converted)\n- Attachments copied: ${plan.attachments.length}\n- Files not copied: ${plan.skipped.length}\n- Warnings: ${plan.warnings.length}\n\n## Converted pages\n\n${changed.length ? changed.map((n) => `- \`${n.path}\`: ${n.changes.join(', ')}`).join('\n') : 'None.'}\n\n## Warnings\n\n${plan.warnings.length ? plan.warnings.map((w) => `- ${w}`).join('\n') : 'None.'}\n`;
}

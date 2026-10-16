/**
 * `.gitignore` matching for wiki discovery, written from the gitignore documentation: patterns
 * are relative to the file that contains them, the last matching rule wins, `!` re-includes,
 * a trailing `/` matches directories only, a leading or middle `/` anchors the pattern, `*`
 * and `?` never cross `/`, `**` spans directories, and a file inside an ignored directory
 * cannot be re-included.
 */
interface Rule {
  negate: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const before = i === 0 || glob[i - 1] === '/';
        const after = glob[i + 2] === '/' || i + 2 === glob.length;
        if (before && after) {
          // `**/` = zero or more directories; trailing `/**` = everything inside.
          out += i + 2 === glob.length ? '.*' : '(?:.*/)?';
          i += glob[i + 2] === '/' ? 2 : 1;
          continue;
        }
      }
      out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end < 0) out += '\\[';
      else {
        let set = glob.slice(i + 1, end).replace(/\\/g, '\\\\');
        if (set.startsWith('!')) set = `^${set.slice(1)}`;
        out += `[${set}]`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < glob.length) out += `\\${glob[++i]}`;
    else out += /[.+^${}()|]/.test(c) ? `\\${c}` : c;
  }
  return out;
}

export function parseGitignore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Trailing spaces are ignored unless escaped.
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    if (!line) continue;
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const body = globToRegex(line);
    rules.push({
      negate,
      dirOnly,
      regex: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`),
    });
  }
  return rules;
}

/** Ignore rules of a tree: `files` maps a directory ('' = top) to its `.gitignore` text. */
export class GitignoreMatcher {
  private readonly dirs: Array<{ base: string; rules: Rule[] }>;
  constructor(files: Map<string, string> | Record<string, string>) {
    const entries = files instanceof Map ? [...files] : Object.entries(files);
    this.dirs = entries
      .map(([base, text]) => ({
        base: base.replace(/^\/+|\/+$/g, ''),
        rules: parseGitignore(text),
      }))
      .filter((d) => d.rules.length)
      // Deeper files take precedence: evaluate shallow first, deep last.
      .sort(
        (a, b) =>
          a.base.split('/').length - b.base.split('/').length || a.base.localeCompare(b.base),
      );
  }
  get empty(): boolean {
    return !this.dirs.length;
  }
  private decide(path: string, isDir: boolean): boolean {
    let ignored = false;
    for (const { base, rules } of this.dirs) {
      if (base && path !== base && !path.startsWith(`${base}/`)) continue;
      const relative = base ? path.slice(base.length + 1) : path;
      if (!relative) continue;
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.regex.test(relative)) ignored = !rule.negate;
      }
    }
    return ignored;
  }
  /** `path` is relative to the top of the tree, with `/` separators. */
  ignores(path: string, isDir = false): boolean {
    const parts = path.replace(/^\/+|\/+$/g, '').split('/');
    for (let i = 1; i < parts.length; i++)
      if (this.decide(parts.slice(0, i).join('/'), true)) return true;
    return this.decide(parts.join('/'), isDir);
  }
}

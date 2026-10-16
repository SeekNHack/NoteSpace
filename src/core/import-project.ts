import { parseDocument } from 'yaml';
import { defaultConfig, WikiConfig } from './config';
import { safeRelative } from './paths';

export interface ImportPlan {
  config: WikiConfig;
  warnings: string[];
}

/** Maps only supported MkDocs settings; source configuration is never rewritten. */
export function planMkDocsImport(source: string): ImportPlan {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid mkdocs.yml: ${document.errors[0].message}`);
  const value = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('mkdocs.yml must contain a mapping.');
  const data = value as Record<string, unknown>;
  const title =
    typeof data.site_name === 'string' && data.site_name.trim()
      ? data.site_name
      : 'Imported documentation';
  const config = defaultConfig(title);
  const root = data.docs_dir === undefined ? 'docs' : data.docs_dir;
  if (typeof root !== 'string') throw new Error('docs_dir must be a string.');
  config.content.root = safeRelative(root);
  if (config.content.root === '.') throw new Error('docs_dir must be a subdirectory.');
  if (typeof data.site_description === 'string') config.wiki.description = data.site_description;
  const theme = data.theme;
  if (theme && typeof theme === 'object' && !Array.isArray(theme)) {
    const language = (theme as Record<string, unknown>).language;
    if (typeof language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language))
      config.wiki.language = language;
  }
  const unsupported = Object.keys(data).filter(
    (key) => !['site_name', 'site_description', 'docs_dir'].includes(key),
  );
  const warnings = unsupported.map(
    (key) => `MkDocs setting ${key} was not migrated; review it in mkdocs.yml.`,
  );
  return { config, warnings };
}

export function unsupportedMkDocsSyntax(path: string, markdown: string): string[] {
  const warnings: string[] = [];
  if (/^\s*(?:!!!|\?\?\?)\s/m.test(markdown))
    warnings.push(
      `${path}: MkDocs admonition syntax requires source editing or migration to ::: blocks.`,
    );
  if (/\{[%#][\s\S]*?[%#]\}|--8<--/.test(markdown))
    warnings.push(`${path}: template or snippet directive was not migrated.`);
  if (/\{:[^}]+\}/.test(markdown))
    warnings.push(`${path}: attribute-list syntax was not migrated.`);
  return warnings;
}

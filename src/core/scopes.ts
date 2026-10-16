import type { WikiConfig } from './config';
import type { Page } from './model';

/**
 * Language variants and archived versions are plain folders inside the content root:
 *
 *   guide/setup.md                  current docs, default language (wiki.language)
 *   it/guide/setup.md               Italian translation (i18n.languages: [it])
 *   _versions/1.0/guide/setup.md    archived version 1.0 (versions.archived: ['1.0'])
 *   _versions/1.0/it/guide/setup.md its Italian translation
 *
 * A page's scope is its (version, language) pair; `logical` is the path without the prefixes,
 * which links the same page across languages and versions.
 */
export const VERSIONS_DIR = '_versions';
export interface Scope {
  version?: string;
  language?: string;
  logical: string;
}
type I18nConfig = Pick<WikiConfig, 'i18n' | 'versions'> & {
  wiki: Pick<WikiConfig['wiki'], 'language'>;
};

export function scopeOf(path: string, config?: I18nConfig): Scope {
  let rest = path,
    version: string | undefined,
    language: string | undefined;
  const parts = rest.split('/');
  if (
    parts[0] === VERSIONS_DIR &&
    parts.length > 2 &&
    config?.versions.archived.includes(parts[1])
  ) {
    version = parts[1];
    rest = parts.slice(2).join('/');
  }
  const first = rest.split('/');
  if (first.length > 1 && config?.i18n.languages.includes(first[0])) {
    language = first[0];
    rest = first.slice(1).join('/');
  }
  return { version, language, logical: rest };
}

/** Same page in another scope (`undefined` = current version / default language). */
export function scopedPath(logical: string, version?: string, language?: string): string {
  return [version ? `${VERSIONS_DIR}/${version}` : '', language || '', logical]
    .filter(Boolean)
    .join('/');
}

export const scopeKey = (scope: Scope) => `${scope.version || ''}\0${scope.language || ''}`;
export const isArchived = (page: Page, config?: I18nConfig) => !!scopeOf(page.path, config).version;

/** FNV-1a 64-bit over the normalized body: a stable, portable fingerprint for translations. */
export function contentHash(body: string): string {
  let hash = 0xcbf29ce484222325n;
  const text = body.replace(/\r\n?/g, '\n').trim();
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export interface LanguageCoverage {
  language: string;
  translated: number;
  missing: Page[];
  /** Translations whose `translated_from` no longer matches the source page. */
  outdated: Array<{ source: Page; translation: Page }>;
  /** Translations without a `translated_from` marker: present, freshness unknown. */
  unknown: Page[];
}
/** Translation coverage of the current version's default-language pages. */
export function translationCoverage(
  pages: Page[],
  config: I18nConfig,
): { sources: number; languages: LanguageCoverage[] } {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const sources = pages.filter((p) => {
    const scope = scopeOf(p.path, config);
    return !scope.version && !scope.language && !p.draft;
  });
  return {
    sources: sources.length,
    languages: config.i18n.languages.map((language) => {
      const result: LanguageCoverage = {
        language,
        translated: 0,
        missing: [],
        outdated: [],
        unknown: [],
      };
      for (const source of sources) {
        const translation = byPath.get(scopedPath(source.path, undefined, language));
        if (!translation) result.missing.push(source);
        else {
          result.translated++;
          if (!translation.translatedFrom) result.unknown.push(translation);
          else if (translation.translatedFrom !== contentHash(source.body))
            result.outdated.push({ source, translation });
        }
      }
      return result;
    }),
  };
}

/** Variants of a page that exist, for language and version switchers. */
export function variants(page: Page, pages: Page[], config: I18nConfig) {
  const scope = scopeOf(page.path, config);
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const languages = [undefined, ...config.i18n.languages].map((language) => ({
    language: language || config.wiki.language,
    page: byPath.get(scopedPath(scope.logical, scope.version, language)),
    current: (language || undefined) === scope.language,
  }));
  const versions = [undefined, ...config.versions.archived].map((version) => ({
    version: version || config.versions.current || 'latest',
    archived: !!version,
    page: byPath.get(scopedPath(scope.logical, version, scope.language)),
    current: version === scope.version,
  }));
  return { scope, languages, versions };
}

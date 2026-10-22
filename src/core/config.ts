import { parseDocument, stringify } from 'yaml';
import { safeRelative } from './paths';
import { fonts, FontId, presets, widths, WidthId } from './themes';

export interface WikiConfig {
  schemaVersion: 1;
  wiki: {
    title: string;
    description: string;
    language: string;
    /** Codicon name shown for the wiki in the Pages view (optional). */
    icon?: string;
    /** Color preset of the wiki's icon (optional). */
    color?: string;
    /** A short message shown above every page of the site and in the Wiki (inline Markdown). */
    announcement?: string;
  };
  content: { root: string; homepage: string };
  navigation: { mode: 'automatic'; sort: 'filename' | 'title' | 'order' };
  appearance: {
    theme: 'system' | 'light' | 'dark';
    accent: string;
    /** Curated look for the reader and the static site; see core/themes.ts. */
    preset: string;
    font: FontId;
    width: WidthId;
  };
  /**
   * Optional page-view counting for the exported site. Off unless a provider and an endpoint
   * you run or choose are configured; no cookies, identifiers or VS Code telemetry.
   */
  analytics: { provider: 'none' | 'beacon' | 'plausible'; endpoint: string; domain: string };
  /**
   * Content rules checked by the quality engine. Each rule applies to pages under `folder`
   * (relative to the content root; empty = every page).
   */
  quality: { rules: QualityRule[]; staleDays: number };
  features: {
    search: boolean;
    tableOfContents: boolean;
    breadcrumbs: boolean;
    /** Export daily notes, planner snapshots and task embeds. Off by default for privacy. */
    plannerExport: boolean;
  };
  /** `url`: where the site is published (https), for share previews and canonical links. */
  build: { output: string; basePath: string; url?: string };
  /** Extra languages; translations live in `<content root>/<code>/` and the default language is `wiki.language`. */
  i18n: { languages: string[] };
  /** `current` labels the live docs; archived snapshots live in `<content root>/_versions/<id>/`. */
  versions: { current: string; archived: string[] };
}
export interface QualityRule {
  folder: string;
  /** Front matter fields that must be present and non-empty. */
  fields: string[];
  /** Headings (any level, case-insensitive) every page must have. */
  sections: string[];
}
export const wikiColors = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'magenta', 'cyan'];
export const defaultConfig = (title = 'My Documentation'): WikiConfig => ({
  schemaVersion: 1,
  wiki: { title, description: 'Created with NoteSpace', language: 'en' },
  content: { root: 'docs', homepage: 'index.md' },
  navigation: { mode: 'automatic', sort: 'filename' },
  appearance: {
    theme: 'system',
    accent: '#4f87ff',
    preset: 'default',
    font: 'system',
    width: 'normal',
  },
  features: { search: true, tableOfContents: true, breadcrumbs: true, plannerExport: false },
  build: { output: 'dist', basePath: '/' },
  i18n: { languages: [] },
  versions: { current: '', archived: [] },
  analytics: { provider: 'none', endpoint: '', domain: '' },
  quality: { rules: [], staleDays: 0 },
});
const languageCode = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const versionId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const list = (value: unknown, field: string, valid: RegExp, what: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be a list.`);
  const items = value.map((v) => {
    if (typeof v !== 'string' || !valid.test(v))
      throw new Error(`${field}: “${String(v)}” is not a valid ${what}.`);
    return v;
  });
  if (new Set(items).size !== items.length) throw new Error(`${field} contains duplicates.`);
  return items;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const str = (value: unknown, fallback: string, field: string): string => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  return value;
};
const bool = (value: unknown, fallback: boolean, field: string): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`);
  return value;
};
export function parseConfig(source: string): WikiConfig {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`Invalid wiki.yaml: ${doc.errors[0].message}`);
  const data = object(doc.toJS({ maxAliasCount: 0 }));
  if (data.schemaVersion !== 1)
    throw new Error(
      `Unsupported wiki.yaml schemaVersion: ${String(data.schemaVersion)}. Expected 1.`,
    );
  const defaults = defaultConfig();
  const wiki = object(data.wiki),
    content = object(data.content),
    navigation = object(data.navigation);
  const appearance = object(data.appearance),
    features = object(data.features),
    build = object(data.build),
    i18n = object(data.i18n),
    analytics = object(data.analytics),
    quality = object(data.quality),
    versions = object(data.versions);
  const root = safeRelative(str(content.root, defaults.content.root, 'content.root'), true);
  if (root === '.')
    throw new Error(
      'content.root must be a subdirectory so build.output stays outside source content.',
    );
  const homepage = safeRelative(
    str(content.homepage, defaults.content.homepage, 'content.homepage'),
  );
  if (!/\.md$/i.test(homepage)) throw new Error('content.homepage must be a Markdown file.');
  const output = safeRelative(str(build.output, defaults.build.output, 'build.output'));
  if (root === output || output.startsWith(root + '/') || root.startsWith(output + '/'))
    throw new Error('build.output and content.root must be separate directories.');
  const theme = str(appearance.theme, defaults.appearance.theme, 'appearance.theme');
  if (!['system', 'light', 'dark'].includes(theme))
    throw new Error('appearance.theme must be system, light, or dark.');
  const sort = str(navigation.sort, defaults.navigation.sort, 'navigation.sort');
  if (!['filename', 'title', 'order'].includes(sort))
    throw new Error('navigation.sort must be filename, title, or order.');
  const accent = str(appearance.accent, defaults.appearance.accent, 'appearance.accent');
  if (!/^#[0-9a-f]{6}$/i.test(accent))
    throw new Error('appearance.accent must be a six-digit hex color.');
  const preset = str(appearance.preset, defaults.appearance.preset, 'appearance.preset');
  if (!presets.some((p) => p.id === preset))
    throw new Error(`appearance.preset must be one of ${presets.map((p) => p.id).join(', ')}.`);
  const font = str(appearance.font, defaults.appearance.font, 'appearance.font');
  if (!(font in fonts))
    throw new Error(`appearance.font must be one of ${Object.keys(fonts).join(', ')}.`);
  const width = str(appearance.width, defaults.appearance.width, 'appearance.width');
  if (!(width in widths))
    throw new Error(`appearance.width must be one of ${Object.keys(widths).join(', ')}.`);
  const provider = str(analytics.provider, 'none', 'analytics.provider');
  if (!['none', 'beacon', 'plausible'].includes(provider))
    throw new Error('analytics.provider must be none, beacon or plausible.');
  const endpoint = str(analytics.endpoint, '', 'analytics.endpoint');
  if (
    endpoint &&
    !/^https:\/\/[^\s/]+(\/\S*)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(endpoint)
  )
    throw new Error('analytics.endpoint must be an https URL (http is allowed for localhost).');
  if (provider !== 'none' && !endpoint)
    throw new Error('analytics.endpoint is required when analytics.provider is set.');
  const domain = str(analytics.domain, '', 'analytics.domain');
  if (provider === 'plausible' && !domain)
    throw new Error('analytics.domain is required for plausible.');
  const basePath = str(build.basePath, defaults.build.basePath, 'build.basePath');
  if (!/^\/(?:[a-zA-Z0-9._~!$&'()*+,;=:@%-]+\/)*$/.test(basePath) || basePath.includes('..'))
    throw new Error('build.basePath must be an absolute URL path ending in /.');
  const url = str(build.url, '', 'build.url').trim().replace(/\/?$/, '/');
  if (url !== '/' && !/^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(url))
    throw new Error('build.url must be the https address of the published site.');
  const language = str(wiki.language, defaults.wiki.language, 'wiki.language');
  const languages = list(i18n.languages, 'i18n.languages', languageCode, 'language code');
  if (languages.includes(language))
    throw new Error('i18n.languages lists extra languages; do not repeat wiki.language.');
  const current = str(versions.current, '', 'versions.current');
  if (current && !versionId.test(current))
    throw new Error('versions.current is not a valid version id.');
  const archived = list(versions.archived, 'versions.archived', versionId, 'version id');
  if (current && archived.includes(current))
    throw new Error('versions.archived must not contain versions.current.');
  const rules: QualityRule[] = [];
  if (quality.rules !== undefined && !Array.isArray(quality.rules))
    throw new Error('quality.rules must be a list.');
  for (const [i, value] of ((quality.rules as unknown[]) || []).entries()) {
    const rule = object(value);
    const field = `quality.rules[${i}]`;
    const folder = str(rule.folder, '', `${field}.folder`).replace(/^\/+|\/+$/g, '');
    if (folder && safeRelative(folder, true) !== folder)
      throw new Error(`${field}.folder must be a folder inside the content root.`);
    const words = (v: unknown, name: string) => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim()))
        throw new Error(`${field}.${name} must be a list of names.`);
      return (v as string[]).map((x) => x.trim());
    };
    rules.push({
      folder,
      fields: words(rule.fields, 'fields'),
      sections: words(rule.sections, 'sections'),
    });
  }
  const staleDays = quality.staleDays ?? 0;
  if (typeof staleDays !== 'number' || !Number.isInteger(staleDays) || staleDays < 0)
    throw new Error('quality.staleDays must be a whole number of days (0 turns it off).');
  return {
    schemaVersion: 1,
    wiki: {
      title: str(wiki.title, defaults.wiki.title, 'wiki.title'),
      description: str(wiki.description, defaults.wiki.description, 'wiki.description'),
      language,
      ...(() => {
        const icon = str(wiki.icon, '', 'wiki.icon').trim();
        const color = str(wiki.color, '', 'wiki.color').trim();
        if (icon && !/^[a-z0-9-]{1,40}$/.test(icon))
          throw new Error('wiki.icon must be an icon name such as book, rocket or notebook.');
        if (color && !wikiColors.includes(color))
          throw new Error(`wiki.color must be one of ${wikiColors.join(', ')}.`);
        const announcement = str(wiki.announcement, '', 'wiki.announcement').trim();
        if (announcement.length > 400 || /\n/.test(announcement))
          throw new Error('wiki.announcement must be one line of at most 400 characters.');
        return {
          ...(icon ? { icon } : {}),
          ...(color ? { color } : {}),
          ...(announcement ? { announcement } : {}),
        };
      })(),
    },
    content: { root, homepage },
    navigation: { mode: 'automatic', sort: sort as WikiConfig['navigation']['sort'] },
    appearance: {
      theme: theme as WikiConfig['appearance']['theme'],
      accent,
      preset,
      font: font as FontId,
      width: width as WidthId,
    },
    features: {
      search: bool(features.search, true, 'features.search'),
      tableOfContents: bool(features.tableOfContents, true, 'features.tableOfContents'),
      breadcrumbs: bool(features.breadcrumbs, true, 'features.breadcrumbs'),
      plannerExport: bool(features.plannerExport, false, 'features.plannerExport'),
    },
    build: { output, basePath, ...(url !== '/' ? { url } : {}) },
    i18n: { languages },
    versions: { current, archived },
    analytics: { provider: provider as WikiConfig['analytics']['provider'], endpoint, domain },
    quality: { rules, staleDays },
  };
}
export function createConfig(config: WikiConfig): string {
  const defaults = defaultConfig();
  const { i18n, versions, analytics, quality, appearance, ...rest } = config;
  // New optional fields are written only when they differ from the defaults.
  const look: Record<string, unknown> = { theme: appearance.theme, accent: appearance.accent };
  for (const key of ['preset', 'font', 'width'] as const)
    if (appearance[key] !== defaults.appearance[key]) look[key] = appearance[key];
  return stringify(
    {
      ...rest,
      appearance: look,
      ...(JSON.stringify(i18n) === JSON.stringify(defaults.i18n) ? {} : { i18n }),
      ...(JSON.stringify(versions) === JSON.stringify(defaults.versions) ? {} : { versions }),
      ...(JSON.stringify(analytics) === JSON.stringify(defaults.analytics) ? {} : { analytics }),
      ...(JSON.stringify(quality) === JSON.stringify(defaults.quality) ? {} : { quality }),
    },
    { lineWidth: 0 },
  );
}
export function updateConfig(source: string, config: WikiConfig): string {
  parseConfig(source);
  const doc = parseDocument(source, { uniqueKeys: true });
  for (const [section, values] of Object.entries(config)) {
    if (section === 'schemaVersion') continue;
    // Optional sections are only written once they are used, so older files stay unchanged.
    if (
      ['i18n', 'versions', 'analytics', 'quality'].includes(section) &&
      !doc.has(section) &&
      JSON.stringify(values) === JSON.stringify(defaultConfig()[section as keyof WikiConfig])
    )
      continue;
    const defaults = defaultConfig()[section as keyof WikiConfig] as Record<string, unknown>;
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      // Keys added in later versions stay out of older files until they are changed.
      if (
        !doc.hasIn([section, key]) &&
        JSON.stringify(value) === JSON.stringify(defaults?.[key]) &&
        section === 'appearance'
      )
        continue;
      doc.setIn([section, key], value);
    }
  }
  return String(doc);
}

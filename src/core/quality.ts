import type { Heading, Page } from './model';
import type { WikiIndex } from './index';
import { isExternal, splitTarget } from './paths';
import type { QualityRule } from './config';

export interface QualityIssue {
  kind:
    | 'duplicate-heading'
    | 'duplicate-title'
    | 'metadata'
    | 'empty'
    | 'missing-alt'
    | 'heading-skip'
    | 'multiple-h1'
    | 'missing-field'
    | 'missing-section';
  message: string;
  /** Offset in the page text, when the issue has a location. */
  offset?: number;
  /** The field, section or level the issue is about (used by quick fixes). */
  detail?: string;
}

/** Rules from wiki.yaml that apply to a page path (relative to the content root). */
export function rulesFor(rules: QualityRule[], logicalPath: string): QualityRule[] {
  return rules.filter((r) => !r.folder || logicalPath.startsWith(r.folder + '/'));
}

const headingKey = (h: Heading) => h.text.trim().toLocaleLowerCase();

/**
 * Per-page quality checks that complement link diagnostics. Each one points at a concrete,
 * fixable problem: anchors that collide, titles that make `[[links]]` ambiguous, front matter
 * with the wrong type, and pages without content.
 */
export function pageQuality(
  page: Page,
  sameScope: Page[],
  rules: QualityRule[] = [],
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  let previous = 0;
  const h1 = page.headings.filter((h) => h.level === 1);
  for (const extra of h1.slice(1))
    issues.push({
      kind: 'multiple-h1',
      message: `More than one top-level heading: “${extra.text}”. A page should have one # title; use ## for sections.`,
      offset: extra.offset,
      detail: '2',
    });
  for (const heading of page.headings) {
    if (previous && heading.level > previous + 1)
      issues.push({
        kind: 'heading-skip',
        message: `Heading level jumps from ${previous} to ${heading.level} at “${heading.text}”; screen readers and the outline expect level ${previous + 1}.`,
        offset: heading.offset,
        detail: String(previous + 1),
      });
    previous = heading.level;
  }
  for (const link of page.links)
    if (link.kind === 'image' && !link.label.trim())
      issues.push({
        kind: 'missing-alt',
        message: `Image “${link.target}” has no alternative text; describe it between the brackets.`,
        offset: link.start,
        detail: link.target,
      });
  const headingNames = new Set(page.headings.map(headingKey));
  for (const rule of rules) {
    for (const field of rule.fields)
      if (!page.properties?.[field]?.trim())
        issues.push({
          kind: 'missing-field',
          message: `Required front matter field “${field}” is ${page.properties && field in page.properties ? 'empty' : 'missing'}${rule.folder ? ` (rule for ${rule.folder}/)` : ''}.`,
          offset: 0,
          detail: field,
        });
    for (const section of rule.sections)
      if (!headingNames.has(section.trim().toLocaleLowerCase()))
        issues.push({
          kind: 'missing-section',
          message: `Required section “${section}” is missing${rule.folder ? ` (rule for ${rule.folder}/)` : ''}.`,
          detail: section,
        });
  }
  const seen = new Map<string, Heading>();
  for (const heading of page.headings) {
    const key = `${heading.level}:${headingKey(heading)}`;
    const first = seen.get(key);
    if (first)
      issues.push({
        kind: 'duplicate-heading',
        message: `Duplicate heading “${heading.text}”: links to #${first.slug} always reach the first one; this one is #${heading.slug}.`,
        offset: heading.offset,
      });
    else seen.set(key, heading);
  }
  const title = page.title.trim().toLocaleLowerCase();
  const twins = sameScope.filter(
    (p) => p.id !== page.id && p.title.trim().toLocaleLowerCase() === title,
  );
  if (twins.length)
    issues.push({
      kind: 'duplicate-title',
      message: `Another page has the title “${page.title}” (${twins.map((p) => p.path).join(', ')}); [[${page.title}]] links are ambiguous.`,
    });
  for (const warning of page.metadataWarnings || [])
    issues.push({ kind: 'metadata', message: `Front matter: ${warning}.` });
  if (!page.body.replace(/^#[^\n]*$/m, '').trim())
    issues.push({ kind: 'empty', message: 'This page has no content yet.' });
  return issues;
}

export interface ContentHealth {
  pages: number;
  drafts: Page[];
  broken: Array<{ page: Page; target: string; offset: number }>;
  orphans: Page[];
  duplicateHeadings: Array<{ page: Page; count: number }>;
  duplicateTitles: Page[][];
  metadata: Array<{ page: Page; warnings: string[] }>;
  empty: Page[];
  /** Missing alternative text, skipped heading levels, several top-level headings. */
  structure: Array<{ page: Page; issues: QualityIssue[] }>;
  /** Fields and sections required by `quality.rules` in wiki.yaml. */
  rules: Array<{ page: Page; issues: QualityIssue[] }>;
  /** `content.homepage` does not exist. */
  homepageMissing: boolean;
  /** Pages with no broken link and no content issue. */
  clean: number;
  /** Share of clean pages, 0–100 (100 for an empty wiki). */
  score: number;
}

const structural = new Set(['missing-alt', 'heading-skip', 'multiple-h1']);

/** Wiki-wide health over the pages of the current version (archived versions excluded). */
export function contentHealth(
  index: WikiIndex,
  pages: Page[],
  homepage?: string,
  scope: (page: Page) => string = () => '',
  rules: (page: Page) => QualityRule[] = () => [],
): ContentHealth {
  const health: ContentHealth = {
    pages: pages.length,
    drafts: pages.filter((p) => p.draft),
    broken: [],
    orphans: [],
    duplicateHeadings: [],
    duplicateTitles: [],
    metadata: [],
    empty: [],
    structure: [],
    rules: [],
    homepageMissing: !!homepage && !pages.some((p) => p.path === homepage),
    clean: 0,
    score: 100,
  };
  const flagged = new Set<string>();
  const ids = new Set(pages.map((p) => p.id));
  const linked = new Set<string>();
  for (const page of pages) {
    for (const link of page.links) {
      if (link.kind === 'image' || isExternal(link.target)) continue;
      if (link.kind === 'markdown') {
        const path = splitTarget(link.target).path;
        if (/\.[a-z\d]+$/i.test(path) && !/\.md$/i.test(path)) continue;
      }
      const result = index.resolve(page, link.target, link.kind);
      if (result.error) {
        health.broken.push({ page, target: link.target, offset: link.start });
        flagged.add(page.id);
      }
      if (result.page && result.page.id !== page.id) linked.add(result.page.id);
    }
    const issues = pageQuality(page, [], rules(page));
    if (issues.length) flagged.add(page.id);
    const shape = issues.filter((i) => structural.has(i.kind));
    if (shape.length) health.structure.push({ page, issues: shape });
    const required = issues.filter(
      (i) => i.kind === 'missing-field' || i.kind === 'missing-section',
    );
    if (required.length) health.rules.push({ page, issues: required });
    const duplicates = issues.filter((i) => i.kind === 'duplicate-heading').length;
    if (duplicates) health.duplicateHeadings.push({ page, count: duplicates });
    if (page.metadataWarnings?.length)
      health.metadata.push({ page, warnings: page.metadataWarnings });
    if (issues.some((i) => i.kind === 'empty')) health.empty.push(page);
  }
  health.orphans = pages.filter((p) => !linked.has(p.id) && p.path !== homepage && ids.has(p.id));
  const byTitle = new Map<string, Page[]>();
  for (const page of pages) {
    const key = `${page.root}\0${scope(page)}\0${page.title.trim().toLocaleLowerCase()}`;
    byTitle.set(key, [...(byTitle.get(key) || []), page]);
  }
  health.duplicateTitles = [...byTitle.values()].filter((group) => group.length > 1);
  for (const group of health.duplicateTitles) for (const page of group) flagged.add(page.id);
  health.clean = pages.filter((p) => !flagged.has(p.id)).length;
  health.score = pages.length ? Math.round((health.clean / pages.length) * 100) : 100;
  return health;
}

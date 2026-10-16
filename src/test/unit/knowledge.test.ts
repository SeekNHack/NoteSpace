import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from '../../core/markdown';
import { WikiIndex } from '../../core/index';
import { createConfig, defaultConfig, parseConfig, updateConfig } from '../../core/config';
import { contentHash, scopeOf, scopedPath, translationCoverage, variants } from '../../core/scopes';
import { contentHealth, pageQuality, rulesFor } from '../../core/quality';
import { apiCoverage } from '../../core/coverage';
import { parseOpenApi } from '../../core/openapi';
import { sections, tokenize } from '../../core/search';

const page = (file: string, text: string, root = 'root') =>
  parsePage(root, file, `file:///wiki/${file}`, text);
const config = (extra: string) =>
  parseConfig(`schemaVersion: 1\nwiki:\n  title: Docs\n  language: en\n${extra}`);

test('wiki.yaml accepts languages and archived versions and validates them', () => {
  const c = config(
    'i18n:\n  languages: [it, pt-BR]\nversions:\n  current: "2.0"\n  archived: ["1.0", "1.1"]\n',
  );
  assert.deepEqual(c.i18n.languages, ['it', 'pt-BR']);
  assert.deepEqual(c.versions, { current: '2.0', archived: ['1.0', '1.1'] });
  assert.throws(() => config('i18n:\n  languages: [en]\n'), /do not repeat wiki.language/);
  assert.throws(() => config('i18n:\n  languages: ["../x"]\n'), /not a valid language code/);
  assert.throws(() => config('versions:\n  archived: ["../1"]\n'), /not a valid version id/);
  assert.throws(() => config('versions:\n  current: "1"\n  archived: ["1"]\n'), /must not contain/);
  // Older files are not rewritten with the new optional sections.
  const old = 'schemaVersion: 1\nwiki:\n  title: Docs # keep\n';
  const updated = updateConfig(old, parseConfig(old));
  assert.doesNotMatch(updated, /i18n|versions/);
  assert.match(updated, /# keep/);
  assert.doesNotMatch(createConfig(defaultConfig()), /i18n|versions/);
  const withLanguage = { ...parseConfig(old), i18n: { languages: ['it'] } };
  assert.match(updateConfig(old, withLanguage), /i18n:\n {2}languages:\n {4}- it/);
});

test('scopes split versions and languages and build counterpart paths', () => {
  const c = config('i18n:\n  languages: [it]\nversions:\n  archived: ["1.0"]\n');
  assert.deepEqual(scopeOf('guide/setup.md', c), {
    version: undefined,
    language: undefined,
    logical: 'guide/setup.md',
  });
  assert.deepEqual(scopeOf('it/guide/setup.md', c), {
    version: undefined,
    language: 'it',
    logical: 'guide/setup.md',
  });
  assert.deepEqual(scopeOf('_versions/1.0/it/a.md', c), {
    version: '1.0',
    language: 'it',
    logical: 'a.md',
  });
  // Unknown prefixes are ordinary folders.
  assert.deepEqual(scopeOf('_versions/9.9/a.md', c).version, undefined);
  assert.deepEqual(scopeOf('de/a.md', c).language, undefined);
  assert.equal(
    scopeOf('it.md', c).language,
    undefined,
    'a page named like a language is not a scope',
  );
  assert.equal(scopedPath('a.md', '1.0', 'it'), '_versions/1.0/it/a.md');
  assert.equal(scopedPath('', undefined, 'it'), 'it');
});

test('name links prefer the linking page’s language and version', () => {
  const c = config('i18n:\n  languages: [it]\nversions:\n  archived: ["1.0"]\n');
  const en = page('guide/Setup.md', '# Setup\n[[Install]]'),
    install = page('guide/Install.md', '# Install'),
    it = page('it/guide/Setup.md', '# Setup\n[[Install]] [[guide/Install]]'),
    itInstall = page('it/guide/Install.md', '# Install'),
    old = page('_versions/1.0/guide/Install.md', '# Install'),
    oldSetup = page('_versions/1.0/guide/Setup.md', '# Setup\n[[Install]]');
  const home = page('index.md', '# Home\n[[Install]]');
  const index = new WikiIndex();
  index.replace([en, install, it, itInstall, old, oldSetup, home]);
  index.scope = (p) => {
    const s = scopeOf(p.path, c);
    return scopedPath('', s.version, s.language);
  };
  assert.equal(index.resolve(en, 'Install').page?.path, 'guide/Install.md');
  assert.equal(index.resolve(it, 'Install').page?.path, 'it/guide/Install.md');
  assert.equal(index.resolve(it, 'guide/Install').page?.path, 'it/guide/Install.md');
  assert.equal(index.resolve(oldSetup, 'Install').page?.path, '_versions/1.0/guide/Install.md');
  assert.equal(index.resolve(home, 'Install').page?.path, 'guide/Install.md');
  // Without scopes the same name is ambiguous, as before.
  index.scope = undefined;
  assert.equal(index.resolve(home, 'Install').error, 'ambiguous');
});

test('translation coverage reports missing, outdated and unmarked translations', () => {
  const c = config('i18n:\n  languages: [it, de]\n');
  const a = page('a.md', '# A\n\nHello'),
    b = page('b.md', '# B\n\nWorld'),
    draft = page('c.md', '---\ndraft: true\n---\n# C');
  const itA = page('it/a.md', `---\ntranslated_from: ${contentHash(a.body)}\n---\n# A\n\nCiao`);
  const itB = page(
    'it/b.md',
    `---\ntranslated_from: ${contentHash('# B\n\nOld')}\n---\n# B\n\nMondo`,
  );
  const deA = page('de/a.md', '# A\n\nHallo');
  const coverage = translationCoverage([a, b, draft, itA, itB, deA], c);
  assert.equal(coverage.sources, 2, 'drafts are not counted');
  const [it, de] = coverage.languages;
  assert.equal(it.translated, 2);
  assert.deepEqual(it.missing, []);
  assert.deepEqual(
    it.outdated.map((o) => o.translation.path),
    ['it/b.md'],
  );
  assert.equal(de.translated, 1);
  assert.deepEqual(
    de.missing.map((p) => p.path),
    ['b.md'],
  );
  assert.deepEqual(
    de.unknown.map((p) => p.path),
    ['de/a.md'],
  );
  assert.equal(contentHash('x\r\ny\n'), contentHash('x\ny'), 'line endings do not change the hash');
  const v = variants(itA, [a, itA, deA], c);
  assert.deepEqual(
    v.languages.map((l) => [l.language, l.page?.path, l.current]),
    [
      ['en', 'a.md', false],
      ['it', 'it/a.md', true],
      ['de', 'de/a.md', false],
    ],
  );
});

test('quality checks find colliding headings, ambiguous titles, wrong metadata and empty pages', () => {
  const a = page('a.md', '---\ntags: 3\ndraft: "no"\n---\n# Guide\n## Setup\ntext\n## Setup\nmore');
  const b = page('b.md', '# Guide\n');
  const issues = pageQuality(a, [a, b]);
  assert.deepEqual(issues.map((i) => i.kind).sort(), [
    'duplicate-heading',
    'duplicate-title',
    'metadata',
    'metadata',
  ]);
  assert.match(issues.find((i) => i.kind === 'duplicate-heading')!.message, /#setup.*#setup-1/);
  assert.equal(
    issues.find((i) => i.kind === 'duplicate-heading')!.offset,
    a.text.lastIndexOf('## Setup'),
  );
  assert.deepEqual(
    pageQuality(b, [b]).map((i) => i.kind),
    ['empty'],
  );
  const index = new WikiIndex();
  const home = page('index.md', '# Home\n[[a]] [[missing]]');
  index.replace([a, b, home]);
  const health = contentHealth(index, [a, b, home], 'index.md');
  assert.deepEqual(
    health.broken.map((x) => x.target),
    ['missing'],
  );
  assert.deepEqual(
    health.orphans.map((p) => p.path),
    ['b.md'],
    'the homepage is not an orphan',
  );
  assert.equal(health.duplicateTitles.length, 1);
  assert.equal(health.metadata[0].warnings.length, 2);
});

test('quality engine checks alt text, heading outline and wiki.yaml rules, with a transparent score', () => {
  const c = config(
    'quality:\n  staleDays: 90\n  rules:\n    - folder: guides\n      fields: [owner, description]\n      sections: [Overview, Troubleshooting]\n    - fields: [title]\n',
  );
  assert.equal(c.quality.staleDays, 90);
  assert.deepEqual(c.quality.rules[0], {
    folder: 'guides',
    fields: ['owner', 'description'],
    sections: ['Overview', 'Troubleshooting'],
  });
  assert.throws(() => config('quality:\n  rules:\n    - folder: ../x\n'), /unsafe|relative/);
  assert.throws(() => config('quality:\n  staleDays: -1\n'), /whole number/);
  assert.throws(() => config('quality:\n  rules:\n    - fields: [1]\n'), /list of names/);
  assert.match(createConfig(c), /quality:/);
  assert.doesNotMatch(createConfig(defaultConfig()), /quality/);
  assert.equal(rulesFor(c.quality.rules, 'guides/a.md').length, 2);
  assert.equal(
    rulesFor(c.quality.rules, 'guidesx/a.md').length,
    1,
    'folder prefix is a whole folder',
  );

  const guide = page(
    'guides/a.md',
    '---\ntitle: Setup\nowner: ""\ndescription: How to set up\n---\n# Setup\n![](img/arch-diagram.png)\n![Logo](logo.png)\n### Too deep\n## overview\n# Second title\n',
  );
  const issues = pageQuality(guide, [], rulesFor(c.quality.rules, 'guides/a.md'));
  const kinds = issues.map((i) => i.kind).sort();
  assert.deepEqual(kinds, [
    'heading-skip',
    'missing-alt',
    'missing-field',
    'missing-section',
    'multiple-h1',
  ]);
  assert.equal(issues.find((i) => i.kind === 'missing-alt')!.detail, 'img/arch-diagram.png');
  assert.equal(issues.find((i) => i.kind === 'heading-skip')!.detail, '2');
  assert.equal(
    issues.find((i) => i.kind === 'missing-field')!.detail,
    'owner',
    'empty values count as missing',
  );
  assert.match(issues.find((i) => i.kind === 'missing-field')!.message, /“owner” is empty/);
  assert.equal(
    issues.find((i) => i.kind === 'missing-section')!.detail,
    'Troubleshooting',
    'section names ignore case',
  );
  assert.equal(guide.properties?.description, 'How to set up');

  const clean = page('b.md', '---\ntitle: B\n---\n# B\n\nText with [[guides/a]].\n');
  const index = new WikiIndex();
  index.replace([guide, clean]);
  const health = contentHealth(
    index,
    [guide, clean],
    'index.md',
    () => '',
    (p) => rulesFor(c.quality.rules, p.path),
  );
  assert.equal(health.homepageMissing, true);
  assert.equal(health.structure.length, 1);
  assert.equal(health.rules.length, 1);
  assert.deepEqual([health.clean, health.score], [1, 50]);
  assert.equal(contentHealth(new WikiIndex(), []).score, 100);
});

test('API coverage comes from embeds, operationIds and METHOD /path mentions', () => {
  const spec = parseOpenApi(
    'openapi: 3.0.0\ninfo: {title: Pets, version: "1"}\npaths:\n  /pets:\n    get: {operationId: listPets, responses: {"200": {description: ok}}}\n    post: {operationId: createPet, responses: {"201": {description: ok}}}\n  /pets/{id}:\n    delete: {operationId: deletePet, responses: {"204": {description: ok}}}\n',
  );
  const mention = page('guide/pets.md', '# Pets\nCall `listPets` first, then `DELETE /pets/{id}`.');
  const unrelated = page('other.md', '# Other\nlistPetsAll and POST /petsitter');
  const [coverage] = apiCoverage([{ file: 'api/pets.yaml', spec }], [mention, unrelated]);
  assert.deepEqual(
    coverage.operations.map((o) => [o.id, o.documentedBy.map((p) => p.path)]),
    [
      ['listPets', ['guide/pets.md']],
      ['createPet', []],
      ['deletePet', ['guide/pets.md']],
    ],
  );
  const embed = page('api.md', '# API\n```openapi\npath: api/pets.yaml\n```\n');
  assert.equal(apiCoverage([{ file: 'api/pets.yaml', spec }], [embed])[0].documented, 3);
});

test('search ranks sections, matches partial and accented words and updates incrementally', () => {
  const a = page(
    'guide/install.md',
    '# Installation\n\nIntro.\n\n## Docker\n\nRun the container with compose.\n\n## Café setup\n\nConfigure the espresso machine.',
  );
  const b = page('notes.md', '# Notes\n\nDocker is mentioned once.');
  const index = new WikiIndex();
  index.replace([a, b]);
  const docker = index.search('container docker');
  assert.deepEqual(
    docker.map((r) => r.page.path),
    ['guide/install.md'],
  );
  assert.equal(docker[0].heading?.text, 'Docker');
  assert.equal(docker[0].excerpt, 'Run the container with compose.');
  assert.equal(index.search('cafe')[0].heading?.text, 'Café setup', 'accents are folded');
  assert.equal(index.search('contain')[0].page.path, 'guide/install.md', 'prefixes match');
  assert.equal(index.search('install').length, 1, 'path and title count as text');
  assert.equal(index.search('docker missingword').length, 0, 'all words are required');
  index.upsert(page('notes.md', '# Notes\n\nNothing here now.'));
  assert.deepEqual(index.search('mentioned'), []);
  index.remove('file:///wiki/guide/install.md');
  assert.deepEqual(index.search('docker'), []);
  assert.deepEqual(tokenize('Ünïcode-Wörds_ok 42'), ['unicode', 'words_ok', '42']);
  assert.deepEqual(
    sections(a).map((s) => s.heading?.text),
    ['Installation', 'Docker', 'Café setup'],
  );
});

test('search over 1,000 pages answers quickly and re-indexes one page in milliseconds', () => {
  const words = [
    'alpha',
    'beta',
    'gamma',
    'delta',
    'kernel',
    'notebook',
    'planner',
    'export',
    'search',
    'graph',
  ];
  const pages = Array.from({ length: 1000 }, (_, i) =>
    page(
      `p/${i}.md`,
      `# Page ${i}\n\n${Array.from({ length: 60 }, (_, k) => words[(i * 7 + k) % words.length]).join(' ')}\n\n## Section ${i}\n\nunique${i} token here.`,
    ),
  );
  const index = new WikiIndex();
  let start = performance.now();
  index.replace(pages);
  const build = performance.now() - start;
  start = performance.now();
  const results = index.search('kernel unique997');
  const query = performance.now() - start;
  assert.equal(results[0].page.path, 'p/997.md');
  start = performance.now();
  index.upsert(page('p/5.md', '# Page 5\n\nchanged text'));
  const update = performance.now() - start;
  assert.equal(index.search('changed')[0].page.path, 'p/5.md');
  console.log(
    `search: build ${build.toFixed(0)} ms, query ${query.toFixed(1)} ms, update ${update.toFixed(1)} ms`,
  );
  assert.ok(build < 3000 && query < 200 && update < 50, `${build} / ${query} / ${update}`);
});

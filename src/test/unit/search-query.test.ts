import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { parsePage } from '../../core/markdown';
import { WikiIndex } from '../../core/index';
import { highlightRanges, parseQuery } from '../../core/query';

const page = (file: string, text: string) => parsePage('root', file, `file:///wiki/${file}`, text);

const fixture = () => {
  const index = new WikiIndex();
  index.replace([
    page(
      'guides/install.md',
      '---\ntitle: Install guide\ntags: [setup, ops]\nowner: Alice\nstatus: review\n---\n# Install guide\n\nInstall the agent with pip.\n\n## Getting started\n\nRun `agent init`.\n\n```python\nimport agent\n```\n\nSee [[Configuration]].\n',
    ),
    page(
      'guides/configuration.md',
      '---\ntags: [setup]\nowner: Bob\nstatus: done\n---\n# Configuration\n\nConfigure the agent in agent.yaml.\n\n```yaml\nport: 8080\n```\n\n```mermaid\ngraph TD\nA-->B\n```\n',
    ),
    page(
      'reference/api.md',
      '---\ndraft: true\n---\n# API\n\nThe agent API.\n\n```openapi\npath: api.yaml\n```\n\n- [ ] Document errors\n\n[External](https://example.com/agent-docs)\n',
    ),
    page(
      'notes/café.md',
      '# Café notes\n\nThe espresso machine is not an agent.\n\n![](cup.png)\n',
    ),
  ]);
  return index;
};
const paths = (index: WikiIndex, q: string) => index.search(q).map((r) => r.page.path);

test('query parser separates words, phrases, exclusions and filters', () => {
  const q = parseQuery(
    'agent "getting started" -espresso tag:Setup #ops path:guides/ heading:"Getting started" prop:owner=alice prop:status!=done prop:owner link:config code:py type:draft sort:title foo:bar type:nope',
  );
  assert.deepEqual(q.terms, ['agent']);
  assert.deepEqual(q.phrases, ['getting started']);
  assert.deepEqual(q.exclude, ['espresso']);
  assert.deepEqual(q.tags, ['setup', 'ops']);
  assert.deepEqual(q.paths, ['guides/']);
  assert.deepEqual(q.headings, ['getting started']);
  assert.deepEqual(q.props, [
    { key: 'owner', value: 'alice', negate: false },
    { key: 'status', value: 'done', negate: true },
    { key: 'owner', negate: false },
  ]);
  assert.deepEqual(
    [q.links, q.code, q.types, q.sort],
    [['config'], ['py'], ['draft', 'nope'], 'title'],
  );
  assert.deepEqual(q.unknown, ['foo:', 'type:nope']);
  assert.deepEqual(
    parseQuery('https://example.com').terms,
    ['https://example.com'],
    'URLs stay words',
  );
});

test('filters narrow results and combine with ranked words', () => {
  const index = fixture();
  assert.deepEqual(paths(index, 'agent tag:setup sort:path'), [
    'guides/configuration.md',
    'guides/install.md',
  ]);
  assert.deepEqual(paths(index, 'agent #ops'), ['guides/install.md']);
  assert.deepEqual(paths(index, 'path:reference'), ['reference/api.md']);
  assert.deepEqual(paths(index, 'prop:owner=ali'), ['guides/install.md']);
  assert.deepEqual(paths(index, 'prop:status!=done tag:setup'), ['guides/install.md']);
  assert.deepEqual(paths(index, 'prop:owner sort:path'), [
    'guides/configuration.md',
    'guides/install.md',
  ]);
  assert.deepEqual(paths(index, 'link:configuration'), ['guides/install.md'], 'link by page title');
  assert.deepEqual(paths(index, 'link:example.com'), ['reference/api.md'], 'link by URL');
  assert.deepEqual(paths(index, 'code:python'), ['guides/install.md']);
  assert.deepEqual(paths(index, 'code:yml'), ['guides/configuration.md'], 'code aliases');
  assert.deepEqual(paths(index, 'type:mermaid'), ['guides/configuration.md']);
  assert.deepEqual(paths(index, 'type:openapi type:tasks type:draft'), ['reference/api.md']);
  assert.deepEqual(paths(index, 'type:image'), ['notes/café.md']);
  assert.deepEqual(paths(index, 'agent -espresso -api sort:path'), [
    'guides/configuration.md',
    'guides/install.md',
  ]);
  assert.deepEqual(paths(index, '"agent init"'), ['guides/install.md']);
  assert.deepEqual(paths(index, '"init agent"'), []);
  const heading = index.search('heading:"getting started"');
  assert.equal(heading[0].heading?.text, 'Getting started', 'results open at the matching heading');
  assert.match(heading[0].excerpt, /agent init/);
  assert.deepEqual(paths(index, 'sort:title').slice(0, 2), ['reference/api.md', 'notes/café.md']);
});

test('version: searches one archived version or the live docs', () => {
  const index = new WikiIndex();
  index.replace([
    page('guide.md', '# Guide\n\nInstall with the new installer.'),
    page('_versions/1.0/guide.md', '# Guide\n\nInstall with the old script.'),
    page('_versions/2.0/guide.md', '# Guide\n\nInstall with the installer.'),
  ]);
  assert.deepEqual(paths(index, 'install version:1.0'), ['_versions/1.0/guide.md']);
  assert.deepEqual(paths(index, 'install version:latest'), ['guide.md']);
  assert.deepEqual(paths(index, 'installer version:2.0 version:current sort:path'), [
    '_versions/2.0/guide.md',
    'guide.md',
  ]);
  assert.deepEqual(parseQuery('version:1.0').unknown, []);
});

test('excerpts carry highlight ranges, including accent-insensitive matches', () => {
  const index = fixture();
  const titleOnly = new WikiIndex();
  titleOnly.replace([page('w.md', '# Widget\n\n## Notes\n\nNothing else here.\n')]);
  assert.equal(
    titleOnly.search('widget')[0].excerpt,
    'Nothing else here.',
    'a title-only section falls back to the page text',
  );
  const [hit] = index.search('espresso');
  assert.equal(hit.excerpt.slice(...hit.matches[0]), 'espresso');
  const ranges = highlightRanges('Café and cafe', ['cafe']);
  assert.deepEqual(ranges, [
    [0, 4],
    [9, 13],
  ]);
  assert.deepEqual(highlightRanges('abcabc', ['abc', 'bca']), [[0, 6]], 'overlaps merge');
});

test('search stays fast at 1,000 and 10,000 pages', () => {
  const report: unknown[] = [];
  for (const size of [1000, 10000]) {
    const index = new WikiIndex();
    const pages = Array.from({ length: size }, (_, i) =>
      page(
        `section-${i % 20}/page-${i}.md`,
        `---\ntags: [t${i % 7}]\nowner: user${i % 13}\n---\n# Page ${i}\n\nSearchable documentation content number ${i} about topic ${i % 50}.\n\n## Details\n\n${i % 3 ? '```python\nprint(1)\n```' : 'Plain text.'}\n\nSee [[page-${(i + 1) % size}]].\n`,
      ),
    );
    const buildStart = performance.now();
    index.replace(pages);
    const buildMs = performance.now() - buildStart;
    const timings: Record<string, number> = {};
    for (const q of [
      'documentation topic 42',
      'tag:t3 code:python',
      'prop:owner=user7 path:section-4/ searchable',
      '"content number 999"',
      'link:page-500',
    ]) {
      const start = performance.now();
      const results = index.search(q);
      timings[q] = Math.round((performance.now() - start) * 10) / 10;
      assert.ok(results.length > 0, `${q} finds pages`);
    }
    const worst = Math.max(...Object.values(timings));
    report.push({ pages: size, indexMs: Math.round(buildMs), queriesMs: timings });
    assert.ok(worst < (size === 1000 ? 250 : 2500), `${size} pages: slowest query ${worst} ms`);
  }
  // WIKI_SEARCH_BENCHMARK=<file> records the timings (docs/benchmark-search.json).
  if (process.env.WIKI_SEARCH_BENCHMARK)
    writeFileSync(
      process.env.WIKI_SEARCH_BENCHMARK,
      JSON.stringify(
        {
          note: 'WikiIndex.search over synthetic pages, parsing excluded; one run of src/test/unit/search-query.test.ts.',
          node: process.version,
          runs: report,
        },
        null,
        2,
      ) + '\n',
    );
});

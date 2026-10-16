import { performance } from 'node:perf_hooks';
import { parsePage } from '../src/core/markdown.ts';
import { WikiIndex } from '../src/core/index.ts';

const root = 'bench';
const measure = (fn) => {
  const start = performance.now();
  fn();
  return Math.round((performance.now() - start) * 100) / 100;
};
let pages;
const parseMs = measure(() => {
  pages = Array.from({ length: 1000 }, (_, i) =>
    parsePage(
      root,
      `section/page-${i}.md`,
      `file:///benchmark/section/page-${i}.md`,
      `# Benchmark page ${i}\n\nSearchable documentation content for page ${i}.\n\n${'Shared paragraph with headings, links and searchable text.\n'.repeat(20)}\n[Home](page-0.md)\n`,
    ),
  );
});
const index = new WikiIndex();
const initialIndexMs = measure(() => index.replace(pages));
const searchMs = measure(() => {
  const results = index.search('Searchable documentation 997');
  if (results.length !== 1 || results[0].page.path !== 'section/page-997.md')
    throw new Error('Search benchmark returned unexpected results.');
});
const broadSearchMs = measure(() => {
  if (index.search('Searchable').length !== 1000)
    throw new Error('Broad search benchmark returned unexpected results.');
});
const changeMs = measure(() => {
  index.upsert(
    parsePage(root, 'section/page-997.md', pages[997].uri, '# Updated\n\nUnique needle.'),
  );
  if (index.search('Unique needle').length !== 1) throw new Error('Incremental update failed.');
});
const deleteMs = measure(() => {
  index.remove(pages[997].uri);
  if (index.search('Unique needle').length) throw new Error('Incremental deletion failed.');
});
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      environment: `Node ${process.version}`,
      pages: 1000,
      inputBytes: pages.reduce((sum, page) => sum + Buffer.byteLength(page.text), 0),
      parseMs,
      initialIndexMs,
      searchMs,
      broadSearchMs,
      changeMs,
      deleteMs,
    },
    null,
    2,
  ),
);

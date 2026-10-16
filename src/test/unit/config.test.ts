import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createConfig, defaultConfig, parseConfig, updateConfig } from '../../core/config';
import { visualSafety } from '../../core/visual-safety';
import { planMkDocsImport, unsupportedMkDocsSyntax } from '../../core/import-project';

test('MkDocs import maps supported settings and reports unsupported constructs', () => {
  const source =
    'site_name: Product Docs\nsite_description: Example\ndocs_dir: manual\n' +
    'theme:\n  name: material\n  language: it\nplugins: [search]\n';
  const plan = planMkDocsImport(source);
  assert.equal(plan.config.wiki.title, 'Product Docs');
  assert.equal(plan.config.content.root, 'manual');
  assert.equal(plan.config.wiki.language, 'it');
  assert.ok(plan.warnings.some((warning) => warning.includes('plugins')));
  assert.deepEqual(
    unsupportedMkDocsSyntax('guide.md', '!!! note\n\n--8<-- "shared.md"\n\n{: .special }'),
    [
      'guide.md: MkDocs admonition syntax requires source editing or migration to ::: blocks.',
      'guide.md: template or snippet directive was not migrated.',
      'guide.md: attribute-list syntax was not migrated.',
    ],
  );
  assert.throws(() => planMkDocsImport('docs_dir: ../outside'), /relative|unsafe/);
  assert.throws(() => planMkDocsImport('site_name: [broken'), /Invalid mkdocs/);
});

test('versioned wiki config defaults, validation and unknown keys survive settings updates', () => {
  const source = createConfig(defaultConfig('Manual')) + 'custom:\n  keep: true\n';
  assert.equal(parseConfig(source).wiki.title, 'Manual');
  const changed = defaultConfig('Updated');
  const output = updateConfig(source, changed);
  assert.match(output, /custom:\n  keep: true/);
  assert.equal(parseConfig(output).wiki.title, 'Updated');
  assert.throws(
    () => parseConfig(source.replace('schemaVersion: 1', 'schemaVersion: 2')),
    /schemaVersion/,
  );
  assert.throws(
    () => parseConfig(source.replace('root: docs', 'root: ../secrets')),
    /unsafe|relative path/,
  );
  assert.throws(
    () => parseConfig(source.replace('output: dist', 'output: docs')),
    /separate directories/,
  );
});

test('visual safety keeps only constructs Studio cannot preserve in source mode', () => {
  assert.equal(visualSafety('---\ntitle: Sample\n---\n# Heading\n\n**bold**'), undefined);
  for (const source of [
    '**[[Other]]**',
    '| A |\n| --- |\n| [[Other|label]] |',
    'A **bold $x$ formula**.',
    'Press *++Ctrl++* now.',
    '__<kbd>x</kbd>__',
    'See [Guide].\n\n[guide]: Guide.md',
  ])
    assert.ok(visualSafety(source), source);
  for (const source of [
    ':::warning\ncareful\n:::',
    'Link in progress: [[Gui',
    'Read [[Other]] and [[/a/b#x|a label]].',
    '<!-- hidden -->',
    ':::unknown\ncareful\n:::',
    '<script>alert(1)</script>',
    'See [Guide][ref].\n\n[ref]: Guide.md',
  ])
    assert.equal(visualSafety(source), undefined, source);
});

test('visual safety rejects unbalanced or too deeply nested containers', () => {
  for (const source of [':::note\nText', ':::\nText']) assert.ok(visualSafety(source), source);
  for (const source of [
    ':::notebook\nText\n:::',
    ':::note extra\nText\n:::',
    ':::note\r\nText\r\n:::\r\n',
    ':::note\n:::tip\nText\n:::\n:::',
  ])
    assert.equal(visualSafety(source), undefined, source);
  assert.ok(
    visualSafety(':::tabs\n:::tab\n:::note\n:::tip\n:::tip\nDeep\n:::\n:::\n:::\n:::\n:::'),
  );
});

test('visual safety allows wiki syntax examples in Markdown code', () => {
  assert.equal(visualSafety('Use `[[Page name]]` to link pages.'), undefined);
  assert.equal(visualSafety('```md\n[[Page name]]\n```'), undefined);
  assert.equal(visualSafety('Read [[Page name]] next.'), undefined);
  assert.ok(visualSafety('Read *[[Page name]]* next.'));
});

test('visual safety ignores unsupported syntax inside fenced and indented code', () => {
  const example = ':::unknown\n[ref]: Guide.md\n<script>alert(1)</script>\n$$';
  assert.equal(visualSafety(`\`\`\`md\n${example}\n\`\`\``), undefined);
  assert.equal(visualSafety(`    ${example.replaceAll('\n', '\n    ')}`), undefined);
  assert.equal(visualSafety(`\`\`\`md\n${example}\n\`\`\`\n\n[ref]: Guide.md`), undefined);
});

test('visual safety ignores inline code but not escaped backtick delimiters', () => {
  assert.equal(visualSafety('Use `<script>alert(1)</script>` and `$$`.'), undefined);
  assert.equal(visualSafety('Use `<!-- comment -->` in a guide.'), undefined);
  assert.equal(visualSafety('\\`<script>bad</script>\\`'), undefined);
});

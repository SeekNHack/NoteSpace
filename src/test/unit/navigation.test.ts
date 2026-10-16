import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitignoreMatcher, parseGitignore } from '../../core/gitignore';
import { humanize, isFolderIndex } from '../../core/titles';
import { parsePage } from '../../core/markdown';

test('gitignore: anchors, directories, wildcards, negation and nested files', () => {
  const m = new GitignoreMatcher({
    '': '# comment\n*.tmp.md\n/build/\nprivate/\ndrafts/**\n!drafts/keep.md\nnotes/*.md\n!notes/public.md\n\\#hash.md\nspace\\ \n',
    'docs/team': 'secret.md\n!*.public.md\n',
    'docs/team/sub': '!secret.md\n',
  });
  assert.equal(m.ignores('a.tmp.md'), true, 'unanchored pattern at the top');
  assert.equal(m.ignores('deep/x/a.tmp.md'), true, 'unanchored pattern at any depth');
  assert.equal(m.ignores('build/index.md'), true);
  assert.equal(
    m.ignores('docs/build/index.md'),
    false,
    'leading / anchors to the .gitignore folder',
  );
  assert.equal(m.ignores('x/private/a.md'), true, 'directory pattern at any depth');
  assert.equal(m.ignores('private.md'), false, 'trailing / matches directories only');
  assert.equal(m.ignores('drafts/a.md'), true);
  assert.equal(
    m.ignores('drafts/keep.md'),
    false,
    'negation re-includes when the folder itself is not ignored',
  );
  assert.equal(m.ignores('notes/a.md'), true);
  assert.equal(m.ignores('notes/public.md'), false);
  assert.equal(m.ignores('notes/sub/a.md'), false, '* does not cross /');
  assert.equal(m.ignores('#hash.md'), true, 'escaped #');
  assert.equal(m.ignores('docs/team/secret.md'), true, 'nested .gitignore');
  assert.equal(m.ignores('docs/secret.md'), false, 'nested rules stay in their folder');
  assert.equal(m.ignores('docs/team/sub/secret.md'), false, 'a deeper file overrides');
  assert.equal(
    new GitignoreMatcher({ '': 'private/\n!private/a.md\n' }).ignores('private/a.md'),
    true,
    'cannot re-include inside an ignored folder',
  );
  assert.equal(
    new GitignoreMatcher({ '': 'a/**/b.md\n' }).ignores('a/x/y/b.md'),
    true,
    '** spans folders',
  );
  assert.equal(
    new GitignoreMatcher({ '': 'a/**/b.md\n' }).ignores('a/b.md'),
    true,
    '** matches zero folders',
  );
  assert.equal(
    new GitignoreMatcher({ '': 'doc[0-9].md\n' }).ignores('doc4.md'),
    true,
    'character classes',
  );
  assert.equal(parseGitignore('\n# only comments\n').length, 0);
  assert.equal(new GitignoreMatcher({}).empty, true);
});

test('readable labels from file names keep acronyms and existing capitals', () => {
  assert.equal(humanize('getting-started'), 'Getting Started');
  assert.equal(humanize('api_reference.md'), 'API Reference');
  assert.equal(humanize('oauth-and-sso'), 'OAuth And SSO');
  assert.equal(humanize('iOS-setup'), 'iOS Setup');
  assert.equal(humanize('2026-10-15'), '2026 10 15');
  assert.equal(humanize('faq', []), 'Faq', 'custom acronym list');
  assert.equal(isFolderIndex('guides/README.md'), true);
  assert.equal(isFolderIndex('guides/index.md'), true);
  assert.equal(isFolderIndex('guides/indexes.md'), false);
});

test('pages know when their title is only the file name', () => {
  const page = (text: string) => parsePage('r', 'guides/user-guide.md', 'file:///x', text);
  assert.equal(page('Text only.').titleFromFile, true);
  assert.equal(page('# User Guide\n').titleFromFile, undefined);
  assert.equal(page('---\ntitle: Guide\n---\nText').titleFromFile, undefined);
  assert.equal(page('## Only a section\n').titleFromFile, true);
});

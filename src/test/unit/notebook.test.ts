import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  notebookToMarkdown,
  parseNotebook,
  renderNotebook,
  sanitizeHtml,
  stripAnsi,
} from '../../core/notebook';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
const nb = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { language_info: { name: 'python' } },
  cells: [
    {
      cell_type: 'markdown',
      source: ['# Analysis\n', 'Intro ![logo](attachment:logo.png)'],
      attachments: { 'logo.png': { 'image/png': png } },
    },
    {
      cell_type: 'code',
      execution_count: 3,
      source: 'print("hi")\n1 + 1',
      outputs: [
        { output_type: 'stream', name: 'stdout', text: ['hi\n'] },
        { output_type: 'execute_result', execution_count: 3, data: { 'text/plain': '2' } },
        { output_type: 'display_data', data: { 'image/png': png, 'text/plain': '<Figure>' } },
        {
          output_type: 'display_data',
          data: {
            'text/html':
              '<table onclick="x()"><tr><td style="color:red" colspan="2">a<script>alert(1)</script></td></tr></table><img src=x onerror=alert(1)>',
          },
        },
        {
          output_type: 'error',
          ename: 'ValueError',
          evalue: 'bad',
          traceback: ['\u001b[0;31mValueError\u001b[0m: bad'],
        },
        {
          output_type: 'display_data',
          data: { 'image/svg+xml': '<svg onload="alert(1)"><script>alert(2)</script></svg>' },
        },
      ],
    },
  ],
});
const opts = {
  renderMarkdown: (s: string) => `<md>${s}</md>`,
  highlight: (s: string) => s.replace(/</g, '&lt;'),
};

test('notebooks parse nbformat 4 and reject anything else with a readable error', () => {
  const parsed = parseNotebook(nb);
  assert.equal(parsed.language, 'python');
  assert.equal(parsed.cells.length, 2);
  assert.equal(parsed.cells[1].outputs.length, 6);
  assert.throws(() => parseNotebook('{not json'), /Invalid notebook JSON/);
  assert.throws(() => parseNotebook('{"nbformat":3,"cells":[]}'), /only nbformat 4/);
  assert.throws(() => parseNotebook('{"nbformat":4}'), /no cells array/);
});

test('saved outputs render inert: no scripts, handlers, styles or inline SVG', () => {
  const html = renderNotebook(parseNotebook(nb), opts);
  assert.match(html, /<span class="nb-prompt" aria-hidden="true">\[3\]<\/span>/);
  assert.match(html, /<pre class="nb-output nb-stream">hi\n<\/pre>/);
  assert.match(html, /<img alt="&lt;Figure&gt;" src="data:image\/png;base64,/);
  assert.match(html, /<table><tr><td colspan="2">a<\/td><\/tr><\/table>/);
  assert.match(html, /ValueError: bad\nValueError: bad/);
  assert.doesNotMatch(html, /onclick|onerror|onload|<script|style=|\x1b|<svg/);
  assert.match(html, /src="data:image\/svg\+xml;base64,/);
  assert.match(html, /<md># Analysis\nIntro !\[logo\]\(data:image\/png;base64,/);
  assert.match(
    renderNotebook(parseNotebook(nb), { ...opts, cells: [2, 2], showInput: false }),
    /^<div class="notebook"><section class="nb-cell nb-code"[^>]*><pre class="nb-output/,
  );
  assert.equal(stripAnsi('\u001b[1;32mok\u001b[0m'), 'ok');
  assert.equal(sanitizeHtml('<b>x</b><iframe src=y></iframe>&lt;'), '<b>x</b>&lt;');
});

test('notebooks convert to a Markdown page with fenced code, outputs and extracted images', () => {
  const { markdown, images } = notebookToMarkdown(parseNotebook(nb), 'Analysis');
  assert.match(markdown, /^# Analysis\n\n# Analysis\nIntro/);
  assert.match(markdown, /```python\nprint\("hi"\)\n1 \+ 1\n```/);
  assert.match(markdown, /```text\nhi\n```/);
  assert.match(markdown, /!\[Output of cell 2\]\(cell-2-output-3\.png\)/);
  assert.equal(images.length, 1);
  assert.equal(images[0].data, png);
});

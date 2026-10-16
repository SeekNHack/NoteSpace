import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMermaid } from '../../core/mermaid-source';

test('flowchart edges without spaces are normalised outside labels and quotes', () => {
  assert.equal(normalizeMermaid('graph LR\n  Plan-->Ship'), 'graph LR\n  Plan --> Ship');
  assert.equal(
    normalizeMermaid('flowchart TD\nA-->|yes|B\nC==>D\nE-.->F\nG---H'),
    'flowchart TD\nA -->|yes| B\nC ==> D\nE -.-> F\nG --- H',
  );
  assert.equal(
    normalizeMermaid('graph TD\n  A[a-->b]-->B("x-->y")'),
    'graph TD\n  A[a-->b] --> B("x-->y")',
  );
  assert.equal(normalizeMermaid('graph TD\n  A --> B'), 'graph TD\n  A --> B', 'already spaced');
  assert.equal(
    normalizeMermaid('sequenceDiagram\n  A->>B: hi'),
    'sequenceDiagram\n  A->>B: hi',
    'other diagram types untouched',
  );
  assert.equal(
    normalizeMermaid('graph TD\n  %% a-->b\n  subgraph one\n  end'),
    'graph TD\n  %% a-->b\n  subgraph one\n  end',
  );
});

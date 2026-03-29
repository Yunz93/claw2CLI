import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinalText } from '../src/final-text.js';

test('buildFinalText keeps all completed agent message segments', () => {
  assert.equal(
    buildFinalText([
      '第一段',
      '第二段',
      '第三段'
    ], []),
    '第一段\n\n第二段\n\n第三段'
  );
});

test('buildFinalText falls back to raw stdout when no agent message exists', () => {
  assert.equal(
    buildFinalText([], ['line 1\n', 'line 2\n']),
    'line 1\nline 2'
  );
});

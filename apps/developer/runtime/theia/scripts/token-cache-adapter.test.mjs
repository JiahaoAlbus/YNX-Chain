import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { ContiguousTokensStore } from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/tokens/contiguousTokensStore.js';
import { ContiguousTokensEditing, EMPTY_LINE_TOKENS } from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/tokens/contiguousTokensEditing.js';
const require = createRequire(import.meta.url);
const { stableTokenInsert } = require('../../ynx-workbench/lib/token-cache-adapter.js');
const original = ContiguousTokensEditing.insert;
const codec = { encodeLanguageId: () => 1, decodeLanguageId: () => 'json' };

function selectedMultilineEdit() {
  const cache = new ContiguousTokensStore(codec);
  cache.setTokens('json', 0, 2, new Uint32Array([0, 33587201]), false);
  cache.setTokens('json', 1, 0, new Uint32Array([0, 33587201]), false);
  const insert = (line, column) => cache.acceptEdit({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column }, 0, 1);
  // Surround {}\n first with braces, then quotes, then replace the selection.
  insert(2, 1); insert(1, 1); insert(2, 1); insert(1, 2);
  cache.acceptEdit({ startLineNumber: 1, startColumn: 3, endLineNumber: 2, endColumn: 1 }, 0, 1);
  return cache;
}

test('upstream empty-line cache loses a real suffix; owned adapter restores accurate joined-line tokens', () => {
  const broken = selectedMultilineEdit();
  assert.equal(new Uint32Array(broken._lineTokens[0]).at(-2), 3);
  assert.notEqual(new Uint32Array(broken._lineTokens[0]).at(-2), '{"e"}'.length);
  ContiguousTokensEditing.insert = stableTokenInsert(original, EMPTY_LINE_TOKENS);
  try {
    const corrected = selectedMultilineEdit();
    const tokens = corrected.getTokens('json', 0, '{"e"}');
    assert.equal(tokens.getEndOffset(tokens.getCount() - 1), 5);
    assert.equal(tokens.getTextLength(), 5);
    assert.equal(corrected._len, 1);
    // Normal grammar results still replace the temporary accurate fallback.
    corrected.setTokens('json', 0, 5, new Uint32Array([0, 33587201, 2, 33652737]), false);
    const grammar = corrected.getTokens('json', 0, '{"e"}');
    assert.equal(grammar.getCount(), 2); assert.equal(grammar.getEndOffset(1), 5);
  } finally { ContiguousTokensEditing.insert = original; }
});

test('normal token metadata and UTF-16 offsets remain intact; insertion into an empty line becomes unknown', () => {
  const insert = stableTokenInsert(original, EMPTY_LINE_TOKENS);
  assert.equal(insert(EMPTY_LINE_TOKENS, 0, 0), EMPTY_LINE_TOKENS);
  assert.equal(insert(EMPTY_LINE_TOKENS, 0, '中文🧩'.length), null);
  assert.equal(insert(null, 0, 3), null);
  const existing = new Uint32Array([2, 123, 4, 456]);
  assert.equal(insert(existing, 1, '🧩'.length), existing);
  assert.deepEqual([...existing], [4, 123, 6, 456]);
});

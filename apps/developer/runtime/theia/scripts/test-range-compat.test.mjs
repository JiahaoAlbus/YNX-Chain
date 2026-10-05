import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { testRangeFromRpc } = require('../../ynx-workbench/lib/test-range');
const { Range, Position } = require('@theia/plugin-ext/lib/plugin/types-impl');
const { fromRange } = require('@theia/plugin-ext/lib/plugin/type-converters');

test('real extension range survives RPC round trip without a line or column offset', () => {
  for (const [startLine, startColumn, endLine, endColumn] of [[0, 0, 0, 0], [4, 0, 5, 0], [17, 6, 20, 12]]) {
    const input = new Range(new Position(startLine, startColumn), new Position(endLine, endColumn));
    assert.deepEqual(testRangeFromRpc(fromRange(input)), {
      start: { line: startLine, character: startColumn },
      end: { line: endLine, character: endColumn },
    });
  }
});

test('an absent or cleared extension range remains absent', () => {
  assert.equal(testRangeFromRpc(undefined), undefined);
  assert.equal(testRangeFromRpc(null), undefined);
});

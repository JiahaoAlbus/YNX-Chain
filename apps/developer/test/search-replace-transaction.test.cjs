const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replaceBatch, expectedMatch } = require('../runtime/ynx-workbench/lib/search-replace-transaction');
function fixture(options = {}) {
  const state = { applied: [], removed: [], errors: [], disposed: [], saved: [] };
  const files = ['file:///project/a.sol', 'file:///project/b.sol'].map(fileUri => ({ kind: 'file', children: [], fileUri }));
  for (const f of files) f.children.push({ kind: 'line', parent: f, fileUri: f.fileUri, line: 1, character: 8, length: 5, lineText: 'public value;' });
  const models = files.map(() => ({ version: 1, getVersionId() { return this.version; }, getValueInRange() { return options.stale ? 'other' : 'value'; } }));
  const w = { resultTree: new Map(files.map((f, i) => [i, f])), searchTerm: 'value', _replaceTerm: 'total', confirmReplaceAll: async () => {
    if (options.changedQuery) w.searchTerm = 'other';
    return !options.cancel;
  }, findEndCharacterPosition: () => ({ line: 0, character: 12 }),
  ynxSearchWorkspace: { textModelService: { async createModelReference(uri) {
    const i = files.findIndex(f => f.fileUri === uri); if (options.race && i === 1) models[0].version++;
    return { object: { textEditorModel: models[i] }, dispose: () => state.disposed.push(uri) };
  } }, async applyBulkEdit(edits) { state.applied.push(edits); return { isApplied: !options.applyFailure, ariaSummary: 'apply failed' }; }, async saveAll(resources) { state.saved.push([...resources]); if (options.saveFailure) throw Error('save failed'); } },
  ynxSearchMessages: { error: async message => state.errors.push(message) }, removeNode: row => state.removed.push(row.fileUri) };
  const deps = { isFile: row => row.kind === 'file', isLine: row => row.kind === 'line', uri: x => x, range: (row, end) => ({ row, end }), edit: (target, text, version) => ({ target, text, version }), original: async () => { state.original = true; } };
  return { state, w, deps };
}
test('multi-file replacement reaches one versioned bulk edit before save and result retirement', async () => {
  const { state, w, deps } = fixture(); await replaceBatch(w, undefined, deps);
  assert.equal(state.applied.length, 1); assert.equal(state.applied[0].length, 2);
  assert.deepEqual(state.applied[0].map(x => [x.text, x.version]), [['total', 1], ['total', 1]]);
  assert.equal(state.saved[0].length, 2); assert.equal(state.removed.length, 2); assert.equal(state.disposed.length, 2); assert.deepEqual(state.errors, []);
});
for (const reason of ['cancel', 'stale', 'race', 'changedQuery']) test(reason + ' never applies or retires matches', async () => {
  const { state, w, deps } = fixture({ [reason]: true }); await replaceBatch(w, undefined, deps);
  assert.equal(state.applied.length, 0); assert.equal(state.removed.length, 0); assert.equal(w.ynxReplacing, false);
});
for (const reason of ['applyFailure', 'saveFailure']) test(reason + ' preserves results and reports failure', async () => {
  const { state, w, deps } = fixture({ [reason]: true }); await replaceBatch(w, undefined, deps);
  assert.equal(state.removed.length, 0); assert.equal(state.errors.length, 1); assert.equal(state.disposed.length, 2);
});
test('line-preview offset selects actual matched bytes', () => {
  assert.equal(expectedMatch({ character: 120, length: 5, lineText: { text: '...value...', character: 4 } }), 'value');
});
test('single file uses standard individual replacement', async () => {
  const { state, w, deps } = fixture(); await replaceBatch(w, w.resultTree.get(0), deps); assert.equal(state.original, true); assert.equal(state.applied.length, 0);
});

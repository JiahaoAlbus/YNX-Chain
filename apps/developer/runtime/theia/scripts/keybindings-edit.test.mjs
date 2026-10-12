import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { readShortcuts, changeShortcuts } = require('../../ynx-workbench/lib/keybindings-edit.js');
const validate = entry => { if (!entry.key || entry.key === 'ctrl') throw Error('Invalid key'); };

test('targeted JSONC edits preserve unrelated comments, unknown fields, arguments and conditions', () => {
  const text = '// retained header\n[\n  // unrelated shortcut\n  {"key":"f6","command":"other","custom":{"untouched":true}},\n  {"key":"f7", /* inside edited entry */ "command":"rename","when":"editorTextFocus","args":{"nested":[1,2]},"custom":42},\n]\n';
  const entries = readShortcuts(text, validate);
  const row = { command: 'rename', index: 1, entry: entries[1] };
  const changed = changeShortcuts(text, { kind: 'edit', row, key: 'f8', when: 'editorTextFocus' }, validate);
  assert.ok(changed.includes('// retained header')); assert.ok(changed.includes('// unrelated shortcut'));
  assert.ok(changed.includes('/* inside edited entry */'));
  const result = readShortcuts(changed, validate);
  assert.deepEqual(result[0], entries[0]); assert.deepEqual(result[1], { ...entries[1], key: 'f8' });
  assert.throws(() => changeShortcuts(changed, { kind: 'remove', row }, validate), /changed/);
});
test('editing a default preserves execution context and args; resetting restores defaults and keeps other commands', () => {
  const original = '// keep\n[{"key":"f6","command":"other"}]';
  const row = { command: 'rename', key: 'f2', when: 'editorTextFocus', context: 'editor', args: { mode: 'symbol' } };
  const changed = changeShortcuts(original, { kind: 'edit', row, key: 'f8', when: row.when }, validate);
  assert.deepEqual(readShortcuts(changed, validate), [
    { key: 'f6', command: 'other' },
    { key: 'f2', command: '-rename', when: 'editorTextFocus' },
    { key: 'f8', command: 'rename', when: 'editorTextFocus', context: 'editor', args: { mode: 'symbol' } },
  ]);
  const reset = changeShortcuts(changed, { kind: 'reset', row }, validate);
  assert.deepEqual(readShortcuts(reset, validate), [{ key: 'f6', command: 'other' }]); assert.ok(reset.includes('// keep'));
});
test('malformed JSONC, invalid keys and oversized arrays refuse mutation', () => {
  const row = { command: 'rename' };
  assert.throws(() => changeShortcuts('[broken]', { kind: 'add', row, key: 'f8' }, validate), /valid/);
  assert.throws(() => changeShortcuts('[]', { kind: 'add', row, key: 'ctrl' }, validate), /Invalid key/);
  assert.throws(() => readShortcuts(JSON.stringify(Array.from({ length: 4097 }, () => ({ key: 'f8', command: 'rename' }))), validate), /valid/);
});

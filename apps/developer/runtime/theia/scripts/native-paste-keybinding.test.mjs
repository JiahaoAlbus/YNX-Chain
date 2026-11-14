import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../ynx-workbench/lib/keybinding-registry.js', import.meta.url), 'utf8');
const framework = readFileSync(new URL('../node_modules/@theia/core/lib/browser/keybinding.js', import.meta.url), 'utf8');
const start = framework.indexOf('    executeKeyBinding(binding, event) {');
assert.ok(start >= 0);
const end = framework.indexOf('\n    /**', start);
// Run the installed framework's actual interception, including preventDefault.
const execute = vm.runInNewContext('({' + framework.slice(start, end) + '}).executeKeyBinding', {
  KeybindingRegistry_1: { PASSTHROUGH_PSEUDO_COMMAND: 'passthrough' },
});
function fixture(native = true) {
  const calls = [];
  class Parent { executeKeyBinding(binding, event) { return execute.call(this, binding, event); } }
  const module = { exports: {} };
  vm.runInNewContext(source, { module, window: native ? { webkit: { messageHandlers: { ynxLocalWorkbench: {} } } } : {}, require(id) {
    if (id.endsWith('/inversify')) return { injectable: () => value => value };
    if (id.endsWith('/keybinding')) return { KeybindingRegistry: Parent };
    throw Error(id);
  } });
  const registry = new module.exports.YnxKeybindingRegistry();
  registry.keySequence = [{}];
  registry.isPseudoCommand = id => id === 'passthrough';
  registry.commandRegistry = { getCommand: id => ({ id }), isEnabled: () => true,
    executeCommand: async id => { calls.push(id); } };
  registry.logger = { error: error => { throw error; } };
  return { registry, calls };
}
function event(extra = {}) {
  return { type: 'keydown', key: 'v', code: 'KeyV', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...extra };
}
test('native CmdV leaves genuine browser paste default intact instead of async command dispatch', () => {
  for (const command of ['core.paste', 'editor.action.clipboardPasteAction']) {
    const f = fixture(), e = event();
    f.registry.executeKeyBinding({ command }, e);
    assert.deepEqual(f.calls, []); assert.equal(e.defaultPrevented, false); assert.equal(e.stopped, false);
  }
});
test('browser, custom commands, chords and alternate shortcuts keep the existing dispatch', () => {
  for (const scenario of [
    { native: false }, { command: 'user.customPaste' }, { sequence: [{}, {}] },
    { event: { key: 'p', code: 'KeyP' } }, { event: { shiftKey: true } }, { event: { ctrlKey: true } },
    { event: { altKey: true } }, { event: { metaKey: false } },
  ]) {
    const f = fixture(scenario.native ?? true), e = event(scenario.event);
    if (scenario.sequence) f.registry.keySequence = scenario.sequence;
    const command = scenario.command || 'core.paste';
    f.registry.executeKeyBinding({ command }, e);
    assert.deepEqual(f.calls, [command]); assert.equal(e.defaultPrevented, true);
  }
});

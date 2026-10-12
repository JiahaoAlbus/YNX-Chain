import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
// DOM boundary only. Real retained BaseWidget/Lumino lifecycle, nls, commands,
// key parser and the unchanged production constructor/render/dialog code below.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.events = {}; this._text = ''; this._value = ''; this.classList = { add() {}, remove() {}, contains: () => false, toggle() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  set value(value) { this._value = value; }
  get value() { return this._value; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; if (this.tagName === 'SELECT' && this.children.length === 1) this.value = node.value; } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(key, callback) { (this.events[key] ||= []).push(callback); }
  removeEventListener(key, callback) { this.events[key] = (this.events[key] || []).filter(x => x !== callback); }
  fire(key, event = {}) { for (const callback of this.events[key] || []) callback(event); }
  matches(selector) { if (selector === 'option[value=Workspace]') return this.tagName === 'OPTION' && this.value === 'Workspace'; if (selector === '[role="alert"]') return this.attrs.role === 'alert'; return this.tagName.toLowerCase() === selector; }
  querySelector(selector) { return this.children.find(child => child.matches(selector)) || this.children.map(child => child.querySelector(selector)).find(Boolean); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() {} select() {} showModal() { this.open = true; } close() { this.open = false; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
}
const document = { createElement: tag => { const node = new Element(tag); node.ownerDocument = document; return node; }, addEventListener() {}, removeEventListener() {} };
document.body = document.createElement('body'); document.documentElement = document.createElement('html');
globalThis.Element = Element; globalThis.HTMLElement = Element; globalThis.document = document;
globalThis.DragEvent = class {};
globalThis.window = { document, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}) };
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'retained-node-test' }, configurable: true });
window.navigator = globalThis.navigator;
require('reflect-metadata');
const { BaseWidget } = require('@theia/core/lib/browser/widgets/widget');
const { CommandRegistry } = require('@theia/core/lib/common/command');
const { nls } = require('@theia/core/lib/common/nls');
const { LocalizationProvider } = require('@theia/core/lib/node/i18n/localization-provider');
const { KeySequence } = require('@theia/core/lib/common/keys');
// Execute the native scope declaration rather than loading unrelated browser
// keyboard-layout/UI services into a Node render fixture.
const nativeScopeSource = readFileSync(require.resolve('@theia/core/lib/browser/keybinding'), 'utf8');
const scopeStart = nativeScopeSource.indexOf('var KeybindingScope;');
const scopeClose = /\}\)\(KeybindingScope \|\| \(exports\.KeybindingScope = (?:KeybindingScope = )?\{\}\)\);/.exec(nativeScopeSource.slice(scopeStart));
assert.ok(scopeStart >= 0 && scopeClose, 'Retained keybinding scope contract must exist.');
const scopeEnd = scopeStart + scopeClose.index + scopeClose[0].length;
const scopeExports = {}; vm.runInNewContext(nativeScopeSource.slice(scopeStart, scopeEnd), { exports: scopeExports });
function loadOwned(name) {
  const path = fileURLToPath(new URL(`../../ynx-workbench/lib/${name}.js`, import.meta.url));
  const mod = new Module(path); mod.paths = require.resolve.paths('@theia/core'); mod._compile(readFileSync(path, 'utf8'), path); return mod.exports;
}
const localization = loadOwned('keyboard-shortcuts-localization');
const source = readFileSync(new URL('../../ynx-workbench/lib/keyboard-shortcuts.js', import.meta.url), 'utf8'), owned = { exports: {} };
vm.runInNewContext(source, { module: owned, document, require: id => id === '@theia/core/lib/browser/widgets' ? { BaseWidget } : id === '@theia/core/lib/browser/keybinding' ? scopeExports : id === './keyboard-shortcuts-localization' ? localization : require(id) });
const { KeyboardShortcutsWidget, KeyboardShortcutsContribution } = owned.exports;
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, chinese) {
  const previous = nls.localization, provider = new LocalizationProvider(), registration = localization.registerKeyboardShortcutsLocalizations(provider);
  nls.localization = chinese ? await provider.loadLocalization('zh-cn') : undefined;
  const commands = new CommandRegistry({ getContributions: () => [] }), changed = [], registered = commands.registerCommand({ id: 'editor.action.rename', label: chinese ? '重命名符号' : 'Rename Symbol' }, { execute() {} });
  const registry = { onKeybindingsChanged: () => ({ dispose() {} }), getKeybindingsForCommand: () => [{ scope: scopeExports.KeybindingScope.DEFAULT, keybinding: 'f2', when: 'editorTextFocus' }], resolveKeybinding: binding => KeySequence.parse(binding.keybinding) };
  const snapshot = { targetScope: 'User', available: true, entries: [], scopes: { User: { entries: [] }, Workspace: { entries: [], available: true } } };
  const shortcuts = { snapshot: async () => snapshot, validate: value => KeySequence.parse(value.key), change: async (original, change) => { assert.equal(original, snapshot); changed.push(change); } };
  const widget = new KeyboardShortcutsWidget(shortcuts, registry, commands); await widget.refresh();
  t.after(() => { widget.dispose(); registered.dispose(); registration.dispose(); nls.localization = previous; });
  assert.ok(!widget.loadError, widget.message.textContent);
  return { widget, commands, changed, shortcuts, snapshot };
}
test('actual retained widget renders Chinese labels while preserving command IDs and scope values', async t => {
  const f = await fixture(t, true), w = f.widget;
  assert.ok(w instanceof BaseWidget); assert.equal(w.title.label, '键盘快捷方式'); assert.equal(w.search.placeholder, '搜索命令或快捷方式');
  assert.deepEqual(Array.from(w.source.children, option => option.value), ['All', 'User', 'Default', 'Workspace', 'Unassigned']);
  assert.equal(w.source.children[2].textContent, '默认'); assert.equal(w.target.value, 'User'); assert.equal(w.target.children[1].value, 'Workspace');
  assert.equal(w.table.getAttribute('aria-label'), '键盘快捷方式'); assert.match(w.node.textContent, /打开 JSON/); assert.match(w.count.textContent, /1 个快捷方式/);
  assert.equal(w.body.children[0].dataset.command, 'editor.action.rename'); assert.equal(w.body.children[0].dataset.source, 'Default'); assert.match(w.body.textContent, /默认/);
  w.search.value = '默认'; w.renderRows(); assert.equal(w.body.children.length, 1);
  w.edit(w.rows[0], 'edit'); const dialog = w.node.querySelector('dialog');
  assert.match(dialog.textContent, /编辑快捷方式/); assert.match(dialog.textContent, /录制按键/);
  const inputs = dialog.querySelectorAll('input'); assert.equal(inputs[0].getAttribute('aria-label'), '快捷方式'); assert.equal(inputs[1].value, 'editorTextFocus');
  const record = dialog.querySelectorAll('button').find(button => button.textContent === '录制按键');
  record.fire('click'); assert.equal(record.textContent, '正在录制…'); assert.equal(inputs[0].readOnly, true);
  inputs[0].fire('keydown', { key: 'Escape', stopPropagation() {}, preventDefault() {} });
  assert.equal(record.textContent, '录制按键'); assert.equal(inputs[0].readOnly, false);
  assert.match(inputs[1].placeholder, /editorTextFocus/); inputs[0].value = '';
  dialog.querySelectorAll('button').find(button => button.textContent === '保存').fire('click');
  assert.equal(dialog.querySelector('[role="alert"]').textContent, '请输入快捷方式。'); assert.equal(f.changed.length, 0);
  inputs[0].value = 'f8'; dialog.querySelectorAll('button').find(button => button.textContent === '保存').fire('click'); await settle();
  assert.equal(f.changed[0].key, 'f8'); assert.equal(f.changed[0].when, 'editorTextFocus'); assert.equal(f.changed[0].row.command, 'editor.action.rename');
  assert.equal(w.message.textContent, '键盘快捷方式已保存。');
});
test('native key parser conflicts are translated while raw conditions and command names remain intact', async t => {
  const f = await fixture(t, true), other = f.commands.registerCommand({ id: 'other.command', label: 'Other command' }, { execute() {} });
  t.after(() => other.dispose()); await f.widget.refresh();
  const row = f.widget.rows.find(row => row.command === 'editor.action.rename'); f.widget.edit(row, 'edit');
  assert.match(f.widget.node.querySelector('dialog').textContent, /以下命令也使用此快捷方式：Other command。保存前请检查生效条件。/);
  assert.equal(f.widget.rows.find(row => row.command === 'other.command').key, 'f2');
});
test('English fallback renders original strings and real CommandRegistry/menu contributions preserve shortcut behavior', async t => {
  const f = await fixture(t, false), w = f.widget;
  assert.equal(w.title.label, 'Keyboard Shortcuts'); assert.equal(w.search.placeholder, 'Search commands or shortcuts'); assert.equal(w.count.textContent, '1 shortcuts · Page 1 of 1');
  w.edit(w.rows[0], 'add'); const dialog = w.node.querySelector('dialog'); assert.match(dialog.textContent, /Add Shortcut/);
  assert.equal(dialog.querySelectorAll('input')[0].placeholder, 'For example cmd+k cmd+y');
  const contribution = new KeyboardShortcutsContribution({}, {}), menus = [], keybindings = [];
  contribution.registerCommands(f.commands); contribution.registerMenus({ registerMenuAction: (path, action) => menus.push(action) });
  contribution.registerKeybindings({ registerKeybinding: binding => keybindings.push(binding) });
  assert.equal(f.commands.getCommand('workbench.action.openGlobalKeybindings').label, 'Open Keyboard Shortcuts');
  assert.ok(menus.every(action => action.label === 'Keyboard Shortcuts'));
  assert.deepEqual(JSON.parse(JSON.stringify(keybindings)), [{ command: 'workbench.action.openGlobalKeybindings', keybinding: 'ctrlcmd+k ctrlcmd+s' }]);
});
test('Chinese command/menu labels, placeholders and formatted translations stay in their owned keyspace', async t => {
  const f = await fixture(t, true), contribution = new KeyboardShortcutsContribution({}, {}), menus = [];
  contribution.registerCommands(f.commands); contribution.registerMenus({ registerMenuAction: (path, action) => menus.push(action) });
  assert.equal(f.commands.getCommand('workbench.action.openGlobalKeybindings').label, '打开键盘快捷方式');
  assert.ok(menus.every(action => action.label === '键盘快捷方式'));
  for (const [key, chinese] of Object.entries(localization.TRANSLATIONS)) {
    assert.ok(key.startsWith('ynx/keyboardShortcuts/')); assert.match(chinese, /[\u3400-\u9fff]/);
    const name = key.slice(key.lastIndexOf('/') + 1), english = localization.EN_DEFAULTS[name];
    assert.deepEqual(chinese.match(/\{\d+\}/g) || [], english.match(/\{\d+\}/g) || []);
  }
});

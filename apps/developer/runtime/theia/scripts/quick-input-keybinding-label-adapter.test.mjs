import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const nativeURL = new URL('../node_modules/@theia/monaco-editor-core/esm/vs/base/browser/ui/keybindingLabel/keybindingLabel.js', import.meta.url);
const nativeSource = (await readFile(nativeURL, 'utf8')).replace(/^import .*;\n/gm, '').replaceAll('export ', '');
const adapterSource = await readFile(new URL('../../ynx-workbench/lib/quick-input-keybinding-label-adapter.js', import.meta.url), 'utf8');
const { Disposable } = await import(new URL('../node_modules/@theia/monaco-editor-core/esm/vs/base/common/lifecycle.js', import.meta.url));
const { UILabelProvider } = await import(new URL('../node_modules/@theia/monaco-editor-core/esm/vs/base/common/keybindingLabels.js', import.meta.url));
const { equals } = await import(new URL('../node_modules/@theia/monaco-editor-core/esm/vs/base/common/objects.js', import.meta.url));
// Keep the entire retained constructor/set/render/clear/chord implementation.
// Only its browser DOM and hover surfaces are explicit Node fixtures.
function node(text = '') {
  return { children: [], text, style: {}, attributes: {}, appendChild(child) { this.children.push(child); return child; }, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } };
}
function fixture() {
  const hoverUpdates = [], exports = {};
  const dom = { $: (_selector, _attrs, text) => node(text), append: (parent, child) => parent.appendChild(child), clearNode: target => { target.children.length = 0; } };
  vm.runInNewContext(nativeSource + '\nexports.KeybindingLabel=KeybindingLabel;', { exports, dom, Disposable, UILabelProvider, equals,
    getDefaultHoverDelegate: () => ({}), getBaseLayerHoverDelegate: () => ({ setupManagedHover: (_delegate, target) => ({ dispose() {}, update(value) { hoverUpdates.push(value); if (value) target.setAttribute('title', value); else target.removeAttribute('title'); } }) }), localize: (_key, text) => text });
  const module = { exports: {} };
  vm.runInNewContext(adapterSource, { module, require: id => { assert.match(id, /keybindingLabel$/); return exports; } });
  const label = new exports.KeybindingLabel(node(), 2, {});
  const binding = { getChords: () => [{ ctrlKey: false, shiftKey: false, altKey: true, metaKey: true, keyLabel: '↑' }], getAriaLabel: () => 'Option+Command+UpArrow' };
  return { label, binding, hoverUpdates, install: module.exports.install, native: exports.KeybindingLabel };
}
function text(target) { return target.text + target.children.map(text).join(''); }
test('actual retained render reproduces stale metadata when row loses its binding', () => {
  const f = fixture(); f.label.set(f.binding); f.label.set(undefined);
  assert.equal(text(f.label.element), ''); assert.equal(f.label.element.attributes['aria-label'], 'Option+Command+UpArrow');
  assert.equal(f.label.element.attributes.title, 'Option+Command+UpArrow');
});
test('owned install clears empty-binding recycled row aria, hover, title and native children', () => {
  const f = fixture(); f.install(); f.label.set(f.binding); assert.ok(text(f.label.element).includes('↑'));
  f.label.set(undefined);
  assert.equal(text(f.label.element), ''); assert.equal(f.label.element.attributes['aria-label'], undefined);
  assert.equal(f.label.element.attributes.title, undefined); assert.equal(f.hoverUpdates.at(-1), undefined);
  f.label.element.setAttribute('aria-label', 'late stale'); f.label.element.setAttribute('title', 'late stale');
  f.label.set(undefined); assert.deepEqual(f.label.element.attributes, {});
});
test('bound native rendering and install idempotence remain intact after row reuse', () => {
  const f = fixture(), original = f.native.prototype.set;
  f.install(); const wrapper = f.native.prototype.set; f.install(); assert.equal(f.native.prototype.set, wrapper); assert.notEqual(wrapper, original);
  f.label.set(f.binding); const first = text(f.label.element); assert.ok(first.includes('↑'));
  f.label.set(undefined); f.label.set(f.binding); assert.equal(text(f.label.element), first);
  assert.equal(f.label.element.attributes['aria-label'], 'Option+Command+UpArrow'); assert.equal(f.label.element.attributes.title, 'Option+Command+UpArrow');
  const count = f.hoverUpdates.length; f.label.set(f.binding); assert.equal(f.hoverUpdates.length, count);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
function node() { return { style: {}, classList: { add() {} }, attributes: {}, children: [], listeners: {}, setAttribute(key, value) { this.attributes[key] = value; }, append(...items) { this.children.push(...items); }, addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {} }; }
const document = { createElement: node };
class BaseWidget { constructor() { this.node = node(); this.node.ownerDocument = document; this.title = {}; this.toDispose = []; } onActivateRequest() {} }
const module = { exports: {} };
vm.runInNewContext(readFileSync(new URL('../../ynx-workbench/lib/ecosystem-sidebar.js', import.meta.url), 'utf8'), { module, require: id => id.endsWith('/widgets') ? { BaseWidget } : { CommonMenus: { VIEW_VIEWS: ['view'] } } });
const { EcosystemSidebarWidget, EcosystemSidebarContribution } = module.exports;
test('development extensions entry uses the installed kernel registry contribution', async () => {
  const calls = [];
  const widget = new EcosystemSidebarWidget({ getCommand: () => ({}), isEnabled: () => true, executeCommand: id => calls.push(id) }, { error: e => { throw Error(e); } }, (_, text) => text);
  const entry = widget.buttons.find(item => item.command === 'vsxExtensions.toggle');
  assert.ok(entry); await entry.button.listeners.click();
  assert.deepEqual(calls, ['vsxExtensions.toggle']);
});
test('navigation rechecks permission and dispatches the current project only at click', async () => {
  let allowed = true, project = 'first'; const calls = [], errors = [];
  const commands = { getCommand: () => ({}), isEnabled: () => allowed, executeCommand: id => calls.push([id, project]) };
  const widget = new EcosystemSidebarWidget(commands, { error: e => errors.push(e) }, (_, text) => text);
  assert.equal(calls.length, 0, 'view construction has no business call');
  project = 'second'; await widget.buttons[0].button.listeners.click();
  assert.deepEqual(calls, [['ynx.contracts.focus', 'second']]);
  allowed = false; await widget.buttons[0].button.listeners.click();
  assert.equal(calls.length, 1); assert.equal(errors.length, 1);
});
test('restored layout gains a left entry without activation or duplicate attachment', async () => {
  const widget = { id: 'ynx-ecosystem-sidebar' }; const calls = []; let attached = false;
  const contribution = new EcosystemSidebarContribution({ getOrCreateWidget: async () => widget }, {
    getTabBarFor: () => attached,
    addWidget: (_, options) => { attached = true; calls.push(options.area); },
    activateWidget: () => calls.push('activate'),
  }, (_, text) => text);
  await contribution.onDidInitializeLayout(); await contribution.onDidInitializeLayout();
  assert.deepEqual(calls, ['left']);
  await contribution.open(); assert.deepEqual(calls, ['left', 'activate']);
});

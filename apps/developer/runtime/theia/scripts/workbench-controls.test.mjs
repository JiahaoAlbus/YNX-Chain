import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
const { CommandRegistry } = require('@theia/core/lib/common/command');
const source = readFileSync(new URL('../../ynx-workbench/lib/workbench-controls.js', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(source, { module, require, setInterval, clearInterval });
const { WorkbenchControlsContribution, RUN_ACTIONS, VIEWS, nativeEntryVisible } = module.exports;
function fixture() {
  const commands = new CommandRegistry(), calls = [], views = {}, editor = {};
  for (const action of RUN_ACTIONS) commands.registerCommand({ id: action.id }, { execute: (...args) => calls.push([action.id, args]) });
  for (const view of VIEWS) {
    commands.registerCommand({ id: view.command }, { execute: () => calls.push([view.command]) });
    views[view.key] = { tryGetWidget: () => undefined, openView: options => calls.push([view.key, options]) };
  }
  delete views.terminal;
  const shell = { getWidgets: () => [], getTabBarFor: () => undefined };
  return { commands, calls, views, editor, shell, controls: new WorkbenchControlsContribution({ commands, shell, views, editors: { all: [editor] } }) };
}
test('real CommandRegistry dispatches only native debug and task IDs with no file/shell arguments', async () => {
  const f = fixture();
  for (const action of RUN_ACTIONS) await f.controls.run(action.id);
  assert.deepEqual(f.calls.map(c => c[0]), Array.from(RUN_ACTIONS, a => a.id));
  assert.ok(f.calls.every(c => c[1].length === 0));
});
test('unknown or disabled runtime commands cannot dispatch', async () => {
  const f = fixture();
  await assert.rejects(f.controls.run('not.present'), /Unavailable in this runtime/);
  const registration = f.commands.registerCommand({ id: 'disabled' }, { isEnabled: () => false, execute: () => assert.fail('dispatch') });
  await assert.rejects(f.controls.run('disabled'), /Currently unavailable/);
  registration.dispose(); assert.equal(f.controls.state('disabled').enabled, false);
});
test('view discovery uses native openView reveal and terminal uses real command, never toggles visible view shut', async () => {
  const f = fixture();
  for (const view of VIEWS) await f.controls.openView(view.key);
  assert.equal(f.calls.length, 9);
  for (const call of f.calls.slice(0, 8)) assert.equal(call[1].activate && call[1].reveal, true);
  assert.equal(f.calls[8][0], 'workbench.action.terminal.toggleTerminal');
  delete f.views.scm;
  await assert.rejects(f.controls.openView('scm'), /Native view contribution/);
  assert.equal(f.calls.length, 9);
});
test('native tab present and actually visible suppresses duplicate discovery; hidden/overflow tabs retain entry', () => {
  const f = fixture(), widget = { title: {}, isDisposed: false };
  const rect = { left: 0, right: 40, top: 0, bottom: 40, width: 40, height: 40 };
  const bar = { isVisible: true, titles: [widget.title], contentNode: { children: [{ getBoundingClientRect: () => rect }] }, node: { getBoundingClientRect: () => rect } };
  f.shell.getTabBarFor = () => bar; f.views.explorer.tryGetWidget = () => widget;
  assert.equal(nativeEntryVisible(f.shell, widget), true);
  assert.ok(!f.controls.missingViews('left').some(v => v.key === 'explorer'));
  bar.isVisible = false; assert.ok(f.controls.missingViews('left').some(v => v.key === 'explorer'));
  bar.isVisible = true; bar.node.getBoundingClientRect = () => ({ ...rect, right: 20 });
  assert.equal(nativeEntryVisible(f.shell, widget), false);
  bar.titles = []; assert.equal(nativeEntryVisible(f.shell, widget), false);
});
test('real React toolbar contribution limits dropdown to EditorManager widgets; disabled actions shown honestly', () => {
  const f = fixture(); let item;
  f.controls.registerToolbarItems({ registerItem: value => { item = value; return { dispose() {} }; } });
  assert.equal(item.isVisible(f.editor), true); assert.equal(item.isVisible({}), false);
  f.commands.unregisterCommand(RUN_ACTIONS[0].id);
  const rendered = item.render();
  assert.equal(rendered.type, 'details');
  const buttons = rendered.props.children[1].props.children;
  assert.equal(buttons.length, 4); assert.equal(buttons[0].props.disabled, true);
  assert.equal(buttons[0].props.title, 'Unavailable in this runtime');
  f.controls.dispose();
});
test('existing terminal is activated through native shell instead of toggling it closed', async () => {
  const f = fixture(), terminal = { id: 'terminal-actual-widget' };
  f.shell.getWidgets = () => [terminal]; f.shell.activateWidget = id => f.calls.push(['activate', id]);
  await f.controls.openView('terminal');
  assert.deepEqual(f.calls, [['activate', terminal.id]]);
});

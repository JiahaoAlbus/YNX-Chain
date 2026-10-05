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
const { WorkbenchControlsContribution, RUN_MENU, RUN_ACTIONS, VIEWS, nativeEntryVisible } = module.exports;
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

test('existing terminal is activated through native shell instead of toggling it closed', async () => {
  const f = fixture(), terminal = { id: 'terminal-actual-widget' };
  f.shell.getWidgets = () => [terminal]; f.shell.activateWidget = id => f.calls.push(['activate', id]);
  await f.controls.openView('terminal');
  assert.deepEqual(f.calls, [['activate', terminal.id]]);
});
test('visible native activity bar suppresses entire extra rail even when child widget identities differ', () => {
  const f = fixture();
  f.shell.leftPanelHandler = { tabBar: { isVisible: true, node: { getBoundingClientRect: () => ({ width: 40, height: 600 }) } } };
  assert.equal(f.controls.missingViews('left').length, 0);
  assert.equal(f.controls.missingViews('bottom').length, 4);
  f.shell.leftPanelHandler.tabBar.isVisible = false;
  assert.equal(f.controls.missingViews('left').length, 5);
  f.shell.leftPanelHandler.tabBar.isVisible = true;
  f.shell.leftPanelHandler.tabBar.node.getBoundingClientRect = () => ({ width: 0, height: 0 });
  assert.equal(f.controls.missingViews('left').length, 5);
});

test('actual MenuModelRegistry resolves four native actions with meaningful labels and real dispatch/enablement', async () => {
  const f = fixture();
  const { MenuModelRegistry, GroupImpl, ActionMenuNode } = require('@theia/core/lib/common/menu');
  const factory = { createGroup: (id, order, when) => new GroupImpl(id, order, when), createCommandMenu: action => new ActionMenuNode(action, f.commands, { getKeybindingsForCommand: () => [] }, { match: () => true, parseKeys: () => [] }) };
  const menus = new MenuModelRegistry({ getContributions: () => [] }, f.commands, factory);
  f.controls.registerMenus(menus);
  const actions = menus.getMenu(RUN_MENU).children.find(group => group.id.endsWith('actions')).children;
  assert.deepEqual(actions.map(action => action.label), Array.from(RUN_ACTIONS, action => action.label));
  for (const action of actions) { assert.equal(action.isEnabled(RUN_MENU), true); await action.run(RUN_MENU); }
  assert.deepEqual(f.calls.map(call => call[0]), Array.from(RUN_ACTIONS, action => action.id));
  assert.ok(f.calls.every(call => call[1].length === 0));
  f.commands.unregisterCommand(RUN_ACTIONS[0].id); assert.equal(actions[0].isEnabled(RUN_MENU), false);
  f.controls.dispose(); assert.equal(menus.getMenu(RUN_MENU).children.find(group => group.id.endsWith('actions')).children.length, 0);
});
test('toolbar opens native context-menu overlay at button coordinates and disposes access, without inline details', () => {
  const f = fixture(); let item, options, disposed = 0;
  f.controls.contextMenus = { render: value => { options = value; return { dispose: () => { disposed++; value.onHide(); } }; } };
  f.controls.registerToolbarItems({ registerItem: value => { item = value; return { dispose() {} }; } });
  const rendered = item.render(f.editor); assert.equal(rendered.type, 'button'); assert.equal(rendered.props['aria-haspopup'], 'menu'); assert.ok(rendered.props['aria-label']);
  const button = { getBoundingClientRect: () => ({ left: 100, bottom: 60 }) };
  rendered.props.onClick({ currentTarget: button });
  assert.deepEqual(Array.from(options.menuPath), Array.from(RUN_MENU)); assert.equal(options.anchor.x, 100); assert.equal(options.anchor.y, 60);
  assert.equal(options.context, button); assert.equal(options.includeAnchorArg, false); assert.equal(options.args.length, 0);
  rendered.props.onClick({ currentTarget: button }); assert.equal(disposed, 1);
  f.controls.dispose(); assert.equal(disposed, 2);
});
test('missing native popup renderer is explicitly unavailable and empty translation retains toolbar label', () => {
  const f = fixture(); const controls = new WorkbenchControlsContribution({ commands: f.commands, shell: f.shell, editors: { all: [f.editor] }, translate: () => undefined }); let item;
  controls.registerToolbarItems({ registerItem: value => { item = value; return { dispose() {} }; } });
  const rendered = item.render(f.editor); assert.equal(rendered.props.disabled, true); assert.ok(rendered.props['aria-label'].trim());
  assert.throws(() => controls.openRunMenu({}), /Unavailable in this runtime/); controls.dispose();
});

test('restored panel initializes real static views in one tab group without activation or a terminal process', async () => {
  const f = fixture(), terminal = { id: 'terminal-existing' }, widgets = [];
  f.shell.getWidgets = () => [terminal];
  for (const key of ['problems', 'output', 'console']) {
    f.views[key].openView = options => { f.calls.push([key, options]); const widget = { id: key }; widgets.push(widget); return widget; };
  }
  await f.controls.initializeLayout();
  assert.deepEqual(f.calls.map(call => call[0]), ['problems', 'output', 'console']);
  assert.equal(f.calls[0][1].ref, terminal);
  assert.equal(f.calls[1][1].ref, widgets[0]);
  assert.equal(f.calls[2][1].ref, widgets[1]);
  for (const [, options] of f.calls) {
    assert.equal(options.area, 'bottom'); assert.equal(options.mode, 'tab-after');
    assert.equal(options.activate, false); assert.equal(options.reveal, false);
  }
});
test('panel initialization preserves restored split views, skips unavailable views, and survives a failing contribution', async () => {
  const f = fixture(), restored = { id: 'restored-problems' }, errors = [];
  f.views.problems.tryGetWidget = () => restored;
  f.shell.getTabBarFor = widget => widget === restored ? {} : undefined;
  f.controls.messages = { error: error => errors.push(error) };
  f.views.output.openView = () => { throw new Error('output initialization failed'); };
  await f.controls.initializeLayout();
  assert.deepEqual(errors, ['output initialization failed']);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'console');
  assert.equal(f.calls[0][1].ref, restored);
  f.calls.length = 0; f.commands.unregisterCommand('debug:console:toggle');
  f.controls.stopped = true; await f.controls.initializeLayout();
  assert.equal(f.calls.length, 0);
});

test('extension palette language conditions track actual editor, changes and disposal without inventing task support', () => {
  const f = fixture(), keys = new Map();
  const editors = { all: [f.editor], currentEditor: { editor: { document: { languageId: 'python' } } } };
  const controls = new WorkbenchControlsContribution({ ...f, editors, contextKeys: { createKey: (name, initial) => {
    keys.set(name, initial); return { set: value => keys.set(name, value), reset: () => keys.set(name, undefined) };
  } } });
  controls.refresh(); assert.equal(keys.get('editorLangId'), 'python');
  editors.currentEditor.editor.document.languageId = 'cpp'; controls.refresh(); assert.equal(keys.get('editorLangId'), 'cpp');
  editors.currentEditor.isDisposed = true; controls.refresh(); assert.equal(keys.get('editorLangId'), undefined);
  editors.currentEditor = undefined; controls.refresh(); assert.equal(keys.get('editorLangId'), undefined);
  assert.deepEqual([...keys.keys()], ['ynxNoSelectedDebugConfiguration', 'editorLangId']); controls.dispose();
});

test('restored layouts are untouched and a terminal moved to main is reused', async () => {
 const f = fixture(), terminal = { id: 'terminal-main' };
 f.shell.getWidgets = area => area === 'main' ? [terminal] : [];
 f.shell.activateWidget = id => f.calls.push(['activate', id]);
 await f.controls.onDidInitializeLayout(); assert.equal(f.calls.length, 0);
 await f.controls.openView('terminal'); assert.deepEqual(f.calls, [['activate', terminal.id]]);
 assert.ok(!source.includes("for (const area of ['left', 'bottom'])"));
});

test('first-use debug context follows real configuration selection and preserves a selected JS or compound target', () => {
 const f = fixture(), values = new Map(), configuration = { current: undefined };
 const controls = new WorkbenchControlsContribution({ ...f, editors: { all: [f.editor] }, debugConfigurations: configuration,
 contextKeys: { createKey: (name, initial) => { values.set(name, initial); return { set: value => values.set(name, value), reset: () => values.delete(name) }; } } });
 controls.refresh(); assert.equal(values.get('ynxNoSelectedDebugConfiguration'), true);
 configuration.current = { configuration: { type: 'pwa-node' } }; controls.refresh(); assert.equal(values.get('ynxNoSelectedDebugConfiguration'), false);
 configuration.current = { name: 'compound' }; controls.refresh(); assert.equal(values.get('ynxNoSelectedDebugConfiguration'), false);
 configuration.current = undefined; controls.refresh(); assert.equal(values.get('ynxNoSelectedDebugConfiguration'), true); controls.dispose();
});

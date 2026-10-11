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
const { WorkbenchControlsContribution, RUN_MENU, RUN_ACTIONS, PROJECT_ACTIONS, VIEWS, nativeEntryVisible } = module.exports;
// Execute the installed framework's mouseup and dispatch implementation. The
// fixture supplies geometry, not a replacement command or click implementation.
const luminoSource = readFileSync(require.resolve('@lumino/widgets'), 'utf8');
function frameworkMethod(name) {
  const start = luminoSource.indexOf('        ' + name + '(');
  assert.ok(start >= 0, 'installed framework method must exist');
  let end = luminoSource.indexOf('{', start) + 1, depth = 1;
  for (; depth; end++) { if (luminoSource[end] === '{') depth++; else if (luminoSource[end] === '}') depth--; }
  return vm.runInNewContext('({' + luminoSource.slice(start, end) + '}).' + name, { console });
}
const frameworkMouseUp = frameworkMethod('_evtMouseUp');
const frameworkTrigger = frameworkMethod('triggerActiveItem');
function popupFixture(commandId = RUN_ACTIONS[0].id) {
  const f = fixture(), accesses = [], pending = [];
  f.controls.editors.currentEditor = f.editor;
  f.controls.contextMenus = { render(options) {
    const listeners = new Map();
    const node = { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); } };
    const menu = { node, isAttached: true, activeIndex: -1,
      contentNode: { children: [{ getBoundingClientRect: () => ({ left: 10, right: 110, top: 20, bottom: 50 }) }] },
      get activeItem() { return this.activeIndex === 0 ? { type: 'command', command: commandId, args: [] } : undefined; },
      _cancelOpenTimer() {}, _cancelCloseTimer() {}, triggerActiveItem: frameworkTrigger,
      commands: { isEnabled: id => f.commands.isEnabled(id), execute: id => {
        const dispatched = f.controls.run(id); pending.push(dispatched); return dispatched;
      } },
      rootMenu: { close() { menu.isAttached = false; options.onHide(); } },
    };
    const access = { menu, listeners, disposed: false, dispose() { this.disposed = true; menu.isAttached = false; options.onHide(); }, options };
    accesses.push(access); return access;
  } };
  const button = { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) };
  return { ...f, accesses, pending, open: () => { f.controls.openRunMenu(button, f.editor); return accesses.at(-1); },
    down(access, overrides = {}) { access.listeners.get('mousedown')?.({ button: 0, clientX: 30, clientY: 30, ...overrides }); },
    up(access, overrides = {}) { frameworkMouseUp.call(access.menu, { button: 0, preventDefault() {}, stopPropagation() {}, ...overrides }); } };
}
test('direct Run menu click without mousemove uses normal framework dispatch exactly once', async () => {
  const f = popupFixture(), access = f.open();
  f.down(access); f.down(access); assert.equal(f.calls.length, 0);
  f.up(access); f.up(access);
  await Promise.all(f.pending);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], RUN_ACTIONS[0].id);
  assert.equal(access.listeners.size, 0, 'closing menu retires pointer listener');
  f.controls.dispose();
});
test('accessibility click without mouse down/up uses framework dispatch once and retires popup', async () => {
  const f = popupFixture(), access = f.open();
  const activate = access.listeners.get('click');
  activate({ button: 0, target: access.menu.contentNode.children[0], clientX: 0, clientY: 0 });
  activate({ button: 0, target: access.menu.contentNode.children[0], clientX: 0, clientY: 0 });
  await Promise.all(f.pending); assert.equal(f.calls.length, 1); assert.equal(access.listeners.size, 0);
  f.controls.dispose();
});
test('Run popup retains disabled, non-left and outside-item framework boundaries', () => {
  const f = popupFixture();
  let access = f.open(); f.down(access, { button: 2 }); f.up(access, { button: 2 }); assert.equal(f.calls.length, 0);
  f.down(access, { clientX: 200 }); f.up(access); assert.equal(f.calls.length, 0);
  f.commands.unregisterCommand(RUN_ACTIONS[0].id);
  f.commands.registerCommand({ id: RUN_ACTIONS[0].id }, { isEnabled: () => false, execute: () => assert.fail('disabled dispatch') });
  access = f.open(); f.down(access); f.up(access); assert.equal(f.calls.length, 0);
  f.controls.dispose();
});
test('old popup hide, editor switch and stop cannot dispatch or retire a newer popup', () => {
  const f = popupFixture(), old = f.open(), current = f.open();
  old.options.onHide(); assert.equal(f.controls.popup, current);
  assert.equal(old.listeners.size, 0);
  f.down(old); f.up(old); assert.equal(f.calls.length, 0);
  f.controls.editors.currentEditor = {}; f.controls.refresh();
  assert.equal(current.disposed, true); assert.equal(current.listeners.size, 0);
  f.down(current); f.up(current); assert.equal(f.calls.length, 0);
  f.controls.editors.currentEditor = f.editor; const final = f.open(); f.controls.dispose();
  f.down(final); f.up(final); assert.equal(f.calls.length, 0); assert.equal(final.listeners.size, 0);
});
test('document replacement and command revocation between down and up cannot run a stale request', () => {
  const f = popupFixture(); f.editor.editor = { document: { uri: 'file:///first.cpp' } };
  let access = f.open(); f.editor.editor.document = { uri: 'file:///second.cpp' };
  f.down(access); f.up(access); assert.equal(f.calls.length, 0); assert.equal(access.disposed, true);
  access = f.open(); f.down(access); f.commands.unregisterCommand(RUN_ACTIONS[0].id);
  f.up(access); assert.equal(f.calls.length, 0); f.controls.dispose();
});
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
test('project toolbar dispatches registered commands without manufacturing runtime or chain authority', async () => {
  const f = fixture();
  for (const action of PROJECT_ACTIONS) {
    if (!f.commands.getCommand(action.id)) f.commands.registerCommand({ id: action.id }, { execute: (...args) => f.calls.push([action.id, args]) });
    await f.controls.run(action.id);
  }
  assert.deepEqual(f.calls.map(call => call[0]), Array.from(PROJECT_ACTIONS, action => action.id));
  assert.ok(PROJECT_ACTIONS.every(action => !/sign|deploy|approve|wallet.connect/.test(action.id)));
  const registration = f.commands.registerCommand({ id: 'temporarily-disabled' }, { isEnabled: () => false, execute: () => assert.fail('disabled action executed') });
  await assert.rejects(f.controls.run('temporarily-disabled'), /Currently unavailable/);
  registration.dispose();
});
test('project toolbar tracks actual command readiness and retires after disposal', () => {
  const f = fixture(), button = {};
  f.controls.editors.currentEditor = undefined;
  f.controls.projectButtons = [{button,action:{id:'ynx.network.focus'},label:'Chain'}];
  f.controls.refresh(); assert.equal(button.disabled,true);
  const registration=f.commands.registerCommand({id:'ynx.network.focus'}, {execute(){}});
  f.controls.refresh(); assert.equal(button.disabled,false);
  registration.dispose(); f.controls.refresh(); assert.equal(button.disabled,true);
  f.controls.dispose(); button.disabled=false; f.controls.refresh(); assert.equal(button.disabled,false);
});
test('normal startup refresh keeps project toolbar visible while hiding only redundant discovery', () => {
  const f = fixture(), widgets = new Map();
  const document = {defaultView:{},createTextNode:text=>({text}),createElement:()=>({
    ownerDocument:document,children:[],dataset:{},setAttribute(){},addEventListener(){},
    append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},
    insertBefore(child,reference){this.children.splice(this.children.indexOf(reference),0,child);},
    replaceChildren(){this.children=[];},
  })};
  class Widget {
    constructor({node}){this.node=node;this.hidden=false;this.isDisposed=false;}
    setHidden(value){this.hidden=value;}
    dispose(){this.isDisposed=true;}
  }
  const local = {exports:{}};
  vm.runInNewContext(source,{module:local,require:id=>id==='@theia/core/lib/browser/widgets'?{Widget,SplitPanel:{setStretch(){}}}:require(id),setInterval,clearInterval});
  const controls = new local.exports.WorkbenchControlsContribution({commands:f.commands,shell:f.shell,views:f.views,editors:{all:[f.editor]}});
  f.shell.node={ownerDocument:document};
  f.shell.topPanel={addWidget:widget=>widgets.set(widget.id,widget)};
  const bar={isVisible:true,node:{getBoundingClientRect:()=>({width:40,height:600})}};
  f.shell.leftPanelHandler={tabBar:bar,container:{parent:{layout:{insertWidget(index,widget){widgets.set(widget.id,widget);}}}}};
  try {
    controls.onStart();
    assert.equal(widgets.get('ynx-project-actions').hidden,false,'toolbar must survive initial refresh');
    assert.equal(widgets.get('ynx-discovery-left').hidden,true,'native rail already supplies discovery');
    bar.isVisible=false;controls.refresh();
    assert.equal(widgets.get('ynx-project-actions').hidden,false);
    assert.equal(widgets.get('ynx-discovery-left').hidden,false);
  } finally {controls.dispose();}
  assert.ok([...widgets.values()].every(widget=>widget.isDisposed));
});
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

test('VSCode Problems alias uses real CommandRegistry and repeatedly reveals the same native view',async()=>{const f=fixture();let visible=false;const widget={id:'native-problems'};f.views.problems.openView=options=>{assert.equal(options.activate,true);assert.equal(options.reveal,true);visible=true;return widget;};f.controls.registerCommands(f.commands);assert.equal(f.commands.isEnabled('workbench.actions.view.problems'),true);assert.equal(await f.commands.executeCommand('workbench.actions.view.problems'),widget);assert.equal(visible,true);assert.equal(await f.commands.executeCommand('workbench.actions.view.problems'),widget);assert.equal(visible,true);f.controls.dispose();assert.equal(f.commands.getCommand('workbench.actions.view.problems'),undefined);});
test('JavaScript menu exposes explicit official-extension current-file commands only for JavaScript', () => {
 const f=fixture(),items=[];
 f.controls.registerMenus({registerMenuAction:(path,item)=>{items.push({path,item});return{dispose(){}};}});
 const js=items.filter(x=>x.path.includes('javascript'));
 assert.deepEqual(js.map(x=>x.item.commandId),['ynx.js.runActive','ynx.js.debugActive']);
 assert.ok(js.every(x=>x.item.when==='editorLangId == javascript'));
});
test('Go menu dispatches existing project Run/Cancel commands without file or shell arguments', async () => {
 const f=fixture(),items=[];
 f.controls.registerMenus({registerMenuAction:(path,item)=>{items.push({path,item});return{dispose(){}};}});
 const go=items.filter(x=>x.path.includes('go'));
 assert.deepEqual(go.map(x=>x.item.commandId),['ynx.go.run','ynx.go.cancel']);
 assert.ok(go.every(x=>x.item.when==='editorLangId == go'));
 for(const {item} of go){
  await assert.rejects(f.controls.run(item.commandId),/Unavailable in this runtime/);
  const registration=f.commands.registerCommand({id:item.commandId},{execute:(...args)=>{assert.deepEqual(args,[]);f.calls.push(item.commandId);}});
  await f.controls.run(item.commandId);registration.dispose();
 }
 assert.deepEqual(f.calls,['ynx.go.run','ynx.go.cancel']);f.controls.dispose();
});
test('Go command registration and enablement changes refresh toolbar state',()=>{
 const f=fixture();let changed=0,enabled=true;
 f.controls.changed.event(()=>changed++);f.controls.refresh();const before=changed;
 const registration=f.commands.registerCommand({id:'ynx.go.run'},{execute(){},isEnabled:()=>enabled});
 f.controls.refresh();assert.equal(changed,before+1);enabled=false;f.controls.refresh();assert.equal(changed,before+2);
 enabled=true;f.controls.refresh();registration.dispose();f.controls.refresh();assert.equal(changed,before+4);f.controls.dispose();
});

test('Python Run menu consumes registered extension commands, respects disablement and passes no shell/file arguments', async () => {
 const f=fixture(),items=[];let enabled=false;
 f.controls.registerMenus({registerMenuAction:(path,item)=>{items.push({path,item});return{dispose(){}};}});
 const actions=items.filter(row=>row.path.includes('python'));
 assert.deepEqual(actions.map(row=>row.item.commandId),['python.execInTerminal','debugpy.debugInTerminal']);
 assert.ok(actions.every(row=>row.item.when==='editorLangId == python'));
 for(const {item} of actions) {
  await assert.rejects(f.controls.run(item.commandId),/Unavailable in this runtime/);
  const registration=f.commands.registerCommand({id:item.commandId},{execute:(...args)=>{assert.deepEqual(args,[]);f.calls.push(item.commandId);},isEnabled:()=>enabled});
  await assert.rejects(f.controls.run(item.commandId),/Currently unavailable/);
  enabled=true;await f.controls.run(item.commandId);enabled=false;registration.dispose();
 }
 assert.deepEqual(f.calls,['python.execInTerminal','debugpy.debugInTerminal']);f.controls.dispose();
});
test('Python command availability participates in toolbar refresh state',()=>{
 const f=fixture();let changed=0,enabled=true;f.controls.changed.event(()=>changed++);f.controls.refresh();const before=changed;
 const registration=f.commands.registerCommand({id:'python.execInTerminal'},{execute(){},isEnabled:()=>enabled});
 f.controls.refresh();assert.equal(changed,before+1);enabled=false;f.controls.refresh();assert.equal(changed,before+2);
 enabled=true;f.controls.refresh();registration.dispose();f.controls.refresh();assert.equal(changed,before+4);f.controls.dispose();
});
test('Python direct menu click uses installed framework dispatch once and is retired by editor change',async()=>{
 const f=popupFixture('python.execInTerminal');f.commands.registerCommand({id:'python.execInTerminal'},{execute:(...args)=>{assert.deepEqual(args,[]);f.calls.push(['python.execInTerminal']);}});
 let popup=f.open();f.down(popup);f.up(popup);f.up(popup);await Promise.all(f.pending);assert.deepEqual(f.calls,[['python.execInTerminal']]);
 popup=f.open();f.controls.editors.currentEditor={};f.controls.refresh();f.down(popup);f.up(popup);await Promise.all(f.pending);assert.equal(f.calls.length,1);f.controls.dispose();
});

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
  getContext() { return {createLinearGradient:()=>({addColorStop(){}}), fillRect(){}, measureText:t=>({width:String(t).length*8}),getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])})}; }
  focus() {} select() {} showModal() { this.open = true; } close() { this.open = false; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
}
const document = { queryCommandSupported:()=>false, createElement: tag => { const node = new Element(tag); node.ownerDocument = document; return node; }, addEventListener() {}, removeEventListener() {} };
document.body = document.createElement('body'); document.documentElement = document.createElement('html');
globalThis.Element = Element; globalThis.HTMLElement = Element; globalThis.document = document;
globalThis.DragEvent = class {};
globalThis.window = { document, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}) };
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'retained-node-test' }, configurable: true });
window.navigator = globalThis.navigator; globalThis.self=window;
require('reflect-metadata');
process.env.NODE_PATH = fileURLToPath(new URL('../node_modules', import.meta.url)); Module._initPaths();
Module._extensions['.css'] = module => {module.exports={};};
require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({applicationName:'YNX Test'});
const { PythonTerminalWidget } = require('../../ynx-workbench/lib/python-terminal-widget');

const { PythonTerminalLifecycle, COMMANDS } = require('../../ynx-workbench/lib/python-terminal-lifecycle');
const { TerminalWatcher } = require('@theia/terminal/lib/common/terminal-watcher');
const { Emitter } = require('@theia/core/lib/common/event');
const { CommandRegistry } = require('@theia/core/lib/common/command');
const URI = require('@theia/core/lib/common/uri').default;
const nativeSource = readFileSync(require.resolve('@theia/terminal/lib/browser/terminal-widget-impl'), 'utf8');
// The production callback is executed verbatim against actual retained widget,
// watcher and BaseWidget/Lumino disposal. DOM rendering alone is headless.
const start = nativeSource.indexOf('this.terminalWatcher.onTerminalExit(');
const end = nativeSource.indexOf('}));', start) + 2;
const subscribeNativeExit = Function('this.' + nativeSource.slice(start + 5, end));
function fixture(mode = 'local') {
 const created = new Emitter(), watcher = new TerminalWatcher(), widgets = new Map();
 const sessions = new Map([['one',{ configuration:{type:'debugpy',request:'launch'},options:{workspaceFolderUri:'file:///private/tmp/project'} }],['two',{configuration:{type:'debugpy',request:'launch'},options:{workspaceFolderUri:'file:///private/tmp/project'}}]]);
 const service = {onDidCreateTerminal:created.event,getById:id=>widgets.get(id)};
 const lifecycle = new PythonTerminalLifecycle({getContext:async()=>({mode,workspace:'/private/tmp/project'})},service,watcher,{getSession:id=>sessions.get(id)});
 const registry = new CommandRegistry({getContributions:()=>[]});lifecycle.registerCommands(registry);lifecycle.initialize();
 let nextId=1;
 const create = (capability,pseudo=true) => {
  const widget = new PythonTerminalWidget();widget.id='plugin-terminal-'+nextId;widget._terminalId=nextId++;
  widget.options={isPseudoTerminal:pseudo,attributes:capability?{'ynx-debug-terminal-creation':capability}:{}};
  widget.terminalWatcher=watcher;widget.shellTerminalServer={close:()=>{widget.killCalls=(widget.killCalls||0)+1;}};
  subscribeNativeExit.call(widget);widgets.set(widget.id,widget);created.fire(widget);return widget;
 };
 return {lifecycle,registry,create,watcher,sessions,widgets};
}
test('real native watcher and widget close retain actual Process exit0 and exit17 without repeated kill',async()=>{
 for(const code of [0,17]) {const f=fixture(),cap=await f.registry.executeCommand(COMMANDS.prepare,'one'),widget=f.create(cap);let close;
  widget.onTerminalDidClose(value=>close=value.exitStatus);
  await f.registry.executeCommand(COMMANDS.bind,cap,widget.id);await f.registry.executeCommand(COMMANDS.finish,cap,code);
  assert.equal(widget.isDisposed,false);assert.deepEqual(widget.exitStatus,{code,reason:2});assert.equal(close,undefined);
  widget.close();assert.equal(widget.isDisposed,true);assert.deepEqual(close,{code,reason:2});assert.equal(widget.killCalls||0,0);assert.equal(f.lifecycle.entries.size,0);f.lifecycle.onStop();
 }
});
test('two creation capabilities cannot bind old, ordinary, cross-session or repeated widgets',async()=>{
 const f=fixture(),old=f.create(undefined),a=await f.lifecycle.prepare('one'),b=await f.lifecycle.prepare('two'),ordinary=f.create(undefined),wrong=f.create(a,false),one=f.create(a),two=f.create(b);
 assert.throws(()=>f.lifecycle.bind(a,old.id),/exact creation/);assert.throws(()=>f.lifecycle.bind(a,ordinary.id),/exact creation/);assert.throws(()=>f.lifecycle.bind(a,wrong.id),/exact creation/);assert.throws(()=>f.lifecycle.bind(a,two.id),/exact creation/);
 f.lifecycle.bind(a,one.id);f.lifecycle.bind(b,two.id);assert.throws(()=>f.lifecycle.bind(a,one.id),/exact creation/);
 f.lifecycle.finish(a,0);assert.equal(two.exitStatus,undefined);assert.throws(()=>f.lifecycle.finish(a,17),/stale/);assert.throws(()=>f.lifecycle.finish(b,'0'),/invalid/);
 two.close();assert.throws(()=>f.lifecycle.finish(b,0),/stale/);assert.equal(one.isDisposed,false);one.close();ordinary.close();old.close();wrong.close();f.lifecycle.onStop();
});
test('finished session still admits its bound trailing exit, but closed/foreign/nonlocal session cannot prepare',async()=>{
 const f=fixture(),cap=await f.lifecycle.prepare('one'),widget=f.create(cap);f.lifecycle.bind(cap,widget.id);f.sessions.delete('one');f.lifecycle.finish(cap,0);assert.equal(widget.exitStatus.code,0);
 await assert.rejects(f.lifecycle.prepare('one'),/current local/);f.sessions.get('two').options.workspaceFolderUri='file:///private/tmp/foreign';await assert.rejects(f.lifecycle.prepare('two'),/current local/);widget.close();f.lifecycle.onStop();
 const hosted=fixture('hosted');await assert.rejects(hosted.lifecycle.prepare('one'),/current local/);hosted.lifecycle.onStop();
});
test('ordinary real terminal disposal retains upstream behavior; shutdown drops only owned pending UI',async()=>{
 const f=fixture(),normal=f.create(undefined),cap=await f.lifecycle.prepare('one'),pending=f.create(cap);f.lifecycle.bind(cap,pending.id);
 let normalClose;normal.onTerminalDidClose(widget=>normalClose=widget.exitStatus);normal.dispose();assert.equal(normal.killCalls,1);assert.deepEqual(normalClose,{code:undefined,reason:4});
 f.lifecycle.onStop();assert.equal(pending.isDisposed,true);assert.equal(f.lifecycle.entries.size,0);assert.throws(()=>f.lifecycle.finish(cap,0),/stale/);
});

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
  get childNodes() { return this.children; }
  get parentNode() { return this.parentElement; }
  insertBefore(node, ref) { node.parentElement?.removeChild(node); const i=this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i,0,node); node.parentElement=this; return node; }
  removeChild(node) { this.children=this.children.filter(x=>x!==node); node.parentElement=undefined; return node; }
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

const { BaseWidget, PanelLayout, Widget } = require('@theia/core/lib/browser/widgets');
const { Emitter } = require('@theia/core/lib/common/event');
const { MessageLoop } = require('@theia/core/shared/@lumino/messaging');
const { TERMINAL_PANEL_ID, createTerminalPanelClass, TerminalPanelHandler } = require('../../ynx-workbench/lib/terminal-panel');
const TerminalPanel = createTerminalPanelClass({ BaseWidget, PanelLayout, Widget, Emitter });
function terminal(id) { const widget = new BaseWidget(); widget.id = id; widget.title.label = id; widget.location = 1; widget.focuses = 0; widget.onActivateRequest = () => widget.focuses++; return widget; }
test('real Lumino children keep identity, switch focus, retain output and retire disposed selection', () => {
 const panel = new TerminalPanel(), one = terminal('terminal-one'), two = terminal('terminal-two');
 one.output = 'first output'; two.output = 'second output';
 panel.addTerminal(one); panel.addTerminal(two); panel.addTerminal(one);
 assert.equal(one.parent, panel); assert.equal(two.parent, panel); assert.equal(panel.getTrackableWidgets().length, 2);
 assert.equal(two.isHidden, true); panel.activateWidget(two.id); MessageLoop.flush();
 assert.equal(one.isHidden, true); assert.equal(two.isHidden, false); assert.equal(two.focuses, 1); assert.equal(one.output, 'first output');
 two.title.label = 'Run JavaScript File'; assert.equal(panel.selector.children[1].textContent, 'Run JavaScript File');
 two.dispose(); assert.equal(panel.selected, one); assert.equal(one.isHidden, false); assert.equal(panel.getTrackableWidgets().length, 1);
 panel.dispose();
});
test('layout persistence stores genuine nested widgets and selected terminal', () => {
 const panel = new TerminalPanel(), one = terminal('terminal-first'), two = terminal('terminal-second'); panel.addTerminal(one); panel.addTerminal(two); panel.revealWidget(two.id);
 const state = panel.storeState(); assert.equal(state.widgets[0], one); assert.equal(state.activeId, two.id);
 const restored = new TerminalPanel(); restored.restoreState(state); assert.equal(restored.selected, two); assert.equal(two.parent, restored); restored.dispose(); panel.dispose();
});
test('canonical handler consolidates concurrent runs without reusing PTY or widening explicit placements', async () => {
 const panel = new TerminalPanel(), shellCalls = [], shell = {addWidget(w,o){shellCalls.push(['add',w,o]);Object.defineProperty(w,'isAttached',{value:true,configurable:true});},activateWidget:async id=>{shellCalls.push(['activate',id]);panel.activateWidget(id);},revealWidget:async id=>{shellCalls.push(['reveal',id]);panel.revealWidget(id);}};
 let factories = 0; const manager = { getOrCreateWidget:async id=>{assert.equal(id,TERMINAL_PANEL_ID);factories++;return panel;} };
 const handler = new TerminalPanelHandler(shell,manager), one=terminal('terminal-a'),two=terminal('terminal-b');
 await Promise.all([handler.onWillOpenTerminal(one),handler.onWillOpenTerminal(two)]);
 assert.equal(shellCalls.filter(c=>c[0]==='add').length,1); assert.equal(panel.getTrackableWidgets().length,2); assert.equal(panel.selected,two);
 for (const location of [2,{parentTerminal:one.id},{viewColumn:1}]) { const t=terminal('excluded'); t.location=location; assert.equal(await handler.onWillOpenTerminal(t),false); t.dispose(); }
 assert.equal(await handler.onWillOpenTerminal(terminal('main'),{widgetOptions:{area:'main'}}),false);
 assert.equal(await handler.onWillOpenTerminal(terminal('split'),{widgetOptions:{mode:'split-right'}}),false);
 const attached=terminal('legacy');Object.defineProperty(attached,'isAttached',{value:true,configurable:true});assert.equal(await handler.onWillOpenTerminal(attached),false);delete attached.isAttached;attached.dispose();
 const dead=terminal('dead');dead.dispose();assert.equal(await handler.onWillOpenTerminal(dead),true);assert.equal(factories,2);delete panel.isAttached;panel.dispose();
});
test('completion during asynchronous factory acquisition cannot attach a disposed terminal',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),panel=new TerminalPanel(),t=terminal('cancelled');const handler=new TerminalPanelHandler({addWidget(){assert.fail('attached');}},{getOrCreateWidget:()=>pending});
 const open=handler.onWillOpenTerminal(t);t.dispose();resolve(panel);assert.equal(await open,true);assert.equal(panel.getTrackableWidgets().length,0);panel.dispose();
});
const { TerminalFrontendContribution } = require('@theia/terminal/lib/browser/terminal-frontend-contribution');
const { TerminalShellHandler } = require('@theia/terminal/lib/browser/terminal-shell-handler');
function dispatchFixture(manager) {
 const calls = [], shell = { addWidget:(w,o)=>calls.push(['add',w.id,o.area]), activateWidget:id=>calls.push(['activate',id]), revealWidget:id=>calls.push(['reveal',id]), getWidgets:()=>[] };
 const grouped = new TerminalPanelHandler(shell, manager), fallback = new TerminalShellHandler();
 fallback.shell = shell; fallback.terminalService = { getById:()=>undefined };
 return { calls, open:(w,o)=>TerminalFrontendContribution.prototype.open.call({terminalCreationHandlers:{getContributions:()=>[fallback,grouped]}},w,o) };
}
for(const during of [false,true]) test('real handler dispatch consumes retirement '+(during?'during deferred creation':'before creation')+', never invokes shell fallback',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r),panel=new TerminalPanel(),t=terminal('retired-chain');
  const f=dispatchFixture({getOrCreateWidget:()=>pending});
  if(!during)t.dispose();const run=f.open(t);if(during)t.dispose();resolve(panel);await run;
  assert.deepEqual(f.calls,[],during?'disposed during factory wait reached fallback':'initial disposed reached fallback');
  assert.equal(panel.getTrackableWidgets().length,0);panel.dispose();
});
test('real handler dispatch preserves live explicit editor and split fallback',async()=>{
 const f=dispatchFixture({getOrCreateWidget:()=>assert.fail('explicit terminal acquired panel')});
 const editor=terminal('editor-chain');editor.location=2;await f.open(editor);
 assert.deepEqual(f.calls.slice(0,2),[['add','editor-chain','main'],['activate','editor-chain']]);
 const split=terminal('split-chain');split.location={parentTerminal:'parent'};await f.open(split);
 assert.deepEqual(f.calls.slice(2),[['add','split-chain','bottom'],['activate','split-chain']]);editor.dispose();split.dispose();
});

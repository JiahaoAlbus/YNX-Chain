// Test-only rendering boundaries; production never imports this module.
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, copyFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pythonTerminalCreationPlugin } from './python-terminal-creation-build.mjs';
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

export const { PythonTerminalWidget } = require('../../ynx-workbench/lib/python-terminal-widget');
export const { PythonTerminalLifecycle } = require('../../ynx-workbench/lib/python-terminal-lifecycle');
export const { TerminalWatcher } = require('@theia/terminal/lib/common/terminal-watcher');
export const { CommandRegistry } = require('@theia/core/lib/common/command');
export const { Emitter } = require('@theia/core/lib/common/event');
const nativeSource = readFileSync(require.resolve('@theia/terminal/lib/browser/terminal-widget-impl'), 'utf8');
const start = nativeSource.indexOf('this.terminalWatcher.onTerminalExit(');
const end = nativeSource.indexOf('}));', start) + 2;
export const subscribeNativeExit = Function('this.' + nativeSource.slice(start + 5, end));
export async function compilePythonTerminalHost() {
 const root=await mkdtemp('/private/tmp/ynx-python-terminal-host-'),outdir=join(root,'lib/backend');await mkdir(outdir,{recursive:true});
 for(const name of ['python-terminal-creation','plugin-vscode-init-adapter']) await copyFile(new URL('../../ynx-workbench/lib/'+name+'.js',import.meta.url),join(outdir,name+'.js'));
 await require('esbuild').build({entryPoints:{'plugin-host':require.resolve('@theia/plugin-ext/lib/plugin/terminal-ext')},bundle:true,platform:'node',format:'cjs',outdir,
 plugins:[pythonTerminalCreationPlugin(),{name:'retained-test-boundaries',setup(build){build.onResolve({filter:/.*/},args=>{if(args.importer)return{path:createRequire(args.importer).resolve(args.path),external:true};});}}]});
 const source=await readFile(require.resolve('@theia/plugin-ext/lib/main/browser/terminal-main'),'utf8');
 const method=source.slice(source.indexOf('    async $createTerminal('),source.indexOf('    getTerminalLocation('));
 const main=Function('return ({'+method.trim()+'})')();
 return { ...require(join(outdir,'plugin-host.js')), ...require(join(outdir,'plugin-vscode-init-adapter.js')), main, root };
}

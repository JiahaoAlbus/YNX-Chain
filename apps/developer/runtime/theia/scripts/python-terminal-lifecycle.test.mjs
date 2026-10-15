import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { EventEmitter as NodeEmitter } from 'node:events';
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
test('official current-file Python command may omit folder but must resolve inside the admitted project',async()=>{
 const f=fixture(),session=f.sessions.get('one');
 session.options.workspaceFolderUri=undefined;
 session.configuration.program='/private/tmp/project/hello.py';
 const capability=await f.lifecycle.prepare('one');assert.ok(capability);f.lifecycle.abandon(capability);
 for(const program of ['/private/tmp/project-other/hello.py','/private/tmp/project/../foreign/hello.py','hello.py']) {
  session.configuration.program=program;await assert.rejects(f.lifecycle.prepare('one'),/current local/);
 }
 session.configuration.program='/private/tmp/project/hello.py';session.configuration.cwd='/private/tmp/foreign';
 await assert.rejects(f.lifecycle.prepare('one'),/current local/);
 session.configuration.cwd='/private/tmp/project';session.options.workspaceFolderUri='file:///private/tmp/foreign';
 await assert.rejects(f.lifecycle.prepare('one'),/current local/);f.lifecycle.onStop();
});
test('ordinary real terminal disposal retains upstream behavior; shutdown drops only owned pending UI',async()=>{
 const f=fixture(),normal=f.create(undefined),cap=await f.lifecycle.prepare('one'),pending=f.create(cap);f.lifecycle.bind(cap,pending.id);
 let normalClose;normal.onTerminalDidClose(widget=>normalClose=widget.exitStatus);normal.dispose();assert.equal(normal.killCalls,1);assert.deepEqual(normalClose,{code:undefined,reason:4});
 f.lifecycle.onStop();assert.equal(pending.isDisposed,true);assert.equal(f.lifecycle.entries.size,0);assert.throws(()=>f.lifecycle.finish(cap,0),/stale/);
});

// TEST_ONLY transport/command scheduling, with the actual production adapter
// and its owned creation helper. This is not native Python or GUI acceptance.
async function asyncPythonAdapterFixture(options={}) {
 const helper=require('../../ynx-workbench/lib/python-terminal-creation');helper.registerCompiledCreationContract(helper.CONTRACT);
 const sockets=[],factories=new Map(),calls=[],errors=[],events=new Emitter();let sessionNumber=0;
 const socketFactory=()=>{const socket=new NodeEmitter();socket.destroyed=false;socket.setEncoding=()=>{};socket.write=raw=>{const message=JSON.parse(raw);calls.push({id:message.op,socket});if(message.op==='start')queueMicrotask(()=>socket.emit('data',JSON.stringify({kind:'ready'})+'\n'));};socket.end=()=>{socket.destroyed=true;};sockets.push(socket);queueMicrotask(()=>socket.emit('connect'));return socket;};
 const api={EventEmitter:Emitter,DebugAdapterInlineImplementation:class{constructor(value){Object.assign(this,value);}},debug:{registerDebugAdapterDescriptorFactory(type,factory){factories.set(type,factory);return{dispose(){}};},onDidTerminateDebugSession(listener){options.onListener?.(1);const d=events.event(listener);let disposed=false;return{dispose(){if(!disposed){disposed=true;d.dispose();options.onListener?.(-1);}}};}},commands:{executeCommand(id,...args){calls.push({id,args});return options.command?.(id,args)??Promise.resolve(true);}},window:{createTerminal(input){helper.takeCreationAttributes(input);calls.push({id:'createTerminal'});const terminal={id:{promise:options.idPromise??Promise.resolve('OWNED_TERMINAL')},show(){calls.push({id:'showTerminal'});}};return terminal;}}};
 const module={exports:{}},source=readFileSync(new URL('../../ynx-workbench/lib/plugin-vscode-init-adapter.js',import.meta.url),'utf8');
 vm.runInNewContext(source,{module,exports:module.exports,require:id=>id==='node:net'?{connect:socketFactory}:id==='./python-terminal-creation'?helper:require(id),process,Buffer,setTimeout,clearTimeout,console:{error:(...args)=>errors.push(args)}});
 module.exports.adaptLocalDebugging(api,{YNX_WORKSPACE_MODE:'local',YNX_DEBUG_SOCKET:'/TEST_ONLY/debug.sock',YNX_DEBUG_CREDENTIAL:'a'.repeat(64),YNX_DEBUG_PROJECT:'TEST_ONLY',YNX_LOCAL_PROJECT_ID:'TEST_ONLY'});
 api.debug.registerDebugAdapterDescriptorFactory('debugpy',{createDebugAdapterDescriptor:options.factory||(async()=>({command:'/TEST_ONLY/python',args:[]}))});
 const open=async()=>{const session={id:'OWNED_SESSION_'+(++sessionNumber),configuration:{type:'debugpy',request:'launch',console:'integratedTerminal'}},adapter=await factories.get('debugpy').createDebugAdapterDescriptor(session);return {session,adapter,socket:sockets.at(-1),request(){this.socket.emit('data',JSON.stringify({kind:'dap',message:{type:'request',seq:1,command:'runInTerminal',arguments:{kind:'integrated'}}})+'\n');},cancel(){events.fire(session);}};};
 return{open,calls,errors,factories,events,sockets,dispose(){for(const socket of sockets)socket.end();events.dispose();}};
}
const flushPythonCallbacks=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};

test('cancelled Python late terminal preparation cannot create or show a Running widget',async()=>{
 let reply,entered;const preparing=new Promise(resolve=>entered=resolve),capability='11111111-1111-4111-8111-111111111111';
 const f=await asyncPythonAdapterFixture({command(id){if(id===COMMANDS.prepare){entered();return new Promise(resolve=>reply=resolve);}}});
 try{const run=await f.open();run.request();await preparing;run.cancel();reply(capability);await flushPythonCallbacks();
  assert.equal(f.calls.some(x=>x.id==='createTerminal'),false);assert.equal(f.calls.some(x=>x.id==='showTerminal'),false);
  assert.deepEqual(f.calls.filter(x=>x.id===COMMANDS.abandon).map(x=>x.args),[[capability]]);
 }finally{f.dispose();}
});

test('Python cancellation during terminal identity resolution cannot bind or show its old widget',async()=>{
 let reply;const identity=new Promise(resolve=>reply=resolve),cap='22222222-2222-4222-8222-222222222222';
 const f=await asyncPythonAdapterFixture({idPromise:identity,command:id=>id===COMMANDS.prepare?Promise.resolve(cap):undefined});
 try{const run=await f.open();run.request();await flushPythonCallbacks();assert.equal(f.calls.filter(x=>x.id==='createTerminal').length,1);run.cancel();reply('OLD_TERMINAL');await flushPythonCallbacks();
  assert.equal(f.calls.some(x=>x.id===COMMANDS.bind),false);assert.equal(f.calls.some(x=>x.id==='showTerminal'),false);assert.deepEqual(f.calls.filter(x=>x.id===COMMANDS.abandon).map(x=>x.args),[[cap]]);
 }finally{f.dispose();}
});

test('Python cancellation during bind ignores queued data and exit without completing another run',async()=>{
 let reply,entered;const binding=new Promise(resolve=>entered=resolve),cap='33333333-3333-4333-8333-333333333333';
 const f=await asyncPythonAdapterFixture({command(id){if(id===COMMANDS.prepare)return Promise.resolve(cap);if(id===COMMANDS.bind){entered();return new Promise(resolve=>reply=resolve);}}});
 try{const old=await f.open();old.request();await binding;
  old.socket.emit('data',JSON.stringify({kind:'terminalData',data:'obsolete output'})+'\n'+JSON.stringify({kind:'terminalExit',exitCode:0})+'\n');
  old.cancel();const newer=await f.open();const messages=[];newer.adapter.onDidSendMessage(m=>messages.push(m));reply(true);await flushPythonCallbacks();
  assert.equal(f.calls.some(x=>x.id==='showTerminal'),false);assert.equal(f.calls.some(x=>x.id===COMMANDS.finish),false);assert.deepEqual(messages,[]);assert.equal(newer.socket.destroyed,false);
  assert.deepEqual(f.calls.filter(x=>x.id===COMMANDS.abandon).map(x=>x.args),[[cap]]);newer.cancel();
 }finally{f.dispose();}
});

test('Python graceful debugger termination still drains real terminal tail and its exit status',async()=>{
 const cap='44444444-4444-4444-8444-444444444444';const f=await asyncPythonAdapterFixture({command:id=>id===COMMANDS.prepare?Promise.resolve(cap):undefined});
 try{const run=await f.open();const messages=[];run.adapter.onDidSendMessage(m=>messages.push(m));run.request();await flushPythonCallbacks();assert.equal(f.calls.filter(x=>x.id==='showTerminal').length,1);
  run.socket.emit('data',JSON.stringify({kind:'dap',message:{type:'event',seq:0,event:'terminated'}})+'\n'+JSON.stringify({kind:'terminalData',data:'final output'})+'\n'+JSON.stringify({kind:'terminalExit',exitCode:17})+'\n');await flushPythonCallbacks();
  assert.deepEqual(f.calls.filter(x=>x.id===COMMANDS.finish).map(x=>x.args),[[cap,17]]);assert.ok(messages.some(x=>x.event==='terminated'));run.adapter.dispose();
  assert.equal(f.calls.some(x=>x.id===COMMANDS.abandon),false);
 }finally{f.dispose();}
});

test('late Python prepare UNKNOWN is retained as the original error without affecting a newer session',async()=>{
 let reject,entered;const preparing=new Promise(resolve=>entered=resolve),unknown=Object.assign(Error('original prepare outcome UNKNOWN'),{code:'UNKNOWN'});
 const f=await asyncPythonAdapterFixture({command(id){if(id===COMMANDS.prepare){entered();return new Promise((_,bad)=>reject=bad);}}});
 try{const old=await f.open();old.request();await preparing;old.cancel();const newer=await f.open(),messages=[];newer.adapter.onDidSendMessage(m=>messages.push(m));reject(unknown);await flushPythonCallbacks();
  assert.ok(f.errors.some(args=>args.includes(unknown)));assert.deepEqual(messages,[]);assert.equal(newer.socket.destroyed,false);assert.equal(f.calls.some(x=>x.id==='createTerminal'),false);newer.cancel();
 }finally{f.dispose();}
});

test('late Python creation cleanup UNKNOWN is retained and is not retried or reported as process success',async()=>{
 let reply,entered;const preparing=new Promise(resolve=>entered=resolve),unknown=Object.assign(Error('original abandonment UNKNOWN'),{code:'UNKNOWN'}),cap='55555555-5555-4555-8555-555555555555';
 const f=await asyncPythonAdapterFixture({command(id){if(id===COMMANDS.prepare){entered();return new Promise(resolve=>reply=resolve);}if(id===COMMANDS.abandon)return Promise.reject(unknown);}});
 try{const run=await f.open();run.request();await preparing;run.cancel();reply(cap);await flushPythonCallbacks();run.adapter.dispose();await flushPythonCallbacks();
  assert.ok(f.errors.some(args=>args.includes(unknown)));assert.equal(f.calls.filter(x=>x.id===COMMANDS.abandon).length,1);assert.equal(f.calls.some(x=>x.id==='createTerminal'||x.id===COMMANDS.finish),false);
 }finally{f.dispose();}
});

function r43Deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function r43Fixture(factory){
 let listeners=0;
 const f=await asyncPythonAdapterFixture({factory,onListener(delta){listeners+=delta;}});
 const session={id:'R43_OWNED_SESSION',configuration:{type:'debugpy',request:'launch',console:'integratedTerminal'}};
 return{...f,session,get listeners(){return listeners;},start(){return f.factories.get('debugpy').createDebugAdapterDescriptor(session);}};
}
test('R43 cancelled session during official factory await never starts late supervisor socket',async()=>{
 const gate=r43Deferred(),f=await r43Fixture(()=>gate.promise);let adapter;
 try{const pending=f.start();const failed=assert.rejects(pending,/cancelled/);f.events.fire(f.session);gate.resolve({command:'/TEST_ONLY/python',args:[]});await failed;assert.equal(f.sockets.length,0);assert.equal(f.listeners,0);}
 finally{adapter?.dispose();f.dispose();}
});
test('R43 unrelated termination preserves normal launch then exact termination cleans listener',async()=>{
 const gate=r43Deferred(),f=await r43Fixture(()=>gate.promise);let adapter;
 try{const pending=f.start();assert.equal(f.listeners,1);f.events.fire({id:'OTHER_SESSION'});gate.resolve({command:'/TEST_ONLY/python',args:[]});adapter=await pending;assert.equal(f.sockets.length,1);assert.equal(f.listeners,1);f.events.fire(f.session);assert.equal(f.sockets[0].destroyed,true);assert.equal(f.listeners,0);}
 finally{adapter?.dispose();f.dispose();}
});
test('R43 attach returns exact official descriptor without supervisor or retained listener',async()=>{
 const descriptor={command:'/TEST_ONLY/attach',args:[]},f=await r43Fixture(async()=>descriptor);f.session.configuration.request='attach';
 try{assert.equal(await f.start(),descriptor);assert.equal(f.sockets.length,0);assert.equal(f.listeners,0);}finally{f.dispose();}
});
for(const kind of ['rejected-after-cancel','synchronous-throw']){
 test('R43 '+kind+' preserves original factory failure and releases listener',async()=>{
  const gate=r43Deferred(),error=Error('TEST_ONLY_ORIGINAL_FACTORY_FAILURE'),f=await r43Fixture(()=>{if(kind==='synchronous-throw')throw error;return gate.promise;});
  try{const pending=f.start(),failed=assert.rejects(pending,e=>e===error);if(kind==='rejected-after-cancel'){f.events.fire(f.session);gate.reject(error);}await failed;assert.equal(f.sockets.length,0);assert.equal(f.listeners,0);}finally{f.dispose();}
 });
}
test('R43 malformed official launch descriptor rejects without leaking observer',async()=>{
 const f=await r43Fixture(async()=>({command:'/TEST_ONLY/python'}));
 try{await assert.rejects(f.start(),/reviewed debugpy executable/);assert.equal(f.sockets.length,0);assert.equal(f.listeners,0);}finally{f.dispose();}
});
test('R43 normal launch and explicit adapter disposal release exact listener once',async()=>{
 const f=await r43Fixture(async()=>({command:'/TEST_ONLY/python',args:[]}));let adapter;
 try{adapter=await f.start();assert.equal(f.sockets.length,1);assert.equal(f.listeners,1);adapter.dispose();adapter.dispose();assert.equal(f.sockets[0].destroyed,true);assert.equal(f.listeners,0);}finally{adapter?.dispose();f.dispose();}
});

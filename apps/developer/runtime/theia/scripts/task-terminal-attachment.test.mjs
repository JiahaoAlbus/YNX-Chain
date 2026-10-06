import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {installOn}=require('../../ynx-workbench/lib/task-terminal-attachment');
const {BaseTerminalServer}=require('@theia/terminal/lib/node/base-terminal-server');
const {TaskTerminalProcess}=require('@theia/process/lib/node/task-terminal-process');
const {MultiRingBuffer}=require('@theia/process/lib/node/multi-ring-buffer');
const source=await readFile(require.resolve('@theia/terminal/lib/browser/terminal-widget-impl'),'utf8');
const begin=source.indexOf('    async start(id) {'),end=source.indexOf('    async attachTerminal(',begin);
const actualStart=vm.runInNewContext('({'+source.slice(begin,end)+'})',{base_terminal_protocol_1:require('@theia/terminal/lib/common/base-terminal-protocol')}).start;
function fixture({patch=true,connect=true,kind='task',timeout=100}={}) {
 const records=new Map(),terminal=Object.create(TaskTerminalProcess.prototype),ring=new MultiRingBuffer({size:4096}),events=[];
 terminal.id=17;terminal.exited=true;terminal.unregisterProcess=()=>{events.push('unregister');records.delete(17);};ring.enq('Hello C++ 42\r\n');terminal.createOutputStream=()=>ring.getStream();records.set(17,terminal);
 const server=new BaseTerminalServer({get:id=>records.get(id),onDelete:()=>({dispose(){}})},{warn(){}});
 class Widget{}Widget.prototype.start=actualStart;if(patch)installOn(Widget.prototype,timeout);
 const widget=new Widget(),listeners=new Set();let open;
 Object.assign(widget,{kind,options:{},shellTerminalServer:server,get terminalId(){return this._terminalId;},resizeTerminalProcess(){},attachTerminal:id=>server.attach(id),onDidOpenEmitter:{fire(){}},onDidOpenFailureEmitter:{fire(){}},onDidDispose:fn=>{listeners.add(fn);return{dispose:()=>listeners.delete(fn)};},connectTerminalProcess(){this.waitForConnection={promise:new Promise(resolve=>{open=()=>{const process=records.get(17);if(process){const stream=process.createOutputStream();stream.on('data',chunk=>events.push(String(chunk)));}resolve();};})};if(connect)setTimeout(()=>open(),10);}});
 Object.defineProperty(widget,'terminalId',{get(){return this._terminalId;}});
 return{widget,events,records,close(){widget.isDisposed=true;for(const fn of listeners)fn();},open:()=>open()};
}
test('actual framework start loses short-task ring before delayed channel without guard; guard delivers it before release',async()=>{
 const old=fixture({patch:false});await old.widget.start(17);await new Promise(r=>setTimeout(r,30));assert.deepEqual(old.events,['unregister']);
 const fixed=fixture();await fixed.widget.start(17);await new Promise(r=>setTimeout(r,30));assert.ok(fixed.events.includes('Hello C++ 42\r\n'));assert.equal(fixed.records.size,0);
});
test('task connection timeout and terminal disposal reject and release retained exited task',async()=>{
 const timeout=fixture({connect:false,timeout:10});await assert.rejects(timeout.widget.start(17),/timed out/);assert.equal(timeout.records.size,0);
 const closed=fixture({connect:false});const pending=closed.widget.start(17);await Promise.resolve();closed.close();await assert.rejects(pending,/closed/);assert.equal(closed.records.size,0);
});
test('interactive shell preserves original immediate attachment behavior',async()=>{
 const f=fixture({kind:'user',connect:false});await f.widget.start(17);assert.deepEqual(f.events,['unregister']);
});

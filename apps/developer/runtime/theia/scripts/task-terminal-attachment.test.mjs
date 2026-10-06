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
test("interactive and debug shells wait for connection; existing attachment timeout does not close process",async()=>{for(const kind of ["user","debug"]){const f=fixture({kind,connect:false,timeout:10});let closes=0;f.widget.shellTerminalServer.close=async()=>{closes++;};await assert.rejects(f.widget.start(17),/timed out/);assert.equal(closes,0);const good=fixture({kind});await good.widget.start(17);assert.ok(good.events.includes("Hello C++ 42\r\n"));}});
test('new shell timeout closes only own process and late connection cannot continue run',async()=>{
 const f=fixture({kind:'debug',connect:false,timeout:10});let closes=[],runs=0;const output=[];
 f.widget.createTerminal=async()=>17;f.widget.shellTerminalServer.close=async id=>{closes.push(id);};f.widget.writeLine=text=>output.push(text);
 await assert.rejects(f.widget.start().then(()=>{runs++;}),/timed out/);
 f.open();await Promise.resolve();assert.equal(runs,0);assert.deepEqual(closes,[17]);assert.match(output[0],/retry/);
});
test('failure notification dismissal never blocks rejection or cleanup',async()=>{
 const {setNotification}=require('../../ynx-workbench/lib/task-terminal-attachment');let notices=0;
 setNotification(()=>{notices++;return new Promise(()=>{});});
 try{const f=fixture({kind:'user',connect:false,timeout:10});await assert.rejects(f.widget.start(17),/timed out/);assert.equal(notices,1);}finally{setNotification(()=>{});}
});
test('real listen open failure reaches Deferred; late successful channel closes without handler',async()=>{
 const {Deferred}=require('@theia/core/lib/common/promise-util');
 for(const late of [false,true]){
  const f=fixture({kind:'debug',connect:false,timeout:10});let handler,closed=0,handled=0;
  f.widget.connectionProvider={openChannel:async(_path,fn)=>{if(!late)throw Error('channel already open');handler=fn;},listen(){throw Error('not used');}};
  f.widget.connectTerminalProcess=function(){this.waitForConnection=new Deferred();this.connectionProvider.listen('/services/terminals/17',()=>{handled++;this.waitForConnection.resolve();},false);};
  await assert.rejects(f.widget.start(17),late?/timed out/:/channel already open/);
  if(late)handler('/services/terminals/17',{close(){closed++;}});
  assert.equal(handled,0);assert.equal(closed,late?1:0);
 }
});
test('old open rejection cannot reject replacement start Deferred',async()=>{
 const {Deferred}=require('@theia/core/lib/common/promise-util');const f=fixture({kind:'user',connect:false,timeout:10});let rejectOld;let attempt=0;
 f.widget.connectionProvider={openChannel:(_path,handler)=>++attempt===1?new Promise((_r,reject)=>{rejectOld=reject;}):Promise.resolve().then(()=>handler('/services/terminals/17',{close(){}}))};
 f.widget.connectTerminalProcess=function(){this.waitForConnection=new Deferred();this.connectionProvider.listen('/services/terminals/17',()=>this.waitForConnection.resolve(),false);};
 await assert.rejects(f.widget.start(17),/timed out/);f.widget.attachTerminal=async()=>17;const next=f.widget.start(17);rejectOld(Error('late old failure'));await next;assert.equal(attempt,2);
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('overlapping real starts restore original services and preserve order',async()=>{
 const f=fixture({kind:'user'}),creates=[];const server=f.widget.shellTerminalServer,provider={openChannel:async()=>{}};f.widget.connectionProvider=provider;
 f.widget.createTerminal=()=>new Promise(resolve=>creates.push(resolve));
 const first=f.widget.start(),second=f.widget.start();await flush();assert.equal(creates.length,1);
 creates[0](17);await first;await flush();assert.equal(creates.length,2);creates[1](18);await second;
 assert.equal(f.widget.shellTerminalServer,server);assert.equal(f.widget.connectionProvider,provider);assert.equal(f.widget.terminalId,18);
});
test('failed first real start does not block queued retry',async()=>{
 const f=fixture({kind:'user'});let attempts=0;
 f.widget.createTerminal=async()=>{if(++attempts===1)throw Error('creation failed');return 17;};
 const first=f.widget.start(),second=f.widget.start();await assert.rejects(first,/creation failed/);await second;assert.equal(attempts,2);
});
test('disposed queued start never creates another process; widgets remain independent',async()=>{
 const a=fixture({kind:'user'}),b=fixture({kind:'user'});let releaseA,releaseB,countA=0,countB=0;
 a.widget.createTerminal=()=>{countA++;return new Promise(resolve=>{releaseA=resolve;});};
 b.widget.createTerminal=()=>{countB++;return new Promise(resolve=>{releaseB=resolve;});};
 a.widget.shellTerminalServer.close=async()=>{};
 const first=a.widget.start(),queued=a.widget.start(),other=b.widget.start();
 const rejectedFirst=assert.rejects(first,/closed/),rejectedQueued=assert.rejects(queued,/closed/);
 await flush();assert.equal(countA,1);assert.equal(countB,1);a.close();releaseA(17);releaseB(17);
 await Promise.all([rejectedFirst,rejectedQueued,other]);assert.equal(countA,1);
});
test('first start retains synchronous creation; immediate dispose prevents queued creation',async()=>{
 const f=fixture({kind:'user'});let count=0,release;f.widget.createTerminal=()=>{count++;return new Promise(resolve=>{release=resolve;});};f.widget.shellTerminalServer.close=async()=>{};
 const first=f.widget.start();assert.equal(count,1);const queued=f.widget.start();f.close();
 const rejectedFirst=assert.rejects(first,/closed/),rejectedQueued=assert.rejects(queued,/closed/);release(17);
 await Promise.all([rejectedFirst,rejectedQueued]);assert.equal(count,1);
});
const sendBegin=source.indexOf('    sendText(text) {'),sendEnd=source.indexOf('    async executeCommand(',sendBegin);
const actualSendText=vm.runInNewContext('({'+source.slice(sendBegin,sendEnd)+'})').sendText;
function textFixture(){class Widget{}Widget.prototype.start=async()=>{};Widget.prototype.sendText=actualSendText;installOn(Widget.prototype);const widget=new Widget();widget.options={};return widget;}
test('actual sendText negative control rejects derived promise unhandled',async()=>{
 const{spawnSync}=await import('node:child_process');
 const code=`const send=(${actualSendText.toString().replace('sendText(text)', 'function(text)')});let reject;const promise=new Promise((_r,r)=>reject=r);promise.catch(()=>{});process.once('unhandledRejection',()=>console.log('EXPECTED_UNHANDLED'));send.call({waitForConnection:{promise}},'fixture');reject(Error('failure'));setTimeout(()=>{},10);`;
 const result=spawnSync(process.execPath,['-e',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/EXPECTED_UNHANDLED/);
});
test('owned sendText writes once, handles rejection and discards stale/disposed connection text',async()=>{
 const{Deferred}=require('@theia/core/lib/common/promise-util');const sent=[];const channel={getWriteBuffer:()=>({writeString(text){sent.push(text);return this;},commit(){}})};
 const a=textFixture(),b=textFixture();a.waitForConnection=new Deferred();assert.equal(a.sendText('once'),undefined);a.waitForConnection.resolve(channel);await flush();assert.deepEqual(sent,['once']);
 a.waitForConnection=new Deferred();a.sendText('failed');a.waitForConnection.reject(Error('failure'));await flush();assert.deepEqual(sent,['once']);
 const old=a.waitForConnection=new Deferred();a.sendText('stale');a.waitForConnection=new Deferred();old.resolve(channel);await flush();assert.deepEqual(sent,['once']);
 a.sendText('disposed');a.isDisposed=true;a.waitForConnection.resolve(channel);b.waitForConnection=new Deferred();b.sendText('other-widget');b.waitForConnection.resolve(channel);await flush();assert.deepEqual(sent,['once','other-widget']);
});
test('pseudo terminal keeps exact original send behavior',async()=>{
 const widget=textFixture();widget.options.isPseudoTerminal=true;let sent;widget.waitForConnection={promise:Promise.resolve({getWriteBuffer:()=>({writeString(text){sent=text;return this;},commit(){}})})};assert.equal(widget.sendText('pseudo'),undefined);await flush();assert.equal(sent,'pseudo');
});
test('timed-out start never sends its pending text when channel arrives late',async()=>{
 const{Deferred}=require('@theia/core/lib/common/promise-util');class Widget{}Widget.prototype.start=actualStart;Widget.prototype.sendText=actualSendText;installOn(Widget.prototype,10);
 const w=new Widget();let pending,writes=0;Object.assign(w,{options:{},kind:'user',createTerminal:async()=>17,resizeTerminalProcess(){},connectTerminalProcess(){pending=this.waitForConnection=new Deferred();},shellTerminalServer:{onAttachAttempted:async()=>{},close:async()=>{}},onDidOpenEmitter:{fire(){w.sendText('must-not-replay');}},onDidOpenFailureEmitter:{fire(){}}});Object.defineProperty(w,'terminalId',{get(){return this._terminalId;}});
 await assert.rejects(w.start(),/timed out/);pending.resolve({getWriteBuffer(){writes++;return{writeString(){return this;},commit(){}};}});await flush();assert.equal(writes,0);
});

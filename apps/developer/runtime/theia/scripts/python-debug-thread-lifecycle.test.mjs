import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
await import('./python-terminal-test-fixture.mjs');
window.location={href:'http://127.0.0.1:43119'};globalThis.UIEvent=class{};
const hook=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const require=createRequire(import.meta.url),{DebugSession}=require('@theia/debug/lib/browser/debug-session');hook.deregister();
const {Emitter}=require('@theia/core/lib/common/event');
const {PythonTerminalLifecycle}=require('../../ynx-workbench/lib/python-terminal-lifecycle');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture({mode='local',type='debugpy'}={}) {
 const session=new DebugSession(),events=new Map(),errors=[],requests=[];
 session.data={id:'session',options:{configuration:{type,request:'launch',program:'/project/hello.py'},workspaceFolderUri:'file:///project'}};
 // A normally initialized session owns connection subscriptions. Keep the
 // real DisposableCollection nonempty while this fixture isolates thread IO.
 session.toDispose.push({dispose(){}});
 session.updateCurrentThread=()=>{};
 session.logger={error:(...args)=>errors.push(args)};
 session.connection={on:(name,listener)=>{let event=events.get(name);if(!event)events.set(name,event=new Emitter());return event.event(listener);}};
 session.sendRequest=async(command)=>{requests.push(command);if(session.targetExited)throw Error('Server disconnected unexpectedly');return{body:{threads:[{id:1,name:'Main'}]}};};
 const created=new Emitter();
 const lifecycle=new PythonTerminalLifecycle({getContext:async()=>({mode,workspace:'/project'})},{onDidCreateTerminal:created.event},null,{getSession:()=>session});
 const fire=(reason,threadId=1)=>session.handleThread({body:{reason,threadId}});
 const close=()=>{lifecycle.onStop();for(const event of events.values())event.dispose();created.dispose();};
 return{session,lifecycle,events,errors,requests,fire,close};
}
test('retained native debounce reproduces quick-exit query; admitted Python terminal cancels that obsolete query',async()=>{
 const old=fixture();try{await old.fire('started');old.session.targetExited=true;await old.fire('exited');await delay(160);await old.session.pendingThreads;assert.deepEqual(old.requests,['threads']);assert.equal(old.errors.length,1);}finally{old.close();}
 const fixed=fixture();try{fixed.lifecycle.abandon(await fixed.lifecycle.prepare('session'));await fixed.fire('started');fixed.session.targetExited=true;await fixed.fire('exited');await delay(160);await fixed.session.pendingThreads;assert.deepEqual(fixed.requests,[]);assert.deepEqual(fixed.errors,[]);}finally{fixed.close();}
});
test('live threads and breakpoint refresh still query; live transport failures remain visible',async()=>{
 const f=fixture();try{f.lifecycle.abandon(await f.lifecycle.prepare('session'));await f.fire('started',1);await f.fire('started',2);await f.fire('exited',2);await delay(160);await f.session.pendingThreads;assert.deepEqual(f.requests,['threads']);assert.deepEqual(f.errors,[]);
 await f.session.updateThreads({threadId:1});assert.equal(f.requests.length,2);
 f.session.targetExited=true;await f.session.updateThreads({threadId:1});assert.equal(f.errors.length,1);
 }finally{f.close();}
});
test('process end prevents late started callbacks from querying and session disposal restores its method',async()=>{
 for(const event of ['exited','terminated']) {const f=fixture(),original=f.session.handleThread;try{f.lifecycle.abandon(await f.lifecycle.prepare('session'));await f.fire('started');f.events.get(event).fire({body:{}});f.session.targetExited=true;await f.fire('started',2);await delay(160);assert.deepEqual(f.requests,[]);assert.deepEqual(f.errors,[]);f.session.toDispose.dispose();assert.equal(f.session.handleThread,original);assert.equal(f.lifecycle.threadLifecycles.size,0);}finally{f.close();}}
});
test('hosted and unrelated debuggers are not adapted; shutdown preserves another contribution',async()=>{
 for(const options of [{mode:'hosted'},{type:'node'}]){const f=fixture(options),original=f.session.handleThread;try{await assert.rejects(f.lifecycle.prepare('session'),/current local/);assert.equal(f.session.handleThread,original);}finally{f.close();}}
 const f=fixture();try{f.lifecycle.abandon(await f.lifecycle.prepare('session'));const replacement=()=>{};f.session.handleThread=replacement;f.lifecycle.onStop();assert.equal(f.session.handleThread,replacement);assert.equal(f.lifecycle.threadLifecycles.size,0);}finally{f.close();}
});

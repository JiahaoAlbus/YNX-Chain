import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const ok=data=>({ok:true,status:200,json:async()=>data});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function stream(text){
 let reads=0,cancelled=false,released=false;
 return {get reads(){return reads},get cancelled(){return cancelled},get released(){return released},getReader:()=>({
  read:async()=>++reads===1?{done:false,value:new TextEncoder().encode(text)}:{done:true},
  cancel:async()=>{cancelled=true},releaseLock:()=>{released=true}
 })};
}
function client(overrides={}){
 const nodes=new Map(),calls=[];
 let ids=0;
 const node=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',innerHTML:'',style:{},dataset:{},handlers:{},
   classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.handlers[type]=fn},
   insertAdjacentHTML(position,html){this.innerHTML+=html},focus(){}});
  return nodes.get(selector);
 };
 const ctx=vm.createContext({
  document:{querySelector:node,querySelectorAll:()=>[]},
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{reload(){}},
  AbortController,TextDecoder,crypto:{randomUUID:()=>`generation-${++ids}`},setTimeout:()=>0,clearTimeout(){},matchMedia:()=>({matches:false}),
  fetch:async(path,options={})=>{
   calls.push({path,options});
   if(overrides[path])return overrides[path](options);
   if(path==='/api/public-status')return ok({gatewayReady:true});
   if(path==='/api/conversations')return ok({id:'new'});
   if(path.includes('/generate'))return {...ok({}),body:stream('event: token\ndata: {"text":"answer"}\n\nevent: done\ndata: {}\n\n')};
   if(path.startsWith('/api/conversations?'))return ok({conversations:[]});
   if(path.startsWith('/api/conversations/'))return ok({conversation:{title:'Conversation',archived:false},messages:[]});
   throw new Error(`Unexpected request: ${path}`);
  }
 });
 vm.runInContext(source,ctx);
 vm.runInContext("state.token='fixture';state.account='fixture-account';state.deviceId='fixture-device'",ctx);
 return {calls,node,eval:code=>vm.runInContext(code,ctx)};
}

test('double submit reserves generation before asynchronous conversation creation',async()=>{
 let create;
 const c=client({'/api/conversations':()=>new Promise(resolve=>{create=resolve})});
 c.node('#prompt').value='first';
 const first=c.eval("sendPrompt('first')");
 await c.eval("sendPrompt('second')");
 assert.equal(c.calls.filter(r=>r.path==='/api/conversations').length,1);
 create(ok({id:'new'}));await first;
 const generated=c.calls.filter(r=>r.path.endsWith('/generate'));
 assert.equal(generated.length,1);
 assert.equal(JSON.parse(generated[0].options.body).prompt,'first');
 assert.equal(c.eval('state.generationId'),'');
});

test('logout during conversation creation prevents the later generation request',async()=>{
 let create;
 const c=client({'/api/conversations':()=>new Promise(resolve=>{create=resolve})});
 const pending=c.eval("sendPrompt('first')");
 c.eval('state.signingOut=true;clearAISession()');
 create(ok({id:'new'}));await pending;
 assert.equal(c.calls.some(r=>r.path.endsWith('/generate')),false);
 assert.equal(c.eval('state.token'),'');
});

test('provider rejection preserves the submitted prompt for retry',async()=>{
 const c=client({'/api/conversations/new/generate':async()=>({ok:false,status:429,json:async()=>({error:'Provider quota reached'})})});
 c.node('#prompt').value='retry me';
 await c.eval("sendPrompt('retry me')");
 assert.equal(c.node('#prompt').value,'retry me');
 assert.equal(c.eval('state.generationId'),'');
});

test('failure does not overwrite a new draft typed while the request was pending',async()=>{
 let finish;
 const c=client({'/api/conversations/new/generate':()=>new Promise(resolve=>{finish=resolve})});
 c.node('#prompt').value='first';
 const pending=c.eval("sendPrompt('first')");await tick();
 c.node('#prompt').value='new draft';
 finish({ok:false,status:503,json:async()=>({error:'Unavailable'})});await pending;
 assert.equal(c.node('#prompt').value,'new draft');
});

test('switching conversations cannot route streamed tokens or refresh into the other conversation',async()=>{
 let finish;
 const body=stream('event: token\ndata: {"text":"private old answer"}\n\nevent: done\ndata: {}\n\n');
 const c=client({'/api/conversations/new/generate':()=>new Promise(resolve=>{finish=resolve})});
 const pending=c.eval("sendPrompt('first')");await tick();
 c.eval("state.conversationId='other'");
 c.node('#streaming-message .message-body').textContent='Other conversation';
 finish({...ok({}),body});await pending;
 assert.equal(c.node('#streaming-message .message-body').textContent,'Other conversation');
 assert.equal(c.eval('state.conversationId'),'other');
 assert.equal(c.calls.some(r=>r.path==='/api/conversations/new'),false);
 assert.equal(body.cancelled,true);assert.equal(body.released,true);
});

test('terminal SSE event closes the reader without waiting for the network to close',async()=>{
 const body=stream('event: done\ndata: {}\n\n');
 const c=client();
 c.eval('globalThis.testBody=null');
 // Pass the reader as a function argument, without changing product functions.
 await c.eval('(body)=>consumeSSE(body)')(body);
 assert.equal(body.reads,1);assert.equal(body.cancelled,true);assert.equal(body.released,true);
});

test('truncated SSE rejects completion and releases its reader',async()=>{
 const body=stream('event: token\ndata: {"text":"partial"}\n\n');
 const c=client();
 await assert.rejects(c.eval('(body)=>consumeSSE(body)')(body),/without a terminal event/);
 assert.equal(body.cancelled,true);assert.equal(body.released,true);
});

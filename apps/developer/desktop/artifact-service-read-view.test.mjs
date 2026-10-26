import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=await readFile(new URL('../runtime/ynx-workbench/lib/artifact-publication-view.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({approve=async requestId=>({approved:true,requestId}),query=async()=>({queryOnly:true}),native=true}={}){
 const calls=[],nativeCalls=[];
 const document={createElement(tag){return {ownerDocument:document,tag,children:[],listeners:new Map(),disabled:false,append(...v){this.children.push(...v);},setAttribute(){},addEventListener(k,fn){this.listeners.set(k,fn);},click(){if(!this.disabled)this.listeners.get('click')?.();}};}};
 class BaseWidget{constructor(){this.node=document.createElement('section');this.title={};this.toDispose=[];}}
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:name=>name.endsWith('/widgets')?{BaseWidget}:{CommonMenus:{VIEW_VIEWS:['view']}},Promise,Error});
 const target={crypto:{randomUUID},...(native?{ynxDesktopWallet:{approveDeploymentObservation(id){nativeCalls.push(['approve',id]);return approve(id);},endDeploymentObservation(){nativeCalls.push(['end']);return Promise.resolve();}}}:{})};
 const project={async call(action,body){calls.push([action,body]);return action==='publication-observe'?query(body):{cancelled:true};}};
 const w=new module.exports.ArtifactPublicationWidget(project,target,(_key,text)=>text);
 w.fields.requestId.value='00000000-0000-4000-8000-000000000001';
 return {w,calls,nativeCalls,target,newWidget:()=>{const next=new module.exports.ArtifactPublicationWidget(project,target,(_key,text)=>text);next.fields.requestId.value=w.fields.requestId.value;return next;}};
}
test('normal view obtains actual native review before backend observation and revokes proof permission after completion',async()=>{
 const gate=deferred(),f=fixture({approve:()=>gate.promise});
 f.w.buttons.observe.click();await flush();assert.equal(f.calls.length,0);assert.equal(f.nativeCalls[0][0],'approve');
 gate.resolve({approved:true,requestId:f.w.fields.requestId.value});await flush();await flush();
 assert.equal(f.calls[0][0],'publication-observe');assert.equal(f.nativeCalls.at(-1)[0],'end');
 assert.match(f.w.status.textContent,/status and logs read/);
});
test('missing native bridge cannot silently bypass service read review',async()=>{
 const f=fixture({native:false});f.w.buttons.observe.click();await flush();
 assert.equal(f.calls.length,0);assert.match(f.w.status.textContent,/not connected/);
});
test('different request approval is rejected before backend and its native grant is retired',async()=>{
 const f=fixture({approve:async()=>({approved:true,requestId:'00000000-0000-4000-8000-000000000002'})});
 f.w.buttons.observe.click();await flush();await flush();
 assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.at(-1)[0],'end');assert.match(f.w.status.textContent,/stopped/);
});
test('cancel during native review fences late approval and does not send backend cancellation for an unstarted observation',async()=>{
 const gate=deferred(),f=fixture({approve:()=>gate.promise});
 f.w.buttons.observe.click();await flush();f.w.buttons.cancel.click();await flush();await flush();
 assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.filter(x=>x[0]==='end').length,1);
 gate.resolve({approved:true,requestId:f.w.fields.requestId.value});await flush();
 assert.equal(f.calls.length,0);assert.match(f.w.status.textContent,/stopped/);
});
test('stop retires native proof permission and backend observation; late query cannot publish a result',async()=>{
 const gate=deferred(),f=fixture({query:()=>gate.promise});
 f.w.buttons.observe.click();await flush();assert.equal(f.calls[0][0],'publication-observe');
 f.w.buttons.cancel.click();await flush();await flush();
 assert.equal(f.calls.at(-1)[0],'publication-observe-cancel');assert.equal(f.nativeCalls.at(-1)[0],'end');
 gate.resolve({PUBLIC_LATE:'must not render'});await flush();
 assert.ok(!f.w.output.textContent?.includes('PUBLIC_LATE'));assert.match(f.w.status.textContent,/stopped/);
});
test('disposing a pending native review revokes it and never starts backend work',async()=>{
 const gate=deferred(),f=fixture({approve:()=>gate.promise});f.w.buttons.observe.click();await flush();
 for(const item of f.w.toDispose)item.dispose();await flush();
 gate.resolve({approved:true,requestId:f.w.fields.requestId.value});await flush();
 assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.filter(x=>x[0]==='end').length,1);
});


test('dispose then immediate reopen cannot place a new review before the old native cleanup',{timeout:1000},async()=>{
 const pending=deferred(),f=fixture({query:()=>pending.promise});f.w.buttons.observe.click();await flush();
 for(const item of f.w.toDispose)item.dispose();
 const next=f.newWidget();next.buttons.observe.click();await flush();await flush();
 assert.equal(f.nativeCalls.filter(row=>row[0]==='approve').length,1,'old query retains native cleanup custody until retirement finishes');
 assert.match(next.status.textContent,/previous.*query.*cleanup/i);pending.resolve({PUBLIC_LATE:true});await flush();
 next.buttons.observe.click();await flush();await flush();assert.equal(f.nativeCalls.filter(row=>row[0]==='approve').length,2);
});
test('native cleanup rejection retains custody across widget replacement without resending UNKNOWN',{timeout:1000},async()=>{
 const pending=deferred(),f=fixture({query:()=>pending.promise});let ended=0;
 f.target.ynxDesktopWallet.endDeploymentObservation=()=>{ended++;return Promise.reject(false);};
 f.w.buttons.observe.click();await flush();for(const item of f.w.toDispose)item.dispose();await flush();await flush();
 const next=f.newWidget();next.buttons.observe.click();await flush();await flush();
 assert.equal(f.nativeCalls.filter(row=>row[0]==='approve').length,1);assert.equal(ended,1);assert.match(next.status.textContent,/previous.*query.*cleanup/i);
 pending.resolve({PUBLIC_LATE:true});await flush();assert.equal(ended,1);
});

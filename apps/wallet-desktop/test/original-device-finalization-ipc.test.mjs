import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {bindDeviceFinalizationUI} from '../src/wallet-device-finalization-ui.mjs';
const main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
function ipc(){const handlers=new Map(),calls=[],request={version:'4',deviceId:'PUBLIC'},context={handleWalletIPC:(n,f)=>handlers.set(n,f),safeIPC:f=>f(),sensitiveIPC:f=>{calls.push('sensitive');return f();},originalDeviceFinalization:{finalizeOriginal:async r=>{calls.push(r);return{SourceAdmission:false};},readStatusDATA:()=>({phase:'idle'})},authorizationController:{pending:{account:'PUBLIC',request}},accountChangeInProgress:false,keyAccess:{status:()=>({account:'PUBLIC'})},Object,Error};
 const start=main.indexOf("handleWalletIPC('wallet:device-finalization-status'"),end=main.indexOf("handleWalletIPC('wallet:query-original-device'",start);assert(start>=0&&end>start);runInNewContext(main.slice(start,end),context);return{handlers,calls,request,context};}
test('actual Main finalization takes the original pending application only; renderer DTO and foreign account are refused',async()=>{
 const f=ipc(),fn=f.handlers.get('wallet:finalize-original-device');await fn({});assert.equal(f.calls[1],f.request);await assert.rejects(fn({},{registered:true}),e=>e.code==='DEVICE_FINALIZATION_ZERO_INPUT');
 for(const change of [c=>c.authorizationController.pending=null,c=>c.authorizationController.pending.loadingAccount=true,c=>c.authorizationController.pending.account='other',c=>c.accountChangeInProgress=true]){const g=ipc();change(g.context);await assert.rejects(g.handlers.get('wallet:finalize-original-device')({}),e=>e.code==='DEVICE_FINALIZATION_ORIGINAL_REQUEST_REQUIRED');assert.deepEqual(g.calls,['sensitive']);}
 const count=f.calls.length;await f.handlers.get('wallet:device-finalization-status')({});assert.equal(f.calls.length,count);
});
test('preload finalization methods forward no caller terms, Source, generation or account',()=>{
 let api;const calls=[];runInNewContext(readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_n,v)=>api=v},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
 api.finalizeOriginalDevice({registered:true});api.deviceFinalizationStatus('other');assert.deepEqual(calls,[['wallet:finalize-original-device'],['wallet:device-finalization-status']]);
});
function uiFixture(){const events={},nodes=new Map(['#app-device-finalize','#app-device-finalize-status'].map(id=>[id,{textContent:'',addEventListener:(event,fn)=>events[id+event]=fn}])),context={account:'PUBLIC',revision:1,locked:false},state={phase:'idle'},calls=[];
 const api={async deviceFinalizationStatus(){return{ok:true,value:{...state}};},async finalizeOriginalDevice(...args){calls.push(args);Object.assign(state,{phase:'original-local-association-retained',effectEntered:true,outcome:{localAssociationFinalized:true},SourceAdmission:false,connected:false,newSession:false,keyGenerated:false,registrationResent:false});return{ok:true,value:{...state}};}};
 const ui=bindDeviceFinalizationUI({root:{querySelector:id=>nodes.get(id)},api,readContext:()=>context});return{ui,api,state,context,nodes,events,calls};}
test('normal finalization UI uses zero args, projects local outcome only and prevents another effect',async()=>{
 const f=uiFixture();await f.events['#app-device-finalizeclick']();assert.deepEqual(f.calls,[[]]);assert.match(f.nodes.get('#app-device-finalize-status').textContent,/separate confirmation/);assert.equal(f.nodes.get('#app-device-finalize').disabled,true);
 await f.events['#app-device-finalizeclick']();assert.equal(f.calls.length,1);
});
test('locked status and late account switch cannot revive or display a prior finalization',async()=>{
 const f=uiFixture();f.context.locked=true;Object.assign(f.state,{effectEntered:true,phase:'original-local-finalization-unknown',outcome:{localAssociationFinalized:true}});await f.ui.refresh();assert.equal(f.nodes.get('#app-device-finalize-status').textContent,'');f.context.locked=false;f.ui.render();assert.equal(f.nodes.get('#app-device-finalize').disabled,true);assert.match(f.nodes.get('#app-device-finalize-status').textContent,/reconciliation/);
 const g=uiFixture();let resolve;g.api.finalizeOriginalDevice=()=>new Promise(r=>resolve=r);const pass=g.events['#app-device-finalizeclick']();g.context.account='OTHER';g.context.revision++;resolve({ok:true,value:{phase:'original-local-association-retained',outcome:{localAssociationFinalized:true}}});await pass;assert.doesNotMatch(g.nodes.get('#app-device-finalize-status').textContent,/record finished/);
});

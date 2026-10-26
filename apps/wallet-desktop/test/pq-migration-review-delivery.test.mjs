import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
const modes=[['wallet:pq-migration-review','requestPQMigration','ynx_signPQMigration'],['wallet:pq-broadcast-review','requestPQBroadcast','ynx_broadcastPQMigration']];
function fixture(channel,method,kind,options={}){
 const handlers=new Map(),expired=[],events=[],account='0x'+'11'.repeat(20),original=Object.freeze({operationId:'PUBLIC-existing-E6',hash:'0x'+'ab'.repeat(32),status:'signed-unsubmitted'});let current=true;
 const guard={account,assert(){if(!current)throw Error('PUBLIC_ORIGINAL_LEASE_LOST');}},pending={id:'PUBLIC-unsigned-review',method:kind,review:{account}};
 const context={handleWalletIPC:(name,handler)=>handlers.set(name,handler),sensitiveIPC:async fn=>fn(),keyAccess:{current:()=>guard},walletAuthority:{async [method](){if(options.throwPrepare)throw false;if(options.lateLock)current=false;return {status:'approval-required',request:pending};},expire:id=>{expired.push(id);return true;}},mainWindow:options.noWindow?null:{isDestroyed:()=>Boolean(options.destroyed),webContents:{send(...args){if(options.sendFailure)throw Error('PUBLIC_WINDOW_DELIVERY_FAILED');events.push(args);if(options.lockOnSend)current=false;}}},Object,Error};
 const start=source.indexOf(`handleWalletIPC('${channel}'`),end=source.indexOf('\n}));',start);assert(start>=0&&end>start);
 runInNewContext(source.slice(start,end+5),context);return {run:()=>handlers.get(channel)({},original.hash),expired,events,original};
}
for(const [channel,method,kind]of modes){
 test(`${channel} late lock or missing/destroyed delivery retires only unsigned review, preserves existing E6`,async()=>{
  for(const options of [{lateLock:true},{noWindow:true},{destroyed:true},{sendFailure:true},{lockOnSend:true}]){
   const f=fixture(channel,method,kind,options),before=JSON.stringify(f.original);await assert.rejects(f.run());assert.deepEqual(f.expired,['PUBLIC-unsigned-review']);assert.equal(JSON.stringify(f.original),before);
  }
 });
 test(`${channel} normal review delivery is unsigned and preparation failure preserves falsy cause`,async()=>{
  const f=fixture(channel,method,kind),result=await f.run();assert.equal(result.requestId,'PUBLIC-unsigned-review');assert.equal(result.submitted,false);assert.equal(f.events.length,1);assert.deepEqual(f.expired,[]);
  const bad=fixture(channel,method,kind,{throwPrepare:true});await assert.rejects(bad.run(),e=>e===false);assert.deepEqual(bad.expired,[]);assert.deepEqual(bad.events,[]);
 });
}

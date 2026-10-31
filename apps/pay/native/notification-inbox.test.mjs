import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {runNativePayCLI} from './cli.mjs';
import {NativePayNotificationInbox} from './notification-inbox.mjs';
import {NativePayBusinessClient} from './pay-business-client.mjs';
const scope=()=>({source:'registered-pay-source',principal:'original-private-actor',genesis:'a'.repeat(64),bindingDigest:'b'.repeat(64),current(){}});
const event=(id='1')=>({eventId:id.repeat(64),genesis:'a'.repeat(64),merchant:'0x'+'1'.repeat(40),invoiceId:'invoice-100',sessionId:'session-100',sourceOrder:'original-order-100',nativeHash:'0x'+id.repeat(64),abciHash:'0x'+'2'.repeat(64),memberIndex:'0',eventIndex:'0',executionHeight:'12',kind:'invoice_settle',effectHash:'c'.repeat(64)});
function storage(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pay-notification-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'private','inbox.sqlite');}
function bill(e){return {genesis:e.genesis,merchant:e.merchant,invoiceId:e.invoiceId,sessionId:e.sessionId,sourceOrder:e.sourceOrder,paidAtoms:'100',operations:{[e.nativeHash]:{kind:e.kind,status:'confirmed',abciHash:e.abciHash,effect:{merchant:e.merchant,genesis:e.genesis,invoiceId:e.invoiceId,sessionId:e.sessionId,nativeHash:e.nativeHash,abciHash:e.abciHash,member:e.memberIndex,event:e.eventIndex,height:e.executionHeight}}}};}
test('original event dedup survives cold reopen, scope switch and conflicting reference rollback',t=>{
 const file=storage(t),s=scope(),e=event();let box=new NativePayNotificationInbox(file);
 assert.equal(box.stage(s,[e,e],()=>{}).added,1);assert.equal(box.pending(s,e.merchant,e.invoiceId,()=>{}).length,1);box.close();
 box=new NativePayNotificationInbox(file);
 assert.equal(box.stage(s,[{...e,originalWebhookEventId:'whd_new_transport'}],()=>{}).added,0);
 assert.throws(()=>box.stage(s,[event('3'),{...e,nativeHash:'0x'+'4'.repeat(64)}],()=>{}),{code:'NATIVE_PAY_EVENT_REFERENCE_CONFLICT'});
 assert.equal(box.pending(s,e.merchant,e.invoiceId,()=>{}).length,1);
 assert.equal(box.pending({...s,principal:'other-actor'},e.merchant,e.invoiceId,()=>{}).length,0);
 box.refreshed(s,e,()=>{});box.close();box=new NativePayNotificationInbox(file);
 assert.equal(box.pending(s,e.merchant,e.invoiceId,()=>{}).length,0);box.close();
});
test('late Source denial rolls back inbox commit; symlink storage is not followed',t=>{
 const file=storage(t),box=new NativePayNotificationInbox(file),s=scope(),e=event();let checks=0;
 assert.throws(()=>box.stage(s,[e],()=>{if(++checks===2)throw Object.assign(Error(),{code:'SOURCE_RETIRED'})}),{code:'SOURCE_RETIRED'});
 assert.equal(box.pending(s,e.merchant,e.invoiceId,()=>{}).length,0);box.close();
 const link=path.join(path.dirname(file),'link.sqlite');fs.symlinkSync(file,link);assert.throws(()=>new NativePayNotificationInbox(link),{code:'NATIVE_PAY_NOTIFICATION_STORAGE_UNAVAILABLE'});
});
test('cross-product notification recovery is read-only and retains pending after missing reader/cold restart',async t=>{
 const file=storage(t),s=scope(),e=event(),feed={merchant:e.merchant,invoiceId:e.invoiceId,events:[e]},b=bill(e);let box=new NativePayNotificationInbox(file),reads=0;
 const runtime={current(){},notificationInbox:box,async readNotificationScope(){return s},pay:{async readInvoice(){return b},async readInvoiceEvents(){return feed}}};
 let client=new NativePayBusinessClient(runtime),state=await client.syncNotifications(e.merchant,e.invoiceId);
 assert.equal(state.bill.paidAtoms,'100');assert.equal(state.notifications.phase,'pending');assert.equal(state.notifications.pending,1);
 box.close();box=new NativePayNotificationInbox(file);runtime.notificationInbox=box;
 runtime.refreshOriginalProduct=async(ref,current)=>{current();reads++;return {sourceOrder:ref.sourceOrder,queryOnly:true,untrustedPaidAmount:'999999'};};
 client=new NativePayBusinessClient(runtime);state=await client.syncNotifications(e.merchant,e.invoiceId);
 assert.equal(state.notifications.pending,0);assert.equal(state.notifications.refreshed,1);assert.equal(state.bill.paidAtoms,'100');
 await client.syncNotifications(e.merchant,e.invoiceId);assert.equal(reads,1);box.close();
});
test('wrong event subject/effect and retired scope cannot acknowledge or expose old bill',async t=>{
 const file=storage(t),box=new NativePayNotificationInbox(file),s=scope(),e=event();let active=true,productReads=0;
 const runtime={current(){if(!active)throw Object.assign(Error(),{code:'SOURCE_RETIRED'})},notificationInbox:box,async readNotificationScope(){return s},pay:{async readInvoice(){return bill(e)},async readInvoiceEvents(){return {events:[{...e,abciHash:'0x'+'f'.repeat(64)}]}}},async refreshOriginalProduct(){productReads++;return {queryOnly:true,sourceOrder:e.sourceOrder}}};
 let client=new NativePayBusinessClient(runtime),state=await client.syncNotifications(e.merchant,e.invoiceId);
 assert.equal(state.notifications.phase,'pending');assert.equal(state.notifications.pending,1);assert.equal(productReads,0);
 active=false;await assert.rejects(client.syncNotifications(e.merchant,e.invoiceId),{code:'SOURCE_RETIRED'});assert.equal(client.snapshot().bill,null);box.close();
});
test('unrelated database is preserved and asynchronous Source fences cannot commit',t=>{
 const file=storage(t);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const db=new DatabaseSync(file);fs.chmodSync(file,0o600);db.exec("CREATE TABLE original_data(value TEXT); INSERT INTO original_data VALUES('preserved')");db.close();
 assert.throws(()=>new NativePayNotificationInbox(file),{code:'NATIVE_PAY_NOTIFICATION_STORAGE_REQUIRES_RECOVERY'});
 const retained=new DatabaseSync(file);assert.equal(retained.prepare('SELECT value FROM original_data').get().value,'preserved');retained.close();
 const box=new NativePayNotificationInbox(path.join(path.dirname(file),'new.sqlite'));
 assert.throws(()=>box.stage(scope(),[event()],async()=>{}),{code:'NATIVE_PAY_NOTIFICATION_SCOPE_UNAVAILABLE'});
 assert.equal(box.pending(scope(),event().merchant,event().invoiceId,()=>{}).length,0);box.close();
});
test('normal events command preserves bill read when notification Source is not supplied',async t=>{
 const file=storage(t),runtimeFile=path.join(path.dirname(file),'runtime.mjs');fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(runtimeFile,`export async function openNativePayRuntime(){return {current(){},pay:{async readInvoice(){return {paidAtoms:'100'}}}}}`);
 const output=[];assert.equal(await runNativePayCLI(['--runtime',runtimeFile,'events',event().merchant,event().invoiceId],{write:s=>output.push(JSON.parse(s))}),0);
 assert.equal(output[0].bill.paidAtoms,'100');assert.equal(output[0].notifications.phase,'unavailable');assert.equal(output[0].clientIndependentFinality,false);
});

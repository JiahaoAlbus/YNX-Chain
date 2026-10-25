// Main only, independent visible migration broadcast capsule/brand. Ordinary
// transfer/typed/initial/login capsules or JS-shaped peers cannot authorize it.
import{BrowserWindow}from'electron';import{types}from'node:util';import{performance}from'node:perf_hooks';
import{assertWalletIPC}from'../wallet-ipc-policy.mjs';import*as originalAuthority from'../desktop-wallet-authority.mjs';
import{TransactionPermissionKernel}from'./transaction-permission-kernel.mjs';
import{inspectOriginalMigrationPacketDATA}from'./migration-original-data.mjs';
const supplied=new WeakSet(),approvals=new WeakMap(),held=new Set(),custody=new WeakMap();
const expectedURL=new URL('../index.html',import.meta.url).href,iso=n=>new Date(n).toISOString();
const fail=c=>{throw Object.assign(Error(c),{code:c});};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_MIGRATION_APPROVAL_SCHEMA');const d=Object.getOwnPropertyDescriptors(v),k=Reflect.ownKeys(d);if(k.length!==keys.length||k.some(k=>!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('AUTH_MIGRATION_APPROVAL_SCHEMA');}
function currentPeer(s){
 if(!s||s.retired||s.revoked||Date.now()<s.issued||Date.now()>=s.expires||performance.now()-s.mono>=s.expires-s.issued)fail('AUTH_MIGRATION_APPROVAL_REVOKED');
 const w=BrowserWindow.fromWebContents(s.sender);
 if(!w||w!==s.window||w.isDestroyed()||s.sender.isDestroyed()||s.sender.mainFrame!==s.frame)fail('AUTH_MIGRATION_APPROVAL_PEER_CHANGED');
 assertWalletIPC(s.event,s.sender,expectedURL);
 if(s.retired||s.revoked||Date.now()<s.issued||Date.now()>=s.expires||performance.now()-s.mono>=s.expires-s.issued)fail('AUTH_MIGRATION_APPROVAL_REVOKED');
}
function dispose(s){if(s.cleaned)return;s.cleaned=true;s.retired=true;held.delete(s);s.sender.removeListener('destroyed',s.revoke);s.sender.removeListener('did-start-navigation',s.revoke);}
export function captureOriginalWalletMigrationBroadcastApprovalIPC(event,reviewId){
 if(typeof reviewId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(reviewId))fail('AUTH_MIGRATION_APPROVAL_REVIEW_ID');
 const sender=event?.sender,window=sender&&BrowserWindow.fromWebContents(sender);
 if(!window||window.isDestroyed()||sender.isDestroyed())fail('AUTH_MIGRATION_APPROVAL_PEER_REQUIRED');assertWalletIPC(event,sender,expectedURL);
 for(const s of held)if(!s.used&&Date.now()>=s.expires)dispose(s);if(held.size>=64)fail('AUTH_MIGRATION_APPROVAL_LIMIT');
 const now=Date.now(),s={event,sender,window,frame:event.senderFrame,reviewId,issued:now,expires:now+30000,mono:performance.now(),used:false,retired:false,revoked:false,cleaned:false};
 s.revoke=()=>{s.revoked=true;};sender.on('destroyed',s.revoke);sender.on('did-start-navigation',s.revoke);
 try{currentPeer(s);}catch(e){dispose(s);throw e;}const capsule=Object.freeze(Object.create(null));approvals.set(capsule,s);held.add(s);return capsule;
}
export function retireUnusedOriginalWalletMigrationBroadcastApproval(capsule){const s=approvals.get(capsule);if(s&&!s.used)dispose(s);}
export function isOriginalWalletMigrationBroadcastPermission(value){return supplied.has(value);}
export async function acquireOriginalWalletMigrationBroadcastPermission(request,capsule,borrow){
 const s=approvals.get(capsule);let recognized=false,ownsCapsule=false,retainedSource;
 const current=completed=>{currentPeer(s);if(!recognized)fail('AUTH_MIGRATION_APPROVAL_BORROW_REQUIRED');if((completed?borrow.assertCompletedCurrent(completed):borrow.assertCurrent())!==undefined)fail('AUTH_MIGRATION_APPROVAL_CURRENT_RESULT');currentPeer(s);};
 const peer={
  async readOriginal(selected){
   current();const i=borrow.readApprovalIdentity();exact(i,['kind','action','operationId','originalOperationId','reviewId']);
   if(i.kind!=='pq-migration'||i.action!=='broadcast'||i.reviewId!==s.reviewId||i.operationId!==selected.operationId||selected.operationId!==s.reviewId||i.originalOperationId!==selected.originalOperationId||i.originalOperationId===i.operationId)fail('AUTH_MIGRATION_APPROVAL_REVIEW_BINDING');
   const p=await borrow.readOriginal(selected);retainedSource=p;current();exact(p,['request','issuedAt','expiresAt','source']);
   // Retain actual source packet BEFORE math/status; it remains owned by the
   // original private borrow until join/close even on failed partial verification.
   inspectOriginalMigrationPacketDATA(p.source,selected);current();
   const issued=Date.parse(p.issuedAt),expires=Date.parse(p.expiresAt);
   if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||iso(issued)!==p.issuedAt||iso(expires)!==p.expiresAt||issued<s.issued||issued>Date.now()||expires<=issued)fail('AUTH_MIGRATION_APPROVAL_TIME');
   s.expires=Math.min(s.expires,expires);currentPeer(s);return{request:p.request,issuedAt:iso(s.issued),expiresAt:iso(s.expires)};
  },
  assertCurrent(){current();},async recheck(){current();if(await borrow.recheck()!==undefined)fail('AUTH_MIGRATION_APPROVAL_RECHECK_RESULT');current();},
  enterOriginal(action){current();if(action!=='broadcast')fail('AUTH_MIGRATION_APPROVAL_ACTION');if(borrow.enterOriginal(action)!==undefined)fail('AUTH_MIGRATION_APPROVAL_ENTER_RESULT');current();},
  completeOriginal(result){currentPeer(s);if(borrow.completeOriginal(result)!==undefined)fail('AUTH_MIGRATION_APPROVAL_COMPLETE_RESULT');current(result);},assertCompletedCurrent(result){current(result);},
  retire(){if(recognized&&borrow.retire()!==undefined)fail('AUTH_MIGRATION_APPROVAL_RETIRE_RESULT');},async join(){if(recognized&&await borrow.join()!==undefined)fail('AUTH_MIGRATION_APPROVAL_JOIN_RESULT');},
  async close(){let first,failed=false;try{if(recognized){if(await borrow.close()!==undefined)fail('AUTH_MIGRATION_APPROVAL_CLOSE_RESULT');custody.delete(borrow);retainedSource=undefined;}}catch(e){first=e;failed=true;}try{if(s&&ownsCapsule)dispose(s);}catch(e){if(!failed){first=e;failed=true;}}if(failed)throw first;},
 };
 const owner=new TransactionPermissionKernel(request,peer);
 try{
  if(typeof originalAuthority.isOriginalPQMigrationBroadcastReviewBorrow!=='function'||originalAuthority.isOriginalPQMigrationBroadcastReviewBorrow(borrow)!==true)fail('AUTH_MIGRATION_APPROVAL_BORROW_REQUIRED');
  if(custody.has(borrow))fail('AUTH_MIGRATION_APPROVAL_BORROW_ALREADY_HELD');custody.set(borrow,owner);recognized=true;
  if(!s||s.used)fail('AUTH_MIGRATION_APPROVAL_CAPSULE_SELECTED');s.used=true;ownsCapsule=true;
  await owner.initialize();owner.assertCurrent();supplied.add(owner);return owner;
 }catch(cause){const e=Object.assign(Error('AUTH_WALLET_MIGRATION_PERMISSION_NOT_SUPPLIED',{cause}),{code:'AUTH_WALLET_MIGRATION_PERMISSION_NOT_SUPPLIED'});Object.defineProperty(e,'partial',{value:owner});throw e;}
}

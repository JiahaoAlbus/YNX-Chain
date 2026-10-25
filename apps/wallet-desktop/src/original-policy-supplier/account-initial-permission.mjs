// MAIN ONLY. Separate initial IPC capsules, private borrow brand and permission
// brand. Never export through preload/renderer or reuse ordinary TX capsules.
import {BrowserWindow} from 'electron';
import {types} from 'node:util';
import {assertWalletIPC} from '../wallet-ipc-policy.mjs';
import * as originalAuthority from '../desktop-wallet-authority.mjs';
import {AccountInitialPermissionKernel} from './account-initial-permission-kernel.mjs';
const supplied=new WeakSet(),approvals=new WeakMap(),held=new Set(),custody=new WeakMap();
const expectedURL=new URL('../index.html',import.meta.url).href;
const fail=code=>{throw Object.assign(Error(code),{code});};
const iso=n=>new Date(n).toISOString();
function exact(v,keys){
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_INITIAL_APPROVAL_SCHEMA');
 const d=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(d);
 if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('AUTH_INITIAL_APPROVAL_SCHEMA');
}
function currentPeer(s){
 if(!s||s.retired||s.revoked||Date.now()<s.issued||Date.now()>=s.expires)fail('AUTH_INITIAL_APPROVAL_REVOKED');
 const w=BrowserWindow.fromWebContents(s.sender);
 if(!w||w!==s.window||w.isDestroyed()||s.sender.isDestroyed()||s.sender.mainFrame!==s.frame)fail('AUTH_INITIAL_APPROVAL_PEER_CHANGED');
 assertWalletIPC(s.event,s.sender,expectedURL);
 if(s.retired||s.revoked||Date.now()<s.issued||Date.now()>=s.expires)fail('AUTH_INITIAL_APPROVAL_REVOKED');
}
function dispose(s){
 if(s.cleaned)return;s.cleaned=true;s.retired=true;held.delete(s);
 s.sender.removeListener('destroyed',s.revoke);s.sender.removeListener('did-start-navigation',s.revoke);
}
export function captureOriginalWalletAccountInitialApprovalIPC(event,reviewId,action){
 if(!['sign','broadcast'].includes(action)||typeof reviewId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(reviewId))fail('AUTH_INITIAL_APPROVAL_REVIEW_ID');
 const sender=event?.sender,window=sender&&BrowserWindow.fromWebContents(sender);
 if(!window||window.isDestroyed()||sender.isDestroyed())fail('AUTH_INITIAL_APPROVAL_PEER_REQUIRED');
 assertWalletIPC(event,sender,expectedURL);
 for(const s of held)if(!s.used&&Date.now()>=s.expires)dispose(s);
 if(held.size>=64)fail('AUTH_INITIAL_APPROVAL_LIMIT');
 const now=Date.now(),s={event,sender,window,frame:event.senderFrame,reviewId,action,issued:now,expires:now+30000,used:false,retired:false,revoked:false,cleaned:false};
 s.revoke=()=>{s.revoked=true;};sender.on('destroyed',s.revoke);sender.on('did-start-navigation',s.revoke);
 try{currentPeer(s);}catch(e){dispose(s);throw e;}
 const capsule=Object.freeze(Object.create(null));approvals.set(capsule,s);held.add(s);return capsule;
}
export function retireUnusedOriginalWalletAccountInitialApproval(capsule){const s=approvals.get(capsule);if(s&&!s.used)dispose(s);}
export function isOriginalWalletAccountInitialPermission(value){return supplied.has(value);}
export async function acquireOriginalWalletAccountInitialPermission(request,capsule,borrow){
 const s=approvals.get(capsule);let recognized=false,ownsCapsule=false;
 const current=completed=>{
  currentPeer(s);if(!recognized)fail('AUTH_INITIAL_APPROVAL_BORROW_REQUIRED');
  if((completed?borrow.assertCompletedCurrent(completed):borrow.assertCurrent())!==undefined)fail('AUTH_INITIAL_APPROVAL_CURRENT_RESULT');currentPeer(s);
 };
 const peer={
  async readOriginal(selected){
   currentPeer(s);if(!recognized)fail('AUTH_INITIAL_APPROVAL_BORROW_REQUIRED');
   const i=borrow.readApprovalIdentity();exact(i,['kind','action','operationId','reviewId']);
   if(i.kind!=='pq-account-initial'||i.reviewId!==s.reviewId||i.action!==s.action||i.operationId!==selected.operationId||selected.action!==s.action)fail('AUTH_INITIAL_APPROVAL_REVIEW_BINDING');
   current();const p=await borrow.readOriginal(selected);current();exact(p,['request','issuedAt','expiresAt','source']);
   const issued=Date.parse(p.issuedAt),expires=Date.parse(p.expiresAt);
   if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||iso(issued)!==p.issuedAt||iso(expires)!==p.expiresAt||issued<s.issued||issued>Date.now()||expires<=issued)fail('AUTH_INITIAL_APPROVAL_TIME');
   return {request:p.request,issuedAt:iso(s.issued),expiresAt:iso(Math.min(s.expires,expires)),source:p.source};
  },
  assertCurrent(){current();},
  async recheck(){current();if(await borrow.recheck()!==undefined)fail('AUTH_INITIAL_APPROVAL_RECHECK_RESULT');current();},
  enterOriginal(action){current();if(action!==s.action)fail('AUTH_INITIAL_APPROVAL_ACTION');if(borrow.enterOriginal(action)!==undefined)fail('AUTH_INITIAL_APPROVAL_ENTER_RESULT');current();},
  completeOriginal(result){currentPeer(s);if(borrow.completeOriginal(result)!==undefined)fail('AUTH_INITIAL_APPROVAL_COMPLETE_RESULT');current(result);},
  assertCompletedCurrent(result){current(result);},
  retire(){if(recognized&&borrow.retire()!==undefined)fail('AUTH_INITIAL_APPROVAL_RETIRE_RESULT');},
  async join(){if(recognized&&await borrow.join()!==undefined)fail('AUTH_INITIAL_APPROVAL_JOIN_RESULT');},
  async close(){
   let first,failed=false;
   try{if(recognized){if(await borrow.close()!==undefined)fail('AUTH_INITIAL_APPROVAL_CLOSE_RESULT');custody.delete(borrow);}}catch(e){first=e;failed=true;}
   try{if(s&&ownsCapsule)dispose(s);}catch(e){if(!failed){first=e;failed=true;}}
   if(failed)throw first;
  },
 };
 const owner=new AccountInitialPermissionKernel(request,peer);
 try{
  // Actual private Main brand only; no duck-typing, transaction-borrow fallback
  // or caller injectable factory. Missing export rejects only this operation.
  if(typeof originalAuthority.isOriginalPQAccountInitialReviewBorrow!=='function'||originalAuthority.isOriginalPQAccountInitialReviewBorrow(borrow)!==true)fail('AUTH_INITIAL_APPROVAL_BORROW_REQUIRED');
  if(custody.has(borrow))fail('AUTH_INITIAL_APPROVAL_BORROW_ALREADY_HELD');custody.set(borrow,owner);recognized=true;
  if(!s||s.used)fail('AUTH_INITIAL_APPROVAL_CAPSULE_SELECTED');s.used=true;ownsCapsule=true;
  await owner.initialize();owner.assertCurrent();supplied.add(owner);return owner;
 }catch(cause){const e=Object.assign(Error('AUTH_WALLET_INITIAL_PERMISSION_NOT_SUPPLIED',{cause}),{code:'AUTH_WALLET_INITIAL_PERMISSION_NOT_SUPPLIED'});Object.defineProperty(e,'partial',{value:owner});throw e;}
}

// MAIN-ONLY normal Wallet IPC producer. Never preload/renderer exports. This
// authenticates the existing installed Wallet's own review event, not Root,
// Source/IDENTITY permission, TLS metadata, or an external DApp approval.
import {BrowserWindow} from 'electron';
import {assertWalletIPC} from '../wallet-ipc-policy.mjs';
import {isOriginalPQTransactionReviewBorrow} from '../desktop-wallet-authority.mjs';
import {TransactionPermissionKernel} from './transaction-permission-kernel.mjs';
const supplied=new WeakSet(),approvals=new WeakMap(),held=new Set(),borrowCustody=new WeakMap();
const expectedURL=new URL('../index.html',import.meta.url).href;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const iso=n=>new Date(n).toISOString();
function peerCurrent(state){
 if(state.retired||state.revoked||Date.now()<state.issued||Date.now()>=state.expires)fail('AUTH_TX_APPROVAL_PEER_REVOKED');
 const window=BrowserWindow.fromWebContents(state.sender);
 if(!window||window!==state.window||window.isDestroyed()||state.sender.isDestroyed()||state.sender.mainFrame!==state.frame)fail('AUTH_TX_APPROVAL_PEER_CHANGED');
 assertWalletIPC(state.event,state.sender,expectedURL);
 if(state.retired||state.revoked||Date.now()<state.issued||Date.now()>=state.expires)fail('AUTH_TX_APPROVAL_PEER_REVOKED');
}
function dispose(state){
 if(state.cleaned)return;state.cleaned=true;state.retired=true;held.delete(state);
 state.sender.removeListener('destroyed',state.revoke);state.sender.removeListener('did-start-navigation',state.revoke);
}
export function captureOriginalWalletTransactionApprovalIPC(event,reviewId,action){
 if(!['sign','broadcast'].includes(action)||typeof reviewId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(reviewId))fail('AUTH_TX_APPROVAL_REVIEW_ID');
 // Resolve actual Electron native WebContents -> BrowserWindow. No caller
 // window/path/origin/account/chain/root/key/approved boolean is accepted.
 const sender=event?.sender,window=sender&&BrowserWindow.fromWebContents(sender);
 if(!window||window.isDestroyed()||sender.isDestroyed())fail('AUTH_TX_APPROVAL_PEER_REQUIRED');
 assertWalletIPC(event,sender,expectedURL);
 for(const state of held)if(!state.used&&Date.now()>=state.expires)dispose(state);
 if(held.size>=64)fail('AUTH_TX_APPROVAL_PENDING_LIMIT');
 const now=Date.now(),state={event,sender,window,frame:event.senderFrame,reviewId,action,issued:now,expires:now+30000,used:false,retired:false,revoked:false,cleaned:false};
 state.revoke=()=>{state.revoked=true;};
 sender.on('destroyed',state.revoke);sender.on('did-start-navigation',state.revoke);
 try{peerCurrent(state);}catch(e){dispose(state);throw e;}
 const capsule=Object.freeze(Object.create(null));approvals.set(capsule,state);held.add(state);return capsule;
}
// Main must call this on cancellation/failure BEFORE factory consumption. The
// factory takes custody on entry; afterward only its owner may release it.
export function retireUnusedOriginalWalletTransactionApproval(capsule){const state=approvals.get(capsule);if(state&&!state.used)dispose(state);}
export function isOriginalWalletTransactionPermission(value){return supplied.has(value);}
export async function acquireOriginalWalletTransactionPermission(request,capsule,borrow){
 const state=approvals.get(capsule);let recognized=false,ownsCapsule=false;
 const current=completed=>{
  if(!state)fail('AUTH_TX_APPROVAL_CAPSULE_REQUIRED');peerCurrent(state);
  if(!recognized)fail('AUTH_TX_APPROVAL_BORROW_NOT_RECOGNIZED');
  const result=completed?borrow.assertCompletedCurrent(completed):borrow.assertCurrent();
  if(result!==undefined)fail('AUTH_TX_APPROVAL_CURRENT_RESULT');peerCurrent(state);
 };
 const peer={
  async readOriginal(selected){
   peerCurrent(state);
   if(!recognized)fail('AUTH_TX_APPROVAL_BORROW_NOT_RECOGNIZED');
   const identity=borrow.readApprovalIdentity();
   if(!identity||Object.getPrototypeOf(identity)!==Object.prototype||Object.keys(identity).sort().join('|')!=='action|operationId|reviewId'||identity.reviewId!==state.reviewId||identity.action!==state.action||identity.operationId!==selected.operationId||selected.action!==state.action)fail('AUTH_TX_APPROVAL_REVIEW_BINDING');
   current();const packet=await borrow.readOriginal(selected);current();
   if(!packet||Object.getPrototypeOf(packet)!==Object.prototype||Object.keys(packet).sort().join('|')!=='expiresAt|issuedAt|request')fail('AUTH_TX_APPROVAL_PACKET_INVALID');
   const issued=Date.parse(packet.issuedAt),expires=Date.parse(packet.expiresAt);
   if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||iso(issued)!==packet.issuedAt||iso(expires)!==packet.expiresAt||issued<state.issued||issued>Date.now()||expires<=issued)fail('AUTH_TX_APPROVAL_PACKET_TIME');
   // Original policy expiry can only shorten this exact 30s user approval.
   return Object.freeze({request:packet.request,issuedAt:iso(state.issued),expiresAt:iso(Math.min(state.expires,expires))});
  },
  assertCurrent(){current();},
  async recheck(){current();if(await borrow.recheck()!==undefined)fail('AUTH_TX_APPROVAL_RECHECK_RESULT');current();},
  enterOriginal(action){current();if(action!==state.action)fail('AUTH_TX_APPROVAL_ACTION_MISMATCH');if(borrow.enterOriginal(action)!==undefined)fail('AUTH_TX_APPROVAL_ENTER_RESULT');current();},
  completeOriginal(result){peerCurrent(state);if(borrow.completeOriginal(result)!==undefined)fail('AUTH_TX_APPROVAL_COMPLETE_RESULT');current(result);},
  assertCompletedCurrent(result){current(result);},
  retire(){if(recognized&&borrow.retire()!==undefined)fail('AUTH_TX_APPROVAL_RETIRE_RESULT');},
  async join(){if(recognized&&await borrow.join()!==undefined)fail('AUTH_TX_APPROVAL_JOIN_RESULT');},
  async close(){
   let failed=false,first;
   try{if(recognized){if(await borrow.close()!==undefined)fail('AUTH_TX_APPROVAL_CLOSE_RESULT');borrowCustody.delete(borrow);}}catch(e){failed=true;first=e;}
   try{if(state&&ownsCapsule)dispose(state);}catch(e){if(!failed){failed=true;first=e;}}
   if(failed)throw first;
  },
 };
 // Capture same private peer/borrow before any asynchronous validation. Even
 // a failed factory returns this partial in the error; no nil success/auto retry.
 const owner=new TransactionPermissionKernel(request,peer);
 try{
  // Capture a genuine branded borrow synchronously BEFORE request schema,
  // expiry, peerCurrent or any await. Those failures still owe real cleanup.
  // One borrowed object may never be adopted by two owners simultaneously;
  // a duplicate partial must not dispose another active/uncertain custody.
  if(isOriginalPQTransactionReviewBorrow(borrow)!==true)fail('AUTH_TX_APPROVAL_BORROW_NOT_RECOGNIZED');
  if(borrowCustody.has(borrow))fail('AUTH_TX_APPROVAL_BORROW_ALREADY_HELD');
  borrowCustody.set(borrow,owner);recognized=true;
  if(!state||state.used)fail('AUTH_TX_APPROVAL_CAPSULE_ALREADY_SELECTED');
  state.used=true;ownsCapsule=true;
  await owner.initialize();owner.assertCurrent();supplied.add(owner);return owner;
 }
 catch(cause){const error=Object.assign(new Error('AUTH_WALLET_TRANSACTION_PERMISSION_NOT_SUPPLIED',{cause}),{code:'AUTH_WALLET_TRANSACTION_PERMISSION_NOT_SUPPLIED'});Object.defineProperty(error,'partial',{value:owner});throw error;}
}


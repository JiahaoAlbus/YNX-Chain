// Original Main-only user-window evidence for DEVICE CREATION. This never
// grants account signing, registration, funds transfer, or Source admission.
// The Auth provisioning factory must separately bind the exact canonical SDK
// intent, original selected account, Source/current and durable create-once.
import {BrowserWindow} from 'electron';
import {isOriginalSelectedPQAccountPublicLease} from '../password-wallet-vault.mjs';
import {assertWalletIPC} from '../wallet-ipc-policy.mjs';
const expectedURL=new URL('../index.html',import.meta.url).href;
const capsules=new WeakMap(),peers=new WeakSet(),held=new Set();
const fail=code=>{throw Object.assign(Error(code),{code});};
function dispose(state){
 if(state.closed)return;state.closed=true;held.delete(state);
 state.sender.removeListener('destroyed',state.revoke);
 state.sender.removeListener('did-start-navigation',state.revoke);
}
function current(state){
 try{
  state.selectedPublicLease.assertCurrent();
  const now=Date.now();
  if(state.closed||state.revoked||now<state.clockFloor||now>=state.expires)fail('AUTH_DEVICE_CREATE_APPROVAL_RETIRED');
  state.clockFloor=now;
  const window=BrowserWindow.fromWebContents(state.sender);
  if(!window||window!==state.window||window.isDestroyed()||state.sender.isDestroyed()||state.sender.mainFrame!==state.frame)fail('AUTH_DEVICE_CREATE_APPROVAL_PEER_CHANGED');
  assertWalletIPC(state.event,state.sender,expectedURL);
  if(state.closed||state.revoked)fail('AUTH_DEVICE_CREATE_APPROVAL_RETIRED');
 }catch(cause){state.revoked=true;dispose(state);throw cause;}
}
export function captureOriginalWalletDeviceCreateApprovalIPC(event,reviewId,selectedPublicLease){
 if(!isOriginalSelectedPQAccountPublicLease(selectedPublicLease))fail('AUTH_DEVICE_CREATE_SELECTED_ACCOUNT_REQUIRED');
 selectedPublicLease.assertCurrent();
 if(typeof reviewId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(reviewId))fail('AUTH_DEVICE_CREATE_REVIEW_REQUIRED');
 const sender=event?.sender,window=sender&&BrowserWindow.fromWebContents(sender);
 if(!window||window.isDestroyed()||sender.isDestroyed())fail('AUTH_DEVICE_CREATE_APPROVAL_PEER_REQUIRED');
 assertWalletIPC(event,sender,expectedURL);
 for(const state of held)if(!state.consumed&&Date.now()>=state.expires)dispose(state);
 if(held.size>=64)fail('AUTH_DEVICE_CREATE_APPROVAL_CAPACITY');
 const issued=Date.now(),state={event,sender,window,selectedPublicLease,frame:event.senderFrame,reviewId,issued,expires:issued+30000,clockFloor:issued,consumed:false,closed:false,revoked:false};
 state.revoke=()=>{state.revoked=true;};
 sender.on('destroyed',state.revoke);sender.on('did-start-navigation',state.revoke);
 try{current(state);}catch(cause){dispose(state);throw cause;}
 const capsule=Object.freeze(Object.create(null));capsules.set(capsule,state);held.add(state);return capsule;
}
export function retireUnusedOriginalWalletDeviceCreateApproval(capsule){
 const state=capsules.get(capsule);if(state&&!state.consumed)dispose(state);
}
export function isOriginalWalletDeviceCreateApprovalPeer(peer){return peers.has(peer);}
/** A consumed capsule exposes only the original user-window decision. Passing
 * its public DATA to Native must never stand in for this same opaque peer.
 * Main's held canonical review and Auth's provisioning owner remain separate.
 */
export function claimOriginalWalletDeviceCreateApproval(capsule,reviewId){
 const state=capsules.get(capsule);
 if(!state||state.consumed||state.reviewId!==reviewId)fail('AUTH_DEVICE_CREATE_APPROVAL_CAPSULE_REQUIRED');
 current(state);state.consumed=true;
 const decision=Object.freeze({purpose:'device.create',reviewId,issuedAt:new Date(state.issued).toISOString(),expiresAt:new Date(state.expires).toISOString()});
 const peer=Object.freeze({
  assertCurrent:()=>{current(state);},
  recheck:async()=>{current(state);await state.selectedPublicLease.recheck();current(state);},
  readOriginalDecision:()=>{current(state);return decision;},
  retire:()=>{state.revoked=true;},
  close:()=>dispose(state)
 });
 peers.add(peer);return peer;
}

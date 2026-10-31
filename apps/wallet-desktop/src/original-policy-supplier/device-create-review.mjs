// Main-held exact review DATA. Creating this record grants no Source admission,
// device key generation, registration, account signature or funds permission.
import {randomUUID} from 'node:crypto';
import {inspectOriginalDeviceCreateIntentDATA,assertOriginalDeviceCreateIntentUnchangedDATA} from '@ynx-chain/wallet-auth/original-device-create-intent';
import {isOriginalSelectedPQAccountPublicLease} from '../password-wallet-vault.mjs';
const records=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code});};
export function readOriginalWalletDeviceCreateReview(review){
 const state=records.get(review);if(!state)fail('AUTH_DEVICE_CREATE_ORIGINAL_REVIEW_REQUIRED');
 state.assertCurrent();return state;
}
export function prepareOriginalWalletDeviceCreateReviewDATA(originalBytes,selectedPublicLease){
 if(!isOriginalSelectedPQAccountPublicLease(selectedPublicLease))fail('AUTH_DEVICE_CREATE_SELECTED_ACCOUNT_REQUIRED');
 const original=inspectOriginalDeviceCreateIntentDATA(originalBytes),selection=selectedPublicLease.readPublic(),terms=original.terms;
 if(selection.account!==terms.canonicalOwner||selection.networkId!==terms.networkId)fail('AUTH_DEVICE_CREATE_SELECTED_ACCOUNT_CHANGED');
 const issued=Date.parse(terms.issuedAt),expires=Date.parse(terms.expiresAt);let floor=0,retired=false;
 const assertCurrent=()=>{
  try{
   if(retired)fail('AUTH_DEVICE_CREATE_REVIEW_RETIRED');selectedPublicLease.assertCurrent();
   const now=Date.now();if(now<floor||now<issued||now>=expires)fail('AUTH_DEVICE_CREATE_REVIEW_EXPIRED');floor=now;
  }catch(cause){retired=true;throw cause;}
 };
 const id=randomUUID(),request=Object.freeze({id,origin:terms.origin,method:'ynx_createProductDevice',createdAt:terms.issuedAt,expiresAt:terms.expiresAt,review:Object.freeze({title:'创建应用设备密钥 / Create app device keys',purpose:'device.create',...terms,binding:original.binding,stableIdentityBinding:original.stableIdentityBinding,warning:'仅创建所列应用的设备密钥；不批准账户签名、转账或设备登记。 / Creates device keys for this app; account signing, transfers and device registration require separate approval.'})});
 const review=Object.freeze({id,request,assertCurrent,recheck:async()=>{assertCurrent();await selectedPublicLease.recheck();assertCurrent();},assertOriginalIntentDATA:current=>{assertCurrent();return assertOriginalDeviceCreateIntentUnchangedDATA(original,current);},close:()=>{retired=true;}});
 records.set(review,Object.freeze({id,request,original,selectedPublicLease,issued,expires,assertCurrent}));assertCurrent();return review;
}

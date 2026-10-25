import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';

// Execute the original Main approval branch, with no real keys, signing,
// source admission or network. A missing independent transaction permission
// must stop BEFORE the existing Vault callback or journal reservation.
const source=readFileSync(new URL('../src/desktop-wallet-authority.mjs',import.meta.url),'utf8');
const start=source.indexOf("case 'ynx_signPQNativeTransfer': {");
const end=source.indexOf('\n      case CENTRAL_BROWSER_METHOD:',start);
assert.ok(start>=0&&end>start,'original transfer approval branch is present');
const body=source.slice(start+"case 'ynx_signPQNativeTransfer': {".length,end).trim().replace(/}\s*$/,'').replaceAll('this.#','this.');

test('new native transfer cannot enter Vault or reserve an original without its independent transaction approval',async()=>{
 const account='0x'+'1'.repeat(40),networkId='a'.repeat(64),pending={id:'PUBLIC-review',review:{policyRevision:'1',expiresAt:'2099-01-01T00:00:00.000Z'}},snapshot=Object.freeze({PUBLIC:'already reviewed policy DATA'});
 const transfer=Object.freeze({chainId:networkId,nativeChainId:'6423',from:account,to:'0x'+'2'.repeat(40),amount:'3',fee:'1',nonce:'2'});
 let keyEntries=0,reservations=0;const keyEntryFailure=Error('PUBLIC_KEY_ENTRY_WITHOUT_TRANSACTION_PERMISSION');
 const store={reserveOriginal:async()=>{reservations++;},originalFailed(){}};
 const owner={recheck:async()=>({snapshot})};
 const state={pqReviews:new Map([[pending,{owner,snapshot,plan:{transfer}}]]),transactionSender:{submissions:{intentStore:store}},pqNetworkId:networkId,pqTxSource:null,pqTxRecognized:null,
  vault:{withPQKeys:async()=>{keyEntries++;throw keyEntryFailure;}},clock:()=>new Date('2026-10-25T00:00:00.000Z')};
 const run=runInNewContext('(async function approveOriginalTransfer(){'+body+'})',{
  pending,status:{account},guard:{assert(){}},permission:{assert(){}},capsule:undefined,createHash,
  providerError:(numeric,code,message)=>Object.assign(Error(message),{code:numeric,data:{code}}),
  assertPQAuthorizationCurrent:(before,after)=>assert.equal(before,after),planPQNativeTransfer:(_snapshot,value)=>({transfer:value}),
  encodePQNativeTransfer:()=>Buffer.from('PUBLIC exact-message placeholder; signer never executes'),deepFreeze:Object.freeze,pqRegisteredPublicBinding:()=>({PUBLIC:'pair DATA'})
 });
 const error=await run.call(state).then(()=>null,e=>e);
 console.log(JSON.stringify({keyEntries,reservations,code:error?.data?.code??error?.message,networkRequests:0,realSigning:0}));
 assert.equal(error?.data?.code,'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED');
 assert.equal(keyEntries,0);assert.equal(reservations,0);
});

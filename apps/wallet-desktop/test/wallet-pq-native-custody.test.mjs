import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PQ_PROTOCOL_VERSION,PQ_SUITE} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {createOriginalNativePQCustody} from '../src/wallet-pq-native-custody.mjs';
const f=JSON.parse(readFileSync(new URL('./fixtures/pq-account-initial-public.json',import.meta.url))),binding={protocolVersion:PQ_PROTOCOL_VERSION,suite:PQ_SUITE,chainId:f.expected.chainId,owner:f.expected.owner,pkA:Buffer.from(f.expected.pkA,'hex').toString('base64url'),pkB:Buffer.from(f.expected.pkB,'hex').toString('base64url')};
const request=()=>({messageOriginal:Buffer.from('PUBLIC CONTROL MESSAGE'),policyOriginal:Buffer.from('PUBLIC CONTROL POLICY'),nativeChainId:'6423',keyVersion:'1',executionHeight:'9007199254740993'});
// Controlled private-addon lifecycle only. No real Native crypto, Source,
// approval or valid transaction signature is claimed by these controls.
function setup(options={}){let selected=false,closed=false,member=Buffer.from('PUBLIC CONTROL RESULT'),credentialRef;const counts={open:0,once:0,copy:0,retire:0,close:0,release:0};
 const raw=()=>({callStatus:0,copyStatus:0,primitiveStatus:selected?(options.primitiveStatus??0):-1,cleanupStatus:selected?(options.cleanupStatus??2):0,selected,member:selected&&!(options.primitiveStatus)?Buffer.from(member):Buffer.alloc(0)});
 const native={originalPQCapabilities:()=>1,originalPQOpen(wire,credential,expected){counts.open++;credentialRef=credential;assert.equal(credential.length,43);assert.deepEqual(JSON.parse(expected),binding);return{status:0,ownerId:1n};},originalPQCurrent:()=>0,originalPQRetire:()=>{counts.retire++;return 0;},originalPQTransactionOnce(){counts.once++;selected=true;if(options.throwAfterResult)throw false;return raw();},originalPQCopyOutcome(){counts.copy++;return raw();},originalPQClose(){counts.close++;closed=true;return options.closeStatus??0;},originalPQReleaseClosed(){counts.release++;assert(closed);return 0;}};
 const custody=createOriginalNativePQCustody({load:()=>native});return{native,custody,counts,open:()=>custody.open(Buffer.from('PUBLIC ENCRYPTED BACKUP'),'A'.repeat(43),binding),credential:()=>credentialRef,change:()=>{member=Buffer.from('DIFFERENT PUBLIC RESULT');}};
}
test('private Native facade captures only public output once and wipes the temporary credential buffer',()=>{
 const h=setup(),owner=h.open(),seen=[];assert(h.credential().every(b=>b===0));assert.equal('ownerId' in owner,false);owner.transactionOnce(request(),v=>seen.push(v.member));assert.equal(seen.length,1);assert.match(seen[0].toString(),/PUBLIC CONTROL RESULT/);assert.throws(()=>owner.transactionOnce(request(),()=>{}),{code:'PQ_NATIVE_SIGN_ONCE'});owner.close(()=>assert.fail('Duplicate public capture'));owner.close(()=>{});assert.equal(h.counts.once,1);assert.equal(h.counts.close,1);assert.equal(h.counts.release,1);assert.equal(h.custody.cleanupUnresolved(),false);
});
test('lost Native acknowledgement retains original public output before propagating the falsy first cause',()=>{
 const h=setup({throwAfterResult:true}),owner=h.open(),seen=[];assert.throws(()=>owner.transactionOnce(request(),v=>seen.push(v.member)),e=>e===false);assert.equal(seen.length,1);assert.throws(()=>owner.transactionOnce(request(),()=>{}),{code:'PQ_NATIVE_SIGN_ONCE'});owner.close(()=>assert.fail('No repeated capture'));assert.equal(h.counts.once,1);assert.equal(h.custody.cleanupUnresolved(),false);
});
test('changed retained result or unknown primitive cleanup prevents owner release',()=>{
 for(const unknown of [false,true]){const h=setup(unknown?{cleanupStatus:0}:{}),owner=h.open();if(unknown)assert.throws(()=>owner.transactionOnce(request(),()=>{}));else{owner.transactionOnce(request(),()=>{});h.change();}assert.throws(()=>owner.close(()=>{}),{code:unknown?'PQ_NATIVE_CLEANUP_UNRESOLVED':'PQ_NATIVE_ORIGINAL_OUTCOME_CHANGED'});assert.equal(h.counts.release,0);assert.equal(h.custody.cleanupUnresolved(),true);}
});
test('Native close repeats its same first error, while confirmed closed identity can be released',()=>{
 const h=setup({primitiveStatus:6,closeStatus:106}),owner=h.open();assert.throws(()=>owner.transactionOnce(request(),()=>{}));let first;try{owner.close(()=>{});}catch(e){first=e;}assert.equal(first.nativeStatus,106);assert.throws(()=>owner.close(()=>{}),e=>e===first);assert.equal(h.counts.close,1);assert.equal(h.counts.release,1);assert.equal(h.custody.cleanupUnresolved(),false);
});
test('missing matching Native role, absent capture, shared inputs and retired owners cannot enter signing',()=>{
 const h=setup();h.native.originalPQCapabilities=()=>0;assert.throws(h.open,{code:'PQ_NATIVE_MATCHED_BINDING_REQUIRED'});assert.equal(h.counts.open,0);h.native.originalPQCapabilities=()=>1;const owner=h.open();assert.throws(()=>owner.transactionOnce(request()),{code:'PQ_NATIVE_ORIGINAL_CAPTURE_REQUIRED'});assert.throws(()=>owner.transactionOnce({...request(),messageOriginal:Buffer.from(new SharedArrayBuffer(8))},()=>{}));assert.equal(h.counts.once,0);owner.retire();assert.throws(()=>owner.transactionOnce(request(),()=>{}),{code:'PQ_NATIVE_RETIRED'});owner.close(()=>{});assert.equal(h.counts.once,0);
});
test('dedicated initial owner freezes public operands and never exposes ordinary transfer entry',()=>{
 const h=setup(),seen=[],input={messageOriginal:Buffer.from('PUBLIC E15'),genesisOriginal:Buffer.from('PUBLIC FULL GENESIS'),genesisPin:Buffer.alloc(32,7),nativeChainId:'6423',executionHeight:'9007199254740993'};
 h.native.originalPQCapabilities=()=>3;
 h.native.originalPQOpenInitial=(wire,credential,expected,message,genesis,pin,chain,height)=>{
  seen.push({message:Buffer.from(message),genesis:Buffer.from(genesis),pin:Buffer.from(pin),chain,height:height.toString()});
  return h.native.originalPQOpen(wire,credential,expected);
 };
 h.native.originalPQInitialOnce=function(id){assert.equal(arguments.length,1);return h.native.originalPQTransactionOnce();};
 const owner=h.custody.openInitial(Buffer.from('PUBLIC ENCRYPTED BACKUP'),'A'.repeat(43),binding,input);
 input.messageOriginal.fill(0);input.genesisOriginal.fill(0);input.genesisPin.fill(0);
 assert.equal(owner.transactionOnce,undefined);assert.equal(seen[0].message.toString(),'PUBLIC E15');assert.equal(seen[0].genesis.toString(),'PUBLIC FULL GENESIS');assert(seen[0].pin.every(b=>b===7));assert.equal(seen[0].chain,6423n);assert.equal(seen[0].height,'9007199254740993');
 const results=[];owner.initialOnce(v=>results.push(v));assert.equal(results.length,1);assert.throws(()=>owner.initialOnce(()=>{}),{code:'PQ_NATIVE_SIGN_ONCE'});owner.close(()=>assert.fail('No repeated capture'));assert.equal(h.counts.once,1);assert.equal(h.counts.release,1);
});
test('initial role and exact operands refuse before any key open without generic purpose fallback',()=>{
 const h=setup(),input={messageOriginal:Buffer.from('PUBLIC E15'),genesisOriginal:Buffer.from('PUBLIC FULL GENESIS'),genesisPin:Buffer.alloc(32),nativeChainId:'6423',executionHeight:'1'};
 assert.throws(()=>h.custody.openInitial(Buffer.from('PUBLIC ENCRYPTED BACKUP'),'A'.repeat(43),binding,input),{code:'PQ_NATIVE_MATCHED_BINDING_REQUIRED'});
 for(const patch of [{genesisPin:Buffer.alloc(31)},{genesisOriginal:Buffer.from(new SharedArrayBuffer(8))},{executionHeight:'18446744073709551616'},{nativeChainId:'1'}])assert.throws(()=>h.custody.openInitial(Buffer.from('PUBLIC ENCRYPTED BACKUP'),'A'.repeat(43),binding,{...input,...patch}),{code:'PQ_NATIVE_INITIAL_BINDING_REQUIRED'});
 assert.equal(h.counts.open,0);assert.equal(h.counts.once,0);
});

// PUBLIC synthetic policy and ephemeral keys. No Source, consent or chain effect.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {decodeMember} from '@ynx/batch-v01-candidate';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,signPQWalletNativeAction} from '../src/pq-wallet-key-backup.js';
import {parsePQAccountAuthorization,planPQNativeAction,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {encodePQNativeAction} from '../src/pq-native-action.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {verifyPQRegisteredMemberData} from '../src/pq-registered-member.js';
const rows=JSON.parse(readFileSync(new URL('../testdata/pq-native-action-go-interop-9dc.json',import.meta.url))).rows;
const network={chainId:rows[0].chainId,nativeChainId:rows[0].nativeChainId,owner:rows[0].owner},H='9007199254740993';
const fee=kind=>kind==='contract_deploy'?'10':kind==='contract_execute'?'2':['stake','resource_delegation_create','resource_rental_create'].includes(kind)?'0':'1';
function input(row=rows[0]){const payload=structuredClone(row.payload);if(row.kind==='dex_asset_create')payload.decimals=Number(payload.decimals);if(row.kind==='dex_pool_create')payload.feeBps=Number(payload.feeBps);return {chainId:row.chainId,nativeChainId:row.nativeChainId,owner:row.owner,nonce:'9007199254740994',fee:fee(row.kind),kind:row.kind,payload};}
const record=(pair,revision='1',registeredAt='10',activeFrom='11',ledgerNonce='1')=>({algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:pair.pkA,pkB:pair.pkB,revision,registeredAt,activeFrom,ledgerNonce});
const dto=pair=>({owner:network.owner,executionHeight:H,ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[record(pair)]});
const parse=value=>parsePQAccountAuthorization(value,network);
test('typed Native Action signs all 18 Go input shapes as full-payload N1 TX-BATCH Members',async()=>{
 const handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
 try{const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle)),snapshot=parse(dto(pair));
 for(const row of rows){const action=input(row),plan=planPQNativeAction(snapshot,action);assert.equal(plan.kind,'pq-native-action');assert.equal(plan.policy.policyRevision,'1');assert.equal(plan.policy.nextNonce,action.nonce);assert(Object.isFrozen(plan)&&Object.isFrozen(plan.action)&&Object.isFrozen(plan.action.payload));
 const wire=signPQWalletNativeAction(handle,action,snapshot),member=decodeMember(Buffer.from(wire));assert.equal(member.certificate.N,1);assert.equal(member.index,0);assert.equal(member.certificate.purpose,'TX-BATCH');assert.deepEqual(member.message,Buffer.from(encodePQNativeAction(action)));assert.equal(member.certificate.pkA.toString('hex'),pair.pkA);assert.equal(member.certificate.pkB.toString('hex'),pair.pkB);
 const checked=verifyPQRegisteredMemberData(snapshot,wire,{chainId:network.chainId,owner:network.owner,keyVersion:'1',executionHeight:H,purpose:'TX-BATCH',message:encodePQNativeAction(action)});assert.equal(checked.signatureVerified,true);assert.equal(checked.nativeAdmission,false);}
 const action=input();const wire=signPQWalletNativeAction(handle,action,snapshot);action.payload.amount='2';assert.notDeepEqual(decodeMember(Buffer.from(wire)).message,Buffer.from(encodePQNativeAction(action)));
 }finally{destroyPQWalletKeyHandle(handle);}
});
test('typed Action policy requires branded current full policy, exact network/owner/nonce and executor fee',()=>{
 const pair={pkA:'11'.repeat(2592),pkB:'22'.repeat(64)},snapshot=parse(dto(pair)),action=input();
 assert.throws(()=>planPQNativeAction({...snapshot},action),{code:'PQ_POLICY_SNAPSHOT_REQUIRED'});
 for(const changes of [{chainId:'ff'.repeat(32)},{nativeChainId:'6423'},{owner:'0x'+'13'.repeat(20)},{nonce:'9007199254740993'},{nonce:'9007199254740995'},{fee:'7'}])assert.throws(()=>planPQNativeAction(snapshot,{...action,...changes}),{code:'PQ_ACTION_REVIEW_MISMATCH'});
 assert.throws(()=>planPQNativeAction(snapshot,'raw message'));assert.throws(()=>planPQNativeAction(snapshot,{...action,kind:'raw_sign'}));
 const max=parse({...dto(pair),ledgerNonce:'18446744073709551614'});assert.equal(planPQNativeAction(max,{...action,nonce:'18446744073709551615'}).action.nonce,'18446744073709551615');
 assert.throws(()=>planPQNativeAction(parse({...dto(pair),ledgerNonce:'18446744073709551615'}),action),{code:'PQ_LEDGER_NONCE_EXHAUSTED'});
 const pending={...dto(pair),executionHeight:'10',algorithmVersion:'legacy'};delete pending.activeRevision;assert.throws(()=>planPQNativeAction(parse(pending),action),{code:'PQ_ACCOUNT_MIGRATION_REQUIRED'});
 const disabled={owner:network.owner,executionHeight:'1',ledgerNonce:'0',algorithmVersion:'legacy',enabled:false,records:[]};assert.throws(()=>planPQNativeAction(parse(disabled),action));
 const revoked=parse({...dto(pair),policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:'20',revokedFrom:'21',ledgerNonce:'2'}]});assert.throws(()=>planPQNativeAction(revoked,action),{code:'PQ_ACCOUNT_REVOKED'});
 assert.throws(()=>assertPQAuthorizationCurrent(snapshot,parse({...dto(pair),ledgerNonce:'9007199254740994'})),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
 let getters=0;assert.throws(()=>planPQNativeAction(snapshot,{...action,get payload(){getters++;return action.payload;}}));assert.equal(getters,0);
});
test('typed Action signer refuses foreign, mixed-pair, rotated, copied and retired custody',async()=>{
 const handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner}),other=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
 try{const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle)),second=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(other)),snapshot=parse(dto(pair)),action=input();
 assert.throws(()=>signPQWalletNativeAction({},action,snapshot),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});assert.throws(()=>signPQWalletNativeAction(handle,action,{...snapshot}),{code:'PQ_POLICY_SNAPSHOT_REQUIRED'});
 for(const keys of [second,{pkA:second.pkA,pkB:pair.pkB},{pkA:pair.pkA,pkB:second.pkB}])assert.throws(()=>signPQWalletNativeAction(handle,action,parse(dto(keys))),{code:'PQ_CURRENT_REGISTERED_KEY_MISMATCH'});
 for(const alt of [{...network,chainId:'ff'.repeat(32)},{...network,owner:'0x'+'13'.repeat(20)}]){const altDTO={...dto(pair),owner:alt.owner,networkId:alt.chainId,records:[{...record(pair),owner:alt.owner}]};const altSnapshot=parsePQAccountAuthorization(altDTO,alt);assert.throws(()=>signPQWalletNativeAction(handle,{...action,chainId:alt.chainId,owner:alt.owner},altSnapshot),{code:'PQ_CURRENT_REGISTERED_KEY_MISMATCH'});}
 const rotated=parse({...dto(pair),activeRevision:'2',records:[record(pair),record(second,'2','20','21','2')]});assert.throws(()=>signPQWalletNativeAction(handle,action,rotated),{code:'PQ_CURRENT_REGISTERED_KEY_MISMATCH'});
 destroyPQWalletKeyHandle(handle);assert.throws(()=>signPQWalletNativeAction(handle,action,snapshot),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});
 }finally{destroyPQWalletKeyHandle(handle);destroyPQWalletKeyHandle(other);}
});

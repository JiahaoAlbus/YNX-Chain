import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {keyGen,destroyKey,batchSign,extract,encodeMember,discardBatch,encodeFields} from '@ynx/batch-v01-candidate';
import * as wire from '../src/pq-wallet-authorization.js';
const intent=()=>({chainId:'01'.repeat(32),owner:'0x'+'11'.repeat(20),algorithmVersion:'YNX-BATCH/v0.1',pkA:'22'.repeat(2592),pkB:'33'.repeat(64),authorizingRevision:'1',throughRevision:'2',ledgerNonce:'3',executeAt:'25',revokeAt:'26'});

test('revocation wire matches frozen Go high-U64 signing vector exactly',()=>{
 const r={...intent(),chainId:Buffer.from(Array.from({length:32},(_,i)=>i)).toString('hex'),pkA:Buffer.from(Array.from({length:2592},(_,i)=>i&255)).toString('hex'),pkB:Buffer.from(Array.from({length:64},(_,i)=>255-i)).toString('hex'),authorizingRevision:((1n<<35n)+3n).toString(),throughRevision:((1n<<35n)+4n).toString(),ledgerNonce:((1n<<55n)+5n).toString(),executeAt:((1n<<48n)+19n).toString(),revokeAt:((1n<<48n)+20n).toString()};
 const b=wire.encodePQRevocationIntent(r);assert.equal(b.length,2885);assert.equal(createHash('sha256').update(b).digest('hex'),'4a79f4f550d9f297b9d6bbff1a6413a1d1a8d477f1b8d52dea14d1a085e27a10');assert.deepEqual(wire.decodePQRevocationIntent(b),r);
});
test('revocation exact grammar refuses alternate authority, malformed sequence and unbounded bytes',()=>{
 for(const patch of [{classicSignature:'PUBLIC'},{algorithmVersion:'legacy'},{authorizingRevision:'0'},{throughRevision:'0'},{ledgerNonce:'0'},{executeAt:'0',revokeAt:'1'},{executeAt:wire.PQ_U64_MAX.toString(),revokeAt:'0'},{revokeAt:'27'},{ledgerNonce:3},{executeAt:'025'},{owner:'YNX-display-alias'},{pkA:'11'},{chainId:'FF'.repeat(32)}])assert.throws(()=>wire.encodePQRevocationIntent({...intent(),...patch}));
 const b=wire.encodePQRevocationIntent(intent());assert.throws(()=>wire.decodePQRevocationIntent(Buffer.concat([b,Buffer.from([0])])));assert.throws(()=>wire.decodePQRevocationIntent(new Uint8Array(new SharedArrayBuffer(b.length))));assert.throws(()=>wire.decodePQRevocationRequest(Buffer.alloc(131073)));
 let touched=false;const r=intent();Object.defineProperty(r,'owner',{enumerable:true,get(){touched=true;return intent().owner;}});assert.throws(()=>wire.normalizePQRevocationIntent(r));assert.equal(touched,false);
});
// Real fresh provider keys and signatures, synthetic context only. These never
// represent a registered account, user approval, chain admission or finality.
test('revocation envelope admits exact current-pair N1 only and retains detached original transport',()=>{
 const key=keyGen({provider:'portable'}),batches=[];
 try{
  const r={...intent(),pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex')},message=wire.encodePQRevocationIntent(r);
  const sign=(purpose,messages)=>{const s=batchSign(key.privateKey,{chainId:Buffer.from(r.chainId,'hex'),owner:r.owner,purpose},messages);batches.push(s.batch);return s;};
  const s=sign('ACCOUNT-REVOCATION',[message]),member=encodeMember(extract(s.batch,0)),original=wire.encodePQRevocationRequest({intent:r,currentPQMember:member}),decoded=wire.decodePQRevocationRequest(original),transport=wire.preparePQRevocationTransport(original);
  assert.deepEqual(decoded.intent,r);assert.equal(decoded.purpose,'ACCOUNT-REVOCATION');assert.equal(decoded.N,1);assert.equal(decoded.pkA,r.pkA);assert.equal(transport.path,'/accounts/'+r.owner+'/authorization/revoke');assert.equal(transport.admissionIsFinality,false);assert.equal(transport.transportHash,wire.pqWireHash(original));
  const saved=transport.body;original.fill(0);member.fill(0);transport.body.fill(0);assert.deepEqual(transport.body,saved);assert.equal(Object.hasOwn(transport,'classicSignature'),false);
  for(const bad of [sign('ACCOUNT-MIGRATION',[message]),sign('ACCOUNT-REVOCATION',[message,message]),sign('ACCOUNT-REVOCATION',[wire.encodePQRevocationIntent({...r,ledgerNonce:'4'})])])assert.throws(()=>wire.encodePQRevocationRequest({intent:r,currentPQMember:encodeMember(extract(bad.batch,0))}));
  assert.throws(()=>wire.encodePQRevocationRequest({intent:{...r,pkB:'44'.repeat(64)},currentPQMember:decoded.currentPQMember}));assert.throws(()=>wire.encodePQRevocationRequest({intent:r,currentPQMember:s.wholeWire}));assert.throws(()=>wire.encodePQRevocationRequest({intent:r,currentPQMember:decoded.currentPQMember,classicSignature:Buffer.alloc(0)}));assert.throws(()=>wire.decodePQRevocationRequest(encodeFields([wire.PQ_REVOCATION_DOMAIN,message,decoded.currentPQMember,Buffer.alloc(0)])));
 }finally{for(const b of batches)discardBatch(b);destroyKey(key.privateKey);}
});

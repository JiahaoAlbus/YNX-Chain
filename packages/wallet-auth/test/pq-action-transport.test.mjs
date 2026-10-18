import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {decodeMember, encodeMember, encodeFields} from '@ynx/batch-v01-candidate';
import {decodePQNativeAction, encodePQNativeAction} from '../src/pq-native-action.js';
import {parsePQAccountAuthorization} from '../src/pq-wallet-policy.js';
import {encodePQActionTransportData, decodePQActionTransportData} from '../src/pq-action-transport.js';
import {preparePQNativeActionTransportData} from '../src/pq-action-transport-node.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../testdata/pq-staking-originals-fd8-public.json',import.meta.url)));
const wire=Buffer.from(fixture.pqAction.memberWire,'base64'),body=Buffer.from(fixture.pqAction.transport,'base64');
const original=decodeMember(wire),action=decodePQNativeAction(original.message);
const originals=JSON.parse(body).originals.map(v=>Uint8Array.from(Buffer.from(v,'base64')));
const hash=b=>createHash('sha256').update(b).digest('hex');
function snapshot(patch={},record={}){
  const input={owner:action.owner,executionHeight:'4',ledgerNonce:'2',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:action.chainId,enableAt:'1',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:action.owner,pkA:original.certificate.pkA.toString('hex'),pkB:original.certificate.pkB.toString('hex'),revision:'1',registeredAt:'1',activeFrom:'2',ledgerNonce:'1',...record}],...patch};
  return parsePQAccountAuthorization(input,{chainId:input.networkId,nativeChainId:'6423',owner:input.owner});
}
test('fixed actual Go transport roundtrips exact four fields and preserves N2/index1 bytes',()=>{
  assert.equal('0x'+hash(wire),fixture.pqAction.nativeTransactionHash);
  assert.equal('0x'+hash(body),fixture.pqAction.abciTransactionHash);
  assert.equal(original.certificate.N,2);assert.equal(original.index,1);
  const decoded=decodePQActionTransportData(body);
  assert.deepEqual(Buffer.from(decoded.member),wire);
  assert.deepEqual(Buffer.from(encodePQActionTransportData({member:decoded.member,originals:decoded.originals})),body);
  assert.equal(decoded.dataOnly,true);assert.equal(decoded.nativeAdmission,false);assert.equal(decoded.memberValidationRequired,true);
  const detached=decoded.member;detached.fill(0);assert.deepEqual(Buffer.from(decoded.member),wire);
  decoded.originals[0].fill(0);assert.deepEqual(Buffer.from(decoded.originals[0]),Buffer.from(originals[0]));
});
test('empty originals preserve exact legacy three fields; noncanonical envelopes refuse',()=>{
  const three=Buffer.from(encodePQActionTransportData({member:wire,originals:[]}));
  assert.equal(three.toString(),JSON.stringify({version:1,type:'pq_action',wireHex:wire.toString('hex')}));
  const parsed=JSON.parse(body);
  for(const bad of [JSON.stringify({...parsed,extra:true}),JSON.stringify({...parsed,originals:null}),JSON.stringify({...parsed,originals:[]}),JSON.stringify({...parsed,wireHex:parsed.wireHex.toUpperCase()}),JSON.stringify({...parsed,originals:[parsed.originals[0].replace(/=+$/,'')]}),'{"version":1,'+body.toString().slice(1),body+'\n',JSON.stringify({type:parsed.type,version:1,wireHex:parsed.wireHex}),JSON.stringify({version:1,type:'pq_action'})]){
    assert.throws(()=>decodePQActionTransportData(new TextEncoder().encode(bad)));
  }
});
test('pure byte wrapper works without Node Buffer and rejects shared, accessor and oversized inputs',()=>{
  const ordinary=Uint8Array.from(wire),saved=globalThis.Buffer;
  try{globalThis.Buffer=undefined;const bytes=encodePQActionTransportData({member:ordinary,originals});assert.equal(decodePQActionTransportData(bytes).originals.length,1);}finally{globalThis.Buffer=saved;}
  let getterCalls=0;assert.throws(()=>encodePQActionTransportData({get member(){getterCalls++;throw Error('getter executed');},originals:[]}));assert.equal(getterCalls,0);
  assert.throws(()=>encodePQActionTransportData({member:new Uint8Array(new SharedArrayBuffer(1)),originals:[]}));
  assert.throws(()=>encodePQActionTransportData({member:new Uint8Array(131073),originals:[]}));
  assert.throws(()=>encodePQActionTransportData({member:wire,originals:[new Uint8Array(16385)]}));
  assert.throws(()=>decodePQActionTransportData(new Uint8Array((24<<20)+1)));
});
test('existing full Member verifier binds both keys, network, current nonce and snapshot; no new N1 restriction',()=>{
  const result=preparePQNativeActionTransportData(snapshot(),{member:wire,originals});
  assert.deepEqual(Buffer.from(result.body),body);assert.equal(result.memberCount,2);assert.equal(result.memberIndex,1);
  assert.equal(result.dataOnly,true);assert.equal(result.nativeAdmission,false);assert.equal(result.classicWitnessValidationRequired,true);
  assert.throws(()=>preparePQNativeActionTransportData({...snapshot()},{member:wire,originals}));
  assert.throws(()=>preparePQNativeActionTransportData(snapshot({networkId:'ff'.repeat(32)}),{member:wire,originals}));
  assert.throws(()=>preparePQNativeActionTransportData(snapshot({}, {pkB:'00'.repeat(64)}),{member:wire,originals}));
  assert.throws(()=>preparePQNativeActionTransportData(snapshot({ledgerNonce:'3'}),{member:wire,originals}));
  const changed={...original,message:encodeFields(['not-an-action'])};
  assert.throws(()=>preparePQNativeActionTransportData(snapshot(),{member:encodeMember(changed),originals}));
});
test('semantic adapter refuses originals for non-staking Member before any signature claim',()=>{
  const other={...action,kind:'stake',fee:'0',payload:{amount:'1'}};
  const member=encodeMember({...original,message:Buffer.from(encodePQNativeAction(other))});
  assert.throws(()=>preparePQNativeActionTransportData(snapshot(),{member,originals}),{code:'PQ_ACTION_ORIGINALS_KIND_INVALID'});
});
test('oversized originals count refuses before allocating or enumerating millions of descriptors',()=>{
  let enumerations=0;
  const huge=new Proxy(new Array(3600000),{ownKeys(){enumerations++;throw Error('bulk descriptors must not be allocated');}});
  assert.throws(()=>encodePQActionTransportData({member:wire,originals:huge}),{code:'PQ_ACTION_TRANSPORT_INVALID'});
  assert.equal(enumerations,0);
});

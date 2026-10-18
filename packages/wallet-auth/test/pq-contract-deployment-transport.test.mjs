// PUBLIC controlled byte/material inputs and ephemeral test keys only.
// This is not an actual compiler artifact, Go deployment fixture or Source grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {capturePQContractDeploymentMaterialData,encodePQContractDeploymentTransportData,decodePQContractDeploymentTransportData} from '../src/pq-contract-deployment-transport.js';
import {preparePQContractDeploymentTransportData} from '../src/pq-contract-deployment-transport-node.js';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,signPQWalletNativeAction} from '../src/pq-wallet-key-backup.js';
import {parsePQAccountAuthorization} from '../src/pq-wallet-policy.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
const te=new TextEncoder();
const f=JSON.parse(fs.readFileSync(new URL('../testdata/pq-staking-originals-fd8-public.json',import.meta.url)));
const member=Uint8Array.from(Buffer.from(f.pqAction.memberWire,'base64'));
const input=()=>({member,source:'a<>&\u2028\u2029z',material:{artifactFile:new Uint8Array([1,2,3]),buildInfoFile:new Uint8Array([4])}});
test('opaque five-field wrapper uses exact Go order/escaping and raw standard-base64 files',()=>{
  const value=input(),raw=encodePQContractDeploymentTransportData(value);
  const expected='{"version":1,"type":"pq_action","wireHex":"'+Buffer.from(member).toString('hex')+'","source":"a\\u003c\\u003e\\u0026\\u2028\\u2029z","material":{"artifactFile":"AQID","buildInfoFile":"BA=="}}';
  assert.equal(new TextDecoder().decode(raw),expected);
  const decoded=decodePQContractDeploymentTransportData(raw);
  assert.deepEqual(decoded.member,member);assert.equal(decoded.source,value.source);
  assert.deepEqual(decoded.material,value.material);assert.equal(decoded.compilerMaterialValidationRequired,true);assert.equal(decoded.nativeAdmission,false);
  value.material.artifactFile.fill(0);decoded.material.buildInfoFile.fill(0);
  assert.deepEqual(decodePQContractDeploymentTransportData(raw).material.artifactFile,new Uint8Array([1,2,3]));
  assert.deepEqual(Buffer.from(encodePQContractDeploymentTransportData({member:decoded.member,source:decoded.source,material:decoded.material})),Buffer.from(raw));
});
test('material capture is a pre-key DATA fence with Go whitespace, UTF8 byte limits and no reencoding',()=>{
  for(const source of ['', ' x','x\u0085','\u3000x','x\u2029','\ud800', 'é'.repeat(32769)]){
    assert.throws(()=>capturePQContractDeploymentMaterialData({source,material:input().material}));
  }
  const bytes=te.encode('{"nonce":18446744073709551615, "doNotReformat":true}');
  const captured=capturePQContractDeploymentMaterialData({source:'\ufeffx',material:{artifactFile:bytes,buildInfoFile:bytes}});
  bytes.fill(0);
  assert.equal(captured.source,'\ufeffx');assert.equal(captured.dataOnly,true);assert.equal(captured.nativeAdmission,false);
  assert.equal(new TextDecoder().decode(captured.material.artifactFile),'{"nonce":18446744073709551615, "doNotReformat":true}');
  for(const material of [{artifactFile:new Uint8Array(),buildInfoFile:new Uint8Array([1])},{artifactFile:new Uint8Array(131073),buildInfoFile:new Uint8Array([1])},{artifactFile:new Uint8Array([1]),buildInfoFile:new Uint8Array((16<<20)+1)}]){
    assert.throws(()=>capturePQContractDeploymentMaterialData({source:'x',material}));
  }
  assert.throws(()=>capturePQContractDeploymentMaterialData({source:'x',material:null}));
});
test('portable five-field decoder refuses missing/mixed/unknown/noncanonical material fields',()=>{
  const raw=encodePQContractDeploymentTransportData(input()),text=new TextDecoder().decode(raw),parsed=JSON.parse(text);
  for(const bad of [text+'\n',text.replace('\\u003c','<'),JSON.stringify({...parsed,originals:[]}),JSON.stringify({...parsed,source:''}),JSON.stringify({...parsed,material:null}),JSON.stringify({...parsed,material:{artifactFile:'AQID'}}),JSON.stringify({...parsed,material:{artifactFile:'AQID',buildInfoFile:'BA'}}),JSON.stringify({...parsed,material:{buildInfoFile:'BA==',artifactFile:'AQID'}}),JSON.stringify({...parsed,material:{...parsed.material,extra:true}})]){
    assert.throws(()=>decodePQContractDeploymentTransportData(te.encode(bad)));
  }
  const {material,...four}=parsed;assert.throws(()=>decodePQContractDeploymentTransportData(te.encode(JSON.stringify(four))));
});
test('portable material copy uses intrinsic byte access and needs no Node Buffer',()=>{
  const value=input();let calls=0;
  for(const key of ['resizable','detached'])Object.defineProperty(value.material.artifactFile.buffer,key,{get(){calls++;return false;}});
  const saved=globalThis.Buffer;
  try{globalThis.Buffer=undefined;assert.equal(decodePQContractDeploymentTransportData(encodePQContractDeploymentTransportData(value)).nativeAdmission,false);}finally{globalThis.Buffer=saved;}
  assert.equal(calls,0);
  let getters=0;assert.throws(()=>capturePQContractDeploymentMaterialData({source:'x',get material(){getters++;return value.material;}}));assert.equal(getters,0);
});
test('original compiler files remain byte-exact and raw source is never silently normalized',()=>{
  const originals=JSON.parse(fs.readFileSync(new URL('../testdata/pq-contract-counter-original-material-3163.json',import.meta.url)));
  const raw=Object.fromEntries(Object.entries(originals.raw).map(([k,v])=>[k,new Uint8Array(Buffer.from(v,'base64'))]));
  for(const pin of originals.provenance.files){
    assert.equal(raw[pin.role].length,pin.bytes);
    assert.equal(createHash('sha256').update(raw[pin.role]).digest('hex'),pin.sha256);
  }
  const material={artifactFile:raw.artifactFile,buildInfoFile:raw.buildInfoFile};
  assert.equal(raw.sourceFile.at(-1),10);
  assert.throws(()=>capturePQContractDeploymentMaterialData({source:new TextDecoder().decode(raw.sourceFile),material}));
  // Explicit controlled text only: this does not assert that it matches these
  // compiler files. The original Go compiler-material validator still must run.
  const controlled=capturePQContractDeploymentMaterialData({source:'controlled',material});
  assert.deepEqual(controlled.material,material);
  assert.equal(controlled.compilerMaterialValidationRequired,true);
  assert.equal(originals.provenance.actualSignedDeployEnvelopeSupplied,false);
});
test('Node deployment adapter reuses original full Member/snapshot checks without certifying compiler material',async()=>{
  const row=JSON.parse(fs.readFileSync(new URL('../testdata/pq-native-action-go-interop-9dc.json',import.meta.url))).rows.find(r=>r.kind==='contract_deploy');
  const network={chainId:row.chainId,nativeChainId:row.nativeChainId,owner:row.owner};
  const handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
  try{
    const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
    const dto={owner:network.owner,executionHeight:'4',ledgerNonce:'2',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'1',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:keys.pkA,pkB:keys.pkB,revision:'1',registeredAt:'1',activeFrom:'2',ledgerNonce:'1'}]};
    const snapshot=parsePQAccountAuthorization(dto,network),action={...network,kind:'contract_deploy',fee:'10',nonce:'3',payload:row.payload};
    const signed=signPQWalletNativeAction(handle,action,snapshot),value={...input(),member:signed};
    const result=preparePQContractDeploymentTransportData(snapshot,value);
    assert.equal(result.action.kind,'contract_deploy');assert.equal(result.signatureVerified,true);
    assert.equal(result.compilerMaterialValidationRequired,true);assert.equal(result.nativeAdmission,false);
    assert.equal(result.memberCount,1);assert.equal(result.memberIndex,0);
    assert.throws(()=>preparePQContractDeploymentTransportData({...snapshot},value));
    assert.throws(()=>preparePQContractDeploymentTransportData(snapshot,{...value,member}),{code:'PQ_CONTRACT_DEPLOYMENT_KIND_INVALID'});
    const wrong=parsePQAccountAuthorization({...dto,ledgerNonce:'3'},network);
    assert.throws(()=>preparePQContractDeploymentTransportData(wrong,value));
    const mixed=parsePQAccountAuthorization({...dto,records:[{...dto.records[0],pkB:'00'.repeat(64)}]},network);
    assert.throws(()=>preparePQContractDeploymentTransportData(mixed,value));
  }finally{destroyPQWalletKeyHandle(handle);}
});

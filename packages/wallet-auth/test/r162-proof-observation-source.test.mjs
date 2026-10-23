import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifySDK332R140Source,sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';

const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const selectedVersion=JSON.parse(readFileSync(resolve(root,'packages/wallet-auth/package.json'))).version;
assert.ok(['1.3.0-pq.3.32-auth.10','1.3.0-pq.3.32-auth.11','1.3.0-pq.3.32-auth.12','1.3.0-pq.3.32-auth.13'].includes(selectedVersion));
const read=path=>readFileSync(resolve(root,path));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Independent supplier R162 H6843/67c056ae...; source selection only. These
// checks do not rerun PUBLIC Auth fixtures or claim any real N1/Root/effect.
const r164=selectedVersion.match(/^1\.3\.0-pq\.3\.32-auth\.(12|13)$/)!==null;
const leaves=r164?[
 ['original-auth-identity-source-authority.mm',45318,'0a4384cd537a56ff0cfcf067a013deef6bcef671c9092e67e272c65547dd468f'],
 ['original-auth-identity-source-authority.h',6035,'ce8645d7bffd55bc74b9eabd16d3b49b01f5be763e3084055eb63ac47570fa16'],
 ['original-ide-auth-proof-source.inc.mm',17824,'5c4a4ebd3251de6862763a40ea48e48123503b789f0438e06b96a50e5bb95826'],
]:[
 ['original-auth-identity-source-authority.mm',45163,'d8ea4c3651b5d373c416ca904e79a11d76e8909b5b4a4c94539188085046c7d4'],
 ['original-auth-identity-source-authority.h',5640,'9fab18dc544820970e3f8a633f78408d9125ef7d87b7778e2f9795f2191b36cf'],
 ['original-ide-auth-proof-source.inc.mm',17824,'5c4a4ebd3251de6862763a40ea48e48123503b789f0438e06b96a50e5bb95826'],
];
test('Inherited R162 proof and exact successor Source leaves match normal source selector',()=>{
 const {contract}=verifySDK332R140Source(root);
 assert.equal(contract.version,selectedVersion);
 assert.equal(contract.NativeInputs.length,r164?69:64);assert.equal(contract.HelperInputs.length,5);
 for(const [name,bytes,hash]of leaves){
  const path='packages/wallet-auth/native/'+name,actual=read(path),pin=contract.NativeInputs.find(p=>p.path===path);
  assert.ok(pin);assert.equal(actual.length,bytes);assert.equal(sha(actual),hash);assert.equal(pin.bytes,bytes);assert.equal(pin.sha256,hash);
 }
});
test('Inherited proof keeps exact selected Node/helper recipes and entry identity',async()=>{
 const selected=await sdk332R140NativePlan(root,'/original/pinned/headers','arm64');
 assert.equal(selected.plan.sources.length,r164?13:12);assert.equal(selected.helperPlan.sources.length,11);
 for(const plan of [selected.plan,selected.helperPlan])assert.equal(plan.sources.filter(p=>p.endsWith('/original-auth-identity-source-authority.mm')).length,1);
 // R164 supersedes the Source/Node entry with Relay methods while the inherited
 // proof remains private DATA. Public signing exports stay unchanged.
 assert.equal(sha(read('apps/wallet-desktop/native/original-auth-identity-node.mm')),r164?'208f88b06818eb60b3d856c8a83d2da23ec1e6f557f2656d8f8ee3f129173b8d':'cca146d0381e57d7cb54cc7e146e033c4ed5d02a1106a11754dee5ca89c43561');
 assert.equal(sha(Buffer.from(JSON.stringify(JSON.parse(read('packages/wallet-auth/package.json')).exports))),'9911a84fcc30dc60811bb257df1499dd213a1c89c45b7dbbec8d9cc0b088b5cb');
 assert.equal(selected.NativeBuild,false);assert.equal(selected.artifactNativeEffectQualified,false);assert.equal(selected.grant,false);
});
test('R162 private observation header preserves DATA-only boundary and actual Native262144 wire cap',()=>{
 const header=read('packages/wallet-auth/native/original-auth-identity-source-authority.h').toString(),proof=read('packages/wallet-auth/native/original-ide-auth-proof-source.inc.mm').toString();
 assert.match(header,/-\s*\(NSDictionary\s*\*\)copyOriginalIDEVerifiedProofForRequest:\(NSData\s*\*\)request invocation:\(NSData\s*\*\)invocation error:\(NSError\s*\*\*\)error/);
 assert.match(header,/DATA only, NOT publication permission/);
 assert.match(proof,/wire\.length<=262144/);assert.doesNotMatch(proof,/393216/);
 for(const field of ['authorized','nativeAdmission','effectRetryAuthorized'])assert.ok(proof.includes(`@"${field}":@NO`));
});
test('R162 original normal verifier rejects one actual Git085 old Native leaf before any build',()=>{
 const {contract}=verifySDK332R140Source(root),temporary=mkdtempSync(join(tmpdir(),'ynx-r162-mixed-old-'));
 try{
  const paths=new Set(['packages/wallet-auth/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',...[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool].map(pin=>pin.path)]);
  for(const path of paths){const destination=resolve(temporary,path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(resolve(root,path),destination);}
  // First prove this is a complete valid normal intake, not a missing-file case.
  assert.equal(verifySDK332R140Source(temporary).contract.version,selectedVersion);
  const relative='packages/wallet-auth/native/original-auth-identity-source-authority.h';
  const old=execFileSync('git',['show','085cf7d91f6c5f82e521732f7b1435c0f1fe7be0:'+relative],{cwd:root});
  assert.equal(sha(old),'5a89e986237eb563e09fa41ce05ea5f844d8f1a918c99db0cc989a5de1550b8f');
  writeFileSync(resolve(temporary,relative),old);
  assert.throws(()=>verifySDK332R140Source(temporary),error=>error.code==='SDK332_R140_NATIVE_INPUT_DIFFERS');
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

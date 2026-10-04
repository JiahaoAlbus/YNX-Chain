import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import compatibility from '../card-source-compatibility.json';
import {cardOperationRecoveryContract,CARD_OPERATION_RECOVERY_CONTRACT} from './cardOperationRecoveryContract';

const candidate='a'.repeat(40),tree='b'.repeat(40);
const version={service:compatibility.backendService,schemaVersion:1,sourceCommit:compatibility.backendSourceCommit,environment:compatibility.environment,productionRealPayments:false};
function build(commit=compatibility.frontendSourceBase){return {schemaVersion:'ynx.card.runtime-identity.v1',productId:'ynx-card',sourceCommit:commit,sourceTree:tree,environment:'testnet',evmChainId:6423,evmChainHex:'0x1917',paymentNetwork:'simulation',productionRealPayments:false,cardApiCompatibility:{schemaVersion:compatibility.schemaVersion,frontendSourceBase:compatibility.frontendSourceBase,frontendSourceCommit:commit,frontendSourceTree:tree,backendSourceCommit:compatibility.backendSourceCommit,backendVersionSchema:1}};}
function load(frontend?:string,response?:()=>Response|Promise<Response>,backend?:string){
  const output:Record<string,any>={},created:Record<string,unknown>[]=[];
  const source=ts.transpileModule(fs.readFileSync(new URL('./providerClientRuntime.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  class Client{constructor(input:Record<string,unknown>){created.push(input)}}
  const requests:string[]=[];
  vm.runInNewContext(source,{exports:output,process:{env:{EXPO_PUBLIC_CARD_SOURCE_COMMIT:frontend,EXPO_PUBLIC_CARD_SOURCE_TREE:frontend?tree:undefined,EXPO_PUBLIC_CARD_BACKEND_SOURCE_COMMIT:backend}},AbortSignal,fetch:async(url:string)=>{requests.push(url);return response?await response():new Response(JSON.stringify(url.endsWith('/version')?version:build(frontend)),{headers:{'content-type':'application/json'}})},require:(name:string)=>name==='react-native'?{Platform:{OS:'web'}}:name.includes('compatibility')?compatibility:name==='./cardOperationRecoveryContract'?{cardOperationRecoveryContract,CARD_OPERATION_RECOVERY_CONTRACT}:name==='./cardBusinessClient'?{CARD_BUSINESS_ORIGIN:'https://card.ynxweb4.com',CardBusinessClient:Client}:name==='./providerApplicationClient'?{CardProviderClient:Client}:(()=>{throw Error(name)})()});
  return {api:output,created,requests};
}
test('accepted historical dual source and compiled candidate pair retain exact backend response identity',async()=>{
  const historical=load();assert.equal(historical.api.validateCardSourcePair(version,build()),compatibility.backendSourceCommit);
  const current=load(candidate);assert.equal(current.api.validateCardSourcePair(version,build(candidate)),compatibility.backendSourceCommit);
  const capabilities={identity:()=>null,createIntrospectionProof:async()=>{throw Error('no approval')}};
  await current.api.createRuntimeProviderClient(capabilities);await current.api.createRuntimeCardBusinessClient(capabilities);
  assert.equal(current.created.length,2);for(const client of current.created)assert.equal(client.expectedSourceCommit,compatibility.backendSourceCommit);
  assert.deepEqual(current.requests,['https://card.ynxweb4.com/api/card/v1/version','/runtime-identity.json','https://card.ynxweb4.com/api/card/v1/version','/runtime-identity.json']);
});
test('unknown backend, frontend, tree, version, environment or compatibility binding fails closed',()=>{
  const h=load(candidate);
  for(const changed of [{sourceCommit:'c'.repeat(40)},{schemaVersion:2},{service:'other'},{environment:'mainnet'},{productionRealPayments:true}])assert.throws(()=>h.api.validateCardSourcePair({...version,...changed},build(candidate)),/CARD_API_SOURCE_MISMATCH/);
  for(const changed of [{sourceCommit:'c'.repeat(40)},{sourceTree:'c'.repeat(40)},{evmChainHex:'0x1'},{productId:'other'},{paymentNetwork:'real'},{environment:'mainnet'},{productionRealPayments:true},{cardApiCompatibility:null},{cardApiCompatibility:{...build(candidate).cardApiCompatibility,backendSourceCommit:'c'.repeat(40)}}])assert.throws(()=>h.api.validateCardSourcePair(version,{...build(candidate),...changed}),/CARD_API_SOURCE_MISMATCH/);
  assert.throws(()=>load().api.validateCardSourcePair(version,build(candidate)),/CARD_API_SOURCE_MISMATCH/);
});
test('Card builder binds source commit/tree into both Metro environment and runtime identity',()=>{
  const source=fs.readFileSync(new URL('../scripts/build-web.mjs',import.meta.url),'utf8');
  assert.match(source,/EXPO_PUBLIC_CARD_SOURCE_COMMIT:sourceCommit/);assert.match(source,/EXPO_PUBLIC_CARD_SOURCE_TREE:sourceTree/);
  assert.match(source,/frontendSourceCommit:sourceCommit/);assert.match(source,/frontendSourceTree:sourceTree/);assert.match(source,/merge-base","--is-ancestor"/);
});

test('observed public 7f9 frontend/e95 API pair is accepted only by its pinned historical consumer, never by a mismatched new JS identity',()=>{
 const observed={schemaVersion:'ynx.card.runtime-identity.v1',productId:'ynx-card',sourceCommit:'7f9ea9af369c61fcb358c9e80500fdd30c66cbbb',sourceTree:'c3dde69331a8b0e87fd91ee80415ec4b83ecb3bb',environment:'testnet',evmChainId:6423,evmChainHex:'0x1917',paymentNetwork:'simulation',productionRealPayments:false};
 assert.equal(load().api.validateCardSourcePair(version,observed),'e95fcf443228d0db97c139dfa5e8ad6fbb7aa675');
 assert.throws(()=>load(candidate).api.validateCardSourcePair(version,observed),/CARD_API_SOURCE_MISMATCH/);
});

test('source diagnostics identify the failing boundary without disclosing remote content or creating a client',()=>{
 const h=load(candidate);
 for(const [v,b,stage] of [
  [{...version,sourceCommit:'c'.repeat(40)},build(candidate),'backend-identity'],
  [version,{...build(candidate),sourceTree:'c'.repeat(40)},'frontend-identity'],
  [version,{...build(candidate),cardApiCompatibility:null},'source-binding'],
 ] as const){
  assert.throws(()=>h.api.validateCardSourcePair(v,b),(error:any)=>error.code==='CARD_API_SOURCE_MISMATCH'&&error.stage===stage&&error.message==='CARD_API_SOURCE_MISMATCH');
 }
 assert.equal(h.created.length,0);
});

test('unavailable, malformed, oversized and network version responses never expose remote errors or construct private clients',async()=>{
 const replies=[
  ()=>new Response('private server detail',{status:503}),
  ()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),
  ()=>new Response('not JSON',{headers:{'content-type':'application/json'}}),
  ()=>new Response('null',{headers:{'content-type':'application/json'}}),
  ()=>new Response('[]',{headers:{'content-type':'application/json'}}),
  ()=>new Response(JSON.stringify({extra:'x'.repeat(16_384)}),{headers:{'content-type':'application/json'}}),
  ()=>{throw Error('private transport detail')},
 ];
 for(const reply of replies){
  const h=load(candidate,reply);
  await assert.rejects(h.api.createRuntimeCardBusinessClient({identity:()=>null,createIntrospectionProof:async()=>{throw Error('must not request approval')}}),(error:any)=>error.code==='CARD_API_SOURCE_UNAVAILABLE'&&error.stage==='version-transport'&&error.message==='CARD_API_SOURCE_UNAVAILABLE');
  assert.equal(h.created.length,0);assert.equal(h.requests.length,1);
 }
});

test('the admitted public 661265 successor pair requires its compiled identity and exact compatibility, not the historical baseline JS',()=>{
 const commit='66126513738ecbd77a372d2ab7f5ac34076c2208';
 const admitted=build(commit);
 assert.equal(load(commit).api.validateCardSourcePair(version,admitted),compatibility.backendSourceCommit);
 assert.throws(()=>load().api.validateCardSourcePair(version,admitted),/CARD_API_SOURCE_MISMATCH/);
});

test('runtime factory carries recovery availability only after exact source validation and exact feature readback',async()=>{
 const capabilities={identity:()=>null,createIntrospectionProof:async()=>{throw Error('must not approve')}};
 const old=load(candidate);await old.api.createRuntimeCardBusinessClient(capabilities);
 assert.equal(old.created[0]!.operationRecoveryContract,undefined);
 let index=0;
 const successor=load(candidate,()=>new Response(JSON.stringify(index++%2===0?{...version,features:{operationReadback:CARD_OPERATION_RECOVERY_CONTRACT}}:build(candidate)),{headers:{'content-type':'application/json'}}));
 await successor.api.createRuntimeCardBusinessClient(capabilities);
 assert.equal(successor.created[0]!.operationRecoveryContract,CARD_OPERATION_RECOVERY_CONTRACT);
 let wrongIndex=0;
 const wrong=load(candidate,()=>new Response(JSON.stringify(wrongIndex++%2===0?{...version,sourceCommit:'c'.repeat(40),features:{operationReadback:CARD_OPERATION_RECOVERY_CONTRACT}}:build(candidate)),{headers:{'content-type':'application/json'}}));
 await assert.rejects(wrong.api.createRuntimeCardBusinessClient(capabilities),/CARD_API_SOURCE_MISMATCH/);assert.equal(wrong.created.length,0);
});

test('new same-source candidate pins both factories to its real exact backend version, not e95',async()=>{
 const paired={...build(candidate),cardApiCompatibility:{...build(candidate).cardApiCompatibility,backendSourceCommit:candidate}},v={...version,sourceCommit:candidate,features:{operationReadback:CARD_OPERATION_RECOVERY_CONTRACT}};let index=0;
 const h=load(candidate,()=>new Response(JSON.stringify(index++%2===0?v:paired),{headers:{'content-type':'application/json'}}),candidate);
 assert.equal(h.api.validateCardSourcePair(v,paired),candidate);
 assert.throws(()=>h.api.validateCardSourcePair(version,paired),/CARD_API_SOURCE_MISMATCH/);
 await h.api.createRuntimeCardBusinessClient({identity:()=>null,createIntrospectionProof:async()=>{throw Error('no grant')}});
 await h.api.createRuntimeProviderClient({identity:()=>null,createIntrospectionProof:async()=>{throw Error('no grant')}});
 assert.equal(h.created.length,2);for(const c of h.created)assert.equal(c.expectedSourceCommit,candidate);
 assert.equal(h.created[0]!.operationRecoveryContract,CARD_OPERATION_RECOVERY_CONTRACT);
});
test('candidate cannot choose an arbitrary different backend or mutable runtime pairing',()=>{
 const paired={...build(candidate),cardApiCompatibility:{...build(candidate).cardApiCompatibility,backendSourceCommit:candidate}},v={...version,sourceCommit:candidate};
 assert.throws(()=>load(candidate,undefined,'d'.repeat(40)).api.validateCardSourcePair({...v,sourceCommit:'d'.repeat(40)},paired),/CARD_API_SOURCE_MISMATCH/);
 assert.throws(()=>load(candidate,undefined,candidate).api.validateCardSourcePair(v,{...paired,cardApiCompatibility:{...paired.cardApiCompatibility,backendSourceCommit:compatibility.backendSourceCommit}}),/CARD_API_SOURCE_MISMATCH/);
 assert.throws(()=>load(undefined,undefined,candidate).api.validateCardSourcePair(v,paired),/CARD_API_SOURCE_MISMATCH/);
});

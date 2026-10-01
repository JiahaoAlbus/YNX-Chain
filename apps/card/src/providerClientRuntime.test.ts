import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import compatibility from '../card-source-compatibility.json';

const candidate='a'.repeat(40),tree='b'.repeat(40);
const version={service:compatibility.backendService,schemaVersion:1,sourceCommit:compatibility.backendSourceCommit,environment:compatibility.environment,productionRealPayments:false};
function build(commit=compatibility.frontendSourceBase){return {schemaVersion:'ynx.card.runtime-identity.v1',productId:'ynx-card',sourceCommit:commit,sourceTree:tree,environment:'testnet',evmChainId:6423,evmChainHex:'0x1917',paymentNetwork:'simulation',productionRealPayments:false,cardApiCompatibility:{schemaVersion:compatibility.schemaVersion,frontendSourceBase:compatibility.frontendSourceBase,frontendSourceCommit:commit,frontendSourceTree:tree,backendSourceCommit:compatibility.backendSourceCommit,backendVersionSchema:1}};}
function load(frontend?:string){
  const output:Record<string,any>={},created:Record<string,unknown>[]=[];
  const source=ts.transpileModule(fs.readFileSync(new URL('./providerClientRuntime.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  class Client{constructor(input:Record<string,unknown>){created.push(input)}}
  const requests:string[]=[];
  vm.runInNewContext(source,{exports:output,process:{env:{EXPO_PUBLIC_CARD_SOURCE_COMMIT:frontend,EXPO_PUBLIC_CARD_SOURCE_TREE:frontend?tree:undefined}},AbortSignal,fetch:async(url:string)=>{requests.push(url);return new Response(JSON.stringify(url.endsWith('/version')?version:build(frontend)),{headers:{'content-type':'application/json'}})},require:(name:string)=>name==='react-native'?{Platform:{OS:'web'}}:name.includes('compatibility')?compatibility:name==='./cardBusinessClient'?{CARD_BUSINESS_ORIGIN:'https://card.ynxweb4.com',CardBusinessClient:Client}:name==='./providerApplicationClient'?{CardProviderClient:Client}:(()=>{throw Error(name)})()});
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
  for(const changed of [{sourceCommit:'c'.repeat(40)},{schemaVersion:2},{service:'other'},{environment:'mainnet'},{productionRealPayments:true}])assert.throws(()=>h.api.validateCardSourcePair({...version,...changed},build(candidate)),/CARD_API_SOURCE_UNAVAILABLE/);
  for(const changed of [{sourceCommit:'c'.repeat(40)},{sourceTree:'c'.repeat(40)},{evmChainHex:'0x1'},{productId:'other'},{paymentNetwork:'real'},{environment:'mainnet'},{productionRealPayments:true},{cardApiCompatibility:null},{cardApiCompatibility:{...build(candidate).cardApiCompatibility,backendSourceCommit:'c'.repeat(40)}}])assert.throws(()=>h.api.validateCardSourcePair(version,{...build(candidate),...changed}),/CARD_API_SOURCE_MISMATCH/);
  assert.throws(()=>load().api.validateCardSourcePair(version,build(candidate)),/CARD_API_SOURCE_MISMATCH/);
});
test('Card builder binds source commit/tree into both Metro environment and runtime identity',()=>{
  const source=fs.readFileSync(new URL('../scripts/build-web.mjs',import.meta.url),'utf8');
  assert.match(source,/EXPO_PUBLIC_CARD_SOURCE_COMMIT:sourceCommit/);assert.match(source,/EXPO_PUBLIC_CARD_SOURCE_TREE:sourceTree/);
  assert.match(source,/frontendSourceCommit:sourceCommit/);assert.match(source,/frontendSourceTree:sourceTree/);assert.match(source,/merge-base","--is-ancestor"/);
});

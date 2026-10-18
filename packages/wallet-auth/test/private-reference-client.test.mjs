import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {canonicalJSON} from '../src/canonical.js';
import {OriginalWalletServicePrivateClient} from '../src/original-wallet-service-private-client.js';
import {ProductSessionGatewayPrivateAdapter} from '../src/product-session-gateway-client.js';
const vectors=JSON.parse(readFileSync(new URL('../testdata/private-reference-carrier-r29a.json',import.meta.url),'utf8')).vectors;
const body=JSON.parse(vectors.find(x=>x.name==='structural_complete').raw).body;
const response=id=>({status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':id},body:canonicalJSON({ok:true,requestId:id,result:{PUBLIC_TRANSPORT_ONLY_NOT_A_GRANT:true},schemaVersion:2})});
// PUBLIC bridge transport instrument only. No Native profile, signature, Source
// admission, terminal ACK or actual session is supplied by this fixture.
test('UNKNOWN permits only distinct exact-original complete-proof outcome and never clears the old record',async()=>{
 const previous=globalThis.window,calls=[];globalThis.window={ynxDesktopWallet:{async originalServiceDispatch(raw){const input=JSON.parse(raw);calls.push(input);if(input.referenceAction==='complete')throw Error('PUBLIC original ACK UNKNOWN');return response(input.requestId);}}};
 try{
  const client=new OriginalWalletServicePrivateClient({timeoutMs:1000}),writeId='req_reference_unknown_001';await assert.rejects(()=>client.requestReference('complete',writeId,body),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});assert.equal(client.status().unknown,true);
  for(const [action,id,raw]of [['complete','req_reference_no_replay01',body],['challenge','req_reference_no_read_01',canonicalJSON({reference:JSON.parse(body).reference,request:JSON.parse(body).request})],['outcome',writeId,body],['outcome','req_reference_wrongbody1',canonicalJSON({...JSON.parse(body),reference:'ynxpsr1_'+'z'.repeat(43)})]])await assert.rejects(()=>client.requestReference(action,id,raw));
  assert.equal(calls.length,1);const looked=await client.requestReference('outcome','req_reference_lookup_001',body);assert.equal(looked.status,200);assert.equal(calls.length,2);assert.equal(client.status().unknown,true);assert.equal(client.selectOutcome('handleReturn','effect',writeId).unknown,true);
  await assert.rejects(()=>client.request('restore','time','req_reference_no_clock01',null,null),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});await assert.rejects(()=>client.requestReference('complete','req_reference_no_replay02',body));assert.equal(calls.length,2);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test('unregistered Native refusal remains UNKNOWN and never falls back to HTTP or claims a usable feature',async()=>{
 const previous=globalThis.window;let calls=0;globalThis.window={ynxDesktopWallet:{async originalServiceDispatch(){calls++;throw Error('PUBLIC Native registration denied');}}};
 try{const client=new OriginalWalletServicePrivateClient({timeoutMs:1000});await assert.rejects(()=>client.requestReference('challenge','req_reference_oldprofile',canonicalJSON({reference:JSON.parse(body).reference,request:JSON.parse(body).request})),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});assert.equal(calls,1);assert.equal(client.status().unknown,true);}finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test('normal private Gateway adapter forwards the three exact v4 actions without HTTP fallback',async()=>{
 const previous=globalThis.window,originalFetch=globalThis.fetch,calls=[];let http=0;
 globalThis.fetch=()=>{http++;throw Error('PUBLIC HTTP fallback forbidden');};
 globalThis.window={ynxDesktopWallet:{async originalServiceDispatch(raw){const input=JSON.parse(raw);calls.push(input);return response(input.requestId);}}};
 try{
  const adapter=new ProductSessionGatewayPrivateAdapter({walletInstalled:async()=>true,schemeRegistered:async()=>true,timeoutMs:1000}),original=JSON.parse(body);
  for(const action of ['challenge','complete','outcome']){
   const input={requestId:'req_reference_adapter_'+action,reference:original.reference,request:original.request,...(action==='challenge'?{}:{completion:original.completion})};
   const method={challenge:'returnChallenge',complete:'completeReturn',outcome:'returnOutcome'}[action];
   assert.deepEqual(await adapter[method](input),{PUBLIC_TRANSPORT_ONLY_NOT_A_GRANT:true});
   assert.equal(calls.at(-1).carrierVersion,'YNX-PRODUCT-SESSION-PRIVATE/v4');assert.equal(calls.at(-1).referenceAction,action);assert.equal(calls.at(-1).operation,action==='challenge'?'beginYNX':'handleReturn');assert.equal(calls.at(-1).proofHeader,null);
   assert.equal(calls.at(-1).body,canonicalJSON({reference:input.reference,request:input.request,...(action==='challenge'?{}:{completion:input.completion})}));
  }
  await assert.rejects(()=>adapter.publishReturn(),{code:'ORIGINAL_PRIVATE_OPERATION_UNSUPPORTED'});await assert.rejects(()=>adapter.publicationOutcome(),{code:'ORIGINAL_PRIVATE_OPERATION_UNSUPPORTED'});assert.equal(calls.length,3);assert.equal(http,0);
 }finally{globalThis.fetch=originalFetch;if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

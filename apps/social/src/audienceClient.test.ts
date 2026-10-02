import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore production consumer
import {createSocialAudienceHTTPClient} from '../web/matrix/audience-client.mjs';
const scopes=['social.contacts','social.feed','social.messaging','social.profile'];
const metadata={kind:'private',members:['@owner:example.invalid'],owner:'@owner:example.invalid',protocol:'ynx-social-matrix-moment/v1',revision:'a'.repeat(64),roomId:'!room:example.invalid'};
function fixture(){
  const live={status:'connected',session:{account:'synthetic-actor',scopes}};
  const calls:{url:string;options:any}[]=[];let proofBody='';let stopped=false;
  const session={current:live,restore:async()=>live,createSocialAudienceProof:async(input:{path:string;body:string})=>{proofBody=input.body;return {body:input.body,proofHeader:'business',introspection:{proofHeader:'introspection'}}}};
  const client=createSocialAudienceHTTPClient({session,capture:()=>({account:live.session.account}),guard:()=>{if(stopped)throw Error('stale view')},csrfToken:async()=> 'synthetic-csrf',fetcher:async(url:RequestInfo|URL,options?:RequestInit)=>{calls.push({url:String(url),options});return new Response(JSON.stringify(metadata),{status:200,headers:{'Content-Type':'application/json'}})}});
  return {session,client,calls,body:()=>proofBody,stop:()=>{stopped=true}};
}
test('audience request sends exact SDK bytes with separate introspection/action proofs',async()=>{
  const f=fixture();assert.deepEqual(await f.client.resolve({kind:'private'}),metadata);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0]!.options.body,f.body());
  assert.equal(f.calls[0]!.options.headers['X-YNX-Product-Session-Proof-V2'],'introspection');
  assert.equal(f.calls[0]!.options.headers['X-YNX-Product-Session-Action-Proof-V2'],'business');
});
test('old chat grant never starts publishing proof or network request',async()=>{
  const f=fixture();f.session.current.session.scopes=scopes.filter(scope=>scope!=='social.feed');
  await assert.rejects(f.client.resolve({kind:'private'}),/old chat grant was not upgraded/);assert.equal(f.calls.length,0);
});
test('account/view stop during signing prevents business dispatch',async()=>{
  const f=fixture();f.session.createSocialAudienceProof=async input=>{f.stop();return {body:input.body,proofHeader:'business',introspection:{proofHeader:'introspection'}}};
  await assert.rejects(f.client.resolve({kind:'private'}),/stale view/);assert.equal(f.calls.length,0);
});
test('SDK body substitution cannot be sent',async()=>{
  const f=fixture();f.session.createSocialAudienceProof=async()=>({body:'{}',proofHeader:'business',introspection:{proofHeader:'introspection'}});
  await assert.rejects(f.client.resolve({kind:'private'}),/original submitted bytes/);assert.equal(f.calls.length,0);
});
test('authorize binds original transaction, parent and confirmed event to business body',async()=>{
  const f=fixture();await f.client.authorize(metadata,{action:'index',transactionId:'original_transaction_001',parentEventId:'$parent',eventId:'$event'});
  assert.deepEqual(JSON.parse(f.body()),{action:'index',transactionId:'original_transaction_001',parentEventId:'$parent',eventId:'$event',expected:metadata});
});

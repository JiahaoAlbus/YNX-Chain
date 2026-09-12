import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createWalletAuthority} from './sharedWalletAuth.ts';
import {withCardApplicationVerifier} from './walletApproval.ts';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {createCardServer} from './http.ts';
import {unavailableCore} from './contracts.ts';

const bytes=readFileSync('server/test-fixtures/card-web-read-public-fixture.json'),fixture=JSON.parse(bytes.toString());
const canonical=(value:unknown)=>JSON.stringify(value,(_key,child)=>child&&typeof child==='object'&&!Array.isArray(child)?Object.fromEntries(Object.keys(child).sort().map(key=>[key,child[key]])):child);
async function harness(t:any){
  let calls=0;const clock=()=>new Date(fixture.authorityTime);
  const authority=createWalletAuthority({clock,fetch:async(url,input)=>{
    calls++;assert.equal(String(url),'https://wallet-auth.ynxweb4.com/v2/product-sessions/introspect');
    const headers=new Headers(input?.headers);assert.equal(headers.get('x-ynx-product-session-proof-v2'),fixture.proofHeader);
    const requestId=headers.get('x-request-id');return new Response(canonical({ok:true,requestId,result:{active:true,session:fixture.activeSession},schemaVersion:2}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Request-Id':requestId!}});
  }});
  const wallet=withCardApplicationVerifier(authority,clock),store=new CardStore(':memory:',Buffer.alloc(32,4));
  const service=new CardService({store,wallet,core:unavailableCore,clock});
  const server=createCardServer({service,wallet,sourceCommit:'b'.repeat(40),allowedOrigin:'https://card.ynxweb4.com',configurationReady:false});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close()});
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing local test port');
  return {url:'http://127.0.0.1:'+address.port,calls:()=>calls,headers:{'X-YNX-Card-Platform':'web','X-YNX-Product-Session-Proof-V2':fixture.proofHeader}};
}
test('accepted Web fixture is synthetic and exact-source bound',()=>{
  assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.platform,'web');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'4d1e218c6dc7303748b0d54af996f6fee7f04f4c5a0a3eaef9f066dbf430d557');
});
test('Card HTTP read-only Web GET without Origin still requires and consumes the fixed signed-session contract',async t=>{
  const f=await harness(t),response=await fetch(f.url+'/api/card/v1/state',{headers:f.headers});
  assert.equal(response.status,200);const result:any=await response.json();assert.equal(result.sessionOwner,fixture.activeSession.account);
  assert.deepEqual(result.data.cards,[]);assert.deepEqual(result.data.intents,[]);assert.equal(f.calls(),1);
});
test('foreign Origin is rejected even on a read-only Web GET',async t=>{
  const f=await harness(t),response=await fetch(f.url+'/api/card/v1/state',{headers:{...f.headers,Origin:'https://attacker.example'}});
  assert.equal(response.status,403);assert.equal(f.calls(),0);
});
test('Web write missing Origin is rejected before introspection or application creation',async t=>{
  const f=await harness(t),response=await fetch(f.url+'/api/card/v1/applications',{method:'POST',headers:{...f.headers,'Content-Type':'application/json','Idempotency-Key':'synthetic-write-no-origin'},body:'{}'});
  assert.equal(response.status,403);const result:any=await response.json();assert.equal(result.error.code,'ORIGIN_MISMATCH');assert.equal(f.calls(),0);
});
test('platform header alone never grants Web identity or permits cross-platform proofs',async t=>{
  const f=await harness(t);
  const missing=await fetch(f.url+'/api/card/v1/state',{headers:{'X-YNX-Card-Platform':'web'}});assert.equal(missing.status,401);
  const wrong=await fetch(f.url+'/api/card/v1/state',{headers:{...f.headers,'X-YNX-Card-Platform':'android'}});assert.equal(wrong.status,403);assert.equal(f.calls(),0);
});

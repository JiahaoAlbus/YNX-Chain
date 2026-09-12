import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {createCardServer} from './http.ts';
import {withCardApplicationVerifier} from './walletApproval.ts';
import {CardError,unavailableCore,type AuthenticationRequest,type Principal} from './contracts.ts';
import {CardBusinessClient} from '../src/cardBusinessClient.ts';

test('business client reaches actual local HTTP/SQLite routes with fresh scoped proofs and fails closed on unsigned approval',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'ynx-card-client-http-')),key=randomBytes(32),store=new CardStore(join(dir,'card.sqlite'),key);
  t.after(()=>{store.close();key.fill(0);rmSync(dir,{recursive:true,force:true})});
  const source='f'.repeat(40),owner='0x'+'a'.repeat(40),seenProofs=new Set<string>(),authenticationRequests:AuthenticationRequest[]=[];
  const p:Principal={owner,chainId:'0x1917',expiresAt:'2099-01-01T00:00:00.000Z',scopes:['account:read','card:application:write']};
  const authentication={async authenticate(request:AuthenticationRequest){
    // This transport fixture is not a production Wallet verifier or Session.
    assert.match(request.proofHeader,/^fixture_proof_[0-9]+$/);
    if(seenProofs.has(request.proofHeader))throw new CardError('REPLAY',401);
    seenProofs.add(request.proofHeader);authenticationRequests.push(request);
    if(!request.requiredScopes.every(scope=>p.scopes.includes(scope)))throw new CardError('CARD_PERMISSION_DENIED',403);
    return p;
  }};
  const wallet=withCardApplicationVerifier(authentication),service=new CardService({store,wallet,core:unavailableCore});
  const server=createCardServer({service,wallet,sourceCommit:source,configurationReady:false,allowedOrigin:'https://card.ynxweb4.com'});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const location=server.address();assert.ok(location&&typeof location==='object');
  const localOrigin=`http://127.0.0.1:${location.port}`;let sequence=0;
  const client=new CardBusinessClient({expectedSourceCommit:source,identity:()=>({owner,sessionBinding:'fixture-binding',expiresAt:p.expiresAt}),createIntrospectionProof:async()=>({proofHeader:`fixture_proof_${++sequence}`}),fetch:async(url,init)=>{
    const requested=new URL(String(url));assert.equal(requested.origin,'https://card.ynxweb4.com');
    // Explicit test-only remap. Production CardBusinessClient has a fixed HTTPS origin.
    return fetch(localOrigin+requested.pathname,init);
  }});
  const details={nickname:'HTTP test application',useCase:'Testnet only local integration',limitWei:'10000000000000000000',riskAccepted:true,termsVersion:'card-testnet-v1'};
  const first=await client.createApplication(details,'durable-create');
  assert.equal(first.status,'DRAFT');
  assert.equal((await client.createApplication(details,'durable-create')).id,first.id);
  const pending=await client.requestApproval(first.id,'durable-approval');
  assert.equal(pending.status,'APPROVAL_REQUIRED');assert.ok(pending.challenge);
  await assert.rejects(client.submitApplication(first.id,{approved:true},'untrusted-result'),/INVALID_CARD_APPROVAL/);
  const state=await client.state();
  assert.equal(state.applications[0]?.status,'DEGRADED');assert.deepEqual(state.cards,[]);assert.deepEqual(state.intents,[]);
  assert.equal(seenProofs.size,5);
  assert.deepEqual(authenticationRequests.map(request=>request.requiredScopes),[
    ['card:application:write'],['card:application:write'],['card:application:write'],['card:application:write'],['account:read'],
  ]);
  assert.equal(authenticationRequests.every(request=>request.path.startsWith('/api/card/v1/')),true);
});

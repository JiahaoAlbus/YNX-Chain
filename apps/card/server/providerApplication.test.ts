import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardStore} from './storage.ts';
import {CardProviderApplications,type VerifiedKycEvent} from './providerApplication.ts';
import type {Principal} from './contracts.ts';
import {CardError,type WalletAuthority} from './contracts.ts';
import type {CardService} from './service.ts';
import {createCardServer} from './http.ts';

const owner:Principal={owner:'0x'+'a'.repeat(40),chainId:'0x1917',scopes:['account:read','card:application:write'],expiresAt:'2026-10-01T00:00:00Z'};
const other:Principal={...owner,owner:'0x'+'b'.repeat(40)};
const now='2026-09-25T12:00:00Z',terms='sha256:'+'a'.repeat(64),fees='sha256:'+'b'.repeat(64);
const draft={provider:'immersve' as const,programId:'program-test',nickname:'Everyday Test',useCase:'ONLINE_TEST',testSpendingLimitMinor:'10000',cardAccountCurrency:'USD',minorUnitDigits:2,termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,riskAccepted:true};
const programs=[{provider:'immersve' as const,programId:'program-test',environment:'TEST' as const,termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,cardAccountCurrency:'USD',minorUnitDigits:2,enabled:true}];
function fixture(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'card-provider-app-')),path=join(dir,'card.sqlite'),key=Buffer.alloc(32,34),store=new CardStore(path,key);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return {store,path,key,service:new CardProviderApplications(store,undefined,undefined,[],programs)}}

test('owner-bound local draft, exact consent, idempotency and no inferred provider card',t=>{
  const {service}=fixture(t);const app=service.createDraft(owner,draft,'create-1',now);assert.equal(app.status,'DRAFT');assert.equal(app.upstreamApplicationId,null);assert.equal(app.upstreamCardId,null);assert.equal(app.walletApprovalVerified,false);
  assert.equal(service.createDraft(owner,draft,'create-1',now).id,app.id);
  assert.throws(()=>service.createDraft(owner,{...draft,nickname:'Changed'},'create-1',now),/APPLICATION_IDEMPOTENCY_CONFLICT/);
  assert.equal(service.list(other).length,0);assert.throws(()=>service.get(other,app.id),/PROVIDER_APPLICATION_NOT_FOUND/);
  assert.throws(()=>service.acknowledgeTerms(owner,app.id,{termsVersion:'test-1',termsHash:terms,feeDisclosureHash:'sha256:'+'c'.repeat(64),riskAccepted:true},now),/PROVIDER_TERMS_CHANGED/);
  const acknowledged=service.acknowledgeTerms(owner,app.id,{termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,riskAccepted:true},now);assert.equal(acknowledged.status,'KYC_REQUIRED');
  assert.equal(service.acknowledgeTerms(owner,app.id,{termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,riskAccepted:true},now).audit.length,2);
  assert.throws(()=>service.createDraft(owner,{...draft,riskAccepted:false},'create-2',now),/TESTNET_RISK_ACKNOWLEDGEMENT_REQUIRED/);
  assert.throws(()=>service.createDraft(owner,{...draft,feeDisclosureHash:'sha256:'+'c'.repeat(64)},'create-3',now),/PROVIDER_DISCLOSURE_MISMATCH/);
});

test('missing hosted KYC adapter degrades without upstream request or fake approval and cancel is local only',async t=>{
  const {service}=fixture(t);const app=service.createDraft(owner,draft,'create-1',now);service.acknowledgeTerms(owner,app.id,{termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,riskAccepted:true},now);
  const result=await service.beginHostedKyc(owner,app.id,now);assert.equal(result.hostedUrl,null);assert.equal(result.application.status,'DEGRADED');assert.equal(result.application.hostedKycSessionId,null);
  assert.equal(service.cancelLocal(owner,app.id,now).status,'CANCELLED');assert.equal(service.get(owner,app.id).upstreamCancellationConfirmed,false);
  assert.equal(service.doctor().providerSubmissionConfigured,false);assert.equal(service.doctor().hostedKycConfigured,false);
  await assert.rejects(service.acceptVerifiedKyc(owner,new Uint8Array(),{},now),/HOSTED_KYC_VERIFIER_UNAVAILABLE/);
});

test('hosted URL is transient, unknown transport is at-most-once, signed-result seam is bound and durable',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'card-provider-kyc-recovery-')),path=join(dir,'card.sqlite'),key=Buffer.alloc(32,35);t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const store=new CardStore(path,key);let starts=0;const event:VerifiedKycEvent={eventId:'kyc-event-1',owner:owner.owner,applicationId:'',provider:'immersve',programId:'program-test',environment:'TEST',sessionId:'hosted-session-1',status:'APPROVED',sourceAsOf:now};
  const service=new CardProviderApplications(store,{async begin(){starts++;return {url:'https://verify.test.immersve.com/kyc/session/a?code=transient',sessionId:'hosted-session-1',expiresAt:'2026-09-25T12:10:00Z'}}},{async verify(){return event}},['https://verify.test.immersve.com'],programs);
  const app=service.createDraft(owner,draft,'create-1',now);event.applicationId=app.id;service.acknowledgeTerms(owner,app.id,{termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,riskAccepted:true},now);
  const started=await service.beginHostedKyc(owner,app.id,now);assert.equal(started.application.status,'KYC_PENDING');assert.equal(starts,1);assert.equal(started.hostedUrl?.startsWith('https://verify.test.immersve.com/'),true);
  assert.equal(JSON.stringify(service.get(owner,app.id)).includes('transient'),false);
  await assert.rejects(service.beginHostedKyc(owner,app.id,now),/PROVIDER_APPLICATION_STATE_CONFLICT/);assert.equal(starts,1);
  const approved=await service.acceptVerifiedKyc(owner,new Uint8Array(),{},now);assert.equal(approved.status,'APPROVAL_REQUIRED');assert.equal(approved.walletApprovalVerified,false);assert.equal(approved.upstreamCardId,null);
  assert.equal((await service.acceptVerifiedKyc(owner,new Uint8Array(),{},now)).audit.length,approved.audit.length);
  store.close();const reopened=new CardStore(path,key);try{const recovered=new CardProviderApplications(reopened);assert.equal(recovered.get(owner,app.id).status,'APPROVAL_REQUIRED');assert.equal(recovered.get(owner,app.id).hostedKycSessionId,'hosted-session-1')}finally{reopened.close()}
});

test('hostile KYC URL, mismatched event and transport uncertainty remain fail-closed',async t=>{
  const {store}=fixture(t);let attempts=0;const bad=new CardProviderApplications(store,{async begin(){attempts++;return {url:'https://evil.example/kyc',sessionId:'session-a',expiresAt:'2026-09-25T12:10:00Z'}}},undefined,['https://verify.test.immersve.com'],programs);
  const app=bad.createDraft(owner,draft,'create-bad',now);bad.acknowledgeTerms(owner,app.id,{termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,riskAccepted:true},now);
  await assert.rejects(bad.beginHostedKyc(owner,app.id,now),/HOSTED_KYC_RESPONSE_UNTRUSTED/);assert.equal(bad.get(owner,app.id).status,'KYC_SESSION_UNKNOWN');assert.equal(attempts,1);
  await assert.rejects(bad.beginHostedKyc(owner,app.id,now),/PROVIDER_APPLICATION_STATE_CONFLICT/);assert.equal(attempts,1);
  const verified=new CardProviderApplications(store,undefined,{async verify(){return {eventId:'e',owner:other.owner,applicationId:app.id,provider:'immersve',programId:'program-test',environment:'TEST' as const,sessionId:'session-a',status:'APPROVED' as const,sourceAsOf:now}}});
  await assert.rejects(verified.acceptVerifiedKyc(owner,new Uint8Array(),{},now),/HOSTED_KYC_BINDING_MISMATCH/);assert.equal(verified.get(owner,app.id).status,'KYC_SESSION_UNKNOWN');
});

test('HTTP v2 application draft is Product Session scoped and never claims upstream acceptance',async t=>{
  const {service}=fixture(t),scopes:string[]=[];const wallet:WalletAuthority={async authenticate(request){scopes.push(request.requiredScopes[0]??'');if(request.proofHeader!=='proof')throw new CardError('INVALID_SESSION_PROOF',401);return owner},async approve(){throw Error('must not approve')}};
  const server=createCardServer({service:{} as CardService,wallet,providerApplications:service,sourceCommit:'source-fixture',allowedOrigin:'https://card.ynxweb4.com',configurationReady:false});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const address=server.address();if(!address||typeof address==='string')throw Error('no port');const base='http://127.0.0.1:'+address.port,headers={'X-YNX-Product-Session-Proof-V2':'proof','X-YNX-Card-Platform':'web','Origin':'https://card.ynxweb4.com','Content-Type':'application/json','Idempotency-Key':'draft-1'};
    const response=await fetch(base+'/api/card/v2/provider-applications',{method:'POST',headers,body:JSON.stringify(draft)});assert.equal(response.status,200);const created=(await response.json()) as any;assert.equal(created.schemaVersion,2);assert.equal(created.data.status,'DRAFT');assert.equal(created.data.upstreamCardId,null);
    const read=await fetch(base+'/api/card/v2/provider-applications/'+created.data.id,{headers});assert.equal(read.status,200);assert.equal(((await read.json()) as any).data.id,created.data.id);
    const accepted=await fetch(base+'/api/card/v2/provider-applications/'+created.data.id+'/terms',{method:'POST',headers,body:JSON.stringify({termsVersion:'test-1',termsHash:terms,feeDisclosureHash:fees,riskAccepted:true})});assert.equal(accepted.status,200);assert.equal(((await accepted.json()) as any).data.status,'KYC_REQUIRED');
    const kyc=await fetch(base+'/api/card/v2/provider-applications/'+created.data.id+'/hosted-kyc',{method:'POST',headers,body:'{}'});assert.equal(kyc.status,200);const result=(await kyc.json()) as any;assert.equal(result.data.application.status,'DEGRADED');assert.equal(result.data.hostedUrl,null);
    const missing=await fetch(base+'/api/card/v2/provider-applications',{method:'POST',headers:{...headers,'X-YNX-Product-Session-Proof-V2':'wrong'},body:JSON.stringify(draft)});assert.equal(missing.status,401);
    assert.deepEqual(scopes,['card:application:write','account:read','card:application:write','card:application:write','card:application:write']);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
});

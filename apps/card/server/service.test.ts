import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {CardError,CHAIN,unavailableWallet,type Principal,type WalletAuthority,type CoreAuthority,type FundingIntent} from './contracts.ts';
import {createCardServer} from './http.ts';
const owner='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',other='0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',recipient='0xcccccccccccccccccccccccccccccccccccccccc',tx='0x'+'1'.repeat(64),block='0x'+'2'.repeat(64),now='2026-09-12T00:00:00.000Z';
const principal=(wallet=owner):Principal=>({owner:wallet,chainId:CHAIN,expiresAt:'2026-09-13T00:00:00.000Z',scopes:['account:read','card:application:write','card:controls:write','card:topup:write','card:simulation:write']});
const details={nickname:'Private test fixture nickname',useCase:'Explicitly simulated merchant practice',limitWei:'10000000000000000000',riskAccepted:true,termsVersion:'card-testnet-v1'};
const approved:WalletAuthority={async authenticate(){return principal()},async approve(p,c){return {approved:true,approvalId:'FIXTURE-NOT-A-REAL-APPROVAL',challengeId:c.id,owner:p.owner,payloadHash:c.payloadHash,expiresAt:'2026-09-12T00:04:00.000Z'}}};
const fixtureCore:CoreAuthority={async verify(i,h){return {chainId:CHAIN,txHash:h,from:i.sender,to:i.recipient,amountWei:i.amountWei,blockHash:block,blockNumber:'0x1',confirmations:2,blockTime:i.createdAt}}};
function fixture(t:any,wallet:WalletAuthority=approved,core:CoreAuthority=fixtureCore){const dir=mkdtempSync(join(tmpdir(),'ynx-card-backend-test-')),path=join(dir,'card.sqlite'),key=randomBytes(32);let store=new CardStore(path,key);let time=new Date(now);let service=new CardService({store,wallet,core,fundingAddress:recipient,clock:()=>time});t.after(()=>{store.close();key.fill(0);rmSync(dir,{recursive:true,force:true})});return {get store(){return store},get service(){return service},path,setTime(value:string){time=new Date(value)},reopen(){store.close();store=new CardStore(path,key);service=new CardService({store,wallet,core,fundingAddress:recipient,clock:()=>time});return service}}}
async function active(f:ReturnType<typeof fixture>){const app=f.service.createApplication(principal(),details,'create-1');f.service.requestApproval(principal(),app.id,'request-1');return (await f.service.submitApplication(principal(),app.id,{fixtureOnly:true},'submit-1')).card!}
async function funded(f:ReturnType<typeof fixture>){const card=await active(f);const intent=f.service.createTopupIntent(principal(),card.id,{amountWei:'1000000000000000000'},'intent-1');await f.service.confirmTopup(principal(),intent.id,tx,'topup-1');return {card,intent}}
const merchant={id:'fixture_merchant',name:'SIMULATED MERCHANT',mcc:'5812',country:'YN',channel:'online' as const,recurring:false};

test('persistent drafts are isolated, idempotent and encrypted on disk',t=>{const f=fixture(t);const a=f.service.createApplication(principal(),details,'create-1');assert.deepEqual(f.service.createApplication(principal(),details,'create-1'),a);assert.throws(()=>f.service.createApplication(principal(),{...details,nickname:'different'},'create-1'),/IDEMPOTENCY_CONFLICT/);const b=f.service.createApplication(principal(other),details,'create-1');f.reopen();assert.equal(f.service.getState(principal()).applications[0]?.id,a.id);assert.equal(f.service.getState(principal(other)).applications[0]?.id,b.id);assert.throws(()=>f.service.requestApproval(principal(other),a.id,'request'),/NOT_FOUND/);assert.equal(readFileSync(f.path).includes(Buffer.from(details.nickname)),false)});

test('missing approval verifier persists DEGRADED without a card',async t=>{const f=fixture(t,unavailableWallet);const app=f.service.createApplication(principal(),details,'draft');f.service.requestApproval(principal(),app.id,'request');await assert.rejects(f.service.submitApplication(principal(),app.id,{notARealProof:true},'submit'),/VERIFIER_UNAVAILABLE/);f.reopen();assert.equal(f.service.getState(principal()).applications[0]?.status,'DEGRADED');assert.deepEqual(f.service.getState(principal()).cards,[])});

test('an explicit rejection is durable and never creates a card',async t=>{const f=fixture(t,{...approved,async approve(p,c,proof,details){return {...await approved.approve(p,c,proof,details),approved:false}}});const app=f.service.createApplication(principal(),details,'create');f.service.requestApproval(principal(),app.id,'request');assert.equal((await f.service.submitApplication(principal(),app.id,{},'submit')).application.status,'REJECTED');assert.deepEqual(f.reopen().getState(principal()).cards,[])});

test('expired or mismatched approval cannot activate a card',async t=>{const f=fixture(t,{...approved,async approve(p,c,proof,details){return {...await approved.approve(p,c,proof,details),owner:other}}});const app=f.service.createApplication(principal(),details,'create');f.service.requestApproval(principal(),app.id,'request');await assert.rejects(f.service.submitApplication(principal(),app.id,{},'submit'),/INVALID_CARD_APPROVAL/);assert.deepEqual(f.service.getState(principal()).cards,[])});

test('active application submission retries do not request a second approval',async t=>{let calls=0;const f=fixture(t,{...approved,async approve(p,c,proof,details){calls++;if(calls>1)throw new CardError('APPROVAL_REPLAY');return approved.approve(p,c,proof,details)}});const card=await active(f);const result=await f.service.submitApplication(principal(),card.applicationId,{fixtureOnly:true},'submit-1');assert.equal(result.card?.id,card.id);assert.equal(calls,1)});

test('cached approval still requires current identity, ownership, scope and identical input',async t=>{let calls=0;const f=fixture(t,{...approved,async approve(p,c,proof,details){calls++;return approved.approve(p,c,proof,details)}});const card=await active(f);await assert.rejects(f.service.submitApplication({...principal(),expiresAt:'2000-01-01T00:00:00Z'},card.applicationId,{fixtureOnly:true},'submit-1'),/AUTH_EXPIRED/);await assert.rejects(f.service.submitApplication(principal(other),card.applicationId,{fixtureOnly:true},'submit-1'),/NOT_FOUND/);await assert.rejects(f.service.submitApplication({...principal(),scopes:['account:read']},card.applicationId,{fixtureOnly:true},'submit-1'),/PERMISSION_DENIED/);await assert.rejects(f.service.submitApplication(principal(),card.applicationId,{different:true},'submit-1'),/IDEMPOTENCY_CONFLICT/);assert.equal(calls,1)});

test('pending submissions do not replay the external approval call',async t=>{let release:()=>void=()=>{},calls=0;const pending=new Promise<void>(resolve=>{release=resolve});const f=fixture(t,{...approved,async approve(p,c,proof,details){calls++;await pending;return approved.approve(p,c,proof,details)}});const app=f.service.createApplication(principal(),details,'create');f.service.requestApproval(principal(),app.id,'request');const first=f.service.submitApplication(principal(),app.id,{},'submit');await assert.rejects(f.service.submitApplication(principal(),app.id,{},'submit'),/RECONCILIATION_REQUIRED/);release();assert.equal((await first).application.status,'ACTIVE');assert.equal(calls,1)});

test('verified fixture funding, partial settlement, restart and duplicate credit conserve wei',async t=>{const f=fixture(t);const {card,intent}=await funded(f);await f.service.confirmTopup(principal(),intent.id,tx,'topup-retry');const a=f.service.authorize(principal(),card.id,{simulation:true,merchant,amountWei:'1000'},'auth');const c=f.service.settle(principal(),a.id,'capture',{amountWei:'600'},'capture');assert.ok('capture' in c);f.service.settle(principal(),a.id,'reverse',{amountWei:'400'},'reverse');f.service.settle(principal(),c.capture!.id,'refund',{amountWei:'200'},'refund');f.reopen();const statement=f.service.statement(principal(),card.id);assert.equal(statement.card.balance.availableWei,'999999999999999600');assert.equal(statement.card.balance.pendingWei,'0');assert.equal(statement.card.balance.postedWei,'400');assert.equal(statement.ledger.filter(e=>e.operation==='topup').length,1);assert.equal(statement.events.filter(e=>e.name==='card.funded').length,1)});

test('mismatched Core evidence never reaches the ledger',async t=>{const f=fixture(t,approved,{async verify(i,h){return {...await fixtureCore.verify(i,h),amountWei:'1'}}});const card=await active(f),intent=f.service.createTopupIntent(principal(),card.id,{amountWei:'100'},'intent');await assert.rejects(f.service.confirmTopup(principal(),intent.id,tx,'topup'),/INVALID_CORE_RECEIPT/);assert.equal(f.service.statement(principal(),card.id).card.balance.fundedWei,'0')});

test('frozen and insufficient-balance authorizations decline and survive restart',async t=>{const f=fixture(t),card=await active(f);const input={simulation:true as const,merchant,amountWei:'1'};assert.equal(f.service.authorize(principal(),card.id,input,'insufficient').reason,'INSUFFICIENT_BALANCE');f.service.changeCard(principal(),card.id,'freeze','freeze');assert.equal(f.service.authorize(principal(),card.id,input,'frozen').reason,'CARD_FROZEN');assert.equal(f.reopen().statement(principal(),card.id).card.status,'FROZEN')});

test('real HTTP boundary exposes preview identity but denies private requests without verifier',async t=>{const f=fixture(t,unavailableWallet);const server=createCardServer({service:f.service,wallet:unavailableWallet,sourceCommit:'test-fixture-only',configurationReady:false,allowedOrigin:'https://card.ynxweb4.com'});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const location=server.address();assert.ok(location&&typeof location==='object');const base=`http://127.0.0.1:${location.port}`;const health=await fetch(base+'/healthz');assert.equal(health.status,200);const data=await health.json() as any;assert.equal(data.configurationReady,false);assert.equal(data.productionRealPayments,false);const response=await fetch(base+'/api/card/v1/state');assert.equal(response.status,503);assert.equal((await response.json() as any).error.code,'PRIVATE_SERVICE_DEGRADED')});

test('coarse legacy scopes cannot read, mutate or recover cached application results',t=>{
  const f=fixture(t),app=f.service.createApplication(principal(),details,'create');
  const legacy={...principal(),scopes:['card.read','card.write']};
  assert.throws(()=>f.service.getState(legacy),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.createApplication(legacy,details,'create'),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.updateApplication(legacy,app.id,details,'update'),/PERMISSION_DENIED/);
});

test('application-only permission cannot control, fund or simulate, including before resource lookup',async t=>{
  const f=fixture(t),p={...principal(),scopes:['card:application:write']};
  const app=f.service.createApplication(p,details,'create');
  f.service.updateApplication(p,app.id,{...details,nickname:'Updated test name'},'update');
  f.service.requestApproval(p,app.id,'approval');
  assert.throws(()=>f.service.getState(p),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.changeCard(p,'absent','freeze','freeze'),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.createTopupIntent(p,'absent',{amountWei:'1'},'intent'),/PERMISSION_DENIED/);
  await assert.rejects(f.service.confirmTopup(p,'absent',tx,'confirm'),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.authorize(p,'absent',{amountWei:'1',merchant,simulation:true},'auth'),/PERMISSION_DENIED/);
});

test('controls, funding and simulation scopes grant only their own operations',async t=>{
  const f=fixture(t),card=await active(f);
  const controlsOnly={...principal(),scopes:['card:controls:write']};
  f.service.changeCard(controlsOnly,card.id,'freeze','freeze');
  f.service.updateControls(controlsOnly,card.id,{online:false},'controls');
  assert.throws(()=>f.service.requestApproval(controlsOnly,card.applicationId,'no'),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.createTopupIntent(controlsOnly,card.id,{amountWei:'100'},'no'),/PERMISSION_DENIED/);
  f.service.changeCard(controlsOnly,card.id,'unfreeze','unfreeze');
  f.service.updateControls(controlsOnly,card.id,{online:true},'online');
  const topupOnly={...principal(),scopes:['card:topup:write']};
  const intent=f.service.createTopupIntent(topupOnly,card.id,{amountWei:'100'},'intent');
  await f.service.confirmTopup(topupOnly,intent.id,tx,'confirm');
  assert.throws(()=>f.service.changeCard(topupOnly,card.id,'freeze','no'),/PERMISSION_DENIED/);
  const simulationOnly={...principal(),scopes:['card:simulation:write']};
  const authorization=f.service.authorize(simulationOnly,card.id,{amountWei:'10',merchant,simulation:true},'auth');
  const capture=f.service.settle(simulationOnly,authorization.id,'capture',{amountWei:'10'},'capture');
  assert.ok('capture' in capture);
  f.service.settle(simulationOnly,capture.capture!.id,'refund',{amountWei:'10'},'refund');
  assert.throws(()=>f.service.createTopupIntent(simulationOnly,card.id,{amountWei:'100'},'no'),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.settle(topupOnly,authorization.id,'reverse',{amountWei:'1'},'no'),/PERMISSION_DENIED/);
});

test('application approval receives the exact persisted five details, not unsigned controls',async t=>{
  let received:unknown;
  const f=fixture(t,{...approved,async approve(p,c,proof,saved){received=structuredClone(saved);return approved.approve(p,c,proof,saved)}});
  await active(f);
  assert.deepEqual(received,details);
  assert.deepEqual(Object.keys(received as object).sort(),['limitWei','nickname','riskAccepted','termsVersion','useCase']);
});

test('native YNX subjects can apply but have no inferred EVM funding authorization',async t=>{
  const f=fixture(t),p={...principal('ynx1'+'a'.repeat(38)),chainId:'ynx_6423-1' as const};
  const app=f.service.createApplication(p,details,'create');
  f.service.requestApproval(p,app.id,'approve');
  const result=await f.service.submitApplication(p,app.id,{fixtureOnly:true},'submit');
  assert.ok(result.card);
  const cardId=result.card.id;
  assert.throws(()=>f.service.createTopupIntent(p,cardId,{amountWei:'100'},'intent'),/SENDER_BINDING_UNAVAILABLE/);
  assert.equal(f.reopen().getState(p).cards[0]?.balance.fundedWei,'0');
});

test('internal outbox retries preserve stable event ids across restart',async t=>{
  const f=fixture(t),card=await active(f),seen:string[]=[];
  const pending=await f.service.flushEvents(owner,{publish:async event=>{seen.push(event.id);throw Error('fixture outage')}});
  assert.ok(pending.length>0);assert.ok(pending.every(event=>event.attempts===1));
  f.reopen();const retried:string[]=[];
  assert.deepEqual(await f.service.flushEvents(owner,{publish:async event=>{retried.push(event.id)}}),[]);
  assert.deepEqual(retried,seen);
  assert.ok(f.service.statement(principal(),card.id).events.every(event=>event.delivered));
});

test('HTTP selects exact proof scopes before authentication and denies mismatched grants',async t=>{
  const requests:any[]=[],f=fixture(t);
  let grants=['account:read'];
  const wallet:WalletAuthority={...approved,async authenticate(request){requests.push(request);return {...principal(),scopes:grants}}};
  const server=createCardServer({service:f.service,wallet,sourceCommit:'fixture-only',configurationReady:false,allowedOrigin:'https://card.ynxweb4.com'});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const location=server.address();assert.ok(location&&typeof location==='object');const base=`http://127.0.0.1:${location.port}`;
  const headers={'X-YNX-Product-Session-Proof-V2':'fixture-not-a-real-proof','Content-Type':'application/json','Idempotency-Key':'create'};
  assert.equal((await fetch(base+'/api/card/v1/state',{headers})).status,200);
  assert.deepEqual(requests.at(-1).requiredScopes,['account:read']);
  assert.equal((await fetch(base+'/api/card/v1/applications',{method:'POST',headers,body:JSON.stringify(details)})).status,403);
  assert.deepEqual(requests.at(-1).requiredScopes,['card:application:write']);
  assert.deepEqual(f.service.getState(principal()).applications,[]);
  grants=['card:application:write'];
  assert.equal((await fetch(base+'/api/card/v1/applications',{method:'POST',headers,body:JSON.stringify(details)})).status,200);
  assert.equal(requests.at(-1).proofHeader,'fixture-not-a-real-proof');
  const before=requests.length;
  for(const path of ['/api/card/v1/flush-events','/api/card/v1/captures/id/capture','/api/card/v1/authorizations/id/refund'])assert.equal((await fetch(base+path,{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await fetch(base+'/api/card/v1/state',{headers:{Authorization:'Bearer legacy'}})).status,401);
  assert.equal((await fetch(base+'/api/card/v1/state',{headers:{'X-YNX-Product-Session-Proof':'legacy'}})).status,401);
  assert.equal(requests.length,before);
});

test('simulation fee is conserved, idempotent and reconciled after restart',async t=>{
  const f=fixture(t),{card}=await funded(f),input={amountWei:'70',simulation:true as const,reason:'SANDBOX_PROCESSOR_FEE' as const};
  const result=f.service.applySimulationFee(principal(),card.id,input,'fee');
  assert.equal(result.card.balance.feeWei,'70');
  assert.equal(result.card.balance.availableWei,'999999999999999930');
  assert.deepEqual(f.service.applySimulationFee(principal(),card.id,input,'fee'),result);
  assert.throws(()=>f.service.applySimulationFee(principal(),card.id,{...input,amountWei:'71'},'fee'),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>f.service.applySimulationFee({...principal(),scopes:['card:topup:write']},card.id,input,'no'),/PERMISSION_DENIED/);
  assert.throws(()=>f.service.applySimulationFee(principal(),card.id,{...input,simulation:false} as never,'invalid'),/INVALID_SIMULATED_FEE/);
  const auth=f.service.authorize(principal(),card.id,{amountWei:'100',merchant,simulation:true},'auth');
  f.service.settle(principal(),auth.id,'capture',{amountWei:'40'},'capture');
  f.reopen();const report=f.service.reconcile(principal(),card.id);
  assert.equal(report.status,'CONSISTENT');assert.deepEqual(report.findings,[]);
  assert.equal(report.balance.pendingWei,'60');assert.equal(report.balance.postedWei,'40');assert.equal(report.balance.feeWei,'70');
  assert.equal(report.chainReverified,false);assert.equal(report.dataFabricReconciled,false);
});

test('reconciliation finds inconsistent snapshots instead of claiming ledger success',async t=>{
  const f=fixture(t),{card}=await funded(f);
  f.store.transaction<any,void>(owner,()=>{throw Error('missing fixture')},state=>{state.cards[card.id].balance.availableWei='1'});
  assert.equal(f.service.reconcile(principal(),card.id).status,'INCONSISTENT');
  assert.ok(f.service.reconcile(principal(),card.id).findings.includes('CARD_BALANCE_MISMATCH'));
});

test('a transaction cannot fund a second intent and the failed claim is atomic',async t=>{
  const f=fixture(t),{card}=await funded(f);
  const duplicate=f.service.createTopupIntent(principal(),card.id,{amountWei:'1000000000000000000'},'intent-2');
  await assert.rejects(f.service.confirmTopup(principal(),duplicate.id,tx,'duplicate'),error=>error instanceof CardError&&error.code==='TRANSACTION_ALREADY_CLAIMED'&&error.status===409);
  const report=f.reopen().reconcile(principal(),card.id);
  assert.equal(report.status,'CONSISTENT');assert.equal(report.creditedIntents,1);assert.equal(report.balance.fundedWei,'1000000000000000000');
});

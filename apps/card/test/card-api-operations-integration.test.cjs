const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const {CardStore}=require('../server/storage.ts'),{CardService}=require('../server/service.ts');
const {CardBusinessClient,CARD_BUSINESS_ORIGIN}=require('../src/cardBusinessClient.ts');
const {canonicalCardOperationInput}=require('../src/cardOperationJournal.ts');

test('actual backend fixture receipts pass client authorization/partial capture/reverse/refund validators and survive cold reopen',async t=>{
  // Controlled QA only: no actual Wallet approval, signature, chain transaction,
  // public business acceptance or real card is established by this test.
  const owner='0x'+'a'.repeat(40),recipient='0x'+'b'.repeat(40),source='c'.repeat(40),now=new Date();
  const expiresAt=new Date(now.getTime()+3600000).toISOString();
  const p={owner,chainId:'0x1917',expiresAt,scopes:['account:read','card:application:write','card:controls:write','card:topup:write','card:simulation:write']};
  const wallet={authenticate:async()=>p,approve:async(principal,challenge)=>({approved:true,approvalId:'QA-FIXTURE-NOT-REAL-APPROVAL',challengeId:challenge.id,owner:principal.owner,payloadHash:challenge.payloadHash,expiresAt:new Date(now.getTime()+240000).toISOString()})};
  const core={verify:async(intent,txHash)=>({chainId:'0x1917',txHash,from:intent.sender,to:intent.recipient,amountWei:intent.amountWei,blockHash:'0x'+'2'.repeat(64),blockNumber:'0x1',confirmations:2,blockTime:intent.createdAt})};
  const dir=mkdtempSync(join(tmpdir(),'ynx-card-client-backend-qa-')),db=join(dir,'qa.sqlite'),key=randomBytes(32);
  let store=new CardStore(db,key),service=new CardService({store,wallet,core,fundingAddress:recipient,clock:()=>now});
  t.after(()=>{store.close();key.fill(0);rmSync(dir,{recursive:true,force:true})});
  const details={nickname:'Explicit QA Testnet fixture',useCase:'Controlled source integration only',limitWei:'10000000000000000000',riskAccepted:true,termsVersion:'card-testnet-v1'};
  const app=service.createApplication(p,details,'qa-create');service.requestApproval(p,app.id,'qa-review');
  const card=(await service.submitApplication(p,app.id,{fixtureOnly:true},'qa-submit')).card;
  assert.ok(card);
  const intent=service.createTopupIntent(p,card.id,{amountWei:'1000000000000000000'},'qa-intent');
  await service.confirmTopup(p,intent.id,'0x'+'1'.repeat(64),'qa-confirm');
  const requests=[];
  const client=new CardBusinessClient({expectedSourceCommit:source,identity:()=>({owner,sessionBinding:'qa-session-only',expiresAt}),createIntrospectionProof:async()=>({proofHeader:'qa-controlled-proof-not-runtime'}),fetch:async(url,init)=>{
    assert.equal(new URL(String(url)).origin,CARD_BUSINESS_ORIGIN);
    const parts=new URL(String(url)).pathname.split('/'),body=init.body?JSON.parse(String(init.body)):null,idempotency=new Headers(init.headers).get('Idempotency-Key');requests.push({path:new URL(String(url)).pathname,method:init.method,key:idempotency});
    let data;
    if(parts[4]==='cards'&&parts[6]==='authorizations')data=service.authorize(p,parts[5],body,idempotency);
    else if(parts[4]==='authorizations'||parts[4]==='captures')data=service.settle(p,parts[5],parts[6],body,idempotency);
    else if(parts[4]==='operations')data=service.operationResult(p,parts[5],parts[6],parts[7],parts[8]);
    else throw Error('UNEXPECTED_QA_ROUTE');
    return Response.json({schemaVersion:1,sourceCommit:source,sessionOwner:owner,environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false,data});
  }});
  const input={amountWei:'1000',simulation:true,merchant:{id:'qa_merchant',name:'SIMULATED MERCHANT',mcc:'5812',country:'YN',channel:'online',recurring:false}};
  const authorization=await client.authorize(card.id,input,'qa-auth');assert.equal(authorization.status,'APPROVED');
  const firstCapture=await client.settle(authorization.id,'capture','600','qa-capture');
  assert.ok(firstCapture.capture);
  await client.settle(authorization.id,'reverse','400','qa-reverse');
  await client.settle(firstCapture.capture.id,'refund','200','qa-refund');
  store.close();store=new CardStore(db,key);service=new CardService({store,wallet,core,fundingAddress:recipient,clock:()=>now});
  const before=service.statement(p,card.id);
  const repeated=await client.settle(firstCapture.capture.id,'refund','200','qa-refund');
  assert.ok(repeated.card);assert.deepEqual(service.statement(p,card.id),before);
  const digest=createHash('sha256').update(canonicalCardOperationInput(input)).digest('hex');
  assert.deepEqual(await client.operationResult('authorization',card.id,'qa-auth',digest),{status:'CONFIRMED'});
  const final=service.statement(p,card.id);
  assert.equal(final.card.balance.availableWei,'999999999999999600');
  assert.equal(final.card.balance.pendingWei,'0');assert.equal(final.card.balance.postedWei,'400');
  assert.equal(final.ledger.filter(entry=>entry.operation==='topup').length,1);
  assert.equal(service.reconcile(p,card.id).status,'CONSISTENT');
  assert.ok(requests.every(row=>row.path.startsWith('/api/card/v1/')));
});

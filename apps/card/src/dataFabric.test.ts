import test from"node:test";
import assert from"node:assert/strict";
import{CardDataFabricOutbox,mapProcessorEvent,type CardDataFabricEvent}from"./dataFabric";
import{TestnetSimulationProcessor,YNXT_TESTNET_ASSET}from"./processor";

const now="2026-08-20T00:00:00.000Z",hash="0x1111111111111111111111111111111111111111111111111111111111111111";
function setup(){const processor=new TestnetSimulationProcessor("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");processor.createCard({cardAccountId:"account_1",walletAccount:"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",cardId:"card_1",createdAt:now});return processor}
function funded(){const processor=setup();const funding=processor.creditTestnetFunding("card_1",{txHash:hash,chainId:"0x1917",amountMinor:900,confirmations:2,idempotencyKey:"funding-1"},now);return {processor,funding}}
function freezeEvent():CardDataFabricEvent{const processor=setup();processor.freezeCard("card_1","freeze-1",now);return mapProcessorEvent(processor.getStatement("card_1")[0]!)[0]!}

test("synthetic funding never emits completed Data Fabric funding evidence",()=>{
  const {processor,funding}=funded();
  assert.equal(processor.publicFundingEnabled,false);
  assert.equal(processor.persistentBackendConnected,false);
  assert.equal(processor.getBalance("card_1").availableMinor,900);
  assert.deepEqual(mapProcessorEvent(funding),[]);
  assert.deepEqual(mapProcessorEvent({...funding,relatedId:"not-a-hash"}),[]);
  assert.deepEqual(mapProcessorEvent({...funding,status:"declined"}),[]);
  assert.deepEqual(mapProcessorEvent({...funding,reasonCode:"BACKEND_VERIFIED"}),[]);
  assert.equal(processor.getStatement("card_1")[0],funding);
});

test("simulated authorization, capture, reversal and partial refunds remain usable",()=>{
  const {processor}=funded();
  const authorization=processor.authorize("card_1",{merchantId:"merchant_demo",merchantName:"Simulated Merchant",merchantCategoryCode:"5812",country:"YN",amountMinor:100,currency:YNXT_TESTNET_ASSET,channel:"online",cardNotPresent:true,recurring:false,timestamp:now,idempotencyKey:"auth-1"});
  assert.deepEqual(mapProcessorEvent(authorization).map(event=>event.name),["card.authorization.requested","card.authorization.approved"]);
  const capture=processor.capture("card_1",{authorizationId:authorization.id,amountMinor:60,idempotencyKey:"capture-1",timestamp:now});
  assert.deepEqual(mapProcessorEvent(capture).map(event=>event.name),["card.capture.completed"]);
  const reversal=processor.reverse("card_1",{authorizationId:authorization.id,amountMinor:40,idempotencyKey:"reverse-1",timestamp:now});
  assert.deepEqual(mapProcessorEvent(reversal).map(event=>event.name),["card.authorization.reversed"]);
  const refund=processor.refund("card_1",{captureId:capture.id,amountMinor:20,idempotencyKey:"refund-1",timestamp:now});
  assert.deepEqual(mapProcessorEvent(refund).map(event=>event.name),["card.refund.created","card.refund.completed"]);
  assert.deepEqual(processor.getBalance("card_1"),{availableMinor:860,pendingMinor:0,postedMinor:40,asset:YNXT_TESTNET_ASSET});
});

test("outbox rejects manually constructed funded events atomically",()=>{
  const valid=freezeEvent();
  const forged:CardDataFabricEvent={...valid,id:"forged-funding",name:"card.funded",status:"completed",chainEvidence:{chainId:"0x1917",txHash:hash}};
  const outbox=new CardDataFabricOutbox();
  assert.throws(()=>outbox.enqueue([valid,forged]),/receipt adapter is unavailable/);
  assert.deepEqual(outbox.pending(),[]);
  outbox.enqueue([valid]);const before=outbox.pending();
  assert.throws(()=>outbox.enqueue([forged]),/receipt adapter is unavailable/);
  assert.deepEqual(outbox.pending(),before);
});

test("outbox deduplicates and retries the same non-funding event identity",async()=>{
  const event=freezeEvent(),outbox=new CardDataFabricOutbox();outbox.enqueue([event]);outbox.enqueue([event]);
  assert.equal(outbox.pending().length,1);let attempt=0;
  await outbox.flush({publish:async()=>{attempt++;throw new Error("offline")}});
  assert.deepEqual(outbox.pending().map(record=>record.attempts),[1]);
  await outbox.flush({publish:async()=>{attempt++}});
  assert.equal(outbox.pending().length,0);assert.equal(attempt,2);
});

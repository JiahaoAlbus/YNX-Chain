import test from "node:test";
import assert from "node:assert/strict";
import {TestnetSimulationProcessor, YNXT_TESTNET_ASSET, type ProcessorControls} from "./processor";

const owner="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", other="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const now="2026-09-06T00:00:00.000Z", later="2026-09-06T00:15:00.000Z";
const hash="0x"+"ab".repeat(32);
const funding={txHash:hash,chainId:"0x1917" as const,amountMinor:1000,confirmations:1,idempotencyKey:"fund"};
const merchant={merchantId:"demo",merchantName:"Demo",merchantCategoryCode:"5812",country:"YN",amountMinor:300,currency:YNXT_TESTNET_ASSET,channel:"online" as const,cardNotPresent:true,recurring:false,timestamp:now,idempotencyKey:"auth"};
function setup(controls?:Partial<ProcessorControls>){const p=new TestnetSimulationProcessor(owner);p.createCard({cardAccountId:"account",walletAccount:owner,cardId:"card",createdAt:now,controls});return p}
function funded(controls?:Partial<ProcessorControls>){const p=setup(controls);p.creditTestnetFunding("card",funding,now);return p}

test("one owner/chain/hash credit survives new keys, case changes, and a second card",()=>{
 const p=funded();const original=p.getStatement("card")[0];
 assert.equal(p.creditTestnetFunding("card",{...funding,txHash:hash.toUpperCase().replace("0X","0x"),idempotencyKey:"new-key"},now),original);
 assert.equal(p.getBalance("card").availableMinor,1000);assert.equal(p.getStatement("card").length,1);
 assert.throws(()=>p.creditTestnetFunding("card",{...funding,amountMinor:500,idempotencyKey:"different-amount"},now),/already credited|conflict/i);
 p.createCard({cardAccountId:"another",walletAccount:owner,cardId:"second",createdAt:now});
 assert.throws(()=>p.creditTestnetFunding("second",{...funding,idempotencyKey:"second-card"},now),/already credited|conflict/i);
 assert.equal(p.getBalance("second").availableMinor,0);
});

test("idempotency binds every field and operation, including previously declined requests",()=>{
 const p=funded();p.authorize("card",merchant);
 for(const patch of [{amountMinor:301},{merchantId:"other"},{merchantName:"Changed"},{recurring:true},{country:"US"},{timestamp:later}])
  assert.throws(()=>p.authorize("card",{...merchant,...patch}),/idempotency.*conflict/i);
 assert.throws(()=>p.freezeCard("card","auth",now),/idempotency.*conflict/i);
 assert.throws(()=>p.creditTestnetFunding("card",{...funding,confirmations:2},now),/idempotency.*conflict/i);
 const declined={...merchant,amountMinor:900,idempotencyKey:"declined"};assert.equal(p.authorize("card",declined).status,"declined");
 assert.throws(()=>p.authorize("card",{...declined,amountMinor:100}),/idempotency.*conflict/i);
 assert.equal(p.getBalance("card").pendingMinor,300);
});

test("control and state retries return the original immutable response without overwriting later state",()=>{
 const p=funded(),frozen=p.freezeCard("card","freeze",now);p.unfreezeCard("card","unfreeze",now);
 assert.equal(p.freezeCard("card","freeze",now),frozen);assert.equal(p.getCard("card").state,"active");
 const first=p.updateControls("card",{blockedMcc:["5812"]},"control",now);
 p.updateControls("card",{blockedMcc:[]},"clear",now);
 assert.equal(p.updateControls("card",{blockedMcc:["5812"]},"control",now),first);
 assert.throws(()=>p.updateControls("card",{blockedMcc:["5411"]},"control",now),/idempotency.*conflict/i);
 assert.deepEqual(p.getControls("card").blockedMcc,[]);
});

test("an owner-bound processor cannot create or read another owner's cards",()=>{
 const p=setup();assert.throws(()=>p.createCard({cardAccountId:"foreign",walletAccount:other,cardId:"foreign",createdAt:now}),/owner/i);
 assert.throws(()=>Object.assign(p,{ownerAccount:other}));assert.throws(()=>Object.assign(p,{publicFundingEnabled:true}));
 const q=new TestnetSimulationProcessor(other);q.createCard({cardAccountId:"account",walletAccount:other,cardId:"card",createdAt:now});
 p.creditTestnetFunding("card",funding,now);assert.equal(q.getBalance("card").availableMinor,0);
 q.creditTestnetFunding("card",funding,now);assert.notEqual(p.getStatement("card")[0]?.id,q.getStatement("card")[0]?.id);
 assert.throws(()=>p.getCard("foreign"),/not found/i);
});

test("all input amount boundaries reject without a non-finite or unsafe ledger event",()=>{
 for(const amountMinor of [NaN,Infinity,-Infinity,0,-1,0.5,Number.MAX_SAFE_INTEGER+1]){
  const p=funded(),before=p.getStatement("card");
  assert.throws(()=>p.creditTestnetFunding("card",{...funding,amountMinor,idempotencyKey:"invalid-fund"},now));
  assert.throws(()=>p.authorize("card",{...merchant,amountMinor}));
  for(const op of ["capture","reverse"] as const)assert.throws(()=>p[op]("card",{authorizationId:"absent",amountMinor,idempotencyKey:op,timestamp:now}));
  assert.throws(()=>p.refund("card",{captureId:"absent",amountMinor,idempotencyKey:"refund",timestamp:now}));
  assert.deepEqual(p.getStatement("card"),before);
 }
});

test("total balance capacity counts available, pending, and posted funds before credit",()=>{
 const maximum=Number.MAX_SAFE_INTEGER,p=setup({maxSingleTransactionMinor:maximum,dailyLimitMinor:maximum,monthlyLimitMinor:maximum});
 p.creditTestnetFunding("card",{...funding,amountMinor:maximum},now);
 const a=p.authorize("card",{...merchant,amountMinor:1});p.capture("card",{authorizationId:a.id,amountMinor:1,idempotencyKey:"capture",timestamp:now});
 const second={...funding,txHash:"0x"+"cd".repeat(32),amountMinor:1,idempotencyKey:"overflow"};
 assert.throws(()=>p.creditTestnetFunding("card",second,now),/invariant|capacity|safe/i);
 assert.equal(p.getBalance("card").availableMinor,maximum-1);assert.equal(p.getBalance("card").postedMinor,1);
 assert.equal(p.getStatement("card").length,3);
});

test("controls validate at creation and update and own their deeply frozen arrays",()=>{
 for(const controls of [{dailyLimitMinor:0},{onlineEnabled:"yes"},{allowedMcc:["bad"]},{blockedCountries:["USA"]},{allowedMerchants:[""]},{unexpected:true},{constructor:1}])
  assert.throws(()=>setup(controls as unknown as Partial<ProcessorControls>),/control/i);
 const blocked=["5812"],p=funded({blockedMcc:blocked});blocked.length=0;
 assert.equal(p.authorize("card",merchant).reasonCode,"MCC_BLOCKED");
 assert.throws(()=> (p.getControls("card").blockedMcc as string[]).push("5411"));
 const countries=["US"];p.updateControls("card",{blockedCountries:countries},"controls",now);countries.push("GB");
 assert.deepEqual(p.getControls("card").blockedCountries,["US"]);
 assert.throws(()=>p.updateControls("card",{onlineEnabled:null} as unknown as Partial<ProcessorControls>,"invalid",now));
});

test("unsupported request values and reserved system keys fail before any ledger mutation",()=>{
 const p=funded(),before=p.getStatement("card");
 assert.throws(()=>p.authorize("card",{...merchant,unexpected:undefined} as typeof merchant));
 assert.throws(()=>p.authorize("card",{...merchant,idempotencyKey:"@expiration:reserved"}));
 assert.deepEqual(p.getStatement("card"),before);assert.equal(p.getBalance("card").pendingMinor,0);
});

test("expired partial holds release before a capture, exactly once, at the expiry boundary",()=>{
 const p=funded(),a=p.authorize("card",merchant);
 p.capture("card",{authorizationId:a.id,amountMinor:100,idempotencyKey:"capture-one",timestamp:now});
 const request={authorizationId:a.id,amountMinor:200,idempotencyKey:"expired-capture",timestamp:later};
 const declined=p.capture("card",request);assert.equal(declined.status,"declined");
 assert.deepEqual(p.getBalance("card"),{availableMinor:900,pendingMinor:0,postedMinor:100,asset:YNXT_TESTNET_ASSET});
 assert.equal(p.recover("card",later).length,0);assert.equal(p.capture("card",request),declined);
 assert.equal(p.getStatement("card").filter(e=>e.reasonCode==="AUTHORIZATION_EXPIRED").length,1);
});

test("closed is terminal, pending holds prevent close, and refunds remain possible",()=>{
 const p=funded(),a=p.authorize("card",merchant);
 assert.throws(()=>p.closeCard("card","close-pending",now),/pending/i);
 const c=p.capture("card",{authorizationId:a.id,amountMinor:300,idempotencyKey:"capture",timestamp:now});
 p.closeCard("card","close",now);assert.throws(()=>p.unfreezeCard("card","reopen",now),/closed/i);
 assert.throws(()=>p.freezeCard("card","refreeze",now),/closed/i);
 assert.throws(()=>p.creditTestnetFunding("card",{...funding,txHash:"0x"+"cd".repeat(32),idempotencyKey:"after-close"},now),/closed/i);
 assert.throws(()=>p.updateControls("card",{dailyLimitMinor:1},"controls",now),/closed/i);
 assert.equal(p.authorize("card",{...merchant,idempotencyKey:"closed-auth"}).reasonCode,"CARD_CLOSED");
 p.refund("card",{captureId:c.id,amountMinor:300,idempotencyKey:"refund",timestamp:now});assert.equal(p.getBalance("card").availableMinor,1000);
});

test("canonical monotonic time prevents backdated limit and expiry bypass",()=>{
 for(const timestamp of ["bad","2026-09-06","2026-09-06T01:00:00.000+01:00","2026-09-05T23:59:59.000Z"]){
  const p=funded();assert.throws(()=>p.authorize("card",{...merchant,timestamp}),/time/i);assert.equal(p.getStatement("card").length,1);
 }
 const p=funded();p.recover("card",later);assert.throws(()=>p.authorize("card",merchant),/time/i);
});

test("two cards cannot capture or refund each other's events",()=>{
 const p=funded();p.createCard({cardAccountId:"account",walletAccount:owner,cardId:"second",createdAt:now});
 const a=p.authorize("card",merchant),c=p.capture("card",{authorizationId:a.id,amountMinor:100,idempotencyKey:"capture",timestamp:now});
 assert.equal(p.capture("second",{authorizationId:a.id,amountMinor:1,idempotencyKey:"capture",timestamp:now}).status,"declined");
 assert.equal(p.refund("second",{captureId:c.id,amountMinor:1,idempotencyKey:"refund",timestamp:now}).status,"declined");
 assert.equal(p.getBalance("second").availableMinor,0);
});

test("interleaved partial settlements conserve funds and reject an over-refund",()=>{
 for(let amount=1;amount<=50;amount++){
  const p=funded(),a=p.authorize("card",{...merchant,amountMinor:amount*2});
  const c=p.capture("card",{authorizationId:a.id,amountMinor:amount,idempotencyKey:"capture",timestamp:now});
  p.reverse("card",{authorizationId:a.id,amountMinor:amount,idempotencyKey:"reverse",timestamp:now});
  p.refund("card",{captureId:c.id,amountMinor:amount,idempotencyKey:"refund",timestamp:now});
  assert.equal(p.refund("card",{captureId:c.id,amountMinor:1,idempotencyKey:"extra",timestamp:now}).status,"declined");
  assert.deepEqual(p.getBalance("card"),{availableMinor:1000,pendingMinor:0,postedMinor:0,asset:YNXT_TESTNET_ASSET});
 }
});

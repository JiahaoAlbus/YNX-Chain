import test from"node:test";
import assert from"node:assert/strict";
import{createRequire}from"node:module";
import{locales}from"./i18n";
import{registrationText,registrationStatus,registrationTemplate}from"./registrationCopy";
import{createDraft}from"./registration";
const require=createRequire(import.meta.url),{mountGuest}=require("../test/guest-experience-fixture.cjs");
const wallet={address:"0x1111111111111111111111111111111111111111",chainId:6423},walletB={address:"0x2222222222222222222222222222222222222222",chainId:6423};
async function fill(app:any,locale:any){await app.change(registrationText(locale,"nickname"),"Practice Card");await app.change(registrationText(locale,"useCase"),"Local test practice");await app.change(registrationText(locale,"limit"),"12.5");await app.change(registrationText(locale,"acceptTerms"),true)}
for(const locale of locales)test(`${locale}: real registration accepts sequential fields, prepares only after validation and safely degrades`,async t=>{
  const app=await mountGuest({platform:"web",locale,props:{walletSession:wallet}});t.after(()=>app.unmount());
  await app.press(app.buttons(registrationText(locale,"start"))[0]);assert.equal(app.storage.record.status,"DRAFT");
  await app.press(app.buttons(registrationText(locale,"prepareApproval"))[0]);assert.ok(app.text().includes(registrationText(locale,"completeDetails")));assert.equal(app.storage.record.status,"DRAFT");
  await fill(app,locale);assert.equal(app.storage.record.nickname,"");assert.equal(app.storage.record.riskAccepted,false);
  await app.change(registrationText(locale,"acceptTerms"),false);await app.press(app.buttons(registrationText(locale,"prepareApproval"))[0]);assert.ok(app.text().includes(registrationText(locale,"acceptDetails")));assert.equal(app.storage.record.status,"DRAFT");
  await app.change(registrationText(locale,"acceptTerms"),true);await app.press(app.buttons(registrationText(locale,"prepareApproval"))[0]);assert.equal(app.storage.record.status,"APPROVAL_REQUIRED");assert.equal(app.storage.record.nickname,"Practice Card");assert.ok(app.text().includes(registrationText(locale,"approvalPrepared")));
  await app.press(app.buttons(registrationText(locale,"submit"))[0]);assert.equal(app.storage.record.status,"DEGRADED");assert.ok(app.text().includes(registrationText(locale,"backendDegraded")));assert.equal(app.storage.record.backendReceipt,undefined);
  await app.press(app.buttons(registrationText(locale,"cancel"))[0]);assert.equal(app.storage.record.status,"CANCELLED");assert.ok(app.text().includes(registrationTemplate(locale,"status",{status:registrationStatus(locale,"CANCELLED")})));
  assert.equal(app.calls.native,0);assert.equal(app.calls.chooser,0);assert.equal(app.calls.metamask,0);
});
for(const platform of ["android","ios"])test(`${platform}: real registration never reads or writes storage or offers web application actions`,async t=>{
  const app=await mountGuest({platform,props:{walletSession:wallet},storageOptions:{record:createDraft(wallet.address)}});t.after(()=>app.unmount());
  assert.equal(app.calls.reads,0);assert.equal(app.calls.writes,0);assert.ok(app.text().includes(registrationText("en","nativeUnavailable")));assert.ok(app.text().includes(registrationText("en","nativeAuthority")));
  for(const key of ["start","prepareApproval","submit","cancel"] as const)assert.equal(app.buttons(registrationText("en",key)).length,0);
  assert.equal(app.calls.native,0);assert.equal(app.calls.chooser,0);assert.equal(app.calls.metamask,0);
});
test("registration read rejection shows safe localized failure and blocks actions",async t=>{
  const app=await mountGuest({platform:"web",locale:"zh-CN",props:{walletSession:wallet},storageOptions:{readError:true}});t.after(()=>app.unmount());assert.ok(app.text().includes(registrationText("zh-CN","storageLoadFailure")));assert.doesNotMatch(app.text(),/UNTRUSTED/);assert.equal(app.buttons(registrationText("zh-CN","start"))[0].props.disabled,true);assert.equal(app.calls.writes,0);
});
for(const failure of ["writeError","silentWriteFailure"])test(`${failure}: persistence failure retains the last confirmed draft without success or advancement`,async t=>{
  const original=createDraft(wallet.address),app=await mountGuest({platform:"web",props:{walletSession:wallet},storageOptions:{record:original,[failure]:true}});t.after(()=>app.unmount());await fill(app,"en");await app.press(app.buttons(registrationText("en","prepareApproval"))[0]);assert.equal(app.storage.record,original);assert.ok(app.text().includes(registrationText("en","storageSaveFailure")));assert.doesNotMatch(app.text(),/UNTRUSTED/);assert.ok(app.text().includes(registrationTemplate("en","status",{status:registrationStatus("en","DRAFT")})));assert.equal(app.buttons(registrationText("en","submit")).length,0);assert.ok(!app.text().includes(registrationText("en","approvalPrepared")));
});
test("failed draft creation does not display a draft or success",async t=>{
  const app=await mountGuest({platform:"web",props:{walletSession:wallet},storageOptions:{silentWriteFailure:true}});t.after(()=>app.unmount());await app.press(app.buttons(registrationText("en","start"))[0]);assert.equal(app.storage.record,null);assert.ok(app.text().includes(registrationText("en","storageSaveFailure")));assert.equal(app.buttons(registrationText("en","prepareApproval")).length,0);assert.ok(!app.text().includes(registrationText("en","draftCreated")));
});
test("late save completion cannot replace a newly selected wallet's form, record or notice",async t=>{
  let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>{release=resolve});
  const app=await mountGuest({platform:"web",props:{walletSession:wallet},storageOptions:{save:async(value:any,state:any)=>{await pending;state.record=value}}});t.after(()=>app.unmount());await app.press(app.buttons(registrationText("en","start"))[0]);assert.equal(app.calls.writes,1);
  await app.update({walletSession:walletB});release();await app.flush();assert.equal(app.buttons(registrationText("en","prepareApproval")).length,0);assert.ok(!app.text().includes(registrationText("en","draftCreated")));assert.equal(app.buttons(registrationText("en","start"))[0].props.disabled,false);
});
test("late load completion after wallet switch cannot expose the prior wallet's application",async t=>{
  let release:(value:any)=>void=()=>{};const pending=new Promise(resolve=>{release=resolve});let reads=0;
  const app=await mountGuest({platform:"web",props:{walletSession:wallet},storageOptions:{load:async()=>++reads===1?pending:null}});t.after(()=>app.unmount());await app.update({walletSession:walletB});release(createDraft(wallet.address));await app.flush();assert.equal(app.buttons(registrationText("en","prepareApproval")).length,0);assert.equal(app.buttons(registrationText("en","start"))[0].props.disabled,false);
});
test("late save completion after unmount stops before persistence readback",async()=>{
  let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>{release=resolve});const app=await mountGuest({platform:"web",props:{walletSession:wallet},storageOptions:{save:async()=>pending}});await app.press(app.buttons(registrationText("en","start"))[0]);const reads=app.calls.reads;await app.unmount();release();await app.flush();assert.equal(app.calls.reads,reads);
});

test("registration UI preserves the protocol's minimum 1 YNXT and UTF-16 length validation",async t=>{
  const app=await mountGuest({platform:"web",props:{walletSession:wallet}});t.after(()=>app.unmount());
  await app.press(app.buttons(registrationText("en","start"))[0]);await fill(app,"en");
  await app.change(registrationText("en","limit"),"0.5");await app.press(app.buttons(registrationText("en","prepareApproval"))[0]);
  assert.equal(app.storage.record.status,"DRAFT");assert.ok(app.text().includes(registrationText("en","completeDetails")));assert.equal(app.calls.writes,1);
  await app.change(registrationText("en","limit"),"1");await app.change(registrationText("en","nickname"),"🧪".repeat(25));await app.press(app.buttons(registrationText("en","prepareApproval"))[0]);
  assert.equal(app.storage.record.status,"DRAFT");assert.ok(app.text().includes(registrationText("en","completeDetails")));assert.equal(app.calls.writes,1);
  await app.change(registrationText("en","nickname"),"🧪".repeat(24));await app.change(registrationText("en","useCase"),"🧪🧪");await app.press(app.buttons(registrationText("en","prepareApproval"))[0]);
  assert.equal(app.storage.record.status,"APPROVAL_REQUIRED");assert.equal(app.storage.record.nickname.length,48);assert.equal(app.storage.record.useCase.length,4);assert.equal(app.storage.record.spendingLimitYnxt,"1");assert.equal(app.calls.writes,2);
});

for(const nextWallet of [walletB,null])test(`registration removes old-owner fields in the first committed tree on ${nextWallet?"wallet switch":"disconnect"}`,async t=>{
  const original={...createDraft(wallet.address),nickname:"Owner A private draft",useCase:"Only owner A should see this",riskAccepted:true};
  const app=await mountGuest({platform:"web",props:{walletSession:wallet},storageOptions:{record:original}});t.after(()=>app.unmount());
  assert.ok(app.text().includes(registrationText("en","prepareApproval")));const writes=app.calls.writes;
  await app.update({walletSession:nextWallet});const boundary=app.commits.find((entry:any)=>entry.owner===(nextWallet?.address??null));
  assert.ok(boundary,"Missing actual layout-effect commit snapshot");assert.deepEqual(boundary.values,[]);assert.doesNotMatch(boundary.text,/Owner A private draft|Only owner A should see this/);assert.equal(app.calls.writes,writes);
});
test("changing locale preserves the current owner's unsaved registration form",async t=>{
  const app=await mountGuest({platform:"web",props:{walletSession:wallet},storageOptions:{record:createDraft(wallet.address)}});t.after(()=>app.unmount());
  await app.change(registrationText("en","nickname"),"Unsubmitted nickname");await app.update({locale:"zh-CN"});
  const input=app.renderer.root.find((node:any)=>node.type==="TextInput"&&node.props.accessibilityLabel===registrationText("zh-CN","nickname"));assert.equal(input.props.value,"Unsubmitted nickname");assert.equal(app.calls.writes,0);
});

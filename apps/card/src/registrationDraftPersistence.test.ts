import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDraft,saveDraftFields} from './registration';
import {registrationText} from './registrationCopy';
import {locales} from './i18n';
const require=createRequire(import.meta.url);
const {mountGuest}=require('../test/guest-experience-fixture.cjs');
const owner='0x'+'a'.repeat(40),walletSession={address:owner,chainId:'0x1917'};
for(const locale of locales)test(`${locale}: incomplete draft saves without terms and restores after remount`,async t=>{
 const app=await mountGuest({platform:'web',locale,props:{walletSession},storageOptions:{record:createDraft(owner)}});t.after(()=>app.unmount());
 await app.change(registrationText(locale,'nickname'),'Testnet validation');
 await app.press(app.buttons(registrationText(locale,'saveDraft'))[0]);
 const stored=app.storage.record;
 assert.equal(stored.status,'DRAFT');assert.equal(stored.nickname,'Testnet validation');assert.equal(stored.useCase,'');assert.equal(stored.riskAccepted,false);assert.equal(stored.audit[0].event,'DRAFT_SAVED');assert.equal(stored.backendReceipt,undefined);
 assert.ok(app.text().includes(registrationText(locale,'draftSaved')));
 const restored=await mountGuest({platform:'web',locale,props:{walletSession},storageOptions:{record:stored}});t.after(()=>restored.unmount());
 const field=restored.renderer.root.find((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel===registrationText(locale,'nickname'));
 assert.equal(field.props.value,'Testnet validation');assert.equal(app.calls.metamask,0);assert.equal(app.calls.native,0);
});
test('repeated identical draft save does not create duplicate audit or activation',()=>{
 const draft=createDraft(owner),fields={nickname:'Draft',useCase:'',spendingLimitYnxt:'10',riskAccepted:false};
 const saved=saveDraftFields(draft,fields);assert.equal(saveDraftFields(saved,fields),saved);assert.equal(saved.audit.length,2);assert.equal(saved.idempotencyKey,draft.idempotencyKey);
 for(const status of ['ACTIVE','SUBMITTED','APPROVAL_REQUIRED','CANCELLED'] as const)assert.throws(()=>saveDraftFields({...saved,status},fields),/Only DRAFT/);
 assert.equal(draft.nickname,'');
});
test('failed draft write preserves input and never reports saved',async t=>{
 const app=await mountGuest({platform:'web',props:{walletSession},storageOptions:{record:createDraft(owner),silentWriteFailure:true}});t.after(()=>app.unmount());
 await app.change('Card nickname','Unsaved draft');await app.press(app.buttons(registrationText('en','saveDraft'))[0]);
 assert.equal(app.storage.record.nickname,'');assert.ok(app.text().includes(registrationText('en','storageSaveFailure')));assert.ok(!app.text().includes(registrationText('en','draftSaved')));
 const field=app.renderer.root.find((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel==='Card nickname');assert.equal(field.props.value,'Unsaved draft');
});
test('draft save cannot produce a record for another wallet',()=>{
 const original=createDraft(owner),fields={nickname:'Test',useCase:'',spendingLimitYnxt:'10',riskAccepted:false};
 for(const injected of [{owner:'0x'+'b'.repeat(40)},{status:'ACTIVE'},{id:'wrong-application'},{controls:{online:false,international:true,frozen:true}},{idempotencyKey:'wrong-key'},{backendReceipt:'sandbox-receipt-injected123'},{createdAt:'2000-01-01T00:00:00.000Z'},{audit:[]},{injectedExtra:true},{owner:'0x'+'b'.repeat(40),status:'ACTIVE',backendReceipt:'sandbox-receipt-injected123'}]){
  const saved=saveDraftFields(original,{...fields,...injected});
  assert.equal(saved.owner,owner);assert.equal(saved.status,'DRAFT');assert.equal(saved.id,original.id);assert.equal(saved.controls,original.controls);assert.equal(saved.idempotencyKey,original.idempotencyKey);assert.equal(saved.createdAt,original.createdAt);assert.equal(saved.backendReceipt,undefined);assert.equal(Object.hasOwn(saved,'injectedExtra'),false);assert.equal(saved.audit.length,2);assert.equal(saved.audit[1],original.audit[0]);
 }
 assert.equal(original.nickname,'');
});

test('saved draft cannot display under another selected wallet and returns when original owner restores',async t=>{
 const app=await mountGuest({platform:'web',props:{walletSession},storageOptions:{record:createDraft(owner)}});t.after(()=>app.unmount());
 await app.change('Card nickname','Original wallet draft');await app.press(app.buttons(registrationText('en','saveDraft'))[0]);
 await app.update({walletSession:{address:'0x'+'b'.repeat(40),chainId:'0x1917'}});
 assert.equal(app.renderer.root.findAll((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel==='Card nickname').length,0);
 assert.ok(!app.text().includes('Original wallet draft'));
 await app.update({walletSession});
 const field=app.renderer.root.find((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel==='Card nickname');assert.equal(field.props.value,'Original wallet draft');assert.equal(app.storage.record.owner,owner);
});

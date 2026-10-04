import test from 'node:test';
import assert from 'node:assert/strict';
import {guestAuthorizationDetail,guestDecisionText,isGuestAuthorizationDecision} from './guestAuthorizationDecision';
import {locales} from './i18n';
import {GuestSandboxJournal,validGuestSandbox,GUEST_SANDBOX_KEY} from './guestSandboxJournal';

test('guest authorization enforces freeze and online control without manufacturing approval',()=>{
 const frozen=guestAuthorizationDetail('Simulate authorization','preview',{frozen:true,online:false});
 assert.equal(frozen,'GUEST_DEMO_DECLINED_CARD_FROZEN');
 assert.equal(guestAuthorizationDetail('Authorization simulation','preview',{frozen:false,online:false}),'GUEST_DEMO_DECLINED_ONLINE_DISABLED');
 assert.equal(guestAuthorizationDetail('Simulate authorization','preview',{frozen:false,online:true}),'preview');
 assert.equal(guestAuthorizationDetail('Simulate capture','preview',{frozen:true,online:false}),'preview');
 assert.equal(isGuestAuthorizationDecision('Simulate capture',frozen),false);
 assert.equal(isGuestAuthorizationDecision('Simulate authorization','APPROVED'),false);
});
test('new decline audit survives cold recovery without altering old valid records',()=>{
 const records=new Map<string,string>();
 const storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value)}};
 const journal=new GuestSandboxJournal(storage);
 const detail=guestAuthorizationDetail('Simulate authorization','preview',{frozen:true,online:true});
 const next={...journal.snapshot,controls:{...journal.snapshot.controls,frozen:true},events:[{id:2,label:'Simulate authorization',detail},{id:1,label:'Simulate refund',detail:'Refund workflow prepared locally'}]};
 assert.equal(journal.save(next),true);
 assert.deepEqual(new GuestSandboxJournal(storage).snapshot,next);
 assert.equal(validGuestSandbox({...next,events:[{id:3,label:'Simulate capture',detail}]}),false);
 assert.equal(records.has(GUEST_SANDBOX_KEY),true);
});
test('decline details localize for all supported languages without English fallback',()=>{
 for(const locale of locales){
  for(const code of ['GUEST_DEMO_DECLINED_CARD_FROZEN','GUEST_DEMO_DECLINED_ONLINE_DISABLED']){
   const text=guestDecisionText(locale,code);
   assert.ok(text&&text!==code);
   if(locale!=='en')assert.notEqual(text,guestDecisionText('en',code));
  }
 }
 assert.equal(guestDecisionText('en','UNTRUSTED_DETAIL'),null);
});

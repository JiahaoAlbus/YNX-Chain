import test from 'node:test';
import assert from 'node:assert/strict';
import {accountCreated,continuePersistedAccount,sanitizedFailureSnapshot} from './linux-password-installed-gate.mjs';
const state=locked=>({locked,account:{initialized:true,passwordConfigured:true,custody:'password-encrypted-local',account:'dedicated-public-account'},ui:{}});
test('module import does not launch installed app or require Linux fixture credentials',()=>{assert.equal(typeof continuePersistedAccount,'function')});
test('persisted create is recognized while security is locked',()=>{
 assert.equal(accountCreated(state(true)),true);assert.equal(accountCreated(state(false)),true);
 for(const account of [null,{initialized:false},{initialized:true,custody:'external',account:'address'},{initialized:true,custody:'password-encrypted-local',account:''}])assert.equal(accountCreated({account}),false);
});
for(const locked of [true,false])test(`persisted account uses ordinary UI unlock only when locked=${locked}`,async()=>{
 let unlocks=0,waits=0;const original=state(locked);
 const result=await continuePersistedAccount(original,{unlock:async()=>{unlocks++},wait:async(predicate,label)=>{
  waits++;assert.equal(label,'CREATE_UNLOCK');assert.equal(predicate(state(true)),false);assert.equal(predicate({...state(false),account:{...state(false).account,account:'different-account'}}),false);assert.equal(predicate({...state(false),account:{...state(false).account,initialized:false}}),false);assert.equal(predicate(state(false)),true);
 }},'CREATE_UNLOCK');
 assert.equal(result,original.account);assert.equal(unlocks,Number(locked));assert.equal(waits,1);
});
test('missing persistence never opens unlock and rejected UI unlock cannot continue',async()=>{
 let waits=0,unlocks=0;
 await assert.rejects(continuePersistedAccount({locked:true,account:null},{unlock:async()=>{unlocks++},wait:async()=>{waits++}},'UNLOCK'),/PERSISTED_ACCOUNT_REQUIRED/);
 assert.equal(unlocks,0);await assert.rejects(continuePersistedAccount(state(true),{unlock:async()=>{throw Error('UI_UNLOCK_REJECTED')},wait:async()=>{waits++}},'UNLOCK'),/UI_UNLOCK_REJECTED/);assert.equal(waits,0);
});
test('failure snapshot exposes only bounded stage, booleans and allowlisted-shape code',()=>{
 const input={...state(true),error:'WALLET_LOCKED',secret:'NEVER_EXPORT',password:'NEVER_EXPORT',account:{...state(true).account,account:'PRIVATE_FULL_ACCOUNT',seed:'NEVER_EXPORT'},ui:{detail:'NEVER_EXPORT',passwordResult:'NEVER_EXPORT',passwordSheetOpen:true,passwordSubmitEnabled:true}};
 const result=sanitizedFailureSnapshot(input,'NORMAL_CREATE_PERSISTED');assert.equal(result.initialized,true);assert.equal(result.locked,true);assert.equal(result.errorCode,'WALLET_LOCKED');assert.equal(result.stage,'NORMAL_CREATE_PERSISTED');assert.equal(result.passwordSheetOpen,true);
 const encoded=JSON.stringify(result);assert.equal(encoded.includes('NEVER_EXPORT'),false);assert.equal(encoded.includes('PRIVATE_FULL_ACCOUNT'),false);assert.equal(sanitizedFailureSnapshot({...input,error:'credential secret'},'x'.repeat(200)).errorCode,null);assert.ok(sanitizedFailureSnapshot(input,'A'.repeat(200)).stage.length<=80);
});

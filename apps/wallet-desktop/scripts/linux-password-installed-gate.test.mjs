import test from 'node:test';
import assert from 'node:assert/strict';
import {accountCreated,continuePersistedAccount,sanitizedFailureSnapshot,finishNativeSave,backupOutcome,backupFileCandidates,observeNativeSave} from './linux-password-installed-gate.mjs';
import {sanitizeBackupPhases} from './linux-password-installed-gate.mjs';
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

test('native location entry still open requires explicit native Save keyboard action',async()=>{
 let entered=0,saved=0,clock=0,exists=false;const diagnostics={explicitSaveActionSent:false};
 await finishNativeSave({enterDestination:async()=>{entered++},saveAction:async()=>{saved++;exists=true},fileExists:async()=>exists,dialogVisible:async()=>true,sleep:async ms=>{clock+=ms},diagnostics});
 assert.equal(entered,1);assert.equal(saved,1);assert.equal(clock,500);assert.deepEqual(diagnostics,{explicitSaveActionSent:true,dialogVisibleAfterDestination:true});
});
test('already saved or dismissed native dialog never sends a duplicate Save action',async()=>{
 for(const immediate of [true,false]){let calls=0,clock=0;const diagnostics={explicitSaveActionSent:false};
  await finishNativeSave({enterDestination:async()=>{},saveAction:async()=>assert.fail('duplicate/unrelated key action'),fileExists:async()=>immediate||++calls>5,dialogVisible:async()=>false,sleep:async ms=>{clock+=ms},diagnostics});
  assert.equal(diagnostics.explicitSaveActionSent,false);assert.ok(clock<=500);
 }
});
test('native Save rejection remains bounded failure with safe boolean diagnostics',async()=>{
 let saves=0,clock=0;const diagnostics={explicitSaveActionSent:false};
 await assert.rejects(finishNativeSave({enterDestination:async()=>{},saveAction:async()=>{saves++},fileExists:async()=>false,dialogVisible:async()=>true,sleep:async ms=>{clock+=ms},diagnostics}),/NATIVE_BACKUP_NOT_SAVED/);
 assert.equal(saves,1);assert.equal(clock,30500);assert.deepEqual(diagnostics,{explicitSaveActionSent:true,dialogVisibleAfterDestination:true,dialogStillVisible:true,destinationExists:false});
});

test('backup result classifier emits only allowlisted outcomes, never raw text',()=>{
 for(const [text,expected] of [['Encrypted backup saved. Keep its password separately.','SAVED'],['Backup was not saved.','CANCELED'],['Encrypting your backup…','PENDING'],['','PENDING'],['Safe explanation (WALLET_OPERATION_CANCELLED)','LOCKED_OR_OPERATION_CHANGED'],['Safe explanation (WALLET_LOCKED)','LOCKED_OR_OPERATION_CHANGED'],['RAW_PRIVATE_PROVIDER_DETAIL','OTHER_ERROR']])assert.equal(backupOutcome(text),expected);
});
test('backup file checks are exactly dedicated destination and five derived default paths',()=>{
 const candidates=backupFileCandidates({account:'0x12345678'+'a'.repeat(32),backup:'/qa/expected.json',home:'/qa/home',workspace:'/qa/workspace'});
 assert.deepEqual(candidates.map(x=>x.file),['/qa/expected.json','/qa/ynx-wallet-12345678.json','/qa/home/ynx-wallet-12345678.json','/qa/home/Documents/ynx-wallet-12345678.json','/qa/home/Downloads/ynx-wallet-12345678.json','/qa/workspace/ynx-wallet-12345678.json']);
 assert.throws(()=>backupFileCandidates({account:'../../not-an-account',backup:'/qa/expected',home:'/qa/home',workspace:'/qa/workspace'}));
 assert.throws(()=>backupFileCandidates({account:'0x'+'a'.repeat(40),backup:'relative',home:'/qa/home',workspace:'/qa/workspace'}));
});
test('post-attempt observer samples new UI once and only stats exact QA candidates',async()=>{
 const candidates=backupFileCandidates({account:'0x'+'a'.repeat(40),backup:'/qa/expected',home:'/qa/home',workspace:'/qa/workspace'});const checked=[];let snapshots=0;
 const current={...state(true),documentFocused:false,secret:'NEVER_EXPORT',ui:{backupResult:'private text (WALLET_OPERATION_CANCELLED)',saveButtonEnabled:false,unlockEnabled:true}};
 const observed=await observeNativeSave({snapshot:async()=>{snapshots++;return current},candidates,now:()=> '2026-10-01T08:00:00Z',stat:async file=>{checked.push(file);if(file===candidates[1].file)return{isFile:()=>true,isSymbolicLink:()=>false,size:100,mode:0o100600};throw Object.assign(Error('path must not leak'),{code:'ENOENT'})}});
 assert.equal(observed.snapshot,current);assert.equal(snapshots,1);assert.deepEqual(checked,candidates.map(x=>x.file));assert.equal(observed.diagnostic.locked,true);assert.equal(observed.diagnostic.documentFocused,false);assert.equal(observed.diagnostic.backupOutcome,'LOCKED_OR_OPERATION_CHANGED');assert.equal(observed.diagnostic.files[1].exists,true);assert.equal(observed.diagnostic.files[1].mode,0o600);
 const text=JSON.stringify(observed.diagnostic);for(const secret of ['NEVER_EXPORT','private text','/qa/','ynx-wallet-','aaaaaaaa'])assert.equal(text.includes(secret),false);
});
test('stat errors and symlinks are classified without reading or following file contents',async()=>{
 const result=await observeNativeSave({snapshot:async()=>({...state(false),documentFocused:true,ui:{backupResult:'Encrypted backup saved. Keep its password separately.',saveButtonEnabled:true}}),candidates:[{location:'EXPECTED_QA_DESTINATION',file:'/qa/a'},{location:'RUNNER_HOME_DEFAULT',file:'/qa/b'}],stat:async file=>{if(file==='/qa/a')return{isFile:()=>false,isSymbolicLink:()=>true,size:12,mode:0o120777};throw Object.assign(Error('PRIVATE_PATH_DETAILS'),{code:'EACCES'})}});
 assert.equal(result.diagnostic.backupOutcome,'SAVED');assert.equal(result.diagnostic.files[0].symbolicLink,true);assert.equal(result.diagnostic.files[0].regularFile,false);assert.equal(result.diagnostic.files[1].statError,'STAT_FAILED');assert.equal(JSON.stringify(result.diagnostic).includes('PRIVATE_PATH_DETAILS'),false);
});

test('native selection and focus observations cannot export paths or arbitrary IPC fields',()=>{
 const phases=sanitizeBackupPhases([{phase:'dialog-returned',revision:3,locked:false,focused:false,ownedDialogPhase:'open',selectedPathPresent:true,selectedPathMatchesQA:false,selectedDirectoryMatchesQA:true,selectedNameMatchesQA:false,path:'/PRIVATE/PATH',password:'PRIVATE_PASSWORD'}, {phase:'unknown',revision:4}]);
 assert.equal(phases.length,1);assert.equal(phases[0].selectedDirectoryMatchesQA,true);assert.equal(phases[0].selectedNameMatchesQA,false);assert.equal(phases[0].focused,false);assert.equal(phases[0].revision,3);assert.equal(JSON.stringify(phases).includes('PRIVATE'),false);
 assert.equal(sanitizeBackupPhases(Array.from({length:20},()=>({phase:'started',revision:-1}))).length,12);assert.equal(sanitizeBackupPhases([{phase:'failed',revision:'SECRET'}])[0].revision,null);
});

import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fillNativeChooser,nativeChooserScript} from './linux-password-installed-gate.mjs';
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

for(const failed of [null,'LOCATION','NAME'])test('native chooser semantic input verifies each real field before Save '+failed,async()=>{
 const calls=[];let observations=0;const diagnostics={};
 const action=label=>async()=>calls.push(label);
 const operation=fillNativeChooser({diagnostics,directory:'/qa',name:'backup.json',observe:async()=>{observations++;return{fields:observations===1?[]:[{field:observations===2?'LOCATION':'NAME',matchesExpected:failed!==(observations===2?'LOCATION':'NAME'),characters:10,difference:'MATCH'}]}},openLocation:action('open-location'),focusLocation:action('focus-location'),focusName:action('focus-name'),type:async value=>calls.push(value==='/qa'?'type-directory':'type-name'),navigate:action('navigate'),sleep:action('settle')});
 if(failed)await assert.rejects(operation,new RegExp('NATIVE_'+failed+'_NOT_MATCHED'));else await operation;
 assert.equal(calls.includes('navigate'),failed!=='LOCATION');assert.equal(calls.includes('type-name'),failed!=='LOCATION');assert.equal(diagnostics.initial.fields.length,0);
 assert.equal(JSON.stringify(diagnostics).includes('/qa'),false);assert.equal(JSON.stringify(diagnostics).includes('backup.json'),false);
});

test('executed native accessibility adapter exports only matched semantic fields, not unrelated Wallet or chooser text',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ynx-native-chooser-adapter-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const stub=String.raw`
STATE_SHOWING=1
STATE_EDITABLE=2
STATE_FOCUSED=3
RELATION_LABELLED_BY=4
def setTimeout(*args): pass
class State:
 def __init__(self,editable): self.editable=editable
 def contains(self,flag): return flag==STATE_SHOWING or (flag==STATE_EDITABLE and self.editable)
class Text:
 characterCount=22
 def getText(self,*args): return 'PRIVATE_CHOOSER_TEXT'
class Control:
 nActions=1
 def getName(self,index): return 'click'
 def doAction(self,index): return True
 def grabFocus(self): return True
class Node:
 def __init__(self,name,role,children=[],editable=False): self.name=name;self.role=role;self.children=children;self.editable=editable;self.childCount=len(children)
 def __getitem__(self,index): return self.children[index]
 def getRoleName(self): return self.role
 def getState(self): return State(self.editable)
 def getRelationSet(self): return []
 def queryText(self):
  if self.name!='Name': raise Exception('MUST_NOT_READ_UNRELATED_TEXT')
  return Text()
 def queryAction(self): return Control()
 def queryComponent(self): return Control()
wallet=Node('YNX Wallet','frame',[Node('PRIVATE_PASSWORD','password text',editable=True)])
dialog=Node('Save encrypted Wallet backup','dialog',[Node('Name','text',editable=True),Node('Save','push button'),Node('Other','text',editable=True)])
root=Node('desktop','desktop',[Node('YNX Wallet','application',[wallet,dialog])])
class Registry:
 @staticmethod
 def getDesktop(index): return root
`;
 await writeFile(path.join(directory,'pyatspi.py'),stub);
 const value=JSON.parse(execFileSync('/usr/bin/python3',['-c',nativeChooserScript,'observe','/qa/expected.json'],{encoding:'utf8',env:{...process.env,PYTHONPATH:directory},timeout:5000}));
 assert.equal(value.ok,true);assert.equal(value.fields.length,1);assert.equal(value.fields[0].field,'NAME');assert.equal(value.fields[0].matchesExpected,false);assert.equal(value.fields[0].difference,'DIFFERENT');assert.equal(value.saveAvailable,true);assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
 const focused=JSON.parse(execFileSync('/usr/bin/python3',['-c',nativeChooserScript,'focus-name','/qa/expected.json'],{encoding:'utf8',env:{...process.env,PYTHONPATH:directory},timeout:5000}));assert.equal(focused.ok,true);
 await writeFile(path.join(directory,'pyatspi.py'),stub+'\nroot.children[0].children.append(dialog)\nroot.children[0].childCount=3\n');
 try{execFileSync('/usr/bin/python3',['-c',nativeChooserScript,'save','/qa/expected.json'],{encoding:'utf8',env:{...process.env,PYTHONPATH:directory},timeout:5000});assert.fail('ambiguous dialog must reject')}catch(error){assert.equal(error.status,2);const result=JSON.parse(error.stdout);assert.equal(result.ok,false);assert.equal(result.code,'NATIVE_CHOOSER_DIALOG_NOT_UNIQUE');assert.equal(error.stdout.includes('PRIVATE'),false)}
});

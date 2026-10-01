/** Real installed DEB UI custody gate. No account, provider or key is injected. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installedMessageIs,passwordActionReady} from './windows-password-form-state.mjs';
export function accountCreated(snapshot){return snapshot?.account?.initialized===true&&snapshot.account.custody==='password-encrypted-local'&&typeof snapshot.account.account==='string'&&snapshot.account.account.length>0}
export async function continuePersistedAccount(snapshot,{unlock,wait},label){
 assert.equal(accountCreated(snapshot),true,'PERSISTED_ACCOUNT_REQUIRED');const account=snapshot.account.account;
 if(snapshot.locked)await unlock();
 await wait(s=>!s.locked&&accountCreated(s)&&s.account.account===account,label);
 return snapshot.account;
}
export async function finishNativeSave({enterDestination,saveAction,fileExists,dialogVisible,sleep,diagnostics}){
 await enterDestination();
 // Enter may finish the GTK location-entry step without activating Save.
 for(let n=0;n<5;n++){if(await fileExists())return;await sleep(100)}
 diagnostics.dialogVisibleAfterDestination=await dialogVisible();
 if(diagnostics.dialogVisibleAfterDestination){await saveAction();diagnostics.explicitSaveActionSent=true}
 for(let n=0;n<100;n++){if(await fileExists())return;await sleep(300)}
 diagnostics.dialogStillVisible=await dialogVisible();diagnostics.destinationExists=await fileExists();throw Error('NATIVE_BACKUP_NOT_SAVED');
}
export function backupOutcome(text){
 if(installedMessageIs(text,'Encrypted backup saved. Keep its password separately.'))return 'SAVED';
 if(installedMessageIs(text,'Backup was not saved.'))return 'CANCELED';
 if(!String(text??'').trim()||installedMessageIs(text,'Encrypting your backup…'))return 'PENDING';
 if(/\((?:WALLET_LOCKED|WALLET_OPERATION_CANCELLED)\)/.test(String(text)))return 'LOCKED_OR_OPERATION_CHANGED';
 return 'OTHER_ERROR';
}
export function backupFileCandidates({account,backup,home,workspace}){
 assert.match(account,/^0x[0-9a-fA-F]{40}$/);for(const value of [backup,home,workspace])assert.equal(path.isAbsolute(value),true);
 const filename='ynx-wallet-'+account.slice(2,10)+'.json';
 return [{location:'EXPECTED_QA_DESTINATION',file:backup},{location:'QA_DESTINATION_DIRECTORY_DEFAULT',file:path.join(path.dirname(backup),filename)},{location:'RUNNER_HOME_DEFAULT',file:path.join(home,filename)},{location:'RUNNER_DOCUMENTS_DEFAULT',file:path.join(home,'Documents',filename)},{location:'RUNNER_DOWNLOADS_DEFAULT',file:path.join(home,'Downloads',filename)},{location:'QA_WORKSPACE_DEFAULT',file:path.join(workspace,filename)}];
}
export function sanitizeBackupPhases(phases){
 const allowed=new Set(['started','encrypted','dialog-open','dialog-returned','focus-validated','write-started','write-completed','failed']);
 return (Array.isArray(phases)?phases:[]).slice(-12).filter(p=>allowed.has(p?.phase)).map(p=>({phase:p.phase,revision:Number.isSafeInteger(p.revision)&&p.revision>=0?p.revision:null,locked:p.locked===true,focused:p.focused===true,ownedDialogPhase:['open','awaiting-focus'].includes(p.ownedDialogPhase)?p.ownedDialogPhase:null,...(p.phase==='dialog-returned'?Object.fromEntries(['canceled','selectedPathPresent','selectedPathMatchesQA','selectedDirectoryMatchesQA','selectedNameMatchesQA','selectedNameMatchesDefault'].map(k=>[k,p[k]===true])):{})}));
}
export async function observeNativeSave({snapshot,candidates,stat=fs.lstat,now=()=>new Date().toISOString()}){
 const observed=await snapshot(),ui=observed.ui??{};
 const result={sampledAt:now(),observation:'AFTER_NATIVE_SAVE_ATTEMPT',backupOutcome:backupOutcome(ui.backupResult),locked:observed.locked===true,documentFocused:observed.documentFocused===true,saveButtonEnabled:ui.saveButtonEnabled===true,unlockEnabled:ui.unlockEnabled===true,phases:sanitizeBackupPhases(observed.backupQA),files:[]};
 for(const {location,file} of candidates){try{const entry=await stat(file);result.files.push({location,exists:true,regularFile:entry.isFile(),symbolicLink:entry.isSymbolicLink(),bytes:entry.size,mode:entry.mode&0o777})}catch(error){result.files.push({location,exists:false,statError:error.code==='ENOENT'?'NOT_FOUND':'STAT_FAILED'})}}
 return {snapshot:observed,diagnostic:result};
}
export function sanitizedFailureSnapshot(snapshot,stage){
 const ui=snapshot?.ui??{};return{stage:String(stage).replace(/[^A-Z0-9_]/g,'').slice(0,80),accountAvailable:Boolean(snapshot?.account),initialized:snapshot?.account?.initialized===true,passwordConfigured:snapshot?.account?.passwordConfigured===true,accountPresent:typeof snapshot?.account?.account==='string'&&snapshot.account.account.length>0,passwordEncryptedCustody:snapshot?.account?.custody==='password-encrypted-local',locked:snapshot?.locked===true,errorCode:/^[A-Z][A-Z0-9_]{0,79}$/.test(snapshot?.error??'')?snapshot.error:null,passwordSheetOpen:ui.passwordSheetOpen===true,passwordModeUnlock:ui.passwordModeUnlock===true,passwordSubmitEnabled:ui.passwordSubmitEnabled===true,unlockEnabled:ui.unlockEnabled===true,importEnabled:ui.importEnabled===true};
}
export async function runInstalledGate(){
const [mode]=process.argv.slice(2),password=process.env.YNX_WALLET_QA_PASSWORD,backupPassword=process.env.YNX_WALLET_QA_BACKUP_PASSWORD;
assert.equal(process.platform,'linux');assert.ok(['online','offline'].includes(mode));assert.ok(password?.length>=12);assert.ok(backupPassword?.length>=12);
const executable='/opt/YNX Wallet/ynx-wallet-desktop',temporary=await fs.realpath(process.env.RUNNER_TEMP),output=path.resolve('apps/wallet-desktop/dist/linux-'+mode+'-lifecycle.json');
const prefix=path.join(temporary,'ynx-linux-installed-'+mode),profile=prefix+'-profile',recoveryProfile=prefix+'-recovery-profile',backup=prefix+'-backup.json';
for(const destination of [profile,recoveryProfile,backup])await assert.rejects(fs.stat(destination),{code:'ENOENT'});
let child,socket,nextId=0,activeProfile,lastSnapshot,stage='START';const pauses=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={sourceCommit:process.env.GITHUB_SHA,platform:'linux',architecture:process.arch,installedExecutable:executable,mode,userMachineVerified:false,osRebootVerified:false,appImageRuntimeVerified:false,passed:false};
async function close(){
 socket?.close();socket=null;if(!child)return;
 const process=child;child=undefined;process.kill('SIGTERM');
 for(let n=0;n<100&&process.exitCode===null&&process.signalCode===null;n++)await pauses(100);
 if(process.exitCode===null&&process.signalCode===null){process.kill('SIGKILL');throw Error('INSTALLED_APP_DID_NOT_CLOSE')}
}
async function launch(destination){
 assert.equal(child,undefined);activeProfile=destination;
 child=spawn(executable,['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9334'],{env:{...process.env,YNX_WALLET_PROFILE_PATH:destination,YNX_WALLET_EVIDENCE_PATH:prefix+'-launch.json',YNX_WALLET_QA_BACKUP_DESTINATION:backup},stdio:['ignore','ignore','ignore']});
 for(let n=0;n<60;n++){
  if(child.exitCode!==null||child.signalCode!==null)throw Error('INSTALLED_APP_EXITED');
  try{const pages=await(await fetch('http://127.0.0.1:9334/json/list')).json(),page=pages.find(p=>p.type==='page'&&p.url?.startsWith('file:')&&decodeURIComponent(new URL(p.url).pathname).startsWith('/opt/YNX Wallet/resources/app.asar/')&&p.webSocketDebuggerUrl);
   if(page){socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});break}
  }catch{}await pauses(500);
 }
 if(!socket)throw Error('INSTALLED_PAGE_UNAVAILABLE');
 let preload=false;for(let n=0;n<60;n++){try{preload=await evaluate(`Boolean(window.ynxWallet&&typeof window.ynxWallet.accountStatus==='function'&&typeof window.ynxWallet.securityStatus==='function')`);if(preload)break}catch{}await pauses(500)}if(!preload)throw Error('PRELOAD_UNAVAILABLE');
 execFileSync('xdotool',['search','--sync','--onlyvisible','--name','^YNX Wallet$','windowfocus','--sync'],{timeout:5000});
 await until(s=>s.account!==null,'PRELOAD_READY');
 const version=await evaluate('(async()=> (await window.ynxWallet.appInfo()).version)()');assert.equal(version,process.env.YNX_WALLET_EXPECTED_VERSION);report.version=version;
 if(mode==='offline')await until(s=>/unavailable|不可用/i.test(s.network),'OFFLINE_UI_REQUIRED');
}
async function protocol(method,params){
 const id=++nextId;return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{socket?.removeEventListener('message',listener);reject(Error('PAGE_TIMEOUT'))},30000);
  const listener=e=>{let reply;try{reply=JSON.parse(e.data)}catch{return}if(reply.id!==id)return;clearTimeout(timeout);socket.removeEventListener('message',listener);
   if(reply.error||reply.result?.exceptionDetails)reject(Error('PAGE_OPERATION_FAILED'));else resolve(reply.result)};
  socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){return(await protocol('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result?.value}
async function snapshot(){return evaluate(`(async()=>{
 const account=await window.ynxWallet.accountStatus(),security=await window.ynxWallet.securityStatus(),sheet=document.querySelector('#password-sheet'),submit=document.querySelector('#submit-password'),unlock=document.querySelector('#unlock-wallet');
 return {account:account.ok?account.value:null,error:account.ok?null:account.error?.code,locked:security.locked,backupQA:security.backupQA,documentFocused:document.hasFocus(),network:document.querySelector('#network')?.textContent,
 ui:{saveButtonEnabled:Boolean(document.querySelector('#save-backup')&&!document.querySelector('#save-backup').disabled&&document.querySelector('#save-backup').getClientRects().length),passwordResult:document.querySelector('#password-result')?.textContent,unlockResult:document.querySelector('#unlock-result')?.textContent,detail:document.querySelector('#account-detail')?.textContent,backupResult:document.querySelector('#backup-result')?.textContent,importResult:document.querySelector('#import-result')?.textContent,importEnabled:!document.querySelector('#import-form button')?.disabled,passwordSheetOpen:sheet?.open,passwordModeUnlock:sheet?.open?document.querySelector('#local-confirm-group')?.hidden:null,passwordSubmitEnabled:Boolean(sheet?.open&&submit&&!submit.disabled&&submit.getClientRects().length),unlockEnabled:Boolean(unlock&&!unlock.disabled&&unlock.getClientRects().length)}};
})()`)}
async function until(predicate,label){stage=label;for(let n=0;n<100;n++){const s=lastSnapshot=await snapshot();if(s.error)throw Error(label+':'+s.error);if(predicate(s))return s;await pauses(300)}throw Error(label+':TIMEOUT')}
async function click(selector){assert.equal(await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled||!b.getClientRects().length)return false;b.click();return true})()`),true,'UI_BUTTON_NOT_AVAILABLE')}
async function fill(selector,value){assert.equal(await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input||input.disabled||!input.getClientRects().length)return false;input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`),true,'UI_FIELD_NOT_AVAILABLE')}
async function form(value,confirmation){
 const unlock=confirmation===undefined;await until(s=>passwordActionReady(s,unlock),'PASSWORD_CONTROL_READY');
 if(!(await snapshot()).ui.passwordSheetOpen)await click('#unlock-wallet');
 await fill('#local-password',value);if(!unlock)await fill('#local-confirm',confirmation);await click('#submit-password');
}
async function digest(){const bytes=await fs.readFile(path.join(activeProfile,'wallet-vault-v3.json'));return createHash('sha256').update(bytes).digest('hex')}
async function unlockSame(account){
 const before=await digest();await form('Incorrect dedicated QA password');
 await until(s=>s.locked&&s.account.account===account&&[s.ui.passwordResult,s.ui.unlockResult].some(t=>installedMessageIs(t,'The password is incorrect or this encrypted Wallet changed. It remains locked.')),'WRONG_PASSWORD_REJECTED');assert.equal(await digest(),before);
 await form(password);await until(s=>!s.locked&&s.account.account===account,'CORRECT_PASSWORD_SAME_ACCOUNT');assert.equal(await digest(),before);
}
async function create(){
 const initial=await snapshot();assert.equal(initial.locked,true);assert.equal(initial.account.initialized,false);assert.equal(initial.account.passwordConfigured,false);
 await form(password,password);await until(s=>s.account.passwordConfigured&&!s.account.initialized,'PASSWORD_PERSISTED');await form(password);await until(s=>!s.locked,'SETUP_UNLOCK');
 await click('nav [data-view="accounts"]');await click('#create-account');const created=await until(accountCreated,'NORMAL_CREATE_PERSISTED');
 await continuePersistedAccount(created,{unlock:()=>form(password),wait:until},'CREATED_ACCOUNT_NORMAL_UNLOCK');
 report.createReturnedLocked=created.locked;
 await click('#lock-wallet');await until(s=>s.locked,'EXPLICIT_LOCK');await unlockSame(created.account.account);return created.account;
}
async function restart(account){const before=await digest(),destination=activeProfile;await close();await launch(destination);const cold=await snapshot();assert.equal(cold.locked,true);assert.equal(cold.account.account,account);await unlockSame(account);assert.equal(await digest(),before)}
async function nativeSave(account){
 stage='NATIVE_SAVE_DIALOG';report.nativeSaveDiagnostics={explicitSaveActionSent:false};
 let window;for(let n=0;n<60;n++){try{window=execFileSync('xdotool',['search','--onlyvisible','--name','^Save encrypted Wallet backup$'],{encoding:'utf8'}).trim().split('\n')[0];if(window)break}catch{}await pauses(300)}
 if(!window)throw Error('NATIVE_SAVE_DIALOG_MISSING');
 // Linux GTK/KDE file chooser location control: type the dedicated destination,
 // then confirm the native Save action. Never replace the dialog IPC.
 const fileExists=async()=>{try{return(await fs.stat(backup)).isFile()}catch(error){if(error.code==='ENOENT')return false;throw error}};
 const dialogVisible=async()=>{try{return execFileSync('xdotool',['search','--onlyvisible','--name','^Save encrypted Wallet backup$'],{encoding:'utf8',timeout:3000}).trim().split('\n').includes(window)}catch{return false}};
 try{ await finishNativeSave({diagnostics:report.nativeSaveDiagnostics,sleep:pauses,fileExists,dialogVisible,
  enterDestination:async()=>{execFileSync('xdotool',['windowfocus','--sync',window]);execFileSync('xdotool',['key','--clearmodifiers','ctrl+l']);execFileSync('xdotool',['type','--clearmodifiers','--delay','2',backup]);execFileSync('xdotool',['key','--clearmodifiers','Return'])},
  saveAction:async()=>{execFileSync('xdotool',['windowfocus','--sync',window]);execFileSync('xdotool',['key','--clearmodifiers','alt+s'])},
 });
 }finally{
  stage='NATIVE_SAVE_POST_ATTEMPT';
  try{const observed=await observeNativeSave({snapshot,candidates:backupFileCandidates({account,backup,home:homedir(),workspace:process.cwd()})});lastSnapshot=observed.snapshot;report.nativeSaveDiagnostics.postAttempt=observed.diagnostic}
  catch{report.nativeSaveDiagnostics.postAttempt={sampledAt:new Date().toISOString(),observation:'POST_ATTEMPT_SNAPSHOT_FAILED'}}
 }
}
async function saveBackup(account){
 await click('nav [data-view="accounts"]');
 await click('#backup-section > summary');
 await fill('#backup-password',backupPassword);await fill('#backup-confirm',backupPassword);await click('#save-backup');await nativeSave(account);
 await until(s=>installedMessageIs(s.ui.backupResult,'Encrypted backup saved. Keep its password separately.'),'BACKUP_RESULT');
 assert.equal((await snapshot()).account.account,account);const bytes=await fs.readFile(backup);assert.ok(bytes.length>0);JSON.parse(bytes.toString());report.nativeSaveDialogUsed=true;report.backupFileSHA256=createHash('sha256').update(bytes).digest('hex');
}
async function recover(account){
 await close();await launch(recoveryProfile);await form(password,password);await until(s=>s.account.passwordConfigured&&!s.account.initialized,'RECOVERY_PASSWORD_SETUP');await form(password);await until(s=>!s.locked,'RECOVERY_UNLOCK');await click('nav [data-view="accounts"]');await click('#account-authority details:not(#backup-section) > summary');await fill('#import-kind','encrypted-json');
 const document=await protocol('DOM.getDocument',{depth:1}),input=await protocol('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#import-file'});assert.ok(input.nodeId);await protocol('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[backup]});
 const before=await digest(),priorImport=(await snapshot()).ui.importResult;await fill('#import-password','Incorrect dedicated backup password');await click('#import-form button');
 await until(s=>!s.account.initialized&&s.ui.importEnabled&&Boolean(s.ui.importResult)&&s.ui.importResult!==priorImport&&!installedMessageIs(s.ui.importResult,'Account imported. Save a backup and keep it safe.'),'WRONG_BACKUP_PASSWORD');assert.equal(await digest(),before);
 await fill('#import-password',backupPassword);await click('#import-form button');const recovered=await until(s=>accountCreated(s)&&s.account.account===account,'ORIGINAL_BACKUP_PERSISTED');
 await continuePersistedAccount(recovered,{unlock:()=>form(password),wait:until},'RECOVERED_ACCOUNT_NORMAL_UNLOCK');
 await restart(account);report.wrongBackupPasswordRejected=true;report.backupRestoredSameAddress=true;
}
try{
 await launch(profile);const account=await create();report.publicAccount=account.account;report.publicYNXAccount=account.ynxAccount;report.normalCreate=true;report.explicitLock=true;report.wrongPasswordRejected=true;
 await restart(account.account);report.sameAccountAfterAppRestart=true;report.vaultUnchangedByWrongPasswordAndUnlock=true;
 if(mode==='online'){await saveBackup(account.account);await recover(account.account)}else report.rpcUnavailableDuringCreateAndRestart=true;
 report.passed=true;
}catch(error){report.failureSnapshot=sanitizedFailureSnapshot(lastSnapshot,stage);report.failure=String(error.message).replace(/[^A-Za-z0-9_: .-]/g,'').slice(0,180);process.exitCode=1}
finally{try{await close()}catch{report.passed=false;report.failure='INSTALLED_APP_DID_NOT_CLOSE';process.exitCode=1}await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))}

}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runInstalledGate();

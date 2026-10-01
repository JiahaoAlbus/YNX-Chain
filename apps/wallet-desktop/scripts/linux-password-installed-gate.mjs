/** Real installed DEB UI custody gate. No account, provider or key is injected. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {installedMessageIs,passwordActionReady} from './windows-password-form-state.mjs';
const [mode]=process.argv.slice(2),password=process.env.YNX_WALLET_QA_PASSWORD,backupPassword=process.env.YNX_WALLET_QA_BACKUP_PASSWORD;
assert.equal(process.platform,'linux');assert.ok(['online','offline'].includes(mode));assert.ok(password?.length>=12);assert.ok(backupPassword?.length>=12);
const executable='/opt/YNX Wallet/ynx-wallet-desktop',temporary=await fs.realpath(process.env.RUNNER_TEMP),output=path.resolve('apps/wallet-desktop/dist/linux-'+mode+'-lifecycle.json');
const prefix=path.join(temporary,'ynx-linux-installed-'+mode),profile=prefix+'-profile',recoveryProfile=prefix+'-recovery-profile',backup=prefix+'-backup.json';
for(const destination of [profile,recoveryProfile,backup])await assert.rejects(fs.stat(destination),{code:'ENOENT'});
let child,socket,nextId=0,activeProfile;const pauses=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={sourceCommit:process.env.GITHUB_SHA,platform:'linux',architecture:process.arch,installedExecutable:executable,mode,userMachineVerified:false,osRebootVerified:false,appImageRuntimeVerified:false,passed:false};
async function close(){
 socket?.close();socket=null;if(!child)return;
 const process=child;child=undefined;process.kill('SIGTERM');
 for(let n=0;n<100&&process.exitCode===null&&process.signalCode===null;n++)await pauses(100);
 if(process.exitCode===null&&process.signalCode===null){process.kill('SIGKILL');throw Error('INSTALLED_APP_DID_NOT_CLOSE')}
}
async function launch(destination){
 assert.equal(child,undefined);activeProfile=destination;
 child=spawn(executable,['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9334'],{env:{...process.env,YNX_WALLET_PROFILE_PATH:destination,YNX_WALLET_EVIDENCE_PATH:prefix+'-launch.json'},stdio:['ignore','ignore','ignore']});
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
 return {account:account.ok?account.value:null,error:account.ok?null:account.error?.code,locked:security.locked,network:document.querySelector('#network')?.textContent,
 ui:{passwordResult:document.querySelector('#password-result')?.textContent,unlockResult:document.querySelector('#unlock-result')?.textContent,detail:document.querySelector('#account-detail')?.textContent,backupResult:document.querySelector('#backup-result')?.textContent,importResult:document.querySelector('#import-result')?.textContent,importEnabled:!document.querySelector('#import-form button')?.disabled,passwordSheetOpen:sheet?.open,passwordModeUnlock:sheet?.open?document.querySelector('#local-confirm-group')?.hidden:null,passwordSubmitEnabled:Boolean(sheet?.open&&submit&&!submit.disabled&&submit.getClientRects().length),unlockEnabled:Boolean(unlock&&!unlock.disabled&&unlock.getClientRects().length)}};
})()`)}
async function until(predicate,label){for(let n=0;n<100;n++){const s=await snapshot();if(s.error)throw Error(label+':'+s.error);if(predicate(s))return s;await pauses(300)}throw Error(label+':TIMEOUT')}
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
 await click('nav [data-view="accounts"]');await click('#create-account');const created=await until(s=>s.account.initialized&&!s.locked,'NORMAL_CREATE');assert.equal(created.account.custody,'password-encrypted-local');
 await click('#lock-wallet');await until(s=>s.locked,'EXPLICIT_LOCK');await unlockSame(created.account.account);return created.account;
}
async function restart(account){const before=await digest(),destination=activeProfile;await close();await launch(destination);const cold=await snapshot();assert.equal(cold.locked,true);assert.equal(cold.account.account,account);await unlockSame(account);assert.equal(await digest(),before)}
async function nativeSave(){
 let window;for(let n=0;n<60;n++){try{window=execFileSync('xdotool',['search','--onlyvisible','--name','^Save encrypted Wallet backup$'],{encoding:'utf8'}).trim().split('\n')[0];if(window)break}catch{}await pauses(300)}
 if(!window)throw Error('NATIVE_SAVE_DIALOG_MISSING');
 // Linux GTK/KDE file chooser location control: type the dedicated destination,
 // then confirm the native Save action. Never replace the dialog IPC.
 execFileSync('xdotool',['windowfocus','--sync',window]);execFileSync('xdotool',['key','--clearmodifiers','ctrl+l']);execFileSync('xdotool',['type','--clearmodifiers','--delay','2',backup]);execFileSync('xdotool',['key','--clearmodifiers','Return']);
 for(let n=0;n<100;n++){try{if((await fs.stat(backup)).isFile())return}catch{}await pauses(300)}throw Error('NATIVE_BACKUP_NOT_SAVED');
}
async function saveBackup(account){
 await click('nav [data-view="accounts"]');
 await click('#backup-section > summary');
 await fill('#backup-password',backupPassword);await fill('#backup-confirm',backupPassword);await click('#save-backup');await nativeSave();
 await until(s=>installedMessageIs(s.ui.backupResult,'Encrypted backup saved. Keep its password separately.'),'BACKUP_RESULT');
 assert.equal((await snapshot()).account.account,account);const bytes=await fs.readFile(backup);assert.ok(bytes.length>0);JSON.parse(bytes.toString());report.nativeSaveDialogUsed=true;report.backupFileSHA256=createHash('sha256').update(bytes).digest('hex');
}
async function recover(account){
 await close();await launch(recoveryProfile);await form(password,password);await until(s=>s.account.passwordConfigured&&!s.account.initialized,'RECOVERY_PASSWORD_SETUP');await form(password);await until(s=>!s.locked,'RECOVERY_UNLOCK');await click('nav [data-view="accounts"]');await click('#account-authority details:not(#backup-section) > summary');await fill('#import-kind','encrypted-json');
 const document=await protocol('DOM.getDocument',{depth:1}),input=await protocol('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#import-file'});assert.ok(input.nodeId);await protocol('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[backup]});
 const before=await digest(),priorImport=(await snapshot()).ui.importResult;await fill('#import-password','Incorrect dedicated backup password');await click('#import-form button');
 await until(s=>!s.account.initialized&&s.ui.importEnabled&&Boolean(s.ui.importResult)&&s.ui.importResult!==priorImport&&!installedMessageIs(s.ui.importResult,'Account imported. Save a backup and keep it safe.'),'WRONG_BACKUP_PASSWORD');assert.equal(await digest(),before);
 await fill('#import-password',backupPassword);await click('#import-form button');await until(s=>!s.locked&&s.account.account===account&&s.account.custody==='password-encrypted-local','ORIGINAL_BACKUP_RECOVERED');await restart(account);report.wrongBackupPasswordRejected=true;report.backupRestoredSameAddress=true;
}
try{
 await launch(profile);const account=await create();report.publicAccount=account.account;report.publicYNXAccount=account.ynxAccount;report.normalCreate=true;report.explicitLock=true;report.wrongPasswordRejected=true;
 await restart(account.account);report.sameAccountAfterAppRestart=true;report.vaultUnchangedByWrongPasswordAndUnlock=true;
 if(mode==='online'){await saveBackup(account.account);await recover(account.account)}else report.rpcUnavailableDuringCreateAndRestart=true;
 report.passed=true;
}catch(error){report.failure=String(error.message).replace(/[^A-Za-z0-9_: .-]/g,'').slice(0,180);process.exitCode=1}
finally{try{await close()}catch{report.passed=false;report.failure='INSTALLED_APP_DID_NOT_CLOSE';process.exitCode=1}await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))}

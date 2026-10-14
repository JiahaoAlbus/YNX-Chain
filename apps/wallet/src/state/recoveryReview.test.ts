import assert from "node:assert/strict";
import test from "node:test";
import {walletIdentity} from "@ynx-chain/wallet-auth";
import {needsOfflineKeyRecovery,reviewRecoveryKey} from "./recoveryReview";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {WalletOperationLifecycle} from "../security/operationLifecycle";
import {ModalActionGate} from "./modalActionGate";
const secret="1".padStart(64,"0"),other="2".padStart(64,"0");
const account={...walletIdentity(secret),label:"Existing fixture",createdAt:"2026-09-06T00:00:00.000Z",backupConfirmed:true};
test("recovery review matches exact public identity without exposing the entered offline key",()=>{
  const review=reviewRecoveryKey(secret,[account]);
  assert.deepEqual(review,{kind:"existing",account});
  assert.equal(JSON.stringify(review).includes(secret),false);
  assert.deepEqual(reviewRecoveryKey(other,[account]),{kind:"new",account:walletIdentity(other).account});
  assert.deepEqual(reviewRecoveryKey("not-a-key",[account]),{kind:"invalid"});
  assert.deepEqual(reviewRecoveryKey("0".repeat(64),[account]),{kind:"invalid"});
});
test("lost protection recovery guidance is distinct from user cancellation and network failure",()=>{
  assert.equal(needsOfflineKeyRecovery("This account's protected key is unavailable or biometric enrollment changed. Restore it with its offline recovery key; the public account has been retained."),true);
  assert.equal(needsOfflineKeyRecovery("Biometric authorization was cancelled"),false);
  assert.equal(needsOfflineKeyRecovery("Auth is unavailable. Check your connection and retry."),false);
});

// Execute the real App caller body with PUBLIC hooks/auth/storage stand-ins.
// This does not mount React Native or authenticate an OS/account.
const appSource=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8');
const setupStart=appSource.indexOf('function SetupModal('),setupEnd=appSource.indexOf('  if(mode==="create"&&pending?.kind==="mnemonic")return <',setupStart);
assert.ok(setupStart>=0&&setupEnd>setupStart);
const setupCode=ts.transpileModule(appSource.slice(setupStart,setupEnd)+'return {dismiss,persistImport,persistRestore,persistMnemonic};}\nreturn SetupModal(props);',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const deferred=()=>{let resolve!:()=>void,reject!:(reason:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function setupCaller(){
  const operations=new WalletOperationLifecycle(()=>0),scope=operations.scope();
  const slots:any[]=[],effects:Array<()=>void>=[],accounts:Array<typeof account>=[],auths:Array<ReturnType<typeof deferred>>=[],stores:Array<ReturnType<typeof deferred>>=[];let cursor=0,revision=1,pauseWrites=false;
  const events:string[]=[],parent={busy:false,closed:0,errors:0,saved:0};
  operations.subscribe(()=>{revision++;scope.cancel();parent.busy=false});
  const changes=(a:any[],b:any[])=>!a||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const memo=(make:()=>any,deps:any[])=>{const i=cursor++,old=slots[i];if(!old||changes(old.deps,deps))slots[i]={value:make(),deps};return slots[i].value};
  const write=async(guard:()=>void)=>{guard();events.push('write');if(pauseWrites){const wait=deferred();stores.push(wait);await wait.promise;}guard();return {accounts:[]}};
  const context:any={useContext:()=> 'en',WalletLocaleContext:{},WalletRecoveryContext:{},useWalletOperations:()=>operations,useOperationScope:()=>scope,ModalActionGate,reviewRecoveryKey,walletCopy:(_locale:string,text:string)=>text,setupCopy:()=> 'changed',message:(error:Error)=>error.message,BiometricProtectionRequired:class extends Error{},
    useMemo:memo,useRef:(value:any)=>memo(()=>({current:value}),[]),useState:(value:any)=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next}];},
    useEffect:(effect:()=>void|(()=>void),deps:any[])=>{const i=cursor++,old=slots[i];if(!old||changes(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()};});},
    assertSetupBinding:(ops:WalletOperationLifecycle,binding:any)=>{if(!binding)throw Error('PUBLIC closed');ops.assert(binding.generation,binding.account,false,binding.deadline);},
    setTimeout:()=>0,clearTimeout:()=>{},RECOVERY_DISPLAY_MS:60000,
    authorizeLocalKeyUse:async()=>{events.push('auth');const auth=deferred();auths.push(auth);await auth.promise},assertStrongBiometrics:async()=>{events.push('auth');const auth=deferred();auths.push(auth);await auth.promise},
    repository:{addAccount:async(_input:any,guard:()=>void)=>write(guard),restoreAccountSecret:async(_owner:any,_secret:any,guard:()=>void)=>write(guard),addMnemonicAccount:async(_input:any,guard:()=>void)=>write(guard)}};
  const invoke=new Function(...Object.keys(context),'props',setupCode);
  const props=()=>({mode:'import',setupRevision:revision,isSetupCurrent:(value:number)=>value===revision,binding:{generation:operations.capture(),account:operations.selectedAccount(),deadline:60000},accounts,pending:null,busy:false,createMnemonic(){},close(){parent.closed++;revision++;},saved(){parent.saved++;},setBusy(value:boolean){parent.busy=value},setError(){parent.errors++;operations.lock()}});
  let currentProps:any;
  const render=(overrides:any={})=>{currentProps={...props(),...overrides};cursor=0;let result=invoke(...Object.values(context),currentProps);while(effects.length)effects.shift()!();cursor=0;return invoke(...Object.values(context),currentProps);};
  const setSecret=()=>{ // Locate the actual string input state, not a replacement handler.
    const secretSlot=slots.filter(slot=>slot&&typeof slot.value==='string'&&slot.value==='')[1];assert.ok(secretSlot);secretSlot.value=secret;
  };
  return {operations,scope,parent,events,auths,stores,accounts,render,setSecret,pauseWrites(value:boolean){pauseWrites=value},protectionFailure:()=>new context.BiometricProtectionRequired('PUBLIC protection changed'),reopen(){revision++;return render();},retireBeforeRender(){revision++;},unmount(){for(const slot of slots)slot?.cleanup?.();},revision:()=>revision};
}
test('Setup caller: old dismiss cannot cancel or clear reopened B',()=>{
  const h=setupCaller(),old=h.render();old.dismiss();const fresh=h.reopen(),lease=h.scope.begin({requireUnlocked:false});h.parent.busy=true;
  old.dismiss();assert.equal(lease.ownsScope(),true);assert.equal(h.parent.busy,true);assert.equal(h.parent.closed,1);fresh.dismiss();assert.equal(lease.ownsScope(),false);
});
test('Setup caller: duplicate legacy import cannot globally lock the first admitted action',async()=>{
  const h=setupCaller();h.render();h.setSecret();const ui=h.render(),first=ui.persistImport();await ui.persistImport();
  assert.deepEqual(h.events,['auth']);assert.equal(h.parent.errors,0);assert.equal(h.parent.busy,true);h.auths[0]!.resolve();await first;assert.deepEqual(h.events,['auth','write']);assert.equal(h.parent.saved,1);
});
for(const result of ['success','failure'] as const)test(`Setup caller: old ${result} completion cannot clear new B action`,async()=>{
  const h=setupCaller();h.render();h.setSecret();const old=h.render(),pending=old.persistImport();old.dismiss();h.reopen();h.setSecret();const fresh=h.render(),next=fresh.persistImport();
  assert.equal(h.auths.length,2);if(result==='success')h.auths[0]!.resolve();else h.auths[0]!.reject(Error('PUBLIC old auth refused'));await pending;
  assert.equal(h.parent.busy,true);assert.equal(h.parent.errors,0);assert.equal(h.parent.saved,0);h.auths[1]!.resolve();await next;
  assert.equal(h.parent.closed,1);assert.equal(h.parent.saved,1);assert.equal(h.parent.errors,0);
});
test('Setup caller: synchronous root retirement fences old close before rerender',()=>{
  const h=setupCaller(),old=h.render(),lease=h.scope.begin({requireUnlocked:false});h.retireBeforeRender();h.parent.busy=true;old.dismiss();assert.equal(lease.ownsScope(),true);assert.equal(h.parent.busy,true);assert.equal(h.parent.closed,0);lease.finish();
});
test('Setup caller: stale private-key save cannot enter or report error against B',async()=>{
  const h=setupCaller();h.render();h.setSecret();const old=h.render();old.dismiss();h.reopen();h.setSecret();const fresh=h.render(),next=fresh.persistImport();await old.persistImport();
  assert.equal(h.auths.length,1);assert.equal(h.parent.errors,0);assert.equal(h.parent.busy,true);h.auths[0]!.resolve();await next;assert.equal(h.parent.saved,1);
});
test('Setup caller: duplicate existing-account restore is ignored before scope admission',async()=>{
  const h=setupCaller();h.accounts.push(account);h.render({mode:'recover'});h.setSecret();const ui=h.render({mode:'recover'}),first=ui.persistRestore();await ui.persistRestore();assert.equal(h.parent.errors,0);assert.deepEqual(h.events,['auth']);assert.equal(h.parent.busy,true);h.auths[0]!.resolve();await first;assert.equal(h.parent.saved,1);
});
for(const boundary of ['account','background','lock'] as const)test(`Setup caller: ${boundary} retires original auth and late success`,async()=>{
  const h=setupCaller();h.render();h.setSecret();const ui=h.render(),pending=ui.persistImport();assert.equal(h.auths.length,1);
  if(boundary==='account')h.operations.setAccount('PUBLIC B');else if(boundary==='background')h.operations.setAppState('background');else h.operations.lock();
  h.auths[0]!.resolve();await pending;assert.deepEqual(h.events,['auth']);assert.equal(h.parent.saved,0);assert.equal(h.parent.errors,0);assert.equal(h.parent.busy,false);
});
test('Setup caller: current authentication failure is not swallowed as success',async()=>{
  const h=setupCaller();h.render();h.setSecret();const pending=h.render().persistImport();h.auths[0]!.reject(Error('PUBLIC biometric refused'));await pending;assert.equal(h.parent.errors,1);assert.equal(h.parent.saved,0);assert.equal(h.parent.busy,false);assert.deepEqual(h.events,['auth']);
});
test('Setup caller: unmount fences callbacks and late authorization',async()=>{
  const h=setupCaller();h.render();h.setSecret();const old=h.render(),pending=old.persistImport();h.unmount();const errors=h.parent.errors;await old.persistImport();old.dismiss();h.auths[0]!.resolve();await pending;assert.equal(h.parent.saved,0);assert.equal(h.parent.errors,errors);assert.equal(h.parent.closed,0);assert.deepEqual(h.events,['auth']);
});
test('Setup caller: new session field reset cannot release parent preflight busy',()=>{
  const h=setupCaller();h.render();h.retireBeforeRender();h.parent.busy=true;h.render({mode:'create',busy:true});assert.equal(h.parent.busy,true);
});
test('Setup caller: actual parent retires create chooser and queued expiry by setup revision',()=>{
  assert.match(appSource,/if\(mode==="create"&&!wordCount\)\{setupAttempt\.current\+\+/);
  assert.match(appSource,/setupRevision=\{setupAttempt\.current\} isSetupCurrent=\{revision=>revision===setupAttempt\.current\}/);
  const start=appSource.indexOf('  useEffect(()=>{if(!pendingRecovery)return;'),end=appSource.indexOf('\n',start),source=appSource.slice(start,end);
  let expire!:()=>void,mutations=0;
  const context={pendingRecovery:{},setupAttempt:{current:1},useEffect:(effect:()=>void)=>effect(),setTimeout:(callback:()=>void)=>{expire=callback;return 0},clearTimeout(){},RECOVERY_DISPLAY_MS:60000,rootScope:{cancel(){mutations++}},operations:{invalidate(){mutations++}},setupStarting:{current:true},setPendingRecovery(){mutations++},setSetupBinding(){mutations++},setSetup(){mutations++},setBusy(){mutations++},setNotice(){mutations++}};
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;new Function(...Object.keys(context),code)(...Object.values(context));context.setupAttempt.current=2;expire();assert.equal(mutations,0);
});
for(const result of ['success','failure'] as const)test(`Setup caller: late repository ${result} cannot publish or release B`,async()=>{
  const h=setupCaller();h.pauseWrites(true);h.render();h.setSecret();const old=h.render(),pending=old.persistImport();h.auths[0]!.resolve();for(let i=0;i<8;i++)await Promise.resolve();assert.equal(h.stores.length,1);
  old.dismiss();h.reopen();h.setSecret();h.pauseWrites(false);const next=h.render().persistImport();assert.equal(h.auths.length,2);
  if(result==='success')h.stores[0]!.resolve();else h.stores[0]!.reject(Error('PUBLIC old readback failed'));await pending;
  assert.equal(h.parent.busy,true);assert.equal(h.parent.saved,0);assert.equal(h.parent.errors,0);h.auths[1]!.resolve();await next;assert.equal(h.parent.saved,1);
});
test('Setup caller: current mnemonic protection change triggers failure cleanup, never success',async()=>{
  const h=setupCaller(),pending=h.render().persistMnemonic({secretHex:secret});h.auths[0]!.reject(h.protectionFailure());await pending;assert.equal(h.parent.errors,1);assert.equal(h.parent.busy,false);assert.equal(h.parent.saved,0);assert.deepEqual(h.events,['auth']);
});
test('Setup caller: current repository error retains failure and does not retry',async()=>{
  const h=setupCaller();h.pauseWrites(true);h.render();h.setSecret();const pending=h.render().persistImport();h.auths[0]!.resolve();for(let i=0;i<8;i++)await Promise.resolve();assert.equal(h.stores.length,1);h.stores[0]!.reject(Error('PUBLIC current readback uncertain'));await pending;assert.equal(h.parent.errors,1);assert.equal(h.parent.saved,0);assert.equal(h.parent.busy,false);assert.deepEqual(h.events,['auth','write']);
});

import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// PUBLIC lexical controls, exact production source bodies. All hooks/codec/
// crypto/store dependencies below are PUBLIC stand-ins. No product import,
// key, protected file, signing, service or actual owner resource is executed.
const root=process.env.PUBLIC_F1F2_PARENT_RED==='1'?new URL('file:///Users/huangjiahao/ynx-social-qa-authority/wallet-r9-same-vault-durable-admission-r1-20261012/source/apps/wallet-desktop/src/'):new URL('../src/',import.meta.url);
const custodianSource=readFileSync(new URL('original-admission-custodian.mjs',root),'utf8');
function custodian(){const ctx=vm.createContext({captureOriginalAdmissionProductionContext:value=>value});vm.runInContext(custodianSource.replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.api={retainOriginalAdmissionCustodian,assertOriginalServiceAdmissionProductionOwner,publishOriginalServiceAdmissionProduction,closeOriginalServiceAdmissionProductionOwner,completeOriginalServiceAdmissionProductionClose,selectOriginalServiceAdmissionProductionOutcome:typeof selectOriginalServiceAdmissionProductionOutcome==="function"?selectOriginalServiceAdmissionProductionOutcome:undefined,enterOriginalServiceAdmissionDelivery,acknowledgeOriginalServiceAdmissionDelivery}',ctx);return ctx.api;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
// New R3 only: exact summary body with PUBLIC read/decrypt/current substitutes.
function r3SummaryFixture({records=[],runtimeRecords=[],onDecrypt=()=>{},onCurrent=()=>{}}={}){
  const source=readFileSync(new URL('password-wallet-vault.mjs',root),'utf8');
  const start=source.indexOf('  async readOriginalServiceAdmissionSummary('),end=source.indexOf('\n  }',start)+4;
  const context=vm.createContext({fail:code=>{throw Error(code);},cancelled:()=>Error('PUBLIC_CANCELLED'),options:guard=>({guard:()=>guard.assert()}),decryptPasswordVaultOriginalAdmissionCatalog:async()=>{await onDecrypt();return {admissionPublicationState:{records},runtimePublicationState:{records:runtimeRecords}};}});
  const serialize=source.match(/  #serialize\(action\) \{[^\n]+/)[0];
  vm.runInContext('this.Subject=class {#mutations=Promise.resolve();'+serialize+'async #readUnlocked(guard){guard.assert();return {vault:{activeAccount:"PUBLIC_ACCOUNT"},snapshot:{digest:"PUBLIC_DIGEST"},session:{PUBLIC:true}};}'+source.slice(start,end)+'}',context);
  const vault=new context.Subject();vault.files={assertCurrent:async digest=>{assert.equal(digest,'PUBLIC_DIGEST');onCurrent();}};
  return vault;
}
test('R3 PUBLIC summary projects ALL 32 admission and 64 runtime originals without raw',async()=>{
  const records=Array.from({length:32},(_,i)=>({requestNonce:String(i),state:i===31?'UNKNOWN':'signed',delivery:i===31?undefined:{state:'acknowledged'},signedRaw:'PUBLIC_RAW_MUST_NOT_ESCAPE'}));
  const runtimeRecords=Array.from({length:64},(_,i)=>({nonce:String(i),state:i===63?'pending':'signed',runtimeRaw:'PUBLIC_RUNTIME_MUST_NOT_ESCAPE'}));
  const guard={account:'PUBLIC_ACCOUNT',assert(){}};assert.equal(Object.hasOwn(guard,'revision'),false);
  const value=await r3SummaryFixture({records,runtimeRecords}).readOriginalServiceAdmissionSummary(guard);
  assert.equal(value.records.length,32);assert.equal(value.runtimeRecords.length,64);assert.equal(value.records[31].state,'UNKNOWN');assert.equal(value.runtimeRecords[63].nonce,'63');assert.equal(value.runtimeRecords[63].state,'pending');
  assert.equal(JSON.stringify(value).includes('MUST_NOT_ESCAPE'),false);assert.equal(Object.isFrozen(value.records[0]),true);
});
test('R3 PUBLIC summary rejects late guard/account/file changes and never invents missing catalog',async()=>{
  for(const phase of ['decrypt','current','account']){
    let alive=true;const guard={account:'PUBLIC_ACCOUNT',assert(){if(!alive)throw Error('PUBLIC_LATE');}};
    const vault=r3SummaryFixture({onDecrypt:()=>{if(phase==='decrypt')alive=false;if(phase==='account')guard.account='OTHER';},onCurrent:()=>{if(phase==='current')alive=false;}});
    await assert.rejects(vault.readOriginalServiceAdmissionSummary(guard),/PUBLIC_LATE|PUBLIC_CANCELLED/);
  }
  await assert.rejects(r3SummaryFixture({records:Array(33).fill({})}).readOriginalServiceAdmissionSummary({account:'PUBLIC_ACCOUNT',assert(){}}),/SUMMARY_INVALID/);
  await assert.rejects(r3SummaryFixture({runtimeRecords:Array(65).fill({})}).readOriginalServiceAdmissionSummary({account:'PUBLIC_ACCOUNT',assert(){}}),/SUMMARY_INVALID/);
  await assert.rejects(r3SummaryFixture({onDecrypt:()=>{throw Error('PUBLIC_CATALOG_ABSENT');}}).readOriginalServiceAdmissionSummary({account:'PUBLIC_ACCOUNT',assert(){}}),/CATALOG_ABSENT/);
});
test('R3 PUBLIC real serialization holds second summary until first read fence settles',async()=>{
 const entered=deferred(),finish=deferred();let reads=0;
 const vault=r3SummaryFixture({onDecrypt:async()=>{reads++;if(reads===1){entered.resolve();await finish.promise;}}}),guard={account:'PUBLIC_ACCOUNT',assert(){}};
 const first=vault.readOriginalServiceAdmissionSummary(guard);await entered.promise;
 const second=vault.readOriginalServiceAdmissionSummary(guard);await Promise.resolve();assert.equal(reads,1);
 finish.resolve();await first;await second;assert.equal(reads,2);
});
test('PUBLIC custodian retains exact falsy first rejection through retirement and close',async()=>{
  for(const cause of [false,null,undefined,0,'']){
    const api=custodian();let calls=0,disposed=0;
    const ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>{calls++;throw cause;},publish:()=>undefined,dispose:()=>{disposed++;}});
    async function exactRejection(operation){let rejected=false;try{await operation();}catch(error){rejected=true;assert.equal(error,cause);}assert.equal(rejected,true);}
    await exactRejection(()=>api.assertOriginalServiceAdmissionProductionOwner(ref));
    await exactRejection(()=>api.assertOriginalServiceAdmissionProductionOwner(ref));
    const close=api.closeOriginalServiceAdmissionProductionOwner(ref);await close;
    await exactRejection(()=>api.publishOriginalServiceAdmissionProduction(ref));
    assert.equal(api.closeOriginalServiceAdmissionProductionOwner(ref),close);
    assert.equal(calls,1);assert.equal(disposed,1);
  }
});
test('PUBLIC actual Vault private inventory refuses callback/DTO custody registration',()=>{
  const source=readFileSync(new URL('password-wallet-vault.mjs',root),'utf8');
  const start=source.indexOf('export function captureOriginalAdmissionProductionContext('),end=source.indexOf('\n}',start)+2;
  const ctx=vm.createContext({fail:code=>{throw Error(code);}});
  vm.runInContext('const originalProductionContexts=new WeakMap();\n'+source.slice(start,end).replace('export ','')+'\nthis.capture=captureOriginalAdmissionProductionContext',ctx);
  for(const value of [{},{assertCurrent:()=>undefined,publish:()=>undefined,dispose:()=>undefined},null])assert.throws(()=>ctx.capture(value),/OWNER_REQUIRED/);
});
test('PUBLIC same owner cannot be forged or serialized; publication is single entered',async()=>{
  const api=custodian();let publishes=0;
  const ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>undefined,publish:()=>{publishes++;return 'PUBLIC_RESULT';},dispose:()=>undefined});
  await assert.rejects(api.assertOriginalServiceAdmissionProductionOwner({}),/OWNER_REQUIRED/);
  await assert.rejects(api.assertOriginalServiceAdmissionProductionOwner(JSON.parse(JSON.stringify(ref))),/OWNER_REQUIRED/);
  assert.equal(await api.publishOriginalServiceAdmissionProduction(ref),'PUBLIC_RESULT');
  await assert.rejects(api.publishOriginalServiceAdmissionProduction(ref),/ALREADY_ENTERED/);assert.equal(publishes,1);
});
test('PUBLIC close retires immediately, joins original entered publish and disposes without dead guard',async()=>{
  const api=custodian(),entered=deferred(),finish=deferred();let disposed=0,guardAlive=true;
  const ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>{if(!guardAlive)throw Error('PUBLIC_GUARD_RETIRED');},publish:async()=>{entered.resolve();await finish.promise;return 'PUBLIC_LATE';},dispose:()=>{disposed++;return undefined;}});
  const publish=api.publishOriginalServiceAdmissionProduction(ref);await entered.promise;
  guardAlive=false;const close=api.closeOriginalServiceAdmissionProductionOwner(ref);
  assert.equal(disposed,0);await assert.rejects(api.assertOriginalServiceAdmissionProductionOwner(ref),/RETIRED/);
  finish.resolve();await assert.rejects(publish,/RETIRED/);assert.equal(await close,undefined);assert.equal(disposed,1);
  assert.equal(api.closeOriginalServiceAdmissionProductionOwner(ref),close);
});
test('PUBLIC cleanup rejection/nonvoid retain one original Promise; no automatic retry',async()=>{
  for(const result of ['PUBLIC_NOT_COMPLETED',Promise.reject(Error('PUBLIC_CLEANUP_FAILURE'))]){
    const api=custodian();let count=0;
    const ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>undefined,publish:()=>undefined,dispose:()=>{count++;return result;}});
    const close=api.closeOriginalServiceAdmissionProductionOwner(ref);await assert.rejects(close);
    assert.equal(api.closeOriginalServiceAdmissionProductionOwner(ref),close);assert.equal(count,1);
    await assert.rejects(api.publishOriginalServiceAdmissionProduction(ref),/RETIRED/);
  }
});
test('PUBLIC reentry poisons business and retains first failure; unique cleanup still joins',async()=>{
  const api=custodian(),entered=deferred(),finish=deferred();let disposed=0;
  const ref=api.retainOriginalAdmissionCustodian({assertCurrent:async()=>{entered.resolve();await finish.promise;},publish:()=>undefined,dispose:()=>{disposed++;}});
  const original=api.assertOriginalServiceAdmissionProductionOwner(ref);await entered.promise;
  await assert.rejects(api.assertOriginalServiceAdmissionProductionOwner(ref),/REENTRY/);
  const close=api.closeOriginalServiceAdmissionProductionOwner(ref);finish.resolve();
  await assert.rejects(original,/REENTRY/);await close;assert.equal(disposed,1);
});

const cryptoSource=readFileSync(new URL('password-vault-crypto.mjs',root),'utf8');
function body(name){const marker=`function ${name}(`,start=cryptoSource.indexOf(marker);assert(start>=0);const next=cryptoSource.indexOf('\n}',start);assert(next>=0);return cryptoSource.slice(start,next+2);}
function catalogFixture(){
  const clone=v=>JSON.parse(JSON.stringify(v)),ctx=vm.createContext({
    exact:(v,keys)=>assert.deepEqual(Object.keys(v).sort(),[...keys].sort()),
    fail:code=>{throw Error(code);},canonical:JSON.stringify,
    parseOriginalWalletServiceRoleEnrollmentState:clone,
    parseOriginalWalletServiceAdmissionPublicationState:clone,
    parseOriginalWalletServiceRuntimePublicationState:clone,
    assertOriginalWalletServiceAdmissionPublicationRetention:(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('PUBLIC_ADMISSION_RETENTION_STANDIN');},
    assertOriginalWalletServiceRuntimePublicationRetention:(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('PUBLIC_RUNTIME_RETENTION_STANDIN');},
  });
  vm.runInContext(body('parseOriginalCatalog')+'\n'+body('retainOriginalCatalog')+'\nthis.retain=retainOriginalCatalog',ctx);
  const state={version:1,serviceRoleState:{holder:{publicKey:'PUBLIC',privateKeyPKCS8:'PUBLIC_NOT_A_KEY'},rootAnchor:{publicKey:'PUBLIC_ANCHOR'},operations:[{review:{operationId:'PUBLIC_OP'},state:'UNKNOWN'}],history:[]},admissionPublicationState:{records:[]},runtimePublicationState:{records:[]}};
  return {retain:ctx.retain,state,clone};
}
test('PUBLIC exact catalog retention keeps holder/root/old records across account rewrites',()=>{
  const {retain,state,clone}=catalogFixture();retain(state,clone(state));
  for(const key of ['holder','rootAnchor']){const next=clone(state);next.serviceRoleState[key]=null;assert.throws(()=>retain(state,next),/RETENTION/);}
  const erased=clone(state);erased.serviceRoleState.operations=[];assert.throws(()=>retain(state,erased),/RETENTION/);
  const rebound=clone(state);rebound.serviceRoleState.operations[0].review.operationId='OTHER';assert.throws(()=>retain(state,rebound),/RETENTION/);
});
test('PUBLIC exact catalog transition keeps UNKNOWN sticky except original settlement',()=>{
  const {retain,state,clone}=catalogFixture(),pending=clone(state);pending.serviceRoleState.operations[0].state='pending';
  assert.throws(()=>retain(state,pending),/RETENTION/);
  const settled=clone(state);settled.serviceRoleState.operations[0].state='approved';retain(state,settled);
  const revoked=clone(settled);revoked.serviceRoleState.operations[0].state='revoked';assert.throws(()=>retain(settled,revoked),/RETENTION/);
});

function rewriteFixture({namespace=false}={}){
  const {state:catalog,clone}=catalogFixture();
  const meta={account:'PUBLIC_ACCOUNT',state:'protected'},mnemonic={version:1,path:'PUBLIC_PATH',cipher:{iv:'PUBLIC_MNEMONIC_IV',ciphertext:'PUBLIC_ENCRYPTED_MNEMONIC'}};
  const old={schemaVersion:3,revision:1,activeAccount:meta.account,accounts:[meta],passwordWrap:{cipher:'PUBLIC_WRAP'},records:[{account:meta.account,cipher:{iv:'PUBLIC_RECORD_IV',ciphertext:'PUBLIC_ENCRYPTED_RECORD'},mnemonic}],catalogCipher:{iv:'PUBLIC_CATALOG_IV'},...(namespace?{originalAdmissionCatalogBytes:2}:{})};
  const context=vm.createContext({
    Object,Buffer,Uint8Array,encoder:new TextEncoder(),MAX_BYTES:65536,
    inputObject:(input,keys)=>{if(Object.keys(input).some(k=>!keys.includes(k)))throw Error('PUBLIC_INVALID_INPUT');},
    checkpoint:()=>undefined,requiredVault:value=>value,sessionKey:()=>({PUBLIC:'KEY_STANDIN'}),guardedSession:()=>({}),revision:value=>value,
    accountInputs:(accounts,vault)=>accounts.map(meta=>({meta})),validCatalog:()=>undefined,
    verifyCatalog:async()=>clone(catalog),retainOriginalCatalog:(a,b)=>{assert.deepEqual(a,b);return clone(b);},
    parseOriginalCatalog:clone,canonical:JSON.stringify,
    catalogAAD:vault=>({PUBLIC_AAD:'CATALOG',revision:vault.revision}),
    encrypt:async(key,bytes,aad)=>({iv:'PUBLIC_NEXT_CATALOG_IV',ciphertext:'PUBLIC_CATALOG_CIPHER_STANDIN'}),
    secretForRecord:async()=>undefined,mnemonicForRecord:async()=>undefined,handle:()=>Object.freeze({PUBLIC:'SESSION_STANDIN'}),
    fail:code=>{throw Error(code);},
  });
  const start=cryptoSource.indexOf('export async function rewritePasswordVault('),end=cryptoSource.indexOf('\n}',start)+2;
  vm.runInContext('async '+body('assemble')+'\n'+cryptoSource.slice(start,end).replace('export ','')+'\nthis.rewrite=rewritePasswordVault',context);
  return {rewrite:context.rewrite,old,catalog,clone};
}
test('PUBLIC actual rewrite/assemble bodies preserve old account/wrap/mnemonic without automatic namespace',async()=>{
  const {rewrite,old}=rewriteFixture();const next=await rewrite(old,{},{});
  assert.equal(Object.hasOwn(next.vault,'originalAdmissionCatalogBytes'),false);
  assert.equal(next.vault.schemaVersion,3);assert.equal(next.vault.passwordWrap,old.passwordWrap);
  assert.equal(next.vault.records[0],old.records[0]);assert.equal(next.vault.records[0].mnemonic,old.records[0].mnemonic);
  assert.equal(old.revision,1);assert.equal(next.vault.revision,2);
});
test('PUBLIC actual rewrite requires explicit catalog opt-in; accepted opt-in keeps mnemonic ciphertext',async()=>{
  const {rewrite,old,catalog}=rewriteFixture();
  await assert.rejects(rewrite(old,{originalAdmissionCatalog:catalog},{}),/UPGRADE_REQUIRED/);
  const next=await rewrite(old,{originalAdmissionCatalog:catalog,approveOriginalAdmissionCatalogUpgrade:true},{});
  assert(next.vault.originalAdmissionCatalogBytes>2);assert.equal(next.vault.records[0].mnemonic,old.records[0].mnemonic);
  assert.equal(next.vault.passwordWrap,old.passwordWrap);
});
test('PUBLIC actual rewrite retains catalog on unrelated account changes and refuses dangling opt-in',async()=>{
  const {rewrite,old}=rewriteFixture({namespace:true});
  const next=await rewrite(old,{},{});assert(next.vault.originalAdmissionCatalogBytes>2);
  await assert.rejects(rewrite(old,{approveOriginalAdmissionCatalogUpgrade:true},{}),/INVALID/);
});
test('PUBLIC normal missing supply returns null before product import; same main caller composition is present',async()=>{
  const source=readFileSync(new URL('original-admission-supply.mjs',root),'utf8'),ctx=vm.createContext({});
  vm.runInContext(source.replace('export ','')+'\nthis.open=openOriginalAdmissionSupply',ctx);
  assert.equal(await ctx.open({PUBLIC:'VAULT_STANDIN'}),null);
  const main=readFileSync(new URL('main.mjs',root),'utf8');assert(main.includes('originalAdmissionSupply=await openOriginalAdmissionSupply(passwordVault);'));
});
test('PUBLIC actual delivery parser forbids records following unresolved entered/UNKNOWN',()=>{
  const source=readFileSync(new URL('../../../packages/wallet-auth/src/original-wallet-service-admission-publication-state.js',import.meta.url),'utf8');
  const marker='export function parseOriginalWalletServiceAdmissionPublicationState(',start=source.indexOf(marker),end=source.indexOf('\n',start);
  const ctx=vm.createContext({capture:v=>JSON.parse(JSON.stringify(v)),exact:()=>undefined,parseRecord:()=>undefined,ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_NAMESPACE:'PUBLIC_NAMESPACE',fail:()=>{throw Error('PUBLIC_INVALID');}});
  vm.runInContext(source.slice(start,end).replace('export ','')+'\nthis.parse=parseOriginalWalletServiceAdmissionPublicationState',ctx);
  for(const state of ['entered','UNKNOWN'])assert.throws(()=>ctx.parse({version:1,purpose:'PUBLIC_NAMESPACE',records:[{requestNonce:'A',state:'signed',delivery:{state}},{requestNonce:'B',state:'signed'}]}),/INVALID/);
  ctx.parse({version:1,purpose:'PUBLIC_NAMESPACE',records:[{requestNonce:'A',state:'signed',delivery:{state:'acknowledged'}},{requestNonce:'B',state:'signed'}]});
});
test('PUBLIC actual delivery enter cannot reactivate a historical signed record',()=>{
  const source=readFileSync(new URL('../../../packages/wallet-auth/src/original-wallet-service-admission-publication-state.js',import.meta.url),'utf8');
  const start=source.indexOf('export function enterOriginalWalletServiceAdmissionDelivery('),end=source.indexOf('\n}',start)+2;
  const ctx=vm.createContext({parseOriginalWalletServiceAdmissionPublicationState:v=>JSON.parse(JSON.stringify(v)),bytes:()=>undefined,fail:code=>{throw Error(code);}});
  vm.runInContext(source.slice(start,end).replace('export ','')+'\nthis.enter=enterOriginalWalletServiceAdmissionDelivery',ctx);
  assert.throws(()=>ctx.enter({records:[{requestNonce:'A',state:'signed'},{requestNonce:'B',state:'signed'}]},'A'),/NOT_INSTALLED/);
});

const selectedControllerSource=process.env.PUBLIC_CONTROLLER_PARENT_RED==='1'?readFileSync('/Users/huangjiahao/ynx-wallet-original-admission-native-r10-four-p2-repair-20261012/source/apps/wallet-desktop/src/original-admission-controller.mjs','utf8'):readFileSync(new URL('original-admission-controller.mjs',root),'utf8');
function controllerFixture({close=()=>undefined,complete,enterFailure=false,ackFailure=false,channelClose,join,deliver,providedOwner,configureSupply}={}){
  const events=[],owner=providedOwner??Object.freeze({PUBLIC:'OWNER_STANDIN'}),cleanupStarted=deferred();let closeCount=0,guardAlive=true;
  const raw={operationId:'PUBLIC_OP',expiresAtMs:20000,receiptDirectory:'PUBLIC_DIRECTORY',sourceSelection:{PUBLIC:'SOURCE_STANDIN'},expectedRequest:{requestNonce:'PUBLIC_NONCE',requestedAtMs:1000,expiresAtMs:20000,applicationId:'PUBLIC_APP',consumerManifestDigest:'PUBLIC_CONSUMER',gatewayManifestDigest:'PUBLIC_GATEWAY',registryDigest:'PUBLIC_REGISTRY',instanceId:'PUBLIC_INSTANCE',currentReference:'PUBLIC_CURRENT'}};
  const publication={selection:{sourceSelection:raw.sourceSelection,receiptDirectory:raw.receiptDirectory,expectedRequest:raw.expectedRequest,receiptSelection:{receiptDigest:'PUBLIC_DIGEST'}},account:'PUBLIC_ACCOUNT',sequence:1,expiresAtMs:19000};
  const supply={raw,observer:null,assertCurrent:()=>undefined,assertAdmissionSuccession:()=>undefined,
    vault:{acquireOriginalServiceAdmissionProduction:async()=>owner},assertOriginalServiceAdmissionProductionOwner:async()=>undefined,
    publishOriginalServiceAdmissionProduction:async()=>publication,
    closeOriginalServiceAdmissionProductionOwner:ref=>{assert.equal(ref,owner);closeCount++;cleanupStarted.resolve();return close();},
    ...(complete?{completeOriginalServiceAdmissionProductionClose:complete}:{}),
    enterOriginalServiceAdmissionDelivery:async()=>{events.push('entered');if(enterFailure)throw Error('PUBLIC_ENTER_FAILED');},
    acknowledgeOriginalServiceAdmissionDelivery:async()=>{events.push('ack-committed');if(ackFailure)throw Error('PUBLIC_ACK_COMMIT_FAILED');},
    markOriginalServiceAdmissionDeliveryUnknown:async()=>{events.push('UNKNOWN');},
    broker:{assertCurrent:()=>undefined,close:()=>{events.push('endpoint-retired');return channelClose?.();},joinEntered:async()=>join?.(),deliver:async()=>{events.push('actual-ACK-standin');return deliver?.();},waitRetirement:async()=>({reason:'ADMISSION_EPOCH_EXPIRED'})},
  };
  configureSupply?.(supply);
  const ctx=vm.createContext({admissionCanonical:JSON.stringify,captureInstalledAdmission:x=>x,launchOriginalAdmissionIDE:()=>{throw Error('PUBLIC_NO_SPAWN');}});
  vm.runInContext(selectedControllerSource.replace(/^import .*;$/mg,'').replace('export ','')+'\nthis.create=createOriginalAdmissionController',ctx);
  const controller=ctx.create({getSupply:()=>supply,run:async operation=>{try{return await operation({assert(){if(!guardAlive)throw Error('PUBLIC_GUARD_RETIRED');}});}finally{guardAlive=false;}},getContext:()=>({locked:false,authenticating:false,focused:true,changing:false,account:'PUBLIC_ACCOUNT',revision:1,unlockExpiresAt:20000}),id:()=> 'PUBLIC_REVIEW',now:()=>1000});
  controller.review();return {controller,events,owner,cleanupStarted,closeCount:()=>closeCount};
}
test('PUBLIC R11 matching keeps exact cleanup presence and join debt alongside durable ACK',async()=>{
  for(const cause of [false,null,undefined,0,''])for(const boundary of ['close','channel','join','completion']){
    const f=controllerFixture({
      close:()=>{if(boundary==='close')throw cause;if(boundary==='completion')return Promise.resolve();},
      complete:boundary==='completion'?async()=>{throw cause;}:undefined,
      channelClose:()=>{if(boundary==='channel')throw cause;},
      join:()=>{if(boundary==='join')throw cause;},
    });
    await f.controller.confirm('PUBLIC_REVIEW');let retained;f.controller.selectRetainedOutcome(x=>{retained=x;});
    assert.equal(retained.owner,f.owner);assert.equal(retained.cleanupFailurePresent,true);assert.equal(retained.cleanupCause,cause);
    assert.equal(f.controller.status().cleanupIncomplete,true);assert.equal(f.controller.status().outcomeUnknown,true);
    assert.deepEqual(f.events.slice(0,3),['entered','actual-ACK-standin','ack-committed']);
    assert.equal(f.closeCount(),boundary==='channel'||boundary==='join'?0:1);
    f.controller.cancel();assert.equal(f.events.filter(x=>x==='endpoint-retired').length,1);
    assert.throws(()=>f.controller.review(),/UNRESOLVED/);await assert.rejects(f.controller.confirm('PUBLIC_REVIEW'),/REVIEW_CHANGED/);
  }
});
test('PUBLIC R11 matching preserves exact falsy operation cause before cleanup cause',async()=>{
  for(const cause of [false,null,undefined,0,'']){
    const cleanup=Error('PUBLIC_DISTINCT_CLEANUP'),f=controllerFixture({deliver:()=>{throw cause;},close:()=>{throw cleanup;}});
    await assert.rejects(f.controller.confirm('PUBLIC_REVIEW'),/OPERATION_FAILED/);let retained;f.controller.selectRetainedOutcome(x=>{retained=x;});
    assert.equal(retained.firstCausePresent,true);assert.equal(retained.firstCause,cause);assert.equal(retained.cleanupCause,cleanup);
    assert.equal(f.controller.status().error,'ADMISSION_OPERATION_FAILED');assert.equal(retained.owner,f.owner);
    assert.deepEqual(f.events.slice(0,3),['entered','actual-ACK-standin','UNKNOWN']);
  }
});
test('PUBLIC R11 matching known original undefined completion still releases after durable ACK',async()=>{
  const done=deferred();let same;const f=controllerFixture({close:()=>{same=done.promise;return same;},complete:async(ref,result)=>{assert.equal(ref,f.owner);assert.equal(result,same);assert.equal(await result,undefined);}});
  const confirm=f.controller.confirm('PUBLIC_REVIEW');await f.cleanupStarted.promise;
  assert.equal(f.controller.status().ownerRetained,true);done.resolve();await confirm;
  assert.equal(f.controller.status().ownerRetained,false);assert.equal(f.controller.status().cleanupIncomplete,false);
  assert.deepEqual(f.events.slice(0,3),['entered','actual-ACK-standin','ack-committed']);assert.equal(f.closeCount(),1);
});
test('PUBLIC new known-completion controller waits exact Promise before release, without dead business guard',async()=>{
  const completion=deferred();let original;
  const f=controllerFixture({close:()=>{original=completion.promise;return original;},complete:async(ref,result)=>{assert.equal(result,original);const value=await result;if(value!==undefined)throw Error('PUBLIC_NOT_COMPLETE');return undefined;}});
  const confirmation=f.controller.confirm('PUBLIC_REVIEW');await f.cleanupStarted.promise;
  assert.equal(f.controller.status().ownerRetained,true);completion.resolve();await confirmation;
  assert.equal(f.controller.status().ownerRetained,false);assert.equal(f.controller.status().cleanupIncomplete,false);assert.equal(f.closeCount(),1);
});
test('PUBLIC new known-completion rejection/nonvoid retains exact owner/first cleanup; no re-close',async()=>{
  for(const mode of ['rejected','rejected-false','rejected-null','rejected-undefined','nonvoid','nonvoid-false','nonvoid-null']){
    const completion=deferred();const f=controllerFixture({close:()=>completion.promise,complete:async(ref,result)=>{if(await result!==undefined)throw Error('PUBLIC_NONVOID');}});
    const confirmation=f.controller.confirm('PUBLIC_REVIEW');await f.cleanupStarted.promise;
    if(mode==='rejected')completion.reject(Error('PUBLIC_CLOSE_FAILED'));
    else if(mode.startsWith('rejected-'))completion.reject(mode==='rejected-false'?false:mode==='rejected-null'?null:undefined);
    else completion.resolve(mode==='nonvoid-false'?false:mode==='nonvoid-null'?null:'PUBLIC_UNKNOWN_COMPLETION');
    await confirmation;assert.equal(f.controller.status().ownerRetained,true);assert.equal(f.controller.status().cleanupIncomplete,true);
    let retained;f.controller.selectRetainedOutcome(value=>{retained=value;});assert.equal(retained.owner,f.owner);assert.equal(retained.cleanupFailurePresent,true);
    f.controller.cancel();assert.equal(f.closeCount(),1);assert.throws(()=>f.controller.review(),/UNRESOLVED/);
  }
});
test('PUBLIC new generic unsupported async close remains conservative, not source-qualified completion',async()=>{
  const completion=deferred(),f=controllerFixture({close:()=>completion.promise});const confirmation=f.controller.confirm('PUBLIC_REVIEW');await f.cleanupStarted.promise;completion.resolve();await confirmation;
  assert.equal(f.controller.status().ownerRetained,true);assert.equal(f.controller.status().outcomeUnknown,true);assert.equal(f.closeCount(),1);
});
test('PUBLIC new actual controller orders durable entered before channel and commits only exact ACK',async()=>{
  const f=controllerFixture();await f.controller.confirm('PUBLIC_REVIEW');
  assert.deepEqual(f.events.slice(0,3),['entered','actual-ACK-standin','ack-committed']);
});
test('PUBLIC new actual controller fail-closed durable enter and ACK persistence failures',async()=>{
  for(const kind of ['enter','ack']){
    const f=controllerFixture({enterFailure:kind==='enter',ackFailure:kind==='ack'});await assert.rejects(f.controller.confirm('PUBLIC_REVIEW'),/OPERATION_FAILED/);
    assert.equal(f.controller.status().outcomeUnknown,true);
    if(kind==='enter')assert.equal(f.events.includes('actual-ACK-standin'),false);
    else assert.deepEqual(f.events.slice(0,3),['entered','actual-ACK-standin','ack-committed']);
  }
});
test('PUBLIC actual custodian completion requires original owned Promise, rejects replacement/foreign ref',async()=>{
  const api=custodian(),ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>undefined,publish:()=>undefined,dispose:()=>undefined});
  await assert.rejects(api.completeOriginalServiceAdmissionProductionClose(ref,Promise.resolve()),/RESULT_UNKNOWN/);
  const original=api.closeOriginalServiceAdmissionProductionOwner(ref);
  await assert.rejects(api.completeOriginalServiceAdmissionProductionClose({},original),/OWNER_REQUIRED/);
  await assert.rejects(api.completeOriginalServiceAdmissionProductionClose(ref,Promise.resolve()),/RESULT_UNKNOWN/);
  assert.equal(await api.completeOriginalServiceAdmissionProductionClose(ref,original),undefined);
});
test('PUBLIC actual custodian delivery binds original produced result and durable single epoch',async()=>{
  const api=custodian(),result=Object.freeze({PUBLIC:'INSTALLED_STANDIN'}),events=[];
  const ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>undefined,publish:()=>result,dispose:()=>undefined,enterDelivery:async value=>{assert.equal(value,result);events.push('persist-entered');},acknowledgeDelivery:async value=>{assert.equal(value,result);events.push('persist-ack');}});
  await assert.rejects(api.enterOriginalServiceAdmissionDelivery(ref),/STATE_UNKNOWN/);
  await api.publishOriginalServiceAdmissionProduction(ref);
  await api.enterOriginalServiceAdmissionDelivery(ref);await assert.rejects(api.enterOriginalServiceAdmissionDelivery(ref),/STATE_UNKNOWN/);
  await api.acknowledgeOriginalServiceAdmissionDelivery(ref);await assert.rejects(api.acknowledgeOriginalServiceAdmissionDelivery(ref),/STATE_UNKNOWN/);
  assert.deepEqual(events,['persist-entered','persist-ack']);await api.closeOriginalServiceAdmissionProductionOwner(ref);
});
test('PUBLIC exact Vault producer body persists UNKNOWN before each single stand-in sign, installs exact review and refuses cold replay',async()=>{
  const source=readFileSync(new URL('password-wallet-vault.mjs',root),'utf8'),start=source.indexOf('  async #produceOriginalAdmission('),end=source.indexOf('\n  }',start)+4;
  const method=source.slice(start,end),clone=value=>JSON.parse(JSON.stringify(value)),events=[];
  const publicKey=Buffer.alloc(32,1),request={requestNonce:'PUBLIC_REVIEWED_NONCE',requestedAtMs:1000,expiresAtMs:20000,consumerManifestDigest:'PUBLIC_CONSUMER'};
  const input={operationId:'PUBLIC_OPERATION',expectedRequest:request,sourceSelection:{PUBLIC:'FIXED_SOURCE'},receiptDirectory:'PUBLIC_DIRECTORY',expiresAtMs:20000};
  let catalog={version:1,serviceRoleState:{holder:{privateKeyPKCS8:'PUBLIC_NOT_A_PRIVATE_KEY'}},runtimePublicationState:{records:[]},admissionPublicationState:{records:[]}},snapshot=0;
  const context={current:{vault:{revision:1},snapshot:{digest:'PUBLIC_0'},session:{PUBLIC:'SESSION'}},catalog,codec:{assertApproved:()=>undefined},approved:{holderPublicKey:publicKey.toString('base64url'),receipt:{body:{nonce:'PUBLIC_REGISTRATION'}}},source:{binding:{PUBLIC:'SOURCE_BINDING'},assertCurrent:()=>undefined,validateReviewedOriginalPublication:decision=>assert.deepEqual(JSON.parse(decision.requestRaw),request)},observation:{sequence:1,binding:{PUBLIC:'OBSERVATION_BINDING'},observationRaw:'PUBLIC_OBSERVATION'}};
  const ctx=vm.createContext({Buffer,canonicalJSON:JSON.stringify,fail:code=>{throw Error(code);},options:()=>({}),assertOriginalWalletServiceRuntimeObservationCurrent:()=>undefined,
    rewritePasswordVault:async(vault,changes)=>({vault:{revision:vault.revision+1,PUBLIC_CATALOG:clone(changes.originalAdmissionCatalog)},session:{}}),
    decryptPasswordVaultOriginalAdmissionCatalog:async()=>clone(catalog),
    reserveOriginalWalletServiceRuntimePublication:(state,value)=>({state:{records:[{...value,state:'pending'}]}}),
    markOriginalWalletServiceRuntimePublicationUnknown:(state,nonce)=>({state:{records:state.records.map(record=>({...record,state:'UNKNOWN'}))}}),
    recordOriginalWalletServiceRuntimePublicationSigned:(state,nonce,raw)=>({state:{records:state.records.map(record=>({...record,state:'signed',runtimeRaw:raw}))}}),
    createPrivateKey:()=>({PUBLIC:'KEY_STANDIN'}),createPublicKey:()=>({export:()=>publicKey}),
    signOriginalWalletServiceRuntimeObservation:()=>{assert.equal(catalog.runtimePublicationState.records[0].state,'UNKNOWN');events.push('runtime-sign');return 'PUBLIC_RUNTIME_RAW';},
    prepareOriginalWalletServiceAdmissionReview:value=>({requestRaw:JSON.stringify(value),reviewDigest:'PUBLIC_REVIEW_DIGEST'}),
    reserveOriginalWalletServiceAdmissionPublication:(state,value)=>({state:{records:[{...value,state:'pending'}]}}),
    markOriginalWalletServiceAdmissionPublicationUnknown:(state,nonce)=>({state:{records:state.records.map(record=>({...record,state:'UNKNOWN'}))}}),
    prepareOriginalWalletServiceAdmissionPublisher:()=>({publishReviewedOriginalAdmission:decision=>{assert.equal(catalog.admissionPublicationState.records[0].state,'UNKNOWN');assert.deepEqual(JSON.parse(decision.requestRaw),request);events.push('admission-sign');return JSON.stringify({expiresAtMs:19000,PUBLIC:'SIGNED_STANDIN'});}}),
    recordOriginalWalletServiceAdmissionPublicationSigned:(state,nonce,raw)=>({state:{records:state.records.map(record=>({...record,state:'signed',signedRaw:raw}))}}),
    installOriginalWalletServiceAdmissionReceipt:()=>{assert.equal(catalog.admissionPublicationState.records[0].state,'signed');events.push('install');return {receiptSelection:{receiptDigest:'PUBLIC_DIGEST',receiptPath:'PUBLIC_RECEIPT_PATH'}};},
    getContext:()=>({...context,catalog:clone(catalog)}),
    getCurrent:()=>context.current,
    publish:async(candidate,expected,guard,install,before)=>{before();catalog=clone(candidate.vault.PUBLIC_CATALOG);snapshot++;context.current={vault:candidate.vault,snapshot:{digest:'PUBLIC_'+snapshot},session:{}};events.push('persist:'+catalog.runtimePublicationState.records[0].state+':'+(catalog.admissionPublicationState.records[0]?.state??'absent'));},
  });
  vm.runInContext(`class PUBLICAdapter {now(){return 1000;}files={assertCurrent:async()=>undefined};async #originalAdmissionContext(){return getContext();}async #readUnlocked(){return getCurrent();}async #publish(...args){return publish(...args);}${method}\nrun(...args){return this.#produceOriginalAdmission(...args);}}\nthis.adapter=new PUBLICAdapter();`,ctx);
  const review={account:'PUBLIC_ACCOUNT',assert:()=>undefined,assertAdmissionSuccession:value=>assert.deepEqual(value,request)};
  const result=await ctx.adapter.run(input,review,{PUBLIC:'OBSERVER_STANDIN'},{},()=>undefined);
  assert.deepEqual(result.selection.expectedRequest,request);
  assert.deepEqual(events,['persist:pending:absent','persist:UNKNOWN:absent','runtime-sign','persist:signed:absent','persist:signed:pending','persist:signed:UNKNOWN','admission-sign','persist:signed:signed','install']);
  await assert.rejects(ctx.adapter.run(input,review,{}, {},()=>undefined),/ORIGINAL_UNRESOLVED/);assert.equal(events.filter(x=>x.endsWith('-sign')).length,2);
});
function rawRetentionProducer(mode,cause){
  const text=readFileSync(new URL('password-wallet-vault.mjs',root),'utf8'),start=text.indexOf('  async #produceOriginalAdmission('),end=text.indexOf('\n  }',start)+4,method=text.slice(start,end);
  const clone=x=>JSON.parse(JSON.stringify(x)),publicKey=Buffer.alloc(32,1),counts={runtime:0,admission:0,install:0};let failed=false,wipedBytes;
  const request={requestNonce:'PUBLIC_INTENT',requestedAtMs:1000,expiresAtMs:20000,consumerManifestDigest:'PUBLIC_CONSUMER'},input={operationId:'PUBLIC_OP',sourceSelection:{},expectedRequest:request,receiptDirectory:'PUBLIC_DIR',expiresAtMs:20000};
  let catalog={serviceRoleState:{holder:{privateKeyPKCS8:'UFVCTElD'}},runtimePublicationState:{records:[]},admissionPublicationState:{records:[]}};
  let current={vault:{},session:{},snapshot:{digest:'PUBLIC_0'}};
  const runtimeRaw='PUBLIC_EXACT_RUNTIME_RAW',admissionRaw=JSON.stringify({expiresAtMs:19000,PUBLIC:'EXACT_ADMISSION_RAW'});
  const check=()=>{if(failed)throw cause;};
  const ctx=vm.createContext({Buffer,canonicalJSON:JSON.stringify,fail:code=>{throw Error(code);},options:()=>({}),assertOriginalWalletServiceRuntimeObservationCurrent:check,
    context:()=>({current,catalog:clone(catalog),codec:{assertApproved:check},approved:{holderPublicKey:publicKey.toString('base64url'),receipt:{body:{nonce:'PUBLIC_REGISTER'}}},source:{binding:{},assertCurrent:check,validateReviewedOriginalPublication:check},observation:{binding:{},observationRaw:'PUBLIC_OBSERVATION',sequence:1}}),
    rewritePasswordVault:async(v,change)=>({vault:{CATALOG:clone(change.originalAdmissionCatalog)}}),decryptPasswordVaultOriginalAdmissionCatalog:async()=>clone(catalog),
    reserveOriginalWalletServiceRuntimePublication:(s,v)=>({state:{records:[{...v,state:'pending'}]}}),markOriginalWalletServiceRuntimePublicationUnknown:s=>({state:{records:s.records.map(r=>({...r,state:'UNKNOWN'}))}}),recordOriginalWalletServiceRuntimePublicationSigned:(s,n,raw)=>({state:{records:s.records.map(r=>({...r,state:'signed',raw}))}}),
    reserveOriginalWalletServiceAdmissionPublication:(s,v)=>({state:{records:[{...v,state:'pending'}]}}),markOriginalWalletServiceAdmissionPublicationUnknown:s=>({state:{records:s.records.map(r=>({...r,state:'UNKNOWN'}))}}),recordOriginalWalletServiceAdmissionPublicationSigned:(s,n,raw)=>({state:{records:s.records.map(r=>({...r,state:'signed',raw}))}}),
    createPrivateKey:({key})=>{wipedBytes=key;return {};},createPublicKey:()=>({export:()=>publicKey}),
    signOriginalWalletServiceRuntimeObservation:()=>{counts.runtime++;if(mode==='runtime-late')failed=true;return runtimeRaw;},
    prepareOriginalWalletServiceAdmissionReview:r=>({requestRaw:JSON.stringify(r),reviewDigest:'PUBLIC_DIGEST'}),
    prepareOriginalWalletServiceAdmissionPublisher:()=>({publishReviewedOriginalAdmission:()=>{counts.admission++;if(mode==='admission-late')failed=true;return admissionRaw;}}),
    installOriginalWalletServiceAdmissionReceipt:()=>{counts.install++;if(mode==='install-late')failed=true;return {receiptSelection:{PUBLIC:'EXACT_INSTALLED'}};},
    read:()=>current,
    persist:async candidate=>{const next=candidate.vault.CATALOG;if(mode==='runtime-persist'&&next.runtimePublicationState.records[0]?.state==='signed'||mode==='admission-persist'&&next.admissionPublicationState.records[0]?.state==='signed')throw cause;catalog=clone(next);current={vault:candidate.vault,session:{},snapshot:{digest:'PUBLIC_NEXT'}};},
  });
  // Exact source body in one lexical context; dependencies are PUBLIC stand-ins.
  ctx.input=input;ctx.review={account:'PUBLIC_ACCOUNT',assert:check,assertAdmissionSuccession:check};
  vm.runInContext(`class Adapter{now(){return 1000;}files={assertCurrent:async()=>undefined};async #originalAdmissionContext(){return context();}async #readUnlocked(){return read();}async #publish(candidate){return persist(candidate);}${method}\nrun(partial,business){return this.#produceOriginalAdmission(input,review,{},partial,business);}}this.adapter=new Adapter()`,ctx);
  return {run:(partial,business=check)=>ctx.adapter.run(partial,business),counts,runtimeRaw,admissionRaw,wiped:()=>wipedBytes?.every(x=>x===0)};
}
test('PUBLIC F1F2 runtime original survives immediate late fence with one stand-in sign and key-byte wipe',async()=>{
  const cause=Error('PUBLIC_LATE_CURRENT'),f=rawRetentionProducer('runtime-late',cause),partial={};
  let rejected=false;try{await f.run(partial);}catch(error){rejected=true;assert.equal(error,cause);}
  assert(rejected);assert.equal(partial.runtime,f.runtimeRaw);assert.equal(f.counts.runtime,1);assert.equal(f.counts.admission,0);assert.equal(f.wiped(),true);
});
test('PUBLIC F1F2 private recovery retains partial originals after actual composed successful cleanup',async()=>{
  for(const mode of ['runtime-persist','admission-late','admission-persist','install-late'])for(const cause of [false,null,undefined,Error('PUBLIC_STORAGE_REFUSAL')]){
    const producer=rawRetentionProducer(mode,cause),api=custodian();let disposed=0,currentCalls=0;
    const ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>{currentCalls++;},publish:(partial,current)=>producer.run(partial,current),dispose:()=>{disposed++;}});
    const f=controllerFixture({providedOwner:ref,close:()=>api.closeOriginalServiceAdmissionProductionOwner(ref),complete:api.completeOriginalServiceAdmissionProductionClose,configureSupply:s=>{s.assertOriginalServiceAdmissionProductionOwner=api.assertOriginalServiceAdmissionProductionOwner;s.publishOriginalServiceAdmissionProduction=api.publishOriginalServiceAdmissionProduction;s.selectOriginalServiceAdmissionProductionOutcome=api.selectOriginalServiceAdmissionProductionOutcome;}});
    await assert.rejects(f.controller.confirm('PUBLIC_REVIEW'),/OPERATION_FAILED/);
    let retained;f.controller.selectRetainedOutcome(x=>{retained=x;});
    assert.equal(retained.owner,null);assert.equal(retained.retainedOutcomeOwner,ref);assert.equal(retained.cleanupFailurePresent,false);
    assert.equal(retained.productionOutcome.resourcesClosed,true);assert.equal(retained.productionOutcome.firstCausePresent,true);assert.equal(retained.productionOutcome.firstCause,cause);
    assert.equal(retained.productionOutcome.partial.runtime,producer.runtimeRaw);if(mode!=='runtime-persist')assert.equal(retained.productionOutcome.partial.publication,producer.admissionRaw);
    assert.equal(retained.publicationReturned,false);assert.equal(retained.firstCause,cause);assert.equal(disposed,1);assert.equal(producer.wiped(),true);
    const before=currentCalls;api.selectOriginalServiceAdmissionProductionOutcome(ref,x=>{assert.equal(x.resourcesClosed,true);assert(Object.isFrozen(x.partial));});assert.equal(currentCalls,before);
    let refused=false;try{await api.publishOriginalServiceAdmissionProduction(ref);}catch(error){refused=true;assert.equal(error,cause);}assert(refused);
    assert.throws(()=>f.controller.review(),/UNRESOLVED/);f.controller.cancel();assert.equal(disposed,1);assert.equal(producer.counts.runtime,1);assert.equal(producer.counts.admission,mode==='runtime-persist'?0:1);
    assert.equal(JSON.stringify(f.controller.status()).includes(producer.runtimeRaw),false);
  }
  assert(readFileSync(new URL('original-admission-supply.mjs',root),'utf8').includes('selectOriginalServiceAdmissionProductionOutcome'));
});
test('PUBLIC F1F2 late complete result and failed cleanup remain privately reachable without authority',async()=>{
  const api=custodian(),started=deferred(),finish=deferred(),result=Object.freeze({PUBLIC:'ORIGINAL_RESULT'});let disposals=0;
  const ref=api.retainOriginalAdmissionCustodian({assertCurrent:()=>undefined,publish:async partial=>{partial.runtime='PUBLIC_RUNTIME';started.resolve();await finish.promise;return result;},dispose:()=>{disposals++;}});
  const publish=api.publishOriginalServiceAdmissionProduction(ref);await started.promise;const close=api.closeOriginalServiceAdmissionProductionOwner(ref);finish.resolve();await assert.rejects(publish,/RETIRED/);await close;
  api.selectOriginalServiceAdmissionProductionOutcome(ref,outcome=>{assert.equal(outcome.result,result);assert.equal(outcome.partial.runtime,'PUBLIC_RUNTIME');assert.equal(outcome.resourcesClosed,true);assert.throws(()=>{outcome.partial.runtime='REBOUND';},TypeError);});
  assert.equal(api.closeOriginalServiceAdmissionProductionOwner(ref),close);assert.equal(disposals,1);await assert.rejects(api.publishOriginalServiceAdmissionProduction(ref),/RETIRED/);
  for(const cleanupCause of [false,null,undefined,'PUBLIC_NONVOID']){
    const cause=Error('PUBLIC_ORIGINAL_FAILURE'),producer=rawRetentionProducer('admission-persist',cause);let count=0;
    const owned=api.retainOriginalAdmissionCustodian({assertCurrent:()=>undefined,publish:(p,c)=>producer.run(p,c),dispose:()=>{count++;if(cleanupCause==='PUBLIC_NONVOID')return cleanupCause;throw cleanupCause;}});
    const f=controllerFixture({providedOwner:owned,close:()=>api.closeOriginalServiceAdmissionProductionOwner(owned),complete:api.completeOriginalServiceAdmissionProductionClose,configureSupply:s=>{s.assertOriginalServiceAdmissionProductionOwner=api.assertOriginalServiceAdmissionProductionOwner;s.publishOriginalServiceAdmissionProduction=api.publishOriginalServiceAdmissionProduction;s.selectOriginalServiceAdmissionProductionOutcome=api.selectOriginalServiceAdmissionProductionOutcome;}});
    await assert.rejects(f.controller.confirm('PUBLIC_REVIEW'),/OPERATION_FAILED/);let outcome;f.controller.selectRetainedOutcome(x=>{outcome=x;});
    assert.equal(outcome.owner,owned);assert.equal(outcome.productionOutcome.partial.publication,producer.admissionRaw);assert.equal(outcome.productionOutcome.resourcesClosed,false);assert.equal(outcome.firstCause,cause);assert.equal(outcome.cleanupFailurePresent,true);
    const originalClose=api.closeOriginalServiceAdmissionProductionOwner(owned);try{await originalClose;}catch{}assert.equal(api.closeOriginalServiceAdmissionProductionOwner(owned),originalClose);assert.equal(count,1);
  }
});
test('PUBLIC new close throwing any falsy value retains exact raw cause and original owner, blocks later review',async()=>{
  for(const originalThrown of [false,null,undefined,0,'']){
    const f=controllerFixture({close:()=>{throw originalThrown;}});await f.controller.confirm('PUBLIC_REVIEW');
    assert.equal(f.controller.status().cleanupIncomplete,true);assert.equal(f.controller.status().outcomeUnknown,true);assert.equal(f.controller.status().ownerRetained,true);
    let retained;f.controller.selectRetainedOutcome(value=>{retained=value;});assert.equal(retained.owner,f.owner);assert.equal(retained.cleanupFailurePresent,true);assert.equal(retained.cleanupCause,originalThrown);
    assert.throws(()=>f.controller.review(),/UNRESOLVED/);f.controller.cancel();assert.equal(f.closeCount(),1);
  }
});

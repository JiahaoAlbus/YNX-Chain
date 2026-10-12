import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// PUBLIC lexical controls, exact production source bodies. All hooks/codec/
// crypto/store dependencies below are PUBLIC stand-ins. No product import,
// key, protected file, signing, service or actual owner resource is executed.
const root=new URL('../src/',import.meta.url);
const custodianSource=readFileSync(new URL('original-admission-custodian.mjs',root),'utf8');
function custodian(){const ctx=vm.createContext({captureOriginalAdmissionProductionContext:value=>value});vm.runInContext(custodianSource.replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.api={retainOriginalAdmissionCustodian,assertOriginalServiceAdmissionProductionOwner,publishOriginalServiceAdmissionProduction,closeOriginalServiceAdmissionProductionOwner,completeOriginalServiceAdmissionProductionClose,enterOriginalServiceAdmissionDelivery,acknowledgeOriginalServiceAdmissionDelivery}',ctx);return ctx.api;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
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
function controllerFixture({close=()=>undefined,complete,enterFailure=false,ackFailure=false,channelClose,join,deliver}={}){
  const events=[],owner=Object.freeze({PUBLIC:'OWNER_STANDIN'}),cleanupStarted=deferred();let closeCount=0,guardAlive=true;
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
test('PUBLIC new close throwing any falsy value retains exact raw cause and original owner, blocks later review',async()=>{
  for(const originalThrown of [false,null,undefined,0,'']){
    const f=controllerFixture({close:()=>{throw originalThrown;}});await f.controller.confirm('PUBLIC_REVIEW');
    assert.equal(f.controller.status().cleanupIncomplete,true);assert.equal(f.controller.status().outcomeUnknown,true);assert.equal(f.controller.status().ownerRetained,true);
    let retained;f.controller.selectRetainedOutcome(value=>{retained=value;});assert.equal(retained.owner,f.owner);assert.equal(retained.cleanupFailurePresent,true);assert.equal(retained.cleanupCause,originalThrown);
    assert.throws(()=>f.controller.review(),/UNRESOLVED/);f.controller.cancel();assert.equal(f.closeCount(),1);
  }
});

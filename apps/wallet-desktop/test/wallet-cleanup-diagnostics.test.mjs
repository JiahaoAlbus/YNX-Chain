import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {compileFunction} from 'node:vm';
import {createWalletCleanupDiagnostics} from '../src/wallet-cleanup-diagnostics.mjs';
import {createDesktopAgentDelegationController} from '../src/desktop-agent-delegation-controller.mjs';
import {createDesktopAgentDelegationsService} from '../src/desktop-agent-delegations-ipc.mjs';
const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),begin=main.indexOf('async function shutdownOriginalPQWallet(){'),end=main.indexOf('\nconst originalAdmissionExit=',begin),exit=main.indexOf('function createOriginalAdmissionExitGate(');
const makeExit=compileFunction(main.slice(exit,begin)+';return createOriginalAdmissionExitGate;',[],{contextExtensions:[{setImmediate}]})();
const failure=code=>Object.assign(Error('SECRET body/password/proof'),{code});
function fixture({faultOwner=null,cause=failure('PUBLIC_CLEANUP_FAILED'),agent=null}={}){
 const diagnostics=createWalletCleanupDiagnostics(),calls=[],run=name=>()=>{calls.push(name);if(name===faultOwner)throw cause;};
 const context={originalCleanupDiagnostics:diagnostics,originalMainNamespaceStartup:{retire:run('namespace-retire'),shutdown:run('namespace-close'),statusDATA:()=>({startupErrorPresent:true,startupError:failure('ROOT_NOT_SUPPLIED')})},originalPayContextBridge:{invalidateAll:run('pay-retire'),assertSafeToClose:run('pay-assert')},originalProductContextBridge:{invalidateAll:run('product-retire'),assertSafeToClose:run('product-assert')},nativePayMainEntry:{cancel:run('pay-cancel'),shutdown:run('pay-drain')},pqFinalityCollection:{retire:run('finality-retire'),join:run('finality-join')},originalDeviceRegistration:{close:run('registration')},originalDeviceFinalization:{close:run('finalization')},walletAuthority:{shutdownPQReviews:run('pq-reviews')},originalAITaskReview:null,originalDeviceManagementReview:null,originalDeviceCreation:{close:run('creation')},originalDeviceQuery:{close:run('query')},originalIDEIdentityPeerOwner:{shutdown:run('ide')},originalProjectControl:{shutdown:run('project')},agentDelegationsService:agent??{close:run('agent'),assertSafeToClose:run('agent-assert')},standalonePayNavigationSteps:null,nativePayProduct:{assertSafeToClose:run('pay-product-assert')},pqTransactionSubmission:null,aiTaskPublicCleanupPresent:false,aiTaskPublicParents:new Map()};
 return {diagnostics,calls,shutdown:compileFunction(main.slice(begin,end)+';return shutdownOriginalPQWallet;',[],{contextExtensions:[context]})()};
}
test('diagnostics serialize only own public codes/type; first operation and cleanup failure remain distinct, getters never read',()=>{
 const d=createWalletCleanupDiagnostics();let getters=0;const bad={get code(){getters++;throw 0;},get message(){getters++;return 'SECRET';}};
 d.record('agent-view','operation',failure('MANAGEMENT_NOT_SUPPLIED'));d.record('agent-view','drain',false);d.record('agent-view','drain',failure('MUST_NOT_REPLACE_FIRST'));d.record('namespace','drain',bad);d.record('SECRET_PATH','drain',failure('IGNORE'));
 assert.equal(getters,0);assert.equal(d.read().length,3);assert.equal(d.read()[0].stage,'operation');assert.equal(d.read()[1].causeType,'boolean');assert(!/SECRET|body|password|proof|MUST_NOT/.test(JSON.stringify(d.read())));assert(d.format().includes('agent-view/drain'));
});
test('normal Main no-effect Root unavailable plus Agent draft/review unavailable/discard drains without turning missing authority into cleanup debt',async()=>{
 const state={account:'0x'+'1'.repeat(40),revision:1,locked:false},controller=createDesktopAgentDelegationController({getContext:()=>state,management:null}),agent=createDesktopAgentDelegationsService({controller});
 assert.deepEqual(await agent.readProjection(),{state:'unavailable'});assert.deepEqual(await agent.reviewDraft({agent:'PUBLIC',purpose:'PUBLIC',scope:'PUBLIC',budget:'1',unit:'not authority',period:'once',expiresAt:'2030-01-01T00:00:00Z'}),{state:'unavailable'});assert.equal(await agent.cancelView(),true);agent.assertSafeToClose();state.locked=true;
 const f=fixture({agent});await f.shutdown();agent.assertSafeToClose();assert(f.calls.includes('namespace-close'));assert.deepEqual(f.diagnostics.read().map(r=>[r.owner,r.stage,r.code]),[['namespace','operation','ROOT_NOT_SUPPLIED']]);
});
test('actual normal admission entry + Main shutdown + Agent no-effect refusal reaches clean original exit once',async()=>{
 const state={account:'0x'+'1'.repeat(40),revision:1,locked:false},controller=createDesktopAgentDelegationController({getContext:()=>state,management:null}),agent=createDesktopAgentDelegationsService({controller});
 assert.deepEqual(await agent.reviewDraft({agent:'PUBLIC'}),{state:'unavailable'});await agent.cancelView();
 const entryStart=main.indexOf('function createOriginalAdmissionEntry('),entryEnd=main.indexOf('\noriginalAdmissionEntry=createOriginalAdmissionEntry',entryStart),makeEntry=compileFunction(main.slice(entryStart,entryEnd)+';return createOriginalAdmissionEntry;',[],{contextExtensions:[{accountChangeInProgress:false}]})();
 const entry=makeEntry({controller:{cancel(){},status:()=>({busy:false,ownerRetained:false,cleanupIncomplete:false,outcomeUnknown:false})},keyAccess:{status:()=>state},getVault(){},getWindow:()=>({isFocused:()=>true}),selectionUnresolved:()=>false,notify(){},closeSupply(){assert.fail('no admission resource was ever acquired');}});
 const f=fixture({agent});let quits=0,reports=0;const gate=makeExit({entry,shutdownWallet:f.shutdown,diagnostics:f.diagnostics,lock(){state.locked=true;},assertCloseSafe:()=>agent.assertSafeToClose(),report(){reports++;},quit(){quits++;}});
 const first=gate.request();assert.equal(gate.request(),first);await first;gate.allClosed();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(quits,1);assert.equal(reports,0);assert(f.calls.includes('namespace-close'));
});
for(const [owner,label]of [['query','device-query'],['registration','registration'],['agent','agent-view'],['pay-drain','pay-entry']])test('actual Main separately identifies '+label+' cleanup without changing cause, dropping siblings or releasing namespace',async()=>{
 const cause=false,f=fixture({faultOwner:owner,cause});await assert.rejects(f.shutdown(),e=>e===cause);assert(f.calls.includes('project'));assert(!f.calls.includes('namespace-close'));assert(f.diagnostics.read().some(r=>r.owner===label&&r.stage==='drain'&&r.causeType==='boolean'));
});
test('assert failure is attributed to actual child instead of namespace owner',async()=>{const f=fixture({faultOwner:'product-assert'});await assert.rejects(f.shutdown());assert(f.diagnostics.read().some(r=>r.owner==='product-context'&&r.stage==='assert'));assert(!f.diagnostics.read().some(r=>r.owner==='namespace'&&r.stage==='close'));});
test('original exit gate reports both original drain codes once and keeps failed cleanup sticky without retry',async()=>{
 const diagnostics=createWalletCleanupDiagnostics();let entry=0,wallet=0,reports=0;const gate=makeExit({diagnostics,entry:{shutdown(){entry++;throw failure('ENTRY_CLEANUP');}},shutdownWallet(){wallet++;throw false;},lock(){},quit(){assert.fail('must remain open');},report(){reports++;}});
 const first=gate.request();await assert.rejects(first,{code:'ADMISSION_SHUTDOWN_INCOMPLETE'});assert.equal(gate.request(),first);assert.equal(entry,1);assert.equal(wallet,1);assert.equal(reports,1);assert.deepEqual(diagnostics.read().map(r=>[r.owner,r.code]),[['admission-entry','ENTRY_CLEANUP'],['wallet','CLEANUP_CAUSE_CODE_NOT_SUPPLIED']]);
});

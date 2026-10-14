import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Exact coordinator body with PUBLIC client/platform imports only. No Native,
// provider, protected service, crypto, account creation or opener runs here.
const strip=s=>s.replace(/^import .*;\n/gm,'');
const canonical=strip(readFileSync(new URL('../src/canonical.js',import.meta.url),'utf8'));
const source=strip(readFileSync(new URL('../src/wallet-connection-coordinator.js',import.meta.url),'utf8'));
const standins=`
const PRODUCT_SESSION_CLIENT_STATE={CONNECTING:'connecting'};
const parseProductSessionRegistry=x=>x;
const MetaMaskEvmConnectionAdapter=class {};
const discoverWalletProviders=async()=>({metamask:null,ambiguities:[]});
const walletAvailabilityFromDiscovery=()=>({});
export class RecoverableProductSessionClient {
 connectionBinding={productId:'PUBLIC_IDE',platform:'macos'};current={status:'disconnected'};counter=0;
 next(){return this.current={status:'connecting',automatic:false,request:{nonce:'PUBLIC_pending_opener_'+(++this.counter)},route:{url:'ynxwallet://PUBLIC'}};}
 async beginDetected(){return this.next();}async retryDetected(){return this.next();}
 enterGuest(){return this.current={status:'guest'};}async disconnect(){return this.current={status:'disconnected'};}
 setNetworkAvailable(){return this.current={status:'retry-required'};}async handleReturn(){return this.current={status:'connected',PUBLIC:true};}
 async restore(){return this.current={status:'connected',PUBLIC:true};}connectionChoices(){return [];}
}
`;
const mod=await import('data:text/javascript;base64,'+Buffer.from(canonical+'\n'+standins+'\n'+source).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(openWallet,timeout=1000){const client=new mod.RecoverableProductSessionClient();const coordinator=new mod.WalletConnectionCoordinator({registry:{products:[{productId:'PUBLIC_IDE'}]},productId:'PUBLIC_IDE',sessionClient:client,scope:{},discoveryWaitMs:0,openWallet,openTimeoutMs:timeout});return {client,coordinator};}
for(const action of ['enterGuest','disconnect','setNetworkAvailable','handleReturn','restore','connectMetaMask'])for(const settle of ['resolve','reject'])test(`PUBLIC ${action} suppresses stale opener ${settle} without claiming undo`,async()=>{
 const gate=deferred(),entered=deferred();let calls=0;const {coordinator}=fixture(()=>{calls++;entered.resolve();return gate.promise;});
 const operation=coordinator.beginYNX();await entered.promise;await coordinator[action](false);
 if(settle==='resolve')gate.resolve({opened:true});else gate.reject(new mod.WalletAuthError('USER_REJECTED','PUBLIC late refusal'));
 const result=await operation;assert.equal(result.status,'session-state');assert.equal(result.sessionState,coordinator.current);assert.equal(calls,1);
 assert.equal('requestId' in result,false);assert.equal('url' in result,false);
});
test('PUBLIC newer attempt supersedes older opener; both entered effects are preserved, never replayed',async()=>{
 const gates=[deferred(),deferred()],entered=[deferred(),deferred()];let calls=0;const {coordinator}=fixture(()=>{const i=calls++;entered[i].resolve();return gates[i].promise;});
 const first=coordinator.beginYNX();await entered[0].promise;const second=coordinator.retryYNX();await entered[1].promise;
 gates[1].resolve({opened:true});const current=await second;assert.equal(current.status,'wallet-opened');
 gates[0].resolve({opened:true});const stale=await first;assert.equal(stale.status,'session-state');assert.equal(stale.sessionState,coordinator.current);assert.equal(calls,2);
});
test('PUBLIC superseded pre-entry begin cannot call opener',async()=>{
 let calls=0;const {client,coordinator}=fixture(()=>{calls++;return {opened:true};});const pending=deferred();const old=client.next();client.beginDetected=()=>pending.promise;
 const first=coordinator.beginYNX();coordinator.enterGuest();pending.resolve(old);const result=await first;
 assert.equal(result.status,'session-state');assert.equal(result.sessionState.status,'guest');assert.equal(calls,0);
});
test('PUBLIC changed client state fences opener result even without a new coordinator generation',async()=>{
 const gate=deferred(),entered=deferred();const {client,coordinator}=fixture(()=>{entered.resolve();return gate.promise;});
 const opening=coordinator.beginYNX();await entered.promise;client.current={status:'retry-required',PUBLIC:'different session'};gate.resolve({opened:true});
 const result=await opening;assert.equal(result.status,'session-state');assert.equal(result.sessionState,client.current);
});
test('PUBLIC superseded restore returns current state and does not open automatic stale request',async()=>{
 let calls=0;const {client,coordinator}=fixture(()=>{calls++;return {opened:true};});const pending=deferred();const old=Object.freeze({...client.next(),automatic:true});client.current=old;client.restore=()=>pending.promise;
 const restoration=coordinator.restore();coordinator.enterGuest();pending.resolve(old);const result=await restoration;assert.equal(result.status,'session-state');assert.equal(result.sessionState.status,'guest');assert.equal(calls,0);
});
test('PUBLIC current success, refusal and timeout preserve existing result schema and opener count',async()=>{
 let calls=0;const success=fixture(()=>{calls++;return {opened:true};});assert.equal((await success.coordinator.beginYNX()).status,'wallet-opened');
 const refusal=fixture(()=>{calls++;return {opened:false,code:'USER_REJECTED'};});const no=await refusal.coordinator.beginYNX();assert.equal(no.status,'wallet-open-failed');assert.equal(no.code,'USER_REJECTED');
 const pending=deferred();const timed=fixture(()=>{calls++;return pending.promise;},10);const timeout=await timed.coordinator.beginYNX();assert.equal(timeout.status,'wallet-open-failed');assert.equal(timeout.code,'WALLET_OPEN_TIMEOUT');pending.resolve({opened:true});await Promise.resolve();assert.equal(calls,3);
});

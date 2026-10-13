import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = n => readFileSync(new URL('../src/'+n,import.meta.url),'utf8');
const strip = s => s.replace(/^import .*;\n/gm,'');
const canonical = strip(read('canonical.js'));
// Actual factory/coordinator bodies, PUBLIC constructor and platform stand-ins.
// No actual signer, provider graph, Native/runtime custody or service executes.
const standins = `
const hasOriginalWalletServicePrivateBridge=()=>globalThis.window?.ynxDesktopWallet!==undefined;
const encodeBase64url=()=>{throw Error('PUBLIC random/signing must not execute');};
const parseProductSessionRegistry=x=>x;
const MetaMaskEvmConnectionAdapter=class {};
const discoverWalletProviders=()=>{throw Error('PUBLIC provider must not execute');};
const walletAvailabilityFromDiscovery=()=>{};
const PRODUCT_SESSION_CLIENT_STATE={};
class ProductSessionGatewayFetchAdapter {constructor(config){this.config=config;this.kind='HTTPS';globalThis.PUBLIC_GATEWAY=this;}currentTime(){throw Error('PUBLIC clock');}}
class ProductSessionGatewayPrivateAdapter {constructor(config){this.config=config;if(typeof globalThis.window?.ynxDesktopWallet?.originalServiceDispatch!=='function')throw new WalletAuthError('ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED','PUBLIC old Native');this.kind='PRIVATE';globalThis.PUBLIC_GATEWAY=this;}currentTime(){throw Error('PUBLIC clock');}}
class RecoverableProductSessionClient {constructor(config){this.config=config;this.connectionBinding={productId:config.productId};globalThis.PUBLIC_SESSION=this;} getRevocationCompletions(){return Promise.resolve(['PUBLIC_receipt']);}getRevocationCompletion(id){return Promise.resolve(id);}acknowledgeRevocationCompletion(receipt){globalThis.PUBLIC_ACK=receipt;return Promise.resolve();}}
`;
const code=canonical+'\n'+standins+'\n'+strip(read('wallet-connection-coordinator.js'))+'\n'+strip(read('product-wallet-connection.js'));
const mod=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const config=()=>({registry:{products:[{productId:'PUBLIC_IDE'}]},productId:'PUBLIC_IDE',platform:'macos',walletInstalled:()=>true,schemeRegistered:()=>true,gatewayTimeoutMs:1000,storage:{PUBLIC:true},device:{id:'PUBLIC',key:'PUBLIC',sign:()=>{throw Error('must not sign');},scopes:['PUBLIC'],purpose:'PUBLIC'},scope:{},discoveryWaitMs:0,openWallet:()=>({opened:false,code:'PUBLIC'}),openTimeoutMs:10});
test('PUBLIC normal factory selects fixed Native bridge automatically; same-copy completion delegates survive',async()=>{
 globalThis.window={ynxDesktopWallet:{originalServiceDispatch:()=>{throw Error('constructor must not dispatch');}}};
 const connection=mod.createProductWalletConnection(config());assert.equal(globalThis.PUBLIC_GATEWAY.kind,'PRIVATE');assert.equal(globalThis.PUBLIC_SESSION.config.gateway,globalThis.PUBLIC_GATEWAY);
 assert.equal('fetch' in globalThis.PUBLIC_GATEWAY.config,false);assert.equal('endpoint' in globalThis.PUBLIC_GATEWAY.config,false);
 assert.deepEqual(await connection.getRevocationCompletions(),['PUBLIC_receipt']);assert.equal(await connection.getRevocationCompletion('PUBLIC_id'),'PUBLIC_id');await connection.acknowledgeRevocationCompletion('PUBLIC_receipt');assert.equal(globalThis.PUBLIC_ACK,'PUBLIC_receipt');
 assert.throws(()=>globalThis.PUBLIC_SESSION.config.clock(),{code:'CLOCK_UNAVAILABLE'});
});
test('PUBLIC ordinary web selection retains fixed HTTPS; arbitrary private transport configuration rejected',()=>{
 delete globalThis.window;mod.createProductWalletConnection(config());assert.equal(globalThis.PUBLIC_GATEWAY.kind,'HTTPS');assert.equal(globalThis.PUBLIC_GATEWAY.config.endpoint,'https://wallet-auth.ynxweb4.com');
 for(const field of ['privateGateway','fetch','endpoint','nativeBorrow'])assert.throws(()=>mod.createProductWalletConnection({...config(),[field]:()=>{}}),{code:'UNKNOWN_OR_MISSING_FIELD'});
});
test('PUBLIC normal package subpath resolves actual factory and declarations; root types do not falsely promise root runtime factory',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));const exp=pkg.exports['./product-wallet-connection'];assert.equal(exp.import,'./src/product-wallet-connection.js');assert.equal(exp.types,'./src/product-wallet-connection.d.ts');assert.equal(typeof mod.createProductWalletConnection,'function');assert(read('product-wallet-connection.d.ts').includes('createProductWalletConnection'));assert(!read('index.d.ts').includes('export { createProductWalletConnection'));
});
const recovery=read('product-session-recovery.js');
const method=recovery.slice(recovery.indexOf('  async #now(operation) {'),recovery.indexOf('  async #restoreStoredSession',recovery.indexOf('  async #now(operation) {')));
const clockCode=canonical+`\nfunction gatewayRequestId(kind,token){return 'req_ps_'+kind+'_'+token;} function fail(code,message){throw new WalletAuthError(code,message);} export class ClockControl { #gateway;#tokens;#clock;constructor(gateway){this.#gateway=gateway;this.#tokens=()=> 'PUBLIC_token_not_crypto_1234567890';this.#clock=()=>{throw Error('local time must not execute');};} read(op){return this.#now(op);}\n`+method+'}\n'+recovery.match(/function isNetworkUnavailable\(error\) \{[^\n]+\}/)[0]+'\nexport {isNetworkUnavailable};';
const clock=await import('data:text/javascript;base64,'+Buffer.from(clockCode).toString('base64'));
test('PUBLIC exact recovery clock body passes explicit per-call operation; public input unchanged; UNKNOWN retains protected-state classification',async()=>{
 const seen=[];const control=new clock.ClockControl({currentTimeForOperation:async(op,input)=>{seen.push([op,input]);return new Date('2026-10-14T00:00:00.000Z');},currentTime:()=>{throw Error('no public fallback');}});
 await Promise.all(['beginYNX','handleReturn','restore','disconnect'].map(op=>control.read(op)));assert.deepEqual(seen.map(x=>x[0]),['beginYNX','handleReturn','restore','disconnect']);assert(seen.every(x=>Object.keys(x[1]).join()==='requestId'));
 let publicInput;const publicClock=new clock.ClockControl({currentTime:async input=>{publicInput=input;return new Date('2026-10-14T00:00:00.000Z');}});await publicClock.read('restore');assert.deepEqual(Object.keys(publicInput),['requestId']);
 assert.equal(clock.isNetworkUnavailable(new clock.WalletAuthError('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN','PUBLIC')),true);
 assert(recovery.includes('this.#now("beginYNX")'));assert(recovery.includes('this.#now("handleReturn")'));assert(recovery.includes('this.#now("restore")'));assert(recovery.includes('this.#now("disconnect")'));assert(!recovery.includes('this.#now()'));
});

test('PUBLIC old Native bridge missing dispatch refuses instead of silently selecting HTTPS',()=>{
 globalThis.window={ynxDesktopWallet:{}};assert.throws(()=>mod.createProductWalletConnection(config()),{code:'ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED'});
 assert.equal(clock.isNetworkUnavailable(new clock.WalletAuthError('ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED','PUBLIC')),true);
});

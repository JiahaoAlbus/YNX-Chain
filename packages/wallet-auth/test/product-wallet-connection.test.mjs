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

// Exact normal recovery producer body, PUBLIC parser/authority/transport imports.
// These controls prove scheduling and storage ownership only: no actual Wallet,
// signature, Native custody, provider graph or service session is accepted.
const lifecycleRecovery=strip(process.env.YNX_PUBLIC_RETURN_SOURCE?readFileSync(process.env.YNX_PUBLIC_RETURN_SOURCE,'utf8'):read('product-session-recovery.js'));
const lifecycleStubs=`
const parseProductSessionRegistry=x=>x, productPlatformBinding=x=>x.binding;
const parseProductSessionRequest=(_r,x)=>{if(x.invalid)throw new WalletAuthError('INVALID_REQUEST','PUBLIC');return x;};
const parseProductSession=x=>{if(x.invalid)throw new WalletAuthError('SESSION_INACTIVE','PUBLIC');return x;};
const createProductSessionRequest=(r,input,now)=>({...r.binding,...input,issuedAt:now.toISOString(),expiresAt:'2026-10-15T00:00:00.000Z'});
const prepareWalletOpen=()=>({status:'ready',url:'PUBLIC://not-a-wallet'}),prepareWalletAttempt=prepareWalletOpen;
const walletConnectionChoices=()=>[];
const WALLET_ROUTE_STATUS={READY:'ready',USER_REJECTED:'user-rejected'};
const parseProductSessionReturnURL=()=>({status:'ready',approval:{PUBLIC:true}});
const parseCompletionRecord=(_r,raw)=>JSON.parse(raw);
const deriveCompletionTarget=(_r,raw)=>JSON.parse(raw).completion.PUBLICtarget;
const createRevocationIntent=(_b,_d,intentId,session)=>({intentId,session});
const parseRevocationIntent=raw=>JSON.parse(raw);
const revocationSessionMatches=(raw,session)=>raw===JSON.stringify(session);
const httpBodyDigest=()=> 'PUBLIC_no_hash';
const createProductSessionProofV2With=async()=>({nonce:'PUBLIC_proof_nonce_1234567890123456'});
const createProductSessionProofV2=()=>{throw Error('PUBLIC no crypto');};
const encodeProductSessionGatewayProofHeaderV2=()=> 'PUBLIC_no_proof';
const signProductSessionChallengeWith=async challenge=>{if(!globalThis.PUBLIC_RETURN_SIGN)throw Error('PUBLIC signing forbidden');return globalThis.PUBLIC_RETURN_SIGN(challenge);};
const signProductSessionChallenge=signProductSessionChallengeWith;
const parseProductSessionChallenge=x=>x;
const createProductSessionChallenge=()=>{if(!globalThis.PUBLIC_RETURN_CHALLENGE)throw Error('PUBLIC challenge path not selected');return globalThis.PUBLIC_RETURN_CHALLENGE;};
`;
const lifecycle=await import('data:text/javascript;base64,'+Buffer.from(canonical+'\n'+lifecycleStubs+'\n'+lifecycleRecovery).toString('base64'));
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function returnFixture(){
 const values=new Map(),writes=[],removes=[],hooks={};let token=0;
 const binding={productId:'PUBLIC',platform:'macos',applicationId:'PUBLIC',clientId:'PUBLIC',chainId:'PUBLIC',scopes:['PUBLIC']};
 const session={...binding,sessionBinding:'PUBLIC_OLD_SESSION',account:'PUBLIC_OLD_ACCOUNT',deviceId:'PUBLIC_device',deviceKey:'PUBLIC_key',issuedAt:'2026-10-14T00:00:00.000Z',expiresAt:'2026-10-15T00:00:00.000Z'};
 const request={...binding,deviceId:'PUBLIC_device',deviceKey:'PUBLIC_key',nonce:'PUBLIC_old_nonce_1234567890123456',state:'PUBLIC_old_state_1234567890123456',issuedAt:session.issuedAt,expiresAt:session.expiresAt};
 const completion={challenge:{deviceId:request.deviceId,deviceKey:request.deviceKey,sessionExpiresAt:session.expiresAt},PUBLICtarget:session};
 const storage={securityLevel:'os-protected',get:async k=>hooks.get?hooks.get(k):values.get(k)??null,set:async(k,v)=>{writes.push(k);if(hooks.set)return hooks.set(k,v);values.set(k,v);},remove:async k=>{removes.push(k);if(hooks.remove)return hooks.remove(k);values.delete(k);}};
 const gateway={currentTime:async()=>new Date(session.issuedAt),walletInstalled:()=>true,schemeRegistered:()=>true,challenge:()=>{throw Error('PUBLIC never sign');},complete:async()=>session,introspect:async()=>({active:true,session}),revoke:async()=>({revoked:true})};
 const client=new lifecycle.RecoverableProductSessionClient({registry:{binding},productId:'PUBLIC',platform:'macos',storage,gateway,device:{id:request.deviceId,key:request.deviceKey,sign:()=>{throw Error('PUBLIC never sign');},scopes:['PUBLIC'],purpose:'PUBLIC'},tokenFactory:()=> 'PUBLIC_'+String(++token).padStart(36,'0'),clock:()=>new Date(session.issuedAt)});
 const key=client.storageKey;values.set(key+':pending',JSON.stringify(request));values.set(key+':completion',JSON.stringify({request,approval:{PUBLIC:true},completion}));
 return {client,values,writes,removes,hooks,gateway,key,request,session,completion};
}
test('PUBLIC return lifecycle guest while pending read cannot replace guest or remove a newer return',async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();f.hooks.get=async k=>{if(k===f.key+':pending'){entered.resolve();return pending.promise;}return f.values.get(k)??null;};
 const old=f.client.handleReturn('PUBLIC_old_url');await entered.promise;f.client.enterGuest();f.values.set(f.key+':return','PUBLIC_new_return');pending.resolve(null);await old;
 assert.equal(f.client.current.status,'guest');assert.equal(f.values.get(f.key+':return'),'PUBLIC_new_return');
});
for(const cancel of ['guest','begin','network'])test(`PUBLIC return lifecycle ${cancel} during completion cannot store old session or clear current pending`,async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();f.gateway.complete=()=>{entered.resolve();return pending.promise;};
 const old=f.client.handleReturn('PUBLIC_old_url');await entered.promise;
 if(cancel==='guest')f.client.enterGuest();else if(cancel==='begin')await f.client.begin({walletInstalled:true,schemeRegistered:true});else f.client.setNetworkAvailable(false);
 const raw=f.values.get(f.key+':pending');pending.resolve(f.session);await old;assert.equal(f.writes.includes(f.key),false);assert.equal(f.values.get(f.key+':pending'),raw);assert.notEqual(f.client.current.status,'connected');
});
test('PUBLIC return lifecycle old completion rejection cannot clear new account-selection attempt',async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();f.gateway.complete=()=>{entered.resolve();return pending.promise;};const old=f.client.handleReturn('PUBLIC_old_url');await entered.promise;
 await f.client.begin({walletInstalled:true,schemeRegistered:true});const raw=f.values.get(f.key+':pending');pending.reject(new lifecycle.WalletAuthError('SESSION_INACTIVE','PUBLIC old rejection'));await old;
 assert.equal(f.values.get(f.key+':pending'),raw);assert.equal(f.client.current.status,'connecting');
});
test('PUBLIC return lifecycle restore rejection after network transition retains original protected session',async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();f.values.set(f.key,JSON.stringify(f.session));f.gateway.introspect=()=>{entered.resolve();return pending.promise;};const restoring=f.client.restore();await entered.promise;f.client.setNetworkAvailable(false);pending.reject(new lifecycle.WalletAuthError('SESSION_INACTIVE','PUBLIC'));await restoring;
 assert.equal(f.values.get(f.key),JSON.stringify(f.session));assert.equal(f.client.current.status,'network-unavailable');
});
test('PUBLIC return lifecycle superseded session write cannot clean new attempt; active callback still connects once',async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();f.hooks.set=async(k,v)=>{if(k===f.key){entered.resolve();await pending.promise;}f.values.set(k,v);};const old=f.client.handleReturn('PUBLIC_old_url');await entered.promise;
 const beginning=f.client.begin({walletInstalled:true,schemeRegistered:true});pending.resolve();await Promise.all([old,beginning]);assert.equal(f.client.current.status,'connecting');assert.equal(JSON.parse(f.values.get(f.key+':pending')).nonce===f.request.nonce,false);
 const valid=returnFixture();let completes=0;valid.gateway.complete=async()=>{completes++;return valid.session;};await Promise.all([valid.client.handleReturn('PUBLIC_same_url'),valid.client.handleReturn('PUBLIC_same_url')]);assert.equal(valid.client.current.status,'connected');assert.equal(completes,1);
});

test('PUBLIC return lifecycle obsolete account session is not restored over a new pending selection',async()=>{
 const f=returnFixture();f.values.set(f.key,JSON.stringify(f.session));await f.client.begin({walletInstalled:true,schemeRegistered:true});const raw=f.values.get(f.key+':pending');await f.client.restore();assert.equal(f.client.current.status,'connecting');assert.equal(f.values.get(f.key+':pending'),raw);assert.equal(f.values.get(f.key),JSON.stringify(f.session));
});
test('PUBLIC return lifecycle entered protected write failure retains issued result and original pending evidence',async()=>{
 const f=returnFixture();f.hooks.set=async(k,v)=>{f.values.set(k,v);if(k===f.key)throw Error('PUBLIC post-commit ACK lost');};await f.client.handleReturn('PUBLIC_url');assert.equal(f.client.current.status,'network-unavailable');assert.equal(f.values.get(f.key),JSON.stringify(f.session));assert.equal(f.values.has(f.key+':pending'),true);assert.equal(f.values.has(f.key+':completion'),true);
});
test('PUBLIC return lifecycle disconnect during completion cannot store old session or revive a revoked state',async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();let revokes=0;f.gateway.complete=()=>{entered.resolve();return pending.promise;};f.gateway.revoke=async()=>{revokes++;return {revoked:f.session.sessionBinding};};const returning=f.client.handleReturn('PUBLIC_url');await entered.promise;const disconnecting=f.client.disconnect();pending.resolve(f.session);await Promise.all([returning,disconnecting]);assert.equal(f.writes.includes(f.key),false);assert.equal(f.client.current.status,'disconnected');assert.equal(revokes,1);
});
test('PUBLIC return lifecycle cancelled signing result is reused only as original completion without a second signature',async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();f.values.delete(f.key+':completion');const challenge={...f.completion.challenge,issuedAt:f.session.issuedAt,expiresAt:f.session.expiresAt};globalThis.PUBLIC_RETURN_CHALLENGE=challenge;f.gateway.challenge=async()=>challenge;let signs=0;globalThis.PUBLIC_RETURN_SIGN=()=>{signs++;entered.resolve();return pending.promise;};
 try{const returning=f.client.handleReturn('PUBLIC_url');await entered.promise;f.client.enterGuest();pending.resolve(f.completion);await returning;assert.equal(f.client.current.status,'guest');assert.equal(f.values.has(f.key),false);await f.client.retry({walletInstalled:true,schemeRegistered:true});assert.equal(signs,1);assert.equal(f.client.current.status,'connected');}finally{delete globalThis.PUBLIC_RETURN_SIGN;delete globalThis.PUBLIC_RETURN_CHALLENGE;}
});
test('PUBLIC return lifecycle unknown signer entry cannot be re-signed on retry',async()=>{
 const f=returnFixture();f.values.delete(f.key+':completion');const challenge={...f.completion.challenge,issuedAt:f.session.issuedAt,expiresAt:f.session.expiresAt};globalThis.PUBLIC_RETURN_CHALLENGE=challenge;f.gateway.challenge=async()=>challenge;let signs=0;globalThis.PUBLIC_RETURN_SIGN=async()=>{signs++;throw Error('PUBLIC signer result unknown');};
 try{await f.client.handleReturn('PUBLIC_url');assert.equal(f.client.current.status,'network-unavailable');await f.client.retry({walletInstalled:true,schemeRegistered:true});assert.equal(signs,1);assert.equal(f.client.current.status,'network-unavailable');assert.equal(f.values.has(f.key+':pending'),true);}finally{delete globalThis.PUBLIC_RETURN_SIGN;delete globalThis.PUBLIC_RETURN_CHALLENGE;}
});

test('PUBLIC return lifecycle offline restore during completion invalidates old network write',async()=>{
 const f=returnFixture(),pending=gate(),entered=gate();f.gateway.complete=()=>{entered.resolve();return pending.promise;};const returning=f.client.handleReturn('PUBLIC_url');await entered.promise;await f.client.restore(false);pending.resolve(f.session);await returning;assert.equal(f.writes.includes(f.key),false);assert.equal(f.client.current.status,'network-unavailable');
});

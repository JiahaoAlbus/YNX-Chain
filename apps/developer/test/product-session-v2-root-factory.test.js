import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createProductWalletConnection, PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN } from "../vendor/wallet-auth-c5/src/product-wallet-connection.js";
import { canonicalJSON } from "../vendor/wallet-auth-c5/src/canonical.js";
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from "../vendor/wallet-auth-c5/src/product-session-gateway.js";
import vm from "node:vm";
import { createRequire } from "node:module";

const registry = JSON.parse(await readFile(new URL("../vendor/wallet-auth-c5/product-session-registry.json", import.meta.url), "utf8"));

// TEST_ONLY Native capability and SDK fixtures exercise the actual Developer
// wrapper's ownership; they grant no real device or protected service authority.
async function nativeRuntimeFixture(sdk) {
  const calls = [], timers = [];
  const device = { id: "TEST_ONLY", key: "TEST_ONLY_DEVICE", sign: async () => "TEST_ONLY", scopes: ["account:read", "developer:deploy"], purpose: "source fixture" };
  const bridge = { beginConnection: async () => { calls.push("consent"); return device; }, endConnection: async () => calls.push("end"), walletAvailability: async () => ({ walletInstalled: true, schemeRegistered: true }), protectedStorage: { get: async () => null, set: async () => {}, remove: async () => {} }, openAuthorization: async () => calls.push("open") };
  const ts = createRequire(import.meta.url)("../services/language-service/node_modules/typescript/lib/typescript.js");
  const code = ts.transpileModule(await readFile(new URL("../frontend/src/wallet/product-session-v2.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}, modules = {
    "./transport": { canonicalJSON, developerWalletV2Bridge: () => bridge, developerWalletV2Device: async () => { calls.push("device"); return device; } },
    "../../../vendor/wallet-auth-c5/src/product-wallet-connection.js": { PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN, createProductWalletConnection: config => { assert.equal(config.productId, "developer"); assert.equal(config.platform, "macos"); for (const key of ["endpoint", "origin", "callback", "clock", "transport", "session"]) assert.equal(Object.hasOwn(config, key), false); calls.push("factory"); return sdk; } },
    "../../../vendor/wallet-auth-c5/src/product-session-router.js": { walletConnectionChoices: () => [] },
    "../../../vendor/wallet-auth-c5/src/product-session-recovery.js": { PRODUCT_SESSION_CLIENT_STATE: {} },
    "../../../vendor/wallet-auth-c5/product-session-registry.json": registry,
  };
  vm.runInNewContext(code, { exports, require: id => { assert.ok(modules[id], id); return modules[id]; }, window: {}, Promise, Error, Symbol, setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout() {} });
  return { exports, calls, timers, bridge };
}

test("Developer Native inspection never provisions a device or requests consent", async () => {
  const f = await nativeRuntimeFixture({}); await f.exports.inspectDeveloperWalletV2Runtime(); assert.deepEqual(f.calls, []);
});

test("Developer Native return owns completion while the older opener is pending", async () => {
  let openReply, returnReply; const urls = [];
  const sdk = { beginYNX: () => new Promise(resolve => openReply = resolve), handleReturn: url => { urls.push(url); return new Promise(resolve => returnReply = resolve); }, setNetworkAvailable() {} };
  const f = await nativeRuntimeFixture(sdk), runtime = await f.exports.beginDeveloperWalletV2Connection();
  const begin = runtime.connection.beginYNX(); const returning = runtime.connection.handleReturn("ynxdeveloper://wallet-auth/callback?TEST_ONLY");
  await assert.rejects(runtime.connection.handleReturn("duplicate"), /pending Developer Wallet operation/);
  openReply({ status: "session-state" }); await begin; assert.equal(f.calls.filter(x => x === "end").length, 0);
  returnReply({ status: "session-state", sessionState: { status: "connected" } }); await returning; await runtime.finished;
  assert.deepEqual(urls, ["ynxdeveloper://wallet-auth/callback?TEST_ONLY"]); assert.equal(f.calls.filter(x => x === "end").length, 1);
});

test("an older opener failure preserves the pending Native return and its original error", async () => {
  let rejectOpen, returnReply;
  const sdk = { beginYNX: () => new Promise((_, reject) => rejectOpen = reject), handleReturn: () => new Promise(resolve => returnReply = resolve), setNetworkAvailable() {} };
  const f = await nativeRuntimeFixture(sdk), runtime = await f.exports.beginDeveloperWalletV2Connection();
  const opening = runtime.connection.beginYNX(), returning = runtime.connection.handleReturn("TEST_ONLY_RETURN"), error = Error("original opener error");
  const observed = assert.rejects(opening, actual => actual === error); rejectOpen(error); await observed; assert.equal(f.calls.filter(x => x === "end").length, 0);
  returnReply({ status: "session-state" }); await returning; assert.equal(f.calls.filter(x => x === "end").length, 1);
});

test("Developer Native expiration fences a late opener and permits explicit retry", async () => {
  let reply; const network = [];
  const sdk = { beginYNX: () => new Promise(resolve => reply = resolve), setNetworkAvailable: value => network.push(value) };
  const f = await nativeRuntimeFixture(sdk), runtime = await f.exports.beginDeveloperWalletV2Connection(); const pending = runtime.connection.beginYNX();
  assert.equal(f.timers[0].ms, 300_000); f.timers[0].fn(); await runtime.finished; assert.deepEqual(network, [false]);
  reply({ status: "wallet-opened" }); await pending; await assert.rejects(runtime.connection.beginYNX(), /Explicit native/);
  const retry = await f.exports.beginDeveloperWalletV2Connection(); assert.equal(f.calls.filter(x => x === "consent").length, 2); await retry.endNativeOperation();
});

test("accepted Wallet v2 root factory fails closed for an absent Wallet and preserves explicit Guest limits", async () => {
  const stored = new Map();
  const connection = createProductWalletConnection({
    registry,
    productId: "developer",
    platform: "macos",
    walletInstalled: async () => false,
    schemeRegistered: async () => false,
    gatewayTimeoutMs: 10_000,
    storage: { securityLevel: "os-protected", get: async (key) => stored.get(key) ?? null, set: async (key, value) => void stored.set(key, value), remove: async (key) => void stored.delete(key) },
    device: { id: "developer-test-device", key: "A".repeat(44), scopes: ["account:read", "developer:deploy"], purpose: "root factory test", sign: async () => "MEQCIA" },
    scope: globalThis,
    discoveryWaitMs: 0,
    openWallet: async () => ({ opened: false, code: "WALLET_NOT_INSTALLED" }),
    openTimeoutMs: 10_000,
  });
  const options = await connection.options();
  assert.equal(PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN, "https://wallet-auth.ynxweb4.com");
  assert.equal(options.availability.ynxWalletInstalled, false);
  assert.ok(options.choices.some((choice) => choice.id === "download-ynx-wallet" && choice.action === "download" && choice.authoritative === true));
  const guest = connection.enterGuest();
  assert.equal(guest.sessionState.status, "guest");
  assert.deepEqual(guest.sessionState.limitations, ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"]);
});

test("accepted Wallet v2 root factory opens only a populated canonical authorization request", async () => {
  // TEST_ONLY authority-time response: no live gateway, approved identity,
  // private producer or actual Wallet is provided by this source fixture.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN + "/v2/product-sessions/time");
    assert.equal(init.method, "GET");
    const requestId = init.headers["x-request-id"];
    return new Response(canonicalJSON({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, ok: true, requestId, result: { serverTime: "2026-10-14T08:00:00.000Z" } }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId } });
  };
  try {
  const stored = new Map();
  const deviceKey = "A2sX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKW";
  let opened;
  const connection = createProductWalletConnection({
    registry,
    productId: "developer",
    platform: "macos",
    walletInstalled: async () => true,
    schemeRegistered: async () => true,
    gatewayTimeoutMs: 10_000,
    storage: { securityLevel: "os-protected", get: async (key) => stored.get(key) ?? null, set: async (key, value) => void stored.set(key, value), remove: async (key) => void stored.delete(key) },
    device: { id: "developer-test-device", key: deviceKey, scopes: ["account:read", "developer:deploy"], purpose: "root factory canonical request test", sign: async () => "MEQCIA" },
    scope: globalThis,
    discoveryWaitMs: 0,
    openWallet: async (input) => { opened = input; return { opened: true }; },
    openTimeoutMs: 10_000,
  });
  const state = await connection.beginYNX();
  assert.equal(state.status, "wallet-opened");
  assert.match(opened.url, /^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]{80,8192}$/);
  const encoded = new URL(opened.url).searchParams.get("request");
  const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(request.version, "2");
  assert.equal(request.chainId, "ynx_6423-1");
  assert.equal(request.productId, "developer");
  assert.equal(request.clientId, "ynx-developer-v1");
  assert.equal(request.platform, "macos");
  assert.equal(request.callback, "ynxdeveloper://wallet-auth/callback");
  assert.equal(request.deviceKey, deviceKey);
  assert.match(request.nonce, /^[A-Za-z0-9_-]{32,64}$/);
  assert.match(request.state, /^[A-Za-z0-9_-]{32,64}$/);
  assert.deepEqual(request.scopes, ["account:read", "developer:deploy"]);
  assert.ok(Date.parse(request.expiresAt) > Date.parse(request.issuedAt));
  } finally { globalThis.fetch = originalFetch; }
});

// Exact normal recovery producer body, PUBLIC parser/authority/transport imports.
// These controls prove scheduling and storage ownership only: no actual Wallet,
// signature, Native custody, provider graph or service session is accepted.
const strip = s => s.replace(/^import .*;\n/gm, '');
const canonical = strip(await readFile(new URL('../vendor/wallet-auth-c5/src/canonical.js', import.meta.url), 'utf8'));
const lifecycleRecovery = strip(await readFile(new URL('../vendor/wallet-auth-c5/src/product-session-recovery.js', import.meta.url), 'utf8'));
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

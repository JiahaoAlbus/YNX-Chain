import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionReturnURL, httpBodyDigest, PRODUCT_SESSION_CLIENT_STATE, ProductSessionAuthority, RecoverableProductSessionClient, signProductSessionApproval, verifyProductSessionProofV2, WALLET_CONNECTION_COORDINATOR_STATUS,
  WalletAuthError, WalletConnectionCoordinator,
} from "../src/index.js";
import * as coordinatorSubpath from "@ynx-chain/wallet-auth/wallet-connection-coordinator";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const secret = Buffer.alloc(32, 11);
const key = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
function token(value) { return createHash("sha256").update(value).digest("base64url"); }
function memory() { const values = new Map(); return { securityLevel:"os-protected", async get(k){return values.get(k)??null}, async set(k,v){values.set(k,v)}, async remove(k){values.delete(k)}, values }; }
function gateway(overrides = {}) { return { async walletInstalled(){return true}, async schemeRegistered(){return true}, async challenge(){throw new Error("not used")}, async complete(){throw new Error("not used")}, async introspect(){throw new Error("not used")}, async revoke(){throw new Error("not used")}, ...overrides }; }
function client(productId = "social", gatewayValue = gateway(), storage = memory(), tokenFactory = null, registryInput = registry, platform = "web") {
  let index = 0;
  const product = registryInput.products.find((item) => item.productId === productId);
  return new RecoverableProductSessionClient({ registry:registryInput, productId, platform, storage, gateway:gatewayValue, device:{id:`${productId}-device-001`,key,secret:secret.toString("base64url"),scopes:[...product.scopes],purpose:`Connect ${productId} through the canonical coordinator.`},tokenFactory:tokenFactory??(()=>token(`${productId}-${index++}`)),clock:()=>NOW });
}
function ynxProvider() { return {isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet.companion"},async request(){throw new Error("YNX provider request is not used for Product Session deep links")}}; }
function metaMaskProvider(calls = []) { return {isMetaMask:true,providerInfo:{rdns:"io.metamask"},async request(input){calls.push(input);if(input.method==="eth_chainId")return"0x1917";if(input.method==="eth_requestAccounts")return["0x1234567890abcdef1234567890abcdef12345678"];throw new Error("unexpected method")}}; }
function coordinator({registry: registryInput=registry,productId="social",sessionClient=client(productId),scope={},openWallet=async()=>({opened:true}),openTimeoutMs=1000}={}) { return new WalletConnectionCoordinator({registry:registryInput,productId,sessionClient,scope,discoveryWaitMs:0,openWallet,openTimeoutMs}); }
function noYNXClient(productId) { return client(productId,gateway({async walletInstalled(){return false},async schemeRegistered(){return false}})); }

test("coordinator package subpath exposes only the shared coordinator surface", () => {
  assert.equal(coordinatorSubpath.WalletConnectionCoordinator, WalletConnectionCoordinator);
  assert.equal(Object.hasOwn(coordinatorSubpath,"ProductSessionGatewayKernel"),false);
});

test("coordinator rejects a non-YNX native callback before it can open Wallet", () => {
  const altered = structuredClone(registry);
  const social = altered.products.find((item) => item.productId === "social");
  social.nativeCallback = "ftp://com.ynx.social/wallet-auth/callback";
  social.legacyCallbacks = [social.nativeCallback];
  const sessionClient = client("social", gateway(), memory(), null, altered, "android");
  assert.throws(() => coordinator({ registry: altered, sessionClient }), code("INVALID_CALLBACK_SCHEME"));
});

test("begin uses detected YNX environment and opens only the canonical registered route", async () => {
  const opened=[]; const value=coordinator({scope:{ethereum:ynxProvider()},openWallet:async(input)=>{opened.push(input);return{opened:true}}});
  const result=await value.beginYNX();
  assert.equal(result.status,WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED);
  assert.equal(result.sessionState.status,PRODUCT_SESSION_CLIENT_STATE.CONNECTING);
  assert.match(result.url,/^ynxwallet:\/\/authorize\?request=/);
  assert.match(result.requestId,/^req_ps_open_[A-Za-z0-9_-]{32,64}$/);
  assert.equal(opened.length,1);assert.equal(opened[0].url,result.url);assert.equal(opened[0].automatic,false);
  assert.equal(Object.isFrozen(opened[0]),true);
});

test("concurrent connection starts share one pending request and one Wallet opener", async () => {
  const opened=[];
  let tokenCalls=0;
  let releaseOpen;
  const opening = new Promise((resolve) => { releaseOpen = resolve; });
  const sessionClient=client("social", gateway(), memory(), () => token(`coordinator-single-flight-${tokenCalls++}`));
  const value=coordinator({sessionClient,scope:{ethereum:ynxProvider()},openWallet:async(input)=>{opened.push(input);await opening;return{opened:true}}});
  const first=value.beginYNX();
  const second=value.beginYNX();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened.length,1);
  releaseOpen();
  const [firstResult,secondResult]=await Promise.all([first,second]);
  assert.equal(firstResult.status,WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED);
  assert.equal(secondResult.status,WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED);
  assert.equal(firstResult,secondResult);
  assert.equal(firstResult.sessionState.request.nonce,secondResult.sessionState.request.nonce);
  assert.equal(tokenCalls,2);
  assert.equal(opened.length,1);
});

test("a callback in flight fences a repeated Begin and cannot be replaced by a new pending request", async () => {
  const authority = new ProductSessionAuthority(registry);
  let releaseChallenge;
  let markChallengeStarted;
  const challengeStarted = new Promise((resolve) => { markChallengeStarted = resolve; });
  const challengeGate = new Promise((resolve) => { releaseChallenge = resolve; });
  let challengeIndex = 0;
  const sessionGateway = gateway({
    async challenge({ requestId, request, approval }) {
      assert.match(requestId, /^req_ps_c_[A-Za-z0-9_-]{32,64}$/);
      markChallengeStarted();
      await challengeGate;
      return authority.issueChallenge({ request, approval, challenge: token(`coordinator-callback-race-${challengeIndex++}`) }, NOW);
    },
    async complete({ requestId, ...input }) {
      assert.match(requestId, /^req_ps_f_[A-Za-z0-9_-]{32,64}$/);
      return authority.complete(input, NOW);
    },
    async introspect({ requestId, sessionBinding, requiredScopes, proof }) {
      assert.match(requestId, /^req_ps_i_[A-Za-z0-9_-]{32,64}$/);
      const session = authority.snapshot().sessions.find((item) => item.sessionBinding === sessionBinding);
      if (!session) throw new WalletAuthError("SESSION_NOT_FOUND", "missing test session");
      verifyProductSessionProofV2(proof, session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON({ requiredScopes })) }, NOW);
      return authority.introspect(sessionBinding, { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes }, NOW);
    },
  });
  const opened = [];
  let tokenCalls = 0;
  const sessionClient = client("social", sessionGateway, memory(), () => token(`coordinator-callback-token-${tokenCalls++}`));
  const value = coordinator({ sessionClient, scope: { ethereum: ynxProvider() }, openWallet: async (input) => { opened.push(input); return { opened: true }; } });
  const first = await value.beginYNX();
  const approval = signProductSessionApproval(registry, first.sessionState.request, { accountSecret: "1".padStart(64, "0"), scopes: first.sessionState.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, first.sessionState.request, { result: "approved", approval }, NOW);
  const returning = value.handleReturn(callback);
  await challengeStarted;
  const repeatedBegin = value.beginYNX();
  releaseChallenge();
  const [returned, repeated] = await Promise.all([returning, repeatedBegin]);
  assert.equal(returned.sessionState.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(repeated.status, WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE);
  assert.equal(repeated.sessionState.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(opened.length, 1);
  assert.equal(tokenCalls, 3);
  assert.equal(value.current.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
});

test("second-launch controlled reconnect opens at most once before explicit Retry", async () => {
  let opens=0; const value=coordinator({scope:{ethereum:ynxProvider()},openWallet:async()=>{opens+=1;return{opened:true}}});
  const first=await value.restore(true);
  assert.equal(first.status,WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED);
  assert.equal(first.automatic,true);
  assert.equal(opens,1);
  const second=await value.restore(true);
  assert.equal(second.status,WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE);
  assert.equal(second.sessionState.status,PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(opens,1);
});

test("platform opener failures become actionable states without a fake session", async () => {
  for(const [code,actions] of [["WALLET_NOT_INSTALLED",["download","guest","return-to-product"]],["SCHEME_NOT_REGISTERED",["download","retry","return-to-product"]],["USER_REJECTED",["guest","retry","return-to-product"]]]){
    const value=coordinator({openWallet:async()=>({opened:false,code})});
    const result=await value.beginYNX();
    assert.equal(result.status,WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPEN_FAILED);
    assert.equal(result.code,code);assert.deepEqual(result.actions,actions);assert.equal("session" in result,false);
  }
  const hostile=coordinator({openWallet:async()=>({opened:true,session:"fake"})});
  assert.equal((await hostile.beginYNX()).status,WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPEN_FAILED);
  const leaking=await coordinator({openWallet:async()=>{throw new Error("secret platform exception")}}).beginYNX();
  assert.equal(leaking.code,"WALLET_OPEN_FAILED");assert.equal(leaking.message.includes("secret"),false);
  const timeout=coordinator({openWallet:async()=>new Promise(()=>{}),openTimeoutMs:10});
  const timedOut=await timeout.beginYNX();assert.equal(timedOut.code,"WALLET_OPEN_TIMEOUT");assert.deepEqual(timedOut.actions,["retry","return-to-product"]);
});

test("detected environment rejects malformed or failed platform probes", async () => {
  const malformed=client("social",gateway({async walletInstalled(){return"yes"}}));
  await assert.rejects(()=>malformed.detectWalletEnvironment(),code("INVALID_GATEWAY_RESPONSE"));
  const failed=client("social",gateway({async schemeRegistered(){throw new Error("system detail")}}));
  await assert.rejects(()=>failed.detectWalletEnvironment(),code("WALLET_UNAVAILABLE"));
});

test("coordinator converts a Wallet availability probe failure into an actionable fail-closed state", async () => {
  const sessionClient = client("social", gateway({ async schemeRegistered() { throw new Error("private platform detail"); } }));
  const result = await coordinator({ sessionClient }).beginYNX();
  assert.equal(result.status, WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE);
  assert.equal(result.sessionState.status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(result.sessionState.code, "WALLET_UNAVAILABLE");
  assert.deepEqual(result.sessionState.actions, ["retry", "guest"]);
  assert.equal(result.sessionState.message.includes("private platform detail"), false);
  assert.equal(sessionClient.current.status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
});

test("MetaMask connects through central discovery only when YNX is absent and product is EVM compatible", async () => {
  const calls=[];const metamask=metaMaskProvider(calls);const value=coordinator({productId:"dex",sessionClient:noYNXClient("dex"),scope:{ethereum:metamask}});
  const result=await value.connectMetaMask();
  assert.equal(result.status,WALLET_CONNECTION_COORDINATOR_STATUS.EVM_CONNECTED);
  assert.equal(result.connection.ynxProductSession,false);
  assert.equal(result.connection.authority,"eip-1193-provider-only");
  assert.deepEqual(calls.map(({method})=>method),["eth_chainId","eth_requestAccounts"]);
});

test("native platform detection is merged with injected discovery and preserves YNX priority", async () => {
  const calls=[];const value=coordinator({productId:"dex",sessionClient:client("dex"),scope:{ethereum:metaMaskProvider(calls)}});
  const options=await value.options();
  assert.deepEqual(options.environment,{walletInstalled:true,schemeRegistered:true});
  assert.deepEqual(options.availability,{ynxWalletInstalled:true,metaMaskAvailable:true});
  assert.deepEqual(options.choices.map(({id})=>id),["ynx-wallet","guest"]);
  assert.equal((await value.connectMetaMask()).status,WALLET_CONNECTION_COORDINATOR_STATUS.YNX_WALLET_PREFERRED);
  assert.equal(calls.length,0);
});

test("YNX priority, ambiguous MetaMask, missing MetaMask and non-EVM products all fail closed", async () => {
  const calls=[];const metamask=metaMaskProvider(calls);
  const preferred=coordinator({productId:"dex",sessionClient:noYNXClient("dex"),scope:{ethereum:{providers:[metamask,ynxProvider()]}}});
  assert.equal((await preferred.connectMetaMask()).status,WALLET_CONNECTION_COORDINATOR_STATUS.YNX_WALLET_PREFERRED);assert.equal(calls.length,0);
  const ambiguous=coordinator({productId:"dex",sessionClient:noYNXClient("dex"),scope:{ethereum:{providers:[metaMaskProvider(),metaMaskProvider()]}}});
  const ambiguousResult=await ambiguous.connectMetaMask();assert.equal(ambiguousResult.code,"AMBIGUOUS_WALLET_PROVIDER");assert.equal(ambiguousResult.status,WALLET_CONNECTION_COORDINATOR_STATUS.EVM_UNAVAILABLE);
  const missing=await coordinator({productId:"dex",sessionClient:noYNXClient("dex")}).connectMetaMask();
  assert.equal(missing.code,"WALLET_PROVIDER_NOT_INJECTED");assert.equal(new URL(missing.downloadUrl).hostname,"metamask.io");
  assert.deepEqual(missing.actions,["unlock-extension","grant-site-access","enable-extension","retry","download-metamask","guest","return-to-product"]);
  const nonEvm=await coordinator({sessionClient:noYNXClient("social"),scope:{ethereum:metaMaskProvider()}}).connectMetaMask();
  assert.equal(nonEvm.code,"EVM_NOT_SUPPORTED");assert.equal(nonEvm.status,WALLET_CONNECTION_COORDINATOR_STATUS.EVM_UNAVAILABLE);
});

test("coordinator rejects cross-product clients, fake clients and invalid platform adapters", () => {
  assert.throws(()=>coordinator({productId:"dex",sessionClient:client("social")}),code("CROSS_PRODUCT_REUSE"));
  assert.throws(()=>new WalletConnectionCoordinator({registry,productId:"social",sessionClient:{},scope:{},discoveryWaitMs:0,openWallet:async()=>({opened:true}),openTimeoutMs:1000}),code("CROSS_PRODUCT_REUSE"));
  assert.throws(()=>new WalletConnectionCoordinator({registry,productId:"social",sessionClient:client(),scope:null,discoveryWaitMs:0,openWallet:async()=>({opened:true}),openTimeoutMs:1000}),code("INVALID_WALLET_SCOPE"));
  assert.throws(()=>new WalletConnectionCoordinator({registry,productId:"social",sessionClient:client(),scope:{},discoveryWaitMs:0,openWallet:null,openTimeoutMs:1000}),code("INVALID_WALLET_OPENER"));
  assert.throws(()=>new WalletConnectionCoordinator({registry,productId:"social",sessionClient:client(),scope:{},discoveryWaitMs:0,openWallet:async()=>({opened:true}),openTimeoutMs:0}),code("INVALID_WALLET_OPENER"));
});

test("Guest mode remains explicit and never contains connection authority", () => {
  const guest=coordinator().enterGuest();
  assert.equal(guest.sessionState.status,PRODUCT_SESSION_CLIENT_STATE.GUEST);
  assert.deepEqual(guest.sessionState.limitations,["not-signed-in","no-wallet-balance","no-transactions","no-chain-authority"]);
  assert.equal("session" in guest.sessionState,false);
});

function code(expected){return(error)=>error instanceof WalletAuthError&&error.code===expected}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ProductSessionServerAuthorizer } from "../src/product-session-server.js";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { RecoverableProductSessionClient } from "../src/product-session-recovery.js";
import { createProductSessionReturnURL } from "../src/product-session-router.js";
import { signProductSessionApproval } from "../src/product-session-v2.js";
import { ProductSessionGatewayFetchAdapter, decodeProductSessionGatewayProofHeaderV2 } from "../src/product-session-gateway-client.js";
import { ProductSessionGatewayHttpHandler } from "../src/product-session-gateway-http.js";
import { verifyProductSessionProofV2 } from "../src/product-session-proof-v2.js";
import { httpBodyDigest } from "../src/session-proof.js";
import { createRevocationIntent } from "../src/product-session-revocation-intent.js";
import { productPlatformBinding } from "../src/product-session-registry.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-12T00:00:00.000Z");
const scopes = ["account:read", "profile:link"];
const deviceSecret = Buffer.alloc(32, 9), accountSecret = "1".padStart(64, "0");
const options = { timeout: 3000 };
const token = label => createHash("sha256").update(label).digest("base64url");
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Real local protocol, signatures and Gateway parser with fixed test keys only.
// The protected Map and fetch are synthetic: no OS/device/public service is used.
function harness(platform="android") {
  const values = new Map(), calls = [], hooks = {}, time = { now: NOW };
  let sequence = 0;
  const storage = {
    securityLevel: "os-protected",
    async get(key) { calls.push(["get", key]); return hooks.get ? hooks.get(key, () => values.get(key) ?? null) : values.get(key) ?? null; },
    async set(key, value) { calls.push(["set", key]); values.set(key, value); },
    async remove(key) { calls.push(["remove", key]); values.delete(key); },
  };
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`introspection-handler-${sequence++}`));
  const gateway = new ProductSessionGatewayFetchAdapter({
    endpoint: "https://wallet-auth.ynxweb4.com", timeoutMs: 1000,
    walletInstalled: async () => { calls.push(["probe"]); return true; }, schemeRegistered: async () => { calls.push(["probe"]); return true; },
    async fetch(url, input) {
      const path = new URL(url).pathname; calls.push(["gateway", path]);
      if (path === "/v2/product-sessions/time") return new Response(canonicalJSON({ ok: true, requestId: input.headers["x-request-id"], result: { serverTime: time.now.toISOString() }, schemaVersion: 2 }), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": input.headers["x-request-id"] } });
      const result = handler.handle({ requestId: input.headers["x-request-id"], method: input.method, path, contentType: input.headers["content-type"], body: input.body, proofHeader: input.headers["x-ynx-product-session-proof-v2"] ?? null, networkAvailable: true }, time.now);
      return new Response(result.body, { status: result.status, headers: result.headers });
    },
  });
  const device = {
    id: "introspection-fixture-device", key: Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url"), scopes, purpose: "Connect the fixed local introspection-proof fixture.",
    async sign(input) {
      calls.push(["sign", input.purpose]); if (hooks.sign) await hooks.sign(input);
      return Buffer.from(p256.sign(Buffer.from(input.payload, "base64url"), deviceSecret, { format: "der" })).toString("base64url");
    },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform, storage, gateway, device, tokenFactory: () => token(`introspection-client-${sequence++}`), clock: () => { calls.push(["local-clock"]); return new Date("2040-01-01T00:00:00.000Z"); } });
  return { client, storage, values, calls, hooks, handler, gateway, device, time, key: client.storageKey };
}
async function connected(platform="android") {
  const setup = harness(platform), pending = await setup.client.beginExplicit();
  const approval = signProductSessionApproval(registry, pending.request, { accountSecret, scopes, expiresAt: pending.request.expiresAt }, NOW);
  const state = await setup.client.handleReturn(createProductSessionReturnURL(registry, pending.request, { result: "approved", approval }, NOW));
  assert.equal(state.status, "connected");
  const raw = setup.values.get(setup.key); setup.calls.length = 0;
  return { ...setup, session: state.session, raw };
}

async function serverFixture(options={}) {
  const setup=await connected(options.sessionPlatform??"android"), requests=[];
  const config={registry,productId:"social",platform:"android",endpoint:"https://wallet-auth.ynxweb4.com",timeoutMs:1000,clock:()=>setup.time.now,...options};
  config.fetch=async(url,input)=>{
    requests.push({url,input});
    if(options.failure)throw new Error("synthetic upstream failure");
    const result=setup.handler.handle({requestId:input.headers["x-request-id"],method:input.method,path:new URL(url).pathname,contentType:input.headers["content-type"],body:input.body,proofHeader:input.headers["x-ynx-product-session-proof-v2"]??null,networkAvailable:true},setup.time.now);
    let body=JSON.parse(result.body);if(options.mutate)body=options.mutate(body);
    if(options.after)options.after(setup);
    return new Response(JSON.stringify(body),{status:result.status,headers:result.headers});
  };
  delete config.failure;delete config.mutate;delete config.after;delete config.sessionPlatform;
  const authorizer=new ProductSessionServerAuthorizer(config), issued=await setup.client.createIntrospectionProof(["account:read"]);
  const input={proofHeader:issued.proofHeader,origin:null,method:"POST",path:"/api/profile",requiredScopes:["account:read"]};
  return {...setup,requests,authorizer,input,issued};
}

test("server consumes the native SDK proof once at the configured authority and returns the live bound session",async()=>{
  const f=await serverFixture();
  assert.deepEqual(await f.authorizer.authorize(f.input),f.session);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,"https://wallet-auth.ynxweb4.com/v2/product-sessions/introspect");
  assert.equal(f.requests[0].input.body,f.issued.body);
  assert.equal(f.requests[0].input.headers["x-ynx-product-session-proof-v2"],f.issued.proofHeader);
  assert.equal(f.requests[0].input.headers.cookie,undefined);
  await assert.rejects(()=>f.authorizer.authorize(f.input),{code:"REPLAY"});
  assert.equal(f.requests.length,2);assert.notEqual(f.requests[0].input.headers["x-request-id"],f.requests[1].input.headers["x-request-id"]);
});

test("server route scopes and product origin are enforced before contacting the authority",async()=>{
  const f=await serverFixture();
  for(const patch of [{origin:"https://attacker.example"},{requiredScopes:[]},{requiredScopes:["unknown"]},{requiredScopes:["account:read","account:read"]},{requiredScopes:["profile:link","account:read"]},{requiredScopes:["profile:link"]},{method:"TRACE"},{path:"https://attacker.example"},{proofHeader:"invalid"}])await assert.rejects(()=>f.authorizer.authorize({...f.input,...patch}));
  assert.equal(f.requests.length,0);
});

test("wrong server product never consumes the supplied proof",async()=>{
  const f=await serverFixture({productId:"card"});
  await assert.rejects(()=>f.authorizer.authorize(f.input),{code:"CROSS_PRODUCT_SESSION"});assert.equal(f.requests.length,0);
});

test("web routes reject a missing Origin",async()=>{
  const f=await serverFixture({platform:"web"});
  await assert.rejects(()=>f.authorizer.authorize(f.input),{code:"ORIGIN_MISMATCH"});assert.equal(f.requests.length,0);
});

test("web GET may omit Origin but still needs the exact signed web session and an unconsumed proof",async()=>{
  const f=await serverFixture({platform:"web",sessionPlatform:"web"});
  for(const patch of [{method:"GET",origin:"https://attacker.example"},{method:"GET",proofHeader:""},{method:"POST"},{method:"PUT"}])await assert.rejects(()=>f.authorizer.authorize({...f.input,...patch}));
  assert.equal(f.requests.length,0);
  const input={...f.input,method:"GET"};
  assert.deepEqual(await f.authorizer.authorize(input),f.session);
  await assert.rejects(()=>f.authorizer.authorize(input),{code:"REPLAY"});
  const native=await serverFixture({platform:"web"});
  await assert.rejects(()=>native.authorizer.authorize({...native.input,method:"GET"}),{code:"CROSS_PRODUCT_SESSION"});assert.equal(native.requests.length,0);
});

test("upstream failure is not retried and never authorizes a business operation",async()=>{
  const f=await serverFixture({failure:true});let business=0;
  await assert.rejects(async()=>{await f.authorizer.authorize(f.input);business++});
  assert.equal(f.requests.length,1);assert.equal(business,0);
});

for(const [name,mutate] of Object.entries({inactive:b=>({...b,result:{...b.result,active:false}}),account:b=>({...b,result:{...b.result,session:{...b.result.session,account:ynxAccountOther()}}}),device:b=>({...b,result:{...b.result,session:{...b.result.session,deviceId:"other-device"}}}),scope:b=>({...b,result:{...b.result,session:{...b.result.session,scopes:["profile:link"]}}}),extra:b=>({...b,result:{...b.result,extra:true}})}))test(`${name} live result cannot authorize a request`,async()=>{
  const f=await serverFixture({mutate});await assert.rejects(()=>f.authorizer.authorize(f.input));assert.equal(f.requests.length,1);
});
function ynxAccountOther(){return "ynx1invalid"}

test("expiry and clock reversal during authority response fail closed",async()=>{
  for(const delta of [31_000,-1]){
    const f=await serverFixture({after:setup=>{setup.time.now=new Date(NOW.getTime()+delta)}});
    await assert.rejects(()=>f.authorizer.authorize(f.input));assert.equal(f.requests.length,1);
  }
  const f=await serverFixture();f.time.now=new Date(NOW.getTime()+31_000);
  await assert.rejects(()=>f.authorizer.authorize(f.input),{code:"SESSION_EXPIRED"});assert.equal(f.requests.length,0);
});

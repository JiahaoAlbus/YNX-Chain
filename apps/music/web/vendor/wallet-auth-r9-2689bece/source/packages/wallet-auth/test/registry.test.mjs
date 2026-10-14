import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { centralRegisteredWebOrigins, centralRegistrationByProduct, migrateCentralRegistryDocumentV1, parseCentralRegistryDocument, WalletAuthError } from "../src/index.js";

const source = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));

test("central candidate contains exactly 26 unique, least-privilege, disabled products", () => {
  const registry = parseCentralRegistryDocument(source);
  assert.equal(registry.products.length, 26);
  assert.equal(registry.products.every((product) => product.reviewState === "pending-review" && !product.enabled), true);
  assert.equal(registry.products.every((product) => product.scopes.length <= product.maxScopes && product.scopes.every((scope) => !scope.includes("*"))), true);
  assert.throws(() => centralRegistrationByProduct(registry, "social"), code("REGISTRY_DISABLED"));
  assert.equal(centralRegistrationByProduct(registry, "social", { requireEnabled: false }).bundleId, "com.ynx.social");
  assert.deepEqual(centralRegistrationByProduct(registry, "quant", { requireEnabled: false }).scopes, ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"]);
});

test("registry v1 migrates deterministically by adding disabled least-privilege Quant", () => {
  const legacy = structuredClone(source);
  legacy.registryVersion = 1;
  legacy.products = legacy.products.filter(product => product.productId !== "quant");
  const migrated = migrateCentralRegistryDocumentV1(legacy);
  assert.deepEqual(migrated.products.map(product => product.productId), parseCentralRegistryDocument(source).products.map(product => product.productId));
  assert.equal(centralRegistrationByProduct(migrated, "quant", { requireEnabled: false }).enabled, false);
  const tampered = structuredClone(legacy);
  tampered.products[0].productId = "unknown-replacement";
  assert.throws(() => migrateCentralRegistryDocumentV1(tampered), code("INVALID_REGISTRY"));
});

test("central registry rejects enablement without approval and identity tamper", () => {
  const enabled = structuredClone(source); enabled.products[0].enabled = true;
  assert.throws(() => parseCentralRegistryDocument(enabled), code("INVALID_REGISTRY"));
  const mismatch = structuredClone(source); mismatch.products[0].productClientId = mismatch.products[1].productClientId;
  assert.throws(() => parseCentralRegistryDocument(mismatch), code("INVALID_REGISTRY"));
  const wildcard = structuredClone(source); wildcard.products[0].scopes = ["ai:*"]; wildcard.products[0].maxScopes = 1;
  assert.throws(() => parseCentralRegistryDocument(wildcard), code("INVALID_REGISTRY"));
});

test("registry v4 binds exact HTTPS web origins and migrates to v5 without inferred browser access", () => {
  const v4 = structuredClone(source);
  for (const product of v4.products) { product.schemaVersion = 4; product.webOrigins = []; }
  const social = v4.products.find(product => product.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  social.webOrigins = ["https://social.ynxweb4.com"];
  const parsed = parseCentralRegistryDocument(v4);
  assert.equal(parsed.products.find(product => product.productId === "social").schemaVersion, 5);
  assert.deepEqual(centralRegisteredWebOrigins(parsed), ["https://social.ynxweb4.com"]);
  assert.deepEqual(centralRegisteredWebOrigins(source), []);
  const insecure = structuredClone(v4);
  insecure.products.find(product => product.productId === "social").webOrigins = ["http://social.ynxweb4.com"];
  assert.throws(() => parseCentralRegistryDocument(insecure), code("INVALID_REGISTRY"));
  const path = structuredClone(v4);
  path.products.find(product => product.productId === "social").webOrigins = ["https://social.ynxweb4.com/callback"];
  assert.throws(() => parseCentralRegistryDocument(path), code("INVALID_REGISTRY"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }

// Product Session permissions are separate from the disabled legacy central registry.
const productRegistry = JSON.parse(readFileSync(new URL('../product-session-registry.json', import.meta.url), 'utf8'));
test('Paper workspace is a fresh Quant-only grant and cannot widen existing account or records approvals', async () => {
  const {createProductSessionRequest,signProductSessionApproval,parseProductSessionApproval}=await import('../src/product-session-v2.js');
  const {p256}=await import('@noble/curves/nist.js');
  const at=new Date('2026-10-01T00:00:00.000Z');
  const input={productId:'quant',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(Buffer.alloc(32,7),true)).toString('base64url'),scopes:['quant:paper:workspace'],purpose:'Simulated Paper workspace; no real money.',nonce:'b'.repeat(43),state:'c'.repeat(43)};
  const request=createProductSessionRequest(productRegistry,input,at);
  const approval=signProductSessionApproval(productRegistry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},at);
  assert.deepEqual(parseProductSessionApproval(productRegistry,request,approval,at).scopes,['quant:paper:workspace']);
  for(const oldScope of ['quant:account','quant:records:read']) {
    const old=createProductSessionRequest(productRegistry,{...input,scopes:[oldScope]},at);
    assert.throws(()=>signProductSessionApproval(productRegistry,old,{accountSecret:'1'.padStart(64,'0'),scopes:['quant:paper:workspace'],expiresAt:old.expiresAt},at));
    const original=signProductSessionApproval(productRegistry,old,{accountSecret:'1'.padStart(64,'0'),scopes:old.scopes,expiresAt:old.expiresAt},at);
    assert.deepEqual(original.scopes,[oldScope]);
    assert.throws(()=>parseProductSessionApproval(productRegistry,request,original,at));
  }
  assert.throws(()=>createProductSessionRequest(productRegistry,{...input,productId:'finance'},at));
});

test('completed old Quant sessions cannot operate Paper workspace after registry adds its independent scope',async()=>{
  const {ProductSessionAuthority,createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge}=await import('../src/product-session-v2.js');
  const {p256}=await import('@noble/curves/nist.js');
  const at=new Date('2026-10-01T00:00:00.000Z'),device=Buffer.alloc(32,7),server=new ProductSessionAuthority(productRegistry);
  for(const [i,scope] of ['quant:account','quant:records:read','quant:paper:workspace'].entries()){
    const request=createProductSessionRequest(productRegistry,{productId:'quant',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:[scope],purpose:'Explicit isolated Quant permission',nonce:String(i+1).repeat(43),state:String(i+4).repeat(43)},at);
    const approval=signProductSessionApproval(productRegistry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},at);
    const challenge=server.issueChallenge({request,approval,challenge:String(i+7).repeat(43)},at);
    const active=server.complete({request,approval,completion:signProductSessionChallenge(challenge,device.toString('base64url'))},at);
    const context=Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(key=>[key,active[key]]));
    context.requiredScopes=['quant:paper:workspace'];
    if(scope==='quant:paper:workspace') assert.equal(server.introspect(active.sessionBinding,context,at).active,true);
    else assert.throws(()=>server.introspect(active.sessionBinding,context,at),error=>error.code==='INVALID_SCOPES'||error.code==='SCOPE_WIDENING');
  }
});

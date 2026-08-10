import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJSON,
  centralProtocolEntry,
  createGatewayChallenge,
  createProductSessionProof,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import { CanonicalWalletGatewayNodeHost, encodeGatewayProofHeader } from "../src/gateway-node-host.js";
import * as packageNodeHost from "@ynx-chain/wallet-auth/gateway-node-host";
import * as universalPackage from "@ynx-chain/wallet-auth";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const BUILD={buildTime:"2026-07-27T12:00:00.000Z",release:"wallet-auth-test",sourceCommit:"a".repeat(40)};

function approvedRegistry() {
  const registry=JSON.parse(readFileSync(new URL("../central-registry.json",import.meta.url),"utf8"));
  for(const id of ["social","wallet"]){const product=registry.products.find(item=>item.productId===id);product.reviewState="approved";product.enabled=true}
  return registry;
}

function completion(registry,productId,nonce,challenge) {
  const registration=registry.products.find(item=>item.productId===productId);
  const authorizationRequest=parseAuthorizationRequest(request({nonce,requestingProduct:registration.requestingProduct,productClientId:registration.productClientId,bundleId:registration.bundleId,callback:registration.callbacks[0],scopes:[...registration.scopes],purpose:`Authorize ${productId} through the canonical persisted Gateway.`}),{now:NOW,registry:{[registration.productClientId]:centralProtocolEntry(registration)}});
  const walletApproval=signAuthorization(authorizationRequest,{accountSecret:ACCOUNT_SECRET,issuedAt:NOW.toISOString()});
  return {authorizationRequest,walletApproval,gatewayCompletion:signGatewayChallenge(createGatewayChallenge(walletApproval,{challenge,expiresAt:"2026-07-15T12:03:00.000Z"},NOW),PRODUCT_DEVICE_SECRET)};
}

function proof(session,path,nonce){
  const body="{}";
  return encodeGatewayProofHeader(createProductSessionProof(session,{method:"POST",path,bodyDigest:httpBodyDigest(body),nonce,issuedAt:NOW.toISOString(),expiresAt:"2026-07-15T12:00:30.000Z"},PRODUCT_DEVICE_SECRET));
}

async function serve(host,run){
  const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{return await run(`http://127.0.0.1:${server.address().port}`)}finally{await new Promise(resolve=>server.close(resolve))}
}

test("Node host mounts the existing kernel and preserves inventory across restart",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-")),statePath=join(directory,"state.json"),registry=approvedRegistry();
  const host=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
  await serve(host,async(base)=>{
    const health=await fetch(`${base}/health`);assert.equal(health.status,200);assert.equal((await health.json()).truthfulStatus,"canonical-wallet-gateway-local-runtime");
    for(const [id,nonce,challenge] of [["social","social_node_host_nonce_abcdefghijkl","social_node_host_challenge_abcdef"],["wallet","wallet_node_host_nonce_abcdefghijkl","wallet_node_host_challenge_abcdef"]]){
      const response=await fetch(`${base}/v1/wallet/sessions/complete`,{method:"POST",headers:{"content-type":"application/json"},body:canonicalJSON(completion(registry,id,nonce,challenge))});
      assert.equal(response.status,200,await response.text());
    }
  });
  assert.equal(statSync(statePath).mode&0o777,0o600);
  const restarted=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
  const sessions=restarted.snapshot().sessionStore.sessions,wallet=sessions.find(item=>item.productClientId==="ynx-wallet-v1");
  await serve(restarted,async(base)=>{
    const response=await fetch(`${base}/v1/wallet/sessions`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":proof(wallet,"/v1/wallet/sessions","node_inventory_proof_abcdefghijkl")},body:"{}"});
    assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.result.connectedApps.length,2);assert.equal(payload.result.account,wallet.account);
  });
  const remote=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW},{build:BUILD,remoteDeployed:true});
  await serve(remote,async(base)=>{
    const health=await (await fetch(`${base}/health`)).json();
    assert.equal(health.remoteDeployed,true);assert.equal(health.truthfulStatus,"remote-canonical-wallet-gateway");
  });
});

test("Node host rejects noncanonical proof transport and persisted-state tamper",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-")),statePath=join(directory,"state.json"),registry=approvedRegistry(),host=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
  await serve(host,async(base)=>{
    const response=await fetch(`${base}/v1/wallet/sessions`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":"not+base64"},body:"{}"});
    assert.equal(response.status,400);const payload=await response.json();assert.equal(payload.error.code,"INVALID_PROOF_HEADER");
  });
  const stored=JSON.parse(readFileSync(statePath,"utf8"));stored.stateDigest="0".repeat(64);writeFileSync(statePath,JSON.stringify(stored),{mode:0o600});
  assert.throws(()=>new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW}),/state digest/);
});

test("Node host validates and atomically normalizes the legacy timestamped state envelope",()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-legacy-")),statePath=join(directory,"state.json"),registry=approvedRegistry();
  const original=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
  const stored=JSON.parse(readFileSync(statePath,"utf8"));
  writeFileSync(statePath,canonicalJSON({...stored,updatedAt:NOW.toISOString()}),{mode:0o600});
  const migrated=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
  assert.deepEqual(migrated.snapshot(),original.snapshot());
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(statePath,"utf8"))).sort(),["schemaVersion","snapshot","stateDigest"]);
});

test("Node host refuses a group-readable state directory instead of changing its permissions",()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-insecure-"));chmodSync(directory,0o755);
  assert.throws(()=>new CanonicalWalletGatewayNodeHost(approvedRegistry(),{statePath:join(directory,"state.json"),now:()=>NOW}),/directory must use mode 0700/);
  assert.equal(statSync(directory).mode&0o777,0o755);
});

test("Node host exposes truthful version, readiness, metrics and redacted structured events",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-observability-")),statePath=join(directory,"state.json"),events=[];
  const host=new CanonicalWalletGatewayNodeHost(approvedRegistry(),{emitEvent:event=>events.push(event),statePath,now:()=>NOW},{build:BUILD,remoteDeployed:false});
  await serve(host,async(base)=>{
    const health=await fetch(`${base}/health`);
    assert.equal(health.status,200);assert.match(health.headers.get("x-request-id"),/^[0-9a-f-]{36}$/);assert.match(health.headers.get("x-trace-id"),/^[0-9a-f-]{36}$/);
    const ready=await (await fetch(`${base}/ready`)).json();
    assert.equal(ready.runtimeReady,true);assert.equal(ready.publicDeploymentReady,false);assert.equal(ready.remoteDeployed,false);
    const version=await (await fetch(`${base}/version`)).json();
    assert.deepEqual(version.build,BUILD);assert.equal(version.gatewayHttpSchemaVersion,1);assert.equal(version.nodeStateSchemaVersion,1);assert.equal(version.observabilitySchemaVersion,1);assert.match(version.registrySha256,/^[0-9a-f]{64}$/);assert.deepEqual(version.enabledProductClientIds,["ynx-calendar-v1","ynx-developer-v1","ynx-dex-web-v1","ynx-exchange-v1","ynx-finance-v1","ynx-merchant-console-v1","ynx-quant-v1","ynx-seller-v1","ynx-shop-v1","ynx-social-v1","ynx-wallet-v1"]);
    const rejected=await fetch(`${base}/v1/wallet/sessions`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":"not+base64"},body:"{}"});
    assert.equal(rejected.status,400);assert.match(rejected.headers.get("x-error-id"),/^[0-9a-f-]{36}$/);assert.equal((await rejected.json()).error.code,"INVALID_PROOF_HEADER");
    const metrics=await (await fetch(`${base}/metrics`)).text();
    assert.match(metrics,/ynx_wallet_gateway_requests_total 5/);
    assert.match(metrics,/ynx_wallet_gateway_errors_total\{code="INVALID_PROOF_HEADER"\} 1/);
    assert.match(metrics,/ynx_wallet_gateway_build_info\{release="wallet-auth-test",source_commit="a{40}"\} 1/);
    assert.equal(metrics.includes("not+base64"),false);assert.equal(metrics.includes(statePath),false);
  });
  const rejectedEvent=events.find(event=>event.errorCode==="INVALID_PROOF_HEADER");
  assert.equal(rejectedEvent.ok,false);assert.match(rejectedEvent.errorId,/^[0-9a-f-]{36}$/);assert.equal(rejectedEvent.route,"session_inventory");
  for(const event of events){assert.equal(Object.hasOwn(event,"body"),false);assert.equal(Object.hasOwn(event,"proof"),false);assert.equal(Object.hasOwn(event,"headers"),false);assert.match(event.requestId,/^[0-9a-f-]{36}$/);assert.match(event.traceId,/^[0-9a-f-]{36}$/)}
});

test("Node host refuses remote deployment without exact build identity",()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-build-")),statePath=join(directory,"state.json"),registry=approvedRegistry();
  assert.throws(()=>new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW},{remoteDeployed:true}),/requires exact build identity/);
  assert.throws(()=>new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW},{build:{...BUILD,sourceCommit:"short"},remoteDeployed:true}),/full lowercase Git SHA/);
});

test("Node host isolates a failed structured-event sink and reports the drop",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-event-sink-")),statePath=join(directory,"state.json");
  const host=new CanonicalWalletGatewayNodeHost(approvedRegistry(),{emitEvent:()=>{throw new Error("sink unavailable")},statePath,now:()=>NOW});
  await serve(host,async(base)=>{
    const health=await fetch(`${base}/health`);assert.equal(health.status,200);
    const metrics=await (await fetch(`${base}/metrics`)).text();
    assert.match(metrics,/ynx_wallet_gateway_events_dropped_total 1/);
  });
});

test("Node-only package subpath exports the canonical observability host",()=>{
  assert.equal(Object.hasOwn(universalPackage,"CanonicalWalletGatewayNodeHost"),false);
  assert.equal(packageNodeHost.CanonicalWalletGatewayNodeHost,CanonicalWalletGatewayNodeHost);
  assert.equal(packageNodeHost.CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION,1);
  assert.equal(packageNodeHost.CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION,1);
  assert.equal(packageNodeHost.CANONICAL_GATEWAY_PROOF_HEADER,"x-ynx-product-session-proof");
  assert.equal(packageNodeHost.encodeGatewayProofHeader,encodeGatewayProofHeader);
  assert.equal(typeof packageNodeHost.decodeGatewayProofHeader,"function");
});

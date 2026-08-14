import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
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
import { GatewayAdmissionController } from "../src/gateway-admission.js";
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

function multiUserCompletion(registry,index) {
  const registration=registry.products.find(item=>item.productId==="social");
  const accountSecret=index.toString(16).padStart(64,"0");
  const deviceSecretBytes=Buffer.alloc(32);deviceSecretBytes.writeUInt32BE(1_000+index,28);
  const deviceSecret=deviceSecretBytes.toString("base64url");
  const productDeviceKey=Buffer.from(p256.getPublicKey(deviceSecretBytes,true)).toString("base64url");
  const authorizationRequest=parseAuthorizationRequest(request({
    nonce:`multi_user_request_${index.toString().padStart(16,"0")}`,
    productDeviceKey,
    purpose:`Authorize isolated multi-user Gateway capacity subject ${index}.`,
  }),{now:NOW,registry:{[registration.productClientId]:centralProtocolEntry(registration)}});
  const walletApproval=signAuthorization(authorizationRequest,{accountSecret,issuedAt:NOW.toISOString()});
  const gatewayCompletion=signGatewayChallenge(createGatewayChallenge(walletApproval,{
    challenge:`multi_user_challenge_${index.toString().padStart(16,"0")}`,
    expiresAt:"2026-07-15T12:03:00.000Z",
  },NOW),deviceSecret);
  return {account:walletApproval.account,deviceSecret,input:{authorizationRequest,walletApproval,gatewayCompletion}};
}

function multiUserProof(session,deviceSecret,path,nonce,body="{}") {
  const value=createProductSessionProof(session,{method:"POST",path,bodyDigest:httpBodyDigest(body),nonce,issuedAt:NOW.toISOString(),expiresAt:"2026-07-15T12:00:30.000Z"},deviceSecret);
  return {body,header:encodeGatewayProofHeader(value)};
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

test("Node host completes 32 isolated users concurrently and preserves replay and revoke across restart",async()=>{
  const users=32,directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-multi-user-")),statePath=join(directory,"state.json"),registry=approvedRegistry();
  const inputs=Array.from({length:users},(_,offset)=>multiUserCompletion(registry,offset+1));
  const host=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
  const completionLatencies=[];
  let replayProof,revokedSession,revokedDeviceSecret;
  await serve(host,async(base)=>{
    const completions=await Promise.all(inputs.map(async item=>{
      const started=performance.now();
      const response=await fetch(`${base}/v1/wallet/sessions/complete`,{method:"POST",headers:{"content-type":"application/json"},body:canonicalJSON(item.input)});
      completionLatencies.push(performance.now()-started);
      return {payload:await response.json(),status:response.status};
    }));
    assert.deepEqual(new Set(completions.map(item=>item.status)),new Set([200]));
    assert.equal(new Set(completions.map(item=>item.payload.result.account)).size,users);

    const sessions=host.snapshot().sessionStore.sessions;
    assert.equal(sessions.length,users);
    assert.equal(new Set(sessions.map(item=>item.account)).size,users);
    const sessionByAccount=new Map(sessions.map(item=>[item.account,item]));
    const introspections=await Promise.all(inputs.map(async(item,index)=>{
      const session=sessionByAccount.get(item.account);
      const signed=multiUserProof(session,item.deviceSecret,"/v1/wallet/sessions/introspect",`multi_user_introspect_${(index+1).toString().padStart(16,"0")}`,canonicalJSON({requiredScopes:["account:read"]}));
      if(index===0)replayProof=signed;
      const response=await fetch(`${base}/v1/wallet/sessions/introspect`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":signed.header},body:signed.body});
      return {payload:await response.json(),status:response.status};
    }));
    assert.deepEqual(new Set(introspections.map(item=>item.status)),new Set([200]));
    assert.ok(introspections.every(item=>item.payload.result.active===true));

    const replay=await fetch(`${base}/v1/wallet/sessions/introspect`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":replayProof.header},body:replayProof.body});
    assert.equal(replay.status,409);assert.equal((await replay.json()).error.code,"REPLAY");

    const revokedInput=inputs.at(-1);revokedSession=sessionByAccount.get(revokedInput.account);revokedDeviceSecret=revokedInput.deviceSecret;
    const revoke=multiUserProof(revokedSession,revokedDeviceSecret,"/v1/wallet/sessions/revoke","multi_user_revoke_0000000000000001");
    const revoked=await fetch(`${base}/v1/wallet/sessions/revoke`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":revoke.header},body:revoke.body});
    assert.equal(revoked.status,200);

    const metrics=await (await fetch(`${base}/metrics`)).text();
    assert.match(metrics,/ynx_wallet_gateway_requests_total 67/);
    assert.match(metrics,/ynx_wallet_gateway_errors_total\{code="REPLAY"\} 1/);
  });

  const restarted=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
  await serve(restarted,async(base)=>{
    const replay=await fetch(`${base}/v1/wallet/sessions/introspect`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":replayProof.header},body:replayProof.body});
    assert.equal(replay.status,409);assert.equal((await replay.json()).error.code,"REPLAY");
    const postRevoke=multiUserProof(revokedSession,revokedDeviceSecret,"/v1/wallet/sessions/introspect","multi_user_post_revoke_00000000001",canonicalJSON({requiredScopes:["account:read"]}));
    const rejected=await fetch(`${base}/v1/wallet/sessions/introspect`,{method:"POST",headers:{"content-type":"application/json","x-ynx-product-session-proof":postRevoke.header},body:postRevoke.body});
    assert.equal(rejected.status,403);assert.equal((await rejected.json()).error.code,"REVOKED");
  });
  assert.equal(statSync(statePath).mode&0o777,0o600);
  completionLatencies.sort((left,right)=>left-right);
  const percentile=fraction=>completionLatencies[Math.ceil(completionLatencies.length*fraction)-1];
  console.log(JSON.stringify({gatewayMultiUserEvidence:{coverage:"real loopback HTTP, canonical P-256 completion and introspection, disk persistence, host reconstruction, replay and revoke; excludes public network and external load balancer",failures:0,users,completionLatencyMs:{p50:Number(percentile(0.5).toFixed(3)),p95:Number(percentile(0.95).toFixed(3)),p99:Number(percentile(0.99).toFixed(3)),max:Number(completionLatencies.at(-1).toFixed(3))}}}));
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
  const {registrySha256:_registrySha256,...legacy}=stored;
  writeFileSync(statePath,canonicalJSON({...legacy,schemaVersion:1,updatedAt:NOW.toISOString()}),{mode:0o600});
  assert.throws(()=>new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW}),caught=>caught?.code==="LEGACY_STATE_MIGRATION_REQUIRED");
  const migrated=new CanonicalWalletGatewayNodeHost(registry,{allowLegacyStateMigration:true,statePath,now:()=>NOW});
  assert.deepEqual(migrated.snapshot(),original.snapshot());
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(statePath,"utf8"))).sort(),["registrySha256","schemaVersion","snapshot","stateDigest"]);
  assert.equal(JSON.parse(readFileSync(statePath,"utf8")).schemaVersion,2);
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
    assert.deepEqual(version.build,BUILD);assert.equal(version.gatewayHttpSchemaVersion,1);assert.equal(version.nodeStateSchemaVersion,2);assert.equal(version.observabilitySchemaVersion,1);assert.match(version.registrySha256,/^[0-9a-f]{64}$/);assert.deepEqual(version.enabledProductClientIds,["ynx-bridge-web-v1","ynx-browser-android","ynx-browser-ios","ynx-browser-macos","ynx-browser-windows","ynx-calendar-v1","ynx-cloud-mobile-v1","ynx-cloud-web-v1","ynx-creator-studio-web-v1","ynx-developer-v1","ynx-dex-web-v1","ynx-docs-mobile-v1","ynx-docs-web-v1","ynx-exchange-v1","ynx-finance-v1","ynx-mail-v1","ynx-merchant-console-v1","ynx-music-v1","ynx-music-web-v1","ynx-pay-v1","ynx-quant-v1","ynx-search-web","ynx-seller-v1","ynx-shop-v1","ynx-social-v1","ynx-video-mobile-v1","ynx-video-web-v1","ynx-wallet-v1"]);
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

test("Node host reports admission rejection with canonical identifiers, metrics and redacted events",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-admission-")),statePath=join(directory,"state.json"),events=[];
  const admission=new GatewayAdmissionController({maxConcurrent:2,maxPerWindow:1,windowMs:60_000,now:()=>NOW.getTime()});
  const host=new CanonicalWalletGatewayNodeHost(approvedRegistry(),{admission,emitEvent:event=>events.push(event),statePath,now:()=>NOW});
  await serve(host,async(base)=>{
    const first=await fetch(`${base}/health`,{headers:{"x-forwarded-for":"198.51.100.10"}});assert.equal(first.status,200);
    const limited=await fetch(`${base}/health`,{headers:{"x-forwarded-for":"198.51.100.10"}});
    assert.equal(limited.status,429);assert.equal(limited.headers.get("cache-control"),"no-store");assert.equal(limited.headers.get("retry-after"),"60");
    const payload=await limited.json();assert.equal(payload.ok,false);assert.equal(payload.error.code,"RATE_LIMIT");assert.match(payload.stateDigest,/^[0-9a-f]{64}$/);
    assert.equal(payload.requestId,limited.headers.get("x-request-id"));assert.equal(payload.traceId,limited.headers.get("x-trace-id"));assert.equal(payload.errorId,limited.headers.get("x-error-id"));
    const metrics=await (await fetch(`${base}/metrics`,{headers:{"x-forwarded-for":"198.51.100.11"}})).text();
    assert.match(metrics,/ynx_wallet_gateway_requests_total 3/);assert.match(metrics,/ynx_wallet_gateway_errors_total\{code="RATE_LIMIT"\} 1/);
  });
  const rejected=events.find(event=>event.errorCode==="RATE_LIMIT");assert.equal(rejected.status,429);assert.equal(rejected.ok,false);assert.equal(rejected.route,"health");
  assert.throws(()=>new CanonicalWalletGatewayNodeHost(approvedRegistry(),{admission:{},statePath:join(directory,"invalid.json"),now:()=>NOW}),/admission controller/);
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
  assert.equal(packageNodeHost.CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION,2);
  assert.equal(packageNodeHost.CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION,1);
  assert.equal(packageNodeHost.CANONICAL_GATEWAY_PROOF_HEADER,"x-ynx-product-session-proof");
  assert.equal(packageNodeHost.encodeGatewayProofHeader,encodeGatewayProofHeader);
  assert.equal(typeof packageNodeHost.decodeGatewayProofHeader,"function");
});

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
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

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
  new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>NOW});
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

test("Node host refuses a group-readable state directory instead of changing its permissions",()=>{
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-gateway-insecure-"));chmodSync(directory,0o755);
  assert.throws(()=>new CanonicalWalletGatewayNodeHost(approvedRegistry(),{statePath:join(directory,"state.json"),now:()=>NOW}),/directory must use mode 0700/);
  assert.equal(statSync(directory).mode&0o777,0o755);
});

import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ProductSessionGatewayKernel } from "../src/product-session-gateway.js";
import { ProductSessionControlNodeHost } from "../src/product-session-control-node-host.js";
import { initializeProductSessionControlState, inspectProductSessionControlStateFile } from "../src/product-session-control-node-store.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { migrateProductSessionControlSnapshotV2, parseProductSessionControlSnapshot } from "../src/product-session-control-intent.js";
import { parseProductSessionControlCapacityPolicy, inspectProductSessionControlCapacity } from "../src/product-session-control-capacity.js";
import { canonicalJSON, encodeWalletSessionControlProofHeader } from "../src/index.js";
import { ACCOUNT_PATH, OWNER, OTHER, at, input, intentBody, ownerInput, pending, registry, requestId, result, session, token } from "./fixtures/product-session-control-v3-fixture.mjs";

const THIRD = "3".padStart(64,"0"), POLICY = {maxOwners:2,intentsPerOwner:2};
function gateway(snapshot, policy=POLICY) {
  return new ProductSessionGatewayKernel(registry,()=>token(requestId()),snapshot??migrateProductSessionControlSnapshotV2(new ProductSessionGatewayKernel(registry,()=>token(requestId())).snapshot()),policy);
}
function logout(g, label, owner=OWNER, offset=0) { return g.dispatch(ownerInput(ACCOUNT_PATH,intentBody(label),{owner,offset}),at(offset)); }
function code(response) { return result(response).error?.code; }

test("policy startup validation reserves every owner's allocation and rejects unbounded/unknown configuration",()=>{
  assert.deepEqual(parseProductSessionControlCapacityPolicy(),{maxOwners:256,intentsPerOwner:32});
  for(const bad of [{maxOwners:0,intentsPerOwner:2},{maxOwners:2.5,intentsPerOwner:2},{maxOwners:256,intentsPerOwner:40},{maxOwners:2,intentsPerOwner:2,extra:true}]) assert.throws(()=>parseProductSessionControlCapacityPolicy(bad));
});

test("invalid daemon capacity configuration fails before either state path can be initialized",t=>{
  const directory=fs.mkdtempSync(join(tmpdir(),"ynx-control-invalid-policy-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const run=spawnSync(process.execPath,[fileURLToPath(new URL("../scripts/ynx-wallet-gatewayd.mjs",import.meta.url))],{encoding:"utf8",env:{YNX_WALLET_GATEWAY_STATE_PATH:join(directory,"v1.json"),YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH:join(directory,"v3.json"),YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION:"3",YNX_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY:JSON.stringify({maxOwners:256,intentsPerOwner:40})}});
  assert.notEqual(run.status,0);assert.match(run.stderr,/Every admitted owner/);assert.deepEqual(fs.readdirSync(directory),[]);
});

test("live V2 capacity preflight is read-only and reports owners before stop/migration",t=>{
  const directory=fs.mkdtempSync(join(tmpdir(),"ynx-control-preflight-"));fs.chmodSync(directory,0o700);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const statePath=join(directory,"v2.json");new ProductSessionGatewayNodeHost(registry,{statePath,now:()=>at(),tokenFactory:()=>token(requestId())});
  const raw=fs.readFileSync(statePath),stat=fs.statSync(statePath);
  const preflight=inspectProductSessionControlStateFile({statePath,capacityPolicy:POLICY});
  assert.equal(preflight.readOnly,true);assert.equal(preflight.sourceEnvelopeVersion,1);assert.equal(preflight.snapshotSchemaVersion,2);assert.equal(preflight.overReserved,false);
  assert.deepEqual(fs.readFileSync(statePath),raw);assert.equal(fs.statSync(statePath).ino,stat.ino);
});

test("one owner cannot use another owner's reserved intents; new free owners are denied after admission fills",()=>{
  const g=gateway();
  assert.equal(logout(g,"a1").status,200);assert.equal(logout(g,"a2").status,200);
  assert.equal(code(logout(g,"a3")),"CONTROL_OWNER_CAPACITY");
  assert.equal(logout(g,"b1",OTHER).status,200);assert.equal(logout(g,"b2",OTHER).status,200);
  assert.equal(code(logout(g,"c1",THIRD)),"CONTROL_OWNER_ADMISSION");
  assert.equal(g.snapshot().controlIntents.length,4);
  assert.deepEqual([...inspectProductSessionControlCapacity(g.snapshot(),POLICY).counts.values()].sort(),[2,2]);
});

test("existing session owners reserve slots before their first batch logout; saturation rejects a new challenge before issue",()=>{
  const g=gateway();const existing=session(g,"existing-b",{owner:OTHER});
  assert.equal(logout(g,"a1").status,200);assert.equal(logout(g,"a2").status,200);
  const c=pending("new-c",{owner:THIRD});const before=g.snapshot().authority.issuedChallenges.length;
  assert.equal(code(g.dispatch(input("/v2/product-sessions/challenge",c),at())),"CONTROL_OWNER_ADMISSION");
  assert.equal(g.snapshot().authority.issuedChallenges.length,before);
  assert.equal(logout(g,"b-first",OTHER).status,200);
  assert.ok(g.snapshot().authority.revokedSessions.includes(existing.session.sessionBinding));
});

test("zero-session logout persists cutoff and prevents an older approval arriving later",()=>{
  const g=gateway(), approval=pending("approval-not-yet-at-auth");
  const accepted=logout(g,"zero-session-cutoff",OWNER,10);
  assert.equal(accepted.status,200);assert.equal(result(accepted).result.preparedReceipt.revokedSessionCount,0);
  assert.equal(code(g.dispatch(input("/v2/product-sessions/challenge",approval),at(11))),"SESSION_REVOKED");
});

test("full admission and owner quota still allow exact expired-intent retry, while changed body conflicts",()=>{
  const g=gateway();const first=logout(g,"permanent-receipt");
  logout(g,"a2");logout(g,"b1",OTHER);logout(g,"b2",OTHER);
  const retry=g.dispatch(ownerInput(ACCOUNT_PATH,intentBody("permanent-receipt"),{offset:600_001}),at(600_001));
  assert.equal(retry.status,200);assert.deepEqual(result(retry).result.preparedReceipt,result(first).result.preparedReceipt);
  const altered={...intentBody("permanent-receipt"),intentExpiresAt:at(590_000).toISOString()};
  assert.equal(code(g.dispatch(ownerInput(ACCOUNT_PATH,altered,{offset:600_001}),at(600_001))),"IDEMPOTENCY_CONFLICT");
});

test("lowered policy preserves grandfathered receipts/cutoffs and never rewrites the schema",()=>{
  const original=gateway(undefined,{maxOwners:3,intentsPerOwner:3});
  const first=logout(original,"old-a1");logout(original,"old-a2");logout(original,"old-a3");logout(original,"old-b1",OTHER);
  const before=original.snapshot(), lower=gateway(before,{maxOwners:1,intentsPerOwner:1});
  const retry=logout(lower,"old-a1",OWNER,10);
  assert.equal(retry.status,200);assert.deepEqual(result(retry).result.preparedReceipt,result(first).result.preparedReceipt);
  assert.equal(code(logout(lower,"old-a4",OWNER,11)),"CONTROL_OWNER_CAPACITY");
  assert.equal(code(logout(lower,"new-c1",THIRD,11)),"CONTROL_OWNER_ADMISSION");
  assert.deepEqual(lower.snapshot().controlIntents,before.controlIntents);
  assert.deepEqual(lower.snapshot().authority.revokedAccounts,before.authority.revokedAccounts);
  assert.equal(parseProductSessionControlSnapshot(lower.snapshot()).schemaVersion,3);
  assert.equal(inspectProductSessionControlCapacity(before,{maxOwners:1,intentsPerOwner:1}).overReserved,true);
});

test("real local host exposes only policy and preserves durable receipts under simultaneous owners and cold retry",async t=>{
  const directory=fs.mkdtempSync(join(tmpdir(),"ynx-control-capacity-"));fs.chmodSync(directory,0o700);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const statePath=join(directory,"state.json");initializeProductSessionControlState(statePath,gateway().snapshot());
  let offset=0,host,server,base;
  const start=async()=>{host=new ProductSessionControlNodeHost(registry,{statePath,now:()=>at(offset),tokenFactory:()=>token(requestId()),capacityPolicy:POLICY});server=createServer(host.handler());await new Promise(r=>server.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${server.address().port}`;};
  const stop=async()=>{if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}};t.after(stop);await start();
  const before=fs.readFileSync(statePath,"utf8");
  const capability=await fetch(base+"/v2/product-sessions/capabilities",{headers:{"x-request-id":requestId(),origin:"https://wallet.ynxweb4.com"}});assert.equal(capability.status,200);
  const description=await capability.json();assert.equal(description.result.controlIntentCapacity.maxOwners,2);assert.equal(description.result.controlIntentCapacity.intentsPerOwner,2);assert.equal(description.result.controlIntentCapacity.productionConcurrencyValidated,false);assert.equal(JSON.stringify(description).includes("ynx1"),false);assert.equal(fs.readFileSync(statePath,"utf8"),before);
  const post=async(label,owner)=>{const r=ownerInput(ACCOUNT_PATH,intentBody(label),{owner,offset});const reply=await fetch(base+ACCOUNT_PATH,{method:"POST",headers:{"content-type":"application/json","x-request-id":r.requestId,"x-ynx-wallet-control-proof-v2":encodeWalletSessionControlProofHeader(r.walletControlProof)},body:canonicalJSON(r.body)});return {status:reply.status,payload:await reply.json()};};
  const first=await Promise.all([post("local-a",OWNER),post("local-b",OTHER)]);assert.ok(first.every(x=>x.status===200&&x.payload.result.revocationConfirmed===true));
  assert.equal((await post("local-c",THIRD)).payload.error.code,"CONTROL_OWNER_ADMISSION");
  assert.equal((await post("local-a2",OWNER)).status,200);assert.equal((await post("local-a3",OWNER)).payload.error.code,"CONTROL_OWNER_CAPACITY");
  assert.equal((await post("local-b2",OTHER)).status,200);const latest=fs.readFileSync(statePath,"utf8");
  await stop();offset=600_001;await start();assert.equal(fs.readFileSync(statePath,"utf8"),latest);
  const retried=await Promise.all([post("local-a",OWNER),post("local-b",OTHER)]);retried.forEach((x,i)=>{assert.equal(x.status,200);assert.deepEqual(x.payload.result.receipt,first[i].payload.result.receipt);});
  assert.equal(host.snapshot().controlIntents.length,4);
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON, createProductSessionRequest, signProductSessionApproval } from "../src/index.js";
import { PersistentProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T09:00:00.000Z");

test("persistent v2 host commits challenge before response and restores idempotency after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-v2-")); chmodSync(directory, 0o700);
  const statePath = join(directory, "state.json");
  const first = new PersistentProductSessionGatewayNodeHost(registry, { statePath, now:()=>NOW, tokenFactory:()=>randomBytes(32).toString("base64url") });
  const pending = request(), approval = signProductSessionApproval(registry, pending, { accountSecret:"1".padStart(64,"0"), scopes:pending.scopes, expiresAt:"2026-08-14T09:03:00.000Z" }, NOW);
  const body = canonicalJSON({request:pending,approval});
  const original = await serve(first, "req_node_challenge_0001", "/v2/product-sessions/challenge", body);
  assert.equal(original.status, 200);
  const persisted = readFileSync(statePath, "utf8"); assert.equal(`${canonicalJSON(JSON.parse(persisted))}\n`, persisted);
  const restarted = new PersistentProductSessionGatewayNodeHost(registry, { statePath, now:()=>NOW, tokenFactory:()=>randomBytes(32).toString("base64url") });
  const replay = await serve(restarted, "req_node_challenge_0001", "/v2/product-sessions/challenge", body);
  assert.equal(replay.status, 200); assert.equal(replay.body, original.body);
});

test("unsafe startup and runtime state replacements fail closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-v2-")); chmodSync(directory,0o700);
  const statePath=join(directory,"state.json"), host=new PersistentProductSessionGatewayNodeHost(registry,{statePath,now:()=>NOW});
  chmodSync(statePath,0o644);
  assert.throws(()=>new PersistentProductSessionGatewayNodeHost(registry,{statePath,now:()=>NOW}),error("INSECURE_STATE_FILE"));
  const response=await serve(host,"req_node_runtime_mode_01","/v2/product-sessions/challenge","{}");
  assert.equal(response.status,503);assert.equal(JSON.parse(response.body).error.code,"INSECURE_STATE_FILE");
  assert.equal(statSync(statePath).mode&0o777,0o644);
});

function request(){const secret=Buffer.alloc(32,21);return createProductSessionRequest(registry,{productId:"finance",platform:"web",deviceId:"node-host-device-001",deviceKey:Buffer.from(p256.getPublicKey(secret,true)).toString("base64url"),scopes:["finance.pay.read"],purpose:"Persistent Product Session v2 host test.",nonce:randomBytes(32).toString("base64url"),state:randomBytes(32).toString("base64url")},NOW)}
async function serve(host,requestId,path,body){const server=createServer(host.handler());await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});try{const address=server.address(),response=await fetch(`http://127.0.0.1:${address.port}${path}`,{method:"POST",headers:{"content-type":"application/json","x-request-id":requestId},body});return{status:response.status,body:await response.text()}}finally{await new Promise(resolve=>server.close(resolve))}}
function error(code){return value=>value?.code===code}

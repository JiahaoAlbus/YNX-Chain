import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.YNX_WALLET_AUTH_PACKAGE,
  path.resolve(repositoryRoot, "../02-wallet-auth/packages/wallet-auth"),
  path.resolve(repositoryRoot, "../../YNX Chain Wallet Auth/packages/wallet-auth"),
].filter(Boolean);
let root;
for (const candidate of candidates) {
  try {
    await fs.access(path.join(candidate, "src/index.js"));
    root = candidate;
    break;
  } catch {}
}
if (!root) {
  throw new Error(`Canonical Wallet Auth package not found; checked: ${candidates.join(", ")}`);
}
const auth=await import(pathToFileURL(path.join(root,"src/index.js")));
for(const file of ["apps/trust-center/integration/canonical-wallet-v1-test-vector.json","apps/resource-market/integration/canonical-wallet-v1-test-vector.json"]){
  const vector=JSON.parse(await fs.readFile(file,"utf8"));
  const session=auth.verifyCentralWalletSession({registryEntry:vector.registryEntry,authorizationRequest:vector.authorizationRequest,walletApproval:vector.walletApproval,gatewayCompletion:vector.gatewayCompletion},new Date("2026-07-18T06:00:00.000Z"));
  auth.verifyProductSessionProof(vector.productSessionProof.proof,session,{method:"POST",path:"/api/authority/intents",bodyDigest:auth.httpBodyDigest(vector.productSessionProof.body)},new Date("2026-07-18T06:00:01.000Z"));
  assert.deepEqual(session,vector.expectedSession,`${file} diverged from canonical verifier`);
  assert.throws(()=>auth.verifyCentralWalletSession({registryEntry:vector.registryEntry,authorizationRequest:{...vector.authorizationRequest,callback:"attacker://callback"},walletApproval:vector.walletApproval,gatewayCompletion:vector.gatewayCompletion},new Date("2026-07-18T06:00:00.000Z")));
}
console.log("Trust and Resource canonical Wallet vectors verified");

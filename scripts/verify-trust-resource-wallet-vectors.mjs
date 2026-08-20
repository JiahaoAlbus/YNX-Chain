import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root=process.env.YNX_WALLET_AUTH_PACKAGE||path.resolve("../YNX Chain Wallet Auth/packages/wallet-auth");
const auth=await import(pathToFileURL(path.join(root,"src/index.js")));
for(const file of ["apps/trust-center/integration/canonical-wallet-v1-test-vector.json","apps/resource-market/integration/canonical-wallet-v1-test-vector.json"]){
  const vector=JSON.parse(await fs.readFile(file,"utf8"));
  const session=auth.verifyCentralWalletSession({registryEntry:vector.registryEntry,authorizationRequest:vector.authorizationRequest,walletApproval:vector.walletApproval,gatewayCompletion:vector.gatewayCompletion},new Date("2026-07-18T06:00:00.000Z"));
  assert.deepEqual(session,vector.expectedSession,`${file} diverged from canonical verifier`);
  assert.throws(()=>auth.verifyCentralWalletSession({registryEntry:vector.registryEntry,authorizationRequest:{...vector.authorizationRequest,callback:"attacker://callback"},walletApproval:vector.walletApproval,gatewayCompletion:vector.gatewayCompletion},new Date("2026-07-18T06:00:00.000Z")));
}
console.log("Trust and Resource canonical Wallet vectors verified");

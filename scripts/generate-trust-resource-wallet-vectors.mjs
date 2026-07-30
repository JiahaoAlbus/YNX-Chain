import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.YNX_WALLET_AUTH_PACKAGE,
  path.resolve(repositoryRoot, "../02-wallet-auth/packages/wallet-auth"),
  path.resolve(repositoryRoot, "../../YNX Chain Wallet Auth/packages/wallet-auth"),
].filter(Boolean);
let packageRoot;
for (const candidate of candidates) {
  try {
    await fs.access(path.join(candidate, "src/index.js"));
    packageRoot = candidate;
    break;
  } catch {}
}
if (!packageRoot) {
  throw new Error(`Canonical Wallet Auth package not found; checked: ${candidates.join(", ")}`);
}
const auth = await import(pathToFileURL(path.join(packageRoot, "src/index.js")));
const { p256 } = await import(pathToFileURL(path.join(packageRoot, "node_modules/@noble/curves/nist.js")));
const now = new Date("2026-07-18T06:00:00.000Z");
const productSecret = Buffer.alloc(32, 0x42).toString("base64url");
const productKey = Buffer.from(p256.getPublicKey(Buffer.alloc(32, 0x42), true)).toString("base64url");
const accountSecret = `${"00".repeat(31)}01`;

const products = [
  {dir:"apps/trust-center",name:"trust",registryEntry:{schemaVersion:2,productClientId:"ynx-trust-center-v1",requestingProduct:"trust-center",bundleId:"com.ynxweb4.trust",callbacks:["ynxtrust://wallet-auth/callback"],scopes:["account:read","trust:appeal","trust:evidence:read","trust:evidence:write","trust:transparency"],maxScopes:5,productDeviceAlgorithms:["p256-sha256"]},purpose:"Inspect bounded Trust requests, evidence, review and appeal records"},
  {dir:"apps/resource-market",name:"resource",registryEntry:{schemaVersion:2,productClientId:"ynx-resource-market-v1",requestingProduct:"resource-market",bundleId:"com.ynxweb4.resource",callbacks:["ynxresource://wallet-auth/callback"],scopes:["account:read","resource:analytics","resource:capacity:read","resource:dispute","resource:history","resource:intent","resource:quote"],maxScopes:7,productDeviceAlgorithms:["p256-sha256"]},purpose:"Read authoritative capacity and submit one Wallet-reviewed resource intent"},
];
for (const product of products) {
  const r=product.registryEntry;
  const authorizationRequest={version:"1",nonce:`nonce_${product.name}_abcdefghijklmnopqrstuvwxyz12`,chainId:"ynx_6423-1",requestingProduct:r.requestingProduct,productClientId:r.productClientId,bundleId:r.bundleId,productDeviceAlgorithm:"p256-sha256",productDeviceKey:productKey,callback:r.callbacks[0],scopes:r.scopes,purpose:product.purpose,issuedAt:"2026-07-18T05:59:00.000Z",expiresAt:"2026-07-18T06:04:00.000Z"};
  const registry={ [r.productClientId]:{requestingProduct:r.requestingProduct,bundleId:r.bundleId,callbacks:r.callbacks,scopes:r.scopes,maxScopes:r.maxScopes} };
  const parsed=auth.parseAuthorizationRequest(authorizationRequest,{now,registry});
  const walletApproval=auth.signAuthorization(parsed,{accountSecret,issuedAt:now.toISOString()});
  const challenge=auth.createGatewayChallenge(walletApproval,{challenge:`gateway_${product.name}_challenge_abcdefghijklmnop`,expiresAt:"2026-07-18T06:03:00.000Z"},now);
  const gatewayCompletion=auth.signGatewayChallenge(challenge,productSecret);
  const expectedSession=auth.verifyCentralWalletSession({registryEntry:r,authorizationRequest:parsed,walletApproval,gatewayCompletion},now);
  const proofBody=`{"kind":"${product.name}"}`;
  const proofInput={method:"POST",path:"/api/authority/intents",bodyDigest:auth.httpBodyDigest(proofBody),nonce:`proof_${product.name}_abcdefghijklmnopqrstuvwxyz`,issuedAt:"2026-07-18T06:00:00.000Z",expiresAt:"2026-07-18T06:00:30.000Z"};
  const productSessionProof=auth.createProductSessionProof(expectedSession,proofInput,productSecret);
  const out=path.join(product.dir,"integration");await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,"canonical-wallet-registry.json"),`${JSON.stringify(r,null,2)}\n`);
  await fs.writeFile(path.join(out,"canonical-wallet-v1-test-vector.json"),`${JSON.stringify({testOnly:true,generatedBy:"@ynx-chain/wallet-auth",registryEntry:r,authorizationRequest:parsed,walletApproval,gatewayCompletion,expectedSession,productSessionProof:{body:proofBody,proof:productSessionProof}},null,2)}\n`);
}

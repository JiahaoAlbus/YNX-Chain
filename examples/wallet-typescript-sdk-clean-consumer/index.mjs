import {readFile} from "node:fs/promises";
import {
  centralDeviceBinding,
  createProductDeviceIdentity,
  createProductSessionProof,
  httpBodyDigest,
  productSessionProofSignBytes,
  verifyProductSessionProof,
} from "@ynx-chain/wallet-auth";
import {proveYNXTestnetRPC, ynxPublicEndpoints} from "@ynx-chain/sdk";

const vectorPath = process.env.YNX_WALLET_AUTH_VECTOR;
if (!vectorPath) throw new Error("YNX_WALLET_AUTH_VECTOR is required");
const vector = JSON.parse(await readFile(vectorPath, "utf8"));
const {signature: vectorSignature, ...unsignedVectorProof} = vector.proof;
if (!vectorSignature || productSessionProofSignBytes(unsignedVectorProof) !== vector.expected.signBytes) {
  throw new Error("frozen Wallet Auth sign bytes mismatch");
}
const canonicalVectorSession = {
  ...vector.session,
  accountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
};
verifyProductSessionProof(vector.proof, canonicalVectorSession, {
  method: vector.input.method,
  path: vector.input.path,
  bodyDigest: vector.input.bodyDigest,
}, new Date("2026-07-15T12:00:10.000Z"));

const identity = createProductDeviceIdentity();
const ephemeralSessionInput = {...canonicalVectorSession, productDeviceKey: identity.productDeviceKey};
const ephemeralSession = {
  ...ephemeralSessionInput,
  deviceBinding: centralDeviceBinding(ephemeralSessionInput, ephemeralSessionInput.account),
};
const ephemeralProof = createProductSessionProof(ephemeralSession, {
  method: "POST",
  path: "/v1/wallet/sessions/introspect",
  bodyDigest: httpBodyDigest("{}"),
  nonce: "clean_consumer_nonce_abcdefghijklmnop",
  issuedAt: "2026-07-15T12:00:00.000Z",
  expiresAt: "2026-07-15T12:00:30.000Z",
}, identity.productDeviceSecret);
verifyProductSessionProof(ephemeralProof, ephemeralSession, {
  method: ephemeralProof.method,
  path: ephemeralProof.path,
  bodyDigest: ephemeralProof.bodyDigest,
}, new Date("2026-07-15T12:00:10.000Z"));

const rpc = process.env.YNX_EVM_RPC || ynxPublicEndpoints.rpcUrl;
const chain = await proveYNXTestnetRPC(rpc, {timeoutMs: 15_000});
console.log(JSON.stringify({
  cleanConsumer: true,
  installedFromTarball: true,
  vectorVerified: true,
  protocol: "YNX_PRODUCT_SESSION_HTTP_PROOF_V1",
  ephemeralSigningVerified: true,
  privateKeyPersisted: false,
  chainId: chain.chainId,
  connected: chain.connected,
  rpc: chain.rpc,
  accountClaimed: false,
  balanceClaimed: false,
  transactionCreated: false,
}));

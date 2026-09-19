import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON, createProductSessionProofV2, createProductSessionRequest, createWalletSessionControlProof, httpBodyDigest, ProductSessionGatewayKernel, signProductSessionApproval, signProductSessionChallenge } from "../../src/index.js";
import { migrateProductSessionControlSnapshotV2 } from "../../src/product-session-control-intent.js";

export const registry = JSON.parse(readFileSync(new URL("../../product-session-registry.json", import.meta.url)));
export const OWNER = "1".padStart(64, "0"), OTHER = "2".padStart(64, "0");
export const BASE = Date.parse("2026-09-06T10:00:00.000Z"), at = (ms = 0) => new Date(BASE + ms);
export const token = (text) => createHash("sha256").update(text).digest("base64url");
export const deviceSecret = Buffer.alloc(32, 41).toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(Buffer.from(deviceSecret, "base64url"), true)).toString("base64url");
export const ACCOUNT_PATH = "/v2/product-sessions/wallet/sessions/revoke-all", DEVICE_PATH = "/v2/product-sessions/wallet/devices/revoke";
let sequence = 0;
export const requestId = () => `req_control_v3_${String(++sequence).padStart(12, "0")}`;
export const result = response => JSON.parse(response.body);
export function kernel(snapshot) {
  const source = snapshot ?? migrateProductSessionControlSnapshotV2(new ProductSessionGatewayKernel(registry, () => token(requestId())).snapshot());
  return new ProductSessionGatewayKernel(registry, () => token(requestId()), source);
}
export function pending(label, { offset = 0, owner = OWNER, productId = "creator-studio", deviceId = "control-v3-shared-device" } = {}) {
  const product = registry.products.find(item => item.productId === productId);
  const request = createProductSessionRequest(registry, { productId, platform: "web", deviceId, deviceKey, scopes: [product.scopes[0]], purpose: "Verify durable account and device logout.", nonce: token(label + ":nonce"), state: token(label + ":state") }, at(offset));
  const approval = signProductSessionApproval(registry, request, { accountSecret: owner, scopes: request.scopes, expiresAt: request.expiresAt }, at(offset));
  return { request, approval };
}
export function input(path, body, { id = requestId(), proof = null, walletControlProof = null } = {}) {
  return { requestId: id, method: "POST", path, body, proof, walletControlProof, networkAvailable: true };
}
export function session(gateway, label, options = {}) {
  const approved = pending(label, options), offset = options.offset ?? 0;
  const challengeInput = input("/v2/product-sessions/challenge", approved), challengeResponse = gateway.dispatch(challengeInput, at(offset));
  if (challengeResponse.status !== 200) throw new Error(challengeResponse.body);
  const challenge = result(challengeResponse).result;
  const completeInput = input("/v2/product-sessions/complete", { ...approved, completion: signProductSessionChallenge(challenge, deviceSecret) });
  const completeResponse = gateway.dispatch(completeInput, at(offset));
  if (completeResponse.status !== 200) throw new Error(completeResponse.body);
  return { approved, challenge, challengeInput, completeInput, completeResponse, session: result(completeResponse).result };
}
export function intentBody(label, binding, { issued = 0, expires = 600_000 } = {}) {
  return { intentId: token(label), intentIssuedAt: at(issued).toISOString(), intentExpiresAt: at(expires).toISOString(), ...(binding ? { deviceBinding: binding } : {}) };
}
export function ownerInput(path, body, { offset = 0, owner = OWNER, nonce = token(requestId()), id = requestId() } = {}) {
  const walletControlProof = createWalletSessionControlProof({ accountSecret: owner, method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce, issuedAt: at(offset).toISOString(), expiresAt: at(offset + 30_000).toISOString() });
  return input(path, body, { walletControlProof, id });
}
export function introspect(gateway, sessionValue, offset = 0) {
  const path = "/v2/product-sessions/introspect", body = { requiredScopes: [] };
  const proof = createProductSessionProofV2(sessionValue, { method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token(requestId()), issuedAt: at(offset).toISOString(), expiresAt: at(offset + 30_000).toISOString() }, deviceSecret);
  return gateway.dispatch(input(path, body, { proof }), at(offset));
}

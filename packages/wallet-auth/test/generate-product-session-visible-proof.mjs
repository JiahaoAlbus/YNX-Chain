#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionProofV2, createProductSessionRequest,
  createProductSessionReturnURL, httpBodyDigest, parseProductSessionReturnURL,
  prepareWalletOpen, ProductSessionGatewayKernel, signProductSessionApproval,
  signProductSessionChallenge, walletConnectionChoices,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const token = (label) => createHash("sha256").update(label).digest("base64url");
const secret = Buffer.alloc(32, 13), secretText = secret.toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
let challengeIndex = 0;
const gateway = new ProductSessionGatewayKernel(registry, () => token(`visible-challenge-${challengeIndex++}`));
const pending = createProductSessionRequest(registry, {
  productId: "social", platform: "macos", deviceId: "visible-device-001", deviceKey,
  scopes: ["account:read", "profile:link"], purpose: "Validate the visible Product Session router recovery flow.",
  nonce: token("visible-nonce"), state: token("visible-state"),
}, NOW);
const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
const call = (requestId, path, body, proof = null, networkAvailable = true, target = gateway) => target.dispatch({ requestId, method: "POST", path, body, proof, networkAvailable }, NOW);
const challengeResponse = call("req_visible_challenge_001", "/v2/product-sessions/challenge", { request: pending, approval });
const challengeReplayResponse = call("req_visible_challenge_001", "/v2/product-sessions/challenge", { request: pending, approval });
const challenge = JSON.parse(challengeResponse.body).result;
const completionBody = { request: pending, approval, completion: signProductSessionChallenge(challenge, secretText) };
const completeResponse = call("req_visible_complete_001", "/v2/product-sessions/complete", completionBody);
const completeReplayResponse = call("req_visible_complete_001", "/v2/product-sessions/complete", completionBody);
const session = JSON.parse(completeResponse.body).result;
const introspectionBody = { requiredScopes: ["account:read"] };
const proof = (label, path, body) => createProductSessionProofV2(session, { method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token(label), issuedAt: NOW.toISOString(), expiresAt: "2026-08-14T01:00:30.000Z" }, secretText);
const introspectionResponse = call("req_visible_introspect_001", "/v2/product-sessions/introspect", introspectionBody, proof("visible-proof-1", "/v2/product-sessions/introspect", introspectionBody));
const restarted = new ProductSessionGatewayKernel(registry, () => token(`visible-restart-${challengeIndex++}`), gateway.snapshot());
const restartResponse = call("req_visible_restart_001", "/v2/product-sessions/introspect", introspectionBody, proof("visible-proof-2", "/v2/product-sessions/introspect", introspectionBody), true, restarted);
const offlineResponse = call("req_visible_offline_001", "/v2/product-sessions/introspect", introspectionBody, null, false, restarted);
const rejectionURL = createProductSessionReturnURL(registry, pending, { result: "rejected", reason: "user_rejected" }, NOW);
const rejection = parseProductSessionReturnURL(registry, pending, rejectionURL, NOW);
const revokeBody = {};
const revokeResponse = call("req_visible_revoke_001", "/v2/product-sessions/revoke", revokeBody, proof("visible-proof-3", "/v2/product-sessions/revoke", revokeBody), true, restarted);
const revokedResponse = call("req_visible_revoked_001", "/v2/product-sessions/introspect", introspectionBody, proof("visible-proof-4", "/v2/product-sessions/introspect", introspectionBody), true, restarted);
const notInstalled = prepareWalletOpen(registry, pending, { networkAvailable: true, walletInstalled: false, schemeRegistered: false }, NOW);
const ready = prepareWalletOpen(registry, pending, { networkAvailable: true, walletInstalled: true, schemeRegistered: true }, NOW);
const guest = walletConnectionChoices(registry, "social", { ynxWalletInstalled: false, metaMaskAvailable: true }).find((item) => item.id === "guest");
const missingMetaMask = walletConnectionChoices(registry, "dex", { ynxWalletInstalled: false, metaMaskAvailable: false }).find((item) => item.id === "metamask");

const proofDocument = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixtureBoundary: "LOCAL PROTOCOL FIXTURE — deterministic test keys, no production login, balance, transaction or public deployment claim",
  protocolVersion: "2",
  product: { productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback },
  session: { sessionBinding: session.sessionBinding, account: session.account, deviceBinding: session.deviceBinding, nonce: session.nonce, state: session.state, scopes: session.scopes, issuedAt: session.issuedAt, expiresAt: session.expiresAt },
  flows: [
    { id: "wallet-installed", label: "YNX Wallet installed", outcome: ready.status, requestId: "local-router-only", detail: "Validated allowlisted ynxwallet://authorize route" },
    { id: "wallet-not-installed", label: "YNX Wallet not installed", outcome: notInstalled.status, requestId: "local-router-only", detail: notInstalled.message },
    { id: "metamask-not-installed", label: "MetaMask not installed (EVM only)", outcome: missingMetaMask.action, requestId: "local-router-only", detail: missingMetaMask.url },
    { id: "approved", label: "Wallet approval + Gateway completion", outcome: completeResponse.status === 200 ? "connected" : "rejected", requestId: "req_visible_complete_001", detail: session.sessionBinding },
    { id: "challenge-response-loss", label: "Challenge response lost + Retry", outcome: challengeReplayResponse.body === challengeResponse.body ? "idempotent" : "rejected", requestId: "req_visible_challenge_001", detail: "Same request ID and canonical body returned the exact issued challenge" },
    { id: "completion-response-loss", label: "Completion response lost + Retry", outcome: completeReplayResponse.body === completeResponse.body ? "idempotent" : "rejected", requestId: "req_visible_complete_001", detail: "Same request ID returned the exact Session without consuming the request twice" },
    { id: "rejected", label: "User rejected", outcome: rejection.status, requestId: "local-router-only", detail: rejection.message },
    { id: "introspection", label: "Sender-constrained introspection", outcome: introspectionResponse.status === 200 ? "active" : "rejected", requestId: "req_visible_introspect_001", detail: "Method, path, body, product, bundle/package, origin, callback, account and device bound" },
    { id: "second-open", label: "Second app open", outcome: restartResponse.status === 200 ? "restored-after-introspection" : "rejected", requestId: "req_visible_restart_001", detail: "Gateway state snapshot restored; cached session re-introspected" },
    { id: "network-loss", label: "Chain/Gateway network loss", outcome: JSON.parse(offlineResponse.body).error.code, requestId: "req_visible_offline_001", detail: "Cached session was not accepted offline; Retry remains required" },
    { id: "revoke", label: "Session revoke", outcome: revokeResponse.status === 200 ? "revoked" : "rejected", requestId: "req_visible_revoke_001", detail: session.sessionBinding },
    { id: "post-revoke", label: "Use after revoke", outcome: JSON.parse(revokedResponse.body).error.code, requestId: "req_visible_revoked_001", detail: "Fail closed after restart-safe revocation" },
    { id: "guest", label: "Guest / Try", outcome: "limited", requestId: "local-router-only", detail: guest.limitations.join(", ") }
  ],
  releaseBoundary: { implementedLocal: true, testedLocal: true, installedLocal: false, integratedCentral: false, deployedStaging: false, deployedPublic: false, downloadHosted: true, downloadHostedScope: "Android Testnet Preview artifact only", productionSigned: false, storeReleased: false }
};

const output = new URL("../evidence/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("product-session-visible-proof.json", output), `${JSON.stringify(proofDocument, null, 2)}\n`, { mode: 0o600 });
await writeFile(new URL("product-session-visible-proof.jsonl", output), `${restarted.snapshot().audit.map((event) => JSON.stringify(event)).join("\n")}\n`, { mode: 0o600 });
await writeFile(new URL("product-session-visible-proof.html", output), html(proofDocument), { mode: 0o600 });
console.log(JSON.stringify({ ok: true, output: "evidence/product-session-visible-proof.json", requestIds: proofDocument.flows.map((item) => item.requestId).filter((item) => item.startsWith("req_")), sessionBinding: session.sessionBinding }));

function html(document) {
  const rows = document.flows.map((item) => `<tr><td>${escape(item.label)}</td><td><span class="status">${escape(item.outcome)}</span></td><td><code>${escape(item.requestId)}</code></td><td>${escape(item.detail)}</td></tr>`).join("");
  const nativeIdentity = document.product.bundleId ?? document.product.packageId ?? "web-origin-only";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YNX Product Session v2 visible proof</title><style>body{margin:0;background:#f5f7fb;color:#111827;font:15px/1.5 system-ui}.wrap{max-width:1180px;margin:36px auto;padding:0 24px}.hero{background:#002fa7;color:white;padding:28px 32px;border-radius:18px}.tag{display:inline-block;background:#fff;color:#002fa7;padding:5px 10px;border-radius:999px;font-weight:750;font-size:12px}.hero h1{margin:14px 0 6px;font-size:32px}.hero p{margin:0;max-width:860px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0}.card{background:white;border:1px solid #dbe3f2;border-radius:14px;padding:15px;overflow-wrap:anywhere}.card b{display:block;color:#002fa7}.panel{background:white;border:1px solid #dbe3f2;border-radius:16px;overflow:hidden}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #edf1f7;vertical-align:top}th{background:#f8fafc}.status{font-weight:750;color:#002fa7}code{font-size:12px}.warning{margin-top:16px;border-left:4px solid #d97706;background:#fffbeb;padding:12px 14px}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}.panel{overflow:auto}} </style></head><body><main class="wrap"><section class="hero"><span class="tag">LOCAL PROTOCOL FIXTURE</span><h1>YNX Product Session Router v2</h1><p>${escape(document.fixtureBoundary)}</p></section><section class="grid"><div class="card"><b>Product</b>${escape(document.product.productId)}</div><div class="card"><b>Platform</b>${escape(document.product.platform)}</div><div class="card"><b>Native identity</b>${escape(nativeIdentity)}</div><div class="card"><b>Protocol</b>v${escape(document.protocolVersion)}</div><div class="card"><b>Scope</b>${escape(document.session.scopes.join(", "))}</div></section><section class="panel"><table><thead><tr><th>Visible flow</th><th>Outcome</th><th>Request ID</th><th>Protocol evidence</th></tr></thead><tbody>${rows}</tbody></table></section><div class="warning"><b>Truth boundary:</b> local signed protocol evidence only. No public deployment, production signature, store release, balance or transaction is claimed.</div></main></body></html>`;
}
function escape(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }

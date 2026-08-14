import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  strategyMandateDigest,
} from "../src/index.js";
import { CanonicalWalletGatewayNodeHost, encodeGatewayProofHeader } from "../src/gateway-node-host.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_KEY, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const APPROVAL_REVOKE = "/v1/wallet/approvals/revoke";
const DEVICE_REVOKE = "/v1/wallet/devices/revoke";
const INTROSPECT = "/v1/wallet/sessions/introspect";

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  const quant = registry.products.find(item => item.productId === "quant");
  quant.reviewState = "approved";
  quant.enabled = true;
  return registry;
}

function quantCompletion(registry) {
  const registration = registry.products.find(item => item.productId === "quant");
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: "kill_action_race_authorization_abcdefghijk",
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    productDeviceKey: PRODUCT_DEVICE_KEY,
    callback: registration.callbacks[0],
    scopes: [...registration.scopes],
    purpose: "Prove the Strategy Action and Kill Switch race fails closed.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, { challenge: "kill_action_race_challenge_abcdefghijkl", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

const VAULT = "0x6666666666666666666666666666666666666666";
const ROUTER = "0x7777777777777777777777777777777777777777";

function mandate(session) {
  const mandateId = "cross-process-kill-v2";
  return {schemaVersion:2,mandateId,account:session.account,productClientId:session.productClientId,sessionBinding:session.sessionBinding,strategyName:"Cross-process kill race",strategyHash:"61".repeat(32),strategyVersion:"2.0.0",engineCommit:"62".repeat(20),engineRelease:"quant-kill-race-testnet",executionKind:"dex-strategy-vault",executionAccount:VAULT,nonceDomain:`ynx:strategy:${session.account}:${session.productClientId}:${mandateId}`,allowedVenues:["ynx-dex"],allowedAssets:["USDC","YNXT"],allowedMarkets:["YNXT/USDC"],allowedMethods:["0x12345678","0x87654321"],allowedContracts:[VAULT,ROUTER],allowedTargets:[{address:VAULT,role:"vault",methods:["0x12345678"]},{address:ROUTER,role:"router",methods:["0x87654321"]}],maxCapital:100000,maxPosition:50000,maxLeverageBps:10000,maxOrder:10000,maxSlippageBps:100,maxGas:500000,maxFrequencyPerHour:12,dailyLossLimit:5000,drawdownLimit:10000,noWithdraw:true,ownerChangeAllowed:false,arbitraryTransferAllowed:false,unlimitedApprovalAllowed:false,computeDataFee:100,subscriptionFee:0,managementFeeBps:0,performanceFeeBps:0,highWaterMark:true,lossCarryForward:true,killSwitch:`https://gateway.ynxweb4.com/mandates/${mandateId}/kill`,revoke:`https://gateway.ynxweb4.com/mandates/${mandateId}/revoke`,emergencyExit:`https://gateway.ynxweb4.com/mandates/${mandateId}/exit`,userRiskAccepted:true,testnetNoValue:true,issuedAt:"2026-07-15T11:59:59.000Z",expiresAt:"2026-07-15T12:02:00.000Z",source:`https://gateway.ynxweb4.com/mandates/${mandateId}`,asOf:"2026-07-15T11:59:59.000Z",version:"2"};
}

function strategyAction(value, nonce) {
  return {schemaVersion:1,mandateId:value.mandateId,mandateDigest:strategyMandateDigest(value),account:value.account,productClientId:value.productClientId,sessionBinding:value.sessionBinding,nonceDomain:value.nonceDomain,nonce,venue:"ynx-dex",asset:"YNXT",market:"YNXT/USDC",target:VAULT,method:"0x12345678",capital:80000,position:40000,leverageBps:10000,order:5000,slippageBps:80,gas:300000,executionsInCurrentHour:3,dailyLoss:100,drawdown:200,at:NOW.toISOString()};
}

function completion(registry) {
  const registration = registry.products.find(item => item.productId === "social");
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: "revocation_control_race_abcdefghijklmnop",
    purpose: "Prove Approval and Device revoke controls linearize across Gateway processes.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: "revocation_control_race_challenge_abcdefghijkl",
    expiresAt: "2026-07-15T12:03:00.000Z",
  }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function proof(session, path, nonce, body = "{}") {
  return encodeGatewayProofHeader(createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce,
    issuedAt: NOW.toISOString(),
    expiresAt: "2026-07-15T12:00:30.000Z",
  }, PRODUCT_DEVICE_SECRET));
}

async function listen(host) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function listenProcess(statePath) {
  const script = fileURLToPath(new URL("./helpers/gateway-node-shared-state-child.mjs", import.meta.url));
  const child = fork(script, [statePath], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const port = await new Promise((resolve, reject) => {
    child.once("message", message => resolve(message.port));
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Gateway child exited before listening (${code}): ${stderr}`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Gateway child close failed (${code}): ${stderr}`)));
      child.send("close");
    }),
  };
}

async function post(base, path, body, header = null) {
  const headers = { "content-type": "application/json" };
  if (header !== null) headers["x-ynx-product-session-proof"] = header;
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body });
  const payload = await response.json();
  return { code: payload.error?.code ?? null, status: response.status };
}

test("independent-process Approval and Device revokes both persist before all later authority fails closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-revocation-controls-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const initializer = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const initialServer = await listen(initializer);
  try {
    assert.equal((await post(initialServer.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry)))).status, 200);
  } finally {
    await initialServer.close();
  }
  const session = initializer.snapshot().sessionStore.sessions[0];
  const approval = await listenProcess(statePath);
  const device = await listenProcess(statePath);
  let results;
  try {
    results = await Promise.all([
      post(approval.base, APPROVAL_REVOKE, "{}", proof(session, APPROVAL_REVOKE, "control_race_approval_abcdefghijkl")),
      post(device.base, DEVICE_REVOKE, "{}", proof(session, DEVICE_REVOKE, "control_race_device_abcdefghijklmn")),
    ]);
  } finally {
    await Promise.all([approval.close(), device.close()]);
  }
  assert.deepEqual(results.map(item => item.status), [200, 200]);

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const snapshot = restarted.snapshot();
  assert.deepEqual(snapshot.sessionStore.revokedApprovalDigests, [session.approvalDigest]);
  assert.deepEqual(snapshot.sessionStore.revokedDeviceBindings, [session.deviceBinding]);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "approval-revoked").length, 1);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "device-revoked").length, 1);
  assert.equal(snapshot.consumedProductProofs.length, 2);

  const server = await listen(restarted);
  try {
    const body = canonicalJSON({ requiredScopes: ["account:read"] });
    const rejected = await post(server.base, INTROSPECT, body, proof(session, INTROSPECT, "control_race_after_revocation_abcdef", body));
    assert.equal(rejected.status, 403);
    assert.equal(rejected.code, "REVOKED");
  } finally {
    await server.close();
  }
  assert.equal(restarted.snapshot().consumedProductProofs.length, 2);
  assert.deepEqual(new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }).snapshot(), restarted.snapshot());
});

test("independent-process Strategy Action and Kill Switch linearize to a durable killed mandate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-kill-action-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const initializer = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const initialServer = await listen(initializer);
  let session;
  const activatePath = "/v1/wallet/mandates/activate";
  try {
    assert.equal((await post(initialServer.base, "/v1/wallet/sessions/complete", canonicalJSON(quantCompletion(registry)))).status, 200);
    session = initializer.snapshot().sessionStore.sessions.find(item => item.productClientId === "ynx-quant-v1");
    const value = mandate(session);
    const body = canonicalJSON({ mandate: value });
    assert.equal((await post(initialServer.base, activatePath, body, proof(session, activatePath, "kill_action_activate_abcdefghijkl", body))).status, 200);
  } finally { await initialServer.close(); }

  const value = mandate(session);
  const actionPath = "/v1/wallet/mandates/authorize-action";
  const killPath = "/v1/wallet/mandates/kill";
  const actionBody = canonicalJSON({ mandateId: value.mandateId, action: strategyAction(value, "kill-action-000001") });
  const killBody = canonicalJSON({ mandateId: value.mandateId });
  const actor = await listenProcess(statePath);
  const killer = await listenProcess(statePath);
  let results;
  try {
    results = await Promise.all([
      post(actor.base, actionPath, actionBody, proof(session, actionPath, "kill_action_execute_abcdefghijkl", actionBody)),
      post(killer.base, killPath, killBody, proof(session, killPath, "kill_action_switch_abcdefghijklmn", killBody)),
    ]);
  } finally { await Promise.all([actor.close(), killer.close()]); }
  assert.equal(results[1].status, 200);
  assert.ok(results[0].status === 200 || (results[0].status === 409 && results[0].code === "MANDATE_KILLED"));

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const snapshot = restarted.snapshot();
  assert.deepEqual(snapshot.mandateStore.killedMandateDigests, [strategyMandateDigest(value)]);
  assert.equal(snapshot.mandateStore.audit.filter(item => item.type === "mandate-killed").length, 1);
  assert.ok(snapshot.mandateStore.consumedActionNonces.length === 0 || snapshot.mandateStore.consumedActionNonces.length === 1);
  const proofsBefore = snapshot.consumedProductProofs.length;
  const server = await listen(restarted);
  try {
    const afterBody = canonicalJSON({ mandateId: value.mandateId, action: strategyAction(value, "kill-action-000002") });
    const rejected = await post(server.base, actionPath, afterBody, proof(session, actionPath, "kill_action_after_kill_abcdefghijkl", afterBody));
    assert.deepEqual(rejected, { code: "MANDATE_KILLED", status: 409 });
  } finally { await server.close(); }
  assert.equal(restarted.snapshot().consumedProductProofs.length, proofsBefore);
  assert.deepEqual(new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }).snapshot(), restarted.snapshot());
});

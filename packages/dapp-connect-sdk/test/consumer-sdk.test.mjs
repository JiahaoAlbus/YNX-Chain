import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {
  DAppConnectClient, DAppConnectError, PendingCallbackStore, StandardWalletConnection, YNX_TESTNET,
  classifyWalletError, compatibilityCheck, createSiweMessage, discoverEIP6963, enhanceWithProductSession, loadBundledManifest, manifestPayloadSha256, runCompatibilityLab, selectHealthyEndpoint, validateEndpointManifest
} from "../src/index.js";

const account = "0x1111111111111111111111111111111111111111";
function provider({chainId = "0x1917", reject} = {}) {
  const calls = [];
  return {calls, async request(request) { calls.push(request); if (reject?.[request.method]) throw reject[request.method]; if (request.method === "eth_requestAccounts") return [account]; if (request.method === "eth_chainId") return chainId; if (request.method === "personal_sign") return "0xsigned"; if (request.method === "eth_signTypedData_v4") return "0xtyped"; if (request.method === "eth_sendTransaction") return "0xtx"; if (request.method === "wallet_switchEthereumChain") return null; throw new Error(`unexpected ${request.method}`); }};
}
function storage() { const items = new Map(); return {getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key)}; }

test("first-party DApps accept any standard EIP-1193 wallet and expose only the EVM account", async () => {
  const fake = provider(); const wallet = new StandardWalletConnection(fake);
  assert.deepEqual(await wallet.connect(), {account, chainId: "0x1917", state: "STANDARD_CONNECTED"});
  assert.equal(await wallet.signMessage("hello"), "0xsigned");
  assert.equal(await wallet.signTypedData({types: {}, domain: {}, primaryType: "Mail", message: {}}), "0xtyped");
  assert.equal(await wallet.sendTransaction({to: account, value: "0x0"}), "0xtx");
  assert.equal(fake.calls.some(call => call.method === "eth_requestAccounts"), true);
  assert.equal(YNX_TESTNET.evmChainId, 6423);
});

test("external standard EVM DApps can discover YNX Wallet without YNX product registration", async () => {
  const listeners = new Map(); const ynxProvider = provider();
  const windowLike = {
    addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(event) { if (event.type === "eip6963:requestProvider") listeners.get("eip6963:announceProvider")?.({detail: {info: {uuid: "ynx-wallet", name: "YNX Wallet", rdns: "com.ynx.wallet"}, provider: ynxProvider}}); return true; }
  };
  const discovered = await discoverEIP6963(windowLike, {timeoutMs: 1});
  assert.equal(discovered.length, 1); assert.equal(discovered[0].info.name, "YNX Wallet");
  const wallet = new StandardWalletConnection(discovered[0].provider); assert.equal((await wallet.connect()).account, account);
});

test("standard wallet connection survives optional Product Session gateway failure", async () => {
  const wallet = new StandardWalletConnection(provider()); await wallet.connect();
  const result = await enhanceWithProductSession({standardConnection: wallet, complete: async () => { throw {status: 503, message: "gateway maintenance", requestId: "request-1"}; }});
  assert.equal(result.state, "PRIVATE_SERVICE_DEGRADED");
  assert.equal(result.code, "PRODUCT_SESSION_GATEWAY_UNREACHABLE");
  assert.equal(result.requestId, "request-1");
  assert.equal(wallet.account, account);
});

test("callback records are durable before launch and cannot be replayed or substituted", () => {
  let now = Date.parse("2026-08-20T00:00:00.000Z"); const callbacks = new PendingCallbackStore(storage(), {now: () => now});
  const input = {requestDigest: "digest", nonce: "nonce", productClientId: "ynx-developer-v1", bundleId: "com.ynx.developer", callback: "ynx-developer://wallet", deviceKeyReference: "keychain:device-key", expiresAt: "2026-08-20T01:00:00.000Z"};
  const pending = callbacks.begin(input);
  assert.equal(callbacks.consume({pendingId: pending.pendingId, response: "signed-response", ...input}).state, "CONSUMED");
  assert.throws(() => callbacks.consume({pendingId: pending.pendingId, response: "signed-response", ...input}), error => error.code === "CALLBACK_REPLAY");
  const second = callbacks.begin({...input, nonce: "nonce-2"});
  assert.throws(() => callbacks.consume({pendingId: second.pendingId, response: "signed-response", ...input}), error => error.code === "CALLBACK_MISMATCH");
  now = Date.parse("2026-08-20T02:00:00.000Z"); assert.throws(() => callbacks.consume({pendingId: second.pendingId, response: "signed-response", ...second}), error => error.code === "CALLBACK_EXPIRED");
});

test("typed errors do not collapse Device Proof, protocol, expiry, gateway, and EIP-1193 errors into Offline", () => {
  assert.equal(classifyWalletError({code: "INVALID_DEVICE_PROOF"}).code, "PRODUCT_SESSION_DEVICE_PROOF_REJECTED");
  assert.equal(classifyWalletError({code: "UNKNOWN_OR_MISSING_FIELD"}).code, "PRODUCT_SESSION_PROTOCOL_REJECTED");
  assert.equal(classifyWalletError({code: "EXPIRED"}).code, "PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW");
  assert.equal(classifyWalletError({status: 502}).code, "PRODUCT_SESSION_GATEWAY_UNREACHABLE");
  assert.equal(classifyWalletError({code: 4001}).code, "WALLET_USER_REJECTED");
});

test("endpoint manifest activation rejects unverified, expired, loopback, and wrong-chain manifests", async () => {
  const manifest = {schemaVersion: "1.0.0", expiresAt: "2026-08-21T00:00:00.000Z", evmChainId: 6423, evmChainHex: "0x1917", rpc: "https://rpc.ynxweb4.com", evmRpc: "https://evm.ynxweb4.com", rest: "https://rest.ynxweb4.com", walletGateway: "https://wallet-auth.ynxweb4.com", appGateway: "https://gateway.ynxweb4.com", faucet: "https://faucet.ynxweb4.com", explorer: "https://explorer.ynxweb4.com", indexer: "https://indexer.ynxweb4.com", monitor: "https://monitor.ynxweb4.com", healthUrl: "https://monitor.ynxweb4.com/health", versionUrl: "https://monitor.ynxweb4.com/version"};
  const accepted = await validateEndpointManifest(manifest, {now: Date.parse("2026-08-20T00:00:00.000Z"), verifySignature: async value => value === manifest});
  assert.equal(accepted.verification, "VERIFIED");
  await assert.rejects(() => validateEndpointManifest(manifest), error => error.code === "ENDPOINT_MANIFEST_UNVERIFIED");
  await assert.rejects(() => validateEndpointManifest({...manifest, rpc: "http://127.0.0.1:8545"}, {verifySignature: async () => true}), error => error.code === "ENDPOINT_MANIFEST_INVALID");
  await assert.rejects(() => validateEndpointManifest({...manifest, evmChainId: 1}, {verifySignature: async () => true}), error => error.code === "ENDPOINT_MANIFEST_WRONG_CHAIN");
});

test("SIWE is standard EVM message creation and requires no YNX product registration", () => {
  const message = createSiweMessage({domain: "external-dapp.example", address: account, uri: "https://external-dapp.example/login", nonce: "12345678"});
  assert.match(message, /external-dapp\.example wants you to sign in/); assert.match(message, /Chain ID: 6423/);
});

test("the unified client keeps a standard connection when Product Session enhancement fails", async () => {
  const client = new DAppConnectClient({provider: provider()});
  assert.deepEqual(await client.connectWallet(), {account, chainId: "0x1917", state: "STANDARD_CONNECTED"});
  const degraded = await client.upgradeToYNXProductSession({complete: async () => { throw {status: 503, requestId: "upgrade-1"}; }});
  assert.equal(degraded.state, "PRIVATE_SERVICE_DEGRADED");
  assert.deepEqual(client.getAccounts(), [account]);
  assert.equal(client.getServiceStatus().standardConnection, "CONNECTED");
});

test("candidate manifests are diagnosable but cannot activate endpoints or Faucet deep links", async () => {
  const candidate = {schemaVersion: "1.0.0", status: "CANDIDATE_NOT_ACCEPTED", integrity: {status: "UNSIGNED_CANDIDATE"}, network: {evmChainId: 6423}, endpoints: {faucet: "https://faucet.ynxweb4.com"}};
  await assert.rejects(() => loadBundledManifest(candidate), error => error.code === "ENDPOINT_MANIFEST_NOT_ACCEPTED");
  assert.deepEqual(compatibilityCheck({...candidate, expiresAt: null}), {compatible: false, code: "ENDPOINT_MANIFEST_EXPIRED"});
  const client = new DAppConnectClient({endpointManifest: candidate, opener: async value => value});
  await assert.rejects(() => client.openWalletFaucet(), error => error.code === "ENDPOINT_MANIFEST_NOT_ACCEPTED");
});

test("accepted bundled endpoint manifest activates only after its canonical SHA-256 check", async () => {
  const manifest = {schemaVersion: "1.0.0", status: "ACCEPTED_BUNDLED_CONSUMER_CONTRACT", expiresAt: "2026-09-20T08:45:00.000Z", cosmosChainId: "ynx_6423-1", evmChainId: 6423, evmChainHex: "0x1917", nativeAsset: "YNXT", rpc: "https://rpc.ynxweb4.com", evmRpc: "https://evm.ynxweb4.com", rest: "https://rest.ynxweb4.com", walletGateway: "https://wallet-auth.ynxweb4.com", appGateway: "https://gateway.ynxweb4.com", faucet: "https://faucet.ynxweb4.com", explorer: "https://explorer.ynxweb4.com", indexer: "https://indexer.ynxweb4.com", monitor: "https://monitor.ynxweb4.com", healthUrl: "https://monitor.ynxweb4.com/health", versionUrl: "https://monitor.ynxweb4.com/version", endpointStates: {evmRpc: {status: "VERIFIED"}, faucet: {status: "DEGRADED"}}};
  manifest.integrity = {status: "BUNDLED_SHA256_ACCEPTED", payloadSha256: manifestPayloadSha256(manifest)};
  const accepted = await loadBundledManifest(manifest, {now: Date.parse("2026-08-20T00:00:00.000Z")});
  assert.equal(accepted.verification, "BUNDLED_SHA256_ACCEPTED");
  await assert.rejects(() => loadBundledManifest({...manifest, rpc: "https://tampered.example"}, {now: Date.parse("2026-08-20T00:00:00.000Z")}), error => error.code === "ENDPOINT_MANIFEST_INTEGRITY_FAILED");
});

test("endpoint health selection and Compatibility Lab report real outcomes without invented passes", async () => {
  assert.equal(await selectHealthyEndpoint(["https://first.example", "https://second.example"], {healthCheck: async value => value.includes("second")}), "https://second.example/");
  const report = await runCompatibilityLab({scenarios: {"eip6963-discovery": async () => ({providers: 1})}});
  assert.equal(report.passed, 1); assert.equal(report.skipped, 9);
});

test("migration scanner and artwork validator flag release hazards", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-dapp-sdk-"));
  try {
    writeFileSync(join(directory, "bad.js"), "const rpc='http://localhost:8545'; const s='Device Proof rejected';");
    const {spawnSync} = await import("node:child_process");
    const scan = spawnSync(process.execPath, ["tools/scan-legacy-wallet-integration.mjs", directory], {cwd: new URL("..", import.meta.url), encoding: "utf8"});
    assert.equal(scan.status, 2); assert.match(scan.stdout, /LOOPBACK_ENDPOINT/);
    writeFileSync(join(directory, "art.json"), JSON.stringify({productId: "calendar", artworkVersion: "1", sourceVector: "a.svg", appIcon: "a.png", launchSplash: "s.png", screenshots: ["x.png"]}));
    const art = spawnSync(process.execPath, ["tools/validate-artwork-manifest.mjs", join(directory, "art.json")], {cwd: new URL("..", import.meta.url), encoding: "utf8"});
    assert.equal(art.status, 2); assert.match(art.stdout, /ARTWORK_VALIDATION_FAILED/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

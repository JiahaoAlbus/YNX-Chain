import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyMessage, verifyTypedData, Wallet } from "ethers";
import { parseCallbackURL, requestDigest, verifyAuthorization, walletIdentity } from "@ynx-chain/wallet-auth";
import { APPROVAL_TTL_MS, DesktopWalletAuthority, MemoryPermissionStore, YNX_EIP155_CHAIN, YNX_EVM_CHAIN_ID } from "../src/desktop-wallet-authority.mjs";
import { FilePermissionStore } from "../src/desktop-permission-store.mjs";
import { DesktopWalletVault } from "../src/desktop-wallet-vault.mjs";
import { WALLETCONNECT_CHAIN, WALLETCONNECT_METHODS, WalletConnectTransport } from "../src/walletconnect-transport.mjs";
import { decodeWalletConnectQR } from "../src/walletconnect-qr-decoder.mjs";

const SECRET = "0000000000000000000000000000000000000000000000000000000000000001";
const SECOND_SECRET = "0000000000000000000000000000000000000000000000000000000000000002";
const ORIGIN = "https://example-dapp.invalid";

test("desktop Wallet exposes no account before explicit origin approval", async () => {
  const { authority, status } = await fixture();
  assert.equal(YNX_EVM_CHAIN_ID, "0x1917");
  assert.equal(YNX_EIP155_CHAIN, "eip155:6423");
  assert.equal((await authority.request({ origin: ORIGIN, method: "eth_chainId" })).result, "0x1917");
  assert.deepEqual((await authority.request({ origin: ORIGIN, method: "eth_accounts" })).result, []);
  const pending = await authority.request({ origin: ORIGIN, method: "eth_requestAccounts" });
  assert.equal(pending.status, "approval-required");
  assert.equal(pending.request.review.account, status.account);
  assert.deepEqual((await authority.approve(pending.request.id)).result, [status.account]);
  assert.deepEqual((await authority.request({ origin: ORIGIN, method: "eth_accounts" })).result, [status.account]);
  assert.deepEqual((await authority.request({ origin: "https://other.invalid", method: "eth_accounts" })).result, []);
});

test("rejection, permission widening, non-HTTPS origins and unsupported methods fail closed", async () => {
  const { authority } = await fixture();
  const pending = await authority.request({ origin: ORIGIN, method: "eth_requestAccounts" });
  assert.throws(() => authority.reject(pending.request.id), error => error.code === 4001 && error.data.code === "USER_REJECTED_REQUEST");
  await assert.rejects(authority.request({ origin: "http://example.invalid", method: "eth_accounts" }), error => error.code === 4100);
  await assert.rejects(authority.request({ origin: ORIGIN, method: "eth_sign" }), error => error.code === 4200);
  await assert.rejects(authority.request({ origin: ORIGIN, method: "wallet_requestPermissions", params: [{ eth_accounts: {}, eth_sendTransaction: {} }] }), error => error.code === -32602);
});

test("approved personal_sign and EIP-712 signatures recover only the approved account", async () => {
  const { authority, status } = await fixture();
  await approveAccount(authority);
  const message = "0x594e582057616c6c657420617574686f72697479";
  const personal = await authority.request({ origin: ORIGIN, method: "personal_sign", params: [message, status.account] });
  const personalSignature = (await authority.approve(personal.request.id)).result;
  assert.equal(verifyMessage(Buffer.from(message.slice(2), "hex"), personalSignature).toLowerCase(), status.account);

  const typed = {
    domain: { name: "YNX DApp", version: "1", chainId: 6423 },
    primaryType: "Action",
    types: { EIP712Domain: [], Action: [{ name: "purpose", type: "string" }] },
    message: { purpose: "First-party approval test" }
  };
  const request = await authority.request({ origin: ORIGIN, method: "eth_signTypedData_v4", params: [status.account, JSON.stringify(typed)] });
  const signature = (await authority.approve(request.request.id)).result;
  assert.equal(verifyTypedData(typed.domain, { Action: typed.types.Action }, typed.message, signature).toLowerCase(), status.account);
});

test("canonical authorize approval signs and returns only the registered callback payload", async () => {
  const { authority, status } = await fixture();
  const productDeviceKey = createECDH("prime256v1");
  productDeviceKey.setPrivateKey(Buffer.alloc(32, 0x42));
  const authorization = {
    version: "1",
    nonce: "nonce_abcdefghijklmnopqrstuvwxyz12",
    chainId: "ynx_6423-1",
    requestingProduct: "social",
    productClientId: "ynx-social-v1",
    bundleId: "com.ynx.social",
    productDeviceAlgorithm: "p256-sha256",
    productDeviceKey: productDeviceKey.getPublicKey(null, "compressed").toString("base64url"),
    callback: "ynx-social://com.ynx.social",
    scopes: ["account:read", "profile:link"],
    purpose: "Link this YNX account to the selected Social profile on this device.",
    issuedAt: "2026-08-22T00:00:00.000Z",
    expiresAt: "2026-08-22T00:05:00.000Z"
  };
  const approved = await authority.approveCanonicalAuthorization(authorization, "2026-08-22T00:01:00.000Z");
  const response = parseCallbackURL(approved.callbackUrl, authorization.callback);
  const verified = verifyAuthorization(response, { ...authorization, requestDigest: requestDigest(authorization), now: new Date("2026-08-22T00:01:00.000Z") });
  assert.equal(verified.account, status.ynxAccount);
  assert.deepEqual(verified.grantedScopes, authorization.scopes);
  assert.match(approved.callbackUrl, /^ynx-social:\/\/com\.ynx\.social\?response=/);
});

test("transaction review binds account, chain and exact values before transport", async () => {
  let observed = null;
  const transactionSender = { async send(wallet, transaction) { observed = { account: wallet.address.toLowerCase(), transaction }; return `0x${"ab".repeat(32)}`; } };
  const { authority, status } = await fixture(transactionSender);
  await approveAccount(authority);
  const pending = await authority.request({ origin: ORIGIN, method: "eth_sendTransaction", params: [{ from: status.account, to: "0x0000000000000000000000000000000000000002", value: "0x1", chainId: "0x1917" }] });
  assert.equal(pending.request.review.value, "0x1");
  assert.equal((await authority.approve(pending.request.id)).result, `0x${"ab".repeat(32)}`);
  assert.equal(observed.account, status.account);
  assert.equal(observed.transaction.chainId, "0x1917");
  await assert.rejects(authority.request({ origin: ORIGIN, method: "eth_sendTransaction", params: [{ from: status.account, chainId: "0x1" }] }), error => error.code === -32602);
});

test("vault encrypts the secret and the permission store persists only public authority", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ynx-wallet-authority-"));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: value => value.toString("utf8").slice("encrypted:".length)
  };
  const vaultPath = path.join(directory, "vault.json");
  const permissionsPath = path.join(directory, "permissions.json");
  const vault = new DesktopWalletVault({ filePath: vaultPath, safeStorage, randomSecret: () => SECRET });
  const status = await vault.createAccount();
  assert.match(status.account, /^0x[0-9a-f]{40}$/);
  assert.doesNotMatch(await readFile(vaultPath, "utf8"), new RegExp(SECRET));
  const permissions = new FilePermissionStore(permissionsPath);
  await permissions.grantAccount(ORIGIN, status.account, "2026-08-22T00:00:00.000Z");
  const serialized = await readFile(permissionsPath, "utf8");
  assert.match(serialized, new RegExp(status.account));
  assert.doesNotMatch(serialized, /private|secret|seed|mnemonic/i);
});

test("account switching persists both encrypted accounts and revokes every DApp permission and pending request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ynx-wallet-account-switch-"));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: value => value.toString("utf8").slice("encrypted:".length)
  };
  const secrets = [SECRET, SECOND_SECRET];
  const vaultPath = path.join(directory, "vault.json");
  const permissions = new FilePermissionStore(path.join(directory, "permissions.json"));
  const vault = new DesktopWalletVault({ filePath: vaultPath, safeStorage, randomSecret: () => secrets.shift() });
  const first = await vault.createAccount();
  const authority = new DesktopWalletAuthority({ vault, permissions, requestId: () => "pending-before-switch", clock: () => new Date("2026-08-22T00:00:00Z") });
  await authority.approveOrigin(ORIGIN);
  const pending = await authority.request({ origin: ORIGIN, method: "personal_sign", params: ["0x01", first.account] });
  assert.equal(pending.status, "approval-required");
  const second = await authority.addAccountAndSelect();
  assert.notEqual(second.account, first.account);
  assert.equal(second.accounts.length, 2);
  assert.deepEqual((await authority.request({ origin: ORIGIN, method: "eth_accounts" })).result, []);
  await assert.rejects(authority.approve("pending-before-switch"), error => error.data.code === "UNKNOWN_OR_EXPIRED_REQUEST");
  const restoredFirst = await authority.selectAccount(first.account);
  assert.equal(restoredFirst.account, first.account);
  assert.equal(restoredFirst.accounts.length, 2);
  assert.deepEqual((await authority.request({ origin: ORIGIN, method: "eth_accounts" })).result, []);
  const serialized = await readFile(vaultPath, "utf8");
  assert.doesNotMatch(serialized, new RegExp(SECRET));
  assert.doesNotMatch(serialized, new RegExp(SECOND_SECRET));
});

test("multi-account vault migrates from a read-only v1 fallback without breaking installer rollback", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ynx-wallet-vault-rollback-"));
  const legacyPath = path.join(directory, "wallet-vault-v1.json");
  const currentPath = path.join(directory, "wallet-vault-v2.json");
  const identity = walletIdentity(SECRET);
  const legacy = {
    schemaVersion: 1,
    account: new Wallet(`0x${SECRET}`).address.toLowerCase(),
    ynxAccount: identity.account,
    publicKey: identity.accountPublicKey,
    encryptedSecret: Buffer.from(`encrypted:${SECRET}`, "utf8").toString("base64"),
    createdAt: "2026-08-21T00:00:00.000Z"
  };
  await writeFile(legacyPath, `${JSON.stringify(legacy)}\n`);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: value => value.toString("utf8").slice("encrypted:".length)
  };
  const vault = new DesktopWalletVault({ filePath: currentPath, legacyFilePath: legacyPath, safeStorage, randomSecret: () => SECOND_SECRET });
  assert.equal((await vault.status()).account, legacy.account);
  const added = await vault.addAccountAndSelect();
  assert.equal(added.accounts.length, 2);
  assert.notEqual(added.account, legacy.account);
  assert.deepEqual(JSON.parse(await readFile(legacyPath, "utf8")), legacy);
  const current = JSON.parse(await readFile(currentPath, "utf8"));
  assert.equal(current.schemaVersion, 2);
  assert.equal(current.accounts.length, 2);
});

test("pending approvals expire, are bounded, and cannot survive permission revocation", async () => {
  let now = new Date("2026-08-22T00:00:00Z");
  let id = 0;
  const directory = await mkdtemp(path.join(os.tmpdir(), "ynx-wallet-expiry-"));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: value => value.toString("utf8").slice("encrypted:".length)
  };
  const vault = new DesktopWalletVault({ filePath: path.join(directory, "vault.json"), safeStorage, randomSecret: () => SECRET });
  await vault.createAccount();
  const authority = new DesktopWalletAuthority({ vault, permissions: new MemoryPermissionStore(), requestId: () => `bounded-${++id}`, clock: () => now });
  const account = (await authority.accountStatus()).account;
  await authority.approveOrigin(ORIGIN);
  const expired = await authority.request({ origin: ORIGIN, method: "personal_sign", params: ["0x01", account] });
  now = new Date(now.getTime() + APPROVAL_TTL_MS + 1);
  await assert.rejects(authority.approve(expired.request.id), error => error.data.code === "REQUEST_EXPIRED");
  const revoked = await authority.request({ origin: ORIGIN, method: "personal_sign", params: ["0x02", account] });
  await authority.request({ origin: ORIGIN, method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  await assert.rejects(authority.approve(revoked.request.id), error => error.data.code === "UNKNOWN_OR_EXPIRED_REQUEST");
  await authority.approveOrigin(ORIGIN);
  const transportExpired = await authority.request({ origin: ORIGIN, method: "personal_sign", params: ["0x02", account] });
  assert.equal(authority.expire(transportExpired.request.id), true);
  assert.equal(authority.expire(transportExpired.request.id), false);
  await assert.rejects(authority.approve(transportExpired.request.id), error => error.data.code === "UNKNOWN_OR_EXPIRED_REQUEST");
  await authority.approveOrigin(ORIGIN);
  for (let count = 0; count < 8; count += 1) await authority.request({ origin: ORIGIN, method: "personal_sign", params: ["0x03", account] });
  await assert.rejects(authority.request({ origin: ORIGIN, method: "personal_sign", params: ["0x04", account] }), error => error.data.code === "PENDING_REQUEST_LIMIT");
});

test("WalletConnect remains fail closed without a real project ID", async () => {
  const transport = new WalletConnectTransport({ projectId: "", metadata: { name: "YNX Wallet", description: "YNX Testnet Wallet", url: "https://wallet.ynxweb4.com", icons: [] } });
  assert.deepEqual(transport.status(), { configured: false, started: false, relayConnected: false, activeSessionCount: 0, code: "WALLETCONNECT_PROJECT_ID_UNAVAILABLE" });
  await assert.rejects(transport.start({}), error => error.code === "WALLETCONNECT_PROJECT_ID_UNAVAILABLE");
  assert.equal(WALLETCONNECT_CHAIN, "eip155:6423");
  assert.deepEqual(WALLETCONNECT_METHODS, ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]);
});

test("desktop QR import is local-only, bounded and accepts only WalletConnect v2", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  assert.match(html, /id="walletconnect-qr"[^>]+type="file"[^>]+accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(html, /QR images are decoded locally and are never uploaded/);
  assert.match(renderer, /file\.size > 10 \* 1024 \* 1024/);
  assert.match(renderer, /walletConnectDecodeQR/);
  assert.doesNotMatch(renderer, /fetch\([^)]*walletConnectQR|XMLHttpRequest|FormData/);
  const uri = "wc:0123456789abcdef@2?relay-protocol=irn&symKey=0123456789abcdef";
  let observed;
  const result = decodeWalletConnectQR({
    bytes: Buffer.from([1]),
    mimeType: "image/png",
    createImage: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toBitmap: () => Buffer.from([3, 2, 1, 255]) }),
    decode: (rgba, width, height, options) => { observed = { rgba: [...rgba], width, height, options }; return { data: uri }; }
  });
  assert.deepEqual(observed, { rgba: [1, 2, 3, 255], width: 1, height: 1, options: { inversionAttempts: "attemptBoth" } });
  assert.deepEqual(result, { uri, format: "qr_code", decodedLocally: true, uploaded: false });
  assert.throws(() => decodeWalletConnectQR({ bytes: Buffer.from([1]), mimeType: "image/png", createImage: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toBitmap: () => Buffer.alloc(4) }), decode: () => ({ data: "https://example.invalid" }) }), error => error.code === "INVALID_WALLETCONNECT_QR");
});

test("WalletConnect session approval exposes only eip155:6423 and the approved account", async () => {
  const handlers = new Map();
  let approved = null, paired = null;
  const fake = {
    on(name, handler) { handlers.set(name, handler); },
    async pair(input) { paired = input; return undefined; },
    async approveSession(input) { approved = input; return { topic: "session-topic", expiry: 2000000000, peer: { metadata: { name: "Example DApp", url: ORIGIN } }, namespaces: input.namespaces }; },
    getActiveSessions() { return {}; }
  };
  const observed = [];
  const transport = new WalletConnectTransport({
    projectId: "project-id-from-authorized-runtime",
    metadata: { name: "YNX Wallet", description: "YNX Testnet Wallet", url: "https://wallet.ynxweb4.com", icons: [] },
    walletKitFactory: async () => fake
  });
  await transport.start({ onSessionProposal: value => observed.push(value), onSessionRequest() {}, onSessionDelete() {}, onRequestExpire() {} });
  handlers.get("session_proposal")({ id: 7, params: { proposer: { metadata: { url: ORIGIN } }, requiredNamespaces: { eip155: { chains: ["eip155:6423"], methods: ["personal_sign"], events: ["accountsChanged"] } } } });
  assert.equal(transport.proposalOrigin("7"), ORIGIN);
  await transport.approveSession("7", "0x1234567890abcdef1234567890abcdef12345678");
  assert.deepEqual(approved.namespaces.eip155.chains, ["eip155:6423"]);
  assert.deepEqual(approved.namespaces.eip155.accounts, ["eip155:6423:0x1234567890abcdef1234567890abcdef12345678"]);
  assert.deepEqual(approved.namespaces.eip155.methods, ["personal_sign"]);
  assert.deepEqual(approved.namespaces.eip155.events, ["accountsChanged"]);
  await transport.pair("wc:0123456789abcdef@2?relay-protocol=irn&symKey=0123456789abcdef");
  assert.match(paired.uri, /^wc:/);
  assert.equal(observed.length, 1);
});

test("WalletConnect restores exact sessions, emits standard events and disconnects with the cached origin", async () => {
  const handlers = new Map();
  const restoredSession = {
    topic: "restored-session",
    expiry: 2000000000,
    peer: { metadata: { name: "First-party DApp", url: "https://card.ynxweb4.com/path" } },
    namespaces: { eip155: { accounts: ["eip155:6423:0x1234567890abcdef1234567890abcdef12345678"], methods: ["personal_sign", "eth_sendTransaction"], events: ["accountsChanged", "chainChanged"] } }
  };
  const emitted = [], disconnected = [];
  const fake = {
    core: { relayer: { connected: true } },
    on(name, handler) { handlers.set(name, handler); },
    getActiveSessions() { return { [restoredSession.topic]: restoredSession }; },
    async emitSessionEvent(input) { emitted.push(input); },
    async disconnectSession(input) { disconnected.push(input); }
  };
  const restored = [], deleted = [];
  const transport = new WalletConnectTransport({
    projectId: "authorized-project-id",
    metadata: { name: "YNX Wallet", description: "YNX Testnet Wallet", url: "https://wallet.ynxweb4.com", icons: [] },
    walletKitFactory: async () => fake
  });
  await transport.start({ onSessionRestore: session => restored.push(session), onSessionDelete: event => deleted.push(event) });
  assert.deepEqual(transport.status(), { configured: true, started: true, relayConnected: true, activeSessionCount: 1, code: null });
  assert.deepEqual(restored, [{ topic: "restored-session", origin: "https://card.ynxweb4.com", name: "First-party DApp", url: "https://card.ynxweb4.com/path", expiry: 2000000000 }]);
  assert.deepEqual(transport.sessions(), restored);
  const authorized = transport.authorizeRequest({ topic: restoredSession.topic, id: 41, params: { chainId: "eip155:6423", request: { method: "personal_sign", params: ["0x01", "0x1234567890abcdef1234567890abcdef12345678"] } } });
  assert.deepEqual(authorized, { topic: restoredSession.topic, jsonRpcId: 41, origin: "https://card.ynxweb4.com", method: "personal_sign", params: ["0x01", "0x1234567890abcdef1234567890abcdef12345678"] });
  assert.throws(() => transport.authorizeRequest({ topic: restoredSession.topic, id: 42, params: { chainId: "eip155:1", request: { method: "personal_sign", params: [] } } }), error => error.code === "UNSUPPORTED_WALLETCONNECT_CHAIN");
  assert.throws(() => transport.authorizeRequest({ topic: restoredSession.topic, id: 43, params: { chainId: "eip155:6423", request: { method: "eth_signTypedData_v4", params: [] } } }), error => error.code === "UNAUTHORIZED_WALLETCONNECT_METHOD");
  const account = "0x1234567890abcdef1234567890abcdef12345678";
  await transport.emitAccountAndChainChanged("restored-session", account);
  assert.deepEqual(emitted.map(item => item.event), [
    { name: "accountsChanged", data: [account] },
    { name: "chainChanged", data: "0x1917" }
  ]);
  const disconnectedResult = await transport.disconnectSession("restored-session");
  assert.equal(disconnectedResult.origin, "https://card.ynxweb4.com");
  assert.equal(disconnected.length, 1);
  assert.equal(disconnected[0].topic, "restored-session");
  assert.equal(disconnected[0].reason.code, 6000);
  await handlers.get("session_delete")({ topic: "restored-session" });
  assert.equal(deleted[0].origin, null);
  const expiredTransport = new WalletConnectTransport({
    projectId: "authorized-project-id",
    metadata: { name: "YNX Wallet", description: "YNX Testnet Wallet", url: "https://wallet.ynxweb4.com", icons: [] },
    walletKitFactory: async () => fake,
    clock: () => 2000000001000
  });
  await assert.rejects(expiredTransport.start({}), error => error.code === "INVALID_WALLETCONNECT_SESSION");
});

async function fixture(transactionSender = null) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ynx-wallet-authority-"));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: value => value.toString("utf8").slice("encrypted:".length)
  };
  const vault = new DesktopWalletVault({ filePath: path.join(directory, "vault.json"), safeStorage, randomSecret: () => SECRET });
  const status = await vault.createAccount();
  const authority = new DesktopWalletAuthority({ vault, permissions: new MemoryPermissionStore(), transactionSender, requestId: (() => { let id = 0; return () => `request-${++id}`; })(), clock: () => new Date("2026-08-22T00:00:00Z") });
  return { authority, status };
}
async function approveAccount(authority) { const request = await authority.request({ origin: ORIGIN, method: "eth_requestAccounts" }); await authority.approve(request.request.id); }

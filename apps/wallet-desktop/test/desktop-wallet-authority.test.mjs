import { fixtureKeyAuthorization } from "./fixture-key-authorization.mjs";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyMessage, verifyTypedData, Wallet } from "ethers";
import { createProductSessionRequest, parseProductSessionReturnURL, walletIdentity } from "@ynx-chain/wallet-auth";
import { PRODUCT_SESSION_REGISTRY } from "../src/wallet-auth-contract.mjs";
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
  await assert.rejects(authority.approveOrigin(ORIGIN, "0x" + "22".repeat(20)), error => error.data.code === "ACCOUNT_CHANGED");
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
    types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }], Action: [{ name: "purpose", type: "string" }] },
    message: { purpose: "First-party approval test" }
  };
  const request = await authority.request({ origin: ORIGIN, method: "eth_signTypedData_v4", params: [status.account, JSON.stringify(typed)] });
  assert.deepEqual(request.request.review.types, typed.types);
  assert.deepEqual(request.request.review.domain, typed.domain);
  assert.deepEqual(request.request.review.message, typed.message);
  assert.match(request.request.review.warning, /transfers/);
  assert.equal(Object.isFrozen(request.request.review.types.Action[0]), true);
  const signature = (await authority.approve(request.request.id)).result;
  assert.equal(verifyTypedData(typed.domain, { Action: typed.types.Action }, typed.message, signature).toLowerCase(), status.account);
});

test("canonical v2 approval signs only the reviewed account and exact registered callback", async () => {
  const { authority, status } = await fixture();
  const productDeviceKey = createECDH("prime256v1");
  productDeviceKey.setPrivateKey(Buffer.alloc(32, 0x42));
  const now = new Date("2026-08-22T00:00:00.000Z");
  const authorization = createProductSessionRequest(PRODUCT_SESSION_REGISTRY, {
    productId: "creator-studio", platform: "web", deviceId: "desktop-authority-test",
    deviceKey: productDeviceKey.getPublicKey(null, "compressed").toString("base64url"),
    nonce: "nonce_abcdefghijklmnopqrstuvwxyz12", state: "state_abcdefghijklmnopqrstuvwxyz12",
    scopes: ["creator:account", "creator:publish"], purpose: "Sign in to Creator Studio.",
  }, now);
  const issuedAt = "2026-08-22T00:01:00.000Z";
  await assert.rejects(authority.approveCanonicalAuthorization(authorization, issuedAt), error => error.data.code === "ACCOUNT_REVIEW_REQUIRED");
  await assert.rejects(authority.approveCanonicalAuthorization(authorization, issuedAt, "0x" + "22".repeat(20)), error => error.data.code === "ACCOUNT_CHANGED");
  const approved = await authority.approveCanonicalAuthorization(authorization, issuedAt, status.account);
  const verified = parseProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, authorization, approved.callbackUrl, new Date(issuedAt));
  assert.equal(verified.status, "ready");
  assert.equal(verified.approval.account, status.ynxAccount);
  assert.equal(verified.approval.origin, "https://creator.ynxweb4.com");
  assert.deepEqual(verified.approval.scopes, authorization.scopes);
  assert.match(approved.callbackUrl, /^https:\/\/creator\.ynxweb4\.com\/wallet-auth\/callback\?result=approved&approval=/);
  assert.equal(new URL(approved.callbackUrl).searchParams.get("nonce"), authorization.nonce);
  assert.equal(new URL(approved.callbackUrl).searchParams.get("state"), authorization.state);
  await assert.rejects(authority.approveCanonicalAuthorization(authorization, authorization.expiresAt, status.account), { code: "SESSION_EXPIRED" });
  await assert.rejects(authority.approveCanonicalAuthorization({ ...authorization, origin: "https://attacker.example" }, issuedAt, status.account), { code: "SESSION_BINDING_MISMATCH" });
});

test("transaction review binds account, chain and exact values before transport", async () => {
  let observed = null;
  const transactionSender = { prepare: prepareFixtureTransaction, async send(wallet, transaction) { observed = { account: wallet.address.toLowerCase(), transaction }; return `0x${"ab".repeat(32)}`; } };
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
  const vault = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath: vaultPath, safeStorage, randomSecret: () => SECRET });
  const status = await vault.createAccount();
  assert.match(status.account, /^0x[0-9a-f]{40}$/);
  assert.doesNotMatch(await readFile(vaultPath, "utf8"), new RegExp(SECRET));
  const permissions = new FilePermissionStore(permissionsPath);
  await permissions.grantAccount(ORIGIN, status.account, "2026-08-22T00:00:00.000Z");
  const serialized = await readFile(permissionsPath, "utf8");
  assert.match(serialized, new RegExp(status.account));
  assert.doesNotMatch(serialized, /private|secret|seed|mnemonic/i);
});

test("vault prefers async OS encryption and decrypts after a fresh vault instance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ynx-wallet-async-vault-"));
  const calls = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptStringAsync: async value => { calls.push("encrypt-async"); return Buffer.from(`async:${value}`, "utf8"); },
    decryptStringAsync: async value => { calls.push("decrypt-async"); return { result: value.toString("utf8").slice("async:".length), shouldReEncrypt: false }; },
    encryptString: () => { throw new Error("sync encryption must not be used"); },
    decryptString: () => { throw new Error("sync decryption must not be used"); }
  };
  const filePath = path.join(directory, "vault.json");
  const created = await new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath, safeStorage, randomSecret: () => SECRET }).createAccount();
  let observedSecret;
  const restarted = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath, safeStorage, randomSecret: () => SECOND_SECRET });
  await restarted.withSecret(secret => { observedSecret = secret; });
  assert.equal(observedSecret, SECRET);
  assert.equal((await restarted.status()).account, created.account);
  assert.deepEqual(calls, ["encrypt-async", "decrypt-async"]);
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
  const vault = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath: vaultPath, safeStorage, randomSecret: () => secrets.shift() });
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
  const vault = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath: currentPath, legacyFilePath: legacyPath, safeStorage, randomSecret: () => SECOND_SECRET });
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
  const vault = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath: path.join(directory, "vault.json"), safeStorage, randomSecret: () => SECRET });
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
  handlers.get("session_proposal")({ id: 7, expiryTimestamp: 2000000000, params: { proposer: { metadata: { url: ORIGIN } }, requiredNamespaces: { eip155: { chains: ["eip155:6423"], methods: ["personal_sign"], events: ["accountsChanged"] } } } });
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

test("WalletConnect drops expired or non-HTTPS proposals before approval UI and serializes proposal actions", async () => {
  const handlers = new Map();
  const invalid = [];
  let releaseApproval;
  const fake = {
    on(name, handler) { handlers.set(name, handler); },
    getActiveSessions() { return {}; },
    async approveSession(input) {
      await new Promise(resolve => { releaseApproval = resolve; });
      return { topic: "approved-topic", expiry: 2000001000, peer: { metadata: { name: "Example DApp", url: ORIGIN } }, namespaces: input.namespaces };
    }
  };
  const transport = new WalletConnectTransport({
    projectId: "authorized-project-id",
    metadata: { name: "YNX Wallet", description: "YNX Testnet Wallet", url: "https://wallet.ynxweb4.com", icons: [] },
    walletKitFactory: async () => fake,
    clock: () => 2000000000000
  });
  const visible = [];
  await transport.start({ onSessionProposal: proposal => visible.push(proposal.id), onProposalInvalid: value => invalid.push(value) });
  const namespace = { requiredNamespaces: { eip155: { chains: ["eip155:6423"], methods: ["personal_sign"], events: ["accountsChanged"] } } };
  handlers.get("session_proposal")({ id: 8, expiryTimestamp: 1999999999, params: { proposer: { metadata: { url: ORIGIN } }, ...namespace } });
  handlers.get("session_proposal")({ id: 9, expiryTimestamp: 2000000100, params: { proposer: { metadata: { url: "http://insecure.example" } }, ...namespace } });
  assert.deepEqual(visible, []);
  assert.deepEqual(invalid.map(value => value.code), ["EXPIRED_WALLETCONNECT_PROPOSAL", "INVALID_WALLETCONNECT_PEER"]);
  handlers.get("session_proposal")({ id: 10, expiryTimestamp: 2000000100, params: { proposer: { metadata: { url: ORIGIN } }, ...namespace } });
  assert.deepEqual(visible, [10]);
  const approving = transport.approveSession(10, "0x1234567890abcdef1234567890abcdef12345678");
  await assert.rejects(transport.approveSession(10, "0x1234567890abcdef1234567890abcdef12345678"), error => error.code === "WALLETCONNECT_PROPOSAL_ACTION_IN_PROGRESS");
  releaseApproval();
  await approving;
  await assert.rejects(transport.approveSession(10, "0x1234567890abcdef1234567890abcdef12345678"), error => error.code === "UNKNOWN_WALLETCONNECT_PROPOSAL");
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
  const authorized = transport.authorizeRequest({ topic: restoredSession.topic, id: 41, params: { chainId: "eip155:6423", request: { method: "personal_sign", params: ["0x01", "0x1234567890abcdef1234567890abcdef12345678"] } } }, "0x1234567890abcdef1234567890abcdef12345678");
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
  const vault = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath: path.join(directory, "vault.json"), safeStorage, randomSecret: () => SECRET });
  const status = await vault.createAccount();
  const authority = new DesktopWalletAuthority({ vault, permissions: new MemoryPermissionStore(), transactionSender, requestId: (() => { let id = 0; return () => `request-${++id}`; })(), clock: () => new Date("2026-08-22T00:00:00Z") });
  return { authority, status };
}
async function approveAccount(authority) { const request = await authority.request({ origin: ORIGIN, method: "eth_requestAccounts" }); await authority.approve(request.request.id); }
async function prepareFixtureTransaction(account, transaction) { return Object.freeze({ ...transaction, from: account, data: transaction.data ?? "0x", chainId: "0x1917", nonce: "0x0", type: 0, gasLimit: "0x6270", gasPrice: "0x3b9aca00" }); }

test("transaction review contains the exact immutable RPC snapshot and never signs during preparation", async () => {
  let snapshot, sent;
  const { authority, status } = await fixture({
    async prepare(account, transaction) { snapshot = await prepareFixtureTransaction(account, transaction); return snapshot; },
    async send(_wallet, transaction) { sent = transaction; return `0x${"ab".repeat(32)}`; }
  });
  await approveAccount(authority);
  const transaction = { from: status.account, to: `0x${"22".repeat(20)}`, value: "0x1", data: `0x${"a1".repeat(400)}` };
  const pending = (await authority.request({ origin: ORIGIN, method: "eth_sendTransaction", params: [transaction] })).request;
  assert.equal(sent, undefined); assert.equal(pending.params[0], snapshot);
  for (const [key, value] of Object.entries(snapshot)) assert.deepEqual(pending.review[key], value);
  assert.equal(pending.review.amount, "0.000000000000000001");
  assert.equal(pending.review.maximumFee, "0.0000252");
  assert.equal(pending.review.total, "0.000025200000000001");
  assert.equal(pending.review.symbol, "YNXT");
  assert.equal(Object.isFrozen(pending.params), true);
  assert.equal(Object.isFrozen(pending.review), true);
  transaction.data = "0x"; transaction.to = status.account;
  await authority.approve(pending.id);
  assert.equal(sent, snapshot); assert.equal(sent.data.length, 802);
});

test("preparation failure and account or permission changes during RPC never produce approval", async () => {
  for (const mutation of ["failure", "account", "permission"]) {
    let authority;
    const sender = { async prepare(account, transaction) {
      if (mutation === "failure") throw Object.assign(new Error("missing RPC fee"), { data: { code: "RPC_FEE_UNAVAILABLE" } });
      if (mutation === "account") await authority.vault.importAccount({ kind: "private-key", value: SECOND_SECRET });
      if (mutation === "permission") await authority.revokeOrigin(ORIGIN);
      return prepareFixtureTransaction(account, transaction);
    }, async send() { assert.fail("must never sign"); } };
    const setup = await fixture(sender); authority = setup.authority;
    await approveAccount(authority);
    await assert.rejects(authority.request({ origin: ORIGIN, method: "eth_sendTransaction", params: [{ from: setup.status.account, to: `0x${"22".repeat(20)}`, value: "0x1" }] }), error => error.data.code === { failure: "RPC_FEE_UNAVAILABLE", account: "ACCOUNT_CHANGED", permission: "ACCOUNT_PERMISSION_REVOKED" }[mutation]);
    assert.equal(authority.pendingRequests().length, 0);
  }
});

test("typed data cannot mislabel the actual signed primary type or domain field schema", async () => {
  const { authority, status } = await fixture(); await approveAccount(authority);
  const typed = { domain: { name: "Test", chainId: 6423 }, primaryType: "Action", types: { Action: [{ name: "amount", type: "uint256" }] }, message: { amount: "1" } };
  for (const invalid of [{ ...typed, primaryType: "HarmlessMessage" }, { ...typed, types: { ...typed.types, EIP712Domain: [] } }, { ...typed, message: { amount: "not-an-integer" } }]) await assert.rejects(authority.request({ origin: ORIGIN, method: "eth_signTypedData_v4", params: [status.account, JSON.stringify(invalid)] }), error => error.code === -32602);
  assert.equal(authority.pendingRequests().length, 0);
  const pending = (await authority.request({ origin: ORIGIN, method: "eth_signTypedData_v4", params: [status.account, JSON.stringify(typed)] })).request;
  assert.deepEqual(pending.review.types.EIP712Domain, [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }]);
});


test("a key switch after provider permission checks cannot sign the previously reviewed account request", async () => {
  for (const method of ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]) {
    let sent = false;
    const { authority, status } = await fixture({ prepare: prepareFixtureTransaction, async send() { sent = true; return `0x${"ab".repeat(32)}`; } });
    await approveAccount(authority);
    const typed = { domain: { name: "Account-bound test", chainId: 6423 }, primaryType: "Action", types: { Action: [{ name: "value", type: "uint256" }] }, message: { value: "1" } };
    const params = method === "personal_sign" ? ["0x01", status.account] : method === "eth_signTypedData_v4" ? [status.account, JSON.stringify(typed)] : [{ from: status.account, to: "0x" + "22".repeat(20), value: "0x1" }];
    const pending = await authority.request({ origin: ORIGIN, method, params });
    authority.vault.withSecret = action => action(SECOND_SECRET, { account: new Wallet(`0x${SECOND_SECRET}`).address.toLowerCase() });
    await assert.rejects(authority.approve(pending.request.id), error => error.data.code === "ACCOUNT_CHANGED");
    assert.equal(sent, false);
  }
});

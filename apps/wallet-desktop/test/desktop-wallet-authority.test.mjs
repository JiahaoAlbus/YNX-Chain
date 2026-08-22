import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyMessage, verifyTypedData } from "ethers";
import { DesktopWalletAuthority, MemoryPermissionStore, YNX_EIP155_CHAIN, YNX_EVM_CHAIN_ID } from "../src/desktop-wallet-authority.mjs";
import { FilePermissionStore } from "../src/desktop-permission-store.mjs";
import { DesktopWalletVault } from "../src/desktop-wallet-vault.mjs";
import { WALLETCONNECT_CHAIN, WALLETCONNECT_METHODS, WalletConnectTransport } from "../src/walletconnect-transport.mjs";

const SECRET = "0000000000000000000000000000000000000000000000000000000000000001";
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

test("WalletConnect remains fail closed without a real project ID", async () => {
  const transport = new WalletConnectTransport({ projectId: "", metadata: { name: "YNX Wallet", description: "YNX Testnet Wallet", url: "https://wallet.ynxweb4.com", icons: [] } });
  assert.deepEqual(transport.status(), { configured: false, connected: false, code: "WALLETCONNECT_PROJECT_ID_UNAVAILABLE" });
  await assert.rejects(transport.start({}), error => error.code === "WALLETCONNECT_PROJECT_ID_UNAVAILABLE");
  assert.equal(WALLETCONNECT_CHAIN, "eip155:6423");
  assert.deepEqual(WALLETCONNECT_METHODS, ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]);
});

test("WalletConnect session approval exposes only eip155:6423 and the approved account", async () => {
  const handlers = new Map();
  let approved = null, paired = null;
  const fake = {
    on(name, handler) { handlers.set(name, handler); },
    async pair(input) { paired = input; return undefined; },
    async approveSession(input) { approved = input; return { topic: "session-topic" }; },
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
  assert.deepEqual(approved.namespaces.eip155.methods, ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]);
  await transport.pair("wc:0123456789abcdef@2?relay-protocol=irn&symKey=0123456789abcdef");
  assert.match(paired.uri, /^wc:/);
  assert.equal(observed.length, 1);
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

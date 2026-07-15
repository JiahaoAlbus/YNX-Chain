import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesToBase64Raw } from "../crypto/encoding";
import { chatEncryptionPublicKey, encryptChatMessage } from "../crypto/chatCrypto";
import { accountIdentity, deviceIdentifier, deviceIdentity } from "../crypto/ynxSigner";
import { YNXMobileAppClient } from "./mobileSession";

const accountSecret = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0);
const deviceSecret = new Uint8Array(32).fill(0x41);

test("establishes a native-bound session, signs a post, and revokes", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const authorizations: string[] = [];
  const account = accountIdentity(accountSecret).account;
  const deviceId = deviceIdentifier(deviceSecret);
  const publicKey = deviceIdentity(deviceSecret).deviceSigningPublicKey;
  const signBytes = bytesToBase64Raw(new TextEncoder().encode('{"domain":"YNX_APP_ACCOUNT_OWNERSHIP_V1"}'));
	const transactionHash = `0x${"a".repeat(64)}`;
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    requests.push({ path, init });
    if (path === "/app/session/challenges") return jsonResponse(201, { challengeId: "native-challenge-1", account, signBytes, signDocument: { account, deviceId, deviceSigningPublicKey: publicKey, origin: "ynx-mobile://com.ynxweb4.mobile", chainId: 6423 } });
	if (path.endsWith("/verify")) return jsonResponse(201, { account, deviceId, token: "s".repeat(43), expiresAt: "2026-07-14T12:30:00Z" });
	if (path.endsWith("/settle")) return jsonResponse(201, { id: "settlement_1", intentId: "intent_123", invoiceId: "invoice_123", merchant: "merchant_demo", payoutAddress: "ynx1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zcrwn4", payer: account, amount: 25, currency: "YNXT", transactionHash, blockNumber: 7, status: "paid", auditHash: "b".repeat(64), createdAt: "2026-07-14T12:01:00Z" });
    return jsonResponse(201, { ok: true });
  };
  const client = new YNXMobileAppClient({ accountSecret, deviceSecret, fetchImpl, now: () => new Date("2026-07-14T12:00:00Z"), authorize: async (purpose) => { authorizations.push(purpose); } });
  await client.connect();
  await client.createPost("native post", "post-native-1");
	const settlement = await client.settlePayInvoice("invoice_123", transactionHash, "settle-mobile-1");
	assert.equal(settlement.payer, account);
  await client.disconnect(true);
  assert.deepEqual(requests.map((request) => request.path), [
    "/app/session/challenges",
    "/app/session/challenges/native-challenge-1/verify",
    "/app/square/devices",
		"/app/chat/devices",
    "/app/square/posts",
		"/app/pay/invoices/invoice_123/settle",
    `/app/square/devices/${deviceId}/revoke`,
		`/app/chat/devices/${deviceId}/revoke`,
    "/app/session/revoke",
  ]);
  assert.deepEqual(authorizations, ["ownership-proof", "signed-post", "device-revocation"]);
  for (const request of requests) assert.equal((request.init?.headers as Record<string, string>)["X-YNX-Client"], "ynx-mobile-v1");
  const serialized = JSON.stringify(requests);
  assert.equal(serialized.includes(Buffer.from(accountSecret).toString("hex")), false);
  assert.equal(serialized.includes(Buffer.from(deviceSecret).toString("hex")), false);
  assert.match(String((requests[4]?.init?.headers as Record<string, string>)["X-YNX-Device-Signature"]), /^[A-Za-z0-9+/]+$/);
	assert.equal(String(requests[5]?.init?.body).includes("payer"), false);
});

test("lists, sends, decrypts, and acknowledges native Chat messages", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const account = accountIdentity(accountSecret).account;
  const deviceId = deviceIdentifier(deviceSecret);
  const publicKey = deviceIdentity(deviceSecret).deviceSigningPublicKey;
  const bob = "ynx1llllllllllllllllllllllllllllllllyj698f";
  const bobDeviceSecret = new Uint8Array(32).fill(0x42);
  const conversation = { id: "conv_mobile_chat", members: [account, bob], createdBy: account, createdAt: "2026-07-14T12:00:00Z", updatedAt: "2026-07-14T12:01:00Z" };
  const incomingEnvelope = encryptChatMessage({ deviceSecret: bobDeviceSecret, recipientPublicKey: chatEncryptionPublicKey(deviceSecret), conversationId: conversation.id, messageId: "message_incoming", plaintext: "hello from Bob", nonce: new Uint8Array(24).fill(0x31) });
  const signBytes = bytesToBase64Raw(new TextEncoder().encode('{"domain":"YNX_APP_ACCOUNT_OWNERSHIP_V1"}'));
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname;
    requests.push({ path, init });
    if (path === "/app/session/challenges") return jsonResponse(201, { challengeId: "native-chat-challenge", account, signBytes, signDocument: { account, deviceId, deviceSigningPublicKey: publicKey, origin: "ynx-mobile://com.ynxweb4.mobile", chainId: 6423 } });
    if (path.endsWith("/verify")) return jsonResponse(201, { account, deviceId, token: "c".repeat(43), expiresAt: "2026-07-14T12:30:00Z" });
    if (path === "/app/chat/conversations") return jsonResponse(200, { conversations: [conversation] });
    if (path === `/app/chat/accounts/${bob}/devices`) return jsonResponse(200, { devices: [{ id: "bob-device", account: bob, signingPublicKey: "Qg", encryptionPublicKey: chatEncryptionPublicKey(bobDeviceSecret), status: "active", createdAt: "2026-07-14T12:00:00Z", updatedAt: "2026-07-14T12:00:00Z" }] });
    if (path.endsWith("/messages") && init?.method === "GET") return jsonResponse(200, { messages: [{ id: "message_incoming", conversationId: conversation.id, sender: bob, senderDeviceId: "bob-device", ...incomingEnvelope, ciphertextHash: "a".repeat(64), createdAt: "2026-07-14T12:02:00Z", deliveredAt: {}, readAt: {} }] });
    return jsonResponse(201, { ok: true });
  };
  const client = new YNXMobileAppClient({ accountSecret, deviceSecret, fetchImpl, now: () => new Date("2026-07-14T12:05:00Z"), authorize: permitLocalKeyUse });
  await client.connect({ registerSquare: false });
  const conversations = await client.listChatConversations();
  assert.equal(conversations[0]?.id, conversation.id);
  await client.sendChatMessage(conversations[0]!, "hello Bob", "message_outgoing", new Uint8Array(24).fill(0x32));
  const messages = await client.listChatMessages(conversations[0]!);
  assert.equal(messages[0]?.plaintext, "hello from Bob");
  assert.equal(messages[0]?.decryptionError, null);
  await client.acknowledgeChatMessage(conversation.id, "message_incoming", "read");
  const chatRequests = requests.filter((request) => request.path.startsWith("/app/chat/"));
  assert.deepEqual(chatRequests.map((request) => request.init?.method), ["POST", "GET", "GET", "POST", "GET", "GET", "POST"]);
  for (const request of chatRequests.slice(1)) assert.match(String((request.init?.headers as Record<string, string>)["X-YNX-Device-Signature"]), /^[A-Za-z0-9+/]+$/);
  const sent = JSON.parse(String(chatRequests[3]?.init?.body));
  assert.equal(sent.plaintext, undefined);
  assert.equal(sent.algorithm, "x25519-hkdf-sha256-xchacha20poly1305");
  client.lock();
});

test("aborts a stalled native ownership request", async () => {
  const fetchImpl = async (_input: string, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
  });
  const client = new YNXMobileAppClient({ accountSecret, deviceSecret, fetchImpl, timeoutMs: 10, authorize: permitLocalKeyUse });
  await assert.rejects(client.connect(), /request aborted/);
  assert.equal(client.connected, false);
  client.lock();
});

test("expires a session locally before a signed mutation", async () => {
  let now = new Date("2026-07-14T12:00:00Z");
  const client = connectedClient({ now: () => now });
  await client.connect();
  assert.equal(client.connected, true);
  now = new Date("2026-07-14T12:31:00Z");
  assert.equal(client.connected, false);
  await assert.rejects(client.createPost("expired", "post-expired-1"), /disconnected or expired/);
  client.lock();
});

test("clears an active session after an authorization failure", async () => {
  const client = connectedClient({ mutationStatus: 401 });
  await client.connect();
  await assert.rejects(client.createPost("denied", "post-denied-1"), /session revoked/);
  assert.equal(client.connected, false);
  client.lock();
});

test("locks locally before best-effort session revocation completes", async () => {
  let finishRevoke: (() => void) | undefined;
  const client = connectedClient({
    revokeResponse: () => new Promise((resolve) => {
      finishRevoke = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }),
  });
  await client.connect();
  const revocation = client.lockAndRevokeSession();
  assert.equal(client.connected, false);
  assert.ok(finishRevoke);
  finishRevoke();
  await revocation;
});

test("refuses ownership network traffic when local authorization fails", async () => {
  let requests = 0;
  const client = new YNXMobileAppClient({
    accountSecret,
    deviceSecret,
    fetchImpl: async () => { requests += 1; return jsonResponse(500, {}); },
    authorize: async () => { throw new Error("biometric denied"); },
  });
  await assert.rejects(client.connect(), /biometric denied/);
  assert.equal(requests, 0);
  assert.equal(client.connected, false);
  client.lock();
});

test("refuses signed post creation when local authorization fails", async () => {
  const purposes: string[] = [];
  const client = connectedClient({
    authorize: async (purpose) => {
      purposes.push(purpose);
      if (purpose === "signed-post") throw new Error("biometric denied");
    },
  });
  await client.connect();
  await assert.rejects(client.createPost("denied locally", "post-local-denied"), /biometric denied/);
  assert.deepEqual(purposes, ["ownership-proof", "signed-post"]);
  assert.equal(client.connected, true);
  client.lock();
});

test("revokes only services registered by the current client session", async () => {
  const paths: string[] = [];
  const client = connectedClient({ paths });
  await client.connect({ registerChat: false });
  await client.disconnect(true);
  assert.equal(paths.includes("/app/square/devices"), true);
  assert.equal(paths.some((path) => path.startsWith("/app/chat/")), false);
  assert.equal(paths.some((path) => path.startsWith("/app/square/devices/") && path.endsWith("/revoke")), true);
  client.lock();
});

function connectedClient(options: {
  now?: () => Date;
  mutationStatus?: number;
  revokeResponse?: () => Promise<Response>;
  authorize?: ConstructorParameters<typeof YNXMobileAppClient>[0]["authorize"];
	paths?: string[];
} = {}): YNXMobileAppClient {
  const account = accountIdentity(accountSecret).account;
  const deviceId = deviceIdentifier(deviceSecret);
  const publicKey = deviceIdentity(deviceSecret).deviceSigningPublicKey;
  const signBytes = bytesToBase64Raw(new TextEncoder().encode('{"domain":"YNX_APP_ACCOUNT_OWNERSHIP_V1"}'));
  const fetchImpl = async (input: string): Promise<Response> => {
    const path = new URL(input).pathname;
		options.paths?.push(path);
    if (path === "/app/session/challenges") return jsonResponse(201, { challengeId: "native-challenge-2", account, signBytes, signDocument: { account, deviceId, deviceSigningPublicKey: publicKey, origin: "ynx-mobile://com.ynxweb4.mobile", chainId: 6423 } });
    if (path.endsWith("/verify")) return jsonResponse(201, { account, deviceId, token: "t".repeat(43), expiresAt: "2026-07-14T12:30:00Z" });
    if (path === "/app/session/revoke" && options.revokeResponse) return options.revokeResponse();
    if (path === "/app/square/posts" && options.mutationStatus) return jsonResponse(options.mutationStatus, { error: "session revoked" });
    return jsonResponse(201, { ok: true });
  };
  return new YNXMobileAppClient({ accountSecret, deviceSecret, fetchImpl, now: options.now ?? (() => new Date("2026-07-14T12:00:00Z")), authorize: options.authorize ?? permitLocalKeyUse });
}

async function permitLocalKeyUse(): Promise<void> {}

function jsonResponse(status: number, value: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
}

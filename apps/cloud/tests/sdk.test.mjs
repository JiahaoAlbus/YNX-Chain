import assert from "node:assert/strict";
import test from "node:test";
import { decryptClientSideContent, encryptClientSideContent, generateClientSideEncryptionKey, YNXCloudClient, YNXCloudError } from "../sdk/index.js";

test("SDK binds the versioned endpoint and obtains a fresh product token", async () => {
  const calls = [];
  let tokens = 0;
  const client = new YNXCloudClient({
    endpoint: "https://cloud.testnet.invalid/",
    product: "cloud",
    getAccessToken: () => `session-${++tokens}`,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ items: [], limit: 25, scanned: 0 }), { status: 200, headers: { "Content-Type": "application/json", "X-Request-ID": "request_1" } });
    },
  });
  await client.list({ view: "recent", limit: 25 });
  await client.usage();
  assert.equal(calls[0].url, "https://cloud.testnet.invalid/api/v1/objects?view=recent&limit=25");
  assert.equal(calls[0].init.headers.get("Authorization"), "Bearer session-1");
  assert.equal(calls[1].url, "https://cloud.testnet.invalid/api/v1/usage");
  assert.equal(calls[1].init.headers.get("Authorization"), "Bearer session-2");
});

test("SDK surfaces request IDs and does not retry POST mutations", async () => {
  let calls = 0;
  const client = new YNXCloudClient({
    endpoint: "https://cloud.testnet.invalid",
    product: "docs",
    getAccessToken: () => "session",
    fetch: async () => {
      calls++;
      return new Response(JSON.stringify({ error: "scope denied" }), { status: 403, headers: { "Content-Type": "application/json", "X-Request-ID": "request_denied", "X-Error-ID": "error_denied" } });
    },
  });
  await assert.rejects(client.createObject({ kind: "doc", name: "x" }), error => {
    assert.ok(error instanceof YNXCloudError);
    assert.equal(error.status, 403);
    assert.equal(error.requestId, "request_denied");
    assert.equal(error.errorId, "error_denied");
    return true;
  });
  assert.equal(calls, 1);
});

test("SDK retries bounded idempotent reads on explicit backpressure", async () => {
  let calls = 0;
  const client = new YNXCloudClient({
    endpoint: "https://cloud.testnet.invalid/api/v1",
    product: "cloud",
    getAccessToken: () => "session",
    maxRetries: 2,
    fetch: async () => {
      calls++;
      if (calls < 3) return new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "0" } });
      return new Response(JSON.stringify({ usedBytes: 1, limitBytes: 2 }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.deepEqual(await client.quota(), { usedBytes: 1, limitBytes: 2 });
  assert.equal(calls, 3);
});

test("SDK sends exact destructive confirmations without mutation retries", async () => {
  const calls = [];
  const client = new YNXCloudClient({
    endpoint: "https://cloud.testnet.invalid",
    product: "cloud",
    getAccessToken: () => "session",
    maxRetries: 5,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ schemaVersion: 1, id: "erasure_1", product: "cloud" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  await client.deleteObject("obj_1");
  await client.eraseProductData();
  assert.deepEqual(calls, [
    { url: "https://cloud.testnet.invalid/api/v1/objects/obj_1", method: "DELETE", body: { confirm: "DELETE" } },
    { url: "https://cloud.testnet.invalid/api/v1/account-data", method: "DELETE", body: { confirm: "DELETE CLOUD DATA" } },
  ]);
});

test("SDK rejects ambiguous products and unsafe identifiers", async () => {
  assert.throws(() => new YNXCloudClient({ endpoint: "https://cloud.testnet.invalid", product: "*", getAccessToken: () => "x" }), /product/);
  const client = new YNXCloudClient({ endpoint: "https://cloud.testnet.invalid", product: "cloud", getAccessToken: () => "x", fetch: async () => new Response() });
  assert.throws(() => client.getObject(""), /identifier/);
});

test("SDK client encryption round-trips with exact product and account context", async () => {
  const key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  const context = { product: "cloud", account: "ynx1owner", contextId: "upload_20260729_001", version: 1 };
  const encrypted = await encryptClientSideContent({
    content: "private quant artifact",
    key,
    context,
    keyHint: "recovery-card-7",
    recoveryPolicy: "user-held offline recovery package",
  });
  assert.equal(encrypted.contentType, "application/vnd.ynx.cloud-encrypted+json");
  assert.deepEqual(encrypted.encryption, { clientSide: true, algorithm: "AES-256-GCM", keyHint: "recovery-card-7", recoveryPolicy: "user-held offline recovery package" });
  assert.equal(new TextDecoder().decode(await decryptClientSideContent({ content: encrypted.content, key, expectedContext: context })), "private quant artifact");
});

test("SDK client encryption fails closed for context mismatch and tampering", async () => {
  const key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  const context = { product: "docs", account: "ynx1owner", contextId: "document_export_1", version: 3 };
  const encrypted = await encryptClientSideContent({ content: new Uint8Array([1, 2, 3]), key, context, recoveryPolicy: "user-held recovery package" });
  await assert.rejects(decryptClientSideContent({ content: encrypted.content, key, expectedContext: { ...context, product: "cloud" } }), /context/);
  const envelope = JSON.parse(new TextDecoder().decode(encrypted.content));
  envelope.ciphertext = `${envelope.ciphertext.startsWith("A") ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
  await assert.rejects(decryptClientSideContent({ content: new TextEncoder().encode(JSON.stringify(envelope)), key, expectedContext: context }), /integrity|decrypt/);
});

test("SDK generates 256-bit client encryption keys and rejects weak inputs", async () => {
  const generated = await generateClientSideEncryptionKey();
  assert.match(generated, /^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(encryptClientSideContent({ content: "x", key: "AA", context: { product: "cloud", account: "ynx1owner", contextId: "x" }, recoveryPolicy: "user-held" }), /32 bytes/);
  await assert.rejects(encryptClientSideContent({ content: "x", key: generated, context: { product: "cloud", account: "", contextId: "x" }, recoveryPolicy: "user-held" }), /account/);
  await assert.rejects(encryptClientSideContent({ content: "x", key: generated, context: { product: "cloud", account: "ynx1owner", contextId: "x" }, recoveryPolicy: "" }), /recoveryPolicy/);
});

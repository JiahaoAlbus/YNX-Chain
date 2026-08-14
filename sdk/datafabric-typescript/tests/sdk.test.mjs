import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { DataFabricClient, ProducerClient, producerDeliverySignature } from "../dist/index.js";

const key = Buffer.from("0123456789abcdef0123456789abcdef");
const servers = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

test("producer delivery signature matches the Go contract vector", () => {
  const body = Buffer.from('{"eventId":"event.test.0001"}');
  const signature = producerDeliverySignature("key.sdk.0001", "2026-07-22T16:00:00Z", "nonce.sdk.0001", body, key);
  assert.equal(signature, "88e8d9488d71707904344a2cbf86844d845250fc54a4415f9cc7e6ecee24d1a1");
});

test("producer sends signed event and rejects unknown receipt fields", async () => {
  const event = signedEvent();
  let calls = 0;
  const fetcher = async (_url, init) => {
    calls++;
    assert.equal(init.headers["X-YNX-Producer-Key-ID"], "key.sdk.0001");
    assert.match(init.headers["X-YNX-Producer-Signature"], /^[0-9a-f]{64}$/u);
    return new Response(JSON.stringify({ eventId: event.eventId, status: "committed-to-outbox", auditId: event.auditId, unexpected: true }), { status: 202 });
  };
  const client = new ProducerClient("https://fabric.ynx.invalid", "key.sdk.0001", key, fetcher);
  await assert.rejects(client.send(event), /unknown or missing fields/u);
  assert.equal(calls, 1);
});

test("canonical client binds the exact request and accepts authoritative event pages", async () => {
  let binding;
  const provider = { credentials: async value => {
    binding = value;
    return { appSession: "opaque-session", sessionId: "session.sdk.0001", deviceId: "device.sdk.0001", product: "pay", bundleId: "app.ynx.pay", requestId: "request.sdk.0001", requestNonce: "nonce.sdk.0001", requestTime: "2026-07-22T16:00:00Z", deviceSignature: "canonical-signature" };
  } };
  const fetcher = async (_url, init) => {
    assert.equal(init.headers["X-YNX-Content-SHA256"], createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
    return new Response(JSON.stringify({ events: [], nextCursor: "", source: "ynx-operational-event-store", asOf: "2026-07-22T16:00:00Z", version: "0.2.0", status: "authoritative" }), { status: 200 });
  };
  const client = new DataFabricClient("https://fabric.ynx.invalid", provider, fetcher);
  const page = await client.events();
  assert.deepEqual(binding, { method: "GET", path: "/v1/events", contentSha256: createHash("sha256").update(Buffer.alloc(0)).digest("hex") });
  assert.equal(page.status, "authoritative");
});

test("clients reject insecure remote origins and unsafe credentials", async () => {
  assert.throws(() => new ProducerClient("http://fabric.ynx.invalid", "key.sdk.0001", key), /HTTPS/u);
  const provider = { credentials: async () => ({ appSession: "bad\nvalue", sessionId: "session.sdk.0001", deviceId: "device.sdk.0001", product: "pay", bundleId: "app.ynx.pay", requestId: "request.sdk.0001", requestNonce: "nonce.sdk.0001", requestTime: "2026-07-22T16:00:00Z", deviceSignature: "signature" }) };
  const client = new DataFabricClient("https://fabric.ynx.invalid", provider, async () => { throw new Error("must not be called"); });
  await assert.rejects(client.events(), /incomplete or unsafe/u);
});

test("producer rejects noncanonical or v1 Chain Core references before delivery", async () => {
  let called = false;
  const client = new ProducerClient("https://fabric.ynx.invalid", "key.sdk.0001", key, async () => { called = true; throw new Error("must not be called"); });
  const v1 = signedEvent();
  v1.chainCommitmentId = "0123456789abcdef0123456789abcdef";
  await assert.rejects(client.send(v1), /Envelope v2/u);
  assert.equal(called, false);
});

function signedEvent() {
  const event = {
    eventId: "event.pay.sdk.0001", eventType: "pay.invoice.created", schemaVersion: "1.0", product: "pay", service: "invoice", aggregateId: "invoice.sdk.0001",
    actor: { actorId: "actor.sdk.0001", accountId: "account.sdk.0001", sessionId: "session.sdk.0001" }, correlationId: "correlation.sdk.0001", sequence: 1,
    timestamp: "2026-07-22T16:00:00Z", effectiveAt: "2026-07-22T16:00:00Z", sourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", sourceRelease: "pay-testnet-v0",
    integrity: { algorithm: "hmac-sha256", keyId: "key.sdk.0001", digest: "", signature: "" }, privacyClassification: "confidential", retentionClass: "financial-7y", auditId: "audit.sdk.0001",
    source: { source: "sdk-test", asOf: "2026-07-22T16:00:00Z", version: "1", status: "authoritative" }, payload: { status: "created" },
  };
  const material = Buffer.from(JSON.stringify(event));
  event.integrity.digest = createHash("sha256").update(material).digest("hex");
  event.integrity.signature = createHmac("sha256", key).update(Buffer.from(event.integrity.digest, "hex")).digest("hex");
  return event;
}

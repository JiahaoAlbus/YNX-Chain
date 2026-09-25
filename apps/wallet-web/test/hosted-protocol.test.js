import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_CHAIN_ID, HOSTED_PROTOCOL, encodeHostedConnect, hostedEnvelope, parseHostedConnect, randomHostedId, registeredProduct, validateHostedMessage } from "../src/hosted-protocol.js";

const now = Date.now();
function request(origin = "https://finance.ynxweb4.com") { return { version: 1, origin, requestId: randomHostedId(), nonce: randomHostedId(), expiresAt: now + 90_000, chainId: HOSTED_CHAIN_ID }; }

test("only a reviewed Finance origin opens an exact bounded hosted connect request", () => {
  const value = request();
  assert.equal(registeredProduct(value.origin)?.productId, "finance");
  assert.deepEqual(parseHostedConnect(encodeHostedConnect(value), now), value);
  assert.throws(() => parseHostedConnect(encodeHostedConnect(request("https://evil.example")), now));
  assert.throws(() => parseHostedConnect(encodeHostedConnect({ ...value, expiresAt: now + 300_000 }), now));
  assert.throws(() => parseHostedConnect(encodeHostedConnect({ ...value, extra: "ignored?" }), now));
});

test("opener source, origin, nonce, expiry and one-use message ID all bind the same channel", () => {
  const value = request(), opener = {}, seen = new Set();
  const message = hostedEnvelope(value, "hello", {}, now);
  assert.equal(message.protocol, HOSTED_PROTOCOL);
  assert.equal(validateHostedMessage({ source: opener, origin: value.origin, data: message }, opener, value, seen, now).type, "hello");
  assert.throws(() => validateHostedMessage({ source: opener, origin: value.origin, data: message }, opener, value, seen, now));
  assert.throws(() => validateHostedMessage({ source: {}, origin: value.origin, data: { ...message, messageId: randomHostedId() } }, opener, value, new Set(), now));
  assert.throws(() => validateHostedMessage({ source: opener, origin: "https://evil.example", data: { ...message, messageId: randomHostedId() } }, opener, value, new Set(), now));
  assert.throws(() => validateHostedMessage({ source: opener, origin: value.origin, data: { ...message, nonce: randomHostedId(), messageId: randomHostedId() } }, opener, value, new Set(), now));
  assert.throws(() => validateHostedMessage({ source: opener, origin: value.origin, data: { ...message, expiresAt: now, messageId: randomHostedId() } }, opener, value, new Set(), now));
});

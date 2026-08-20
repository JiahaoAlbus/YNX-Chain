import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON, signAuthorization, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { CANONICAL_SESSION_COMPLETE_PATH, CANONICAL_WALLET_GATEWAY_URL, SOCIAL_ORIGIN, completeCanonicalWalletSession, createCanonicalWalletCompletion } from "./canonicalWalletGateway";
import { createWalletRequest, encodeBase64URL } from "./walletAuth";

const now = new Date("2026-08-20T10:00:00.000Z");
const productSecret = encodeBase64URL(new Uint8Array(32).fill(0x42));
const request = createWalletRequest(
  "social_gateway_completion_nonce_0000001",
  encodeBase64URL(p256.getPublicKey(new Uint8Array(32).fill(0x42), true)),
  now,
);
const approval = signAuthorization(request, {
  accountSecret: "0".repeat(63) + "1",
  account: ynxAddressFromEVM("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"),
  issuedAt: now.toISOString(),
});

test("canonical Gateway completion is exact, origin-bound and never silently falls back", async () => {
  let observed: { url: string; init?: RequestInit } | null = null;
  await assert.rejects(() => completeCanonicalWalletSession({
    authorizationRequest: request,
    walletApproval: approval,
    productDeviceSecret: productSecret,
    randomChallenge: new Uint8Array(24).fill(0x24),
    now,
    fetcher: async (url, init) => {
      observed = { url, init };
      return new Response(JSON.stringify({ ok: false, error: { code: "ORIGIN_MISMATCH" } }), { status: 403 });
    },
  }), /ORIGIN_MISMATCH/);
  assert.ok(observed);
  const actual = observed as { url: string; init?: RequestInit };
  assert.equal(actual.url, `${CANONICAL_WALLET_GATEWAY_URL}${CANONICAL_SESSION_COMPLETE_PATH}`);
  assert.deepEqual(actual.init?.headers, { Accept: "application/json", "Content-Type": "application/json", Origin: SOCIAL_ORIGIN });
  assert.equal(typeof actual.init?.body, "string");
  assert.equal(canonicalJSON(JSON.parse(actual.init?.body as string)), actual.init?.body);
});

test("canonical Gateway completion rejects invalid entropy before opening the network", () => {
  assert.throws(() => createCanonicalWalletCompletion({
    authorizationRequest: request,
    walletApproval: approval,
    productDeviceSecret: productSecret,
    randomChallenge: new Uint8Array(23),
    now,
  }), /entropy/);
});

test("canonical Gateway retries one transport failure with the exact same signed request", async () => {
  const observed: Array<{ url: string; init?: RequestInit }> = [];
  let attempts = 0;
  await assert.rejects(() => completeCanonicalWalletSession({
    authorizationRequest: request,
    walletApproval: approval,
    productDeviceSecret: productSecret,
    randomChallenge: new Uint8Array(24).fill(0x24),
    now,
    fetcher: async (url, init) => {
      observed.push({ url, init });
      attempts += 1;
      if (attempts === 1) throw new TypeError("connection closed");
      return new Response(JSON.stringify({ ok: false, error: { code: "ORIGIN_MISMATCH" } }), { status: 403 });
    },
  }), /ORIGIN_MISMATCH/);
  assert.equal(attempts, 2);
  assert.equal(observed[0]?.url, `${CANONICAL_WALLET_GATEWAY_URL}${CANONICAL_SESSION_COMPLETE_PATH}`);
  assert.deepEqual(observed[1], observed[0]);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJSON } from "../src/canonical.js";
import { walletIdentity, evmAddressFromYNX } from "../src/crypto.js";
import { cardApplicationDetailsHash, createSignedCardApplicationApproval } from "../src/card-application-approval.js";
import {
  createCardApplicationApprovalRequest, parseCardApplicationApprovalRequest, cardApplicationApprovalRequestDigest,
  encodeCardApplicationApprovalWalletURL, parseCardApplicationApprovalWalletURL,
  createCardApplicationApprovalReturnURL, parseCardApplicationApprovalReturnURL,
} from "../src/card-application-approval-request.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const SECRET = "0".repeat(63) + "1", OTHER_SECRET = "0".repeat(63) + "2";
const ACCOUNT = walletIdentity(SECRET).account, OTHER_ACCOUNT = walletIdentity(OTHER_SECRET).account;
const NOW = new Date("2026-09-12T10:00:30.000Z");
const DETAILS = { nickname: "Travel card", useCase: "Testnet travel spending", limitWei: "10000000000000000000", riskAccepted: true, termsVersion: "card-testnet-v1" };
const CHALLENGE = {
  id: "challenge_11111111-1111-4111-8111-111111111111", applicationId: "application_22222222-2222-4222-8222-222222222222",
  owner: evmAddressFromYNX(ACCOUNT), chainId: "0x1917", purpose: "create-testnet-card", payloadHash: cardApplicationDetailsHash(DETAILS),
  nonce: "33333333-3333-4333-8333-333333333333", issuedAt: "2026-09-12T10:00:00.000Z", expiresAt: "2026-09-12T10:05:00.000Z",
};
const INPUT = { productId: "card", platform: "web", account: ACCOUNT, challenge: CHALLENGE, details: DETAILS, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state: "s".repeat(32) };
const make = (patch = {}, at = NOW) => createCardApplicationApprovalRequest(registry, { ...INPUT, ...patch }, at);
const approvalFor = (request, accountSecret = SECRET, at = NOW) => createSignedCardApplicationApproval({ accountSecret, challenge: request.challenge, details: request.details }, at);
const enc = value => Buffer.from(typeof value === "string" ? value : canonicalJSON(value)).toString("base64url");
const route = value => `ynxwallet://card-application-approval?request=${enc(value)}`;
const resultRoute = (request, value) => `${request.callback}?cardApplicationApprovalResult=${enc(value)}`;

test("Card review and real signed approval roundtrip through each registered platform's exact callback", () => {
  for (const platform of ["web", "android", "ios", "macos", "windows", "linux"]) {
    const request = make({ platform });
    assert.equal(request.applicationId, platform === "web" ? "com.ynxweb4.card.web" : "com.ynxweb4.card");
    assert.notEqual(request.applicationId, request.challenge.applicationId, "Registered app identity and Card application UUID remain distinct");
    assert.equal(request.expiresAt, CHALLENGE.expiresAt);
    assert.equal(Date.parse(request.expiresAt) - Date.parse(request.issuedAt), 270_000);
    const walletURL = encodeCardApplicationApprovalWalletURL(registry, request, NOW);
    assert.deepEqual(parseCardApplicationApprovalWalletURL(registry, walletURL, NOW), request);
    const approval = approvalFor(request);
    const callback = createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval }, NOW);
    assert.deepEqual([...new URL(callback).searchParams.keys()], ["cardApplicationApprovalResult"]);
    const result = parseCardApplicationApprovalReturnURL(registry, callback, request, NOW);
    assert.equal(result.kind, "card-application-approval"); assert.equal(result.status, "approved");
    assert.deepEqual(result.approval, approval); assert.equal(result.requestDigest, cardApplicationApprovalRequestDigest(request));
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.approval.details), true);
  }
});

test("request correlation uses a distinct domain and changes with every outer request binding", () => {
  const request = make();
  const expected = createHash("sha256").update(`YNX_CARD_APPLICATION_APPROVAL_REQUEST_V1\n${canonicalJSON(request)}`).digest("hex");
  assert.equal(cardApplicationApprovalRequestDigest(request), expected);
  for (const other of [make({ requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), make({ state: "t".repeat(32) }), make({ platform: "android" })]) assert.notEqual(cardApplicationApprovalRequestDigest(other), expected);
});

test("only registered Card platforms and claimed origin/callback/app bindings are accepted", () => {
  assert.throws(() => make({ callback: "evil://return" }));
  assert.throws(() => make({ productId: "dex" }));
  for (const patch of [{ origin: "https://evil.example" }, { callback: "ynxdex://wallet-auth/callback" }, { applicationId: "com.ynxweb4.dex.web" }, { platform: "android" }, { chainId: "ynx_1-1" }, { version: "2" }, { callback: make().callback + "?x=1" }]) assert.throws(() => parseCardApplicationApprovalRequest(registry, { ...make(), ...patch }, NOW));
  const webOnly = structuredClone(registry), card = webOnly.products.find(item => item.productId === "card");
  card.platforms = ["web"]; card.nativeCallback = null; card.legacyCallbacks = [];
  assert.throws(() => createCardApplicationApprovalRequest(webOnly, { ...INPUT, platform: "android" }, NOW));
  // A syntactically correct registered origin is still only a claim: request
  // preparation intentionally creates neither an approval nor an active session.
  const request = make(); assert.equal(Object.hasOwn(request, "approval"), false); assert.equal(Object.hasOwn(request, "session"), false);
});

test("preparation validates exact five details and owner/challenge fields without a signing secret", () => {
  const request = make(); assert.equal(Object.hasOwn(request, "accountSecret"), false);
  assert.throws(() => make({ accountSecret: SECRET }));
  for (const patch of [{ owner: evmAddressFromYNX(OTHER_ACCOUNT) }, { nonce: "x" }, { id: "x" }, { applicationId: "com.ynxweb4.card" }, { purpose: "fund-card" }, { chainId: "0x1" }, { payloadHash: "0".repeat(64) }, { controls: {} }]) assert.throws(() => make({ challenge: { ...CHALLENGE, ...patch } }));
  for (const patch of [{ nickname: { text: "Travel" } }, { limitWei: "01" }, { riskAccepted: false }, { termsVersion: "v2" }, { controls: { online: true } }]) assert.throws(() => make({ details: { ...DETAILS, ...patch } }));
  for (const key of Object.keys(CHALLENGE)) { const challenge = { ...CHALLENGE }; delete challenge[key]; assert.throws(() => make({ challenge })); }
  for (const key of Object.keys(DETAILS)) { const details = { ...DETAILS }; delete details[key]; assert.throws(() => make({ details })); }
  assert.doesNotThrow(() => make({ challenge: { ...CHALLENGE, owner: ACCOUNT } }));
});

test("canonical accounts, UUID request IDs and bounded opaque state reject ambiguous values", () => {
  for (const patch of [{ account: evmAddressFromYNX(ACCOUNT) }, { account: ACCOUNT.slice(0, -1) + "x" }, { requestId: INPUT.requestId.toUpperCase() }, { requestId: "a".repeat(32) }, { requestId: "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa" }, { state: "s".repeat(31) }, { state: "s".repeat(129) }, { state: "s".repeat(32) + "=" }]) assert.throws(() => make(patch));
});

test("request lifetime must fit inside the challenge and remain current for both directions", () => {
  const request = make();
  for (const patch of [
    { issuedAt: "2026-09-12T09:59:59.999Z" }, { issuedAt: "2026-09-12T10:00:30.001Z" }, { expiresAt: "2026-09-12T10:05:00.001Z" },
    { expiresAt: NOW.toISOString() }, { issuedAt: "2026-09-12T10:00:00Z" }, { expiresAt: "bad" },
  ]) assert.throws(() => parseCardApplicationApprovalRequest(registry, { ...request, ...patch }, NOW));
  for (const expiresAt of [CHALLENGE.issuedAt, "2026-09-12T10:05:00.001Z"]) assert.throws(() => make({ challenge: { ...CHALLENGE, expiresAt } }));
  assert.throws(() => make({}, new Date("2026-09-12T09:59:59.999Z")));
  assert.throws(() => make({}, new Date(CHALLENGE.expiresAt)));
  assert.throws(() => parseCardApplicationApprovalRequest(registry, request, new Date(NaN)));
  const late = make({}, new Date("2026-09-12T10:04:59.000Z")); assert.equal(late.expiresAt, CHALLENGE.expiresAt);
  const returnURL = createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval: approvalFor(request) }, NOW);
  assert.throws(() => parseCardApplicationApprovalReturnURL(registry, returnURL, request, new Date(request.expiresAt)));
});

test("frozen detached snapshots reject getters, hidden fields and symbols before evaluating them", () => {
  const challenge = { ...CHALLENGE }, details = { ...DETAILS }, request = make({ challenge, details });
  details.nickname = "Changed"; challenge.nonce = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.deepEqual(request.details, DETAILS); assert.deepEqual(request.challenge, CHALLENGE);
  assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.details)); assert.ok(Object.isFrozen(request.challenge));
  let reads = 0;
  const accessor = { ...CHALLENGE }; Object.defineProperty(accessor, "expiresAt", { enumerable: true, get() { reads++; return CHALLENGE.expiresAt; } });
  assert.throws(() => make({ challenge: accessor }));
  const detailAccessor = { ...DETAILS }; Object.defineProperty(detailAccessor, "nickname", { enumerable: true, get() { reads++; return DETAILS.nickname; } });
  assert.throws(() => make({ details: detailAccessor }));
  const decision = { reason: "USER_REJECTED" }; Object.defineProperty(decision, "status", { enumerable: true, get() { reads++; return "rejected"; } });
  assert.throws(() => createCardApplicationApprovalReturnURL(registry, request, decision, NOW));
  const hidden = { ...INPUT }; Object.defineProperty(hidden, "toJSON", { value: () => INPUT });
  assert.throws(() => createCardApplicationApprovalRequest(registry, hidden, NOW));
  assert.throws(() => make({ [Symbol("extra")]: true })); assert.equal(reads, 0);
});

test("exact Wallet URL rejects normalization tricks, duplicates, malformed UTF8 and noncanonical JSON/base64url", () => {
  const request = make(), good = route(request);
  for (const url of [
    good + "#fragment", good + "&request=" + enc(request), good + "&other=1", good + "=",
    good.replace("card-application-approval?", "card-application-approval:443?"), good.replace("ynxwallet:", "YNXWALLET:"),
    good.replace("?request=", "?%72equest="), good.replace("card-application-approval?", "application-action?"),
    route(JSON.stringify(request)), route(canonicalJSON(request).replace('"version":"1"', '"version":"1","version":"1"')),
    `ynxwallet://card-application-approval?request=${Buffer.from([0xff]).toString("base64url")}`,
    `ynxwallet://card-application-approval?request=${Buffer.from(" ".repeat(16385)).toString("base64url")}`,
  ]) assert.throws(() => parseCardApplicationApprovalWalletURL(registry, url, NOW));
  const canonical = Buffer.from('"x"').toString("base64url");
  assert.throws(() => parseCardApplicationApprovalWalletURL(registry, `ynxwallet://card-application-approval?request=${canonical.slice(0, -1)}R`, NOW));
});

test("approval callbacks require actual Card signature and exact challenge/details/account", () => {
  const request = make(), approval = approvalFor(request);
  for (const proof of [{ approved: true }, { payloadHash: CHALLENGE.payloadHash }, { ...approval, signature: "0".repeat(128) }, canonicalJSON(approval)]) {
    assert.throws(() => createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval: proof }, NOW));
  }
  const otherOwner = make({ account: OTHER_ACCOUNT, challenge: { ...CHALLENGE, owner: evmAddressFromYNX(OTHER_ACCOUNT) } });
  assert.throws(() => createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval: approvalFor(otherOwner, OTHER_SECRET) }, NOW));
  const changedDetails = { ...DETAILS, limitWei: "1" };
  const changed = make({ details: changedDetails, challenge: { ...CHALLENGE, payloadHash: cardApplicationDetailsHash(changedDetails) } });
  assert.throws(() => createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval: approvalFor(changed) }, NOW));
  const changedNonce = make({ challenge: { ...CHALLENGE, nonce: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
  assert.throws(() => createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval: approvalFor(changedNonce) }, NOW));
  const older = approvalFor(request, SECRET, new Date(CHALLENGE.issuedAt));
  assert.throws(() => createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval: older }, NOW));
});

test("outer result correlation cannot move a proof across pending requests or callback targets", () => {
  const request = make(), good = createCardApplicationApprovalReturnURL(registry, request, { status: "approved", approval: approvalFor(request) }, NOW);
  for (const other of [make({ state: "t".repeat(32) }), make({ requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), make({ platform: "android" })]) assert.throws(() => parseCardApplicationApprovalReturnURL(registry, good, other, NOW));
  const decoded = JSON.parse(Buffer.from(new URL(good).searchParams.get("cardApplicationApprovalResult"), "base64url"));
  for (const patch of [{ state: "t".repeat(32) }, { requestDigest: "0".repeat(64) }, { kind: "application-action" }, { version: "2" }, { extra: true }, { status: "approved", reason: "USER_REJECTED" }]) assert.throws(() => parseCardApplicationApprovalReturnURL(registry, resultRoute(request, { ...decoded, ...patch }), request, NOW));
  for (const url of [good.replace("card.ynxweb4.com", "evil.example"), good + "&result=approved", good + "#x", good.replace("?cardApplicationApprovalResult=", "?applicationActionResult="), good.replace("?cardApplicationApprovalResult=", "?%63ardApplicationApprovalResult=")]) assert.throws(() => parseCardApplicationApprovalReturnURL(registry, url, request, NOW));
});

test("rejection is only USER_REJECTED, is unsigned, and never carries approval or session authority", () => {
  const request = make(), decision = { status: "rejected", reason: "USER_REJECTED" };
  const url = createCardApplicationApprovalReturnURL(registry, request, decision, NOW);
  const result = parseCardApplicationApprovalReturnURL(registry, url, request, NOW);
  assert.equal(result.status, "rejected"); assert.equal(result.reason, "USER_REJECTED");
  assert.equal(Object.hasOwn(result, "approval"), false); assert.equal(Object.hasOwn(result, "session"), false);
  for (const value of [{ status: "rejected", reason: "OTHER" }, { status: "approved", reason: "USER_REJECTED" }, { ...decision, approval: approvalFor(request) }, { ...decision, approved: false }]) assert.throws(() => createCardApplicationApprovalReturnURL(registry, request, value, NOW));
});

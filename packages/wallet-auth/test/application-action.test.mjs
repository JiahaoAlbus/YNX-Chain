import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import test from "node:test";
import {
  APPLICATION_ACTION_DOMAIN, APPLICATION_ACTION_CHAIN_ID, APPLICATION_ACTION_FEE_YNXT,
  createSignedApplicationAction, parseSignedApplicationAction, verifySignedApplicationAction,
  applicationActionSignJSON, applicationActionPayloadHash, applicationActionHash,
} from "../src/application-action.js";
import { ynxAddressFromEVM } from "../src/crypto.js";

// Public, fixed test key 1. No wallet storage, user key, network or chain is used.
const TEST_SECRET = "0".repeat(63) + "1";
const SIGNER = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const PUBLIC_KEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ACCOUNT = ynxAddressFromEVM(SIGNER);
const jwk = {
  kty: "EC", crv: "secp256k1",
  x: Buffer.from(PUBLIC_KEY.slice(2), "hex").toString("base64url"),
  y: Buffer.from("483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8", "hex").toString("base64url"),
};
const OPENSSL_PUBLIC = createPublicKey({ key: jwk, format: "jwk" });
const OPENSSL_PRIVATE = createPrivateKey({ key: { ...jwk, d: Buffer.from(TEST_SECRET, "hex").toString("base64url") }, format: "jwk" });

// The strings, field order, omitted trustUnits, and bounds are transcribed from
// Core 28d30b4b9ac983811f1e6a87f7620ec3bf3f8316:
// action_transaction.go blob 72cdc01b13a37a8d1a32cd11d5429b3097c9c62f;
// dex_action.go blob c69f51dfdd7777933e14d335b7c6f1380e1784f9.
// OpenSSL SHA-256/ECDSA is independent of the production Noble implementation.
// These are independent protocol fixtures, not a claim that a Go node was run.
const CASES = [
  ["dex_swap_exact_input", '{"poolId":"dex_ynxt_usdt","assetIn":"YNXT","amountIn":120,"minAmountOut":100,"deadlineUnix":1900000000}'],
  ["dex_swap_exact_output", '{"poolId":"dex_ynxt_usdt","assetOut":"test-usdt","amountOut":100,"maxAmountIn":130,"deadlineUnix":1900000000}'],
  ["dex_liquidity_add", '{"poolId":"dex_ynxt_usdt","amount0":200,"amount1":400,"minShares":250,"deadlineUnix":1900000000}'],
  ["dex_liquidity_remove", '{"poolId":"dex_ynxt_usdt","shares":50,"minAmount0":0,"minAmount1":0,"deadlineUnix":1900000000}'],
];
const FIRST_ACTION = CASES[0][0];
const FIRST_PAYLOAD = JSON.parse(CASES[0][1]);
const sha = (input) => createHash("sha256").update(input).digest("hex");
const input = (overrides = {}) => ({ accountSecret: TEST_SECRET, action: FIRST_ACTION, payload: { ...FIRST_PAYLOAD }, nonce: 7, ...overrides });
const expected = (overrides = {}) => ({ account: ACCOUNT, action: FIRST_ACTION, payload: { ...FIRST_PAYLOAD }, nonce: 7, ...overrides });

function coreUnsignedJSON(action, businessJSON, nonce = 7) {
  return `{"version":1,"chainId":6423,"type":"application_action","signer":"${SIGNER}","nonce":${nonce},"action":"${action}","payload":${businessJSON},"payloadHash":"${sha(businessJSON)}","fee":1,"aiUnits":0,"payUnits":0,"publicKey":"${PUBLIC_KEY}"}`;
}
function coreSignJSON(unsignedJSON, domain = "YNX_APPLICATION_ACTION_V1") {
  return `{"domain":"${domain}",${unsignedJSON.slice(1)}`;
}
function derParts(der) {
  assert.equal(der[0], 0x30);
  assert.equal(der[2], 0x02);
  const rEnd = 4 + der[3];
  assert.equal(der[rEnd], 0x02);
  const sStart = rEnd + 2;
  return [BigInt(`0x${der.subarray(4, rEnd).toString("hex")}`), BigInt(`0x${der.subarray(sStart, sStart + der[rEnd + 1]).toString("hex")}`)];
}
function derSignature(r, s) {
  const integer = (value) => {
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    if (Number.parseInt(hex.slice(0, 2), 16) >= 128) hex = `00${hex}`;
    const bytes = Buffer.from(hex, "hex");
    return Buffer.concat([Buffer.from([2, bytes.length]), bytes]);
  };
  const body = Buffer.concat([integer(r), integer(s)]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}
function opensslFixture(action = FIRST_ACTION, businessJSON = CASES[0][1], { domain, doubleHash = false } = {}) {
  const unsigned = coreUnsignedJSON(action, businessJSON);
  const signBytes = Buffer.from(coreSignJSON(unsigned, domain));
  const rawSignature = sign("sha256", doubleHash ? Buffer.from(sha(signBytes), "hex") : signBytes, OPENSSL_PRIVATE);
  const [r, s] = derParts(rawSignature);
  const signature = derSignature(r, s > ORDER / 2n ? ORDER - s : s).toString("hex");
  return JSON.parse(`${unsigned.slice(0, -1)},"signature":"${signature}"}`);
}

test("four DEX actions match Core ordered bytes, SHA-256 hashes and independent OpenSSL verification", () => {
  assert.equal(APPLICATION_ACTION_DOMAIN, "YNX_APPLICATION_ACTION_V1");
  assert.equal(APPLICATION_ACTION_CHAIN_ID, 6423);
  assert.equal(APPLICATION_ACTION_FEE_YNXT, 1);
  for (const [action, businessJSON] of CASES) {
    const signed = createSignedApplicationAction(input({ action, payload: JSON.parse(businessJSON) }));
    const unsigned = coreUnsignedJSON(action, businessJSON);
    const signJSON = coreSignJSON(unsigned);
    assert.equal(applicationActionSignJSON(signed.transaction), signJSON);
    assert.equal(JSON.stringify(signed.transaction.payload), businessJSON);
    assert.equal(applicationActionPayloadHash(action, JSON.parse(businessJSON)), sha(businessJSON));
    assert.equal(signed.payload, `${unsigned.slice(0, -1)},"signature":"${signed.transaction.signature}"}`);
    assert.equal(signed.hash, `0x${sha(signed.payload)}`);
    assert.equal(applicationActionHash(signed.payload), signed.hash);
    assert.equal(verify("sha256", Buffer.from(signJSON), OPENSSL_PUBLIC, Buffer.from(signed.transaction.signature, "hex")), true);
    assert.ok(derParts(Buffer.from(signed.transaction.signature, "hex"))[1] <= ORDER / 2n);
    assert.equal(Object.hasOwn(signed.transaction, "trustUnits"), false);
    assert.equal(typeof signed.payload, "string");
    assert.equal(typeof signed.transaction.payload, "object");
  }
});

test("independently signed OpenSSL fixtures for all four actions are accepted and bind to review", () => {
  for (const [action, businessJSON] of CASES) {
    const fixture = opensslFixture(action, businessJSON);
    const encoded = JSON.stringify(fixture);
    assert.deepEqual(parseSignedApplicationAction(encoded), fixture);
    assert.deepEqual(verifySignedApplicationAction(encoded, expected({ action, payload: JSON.parse(businessJSON) })), fixture);
    assert.equal(applicationActionHash(encoded), `0x${sha(encoded)}`);
  }
});

test("frozen Core/Finance signDexAction vectors retain identical signature and full wire hash", () => {
  // Captured by a read-only import of the existing signDexAction implementation,
  // dex-action.js blob 1f4de44cc066b100761390914ec79807c407cf5b, matching
  // Core 28d30b4. That direct comparison also checked full JSON and encoded hex.
  // Removal uses minima 1 here because the old JS helper incorrectly rejects 0;
  // the independent fixtures above cover Core's valid zero-minimum case.
  const vectors = [
    ["304402205ac601c4e1e9d04cb57c4b5def219cc973369c1a8ad5ecb0e935da5489e66463022012d6661effe7cd16ed92c2ba98476f21ce99ff85598e12d52624a6b3f15f2e89", "0xe3e7c84d575a25d0fb6665af8ddbdf5a63da24bb9e454f7710b11f05ec97560d"],
    ["3045022100d7beeec27c778ea3b5d48bfeda0c92eb604b0e4d3fedee87e4422b1d55b3550e02206b4ead3c5945da9b981fd0fd38c8c8f335c0d1b0ab60a28cef95dfc1469cb045", "0xfecb84edec5b262828325a0efe8cb2677a278d66935d579a6f120d699d6ef94a"],
    ["30440220162e72011166755ee984dbddc9f7c58e467ed095a7b648e3eaa51e830d1e729302204346b440fb1baa387a15b717b534300daea8c1b36d1dc0d42e72fe0672afc7e0", "0x45dd46cdafc9619d3e90cfa4cfa6c01f47d07803153579389ac98584144bbb09"],
    ["304402205532793432a5e0c58cf3bf41f9e996331b70fef4c0a282960b48d990ebe9a0730220719d4749ec33bdc9a51397bccaa6984189aa3a2ba4d610a7e146db55afd85570", "0x073207b444390b8b998a4e2ca79b0cc203aa5d4eaf499b190b56fa526e2050d5"],
  ];
  CASES.forEach(([action, businessJSON], index) => {
    const payload = JSON.parse(businessJSON);
    if (action === "dex_liquidity_remove") { payload.minAmount0 = 1; payload.minAmount1 = 1; }
    const signed = createSignedApplicationAction(input({ action, payload }));
    const [signature, hash] = vectors[index];
    assert.equal(signed.transaction.signature, signature);
    assert.equal(signed.payload, `${coreUnsignedJSON(action, JSON.stringify(payload)).slice(0, -1)},"signature":"${signature}"}`);
    assert.equal(signed.hash, hash);
  });
});

test("creation is deterministic and returns detached frozen business payload and envelope", () => {
  const draft = input();
  const signed = createSignedApplicationAction(draft);
  const reordered = Object.fromEntries(Object.entries(draft.payload).reverse());
  assert.deepEqual(createSignedApplicationAction(input({ payload: reordered })), signed);
  assert.equal(Object.isFrozen(signed), true);
  assert.equal(Object.isFrozen(signed.transaction), true);
  assert.equal(Object.isFrozen(signed.transaction.payload), true);
  draft.payload.amountIn++;
  assert.equal(signed.transaction.payload.amountIn, 120);
  assert.throws(() => { signed.transaction.payload.amountIn++; }, TypeError);
  const { signature, ...unsigned } = signed.transaction;
  assert.equal(applicationActionSignJSON(unsigned), applicationActionSignJSON(signed.transaction));
});

test("verification requires the exact account, action, full business payload and nonce", () => {
  const signed = createSignedApplicationAction(input());
  const mismatch = { code: "BINDING_MISMATCH" };
  assert.throws(() => verifySignedApplicationAction(signed.payload, expected({ account: ynxAddressFromEVM(`0x${"11".repeat(20)}`) })), mismatch);
  assert.throws(() => verifySignedApplicationAction(signed.payload, expected({ nonce: 8 })), mismatch);
  for (const field of Object.keys(FIRST_PAYLOAD)) {
    const payload = { ...FIRST_PAYLOAD, [field]: field === "poolId" ? "dex_other_pool" : field === "assetIn" ? "test-usdt" : FIRST_PAYLOAD[field] + 1 };
    assert.throws(() => verifySignedApplicationAction(signed.payload, expected({ payload })), mismatch);
  }
  assert.throws(() => verifySignedApplicationAction(signed.payload, expected({ action: CASES[1][0], payload: JSON.parse(CASES[1][1]) })), mismatch);
  for (const key of ["account", "action", "payload", "nonce"]) {
    const context = expected(); delete context[key];
    assert.throws(() => verifySignedApplicationAction(signed.payload, context));
  }
  assert.throws(() => verifySignedApplicationAction(signed.payload, expected({ account: SIGNER })), { code: "INVALID_ACCOUNT" });
  assert.throws(() => verifySignedApplicationAction(signed.payload, expected({ chainId: 6423 })));
});

test("payload hash consistency alone cannot authorize changed business data or signer", () => {
  const fixture = opensslFixture();
  const changed = { ...fixture, payload: { ...fixture.payload, amountIn: 121 } };
  assert.throws(() => parseSignedApplicationAction(changed), /payload hash mismatch/);
  changed.payloadHash = sha(JSON.stringify(changed.payload));
  assert.throws(() => parseSignedApplicationAction(changed), { code: "INVALID_APPLICATION_ACTION_SIGNATURE" });
  assert.throws(() => parseSignedApplicationAction({ ...fixture, signer: `0x${"22".repeat(20)}` }), { code: "INVALID_APPLICATION_ACTION_SIGNATURE" });
  assert.throws(() => parseSignedApplicationAction({ ...fixture, nonce: 8 }), { code: "INVALID_APPLICATION_ACTION_SIGNATURE" });
  assert.throws(() => parseSignedApplicationAction({ ...fixture, publicKey: `02${"ff".repeat(32)}` }), { code: "INVALID_APPLICATION_ACTION_SIGNATURE" });
});

test("fixed chain, envelope type, fee and omitted zero resource units are enforced", () => {
  const fixture = opensslFixture();
  for (const [key, value] of [["version", 2], ["chainId", 1], ["type", "transfer"], ["fee", 0], ["aiUnits", 1], ["payUnits", 1], ["aiUnits", -0], ["trustUnits", 0], ["trustUnits", 1]]) {
    assert.throws(() => parseSignedApplicationAction({ ...fixture, [key]: value }), key);
  }
});

test("native-transfer domain, empty domain and double-hashed signatures are rejected", () => {
  for (const domain of ["YNX_NATIVE_TX_V1", "YNX_APPLICATION_ACTION_V2", ""]) {
    assert.throws(() => parseSignedApplicationAction(opensslFixture(FIRST_ACTION, CASES[0][1], { domain })), { code: "INVALID_APPLICATION_ACTION_SIGNATURE" });
  }
  assert.throws(() => parseSignedApplicationAction(opensslFixture(FIRST_ACTION, CASES[0][1], { doubleHash: true })), { code: "INVALID_APPLICATION_ACTION_SIGNATURE" });
});

test("mathematically valid high-S ECDSA is rejected and canonical DER is required", () => {
  const fixture = opensslFixture();
  const signature = Buffer.from(fixture.signature, "hex");
  const [r, s] = derParts(signature);
  const highS = derSignature(r, ORDER - s);
  assert.equal(verify("sha256", Buffer.from(coreSignJSON(coreUnsignedJSON(FIRST_ACTION, CASES[0][1]))), OPENSSL_PUBLIC, highS), true);
  assert.throws(() => parseSignedApplicationAction({ ...fixture, signature: highS.toString("hex") }), { code: "INVALID_APPLICATION_ACTION_SIGNATURE" });
  const paddedR = Buffer.concat([signature.subarray(0, 4), Buffer.from([0]), signature.subarray(4)]);
  paddedR[1]++; paddedR[3]++;
  for (const bad of [paddedR.toString("hex"), fixture.signature + "00", fixture.signature.toUpperCase(), "00".repeat(64), "3006020100020100"]) {
    assert.throws(() => parseSignedApplicationAction({ ...fixture, signature: bad }));
  }
});

test("wire parsing rejects whitespace, field order, duplicates, escapes and noncanonical numbers", () => {
  const wire = JSON.stringify(opensslFixture());
  const changed = [
    ` ${wire}`, `${wire}\n`, `${wire}{}`, wire.replace('{"version":1,', '{"version":1,"version":1,'),
    wire.replace('"version":1,"chainId":6423', '"chainId":6423,"version":1'),
    wire.replace('"nonce":7', '"nonce":7.0'), wire.replace('"nonce":7', '"nonce":7e0'),
    wire.replace('"assetIn":"YNXT","amountIn":120', '"amountIn":120,"assetIn":"YNXT"'),
    wire.replace('"YNXT"', '"\\u0059NXT"'),
  ];
  for (const bad of changed) assert.throws(() => parseSignedApplicationAction(bad));
});

test("integer subset rejects rounding, coercion and negative zero; removal minima may be zero", () => {
  const badNumbers = [Number.MAX_SAFE_INTEGER + 1, 1.5, "1", 1n, null, NaN, Infinity, -1, -0];
  for (const [action, businessJSON] of CASES) {
    const payload = JSON.parse(businessJSON);
    for (const key of Object.keys(payload).filter((key) => typeof payload[key] === "number")) {
      for (const bad of badNumbers) assert.throws(() => applicationActionPayloadHash(action, { ...payload, [key]: bad }), `${action}.${key}`);
      assert.doesNotThrow(() => applicationActionPayloadHash(action, { ...payload, [key]: Number.MAX_SAFE_INTEGER }));
      if (!key.startsWith("minAmount")) assert.throws(() => applicationActionPayloadHash(action, { ...payload, [key]: 0 }));
    }
  }
  assert.doesNotThrow(() => createSignedApplicationAction(input({ action: CASES[3][0], payload: JSON.parse(CASES[3][1]), nonce: Number.MAX_SAFE_INTEGER })));
  for (const nonce of [...badNumbers, 0]) assert.throws(() => createSignedApplicationAction(input({ nonce })));
});

test("only Core canonical pool and asset identifiers can be signed", () => {
  for (const poolId of ["DEX_ynxt_usdt", " dex_ynxt_usdt", "dex_ab", `dex_${"a".repeat(61)}`, "dex_ééé", "dex_aaa\n"]) {
    assert.throws(() => createSignedApplicationAction(input({ payload: { ...FIRST_PAYLOAD, poolId } })));
  }
  for (const assetIn of ["ynxt", "YnXt", "TEST-USDT", " YNXT", "YNXT\n", "ab", "0abc", "a_b", "a".repeat(33)]) {
    assert.throws(() => createSignedApplicationAction(input({ payload: { ...FIRST_PAYLOAD, assetIn } })));
  }
  assert.doesNotThrow(() => applicationActionPayloadHash(FIRST_ACTION, { ...FIRST_PAYLOAD, poolId: `dex_${"a".repeat(60)}`, assetIn: "a".repeat(32) }));
});

test("unsupported actions and unknown or missing envelope and business fields fail closed", () => {
  for (const action of ["dex_asset_mint", "dex_pool_create", "dex.swap", "pay_intent_create", "constructor", "__proto__", null]) {
    assert.throws(() => createSignedApplicationAction(input({ action })));
  }
  const fixture = opensslFixture();
  assert.throws(() => createSignedApplicationAction(input({ chainId: 6423 })));
  assert.throws(() => parseSignedApplicationAction({ ...fixture, receipt: "confirmed" }));
  for (const key of Object.keys(fixture)) {
    const incomplete = { ...fixture }; delete incomplete[key];
    assert.throws(() => parseSignedApplicationAction(incomplete));
  }
  for (const [action, businessJSON] of CASES) {
    const payload = JSON.parse(businessJSON);
    assert.throws(() => applicationActionPayloadHash(action, { ...payload, recipient: SIGNER }));
    for (const key of Object.keys(payload)) {
      const incomplete = { ...payload }; delete incomplete[key];
      assert.throws(() => applicationActionPayloadHash(action, incomplete));
    }
  }
});

test("data objects cannot use accessors, toJSON, symbols or inherited protocol fields", () => {
  let calls = 0;
  const getter = { ...FIRST_PAYLOAD };
  Object.defineProperty(getter, "amountIn", { enumerable: true, get() { calls++; return 120; } });
  const hidden = { ...FIRST_PAYLOAD };
  Object.defineProperty(hidden, "toJSON", { value: () => FIRST_PAYLOAD });
  for (const payload of [getter, hidden, { ...FIRST_PAYLOAD, [Symbol("hidden")]: true }, Object.create(FIRST_PAYLOAD), [], null]) {
    assert.throws(() => applicationActionPayloadHash(FIRST_ACTION, payload));
  }
  assert.equal(calls, 0);
});

test("envelope limits apply before JSON parsing and hashes never bless invalid signatures", () => {
  for (const raw of ["", " ".repeat(16 * 1024 + 1), `{"payload":"${"é".repeat(9000)}"}`, "{", "null", "[]"]) {
    assert.throws(() => parseSignedApplicationAction(raw));
    assert.throws(() => applicationActionHash(raw));
  }
  assert.throws(() => applicationActionPayloadHash(FIRST_ACTION, { ...FIRST_PAYLOAD, poolId: "a".repeat(8193) }));
  const fixture = opensslFixture();
  assert.throws(() => applicationActionHash({ ...fixture, signature: "3006020100020100" }));
  for (const accountSecret of ["0".repeat(64), "f".repeat(64), "A".repeat(64), "01", null]) {
    assert.throws(() => createSignedApplicationAction(input({ accountSecret })), { code: "INVALID_SECRET" });
  }
});

test("parsing old valid actions does not invent current execution or receipt status", () => {
  const signed = createSignedApplicationAction(input({ payload: { ...FIRST_PAYLOAD, deadlineUnix: 1 } }));
  assert.doesNotThrow(() => parseSignedApplicationAction(signed.payload));
  assert.deepEqual(Object.keys(signed), ["transaction", "payload", "hash"]);
});

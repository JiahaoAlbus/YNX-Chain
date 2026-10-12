import assert from "node:assert/strict";
import test from "node:test";
import { YNX_CHAIN_IDENTITY, assertCanonicalChainLiteral, assertCanonicalDeveloperChainIdentity, assertSourceHasOnlyCanonicalChainLiterals } from "../scripts/check-chain-identity.mjs";

test("Developer source gate accepts only the three canonical YNX chain representations", async () => {
  const result = await assertCanonicalDeveloperChainIdentity();
  assert.equal(result.identity.decimal, 6423);
  assert.equal(result.identity.eip1193, "0x1917");
  assert.equal(result.identity.canonical, "ynx_6423-1");
  assert.ok(result.literalFiles >= 6);
});

test("Developer source gate rejects a legacy chain configuration literal", () => {
  assert.throws(() => assertCanonicalChainLiteral("0x1", "eip1193"), /must be/);
  assert.throws(() => assertSourceHasOnlyCanonicalChainLiterals('const config = { chainId: "0xaa36a7" };', "fixture"), /non-canonical/);
  assert.throws(() => assertSourceHasOnlyCanonicalChainLiterals("const config = { chainId: 11155111 };", "fixture"), /non-canonical/);
});

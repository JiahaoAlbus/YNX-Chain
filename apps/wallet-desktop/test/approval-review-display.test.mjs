import assert from "node:assert/strict";
import { test } from "node:test";
import { formatApprovalReview } from "../src/approval-review-display.mjs";

test("message reviews retain exact bytes and expose invisible or directional text", () => {
  const message = `0x${Buffer.from("Pay 1\u202e000\u200b YNXT").toString("hex")}`;
  const output = formatApprovalReview({ title: "Sign", message, warning: "An external action may be authorized." });
  assert.ok(output.includes(message));
  assert.ok(output.includes("Pay 1\\u202e000\\u200b YNXT"));
  assert.ok(output.includes("An external action may be authorized."));
  assert.doesNotMatch(output, /[\u202e\u200b]/);
});

test("transaction review retains call data, fee caps, nonce and new signing fields", () => {
  const output = formatApprovalReview({ title: "Send", to: "recipient", value: "0xde0b6b3a7640001", data: "0xdeadbeef", gasLimit: "0x5208", gasPrice: "0x10", nonce: "0x7", futureSigningField: { account: "important" } });
  for (const required of ["1.000000000000000001 YNXT", "0xde0b6b3a7640001", "0xdeadbeef", "0x5208", "0x10", "0x7", "important"]) assert.ok(output.includes(required));
});

test("typed data review includes all nested type definitions, message and domain", () => {
  const output = formatApprovalReview({ domain: { verifyingContract: "contract" }, types: { Permit: [{ name: "allowance", type: "uint256" }] }, primaryType: "Permit", message: { spender: "recipient", allowance: "999999999999999999999999" } });
  for (const required of ["contract", "uint256", "Permit", "recipient", "999999999999999999999999"]) assert.ok(output.includes(required));
});

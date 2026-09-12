import assert from "node:assert/strict";
import test from "node:test";
import { cardApprovalLimitYNXT } from "./cardApprovalCopy";

test("Card review preserves every wei in sub-token and large limits", () => {
  assert.equal(cardApprovalLimitYNXT("1"), "0.000000000000000001");
  assert.equal(cardApprovalLimitYNXT("10000000000000000000"), "10");
  assert.equal(cardApprovalLimitYNXT("10000000000000000001"), "10.000000000000000001");
  assert.equal(cardApprovalLimitYNXT("9007199254740993123456789012345678"), "9007199254740993.123456789012345678");
  assert.equal(cardApprovalLimitYNXT((2n ** 256n - 1n).toString()), "115792089237316195423570985008687907853269984665640564039457.584007913129639935");
});
test("Card review rejects noncanonical or out-of-range limits", () => {
  for (const input of ["0", "-1", "01", "1.0", "1e18", " 1", (2n ** 256n).toString()]) assert.throws(() => cardApprovalLimitYNXT(input));
});

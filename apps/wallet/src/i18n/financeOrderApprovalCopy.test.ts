import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_LOCALES } from "./i18n";
import { financeOrderApprovalCopy } from "./financeOrderApprovalCopy";

test("Finance order review has complete copy for every Wallet locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(financeOrderApprovalCopy(locale, "title").length > 4);
    assert.match(financeOrderApprovalCopy(locale, "boundary"), /Wallet|wallet|ウォレット|지갑|محفظة/iu);
    assert.ok(financeOrderApprovalCopy(locale, "revokeBoundary").length > 30);
    assert.ok(financeOrderApprovalCopy(locale, "bindings").length > 4);
    assert.ok(financeOrderApprovalCopy(locale, "expired").length > 20);
  }
});

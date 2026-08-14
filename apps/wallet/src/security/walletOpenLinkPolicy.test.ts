import assert from "node:assert/strict";
import { test } from "node:test";
import { isExactWalletOpenLink } from "./walletOpenLinkPolicy";

test("safe Wallet launcher accepts only its byte-exact route",()=>{
  assert.equal(isExactWalletOpenLink("ynxwallet://open"),true);
  for(const ambiguous of ["YNXWALLET://open","ynxwallet://attacker@open","ynxwallet://open:443","ynxwallet://%6fpen","ynxwallet://open/","ynxwallet://open?request=x","ynxwallet://open#fragment"])assert.equal(isExactWalletOpenLink(ambiguous),false,ambiguous);
});

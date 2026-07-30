import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_REGISTRY, SCOPE_EXPLANATIONS } from "./registry";

test("Wallet locally reviews exact Social, Pay and Card tuples only",()=>{
  assert.deepEqual(Object.keys(PRODUCT_REGISTRY).sort(),["ynx-card-v1","ynx-pay-v1","ynx-social-v1"]);
  assert.equal(PRODUCT_REGISTRY["ynx-social-v1"]?.bundleId,"com.ynx.social");
  assert.equal(PRODUCT_REGISTRY["ynx-pay-v1"]?.callbacks[0],"ynxpay://wallet-auth/callback");
  assert.equal(PRODUCT_REGISTRY["ynx-card-v1"]?.requestingProduct,"ynx-card");
  for(const binding of Object.values(PRODUCT_REGISTRY))for(const scope of binding.scopes)assert.ok(SCOPE_EXPLANATIONS[scope],`missing explanation ${scope}`);
});

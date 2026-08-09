import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_REGISTRY, SCOPE_EXPLANATIONS } from "./registry";

test("Wallet locally reviews the exact approved finance, commerce and existing bounded tuples",()=>{
  assert.deepEqual(Object.keys(PRODUCT_REGISTRY).sort(),["ynx-card-v1","ynx-creator-studio-web-v1","ynx-exchange-v1","ynx-finance-v1","ynx-pay-v1","ynx-quant-v1","ynx-shop-v1","ynx-social-v1"]);
  assert.equal(PRODUCT_REGISTRY["ynx-social-v1"]?.bundleId,"com.ynx.social");
  assert.equal(PRODUCT_REGISTRY["ynx-pay-v1"]?.callbacks[0],"ynxpay://wallet-auth/callback");
  assert.equal(PRODUCT_REGISTRY["ynx-card-v1"]?.requestingProduct,"ynx-card");
  assert.equal(PRODUCT_REGISTRY["ynx-finance-v1"]?.callbacks[0],"ynxfinance://wallet-auth/callback");
  assert.deepEqual(PRODUCT_REGISTRY["ynx-quant-v1"]?.scopes,["quant:account","quant:mandate:create","quant:mandate:execute","quant:mandate:revoke"]);
  assert.deepEqual(PRODUCT_REGISTRY["ynx-creator-studio-web-v1"]?.callbacks,["https://web4.ynxweb4.com/video/studio/wallet-auth/callback"]);
  assert.deepEqual(PRODUCT_REGISTRY["ynx-creator-studio-web-v1"]?.scopes,["ai.video.propose","pay.payout.intent","video.creator","video.read"]);
  for(const binding of Object.values(PRODUCT_REGISTRY))for(const scope of binding.scopes)assert.ok(SCOPE_EXPLANATIONS[scope],`missing explanation ${scope}`);
});

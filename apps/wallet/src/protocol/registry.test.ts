import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_REGISTRY, SCOPE_EXPLANATIONS } from "./registry";
import { encodeRequestDeepLink, parseWalletDeepLink } from "@ynx-chain/wallet-auth";

test("Wallet locally reviews the exact approved finance, commerce and existing bounded tuples",()=>{
  assert.deepEqual(Object.keys(PRODUCT_REGISTRY).sort(),["ynx-card-v1","ynx-developer-v1","ynx-exchange-v1","ynx-finance-v1","ynx-pay-v1","ynx-quant-v1","ynx-shop-v1","ynx-social-v1"]);
  assert.equal(PRODUCT_REGISTRY["ynx-social-v1"]?.bundleId,"com.ynx.social");
  assert.equal(PRODUCT_REGISTRY["ynx-pay-v1"]?.callbacks[0],"ynxpay://wallet-auth/callback");
  assert.equal(PRODUCT_REGISTRY["ynx-card-v1"]?.requestingProduct,"ynx-card");
  assert.equal(PRODUCT_REGISTRY["ynx-finance-v1"]?.callbacks[0],"ynxfinance://wallet-auth/callback");
  assert.deepEqual(PRODUCT_REGISTRY["ynx-quant-v1"]?.scopes,["quant:account","quant:mandate:create","quant:mandate:execute","quant:mandate:revoke"]);
  assert.deepEqual(PRODUCT_REGISTRY["ynx-developer-v1"]?.scopes,["account:read","developer:deploy"]);
  const request={version:"1",nonce:"developer_nonce_abcdefghijklmnop",chainId:"ynx_6423-1",requestingProduct:"developer",productClientId:"ynx-developer-v1",bundleId:"com.ynxweb4.developer.testnetpreview",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",callback:"ynxdeveloper://wallet-auth/callback",scopes:["account:read","developer:deploy"],purpose:"Sign in to YNX Developer and review one exact Testnet deployment.",issuedAt:"2026-08-10T00:00:00.000Z",expiresAt:"2026-08-10T00:05:00.000Z"} as const;
  const parsed=parseWalletDeepLink(encodeRequestDeepLink(request),"android",{now:new Date("2026-08-10T00:01:00.000Z"),registry:PRODUCT_REGISTRY});
  assert.equal(parsed.request.productClientId,"ynx-developer-v1");
  assert.deepEqual(parsed.request.scopes,["account:read","developer:deploy"]);
  for(const binding of Object.values(PRODUCT_REGISTRY))for(const scope of binding.scopes)assert.ok(SCOPE_EXPLANATIONS[scope],`missing explanation ${scope}`);
});

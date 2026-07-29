import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CentralWalletSessionStore, createGatewayChallenge, parseAuthorizationRequest,
  parseCentralRegistryEntry, registryParserBinding, signAuthorization, signGatewayChallenge, WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const PRODUCTS=[
  {productClientId:"ynx-card-v1",requestingProduct:"ynx-card",bundleId:"com.ynxweb4.card",callback:"ynxcard://wallet-auth/callback",scopes:["account:read","card:application:write","card:controls:write","card:dispute:write"],nonce:"card_nonce_abcdefghijklmnopqrstuvwxyz12",challenge:"card_gateway_challenge_abcdefghijklm"},
  {productClientId:"ynx-pay-v1",requestingProduct:"pay",bundleId:"com.ynxweb4.pay",callback:"ynxpay://wallet-auth/callback",scopes:["account:read","pay:case:create","pay:settlement:submit"],nonce:"pay_nonce_abcdefghijklmnopqrstuvwxyz123",challenge:"pay_gateway_challenge_abcdefghijklmn"},
];

for(const product of PRODUCTS)test(`${product.requestingProduct} completes exact Wallet approval and product-device session`,()=>{
  const registryEntry=parseCentralRegistryEntry({schemaVersion:2,productClientId:product.productClientId,requestingProduct:product.requestingProduct,bundleId:product.bundleId,callbacks:[product.callback],scopes:product.scopes,maxScopes:product.scopes.length,productDeviceAlgorithms:["p256-sha256"]});
  const authorizationRequest=parseAuthorizationRequest(request({nonce:product.nonce,requestingProduct:product.requestingProduct,productClientId:product.productClientId,bundleId:product.bundleId,callback:product.callback,scopes:product.scopes,purpose:`Authorize exact ${product.requestingProduct} test device.`}),{now:NOW,registry:registryParserBinding(registryEntry)});
  const walletApproval=signAuthorization(authorizationRequest,{accountSecret:ACCOUNT_SECRET,issuedAt:NOW.toISOString()});
  const challenge=createGatewayChallenge(walletApproval,{challenge:product.challenge,expiresAt:"2026-07-15T12:03:00.000Z"},NOW);
  const gatewayCompletion=signGatewayChallenge(challenge,PRODUCT_DEVICE_SECRET);
  const store=new CentralWalletSessionStore();
  const session=store.complete({registryEntry,authorizationRequest,walletApproval,gatewayCompletion},NOW);
  assert.equal(store.introspect(session.sessionBinding,{productClientId:product.productClientId,bundleId:product.bundleId,productDeviceKey:authorizationRequest.productDeviceKey,requiredScopes:["account:read"]},NOW).active,true);
  assert.throws(()=>store.introspect(session.sessionBinding,{productClientId:"ynx-social-v1",bundleId:"com.ynx.social",productDeviceKey:authorizationRequest.productDeviceKey,requiredScopes:["account:read"]},NOW),(error)=>error instanceof WalletAuthError&&error.code==="CROSS_APP_REUSE");
});

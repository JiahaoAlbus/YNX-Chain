import assert from "node:assert/strict";
import {test} from "node:test";
import {
  encodeExchangeOrderActionDeepLink,
  exchangeOrderAuthorizationPayload,
  parseExchangeOrderActionDeepLink,
  signExchangeOrderAction,
  verifyExchangeOrderActionResponse,
  walletIdentity,
  WalletAuthError,
} from "../src/index.js";
import {ACCOUNT_SECRET} from "./fixtures.mjs";

const NOW=new Date("2026-08-09T04:30:00.000Z"),ACCOUNT=walletIdentity(ACCOUNT_SECRET).account;
function request(overrides={}){return{version:"1",chainId:"ynx_6423-1",productClientId:"ynx-exchange-v1",bundleId:"com.ynxweb4.exchange",callback:"ynxexchange://wallet-auth/callback",sessionBinding:"ab".repeat(32),account:ACCOUNT,action:"exchange.order.place",parameters:{market:"YNXT-YUSD_TEST",side:"buy",type:"limit",priceMicro:995000,amountMicro:250000,idempotencyKey:"order-mobile-00000001"},nonce:"action_nonce_abcdefghijklmnopqrstuvwxyz",issuedAt:"2026-08-09T04:29:30.000Z",expiresAt:"2026-08-09T04:34:30.000Z",...overrides}}

test("Wallet signs the exact Exchange order payload accepted by the venue",()=>{
  const input=request(),response=signExchangeOrderAction(input,{accountSecret:ACCOUNT_SECRET,account:ACCOUNT,issuedAt:NOW.toISOString()});
  assert.equal(exchangeOrderAuthorizationPayload(ACCOUNT,input.parameters),`ynx-exchange-order-v1\n${ACCOUNT}\nYNXT-YUSD_TEST\nbuy\nlimit\n995000\n250000\norder-mobile-00000001`);
  assert.deepEqual(verifyExchangeOrderActionResponse(response,input,NOW),response);
});

test("action deep link is exact and tampering fails closed",()=>{
  const input=request(),link=encodeExchangeOrderActionDeepLink(input);
  assert.deepEqual(parseExchangeOrderActionDeepLink(link,NOW),input);
  const response=signExchangeOrderAction(input,{accountSecret:ACCOUNT_SECRET,account:ACCOUNT,issuedAt:NOW.toISOString()});
  assert.throws(()=>verifyExchangeOrderActionResponse({...response,parameters:{...response.parameters,amountMicro:250001}},input,NOW),WalletAuthError);
  assert.throws(()=>parseExchangeOrderActionDeepLink(link.replace("action","authorize"),NOW),WalletAuthError);
});

test("wrong account, stale review and unsupported market are rejected",()=>{
  assert.throws(()=>signExchangeOrderAction(request({account:"ynx100f25pex4saeuaftzgx7s45wjzcyywhyl48mjt"}),{accountSecret:ACCOUNT_SECRET,account:ACCOUNT,issuedAt:NOW.toISOString()}),WalletAuthError);
  assert.throws(()=>parseExchangeOrderActionDeepLink(encodeExchangeOrderActionDeepLink(request()),new Date("2026-08-09T04:35:00.000Z")),WalletAuthError);
  assert.throws(()=>encodeExchangeOrderActionDeepLink(request({parameters:{...request().parameters,market:"OTHER"}})),WalletAuthError);
});

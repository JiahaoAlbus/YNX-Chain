import assert from "node:assert/strict";
import {test} from "node:test";
import {
  encodeExchangeOrderActionDeepLink,
  exchangeActionAuthorizationPayload,
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
  for(const ambiguous of [link.replace("ynxwallet:","YNXWALLET:"),link.replace("ynxwallet://","ynxwallet://attacker@"),link.replace("//action","//%61ction")])assert.throws(()=>parseExchangeOrderActionDeepLink(ambiguous,NOW),WalletAuthError);
});

test("wrong account, stale review and unsupported market are rejected",()=>{
  assert.throws(()=>signExchangeOrderAction(request({account:"ynx100f25pex4saeuaftzgx7s45wjzcyywhyl48mjt"}),{accountSecret:ACCOUNT_SECRET,account:ACCOUNT,issuedAt:NOW.toISOString()}),WalletAuthError);
  assert.throws(()=>parseExchangeOrderActionDeepLink(encodeExchangeOrderActionDeepLink(request()),new Date("2026-08-09T04:35:00.000Z")),WalletAuthError);
  assert.throws(()=>encodeExchangeOrderActionDeepLink(request({parameters:{...request().parameters,market:"OTHER"}})),WalletAuthError);
});

test("Wallet signs margin, perpetual and exact cancellation actions accepted by the venue",()=>{
  const cases=[
    ["exchange.margin.transfer",{direction:"deposit",amountMicro:5_000_000,idempotencyKey:"margin-transfer-0001"},`ynx-exchange-margin-transfer-v1\n${ACCOUNT}\ndeposit\n5000000\nmargin-transfer-0001`],
    ["exchange.perpetual.order.place",{market:"YNXT-YUSD_TEST-PERP",side:"sell",type:"limit",timeInForce:"gtc",priceMicro:1_200_000,amountMicro:2_000_000,leverage:5,reduceOnly:false,idempotencyKey:"perpetual-order-0001"},`ynx-exchange-perpetual-order-v1\n${ACCOUNT}\nYNXT-YUSD_TEST-PERP\nsell\nlimit\ngtc\n1200000\n2000000\n5\nfalse\nperpetual-order-0001`],
    ["exchange.order.cancel",{orderId:"order-owned-0001",idempotencyKey:"spot-cancel-0001"},`ynx-exchange-cancel-v1\n${ACCOUNT}\norder-owned-0001\nspot-cancel-0001`],
    ["exchange.perpetual.order.cancel",{orderId:"perpetual-owned-0001",idempotencyKey:"perp-cancel-0001"},`ynx-exchange-perpetual-cancel-v1\n${ACCOUNT}\nperpetual-owned-0001\nperp-cancel-0001`],
  ];
  for(const[action,parameters,payload]of cases){
    const input=request({action,parameters}),response=signExchangeOrderAction(input,{accountSecret:ACCOUNT_SECRET,account:ACCOUNT,issuedAt:NOW.toISOString()});
    assert.equal(exchangeActionAuthorizationPayload(ACCOUNT,action,parameters),payload);
    assert.deepEqual(verifyExchangeOrderActionResponse(response,input,NOW),response);
  }
});

test("trading action unions reject field, leverage, direction and action substitution",()=>{
  assert.throws(()=>encodeExchangeOrderActionDeepLink(request({action:"exchange.margin.transfer",parameters:{direction:"borrow",amountMicro:1,idempotencyKey:"margin-bad-0001"}})),WalletAuthError);
  assert.throws(()=>encodeExchangeOrderActionDeepLink(request({action:"exchange.perpetual.order.place",parameters:{market:"YNXT-YUSD_TEST-PERP",side:"buy",type:"limit",timeInForce:"gtc",priceMicro:1,amountMicro:1,leverage:101,reduceOnly:false,idempotencyKey:"perp-bad-0000001"}})),WalletAuthError);
  const input=request({action:"exchange.order.cancel",parameters:{orderId:"order-owned-0001",idempotencyKey:"spot-cancel-0001"}}),response=signExchangeOrderAction(input,{accountSecret:ACCOUNT_SECRET,account:ACCOUNT,issuedAt:NOW.toISOString()});
  assert.throws(()=>verifyExchangeOrderActionResponse({...response,action:"exchange.perpetual.order.cancel"},input,NOW),WalletAuthError);
});

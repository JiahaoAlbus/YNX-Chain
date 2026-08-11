import test from "node:test";
import assert from "node:assert/strict";
import {tradingRequest} from "./trading";
import type {ExchangeOrderActionResponse} from "@ynx-chain/wallet-auth";

const common={version:"1",chainId:"ynx_6423-1",productClientId:"ynx-exchange-v1",bundleId:"com.ynxweb4.exchange",callback:"ynxexchange://wallet-auth/callback",sessionBinding:"a".repeat(64),account:"ynx1"+"q".repeat(38),nonce:"n".repeat(32),issuedAt:"2026-08-11T00:00:00.000Z",expiresAt:"2026-08-11T00:05:00.000Z",requestDigest:"b".repeat(64),accountPublicKey:"02"+"c".repeat(64),walletSignature:"d".repeat(128)} as const;
function response(action:ExchangeOrderActionResponse["action"],parameters:any):ExchangeOrderActionResponse{return{...common,action,parameters} as ExchangeOrderActionResponse}

test("routes every reviewed trading action to its canonical Exchange endpoint",()=>{
 const fixtures:[ExchangeOrderActionResponse,string][]=[
  [response("exchange.order.place",{market:"YNXT-YUSD_TEST",side:"buy",type:"limit",priceMicro:2_000_000,amountMicro:3_000_000,idempotencyKey:"spot-key-1"}),"/v1/orders"],
  [response("exchange.order.cancel",{orderId:"spot-order-1",idempotencyKey:"spot-cancel-1"}),"/v1/orders/spot-order-1/cancel"],
  [response("exchange.margin.transfer",{direction:"deposit",amountMicro:4_000_000,idempotencyKey:"margin-key-1"}),"/v1/margin/transfer"],
  [response("exchange.perpetual.order.place",{market:"YNXT-YUSD_TEST-PERP",side:"sell",type:"limit",timeInForce:"gtc",priceMicro:2_100_000,amountMicro:1_000_000,leverage:5,reduceOnly:false,idempotencyKey:"perp-key-1"}),"/v1/perpetual/orders"],
  [response("exchange.perpetual.order.cancel",{orderId:"perp-order-1",idempotencyKey:"perp-cancel-1"}),"/v1/perpetual/orders/perp-order-1/cancel"],
 ];
 for(const[action,path]of fixtures){const request=tradingRequest(action);assert.equal(request.path,path);assert.equal(request.body.walletSignature,common.walletSignature);assert.equal(request.body.idempotencyKey,action.parameters.idempotencyKey)}
});

test("cancel routes encode untrusted order identifiers as one path segment",()=>{const action=response("exchange.order.cancel",{orderId:"order/../../escape",idempotencyKey:"cancel-key-2"});assert.equal(tradingRequest(action).path,"/v1/orders/order%2F..%2F..%2Fescape/cancel")});

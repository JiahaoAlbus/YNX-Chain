import assert from "node:assert/strict";
import test from "node:test";
import {encodeQuantActionDeepLink,parseQuantActionDeepLink,quantActionAuthorizationPayload,signQuantAction,verifyQuantActionResponse,walletIdentity} from "../src/index.js";

const SECRET="11".repeat(32),identity=walletIdentity(SECRET),NOW=new Date("2026-08-11T08:00:30.000Z");
function mandate(){return{Account:identity.account,StrategyHash:"ab".repeat(32),Market:"YNXT-YUSD_TEST",ProductID:"ynx-quant-lab",BundleID:"com.ynxweb4.quant.web",DeviceID:"quant-web-device-001",NonceDomain:`quant:${"ab".repeat(32)}`,Scope:"quant:testnet-execute",Nonce:1,MaxNotional:2_000_000,MaxPosition:2_000_000,MaxDailyLoss:500_000,MaxSlippageBPS:50,MaxGas:10_000,MaxOrdersPerMinute:10,MaxLeverageBPS:20_000,MaxDrawdown:500_000,MinLiquidity:2_000_000,MaxVaR:300_000,MaxExpectedShortfall:400_000,MaxDepegBPS:100,MaxConcentrationBPS:5_000,MaxCancelRateBPS:5_000,MaxConsecutiveAPIFailures:3,ExpiresAt:"2026-08-11T09:00:00.000Z",TestnetOnly:true}}
function request(parameters=mandate()){return{version:"1",chainId:"ynx_6423-1",productClientId:"ynx-quant-v1",bundleId:"com.ynxweb4.quant",callback:"https://quant.ynxweb4.com/wallet-action/callback",sessionBinding:"cd".repeat(32),account:identity.account,action:"quant.mandate.activate",parameters,nonce:"quant_action_nonce_abcdefghijklmnopqrstuvwxyz",issuedAt:"2026-08-11T08:00:00.000Z",expiresAt:"2026-08-11T08:05:00.000Z"}}

test("Quant mandate action binds every displayed risk limit and round-trips through Wallet",()=>{
  const input=request(),link=encodeQuantActionDeepLink(input),parsed=parseQuantActionDeepLink(link,NOW),payload=quantActionAuthorizationPayload(parsed.action,parsed.parameters);
  for(const ambiguous of [link.replace("ynxwallet:","YNXWALLET:"),link.replace("ynxwallet://","ynxwallet://attacker@"),link.replace("//quant-action","//%71uant-action")])assert.throws(()=>parseQuantActionDeepLink(ambiguous,NOW),/canonical|route/);
  for(const value of ["ynx-quant-execution-adapter-v2",parsed.parameters.StrategyHash,"500000","50","10000","20000","300000","400000","true"])assert.ok(payload.includes(value),value);
  const response=signQuantAction(parsed,{accountSecret:SECRET,account:identity.account,issuedAt:NOW.toISOString()});
  assert.equal(verifyQuantActionResponse(response,input,NOW).walletSignature.length,128);
  assert.throws(()=>verifyQuantActionResponse({...response,parameters:{...response.parameters,MaxDailyLoss:500001}},input,NOW));
});

test("Quant order action emits the exact Exchange order authorization domain",()=>{
  const parameters={Account:identity.account,Market:"YNXT-YUSD_TEST",Side:"buy",Price:1_000_000,Amount:250_000,IdempotencyKey:"quant-order-0001"},input={...request(parameters),action:"quant.order.place"};
  assert.equal(quantActionAuthorizationPayload(input.action,parameters),`ynx-exchange-order-v1\n${identity.account}\nYNXT-YUSD_TEST\nbuy\nlimit\n1000000\n250000\nquant-order-0001`);
  const response=signQuantAction(input,{accountSecret:SECRET,account:identity.account,issuedAt:NOW.toISOString()});
  assert.equal(verifyQuantActionResponse(response,input,NOW).account,identity.account);
});

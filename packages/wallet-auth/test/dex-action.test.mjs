import assert from "node:assert/strict";
import test from "node:test";
import { createDexActionCallback, createDexActionDeepLink, parseDexActionDeepLink, parseDexActionResponse, signDexAction, walletIdentity } from "../src/index.js";

const NOW=new Date("2026-08-10T03:00:00.000Z"),SECRET="0000000000000000000000000000000000000000000000000000000000000065";
const quote={poolBlockHeight:931437,poolUpdatedAt:"2026-08-10T02:59:30.000Z",asset0:"YNXT",asset1:"yusd-test",reserve0:1000000,reserve1:2000000,feeBps:30,expectedAmount:1974};
function request(action="dex_swap_exact_input",payload={poolId:"dex_ynxt_yusd",assetIn:"YNXT",amountIn:1000,minAmountOut:1900,deadlineUnix:1786331040},overrides={}){return {version:"1",chainId:6423,productClientId:"ynx-dex-web-v1",bundleId:"com.ynxweb4.dex.web",callback:"https://dex.ynxweb4.com/wallet-action/callback",sessionBinding:"a".repeat(64),account:walletIdentity(SECRET).account,nonce:1,action,payload,quote,issuedAt:NOW.toISOString(),expiresAt:"2026-08-10T03:05:00.000Z",...overrides}}

test("DEX Wallet signs exact-input, exact-output, add and remove liquidity actions",()=>{
  const cases=[
    request(),
    request("dex_swap_exact_output",{poolId:"dex_ynxt_yusd",assetOut:"yusd-test",amountOut:1900,maxAmountIn:1100,deadlineUnix:1786331040}),
    request("dex_liquidity_add",{poolId:"dex_ynxt_yusd",amount0:1000,amount1:2000,minShares:1300,deadlineUnix:1786331040}),
    request("dex_liquidity_remove",{poolId:"dex_ynxt_yusd",shares:500,minAmount0:300,minAmount1:600,deadlineUnix:1786331040}),
  ];
  for(const expected of cases){const parsed=parseDexActionDeepLink(createDexActionDeepLink(expected,NOW),NOW),signed=signDexAction(parsed,{accountSecret:SECRET,account:expected.account},NOW),verified=parseDexActionResponse(signed,expected,NOW);assert.equal(verified.signedTransaction.action,expected.action);assert.deepEqual(verified.signedTransaction.payload,expected.payload);assert.equal(verified.signedTransaction.fee,1);assert.match(verified.signedTransaction.signature,/^[0-9a-f]{136,144}$/);assert.match(createDexActionCallback(signed,expected,NOW),/^https:\/\/dex\.ynxweb4\.com\/wallet-action\/callback\?response=/)}
});

test("DEX Wallet rejects action, route, session, quote, deadline, account and signature substitution",()=>{
  const expected=request(),signed=signDexAction(expected,{accountSecret:SECRET},NOW);
  assert.throws(()=>createDexActionDeepLink({...expected,action:"dex_asset_mint"},NOW),/action/);
  assert.throws(()=>parseDexActionDeepLink(createDexActionDeepLink(expected,NOW).replace("dex-action","action"),NOW),/route/);
  assert.throws(()=>createDexActionDeepLink({...expected,sessionBinding:"b"},NOW),/sessionBinding/);
  assert.throws(()=>createDexActionDeepLink({...expected,quote:{...quote,asset0:"other"}},NOW),/quote/i);
  assert.throws(()=>createDexActionDeepLink({...expected,payload:{...expected.payload,deadlineUnix:1}},NOW),/deadline/);
  assert.throws(()=>signDexAction(expected,{accountSecret:"1".repeat(64)},NOW),/account/);
  assert.throws(()=>parseDexActionResponse({...signed,signedTransaction:{...signed.signedTransaction,payload:{...signed.signedTransaction.payload,amountIn:2000}}},expected,NOW),/payload|encoding|hash|signature/i);
  assert.throws(()=>parseDexActionResponse({...signed,transactionHash:`0x${"0".repeat(64)}`},expected,NOW),/hash|encoding/);
});

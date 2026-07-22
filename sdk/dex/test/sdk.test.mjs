import assert from "node:assert/strict";
import test from "node:test";
import {
  DexSdkError, amountIn, amountOut, assertFreshQuote, buildSwapExactInputTx,
  maximumInput, minimumOutput, parsePool, quoteExactInput, quoteExactOutput,
  parseFeeSummary, parsePosition, parseSpotPrice, parseTWAP, priceImpactBps,
  assertExecutableVaultState, buildEmergencyExitTx, buildPauseVaultTx,
  buildVaultAddLiquidityTx, buildVaultRemoveLiquidityTx, buildVaultSwapExactInputTx,
  buildVaultSwapExactOutputTx, parseVaultState, reconcileVaultAction,
  digestVaultRequest, submitApprovedVaultRequest,
  parseIndexedVaultAction, reconcileIndexedVaultAction,
  attributeQuoteFees, buildVaultCollectFeesTx, buildVaultCompoundTx,
  buildVaultRebalancePlan, describePoolFeeCollection, parseExecutionSnapshot,
} from "../src/index.js";

const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const token = (value, symbol) => ({ address: address(value), chainId: 6423, decimals: 18, name: `Token ${symbol}`, symbol, verified: true });
const A = token(1, "A"); const B = token(2, "B"); const C = token(3, "C");
const pool = (value, token0, token1, reserve0, reserve1) => ({ address: address(value), feeBps: 30, reserve0: String(reserve0), reserve1: String(reserve1), token0, token1, updatedAt: "2026-07-18T06:00:00.000Z" });
const pools = [pool(11, A, B, 1_000_000n, 1_000_000n), pool(12, B, C, 1_000_000n, 2_000_000n), pool(13, A, C, 1_000_000n, 1_500_000n)];
const now = new Date("2026-07-18T06:00:05.000Z");

test("exact-input routing chooses the best deterministic route", () => {
  const quote = quoteExactInput({ amountIn: 10_000n, tokenIn: A.address, tokenOut: C.address, pools, now });
  assert.deepEqual(quote.path, [A.address, B.address, C.address]);
  assert(quote.amountOut > 0n);
  const spot=(10_000n*1_000_000n/1_000_000n)*2_000_000n/1_000_000n;assert.equal(priceImpactBps(quote),Number((spot-quote.amountOut)*10_000n/spot));
  assert.equal(assertFreshQuote(quote, { now: new Date("2026-07-18T06:00:10.000Z") }), quote);
});

test("exact-output routing minimizes required input", () => {
  const quote = quoteExactOutput({ amountOut: 10_000n, tokenIn: A.address, tokenOut: C.address, pools, now });
  assert(quote.amountIn > 0n);
  assert.equal(quote.amountOut, 10_000n);
});

test("slippage and transaction builder preserve fail-closed bounds", () => {
  assert.equal(minimumOutput(10_000n, 50), 9_950n);
  assert.equal(maximumInput(10_000n, 50), 10_050n);
  const quote = quoteExactInput({ amountIn: 1_000n, tokenIn: A.address, tokenOut: B.address, pools, now: new Date() });
  const tx = buildSwapExactInputTx({ router: address(99), quote, recipient: address(100), slippageBps: 50, deadline: Math.floor(Date.now() / 1000) + 300 });
  assert.equal(tx.chainId, 6423);
  assert.equal(tx.functionName, "swapExactInput");
  assert.equal(tx.args[1], minimumOutput(quote.amountOut, 50).toString());
});

test("execution adapter builds approval-bound vault requests without signing or arbitrary recipients", () => {
  const current = new Date();
  const nowSeconds = Math.floor(current.valueOf() / 1000);
  const state = vaultState(current.toISOString(), nowSeconds + 3_600);
  const exactIn = quoteExactInput({ amountIn: 1_000n, tokenIn: A.address, tokenOut: B.address, pools, now: current });
  const exactOut = quoteExactOutput({ amountOut: 500n, tokenIn: A.address, tokenOut: B.address, pools, now: current });
  const deadline = nowSeconds + 300;
  const inputRequest = buildVaultSwapExactInputTx({ state, quote: exactIn, slippageBps: 50, deadline, now: current });
  assert.equal(inputRequest.to, state.vault);
  assert.equal(inputRequest.args[0], "7");
  assert.equal(inputRequest.args[2], minimumOutput(exactIn.amountOut, 50).toString());
  assert.equal(inputRequest.authority, "limited-engine-session");
  assert.equal(inputRequest.approvalRequired, true);
  assert(!Object.hasOwn(inputRequest, "privateKey") && !Object.hasOwn(inputRequest, "recipient"));
  assert.equal(buildVaultSwapExactOutputTx({ state, quote: exactOut, slippageBps: 50, deadline, now: current }).args[2], maximumInput(exactOut.amountIn, 50).toString());
  assert.equal(buildVaultAddLiquidityTx({ state, tokenA:A.address,tokenB:B.address,amountA:100n,amountB:200n,minLiquidity:50n,deadline,now:current }).functionName,"addLiquidity");
  assert.equal(buildVaultRemoveLiquidityTx({ state, tokenA:A.address,tokenB:B.address,liquidity:50n,amountAMin:1n,amountBMin:1n,deadline,now:current }).functionName,"removeLiquidity");
  assert.equal(buildPauseVaultTx({ state, requestedBy:state.engine }).authority,"limited-engine-session");
  assert.equal(buildEmergencyExitTx({ state, requestedBy:state.owner, recipient:state.owner }).authority,"owner");
});

test("vault adapter rejects stale, paused, expired, fee-bearing, and unauthorized state", () => {
  const current = new Date(); const nowSeconds = Math.floor(current.valueOf()/1000);
  const state = vaultState(current.toISOString(),nowSeconds+300);
  assert.equal(parseVaultState(state).actionNonce,7n);
  assert.throws(()=>assertExecutableVaultState({...state,paused:true},{now:current}),error=>error instanceof DexSdkError&&error.code==="VAULT_NOT_EXECUTABLE");
  assert.throws(()=>assertExecutableVaultState(vaultState(new Date(current.valueOf()-60_000).toISOString(),nowSeconds+300),{now:current}),error=>error.code==="STALE_VAULT_STATE");
  assert.throws(()=>assertExecutableVaultState(vaultState(current.toISOString(),nowSeconds),{now:current}),error=>error.code==="VAULT_MANDATE_EXPIRED");
  assert.throws(()=>parseVaultState({...state,mandate:{...state.mandate,performanceFeeBps:"1"}}),error=>error.code==="INVALID_VAULT_MANDATE");
  assert.throws(()=>buildEmergencyExitTx({state,requestedBy:address(999),recipient:state.owner}),error=>error.code==="UNAUTHORIZED_VAULT_REQUEST");
});

test("execution snapshot fails closed on gas, oracle, fee, and risk limits",()=>{
  const current=new Date();const nowSeconds=Math.floor(current.valueOf()/1000);const state=vaultState(current.toISOString(),nowSeconds+3600);
  const snapshot={asOf:current.toISOString(),chainId:6423,confidence:"preflight-observed",coverage:"RPC gas estimate, pool fees, owner-reviewed oracle and Vault risk observations",failure:null,fees:{hiddenSpreadBps:0,performanceFeeBps:0,protocolFeeShareBps:1667,venueFeeBps:30},gas:{estimatedGas:"210000",gasPrice:"1000000000",provider:"YNX Testnet RPC"},oracle:{address:state.oracle,deviationBps:20,updatedAt:current.toISOString()},risk:{dailyLossBps:10,drawdownBps:20,priceImpactBps:30,slippageBps:40,tradeValue:"1000",vaultValue:"10000"},source:"YNX Testnet RPC + owner-reviewed oracle",vault:state.vault,version:"ynx-execution-snapshot-v1"};
  const parsed=parseExecutionSnapshot(snapshot,{state,now:current});assert.equal(parsed.gas.estimatedFeeNative,210000000000000n);assert.equal(parsed.failure,null);
  assert.throws(()=>parseExecutionSnapshot({...snapshot,gas:{...snapshot.gas,gasPrice:"100000000001"}},{state,now:current}),error=>error.code==="GAS_LIMIT_EXCEEDED");
  assert.throws(()=>parseExecutionSnapshot({...snapshot,fees:{...snapshot.fees,hiddenSpreadBps:1}},{state,now:current}),error=>error.code==="INVALID_EXECUTION_FEES");
  assert.throws(()=>parseExecutionSnapshot({...snapshot,oracle:{...snapshot.oracle,deviationBps:101}},{state,now:current}),error=>error.code==="DEPEG_LIMIT_EXCEEDED");
  assert.throws(()=>parseExecutionSnapshot({...snapshot,risk:{...snapshot.risk,tradeValue:"1000001"}},{state,now:current}),error=>error.code==="TRADE_LIMIT_EXCEEDED");
});

test("fee, collect, compound, and rebalance semantics do not invent automation",()=>{
  const current=new Date();const nowSeconds=Math.floor(current.valueOf()/1000);const state=vaultState(current.toISOString(),nowSeconds+3600);const deadline=nowSeconds+300;
  const quote=quoteExactInput({amountIn:10_000n,tokenIn:A.address,tokenOut:B.address,pools,now:current});
  const fees=attributeQuoteFees({quote,protocolFeeShareBps:1667});assert.equal(fees.hiddenSpreadBps,0);assert.equal(fees.performanceFeeBps,0);assert.equal(fees.items.length,1);
  const capability=describePoolFeeCollection({poolType:"constant-product-v1"});assert.equal(capability.lpCollectSupported,false);assert.equal(capability.realizationAction,"removeLiquidity");
  assert.throws(()=>buildVaultCollectFeesTx({poolType:"constant-product-v1"}),error=>error.code==="LP_COLLECT_UNSUPPORTED");
  const compound=buildVaultCompoundTx({state,tokenA:A.address,tokenB:B.address,amountA:100n,amountB:200n,minLiquidity:50n,deadline,now:current});assert.equal(compound.functionName,"addLiquidity");
  const plan=buildVaultRebalancePlan({state,remove:{tokenA:A.address,tokenB:B.address,liquidity:50n,amountAMin:1n,amountBMin:1n,deadline},target:{tokenA:A.address,tokenB:B.address},now:current});assert.equal(plan.firstRequest.functionName,"removeLiquidity");assert.equal(plan.automaticExecution,false);assert.match(plan.continuation.requires,/fresh Vault state/);
});

test("receipt reconciliation binds destination, nonce, method and confirmations", () => {
  const current=new Date();const nowSeconds=Math.floor(current.valueOf()/1000);const state=vaultState(current.toISOString(),nowSeconds+3600);
  const quote=quoteExactInput({amountIn:1000n,tokenIn:A.address,tokenOut:B.address,pools,now:current});
  const request=buildVaultSwapExactInputTx({state,quote,slippageBps:50,deadline:nowSeconds+300,now:current});
  const receipt={blockNumber:100,chainId:6423,status:"success",to:state.vault,transactionHash:`0x${"ab".repeat(32)}`,events:[{eventName:"ActionExecuted",nonce:"7",method:"swapExactInput",beforeValue:"10000",afterValue:"9999",logIndex:3}]};
  const proof=reconcileVaultAction({request,receipt,latestBlock:111,minConfirmations:12,asOf:current});
  assert.equal(proof.confirmations,12);assert.equal(proof.confidence,"confirmed-on-chain");assert.equal(proof.failure,null);
  assert.throws(()=>reconcileVaultAction({request,receipt:{...receipt,events:[{...receipt.events[0],nonce:"8"}]},latestBlock:111}),error=>error.code==="RECEIPT_MISMATCH");
  assert.throws(()=>reconcileVaultAction({request,receipt,latestBlock:110,minConfirmations:12}),error=>error.code==="UNCONFIRMED_RECEIPT");
});

test("indexed reconciliation accepts only source-labelled matching Vault actions",()=>{
  const current=new Date();const nowSeconds=Math.floor(current.valueOf()/1000);const state=vaultState(current.toISOString(),nowSeconds+3600);
  const quote=quoteExactInput({amountIn:1000n,tokenIn:A.address,tokenOut:B.address,pools,now:current});
  const request=buildVaultSwapExactInputTx({state,quote,slippageBps:50,deadline:nowSeconds+300,now:current});
  const action={actionNonce:"7",afterValue:"9999",asOf:current.toISOString(),beforeValue:"10000",blockHash:`0x${"ef".repeat(32)}`,blockNumber:100,confidence:"confirmed-on-chain",coverage:"ActionExecuted vault, nonce domain, action nonce, method, values, transaction, block and log identity",failure:null,logIndex:3,method:"swapExactInput",methodSelector:"0x8c2d6232",nonceDomain:state.nonceDomain,source:"confirmed YNX Testnet EVM logs",transactionHash:`0x${"ab".repeat(32)}`,vault:state.vault,version:"ynx-vault-action-v1"};
  assert.equal(parseIndexedVaultAction(action).methodSelector,"0x8c2d6232");
  const proof=reconcileIndexedVaultAction({request,action});assert.equal(proof.version,"ynx-vault-indexed-reconciliation-v1");assert.equal(proof.failure,null);
  assert.throws(()=>reconcileIndexedVaultAction({request,action:{...action,nonceDomain:`0x${"00".repeat(32)}`}}),error=>error.code==="RECEIPT_MISMATCH");
  assert.throws(()=>parseIndexedVaultAction({...action,source:"cache"}),error=>error.code==="INVALID_INDEXED_ACTION");
});

test("submission requires an exact canonical Wallet approval and explicit transport", async()=>{
  const current=new Date();const nowSeconds=Math.floor(current.valueOf()/1000);const state=vaultState(current.toISOString(),nowSeconds+3600);
  const quote=quoteExactInput({amountIn:1000n,tokenIn:A.address,tokenOut:B.address,pools,now:current});
  const request=buildVaultSwapExactInputTx({state,quote,slippageBps:50,deadline:nowSeconds+300,now:current});
  const requestDigest=await digestVaultRequest(request);let submissions=0;
  const approval={actionNonce:"7",approved:true,asOf:current.toISOString(),chainId:6423,engine:state.engine,expiresAt:new Date(current.valueOf()+60_000).toISOString(),failure:null,nonceDomain:state.nonceDomain,productClientId:"ynx-dex-web-v1",requestDigest,revoked:false,scopes:["dex:vault:execute"],source:"canonical YNX Wallet introspection",vault:state.vault};
  const result=await submitApprovedVaultRequest({request,approval,now:current,sendTransaction:async(candidate)=>{submissions++;assert.equal(candidate,request);return{provider:"YNX Testnet RPC",submittedAt:current.toISOString(),transactionHash:`0x${"cd".repeat(32)}`}}});
  assert.equal(submissions,1);assert.equal(result.status,"submitted-unconfirmed");assert.equal(result.failure,null);
  await assert.rejects(submitApprovedVaultRequest({request,approval:{...approval,requestDigest:`0x${"00".repeat(32)}`},now:current,sendTransaction:async()=>{submissions++;}}),error=>error.code==="APPROVAL_MISMATCH");
  assert.equal(submissions,1,"tampered approval never reaches the transport");
  await assert.rejects(submitApprovedVaultRequest({request,approval:{...approval,revoked:true},now:current,sendTransaction:async()=>{submissions++;}}),error=>error.code==="INVALID_APPROVAL");
  assert.equal(submissions,1,"revoked approval never reaches the transport");
});

test("constant-product rounding never drains reserves across deterministic property vectors", () => {
  for (let i = 1n; i <= 500n; i++) {
    const reserveIn = 10_000n + i * 97n;
    const reserveOut = 20_000n + i * 193n;
    const input = i * 13n;
    const output = amountOut(input, reserveIn, reserveOut);
    assert(output > 0n && output < reserveOut);
    const required = amountIn(output, reserveIn, reserveOut);
    assert(required <= input);
    assert((reserveIn + input) * (reserveOut - output) >= reserveIn * reserveOut);
  }
});

function vaultState(asOf,expiresAt){return {actionNonce:"7",asOf,chainId:6423,configured:true,engine:address(202),failure:null,killed:false,mandate:{depegToleranceBps:"100",expiresAt:String(expiresAt),feeAsset:address(0),feeRecipient:address(0),maxDailyLossBps:"1000",maxDrawdownBps:"2000",maxGasPrice:"100000000000",maxImpactBps:"500",maxSlippageBps:"100",maxTradeValue:"1000000",maxVaultValue:"10000000",minActionInterval:"60",oracleMaxAge:"300",performanceFeeBps:"0"},nonceDomain:`0x${"12".repeat(32)}`,oracle:address(204),owner:address(201),paused:false,revoked:false,router:address(203),source:"YNX Testnet EVM RPC",vault:address(200),version:"ynx-strategy-vault-v1"}}

test("schema, stale, unsupported and liquidity errors are explicit", () => {
  assert.throws(() => parsePool({ ...pools[0], unknown: true }), (error) => error instanceof DexSdkError && error.code === "INVALID_SCHEMA");
  assert.throws(() => quoteExactInput({ amountIn: 1n, tokenIn: A.address, tokenOut: address(999), pools, now }), (error) => error.code === "NO_ROUTE");
  const quote = quoteExactInput({ amountIn: 1_000n, tokenIn: A.address, tokenOut: B.address, pools, now });
  assert.throws(() => assertFreshQuote(quote, { now: new Date("2026-07-18T06:01:00.000Z") }), (error) => error.code === "STALE_QUOTE");
  assert.throws(() => amountOut(1n, 0n, 1n), (error) => error.code === "INVALID_AMOUNT");
});

test("position, raw price, TWAP and fee API schemas reject substitutions",()=>{
 const position=parsePosition({account:"ynx1abcdefghijklmnopqrstuv",pool:address(11),netLpAmount:"10",addedToken0:"20",addedToken1:"30",removedToken0:"1",removedToken1:"2"});assert.equal(position.pool,address(11));
 const spot=parseSpotPrice({pool:address(11),token0:A.address,token1:B.address,price0Numerator:"2",price0Denominator:"1",price1Numerator:"1",price1Denominator:"2",updatedBlock:10});assert.equal(spot.updatedBlock,10);
 const twap=parseTWAP({pool:address(11),token0:A.address,token1:B.address,price0AverageX112:"100",price1AverageX112:"50",intervalSeconds:60,fromBlock:10,toBlock:12});assert.equal(twap.intervalSeconds,60);
 const fees=parseFeeSummary({pool:address(11),token0:A.address,token1:B.address,swapFee0:"3",swapFee1:"0",claimedFee0:"1",claimedFee1:"0"});assert.equal(fees.swapFee0,"3");
 assert.throws(()=>parsePosition({...position,scope:"admin"}),error=>error.code==="INVALID_SCHEMA");assert.throws(()=>parseTWAP({...twap,toBlock:10}),error=>error.code==="INVALID_TWAP");
});

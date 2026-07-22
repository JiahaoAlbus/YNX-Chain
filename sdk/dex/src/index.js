const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NATIVE_ACCOUNT = /^ynx1[0-9a-z]{20,80}$/;
const INTEGER = /^-?[0-9]{1,78}$/;
const MAX_HOPS = 4;
const BPS = 10_000n;
const VAULT_SELECTORS = Object.freeze({ swapExactInput:"0x8c2d6232", swapExactOutput:"0x211bc4b4", addLiquidity:"0x1beed26c", removeLiquidity:"0xc87f59fd" });

export class DexSdkError extends Error {
  constructor(code, message) { super(message); this.name = "DexSdkError"; this.code = code; }
}

export function parseToken(value) {
  exactObject(value, ["address", "chainId", "decimals", "name", "symbol", "verified"]);
  if (!ADDRESS.test(value.address) || value.chainId !== 6423 || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 36) fail("INVALID_TOKEN", "invalid token identity");
  if (!bounded(value.name, 1, 80) || !bounded(value.symbol, 1, 16) || typeof value.verified !== "boolean") fail("INVALID_TOKEN", "invalid token metadata");
  return Object.freeze({ ...value, address: value.address.toLowerCase() });
}

export function parsePool(value) {
  exactObject(value, ["address", "feeBps", "reserve0", "reserve1", "token0", "token1", "updatedAt"]);
  if (!ADDRESS.test(value.address) || !Number.isInteger(value.feeBps) || value.feeBps < 0 || value.feeBps > 100) fail("INVALID_POOL", "invalid pool identity or fee");
  const token0 = parseToken(value.token0);
  const token1 = parseToken(value.token1);
  if (token0.address >= token1.address) fail("INVALID_POOL", "pool tokens must be canonical and distinct");
  const reserve0 = positiveBigInt(value.reserve0, true);
  const reserve1 = positiveBigInt(value.reserve1, true);
  const updatedAt = new Date(value.updatedAt);
  if (!Number.isFinite(updatedAt.valueOf())) fail("INVALID_POOL", "invalid pool timestamp");
  return Object.freeze({ ...value, address: value.address.toLowerCase(), token0, token1, reserve0, reserve1, updatedAt: updatedAt.toISOString() });
}

export function parsePosition(value) {
  exactObject(value, ["account", "addedToken0", "addedToken1", "netLpAmount", "pool", "removedToken0", "removedToken1"]);
  if ((!NATIVE_ACCOUNT.test(value.account) && !ADDRESS.test(value.account)) || !ADDRESS.test(value.pool)) fail("INVALID_POSITION", "invalid position identity");
  for (const field of ["netLpAmount", "addedToken0", "addedToken1", "removedToken0", "removedToken1"]) if (!INTEGER.test(value[field])) fail("INVALID_POSITION", "invalid position amount");
  return Object.freeze({ ...value, account: value.account.toLowerCase(), pool: value.pool.toLowerCase() });
}

export function parseSpotPrice(value) {
  exactObject(value, ["pool", "price0Denominator", "price0Numerator", "price1Denominator", "price1Numerator", "token0", "token1", "updatedBlock"]);
  if (![value.pool,value.token0,value.token1].every(item=>ADDRESS.test(item)) || !Number.isSafeInteger(value.updatedBlock) || value.updatedBlock<1) fail("INVALID_PRICE", "invalid price identity");
  for (const field of ["price0Denominator","price0Numerator","price1Denominator","price1Numerator"]) positiveBigInt(value[field]);
  return Object.freeze({ ...value, pool:value.pool.toLowerCase(),token0:value.token0.toLowerCase(),token1:value.token1.toLowerCase() });
}

export function parseTWAP(value) {
  exactObject(value,["fromBlock","intervalSeconds","pool","price0AverageX112","price1AverageX112","toBlock","token0","token1"]);
  if (![value.pool,value.token0,value.token1].every(item=>ADDRESS.test(item)) || !Number.isSafeInteger(value.fromBlock) || !Number.isSafeInteger(value.toBlock) || value.fromBlock<1 || value.toBlock<=value.fromBlock || !Number.isSafeInteger(value.intervalSeconds) || value.intervalSeconds<1) fail("INVALID_TWAP","invalid TWAP identity or interval");
  positiveBigInt(value.price0AverageX112,true);positiveBigInt(value.price1AverageX112,true);return Object.freeze({...value,pool:value.pool.toLowerCase(),token0:value.token0.toLowerCase(),token1:value.token1.toLowerCase()});
}

export function parseFeeSummary(value) {
  exactObject(value,["claimedFee0","claimedFee1","pool","swapFee0","swapFee1","token0","token1"]);if(![value.pool,value.token0,value.token1].every(item=>ADDRESS.test(item)))fail("INVALID_FEES","invalid fee identity");for(const field of ["claimedFee0","claimedFee1","swapFee0","swapFee1"])positiveBigInt(value[field],true);return Object.freeze({...value,pool:value.pool.toLowerCase(),token0:value.token0.toLowerCase(),token1:value.token1.toLowerCase()});
}

export function parseLPProtectionQuote(value, { now = new Date(), maxAgeMs = 15_000 } = {}) {
  exactObject(value,["amountIn","asOf","baseFeeBps","chainId","confidence","coverage","depegBps","depthFeeBps","divergenceFeeBps","failure","jitFeeBps","lpProtection","maxFeeBps","oracleAsOf","oracleMaxAgeSeconds","oracleSourceHash","pool","source","tokenIn","totalFeeBps","toxicFlowFeeBps","version","volatilityFeeBps"]);
  if(value.chainId!==6423||![value.lpProtection,value.pool,value.tokenIn].every(item=>ADDRESS.test(item)&&item.toLowerCase()!==ZERO_ADDRESS)||!/^0x[0-9a-fA-F]{64}$/.test(value.oracleSourceHash)||value.source!=="YNX Testnet EVM RPC + owner-reviewed LP oracle"||value.version!=="ynx-lp-protection-quote-v1"||value.confidence!=="preflight-observed"||!bounded(value.coverage,20,500)||value.failure!==null)fail("INVALID_LP_PROTECTION_QUOTE","LP protection quote identity or provenance is invalid");
  const amountIn=positiveBigInt(value.amountIn);const asOf=new Date(value.asOf);const oracleAsOf=new Date(value.oracleAsOf);const age=now.valueOf()-asOf.valueOf();
  if(!Number.isFinite(asOf.valueOf())||!Number.isFinite(oracleAsOf.valueOf())||!Number.isInteger(maxAgeMs)||maxAgeMs<1||!Number.isInteger(value.oracleMaxAgeSeconds)||value.oracleMaxAgeSeconds<30||value.oracleMaxAgeSeconds>86_400||age<0||age>maxAgeMs||oracleAsOf>asOf||asOf.valueOf()-oracleAsOf.valueOf()>value.oracleMaxAgeSeconds*1000)fail("STALE_LP_PROTECTION_QUOTE","LP protection or Oracle observation is stale or from the future");
  const bps={};for(const field of ["totalFeeBps","baseFeeBps","volatilityFeeBps","depthFeeBps","divergenceFeeBps","toxicFlowFeeBps","jitFeeBps","depegBps"]){if(!Number.isInteger(value[field])||value[field]<0||value[field]>20_000)fail("INVALID_LP_PROTECTION_QUOTE",`invalid ${field}`);bps[field]=value[field]}
  const uncapped=bps.baseFeeBps+bps.volatilityFeeBps+bps.depthFeeBps+bps.divergenceFeeBps+bps.toxicFlowFeeBps+bps.jitFeeBps;
  if(!Number.isInteger(value.maxFeeBps)||value.maxFeeBps<bps.baseFeeBps||value.maxFeeBps>2_000||bps.totalFeeBps!==Math.min(uncapped,value.maxFeeBps))fail("INVALID_LP_PROTECTION_QUOTE","total fee violates on-chain component or cap semantics");
  return Object.freeze({...value,...bps,amountIn,asOf:asOf.toISOString(),oracleAsOf:oracleAsOf.toISOString(),lpProtection:value.lpProtection.toLowerCase(),pool:value.pool.toLowerCase(),tokenIn:value.tokenIn.toLowerCase(),oracleSourceHash:value.oracleSourceHash.toLowerCase()});
}

export function quoteProtectedExactInput({ amountIn, tokenIn, tokenOut, pool, feeQuote, now = new Date() }) {
  pool=parsePool(pool);feeQuote=parseLPProtectionQuote(feeQuote,{now});const input=positiveBigInt(amountIn);
  if(!ADDRESS.test(tokenIn)||!ADDRESS.test(tokenOut)||tokenIn.toLowerCase()===tokenOut.toLowerCase()||feeQuote.pool!==pool.address||feeQuote.tokenIn!==tokenIn.toLowerCase()||feeQuote.amountIn!==input)fail("LP_PROTECTION_BINDING_MISMATCH","fee quote does not bind the exact pool, token and input");
  const zeroForOne=tokenIn.toLowerCase()===pool.token0.address&&tokenOut.toLowerCase()===pool.token1.address;if(!zeroForOne&&!(tokenIn.toLowerCase()===pool.token1.address&&tokenOut.toLowerCase()===pool.token0.address))fail("LP_PROTECTION_BINDING_MISMATCH","tokens do not match the protected pool");
  const reserveIn=zeroForOne?pool.reserve0:pool.reserve1;const reserveOut=zeroForOne?pool.reserve1:pool.reserve0;const output=amountOutAtFee(input,reserveIn,reserveOut,feeQuote.totalFeeBps);
  const step=Object.freeze({pool:pool.address,tokenIn:tokenIn.toLowerCase(),tokenOut:tokenOut.toLowerCase(),amountIn:input,amountOut:output,reserveIn,reserveOut,feeBps:feeQuote.totalFeeBps,feeBreakdown:feeQuote});
  return Object.freeze({kind:"exact-input",amountIn:input,amountOut:output,path:Object.freeze([tokenIn.toLowerCase(),tokenOut.toLowerCase()]),steps:Object.freeze([step]),quotedAt:feeQuote.asOf,source:"authoritative protected-pool RPC fee quote + indexed reserves",version:"ynx-protected-quote-v1",confidence:"deterministic-preflight",failure:null});
}

export function parseIndexedLPProtectionEvent(value) {
  exactObject(value,["asOf","blockHash","blockNumber","chainId","confidence","contractVersion","coverage","details","failure","id","logIndex","lpProtection","pool","source","tokenIn","transactionHash","type","version"]);
  if(value.chainId!==6423||value.contractVersion!=="ynx-lp-protection-v1"||![value.lpProtection,value.pool].every(item=>ADDRESS.test(item)&&item.toLowerCase()!==ZERO_ADDRESS)||!/^0x[0-9a-fA-F]{64}$/.test(value.blockHash)||!/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash)||!Number.isSafeInteger(value.blockNumber)||value.blockNumber<1||!Number.isSafeInteger(value.logIndex)||value.logIndex<0||value.source!=="confirmed YNX Testnet EVM logs"||value.version!=="ynx-lp-protection-event-v1"||value.confidence!=="confirmed-on-chain"||!bounded(value.coverage,20,500)||value.failure!==null)fail("INVALID_LP_PROTECTION_EVENT","LP protection event identity or provenance is invalid");
  const expected={"pool-registered":["token0","token1"],"config-scheduled":["configHash","executableAt"],"config-changed":["configHash"],assessed:["amountIn","baseFeeBps","depegBps","depthFeeBps","divergenceFeeBps","incentiveAmount","jitFeeBps","oracleAsOf","oracleSourceHash","realizedFeeAmount","totalFeeBps","toxicFlowFeeBps","volatilityFeeBps"]}[value.type];
  if(!expected)fail("INVALID_LP_PROTECTION_EVENT","unsupported LP protection event type");exactObject(value.details,expected);
  const asOf=new Date(value.asOf);if(!Number.isFinite(asOf.valueOf()))fail("INVALID_LP_PROTECTION_EVENT","invalid event time");
  if(value.type==="assessed"){
    if(!ADDRESS.test(value.tokenIn)||!/^0x[0-9a-fA-F]{64}$/.test(value.details.oracleSourceHash))fail("INVALID_LP_PROTECTION_EVENT","invalid assessment identity");
    const amount=positiveBigInt(value.details.amountIn);const realized=positiveBigInt(value.details.realizedFeeAmount,true);if(value.details.incentiveAmount!=="0")fail("INVALID_LP_PROTECTION_EVENT","incentive must remain separate and zero");
    const bps={};for(const field of ["totalFeeBps","baseFeeBps","volatilityFeeBps","depthFeeBps","divergenceFeeBps","toxicFlowFeeBps","jitFeeBps","depegBps"]){const parsed=Number(value.details[field]);if(!/^[0-9]{1,5}$/.test(value.details[field])||!Number.isSafeInteger(parsed)||parsed>20_000)fail("INVALID_LP_PROTECTION_EVENT",`invalid ${field}`);bps[field]=parsed}
    const componentSum=bps.baseFeeBps+bps.volatilityFeeBps+bps.depthFeeBps+bps.divergenceFeeBps+bps.toxicFlowFeeBps+bps.jitFeeBps;
    if(bps.totalFeeBps>2_000||bps.totalFeeBps<bps.baseFeeBps||bps.totalFeeBps>componentSum||realized!==amount*BigInt(bps.totalFeeBps)/BPS||!/^[1-9][0-9]{0,77}$/.test(value.details.oracleAsOf))fail("INVALID_LP_PROTECTION_EVENT","invalid realized fee semantics");
    return Object.freeze({...value,asOf:asOf.toISOString(),lpProtection:value.lpProtection.toLowerCase(),pool:value.pool.toLowerCase(),tokenIn:value.tokenIn.toLowerCase(),details:Object.freeze({...value.details,amountIn:amount,realizedFeeAmount:realized,incentiveAmount:0n,...bps,oracleSourceHash:value.details.oracleSourceHash.toLowerCase(),oracleAsOf:BigInt(value.details.oracleAsOf)})});
  }
  if(value.tokenIn!=="")fail("INVALID_LP_PROTECTION_EVENT","non-assessment event contains token input");
  if(value.type==="pool-registered"&&(!ADDRESS.test(value.details.token0)||!ADDRESS.test(value.details.token1)||value.details.token0.toLowerCase()===ZERO_ADDRESS||value.details.token1.toLowerCase()===ZERO_ADDRESS||value.details.token0.toLowerCase()>=value.details.token1.toLowerCase()))fail("INVALID_LP_PROTECTION_EVENT","invalid registered token ordering");
  if((value.type==="config-scheduled"||value.type==="config-changed")&&!/^0x[0-9a-fA-F]{64}$/.test(value.details.configHash))fail("INVALID_LP_PROTECTION_EVENT","invalid configuration hash");
  if(value.type==="config-scheduled"&&!/^[1-9][0-9]{0,77}$/.test(value.details.executableAt))fail("INVALID_LP_PROTECTION_EVENT","invalid configuration execution time");
  return Object.freeze({...value,asOf:asOf.toISOString(),lpProtection:value.lpProtection.toLowerCase(),pool:value.pool.toLowerCase(),details:Object.freeze({...value.details})});
}

export function reconcileLPProtectionQuote({ feeQuote, event, now = new Date() }) {
  feeQuote=parseLPProtectionQuote(feeQuote,{now});event=parseIndexedLPProtectionEvent(event);
  if(event.type!=="assessed"||event.lpProtection!==feeQuote.lpProtection||event.pool!==feeQuote.pool||event.tokenIn!==feeQuote.tokenIn||event.details.amountIn!==feeQuote.amountIn||event.details.oracleSourceHash!==feeQuote.oracleSourceHash)fail("LP_PROTECTION_RECONCILIATION_MISMATCH","confirmed assessment does not match the approved fee quote");
  for(const field of ["totalFeeBps","baseFeeBps","volatilityFeeBps","depthFeeBps","divergenceFeeBps","toxicFlowFeeBps","jitFeeBps","depegBps"])if(event.details[field]!==feeQuote[field])fail("LP_PROTECTION_RECONCILIATION_MISMATCH",`confirmed ${field} differs from preflight`);
  return Object.freeze({status:"confirmed",transactionHash:event.transactionHash,blockHash:event.blockHash,blockNumber:event.blockNumber,logIndex:event.logIndex,pool:event.pool,tokenIn:event.tokenIn,realizedFeeAmount:event.details.realizedFeeAmount,incentiveAmount:event.details.incentiveAmount,feeBps:event.details.totalFeeBps,source:event.source,asOf:event.asOf,version:"ynx-lp-protection-reconciliation-v1",confidence:"confirmed-on-chain",failure:null});
}

export function amountOut(amountIn, reserveIn, reserveOut, feeBps = 30) {
  amountIn = positiveBigInt(amountIn);
  reserveIn = positiveBigInt(reserveIn);
  reserveOut = positiveBigInt(reserveOut);
  validateFee(feeBps);
  const adjusted = amountIn * (BPS - BigInt(feeBps));
  const output = adjusted * reserveOut / (reserveIn * BPS + adjusted);
  if (output <= 0n || output >= reserveOut) fail("INSUFFICIENT_LIQUIDITY", "quote has no executable output");
  return output;
}

function amountOutAtFee(amountIn, reserveIn, reserveOut, feeBps) {
  amountIn=positiveBigInt(amountIn);reserveIn=positiveBigInt(reserveIn);reserveOut=positiveBigInt(reserveOut);
  if(!Number.isInteger(feeBps)||feeBps<0||feeBps>2_000)fail("INVALID_FEE","protected fee must be 0..2000 bps");
  const adjusted=amountIn*(BPS-BigInt(feeBps));const output=adjusted*reserveOut/(reserveIn*BPS+adjusted);
  if(output<=0n||output>=reserveOut)fail("INSUFFICIENT_LIQUIDITY","quote has no executable output");return output;
}

export function amountIn(amountOutValue, reserveIn, reserveOut, feeBps = 30) {
  const output = positiveBigInt(amountOutValue);
  reserveIn = positiveBigInt(reserveIn);
  reserveOut = positiveBigInt(reserveOut);
  validateFee(feeBps);
  if (output >= reserveOut) fail("INSUFFICIENT_LIQUIDITY", "requested output consumes reserve");
  return reserveIn * output * BPS / ((reserveOut - output) * (BPS - BigInt(feeBps))) + 1n;
}

export function quoteExactInput({ amountIn: input, tokenIn, tokenOut, pools, maxHops = MAX_HOPS, now = new Date() }) {
  const routes = enumerateRoutes(tokenIn, tokenOut, pools, maxHops);
  if (routes.length === 0) fail("NO_ROUTE", "no supported route");
  const start = positiveBigInt(input);
  const quoted = routes.map((route) => quoteRouteExactInput(start, route, tokenIn, now));
  quoted.sort((a, b) => a.amountOut === b.amountOut ? routeKey(a).localeCompare(routeKey(b)) : a.amountOut > b.amountOut ? -1 : 1);
  return Object.freeze(quoted[0]);
}

export function quoteExactOutput({ amountOut: output, tokenIn, tokenOut, pools, maxHops = MAX_HOPS, now = new Date() }) {
  const routes = enumerateRoutes(tokenIn, tokenOut, pools, maxHops);
  if (routes.length === 0) fail("NO_ROUTE", "no supported route");
  const target = positiveBigInt(output);
  const quoted = routes.map((route) => quoteRouteExactOutput(target, route, tokenOut, now));
  quoted.sort((a, b) => a.amountIn === b.amountIn ? routeKey(a).localeCompare(routeKey(b)) : a.amountIn < b.amountIn ? -1 : 1);
  return Object.freeze(quoted[0]);
}

export function minimumOutput(amount, slippageBps) {
  validateSlippage(slippageBps);
  return positiveBigInt(amount) * (BPS - BigInt(slippageBps)) / BPS;
}

export function maximumInput(amount, slippageBps) {
  validateSlippage(slippageBps);
  const input = positiveBigInt(amount);
  return (input * (BPS + BigInt(slippageBps)) + BPS - 1n) / BPS;
}

export function priceImpactBps(quote) {
  let expected = quote.amountIn;
  for (const step of quote.steps) expected = expected * step.reserveOut / step.reserveIn;
  if (expected === 0n) return 0;
  return Number((expected > quote.amountOut ? (expected - quote.amountOut) * BPS / expected : 0n));
}

export function buildSwapExactInputTx({ router, quote, recipient, slippageBps, deadline, chainId = 6423 }) {
  validateTxCommon(router, recipient, deadline, chainId);
  return Object.freeze({
    chainId,
    to: router.toLowerCase(),
    functionName: "swapExactInput",
    args: [quote.amountIn.toString(), minimumOutput(quote.amountOut, slippageBps).toString(), quote.path, recipient.toLowerCase(), deadline],
    value: "0",
  });
}

export function buildSwapExactOutputTx({ router, quote, recipient, slippageBps, deadline, chainId = 6423 }) {
  validateTxCommon(router, recipient, deadline, chainId);
  return Object.freeze({
    chainId,
    to: router.toLowerCase(),
    functionName: "swapExactOutput",
    args: [quote.amountOut.toString(), maximumInput(quote.amountIn, slippageBps).toString(), quote.path, recipient.toLowerCase(), deadline],
    value: "0",
  });
}

export function buildAddLiquidityTx({ router, tokenA, tokenB, amountA, amountB, recipient, deadline, chainId = 6423 }) {
  validateTxCommon(router, recipient, deadline, chainId);
  for (const token of [tokenA, tokenB]) if (!ADDRESS.test(token)) fail("INVALID_TOKEN", "invalid token address");
  return Object.freeze({ chainId, to: router.toLowerCase(), functionName: "addLiquidity", args: [tokenA.toLowerCase(), tokenB.toLowerCase(), positiveBigInt(amountA).toString(), positiveBigInt(amountB).toString(), recipient.toLowerCase(), deadline], value: "0" });
}

export function buildRemoveLiquidityTx({ router, tokenA, tokenB, liquidity, amountAMin, amountBMin, recipient, deadline, chainId = 6423 }) {
  validateTxCommon(router, recipient, deadline, chainId);
  for (const token of [tokenA, tokenB]) if (!ADDRESS.test(token)) fail("INVALID_TOKEN", "invalid token address");
  return Object.freeze({ chainId, to: router.toLowerCase(), functionName: "removeLiquidity", args: [tokenA.toLowerCase(), tokenB.toLowerCase(), positiveBigInt(liquidity).toString(), positiveBigInt(amountAMin, true).toString(), positiveBigInt(amountBMin, true).toString(), recipient.toLowerCase(), deadline], value: "0" });
}

export function assertFreshQuote(quote, { now = new Date(), maxAgeMs = 15_000 } = {}) {
  const age = now.valueOf() - new Date(quote.quotedAt).valueOf();
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1 || age < 0 || age > maxAgeMs) fail("STALE_QUOTE", "quote is stale or from the future");
  return quote;
}

export function parseVaultState(value) {
  exactObject(value, ["actionNonce", "asOf", "chainId", "configured", "engine", "failure", "killed", "mandate", "nonceDomain", "oracle", "owner", "paused", "revoked", "router", "source", "vault", "version"]);
  if (value.chainId !== 6423 || value.source !== "YNX Testnet EVM RPC" || value.version !== "ynx-strategy-vault-v1" || value.failure !== null) fail("INVALID_VAULT_STATE", "vault state is not authoritative");
  for (const field of ["vault", "owner", "engine", "router", "oracle"]) if (!ADDRESS.test(value[field])) fail("INVALID_VAULT_STATE", `invalid ${field}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value.nonceDomain)) fail("INVALID_VAULT_STATE", "invalid nonce domain");
  for (const field of ["configured", "paused", "revoked", "killed"]) if (typeof value[field] !== "boolean") fail("INVALID_VAULT_STATE", `invalid ${field}`);
  const asOf = new Date(value.asOf);
  if (!Number.isFinite(asOf.valueOf())) fail("INVALID_VAULT_STATE", "invalid state timestamp");
  const mandate = parseVaultMandate(value.mandate);
  return Object.freeze({ ...value, actionNonce: positiveBigInt(value.actionNonce, true), asOf: asOf.toISOString(), mandate, vault: value.vault.toLowerCase(), owner: value.owner.toLowerCase(), engine: value.engine.toLowerCase(), router: value.router.toLowerCase(), oracle: value.oracle.toLowerCase(), nonceDomain: value.nonceDomain.toLowerCase() });
}

export function assertExecutableVaultState(state, { now = new Date(), maxAgeMs = 15_000 } = {}) {
  state = parseVaultState(state);
  const age = now.valueOf() - new Date(state.asOf).valueOf();
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1 || age < 0 || age > maxAgeMs) fail("STALE_VAULT_STATE", "vault state is stale or from the future");
  if (!state.configured || state.paused || state.revoked || state.killed) fail("VAULT_NOT_EXECUTABLE", "vault mandate is not executable");
  if (BigInt(Math.floor(now.valueOf() / 1000)) >= state.mandate.expiresAt) fail("VAULT_MANDATE_EXPIRED", "vault mandate expired");
  return state;
}

export function buildVaultSwapExactInputTx({ state, quote, slippageBps, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  assertFreshQuote(quote, { now });
  validateVaultDeadline(deadline, state, now);
  return vaultRequest(state, "swapExactInput", [state.actionNonce.toString(), quote.amountIn.toString(), minimumOutput(quote.amountOut, slippageBps).toString(), quote.path, deadline], "limited-engine-session");
}

export function buildVaultSwapExactOutputTx({ state, quote, slippageBps, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  assertFreshQuote(quote, { now });
  validateVaultDeadline(deadline, state, now);
  return vaultRequest(state, "swapExactOutput", [state.actionNonce.toString(), quote.amountOut.toString(), maximumInput(quote.amountIn, slippageBps).toString(), quote.path, deadline], "limited-engine-session");
}

export function buildVaultAddLiquidityTx({ state, tokenA, tokenB, amountA, amountB, minLiquidity, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  validateVaultTokens(tokenA, tokenB);
  validateVaultDeadline(deadline, state, now);
  return vaultRequest(state, "addLiquidity", [state.actionNonce.toString(), tokenA.toLowerCase(), tokenB.toLowerCase(), positiveBigInt(amountA).toString(), positiveBigInt(amountB).toString(), positiveBigInt(minLiquidity).toString(), deadline], "limited-engine-session");
}

export function buildVaultRemoveLiquidityTx({ state, tokenA, tokenB, liquidity, amountAMin, amountBMin, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  validateVaultTokens(tokenA, tokenB);
  validateVaultDeadline(deadline, state, now);
  return vaultRequest(state, "removeLiquidity", [state.actionNonce.toString(), tokenA.toLowerCase(), tokenB.toLowerCase(), positiveBigInt(liquidity).toString(), positiveBigInt(amountAMin, true).toString(), positiveBigInt(amountBMin, true).toString(), deadline], "limited-engine-session");
}

export function parseExecutionSnapshot(value, { state, now = new Date(), maxAgeMs = 15_000 } = {}) {
  state = assertExecutableVaultState(state, { now, maxAgeMs });
  exactObject(value, ["asOf", "chainId", "confidence", "coverage", "failure", "fees", "gas", "oracle", "risk", "source", "vault", "version"]);
  if (value.chainId !== 6423 || value.vault?.toLowerCase() !== state.vault || value.source !== "YNX Testnet RPC + owner-reviewed oracle" || value.version !== "ynx-execution-snapshot-v1" || value.confidence !== "preflight-observed" || value.failure !== null || !bounded(value.coverage, 20, 500)) fail("INVALID_EXECUTION_SNAPSHOT", "snapshot provenance is not authoritative");
  const asOf = new Date(value.asOf);
  const age = now.valueOf() - asOf.valueOf();
  if (!Number.isFinite(asOf.valueOf()) || !Number.isInteger(maxAgeMs) || maxAgeMs < 1 || age < 0 || age > maxAgeMs) fail("STALE_EXECUTION_SNAPSHOT", "execution snapshot is stale or from the future");
  exactObject(value.gas, ["estimatedGas", "gasPrice", "provider"]);
  if (!bounded(value.gas.provider, 3, 120)) fail("INVALID_EXECUTION_SNAPSHOT", "gas provider is missing");
  const estimatedGas = positiveBigInt(value.gas.estimatedGas);
  const gasPrice = positiveBigInt(value.gas.gasPrice, true);
  if (gasPrice > state.mandate.maxGasPrice) fail("GAS_LIMIT_EXCEEDED", "observed gas price exceeds vault mandate");
  exactObject(value.fees, ["hiddenSpreadBps", "performanceFeeBps", "protocolFeeShareBps", "venueFeeBps"]);
  for (const field of ["hiddenSpreadBps", "performanceFeeBps", "protocolFeeShareBps", "venueFeeBps"]) if (!Number.isInteger(value.fees[field])) fail("INVALID_EXECUTION_SNAPSHOT", "fee fields must be integer bps");
  if (value.fees.hiddenSpreadBps !== 0 || value.fees.performanceFeeBps !== 0 || value.fees.venueFeeBps < 0 || value.fees.venueFeeBps > 100 || value.fees.protocolFeeShareBps < 0 || value.fees.protocolFeeShareBps > 5_000) fail("INVALID_EXECUTION_FEES", "fees violate the public v1 fee policy");
  exactObject(value.oracle, ["address", "deviationBps", "updatedAt"]);
  const oracleUpdatedAt = new Date(value.oracle.updatedAt);
  if (!ADDRESS.test(value.oracle.address) || value.oracle.address.toLowerCase() !== state.oracle || !Number.isFinite(oracleUpdatedAt.valueOf()) || !Number.isInteger(value.oracle.deviationBps) || value.oracle.deviationBps < 0) fail("INVALID_EXECUTION_SNAPSHOT", "oracle identity or observation is invalid");
  const oracleAgeMs = now.valueOf() - oracleUpdatedAt.valueOf();
  if (oracleAgeMs < 0 || BigInt(Math.floor(oracleAgeMs / 1000)) > state.mandate.oracleMaxAge) fail("STALE_ORACLE", "oracle observation is stale or from the future");
  if (BigInt(value.oracle.deviationBps) > state.mandate.depegToleranceBps) fail("DEPEG_LIMIT_EXCEEDED", "oracle deviation exceeds vault mandate");
  exactObject(value.risk, ["dailyLossBps", "drawdownBps", "priceImpactBps", "slippageBps", "tradeValue", "vaultValue"]);
  for (const field of ["dailyLossBps", "drawdownBps", "priceImpactBps", "slippageBps"]) if (!Number.isInteger(value.risk[field]) || value.risk[field] < 0) fail("INVALID_EXECUTION_SNAPSHOT", "risk bps must be non-negative integers");
  const tradeValue = positiveBigInt(value.risk.tradeValue, true);
  const vaultValue = positiveBigInt(value.risk.vaultValue, true);
  const bounds = [[tradeValue,state.mandate.maxTradeValue,"TRADE_LIMIT_EXCEEDED"],[vaultValue,state.mandate.maxVaultValue,"VAULT_LIMIT_EXCEEDED"],[BigInt(value.risk.slippageBps),state.mandate.maxSlippageBps,"SLIPPAGE_LIMIT_EXCEEDED"],[BigInt(value.risk.priceImpactBps),state.mandate.maxImpactBps,"IMPACT_LIMIT_EXCEEDED"],[BigInt(value.risk.dailyLossBps),state.mandate.maxDailyLossBps,"DAILY_LOSS_LIMIT_EXCEEDED"],[BigInt(value.risk.drawdownBps),state.mandate.maxDrawdownBps,"DRAWDOWN_LIMIT_EXCEEDED"]];
  for (const [observed, limit, code] of bounds) if (observed > limit) fail(code, "observed risk exceeds vault mandate");
  return Object.freeze({ ...value, vault: state.vault, asOf: asOf.toISOString(), gas: Object.freeze({ ...value.gas, estimatedGas, gasPrice, estimatedFeeNative: estimatedGas * gasPrice }), fees: Object.freeze({ ...value.fees }), oracle: Object.freeze({ ...value.oracle, address: state.oracle, updatedAt: oracleUpdatedAt.toISOString() }), risk: Object.freeze({ ...value.risk, tradeValue, vaultValue }) });
}

export function attributeQuoteFees({ quote, protocolFeeShareBps }) {
  if (!quote || !Array.isArray(quote.steps) || !Number.isInteger(protocolFeeShareBps) || protocolFeeShareBps < 0 || protocolFeeShareBps > 5_000) fail("INVALID_FEE_ATTRIBUTION", "quote or protocol fee share is invalid");
  const items = quote.steps.map((step) => {
    validateFee(step.feeBps);
    const inputAmount = positiveBigInt(step.amountIn);
    const totalFee = inputAmount * BigInt(step.feeBps) / BPS;
    const protocolFee = totalFee * BigInt(protocolFeeShareBps) / BPS;
    return Object.freeze({ pool: step.pool.toLowerCase(), token: step.tokenIn.toLowerCase(), inputAmount, totalFee, protocolFee, lpFee: totalFee - protocolFee, venueFeeBps: step.feeBps, protocolFeeShareBps });
  });
  return Object.freeze({ source: "deterministic quote inputs + on-chain pool fee parameters", asOf: quote.quotedAt, version: "ynx-fee-attribution-v1", coverage: "Per-hop nominal input-token fees; excludes gas and price impact", confidence: "deterministic-preflight", failure: null, hiddenSpreadBps: 0, performanceFeeBps: 0, items: Object.freeze(items) });
}

export function describePoolFeeCollection({ poolType }) {
  if (poolType !== "constant-product-v1") fail("UNSUPPORTED_POOL_TYPE", "fee collection semantics are unknown for this pool type");
  return Object.freeze({ poolType, source: "YNXDexPool v1 contract semantics", version: "ynx-fee-collection-capability-v1", lpCollectSupported: false, lpFeeMode: "embedded-in-pool-reserves", realizationAction: "removeLiquidity", protocolCollectAuthority: "factory protocolFeeRecipient only", automaticExecution: false, failure: null });
}

export function buildVaultCollectFeesTx({ poolType }) {
  describePoolFeeCollection({ poolType });
  fail("LP_COLLECT_UNSUPPORTED", "constant-product-v1 LP fees are embedded in reserves and can only be realized by removing liquidity");
}

export function buildVaultCompoundTx(input) {
  return buildVaultAddLiquidityTx(input);
}

export function buildVaultRebalancePlan({ state, remove, target, now = new Date() }) {
  exactObject(remove, ["amountAMin", "amountBMin", "deadline", "liquidity", "tokenA", "tokenB"]);
  exactObject(target, ["tokenA", "tokenB"]);
  validateVaultTokens(target.tokenA, target.tokenB);
  const firstRequest = buildVaultRemoveLiquidityTx({ state, ...remove, now });
  return Object.freeze({ source: "caller-supplied bounded Vault actions", asOf: now.toISOString(), version: "ynx-vault-rebalance-plan-v1", operation: "rebalance", automaticExecution: false, strategySelection: false, capitalAllocation: false, firstRequest, continuation: Object.freeze({ requires: "confirmed ActionExecuted plus fresh Vault state and a new canonical Wallet approval", functionName: "addLiquidity", tokenA: target.tokenA.toLowerCase(), tokenB: target.tokenB.toLowerCase() }), failure: null });
}

export function parseFairFlowState(value) {
  exactObject(value,["activeIntentCount","asOf","batchId","chainId","commitEnd","failure","fairFlow","intentDomain","intentEnd","revealEnd","settleEnd","source","status","token0","token1","user","userNonce","version"]);
  if(value.chainId!==6423||value.source!=="YNX Testnet EVM RPC"||value.version!=="ynx-fairflow-state-v1"||value.failure!==null||!ADDRESS.test(value.fairFlow)||!ADDRESS.test(value.user)||!ADDRESS.test(value.token0)||!ADDRESS.test(value.token1)||value.token0.toLowerCase()>=value.token1.toLowerCase()||!/^0x[0-9a-fA-F]{64}$/.test(value.intentDomain)) fail("INVALID_FAIRFLOW_STATE","invalid FairFlow state identity");
  if(!["accepting","finalized","settled","aborted","failed"].includes(value.status)) fail("INVALID_FAIRFLOW_STATE","invalid FairFlow batch status");
  const asOf=new Date(value.asOf);if(!Number.isFinite(asOf.valueOf()))fail("INVALID_FAIRFLOW_STATE","invalid FairFlow state timestamp");
  const numeric={};for(const field of ["activeIntentCount","batchId","commitEnd","intentEnd","revealEnd","settleEnd","userNonce"])numeric[field]=positiveBigInt(value[field],field==="activeIntentCount"||field==="userNonce");
  if(numeric.commitEnd<=numeric.intentEnd||numeric.revealEnd<=numeric.commitEnd||numeric.settleEnd<=numeric.revealEnd)fail("INVALID_FAIRFLOW_STATE","invalid FairFlow schedule");
  return Object.freeze({...value,...numeric,asOf:asOf.toISOString(),fairFlow:value.fairFlow.toLowerCase(),intentDomain:value.intentDomain.toLowerCase(),token0:value.token0.toLowerCase(),token1:value.token1.toLowerCase(),user:value.user.toLowerCase()});
}

export function buildSubmitFairFlowIntentTx({state,sellToken,sellAmount,minBuyAmount,validTo,now=new Date()}) {
  state=assertFreshFairFlowState(state,now);
  const nowSeconds=BigInt(Math.floor(now.valueOf()/1000));
  if(state.status!=="accepting"||nowSeconds>=state.intentEnd)fail("FAIRFLOW_NOT_ACCEPTING","FairFlow Intent window is closed");
  if(!ADDRESS.test(sellToken)||![state.token0,state.token1].includes(sellToken.toLowerCase()))fail("INVALID_TOKEN","sell token is not in the FairFlow batch");
  const expiry=positiveBigInt(validTo);if(expiry<state.settleEnd)fail("INVALID_DEADLINE","Intent validity must cover the settlement window");
  return fairFlowRequest(state,"submitIntent",[state.batchId.toString(),sellToken.toLowerCase(),positiveBigInt(sellAmount).toString(),positiveBigInt(minBuyAmount).toString(),expiry.toString()]);
}

export function buildCancelFairFlowIntentTx({state,intentId,owner,now=new Date()}) {
  state=assertFreshFairFlowState(state,now);
  if(!/^0x[0-9a-fA-F]{64}$/.test(intentId)||!ADDRESS.test(owner)||owner.toLowerCase()!==state.user)fail("UNAUTHORIZED_FAIRFLOW_REQUEST","only the Intent owner may cancel");
  if(state.status==="settled")fail("FAIRFLOW_ALREADY_SETTLED","settled Intent cannot be cancelled");
  return fairFlowRequest(state,"cancelIntent",[intentId.toLowerCase()]);
}

export function parseIndexedFairFlowEvent(value) {
  exactObject(value,["actor","asOf","batchId","blockHash","blockNumber","chainId","confidence","contractVersion","coverage","details","failure","fairFlow","id","intentId","logIndex","source","transactionHash","type","version"]);
  if(value.chainId!==6423||value.contractVersion!=="ynx-fairflow-v1"||value.source!=="confirmed YNX Testnet EVM logs"||value.version!=="ynx-fairflow-event-v1"||value.confidence!=="confirmed-on-chain"||value.failure!==null||!bounded(value.coverage,20,500)||!ADDRESS.test(value.fairFlow)||!/^0x[0-9a-fA-F]{64}$/.test(value.blockHash)||!/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash)||!Number.isSafeInteger(value.blockNumber)||value.blockNumber<1||!Number.isSafeInteger(value.logIndex)||value.logIndex<0)fail("INVALID_FAIRFLOW_EVENT","invalid FairFlow event identity or provenance");
  positiveBigInt(value.batchId);const asOf=new Date(value.asOf);if(!Number.isFinite(asOf.valueOf()))fail("INVALID_FAIRFLOW_EVENT","invalid FairFlow event timestamp");
  const schemas={"batch-opened":["commitEnd","intentEnd","revealEnd","settleEnd","token0","token1"],"intent-submitted":["minBuyAmount","nonce","sellAmount","validTo","zeroForOne"],"intent-cancelled":["batchAborted"],"solution-committed":["commitment"],"solution-revealed":["executionDigest","priceX96","rebateBps","routeHash","scoreToken0"],"winner-finalized":["bestExecutionDigest","priceX96","rebateBps","routeHash","scoreToken0"],"intent-settled":["baseBuyAmount","priceImprovement","sellAmount","solverFundedRebate"],"batch-settled":["bestExecutionDigest","externalInput0","externalInput1","solverOutput0","solverOutput1","userInput0","userInput1","userOutput0","userOutput1"],"batch-failed":["reason","slashedBond"],"solver-slashed":["amount","reason"]};
  const schema=schemas[value.type];if(!schema)fail("INVALID_FAIRFLOW_EVENT","unsupported FairFlow event type");exactObject(value.details,schema);
  const intentType=["intent-submitted","intent-cancelled","intent-settled"].includes(value.type);if(intentType!==/^0x[0-9a-fA-F]{64}$/.test(value.intentId))fail("INVALID_FAIRFLOW_EVENT","invalid Intent event identity");
  if(value.type==="batch-opened"){if(value.actor!==""||!ADDRESS.test(value.details.token0)||!ADDRESS.test(value.details.token1)||value.details.token0.toLowerCase()>=value.details.token1.toLowerCase())fail("INVALID_FAIRFLOW_EVENT","invalid batch tokens");}else if(!ADDRESS.test(value.actor))fail("INVALID_FAIRFLOW_EVENT","invalid FairFlow actor");
  for(const [key,item] of Object.entries(value.details)){if(["token0","token1"].includes(key)){if(!ADDRESS.test(item))fail("INVALID_FAIRFLOW_EVENT","invalid token detail");}else if(["commitment","executionDigest","routeHash","bestExecutionDigest","reason"].includes(key)){if(!/^0x[0-9a-fA-F]{64}$/.test(item))fail("INVALID_FAIRFLOW_EVENT","invalid digest detail");}else if(["zeroForOne","batchAborted"].includes(key)){if(!["true","false"].includes(item))fail("INVALID_FAIRFLOW_EVENT","invalid boolean detail");}else positiveBigInt(item,true);}
  return Object.freeze({...value,fairFlow:value.fairFlow.toLowerCase(),actor:value.actor.toLowerCase(),intentId:value.intentId.toLowerCase(),blockHash:value.blockHash.toLowerCase(),transactionHash:value.transactionHash.toLowerCase(),asOf:asOf.toISOString(),details:Object.freeze({...value.details})});
}

export async function digestFairFlowRequest(request) {
  validateFairFlowRequest(request);
  const payload=JSON.stringify([request.chainId,request.to,request.executor,request.functionName,request.args,request.value,request.authority,request.approvalRequired,request.intentDomain,request.userNonce,request.batchToken0,request.batchToken1,request.sourceStateAsOf]);
  const digest=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload));return `0x${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("")}`;
}

export async function submitApprovedFairFlowRequest({request,approval,sendTransaction,now=new Date()}) {
  validateFairFlowRequest(request);if(typeof sendTransaction!=="function")fail("INVALID_TRANSPORT","an explicit canonical Wallet transport is required");
  exactObject(approval,["approved","asOf","chainId","expiresAt","failure","fairFlow","intentDomain","productClientId","requestDigest","revoked","scopes","source","user","userNonce"]);
  if(approval.approved!==true||approval.revoked!==false||approval.failure!==null||approval.chainId!==6423||approval.productClientId!=="ynx-dex-web-v1"||approval.source!=="canonical YNX Wallet introspection")fail("INVALID_APPROVAL","canonical Wallet approval is not active");
  if(!ADDRESS.test(approval.fairFlow)||!ADDRESS.test(approval.user)||!/^0x[0-9a-fA-F]{64}$/.test(approval.intentDomain)||approval.fairFlow.toLowerCase()!==request.to||approval.user.toLowerCase()!==request.executor||approval.intentDomain.toLowerCase()!==request.intentDomain||String(approval.userNonce)!==request.userNonce)fail("APPROVAL_MISMATCH","approval identity does not match FairFlow request");
  if(!Array.isArray(approval.scopes)||approval.scopes.length!==1||approval.scopes[0]!=="dex:fairflow:intent")fail("APPROVAL_SCOPE","FairFlow approval scope must be exact");
  if(!/^0x[0-9a-fA-F]{64}$/.test(approval.requestDigest)||approval.requestDigest.toLowerCase()!==await digestFairFlowRequest(request))fail("APPROVAL_MISMATCH","approval digest does not match FairFlow request");
  const asOf=new Date(approval.asOf),expiresAt=new Date(approval.expiresAt);if(!Number.isFinite(asOf.valueOf())||!Number.isFinite(expiresAt.valueOf())||asOf>now||expiresAt<=now)fail("APPROVAL_EXPIRED","approval timing is invalid");
  const result=await sendTransaction(request);exactObject(result,["provider","submittedAt","transactionHash"]);if(!bounded(result.provider,1,80)||!/^0x[0-9a-fA-F]{64}$/.test(result.transactionHash)||!Number.isFinite(new Date(result.submittedAt).valueOf()))fail("INVALID_SUBMISSION","transport returned invalid submission evidence");
  return Object.freeze({status:"submitted-unconfirmed",source:"canonical YNX Wallet transport",asOf:new Date(result.submittedAt).toISOString(),version:"ynx-fairflow-submission-v1",failure:null,provider:result.provider,transactionHash:result.transactionHash.toLowerCase(),fairFlow:request.to,user:request.executor,userNonce:request.userNonce,requestDigest:approval.requestDigest.toLowerCase(),method:request.functionName});
}

export function reconcileIndexedFairFlowRequest({request,event}) {
  validateFairFlowRequest(request);event=parseIndexedFairFlowEvent(event);
  if(event.fairFlow!==request.to||event.actor!==request.executor)fail("RECEIPT_MISMATCH","FairFlow event identity does not match request");
  if(request.functionName==="submitIntent"){
    const expectedDirection=request.args[1]===request.batchToken0?"true":"false";
    if(event.type!=="intent-submitted"||event.batchId!==request.args[0]||event.details.zeroForOne!==expectedDirection||event.details.sellAmount!==request.args[2]||event.details.minBuyAmount!==request.args[3]||event.details.validTo!==request.args[4])fail("RECEIPT_MISMATCH","IntentSubmitted event does not match request");
  }else if(event.type!=="intent-cancelled"||event.intentId!==request.args[0])fail("RECEIPT_MISMATCH","IntentCancelled event does not match request");
  return Object.freeze({source:event.source,asOf:event.asOf,version:"ynx-fairflow-indexed-reconciliation-v1",coverage:event.coverage,confidence:event.confidence,failure:null,transactionHash:event.transactionHash,blockHash:event.blockHash,blockNumber:event.blockNumber,logIndex:event.logIndex,fairFlow:event.fairFlow,user:event.actor,batchId:event.batchId,intentId:event.intentId,method:request.functionName});
}

export function buildPauseVaultTx({ state, requestedBy }) {
  state = parseVaultState(state);
  if (!ADDRESS.test(requestedBy) || ![state.owner, state.engine].includes(requestedBy.toLowerCase())) fail("UNAUTHORIZED_VAULT_REQUEST", "pause requires owner or engine");
  return vaultRequest(state, "pause", [], requestedBy.toLowerCase() === state.owner ? "owner" : "limited-engine-session");
}

export function buildEmergencyExitTx({ state, requestedBy, recipient }) {
  state = parseVaultState(state);
  if (!ADDRESS.test(requestedBy) || requestedBy.toLowerCase() !== state.owner || !ADDRESS.test(recipient)) fail("UNAUTHORIZED_VAULT_REQUEST", "emergency exit requires owner");
  return vaultRequest(state, "emergencyExit", [recipient.toLowerCase()], "owner");
}

export function reconcileVaultAction({ request, receipt, latestBlock, minConfirmations = 12, asOf = new Date() }) {
  exactObject(request, ["approvalRequired", "args", "authority", "chainId", "executor", "functionName", "nonceDomain", "sourceStateAsOf", "to", "value"]);
  exactObject(receipt, ["blockNumber", "chainId", "events", "status", "to", "transactionHash"]);
  if (request.chainId !== 6423 || receipt.chainId !== 6423 || request.to !== receipt.to?.toLowerCase() || receipt.status !== "success" || !/^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash)) fail("INVALID_RECEIPT", "receipt identity or status mismatch");
  if (!Number.isSafeInteger(receipt.blockNumber) || !Number.isSafeInteger(latestBlock) || receipt.blockNumber < 1 || latestBlock < receipt.blockNumber || !Number.isInteger(minConfirmations) || minConfirmations < 1) fail("INVALID_RECEIPT", "invalid confirmation state");
  const confirmations = latestBlock - receipt.blockNumber + 1;
  if (confirmations < minConfirmations) fail("UNCONFIRMED_RECEIPT", "receipt has insufficient confirmations");
  if (!Array.isArray(receipt.events)) fail("INVALID_RECEIPT", "receipt events missing");
  const action = receipt.events.find((event) => event?.eventName === "ActionExecuted");
  if (!action) fail("INVALID_RECEIPT", "ActionExecuted event missing");
  exactObject(action, ["afterValue", "beforeValue", "eventName", "logIndex", "method", "nonce"]);
  const expectedNonce = request.args[0];
  if (String(action.nonce) !== String(expectedNonce) || action.method !== request.functionName || !Number.isSafeInteger(action.logIndex) || action.logIndex < 0) fail("RECEIPT_MISMATCH", "receipt event does not match request");
  positiveBigInt(action.beforeValue, true); positiveBigInt(action.afterValue, true);
  return Object.freeze({ source: "confirmed YNX Testnet EVM receipt", asOf: asOf.toISOString(), version: "ynx-vault-reconciliation-v1", coverage: "ActionExecuted identity, nonce, method, status, destination, and confirmations", confidence: "confirmed-on-chain", failure: null, transactionHash: receipt.transactionHash.toLowerCase(), blockNumber: receipt.blockNumber, confirmations, vault: request.to, nonceDomain: request.nonceDomain, actionNonce: String(action.nonce), method: action.method, beforeValue: String(action.beforeValue), afterValue: String(action.afterValue) });
}

export function parseIndexedVaultAction(value) {
  exactObject(value,["actionNonce","afterValue","asOf","beforeValue","blockHash","blockNumber","confidence","coverage","failure","logIndex","method","methodSelector","nonceDomain","source","transactionHash","vault","version"]);
  if (!ADDRESS.test(value.vault)||!/^0x[0-9a-fA-F]{64}$/.test(value.nonceDomain)||!/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash)||!/^0x[0-9a-fA-F]{64}$/.test(value.blockHash)||!/^0x[0-9a-fA-F]{8}$/.test(value.methodSelector)) fail("INVALID_INDEXED_ACTION","invalid indexed action identity");
  if (VAULT_SELECTORS[value.method]!==value.methodSelector.toLowerCase()||!Number.isSafeInteger(value.blockNumber)||value.blockNumber<1||!Number.isSafeInteger(value.logIndex)||value.logIndex<0) fail("INVALID_INDEXED_ACTION","invalid indexed action method or block");
  positiveBigInt(value.actionNonce,true);positiveBigInt(value.beforeValue,true);positiveBigInt(value.afterValue,true);
  const asOf=new Date(value.asOf);if(!Number.isFinite(asOf.valueOf())||value.source!=="confirmed YNX Testnet EVM logs"||value.version!=="ynx-vault-action-v1"||value.confidence!=="confirmed-on-chain"||!bounded(value.coverage,20,500)||value.failure!==null) fail("INVALID_INDEXED_ACTION","indexed action provenance is not authoritative");
  return Object.freeze({...value,vault:value.vault.toLowerCase(),nonceDomain:value.nonceDomain.toLowerCase(),transactionHash:value.transactionHash.toLowerCase(),blockHash:value.blockHash.toLowerCase(),methodSelector:value.methodSelector.toLowerCase(),actionNonce:String(value.actionNonce),beforeValue:String(value.beforeValue),afterValue:String(value.afterValue),asOf:asOf.toISOString()});
}

export function reconcileIndexedVaultAction({request,action}) {
  action=parseIndexedVaultAction(action);
  exactObject(request,["approvalRequired","args","authority","chainId","executor","functionName","nonceDomain","sourceStateAsOf","to","value"]);
  if(request.chainId!==6423||request.to!==action.vault||request.nonceDomain!==action.nonceDomain||request.functionName!==action.method||String(request.args[0])!==action.actionNonce) fail("RECEIPT_MISMATCH","indexed action does not match request");
  return Object.freeze({source:action.source,asOf:action.asOf,version:"ynx-vault-indexed-reconciliation-v1",coverage:action.coverage,confidence:action.confidence,failure:null,transactionHash:action.transactionHash,blockHash:action.blockHash,blockNumber:action.blockNumber,logIndex:action.logIndex,vault:action.vault,nonceDomain:action.nonceDomain,actionNonce:action.actionNonce,method:action.method,beforeValue:action.beforeValue,afterValue:action.afterValue});
}

export async function digestVaultRequest(request) {
  exactObject(request, ["approvalRequired", "args", "authority", "chainId", "executor", "functionName", "nonceDomain", "sourceStateAsOf", "to", "value"]);
  const payload = JSON.stringify([request.chainId,request.to,request.executor,request.functionName,request.args,request.value,request.authority,request.approvalRequired,request.nonceDomain,request.sourceStateAsOf]);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return `0x${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("")}`;
}

export async function submitApprovedVaultRequest({ request, approval, sendTransaction, now = new Date() }) {
  if (typeof sendTransaction !== "function") fail("INVALID_TRANSPORT", "an explicit engine transport is required");
  exactObject(approval,["actionNonce","approved","asOf","chainId","engine","expiresAt","failure","nonceDomain","productClientId","requestDigest","revoked","scopes","source","vault"]);
  if (approval.approved!==true||approval.revoked!==false||approval.failure!==null||approval.chainId!==6423||approval.productClientId!=="ynx-dex-web-v1"||approval.source!=="canonical YNX Wallet introspection") fail("INVALID_APPROVAL","canonical Wallet approval is not active");
  if (!ADDRESS.test(approval.vault)||!ADDRESS.test(approval.engine)||approval.vault.toLowerCase()!==request.to||approval.engine.toLowerCase()!==request.executor||approval.nonceDomain.toLowerCase()!==request.nonceDomain) fail("APPROVAL_MISMATCH","approval identity does not match request");
  if (!Array.isArray(approval.scopes)||approval.scopes.length!==1||approval.scopes[0]!=="dex:vault:execute") fail("APPROVAL_SCOPE","approval scope must be exact");
  if (!/^0x[0-9a-fA-F]{64}$/.test(approval.requestDigest)||approval.requestDigest.toLowerCase()!==await digestVaultRequest(request)) fail("APPROVAL_MISMATCH","approval digest does not match request");
  if (String(approval.actionNonce)!==String(request.args[0])) fail("APPROVAL_MISMATCH","approval nonce does not match request");
  const asOf=new Date(approval.asOf);const expiresAt=new Date(approval.expiresAt);
  if (!Number.isFinite(asOf.valueOf())||!Number.isFinite(expiresAt.valueOf())||asOf>now||expiresAt<=now) fail("APPROVAL_EXPIRED","approval timing is invalid");
  if (!VAULT_SELECTORS[request.functionName]||request.authority!=="limited-engine-session"||request.approvalRequired!==true) fail("INVALID_TRANSACTION","request is not an engine vault action");
  const result=await sendTransaction(request);
  exactObject(result,["provider","submittedAt","transactionHash"]);
  if (!bounded(result.provider,1,80)||!/^0x[0-9a-fA-F]{64}$/.test(result.transactionHash)||!Number.isFinite(new Date(result.submittedAt).valueOf())) fail("INVALID_SUBMISSION","transport returned invalid submission evidence");
  return Object.freeze({status:"submitted-unconfirmed",source:"caller-supplied YNX engine transport",asOf:new Date(result.submittedAt).toISOString(),version:"ynx-vault-submission-v1",failure:null,provider:result.provider,transactionHash:result.transactionHash.toLowerCase(),vault:request.to,nonceDomain:request.nonceDomain,actionNonce:String(request.args[0]),requestDigest:approval.requestDigest.toLowerCase()});
}

function quoteRouteExactInput(input, route, tokenIn, now) {
  let current = tokenIn.toLowerCase();
  let value = input;
  const path = [current];
  const steps = [];
  for (const pool of route) {
    const zeroForOne = pool.token0.address === current;
    const next = zeroForOne ? pool.token1.address : pool.token0.address;
    const reserveIn = zeroForOne ? pool.reserve0 : pool.reserve1;
    const reserveOut = zeroForOne ? pool.reserve1 : pool.reserve0;
    const output = amountOut(value, reserveIn, reserveOut, pool.feeBps);
    steps.push(Object.freeze({ pool: pool.address, tokenIn: current, tokenOut: next, amountIn: value, amountOut: output, reserveIn, reserveOut, feeBps: pool.feeBps }));
    value = output;
    current = next;
    path.push(next);
  }
  return { kind: "exact-input", amountIn: input, amountOut: value, path: Object.freeze(path), steps: Object.freeze(steps), quotedAt: now.toISOString() };
}

function quoteRouteExactOutput(output, route, tokenOut, now) {
  let current = tokenOut.toLowerCase();
  let value = output;
  const reversedPath = [current];
  const reversedSteps = [];
  for (let i = route.length - 1; i >= 0; i--) {
    const pool = route[i];
    const zeroForOne = pool.token1.address === current;
    const previous = zeroForOne ? pool.token0.address : pool.token1.address;
    const reserveIn = zeroForOne ? pool.reserve0 : pool.reserve1;
    const reserveOut = zeroForOne ? pool.reserve1 : pool.reserve0;
    const input = amountIn(value, reserveIn, reserveOut, pool.feeBps);
    reversedSteps.push(Object.freeze({ pool: pool.address, tokenIn: previous, tokenOut: current, amountIn: input, amountOut: value, reserveIn, reserveOut, feeBps: pool.feeBps }));
    value = input;
    current = previous;
    reversedPath.push(previous);
  }
  return { kind: "exact-output", amountIn: value, amountOut: output, path: Object.freeze(reversedPath.reverse()), steps: Object.freeze(reversedSteps.reverse()), quotedAt: now.toISOString() };
}

function enumerateRoutes(tokenIn, tokenOut, rawPools, maxHops) {
  if (!ADDRESS.test(tokenIn) || !ADDRESS.test(tokenOut) || tokenIn.toLowerCase() === tokenOut.toLowerCase()) fail("INVALID_ROUTE", "invalid route endpoints");
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > MAX_HOPS) fail("INVALID_ROUTE", "max hops must be 1..4");
  const pools = rawPools.map(parsePool).filter((pool) => pool.reserve0 > 0n && pool.reserve1 > 0n);
  const target = tokenOut.toLowerCase();
  const routes = [];
  const walk = (current, route, seenTokens) => {
    if (route.length >= maxHops) return;
    for (const pool of pools) {
      if (route.some((item) => item.address === pool.address)) continue;
      let next;
      if (pool.token0.address === current) next = pool.token1.address;
      else if (pool.token1.address === current) next = pool.token0.address;
      else continue;
      if (seenTokens.has(next)) continue;
      const candidate = [...route, pool];
      if (next === target) routes.push(candidate);
      else walk(next, candidate, new Set([...seenTokens, next]));
    }
  };
  walk(tokenIn.toLowerCase(), [], new Set([tokenIn.toLowerCase()]));
  return routes;
}

function routeKey(quote) { return quote.steps.map((step) => step.pool).join(":"); }
function parseVaultMandate(value) {
  exactObject(value, ["depegToleranceBps", "expiresAt", "feeAsset", "feeRecipient", "maxDailyLossBps", "maxDrawdownBps", "maxGasPrice", "maxImpactBps", "maxSlippageBps", "maxTradeValue", "maxVaultValue", "minActionInterval", "oracleMaxAge", "performanceFeeBps"]);
  const result = { ...value };
  for (const field of ["maxVaultValue", "maxTradeValue", "maxGasPrice", "expiresAt", "minActionInterval", "oracleMaxAge", "maxSlippageBps", "maxImpactBps", "maxDailyLossBps", "maxDrawdownBps", "depegToleranceBps", "performanceFeeBps"]) result[field] = positiveBigInt(value[field], field === "maxGasPrice" || field === "minActionInterval" || field === "performanceFeeBps");
  if (!ADDRESS.test(value.feeAsset) || !ADDRESS.test(value.feeRecipient) || result.performanceFeeBps !== 0n || value.feeAsset.toLowerCase() !== "0x0000000000000000000000000000000000000000" || value.feeRecipient.toLowerCase() !== "0x0000000000000000000000000000000000000000") fail("INVALID_VAULT_MANDATE", "v1 fee fields must remain zero");
  return Object.freeze({ ...result, feeAsset: value.feeAsset.toLowerCase(), feeRecipient: value.feeRecipient.toLowerCase() });
}
function validateVaultDeadline(deadline, state, now) {
  const nowSeconds = Math.floor(now.valueOf() / 1000);
  if (!Number.isInteger(deadline) || deadline <= nowSeconds || BigInt(deadline) > state.mandate.expiresAt || deadline > nowSeconds + 3600) fail("INVALID_DEADLINE", "deadline must be within one hour and mandate expiry");
}
function validateVaultTokens(tokenA, tokenB) { if (!ADDRESS.test(tokenA) || !ADDRESS.test(tokenB) || tokenA.toLowerCase() === tokenB.toLowerCase()) fail("INVALID_TOKEN", "invalid vault token pair"); }
function vaultRequest(state, functionName, args, authority) { return Object.freeze({ chainId: 6423, to: state.vault, executor:authority==="owner"?state.owner:state.engine, functionName, args: Object.freeze(args), value: "0", authority, approvalRequired: true, nonceDomain: state.nonceDomain, sourceStateAsOf: state.asOf }); }
function assertFreshFairFlowState(state,now,maxAgeMs=15_000){state=parseFairFlowState(state);const age=now.valueOf()-new Date(state.asOf).valueOf();if(!Number.isInteger(maxAgeMs)||maxAgeMs<1||age<0||age>maxAgeMs)fail("STALE_FAIRFLOW_STATE","FairFlow state is stale or from the future");return state;}
function fairFlowRequest(state,functionName,args){return Object.freeze({chainId:6423,to:state.fairFlow,executor:state.user,functionName,args:Object.freeze(args),value:"0",authority:"user-wallet",approvalRequired:true,intentDomain:state.intentDomain,userNonce:state.userNonce.toString(),batchToken0:state.token0,batchToken1:state.token1,sourceStateAsOf:state.asOf});}
function validateFairFlowRequest(request){exactObject(request,["approvalRequired","args","authority","batchToken0","batchToken1","chainId","executor","functionName","intentDomain","sourceStateAsOf","to","userNonce","value"]);if(request.chainId!==6423||!ADDRESS.test(request.to)||!ADDRESS.test(request.executor)||!ADDRESS.test(request.batchToken0)||!ADDRESS.test(request.batchToken1)||request.batchToken0>=request.batchToken1||!/^0x[0-9a-fA-F]{64}$/.test(request.intentDomain)||request.authority!=="user-wallet"||request.approvalRequired!==true||request.value!=="0"||!Number.isFinite(new Date(request.sourceStateAsOf).valueOf())||!Array.isArray(request.args))fail("INVALID_FAIRFLOW_REQUEST","invalid FairFlow request identity");positiveBigInt(request.userNonce,true);if(request.functionName==="submitIntent"){if(request.args.length!==5||!ADDRESS.test(request.args[1])||![request.batchToken0,request.batchToken1].includes(request.args[1]))fail("INVALID_FAIRFLOW_REQUEST","invalid submitIntent request");for(const index of [0,2,3,4])positiveBigInt(request.args[index]);}else if(request.functionName==="cancelIntent"){if(request.args.length!==1||!/^0x[0-9a-fA-F]{64}$/.test(request.args[0]))fail("INVALID_FAIRFLOW_REQUEST","invalid cancelIntent request");}else fail("INVALID_FAIRFLOW_REQUEST","unsupported FairFlow method");return request;}
function validateFee(value) { if (!Number.isInteger(value) || value < 0 || value > 100) fail("INVALID_FEE", "fee must be 0..100 bps"); }
function validateSlippage(value) { if (!Number.isInteger(value) || value < 1 || value > 5_000) fail("INVALID_SLIPPAGE", "slippage must be 1..5000 bps"); }
function validateTxCommon(router, recipient, deadline, chainId) {
  if (!ADDRESS.test(router) || !ADDRESS.test(recipient) || chainId !== 6423) fail("INVALID_TRANSACTION", "invalid router, recipient, or chain");
  if (!Number.isInteger(deadline) || deadline <= Math.floor(Date.now() / 1000) || deadline > Math.floor(Date.now() / 1000) + 3600) fail("INVALID_DEADLINE", "deadline must be within one hour");
}
function positiveBigInt(value, allowZero = false) {
  let result;
  try { result = typeof value === "bigint" ? value : BigInt(value); } catch { fail("INVALID_AMOUNT", "amount is not an integer"); }
  if (result < 0n || (!allowZero && result === 0n)) fail("INVALID_AMOUNT", "amount must be positive");
  return result;
}
function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail("INVALID_SCHEMA", "unknown or missing fields");
}
function bounded(value, min, max) { return typeof value === "string" && value.length >= min && value.length <= max; }
function fail(code, message) { throw new DexSdkError(code, message); }

export { MAX_HOPS };

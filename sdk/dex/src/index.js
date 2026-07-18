const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_ACCOUNT = /^ynx1[0-9a-z]{20,80}$/;
const INTEGER = /^-?[0-9]{1,78}$/;
const MAX_HOPS = 4;
const BPS = 10_000n;

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

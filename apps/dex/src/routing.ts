import type { Pool } from "./types";

export type RouteHop = {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  feeBps: number;
  amountIn: bigint;
  amountOut: bigint;
};

export type NativeQuote = {
  amountIn: bigint;
  amountOut: bigint;
  route: RouteHop[];
  feeBps: number;
  quotedAt: string;
  priceImpactBps: number;
  execution: "direct" | "multi_hop_quote_only";
};

const assetKey = (asset: string) => asset.toLowerCase();

const nextAsset = (pool: Pool, tokenIn: string) => {
  const input = assetKey(tokenIn);
  if (assetKey(pool.token0) === input) return pool.token1;
  if (assetKey(pool.token1) === input) return pool.token0;
  return null;
};

const reservesFor = (pool: Pool, tokenIn: string) => {
  const output = nextAsset(pool, tokenIn);
  if (!output) return null;
  const forwards = assetKey(pool.token0) === assetKey(tokenIn);
  const reserveIn = BigInt(forwards ? pool.reserve0 : pool.reserve1);
  const reserveOut = BigInt(forwards ? pool.reserve1 : pool.reserve0);
  if (reserveIn <= 0n || reserveOut <= 0n) return null;
  return { reserveIn, reserveOut, tokenOut: output };
};

const usablePools = (pools: Pool[], tokenIn: string) =>
  pools.filter((pool) => reservesFor(pool, tokenIn) !== null);

// A route may use at most three committed pools. Repeating a pool or an asset
// is rejected, so a quote cannot manufacture liquidity through a cycle.
const routes = (pools: Pool[], tokenIn: string, tokenOut: string, maxHops = 3) => {
  const output = assetKey(tokenOut);
  const discovered: Array<Array<{ pool: Pool; tokenIn: string; tokenOut: string }>> = [];
  const visit = (
    current: string,
    path: Array<{ pool: Pool; tokenIn: string; tokenOut: string }>,
    usedPools: Set<string>,
    usedAssets: Set<string>,
  ) => {
    if (path.length >= maxHops) return;
    for (const pool of usablePools(pools, current)) {
      if (usedPools.has(pool.address)) continue;
      const next = nextAsset(pool, current);
      if (!next) continue;
      const nextKey = assetKey(next);
      const hop = { pool, tokenIn: current, tokenOut: next };
      if (nextKey === output) {
        discovered.push([...path, hop]);
        continue;
      }
      if (usedAssets.has(nextKey)) continue;
      const nextPools = new Set(usedPools);
      nextPools.add(pool.address);
      const nextAssets = new Set(usedAssets);
      nextAssets.add(nextKey);
      visit(next, [...path, hop], nextPools, nextAssets);
    }
  };
  visit(tokenIn, [], new Set(), new Set([assetKey(tokenIn)]));
  return discovered;
};

const effectiveFeeBps = (hops: RouteHop[]) => {
  let retained = 10_000n;
  for (const hop of hops)
    retained = (retained * BigInt(10_000 - hop.feeBps)) / 10_000n;
  return Number(10_000n - retained);
};

const exactInput = (
  amountIn: bigint,
  route: Array<{ pool: Pool; tokenIn: string; tokenOut: string }>,
): { hops: RouteHop[]; amountOut: bigint; idealOut: bigint } | null => {
  let actual = amountIn;
  let ideal = amountIn;
  const hops: RouteHop[] = [];
  for (const item of route) {
    const reserves = reservesFor(item.pool, item.tokenIn);
    if (!reserves || reserves.tokenOut !== item.tokenOut) return null;
    const afterFee = (actual * BigInt(10_000 - item.pool.feeBps)) / 10_000n;
    const next = (reserves.reserveOut * afterFee) / (reserves.reserveIn + afterFee);
    ideal = (ideal * reserves.reserveOut) / reserves.reserveIn;
    if (next <= 0n) return null;
    hops.push({
      pool: item.pool.address,
      tokenIn: item.tokenIn,
      tokenOut: item.tokenOut,
      feeBps: item.pool.feeBps,
      amountIn: actual,
      amountOut: next,
    });
    actual = next;
  }
  return { hops, amountOut: actual, idealOut: ideal };
};

const exactOutput = (
  amountOut: bigint,
  route: Array<{ pool: Pool; tokenIn: string; tokenOut: string }>,
): { hops: RouteHop[]; amountIn: bigint; idealIn: bigint } | null => {
  let required = amountOut;
  let ideal = amountOut;
  const reverse: RouteHop[] = [];
  for (const item of [...route].reverse()) {
    const reserves = reservesFor(item.pool, item.tokenIn);
    if (!reserves || reserves.tokenOut !== item.tokenOut || required >= reserves.reserveOut)
      return null;
    const denominator = (reserves.reserveOut - required) * BigInt(10_000 - item.pool.feeBps);
    if (denominator <= 0n) return null;
    const input = (reserves.reserveIn * required * 10_000n + denominator - 1n) / denominator;
    ideal = (ideal * reserves.reserveIn + reserves.reserveOut - 1n) / reserves.reserveOut;
    if (input <= 0n) return null;
    reverse.push({
      pool: item.pool.address,
      tokenIn: item.tokenIn,
      tokenOut: item.tokenOut,
      feeBps: item.pool.feeBps,
      amountIn: input,
      amountOut: required,
    });
    required = input;
  }
  return { hops: reverse.reverse(), amountIn: required, idealIn: ideal };
};

const quote = (
  amountIn: bigint,
  amountOut: bigint,
  hops: RouteHop[],
  priceImpactBps: number,
): NativeQuote => ({
  amountIn,
  amountOut,
  route: hops,
  feeBps: effectiveFeeBps(hops),
  quotedAt: new Date().toISOString(),
  priceImpactBps,
  execution: hops.length === 1 ? "direct" : "multi_hop_quote_only",
});

export const quoteNativeExactInput = (
  amountIn: bigint,
  tokenIn: string,
  tokenOut: string,
  pools: Pool[],
): NativeQuote => {
  let best: NativeQuote | null = null;
  for (const routeCandidate of routes(pools, tokenIn, tokenOut)) {
    const result = exactInput(amountIn, routeCandidate);
    if (!result) continue;
    const impact =
      result.idealOut > 0n
        ? Math.max(0, Number(((result.idealOut - result.amountOut) * 10_000n) / result.idealOut))
        : 0;
    const candidate = quote(amountIn, result.amountOut, result.hops, impact);
    if (!best || candidate.amountOut > best.amountOut) best = candidate;
  }
  if (!best) throw new Error("No committed chain-native pool route can quote this input.");
  return best;
};

export const quoteNativeExactOutput = (
  amountOut: bigint,
  tokenIn: string,
  tokenOut: string,
  pools: Pool[],
): NativeQuote => {
  let best: NativeQuote | null = null;
  for (const routeCandidate of routes(pools, tokenIn, tokenOut)) {
    const result = exactOutput(amountOut, routeCandidate);
    if (!result) continue;
    const impact =
      result.idealIn > 0n
        ? Math.max(0, Number(((result.amountIn - result.idealIn) * 10_000n) / result.idealIn))
        : 0;
    const candidate = quote(result.amountIn, amountOut, result.hops, impact);
    if (!best || candidate.amountIn < best.amountIn) best = candidate;
  }
  if (!best) throw new Error("Requested output exceeds committed pool liquidity.");
  return best;
};

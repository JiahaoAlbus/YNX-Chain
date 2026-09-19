import type { ChainEvent, Pool } from "./types";

export type PoolActivityMetrics = Readonly<{
  swaps: number;
  volume0: bigint;
  volume1: bigint;
  fee0: bigint;
  fee1: bigint;
  feeCoverage: "complete" | "partial" | "unavailable";
}>;

export type LiquidityDepthPoint = Readonly<{
  reserveShareBps: number;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  priceImpactBps: number;
}>;

const integer = (value: string, label: string) => {
  if (!/^-?[0-9]+$/.test(value))
    throw new Error(`${label} is not a canonical integer.`);
  return BigInt(value);
};

const absolute = (value: bigint) => (value < 0n ? -value : value);

export function aggregatePoolActivity(
  events: readonly ChainEvent[],
  pool: Pool,
): PoolActivityMetrics {
  let swaps = 0;
  let volume0 = 0n;
  let volume1 = 0n;
  let fee0 = 0n;
  let fee1 = 0n;
  let feeCovered = 0;
  const token0 = pool.token0.toLowerCase();
  const token1 = pool.token1.toLowerCase();

  for (const event of events) {
    if (!event.type.startsWith("dex_swap_") || event.pool !== pool.address)
      continue;
    const asset0 = event.asset0?.toLowerCase();
    const asset1 = event.asset1?.toLowerCase();
    const forward = asset0 === token0 && asset1 === token1;
    const reverse = asset0 === token1 && asset1 === token0;
    if (!forward && !reverse) continue;
    const amount0 = absolute(integer(event.amount0, "Swap amount 0"));
    const amount1 = absolute(integer(event.amount1, "Swap amount 1"));
    swaps += 1;
    volume0 += forward ? amount0 : amount1;
    volume1 += forward ? amount1 : amount0;
    if (event.fee0 !== "" && event.fee1 !== "") {
      const eventFee0 = absolute(integer(event.fee0, "Swap fee 0"));
      const eventFee1 = absolute(integer(event.fee1, "Swap fee 1"));
      fee0 += forward ? eventFee0 : eventFee1;
      fee1 += forward ? eventFee1 : eventFee0;
      feeCovered += 1;
    }
  }

  return Object.freeze({
    swaps,
    volume0,
    volume1,
    fee0,
    fee1,
    feeCoverage:
      feeCovered === 0
        ? "unavailable"
        : feeCovered === swaps
          ? "complete"
          : "partial",
  });
}

export function constantProductDepth(
  pool: Pool,
  tokenIn: string,
  reserveSharesBps: readonly number[] = [10, 50, 100, 200, 500],
): readonly LiquidityDepthPoint[] {
  const normalized = tokenIn.toLowerCase();
  const forwards = pool.token0.toLowerCase() === normalized;
  if (!forwards && pool.token1.toLowerCase() !== normalized)
    throw new Error("Depth token is outside the selected pool.");
  const reserveIn = BigInt(forwards ? pool.reserve0 : pool.reserve1);
  const reserveOut = BigInt(forwards ? pool.reserve1 : pool.reserve0);
  if (reserveIn <= 0n || reserveOut <= 0n)
    throw new Error("Depth requires positive committed reserves.");
  const points: LiquidityDepthPoint[] = [];
  for (const reserveShareBps of reserveSharesBps) {
      if (
        !Number.isInteger(reserveShareBps) ||
        reserveShareBps < 1 ||
        reserveShareBps > 5_000
      )
        throw new Error("Depth reserve share is outside the bounded range.");
      const amountIn = (reserveIn * BigInt(reserveShareBps)) / 10_000n;
      if (amountIn <= 0n) continue;
      const feeAmount = (amountIn * BigInt(pool.feeBps)) / 10_000n;
      const effective = amountIn - feeAmount;
      const amountOut = (reserveOut * effective) / (reserveIn + effective);
      if (effective <= 0n || amountOut <= 0n) continue;
      const spotOut = (amountIn * reserveOut) / reserveIn;
      const priceImpactBps =
        spotOut > 0n
          ? Number(((spotOut - amountOut) * 10_000n) / spotOut)
          : 0;
      points.push(Object.freeze({
        reserveShareBps,
        amountIn,
        amountOut,
        feeAmount,
        priceImpactBps: Math.max(0, priceImpactBps),
      }));
  }
  return Object.freeze(points);
}

import { describe, expect, it } from "vitest";
import { aggregatePoolActivity, constantProductDepth } from "./poolAnalytics";
import type { ChainEvent, Pool } from "./types";

const pool = {
  address: "dex_ynxt_yusd",
  token0: "YNXT",
  token1: "yusd-test",
  reserve0: "100000",
  reserve1: "200000",
  feeBps: 30,
} as Pool;

const swap = (input: Partial<ChainEvent> = {}) =>
  ({
    id: "swap-1",
    type: "dex_swap_exact_input",
    pool: pool.address,
    account: "ynx1account",
    asset0: "YNXT",
    asset1: "yusd-test",
    amount0: "100",
    amount1: "198",
    fee0: "1",
    fee1: "0",
    blockNumber: 10,
    txHash: "a".repeat(64),
    timestamp: "2026-09-19T00:00:00Z",
    auditHash: "b".repeat(64),
    ...input,
  }) as ChainEvent;

describe("DEX source-backed pool analytics", () => {
  it("normalizes direction while preserving only observed fees", () => {
    expect(
      aggregatePoolActivity(
        [
          swap(),
          swap({
            id: "reverse",
            asset0: "yusd-test",
            asset1: "YNXT",
            amount0: "400",
            amount1: "200",
            fee0: "2",
            fee1: "0",
          }),
        ],
        pool,
      ),
    ).toEqual({
      swaps: 2,
      volume0: 300n,
      volume1: 598n,
      fee0: 1n,
      fee1: 2n,
      feeCoverage: "complete",
    });
  });

  it("reports missing fee evidence as unavailable rather than zero", () => {
    const metrics = aggregatePoolActivity(
      [swap({ fee0: "", fee1: "" })],
      pool,
    );
    expect(metrics.feeCoverage).toBe("unavailable");
    expect(metrics.fee0).toBe(0n);
    expect(metrics.fee1).toBe(0n);
  });

  it("derives bounded depth points only from committed reserves", () => {
    const depth = constantProductDepth(pool, "YNXT", [100, 500]);
    expect(depth).toHaveLength(2);
    expect(depth[0]).toMatchObject({
      reserveShareBps: 100,
      amountIn: 1000n,
      feeAmount: 3n,
    });
    expect(depth[0].amountOut).toBeGreaterThan(0n);
    expect(depth[1].priceImpactBps).toBeGreaterThan(depth[0].priceImpactBps);
  });
});

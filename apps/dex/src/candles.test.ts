import { describe, expect, it } from "vitest";
import { aggregateCandles } from "./candles";
import type { ChainEvent, Pool, Token } from "./types";

const pool = {
  address: "dex_ynxt_yusdt",
  token0: "YNXT",
  token1: "ynx-usd-test",
} as Pool;
const tokens = [
  { address: "YNXT", decimals: 0 },
  { address: "ynx-usd-test", decimals: 0 },
] as Token[];
const event = (input: Partial<ChainEvent>): ChainEvent =>
  ({
    id: "id",
    type: "dex_swap_exact_input",
    pool: pool.address,
    account: "ynx1account",
    asset0: "YNXT",
    asset1: "ynx-usd-test",
    amount0: "2",
    amount1: "2000",
    fee0: "0",
    fee1: "0",
    blockNumber: 1,
    txHash: "a".repeat(64),
    timestamp: "2026-08-11T12:00:10Z",
    auditHash: "b".repeat(64),
    ...input,
  }) as ChainEvent;

describe("confirmed native swap candles", () => {
  it("normalizes both swap directions into token1-per-token0 OHLC", () => {
    const candles = aggregateCandles(
      [
        event({}),
        event({
          id: "reverse",
          asset0: "ynx-usd-test",
          asset1: "YNXT",
          amount0: "2500",
          amount1: "1",
          timestamp: "2026-08-11T12:00:40Z",
        }),
      ],
      pool,
      tokens,
      60,
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      open: 1000,
      high: 2500,
      low: 1000,
      close: 2500,
      trades: 2,
      volume0: 3n,
      volume1: 4500n,
    });
  });
  it("excludes non-swap and cross-pool events", () => {
    expect(
      aggregateCandles(
        [
          event({ type: "dex_liquidity_add" }),
          event({ pool: "dex_other_pool" }),
        ],
        pool,
        tokens,
        60,
      ),
    ).toEqual([]);
  });
});

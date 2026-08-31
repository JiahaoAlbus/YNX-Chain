import { describe, expect, it } from "vitest";
import { quoteNativeExactInput, quoteNativeExactOutput } from "./routing";
import type { Pool } from "./types";

const pool = (
  address: string,
  token0: string,
  token1: string,
  reserve0 = "1000",
  reserve1 = "1000",
): Pool => ({
  address,
  token0,
  token1,
  reserve0,
  reserve1,
  contractVersion: "ynx-native-dex-cpmm-v1",
  feeBps: 30,
  totalShares: "1000",
  updatedBlock: 1,
  updatedAt: "2026-08-31T00:00:00.000Z",
  txHash: "a".repeat(64),
  auditHash: "b".repeat(64),
});

describe("committed DEX routing", () => {
  it("quotes the best two-hop route only from committed pool reserves", () => {
    const quote = quoteNativeExactInput(
      100n,
      "asset-a",
      "asset-c",
      [pool("dex_ab", "asset-a", "asset-b"), pool("dex_bc", "asset-b", "asset-c")],
    );
    expect(quote.route.map((hop) => hop.pool)).toEqual(["dex_ab", "dex_bc"]);
    expect(quote.amountOut).toBe(81n);
    expect(quote.execution).toBe("multi_hop_quote_only");
    expect(quote.route[0]).toMatchObject({ tokenIn: "asset-a", tokenOut: "asset-b" });
    expect(quote.route[1]).toMatchObject({ tokenIn: "asset-b", tokenOut: "asset-c" });
  });

  it("calculates exact-output input bounds across the same committed path", () => {
    const quote = quoteNativeExactOutput(
      50n,
      "asset-a",
      "asset-c",
      [pool("dex_ab", "asset-a", "asset-b"), pool("dex_bc", "asset-b", "asset-c")],
    );
    expect(quote.route.map((hop) => hop.pool)).toEqual(["dex_ab", "dex_bc"]);
    expect(quote.amountOut).toBe(50n);
    expect(quote.amountIn).toBeGreaterThan(50n);
    expect(quote.execution).toBe("multi_hop_quote_only");
  });

  it("marks a single committed pool as executable while preserving the route", () => {
    const quote = quoteNativeExactInput(100n, "asset-a", "asset-b", [
      pool("dex_ab", "asset-a", "asset-b"),
    ]);
    expect(quote.execution).toBe("direct");
    expect(quote.route).toHaveLength(1);
    expect(quote.route[0].pool).toBe("dex_ab");
  });

  it("never manufactures a cycle by revisiting a committed pool or asset", () => {
    const quote = quoteNativeExactInput(
      100n,
      "asset-a",
      "asset-c",
      [
        pool("dex_ab", "asset-a", "asset-b"),
        pool("dex_ba", "asset-b", "asset-a"),
        pool("dex_bc", "asset-b", "asset-c"),
      ],
    );
    expect(quote.route.map((hop) => hop.pool)).toEqual(["dex_ab", "dex_bc"]);
    expect(new Set(quote.route.map((hop) => hop.pool)).size).toBe(quote.route.length);
  });
});

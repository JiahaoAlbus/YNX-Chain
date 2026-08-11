import type { ChainEvent, Pool, Token } from "./types";

export type Candle = Readonly<{
  openedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume0: bigint;
  volume1: bigint;
  trades: number;
}>;

const finitePrice = (
  numerator: bigint,
  denominator: bigint,
  numeratorDecimals: number,
  denominatorDecimals: number,
) => {
  if (numerator <= 0n || denominator <= 0n) return null;
  const scale = 1_000_000_000n;
  const adjustedNumerator = numerator * 10n ** BigInt(denominatorDecimals);
  const adjustedDenominator = denominator * 10n ** BigInt(numeratorDecimals);
  const value = Number((adjustedNumerator * scale) / adjustedDenominator) / 1e9;
  return Number.isFinite(value) && value > 0 ? value : null;
};

export function aggregateCandles(
  events: ChainEvent[],
  pool: Pool,
  tokens: Token[],
  intervalSeconds: number,
): Candle[] {
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) return [];
  const decimals = new Map(
    tokens.map((token) => [token.address.toLowerCase(), token.decimals]),
  );
  const token0 = pool.token0.toLowerCase();
  const token1 = pool.token1.toLowerCase();
  const buckets = new Map<number, Candle>();
  for (const item of [...events].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  )) {
    if (!item.type.startsWith("dex_swap_") || item.pool !== pool.address)
      continue;
    const asset0 = item.asset0?.toLowerCase();
    const asset1 = item.asset1?.toLowerCase();
    const amount0 = BigInt(item.amount0);
    const amount1 = BigInt(item.amount1);
    let price: number | null = null;
    let volume0 = 0n;
    let volume1 = 0n;
    if (asset0 === token0 && asset1 === token1) {
      price = finitePrice(
        amount1,
        amount0,
        decimals.get(token1) ?? 0,
        decimals.get(token0) ?? 0,
      );
      volume0 = amount0;
      volume1 = amount1;
    } else if (asset0 === token1 && asset1 === token0) {
      price = finitePrice(
        amount0,
        amount1,
        decimals.get(token1) ?? 0,
        decimals.get(token0) ?? 0,
      );
      volume0 = amount1;
      volume1 = amount0;
    }
    const timestamp = Date.parse(item.timestamp);
    if (price === null || !Number.isFinite(timestamp)) continue;
    const bucket =
      Math.floor(timestamp / (intervalSeconds * 1000)) * intervalSeconds * 1000;
    const current = buckets.get(bucket);
    buckets.set(
      bucket,
      current
        ? {
            ...current,
            high: Math.max(current.high, price),
            low: Math.min(current.low, price),
            close: price,
            volume0: current.volume0 + volume0,
            volume1: current.volume1 + volume1,
            trades: current.trades + 1,
          }
        : {
            openedAt: new Date(bucket).toISOString(),
            open: price,
            high: price,
            low: price,
            close: price,
            volume0,
            volume1,
            trades: 1,
          },
    );
  }
  return [...buckets.values()].slice(-120);
}

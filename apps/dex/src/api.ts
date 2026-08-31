import type {
  Analytics,
  ChainEvent,
  FeeSummary,
  Pool,
  Position,
  SpotPrice,
  SnapshotProvenance,
  Token,
  TWAP,
} from "./types";
import {
  evmAddressFromYNX,
} from "@ynx-chain/wallet-auth/src/crypto.js";
import type { DexActionResponse } from "@ynx-chain/wallet-auth";

const BASE = (
  import.meta.env.VITE_DEX_GATEWAY_URL ||
  import.meta.env.VITE_DEX_API_URL ||
  ""
).replace(/\/$/, "");
const EXPECTED_VERSION = "abci-state-v13";
const AUTHORITATIVE_SOURCE = "authoritative chain-native YNX Testnet state";
const AUTHORITATIVE_VERSION = "native-dex-schema-v1";

type NativeAsset = {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  issuer?: string;
  maxSupply?: number;
  totalSupply?: number;
  blockHeight?: number;
  txHash?: string;
  transactionHash?: string;
  auditHash?: string;
};
type NativePool = {
  id: string;
  kind: string;
  asset0: string;
  asset1: string;
  reserve0: number;
  reserve1: number;
  feeBps: number;
  totalShares: number;
  blockHeight: number;
  updatedAt: string;
  txHash?: string;
  transactionHash?: string;
  auditHash: string;
};
type NativeEvent = {
  id: string;
  type: string;
  poolId?: string;
  signer: string;
  asset0?: string;
  asset1?: string;
  amount0?: number;
  amount1?: number;
  blockHeight: number;
  occurredAt: string;
  txHash?: string;
  transactionHash?: string;
  auditHash: string;
};

type Collection<T> = { source: string; version: string; items: T[] };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

async function requestCollection<T>(
  path: string,
  field: "assets" | "pools" | "events",
  signal?: AbortSignal,
): Promise<Collection<T>> {
  const response = await fetch(`${BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
    credentials: "omit",
  });
  const body = record(await response.json().catch(() => null));
  if (!response.ok || !body || body.failure === true)
    throw new Error(
      (typeof body?.error === "string" && body.error) ||
        `DEX state gateway returned ${response.status}.`,
    );
  if (
    body.source === "ynx-consensus-abci" &&
    body.version === EXPECTED_VERSION &&
    body.failure === false &&
    Array.isArray(body[field])
  )
    return { source: body.source, version: body.version, items: body[field] as T[] };
  if (body.source === AUTHORITATIVE_SOURCE && Array.isArray(body.items))
    return {
      source: body.source,
      version: AUTHORITATIVE_VERSION,
      items: body.items as T[],
    };
  throw new Error("DEX gateway returned an unsupported or non-authoritative state envelope.");
}

const ynxt: Token = {
  chainId: 6423,
  address: "YNXT",
  symbol: "YNXT",
  name: "YNX Testnet",
  decimals: 0,
  standard: "YNX-consensus-asset",
  reviewStatus: "consensus-committed-testnet",
  issuer: "protocol",
  totalSupply: "",
  maxSupply: "",
  updatedBlock: 0,
  txHash: "",
  auditHash: "",
};
function safeInteger(
  value: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new Error(`${label} is outside the JavaScript safe-integer range.`);
  return Number(value);
}

const token = (asset: NativeAsset): Token => ({
  chainId: 6423,
  address: asset.id,
  symbol: asset.symbol,
  name: asset.name,
  decimals: safeInteger(asset.decimals, "Asset decimals", 0, 18),
  standard: "YNX-consensus-asset",
  reviewStatus: "consensus-committed-testnet",
  issuer: asset.issuer || "protocol",
  totalSupply:
    asset.totalSupply === undefined
      ? ""
      : String(safeInteger(asset.totalSupply, "Asset total supply")),
  maxSupply:
    asset.maxSupply === undefined
      ? ""
      : String(safeInteger(asset.maxSupply, "Asset maximum supply")),
  updatedBlock:
    asset.blockHeight === undefined
      ? 0
      : safeInteger(asset.blockHeight, "Asset block height"),
  txHash: asset.txHash || asset.transactionHash || "",
  auditHash: asset.auditHash || "",
});
const pool = (value: NativePool): Pool => ({
  address: value.id,
  token0: value.asset0,
  token1: value.asset1,
  reserve0: String(safeInteger(value.reserve0, "Pool reserve 0")),
  reserve1: String(safeInteger(value.reserve1, "Pool reserve 1")),
  contractVersion:
    value.kind === "ynx-cpmm-v1"
      ? "ynx-cpmm-v1"
      : "ynx-consensus-cpmm-v13",
  feeBps: safeInteger(value.feeBps, "Pool fee", 1, 1000),
  totalShares: String(safeInteger(value.totalShares, "Pool total shares")),
  updatedBlock: safeInteger(value.blockHeight, "Pool block height", 1),
  updatedAt: value.updatedAt,
  txHash: value.txHash || value.transactionHash || "",
  auditHash: value.auditHash,
});
const event = (value: NativeEvent): ChainEvent => ({
  id: value.id,
  type: value.type,
  pool: value.poolId || "",
  account: value.signer,
  asset0: value.asset0,
  asset1: value.asset1,
  amount0: String(
    value.amount0 === undefined
      ? 0
      : safeInteger(value.amount0, "DEX event amount 0"),
  ),
  amount1: String(
    value.amount1 === undefined
      ? 0
      : safeInteger(value.amount1, "DEX event amount 1"),
  ),
  fee0: "0",
  fee1: "0",
  blockNumber: safeInteger(value.blockHeight, "DEX event block height", 1),
  txHash: value.txHash || value.transactionHash || "",
  timestamp: value.occurredAt,
  auditHash: value.auditHash,
});

export async function loadDexSnapshot(signal?: AbortSignal) {
  const response = await fetch(`${BASE}/v1/native-snapshot`, {
      signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
    }),
    body = record(await response.json().catch(() => null));
  if (
    !response.ok ||
    !body ||
    body.source !== AUTHORITATIVE_SOURCE ||
    typeof body.updatedAt !== "string" ||
    !Array.isArray(body.assets) ||
    !Array.isArray(body.pools) ||
    !Array.isArray(body.events)
  )
    throw new Error(
      (typeof body?.error === "string" && body.error) ||
        `Authoritative DEX snapshot is unavailable (${response.status}).`,
    );
  const updatedAt = Date.parse(body.updatedAt);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 15 * 60_000)
    throw new Error("Authoritative DEX snapshot is stale.");
  const tokens = [ynxt, ...(body.assets as NativeAsset[]).map(token)];
  const pools = (body.pools as NativePool[]).map((value) => ({
    ...pool(value),
    contractVersion: "ynx-native-dex-cpmm-v1" as const,
  }));
  const events = (body.events as NativeEvent[])
    .map(event)
    .sort((a, b) => b.blockNumber - a.blockNumber);
  const latestBlock = Math.max(
    0,
    ...pools.map((item) => item.updatedBlock),
    ...events.map((item) => item.blockNumber),
    ...tokens.map((item) => item.updatedBlock),
  );
  const analytics: Analytics = {
    source: AUTHORITATIVE_SOURCE,
    version: AUTHORITATIVE_VERSION,
    indexedEvents: events.length,
    pools: pools.length,
    swaps: events.filter((item) => item.type.startsWith("dex_swap_")).length,
    liquidityEvents: events.filter((item) =>
      item.type.startsWith("dex_liquidity_"),
    ).length,
    latestBlock,
  };
  const provenance: SnapshotProvenance = Object.freeze({
    source: AUTHORITATIVE_SOURCE,
    asOf: new Date(updatedAt).toISOString(),
    version: AUTHORITATIVE_VERSION,
    classification: "testnet",
    status: "live",
    coverage: "native-snapshot-assets-pools-events",
    latestBlock,
  });
  const prices: SpotPrice[] = pools
    .filter((item) => BigInt(item.reserve0) > 0n && BigInt(item.reserve1) > 0n)
    .map((item) => ({
      pool: item.address,
      token0: item.token0,
      token1: item.token1,
      price0Numerator: item.reserve1,
      price0Denominator: item.reserve0,
      price1Numerator: item.reserve0,
      price1Denominator: item.reserve1,
      updatedBlock: item.updatedBlock,
    }));
  return {
    pools,
    tokens,
    events,
    analytics,
    provenance,
    prices,
    twap: [] as TWAP[],
    fees: [] as FeeSummary[],
  };
}

export async function loadAccountNonce(account: string, signal?: AbortSignal) {
  const address = evmAddressFromYNX(account),
    response = await fetch(`${BASE}/accounts/${address}`, {
      signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
    }),
    body = (await response.json().catch(() => null)) as {
      address?: string;
      nonce?: number;
      error?: string;
    } | null;
  if (
    !response.ok ||
    !body ||
    body.address !== address ||
    !Number.isSafeInteger(body.nonce) ||
    Number(body.nonce) < 0
  )
    throw new Error(
      body?.error || "Authoritative DEX account nonce is unavailable.",
    );
  return Number(body.nonce);
}

export async function broadcastDexAction(
  response: DexActionResponse,
  signal?: AbortSignal,
) {
  const payload = response.signedTransaction.payload as { poolId?: unknown },
    poolId = String(payload.poolId || "");
  if (!/^dex_[a-z0-9][a-z0-9_-]{2,59}$/.test(poolId))
    throw new Error("Signed DEX pool ID is invalid.");
  const suffix = (
    {
      dex_swap_exact_input: "swaps/exact-input",
      dex_swap_exact_output: "swaps/exact-output",
      dex_liquidity_add: "liquidity/add",
      dex_liquidity_remove: "liquidity/remove",
    } as Record<string, string>
  )[response.action];
  if (!suffix) throw new Error("Signed DEX action is unsupported.");
  const result = await fetch(
      `${BASE}/dex/pools/${encodeURIComponent(poolId)}/${suffix}`,
      {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(response.signedTransaction),
        credentials: "omit",
      },
    ),
    body = record(await result.json().catch(() => null));
  if (!result.ok || !body || body.failure === true)
    throw new Error(
      (typeof body?.error === "string" && body.error) ||
        `DEX transaction failed closed (${result.status}).`,
    );
  const wrapper =
      body.source === "ynx-consensus-abci" &&
      body.version === EXPECTED_VERSION &&
      body.failure === false,
    raw = body.source === AUTHORITATIVE_SOURCE && body.mainnet === false,
    mutation = raw ? record(body.result) : body,
    eventValue = record(mutation?.event) as NativeEvent | null,
    poolValue = record(mutation?.pool) as NativePool | null,
    committedHash = eventValue?.txHash || eventValue?.transactionHash,
    transaction = raw ? record(body.transaction) : null;
  if (
    (!wrapper && !raw) ||
    !eventValue ||
    !poolValue ||
    (raw && transaction?.hash !== response.transactionHash)
  )
    throw new Error("DEX transaction response lacks authoritative committed evidence.");
  if (committedHash !== response.transactionHash || poolValue.id !== poolId)
    throw new Error(
      "Committed DEX evidence does not match the Wallet-signed transaction.",
    );
  return Object.freeze({
    event: event(eventValue),
    pool: pool(poolValue),
    transactionHash: response.transactionHash,
  });
}

export const dexApi = {
  snapshot: loadDexSnapshot,
  positions: async (
    account: string,
    _sessionBinding: string,
    signal?: AbortSignal,
  ) => {
    const response = await requestCollection<NativePool>(
      "/dex/pools",
      "pools",
      signal,
    );
    const items: Position[] = response.items.flatMap((item) => []);
    void account;
    return { items };
  },
};

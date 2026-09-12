import type {
  Analytics,
  ChainEvent,
  FeeSummary,
  Pool,
  SpotPrice,
  SnapshotProvenance,
  Token,
  TWAP,
} from "./types";
import type { DexActionResponse } from "@ynx-chain/wallet-auth";
import { loadNativeSnapshot } from './native-snapshot';

const BASE = (
  import.meta.env.VITE_DEX_GATEWAY_URL ||
  import.meta.env.VITE_DEX_API_URL ||
  ""
).replace(/\/$/, "");
const EXPECTED_VERSION = "abci-state-v13";
const AUTHORITATIVE_SOURCE = "authoritative chain-native YNX Testnet state";

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

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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
  fee0: null,
  fee1: null,
  blockNumber: safeInteger(value.blockHeight, "DEX event block height", 1),
  txHash: value.txHash || value.transactionHash || "",
  timestamp: value.occurredAt,
  auditHash: value.auditHash,
});

/** A single current-state generation. Inclusion, local durability and finality stay distinct. */
export async function loadDexSnapshot(signal?: AbortSignal) {
  const snapshot=await loadNativeSnapshot(undefined,signal);
  const height=(v:string)=>safeInteger(Number(v),"Block height (display)",0);
  const tokens:Token[]=snapshot.assets.map(a=>({
    chainId:6423,address:a.id,symbol:a.symbol,name:a.name,decimals:a.decimals,
    standard:"YNX-consensus-asset",reviewStatus:"authoritative-current-testnet",
    issuer:a.issuer??"protocol",totalSupply:a.totalSupply??"",maxSupply:a.maxSupply??"",
    updatedBlock:a.blockHeight===undefined?0:height(a.blockHeight),txHash:a.txHash??"",auditHash:a.auditHash??"",
  }));
  const pools:Pool[]=snapshot.pools.map(p=>({
    address:p.id,token0:p.asset0,token1:p.asset1,reserve0:p.reserve0,reserve1:p.reserve1,
    contractVersion:"ynx-native-dex-cpmm-v1",feeBps:p.feeBps,totalShares:p.totalShares,
    updatedBlock:height(p.blockHeight),updatedAt:snapshot.asOf,txHash:p.txHash,auditHash:p.auditHash,
  }));
  const events:ChainEvent[]=snapshot.events.map(e=>({
    id:e.id,type:e.type,pool:e.poolId,account:e.signer,asset0:e.asset0,asset1:e.asset1,
    amount0:e.amount0,amount1:e.amount1,fee0:null,fee1:null,feesKnown:false,
    blockNumber:height(e.blockHeight),txHash:e.txHash,timestamp:e.occurredAt,auditHash:e.auditHash,stage:e.stage,
  })).sort((a,b)=>b.blockNumber-a.blockNumber||b.timestamp.localeCompare(a.timestamp));
  const latestBlock=height(snapshot.blockHeight);
  const analytics:Analytics={source:snapshot.source,version:snapshot.schemaVersion,indexedEvents:events.length,pools:pools.length,
    swaps:events.filter(e=>e.type.startsWith("dex_swap_")).length,
    liquidityEvents:events.filter(e=>e.type.startsWith("dex_liquidity_")).length,latestBlock};
  const provenance:SnapshotProvenance=Object.freeze({
    source:snapshot.source,asOf:snapshot.asOf,version:snapshot.schemaVersion,
    classification:"testnet",status:"current-including-pending",coverage:"native-snapshot-assets-pools-events",
    latestBlock,atomic:true,consensusFinality:false,snapshotId:snapshot.snapshotId,
    pendingTransactionCount:snapshot.pendingTransactionCount,durableCheckpoint:snapshot.durableCheckpoint,
  });
  const prices:SpotPrice[]=pools.filter(p=>BigInt(p.reserve0)>0n&&BigInt(p.reserve1)>0n).map(p=>({
    pool:p.address,token0:p.token0,token1:p.token1,price0Numerator:p.reserve1,price0Denominator:p.reserve0,
    price1Numerator:p.reserve0,price1Denominator:p.reserve1,updatedBlock:p.updatedBlock,
  }));
  return {tokens,pools,events,analytics,provenance,prices,twap:[] as TWAP[],fees:[] as FeeSummary[]};
}

export async function loadAccountNonce(account:string,signal?:AbortSignal) {
  const snapshot=await loadNativeSnapshot(account,signal);
  // Legacy signer accepts JSON numbers: never round a uint64 nonce into a signature.
  const nonce=Number(snapshot.account!.nonce);
  if(!Number.isSafeInteger(nonce)||snapshot.account!.nextNonce===null||!Number.isSafeInteger(nonce+1))
    throw new Error("Native action nonce exceeds the supported signing range.");
  return nonce;
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
    throw new Error("DEX transaction response lacks authoritative mutation evidence.");
  if (committedHash !== response.transactionHash || poolValue.id !== poolId)
    throw new Error(
      "DEX mutation evidence does not match the Wallet-signed transaction.",
    );
  return Object.freeze({
    event: event(eventValue),
    pool: pool(poolValue),
    transactionHash: response.transactionHash,
  });
}

export const dexApi = {
  snapshot: loadDexSnapshot,
};

export type Availability = 'connecting' | 'live' | 'polling' | 'stale' | 'catching-up' | 'unavailable';

export interface BuildInfo { commit?: string; release?: string; buildTime?: string }
export interface Summary {
  network?: string;
  chainId?: number | string;
  nativeSymbol?: string;
  latestHeight?: number;
  indexedHeight?: number;
  indexedTxCount?: number;
  truthfulStatus?: string;
  build?: BuildInfo;
  wallet?: { chainIdHex?: string; rpcUrls?: string[]; blockExplorerUrls?: string[] };
}
export interface Block { height?: number; hash?: string; parentHash?: string; timestamp?: string; transactions?: unknown[]; txCount?: number }
export interface Transaction { hash?: string; type?: string; from?: string; to?: string; amount?: number; fee?: number; blockHeight?: number; status?: string; sponsor?: string }
export interface Validator { address?: string; moniker?: string; active?: boolean; votingPower?: number; peerReady?: boolean; status?: string }
export interface DashboardSnapshot {
  summary?: Summary;
  blocks?: Block[] | { blocks?: Block[] };
  transactions?: Transaction[] | { transactions?: Transaction[]; txs?: Transaction[] };
  validators?: Validator[] | { validators?: Validator[] };
  resources?: Record<string, unknown>;
  warnings?: string[];
}

export function arrayFrom<T>(value: T[] | Record<string, T[]> | undefined, keys: string[]): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  return [];
}

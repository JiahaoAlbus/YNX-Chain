import type { SearchResult } from './routing';
import type { Block, DashboardSnapshot, Transaction } from './types';

export interface BlockPage {
  blocks: Block[];
  nextCursor?: string;
  cursorVersion?: number;
}

export interface TransactionPage {
  transactions: Transaction[];
  nextCursor?: string;
  cursorVersion?: number;
}

const detailRoutes: Record<string, (id: string) => string[]> = {
  transaction: id => [`/api/txs/${encodeURIComponent(id)}`, `/chain/evm/receipts/${encodeURIComponent(id)}`],
  account: id => [`/api/accounts/${encodeURIComponent(id)}`],
  block: id => [`/api/blocks/${encodeURIComponent(id)}`],
  contract: id => [`/chain/ide/contracts/${encodeURIComponent(id)}`, `/chain/ide/verifier/${encodeURIComponent(id)}`],
  resource: id => [`/api/resources/${encodeURIComponent(id)}`],
  trust: id => [`/chain/trust/traces/${encodeURIComponent(id)}`],
  governance: id => [`/chain/governance/proposals/${encodeURIComponent(id)}`]
};

async function getJSON<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Explorer source unavailable (${response.status})`);
  return response.json() as Promise<T>;
}

export function loadBlockPage(cursor = '', limit = 5): Promise<BlockPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return getJSON<BlockPage>(`/api/blocks/latest?${query}`);
}

export function loadTransactionPage(cursor = '', limit = 5): Promise<TransactionPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return getJSON<TransactionPage>(`/api/txs?${query}`);
}

export async function universalSearch(query: string): Promise<SearchResult> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
  if (!response.ok) throw new Error(`Search unavailable (${response.status})`);
  return response.json() as Promise<SearchResult>;
}

export async function loadEvidence(kind: string, id: string) {
  const routes = detailRoutes[kind]?.(id) ?? [];
  if (!routes.length) throw new Error('Unsupported evidence type');
  const evidence = await Promise.all(routes.map(async url => {
    const response = await fetch(url);
    const body = await response.json().catch(() => ({ error: `Non-JSON response (${response.status})` }));
    return { url, status: response.status, body };
  }));
  if (!evidence.some(item => item.status >= 200 && item.status < 300)) throw new Error('No authoritative source returned this record.');
  return evidence;
}

export function sourceLinks(snapshot?: DashboardSnapshot) {
  return [
    { label: 'Explorer summary', href: '/api/summary' },
    { label: 'Indexer-backed blocks', href: '/api/blocks/latest' },
    { label: 'Validator evidence', href: '/api/validators' },
    ...(snapshot?.summary?.wallet?.rpcUrls ?? []).map((href, i) => ({ label: `Public RPC ${i + 1}`, href }))
  ];
}

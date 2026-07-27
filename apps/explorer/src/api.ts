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

export interface PublicEvidenceEnvelope {
  schemaVersion: 'explorer.public-evidence.v1';
  evidenceId: string;
  kind: string;
  subject: string;
  source: {
    authority: string;
    system: string;
    version: string;
    transportOwner: string;
    transport: string;
    transportVersion: string;
    path: string;
    upstreamPath: string;
    derivation: string;
  };
  observedAt: string;
  asOf: string;
  asOfBasis: string;
  freshness: {
    state: 'current' | 'partial' | 'unknown' | 'offline' | 'unavailable';
    stale: boolean;
    offline: boolean;
    partial: boolean;
    reason?: string;
    rpcHeight?: number;
    indexedHeight?: number;
    lagBlocks?: number;
  };
  coverage: {
    status: 'complete-for-explorer-schema' | 'partial' | 'unavailable';
    scope: string;
    missing?: string[];
    note?: string;
  };
  correction: {
    status: string;
    replaces?: string;
  };
  integrity?: {
    algorithm: string;
    digest: string;
  };
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface EvidenceItem {
  url: string;
  status: number;
  body: unknown;
  envelope?: PublicEvidenceEnvelope;
  rawSourceUrl: string;
}

const envelopeKinds = new Set(['block', 'transaction', 'account', 'resource', 'token', 'fee']);

const auxiliaryRoutes: Record<string, (id: string) => string[]> = {
  transaction: id => [`/chain/evm/receipts/${encodeURIComponent(id)}`],
  contract: id => [`/chain/ide/contracts/${encodeURIComponent(id)}`, `/chain/ide/verifier/${encodeURIComponent(id)}`],
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

export async function loadEvidence(kind: string, id: string): Promise<EvidenceItem[]> {
  const routes = [
    ...(envelopeKinds.has(kind) ? [`/api/evidence/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`] : []),
    ...(auxiliaryRoutes[kind]?.(id) ?? [])
  ];
  if (!routes.length) throw new Error('Unsupported evidence type');
  const evidence = await Promise.all(routes.map(async url => {
    const response = await fetch(url);
    const body = await response.json().catch(() => ({ error: `Non-JSON response (${response.status})` }));
    const envelope = isPublicEvidenceEnvelope(body) ? body : undefined;
    return {
      url,
      status: response.status,
      body,
      envelope,
      rawSourceUrl: envelope?.source.path ?? url
    } satisfies EvidenceItem;
  }));
  if (!evidence.some(item => item.status >= 200 && item.status < 300)) throw new Error('No authoritative source returned this record.');
  return evidence;
}

export function isPublicEvidenceEnvelope(value: unknown): value is PublicEvidenceEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PublicEvidenceEnvelope>;
  return candidate.schemaVersion === 'explorer.public-evidence.v1'
    && typeof candidate.evidenceId === 'string'
    && typeof candidate.kind === 'string'
    && typeof candidate.subject === 'string'
    && !!candidate.source
    && !!candidate.freshness
    && !!candidate.coverage;
}

export function sourceLinks(snapshot?: DashboardSnapshot) {
  return [
    { label: 'Explorer summary', href: '/api/summary' },
    { label: 'Indexer-backed blocks', href: '/api/blocks/latest' },
    { label: 'Validator evidence', href: '/api/validators' },
    ...(snapshot?.summary?.wallet?.rpcUrls ?? []).map((href, i) => ({ label: `Public RPC ${i + 1}`, href }))
  ];
}

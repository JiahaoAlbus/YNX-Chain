import type { DashboardSnapshot } from './types';

const detailRoutes: Record<string, (id: string) => string[]> = {
  transaction: id => [`/api/txs/${encodeURIComponent(id)}`, `/chain/evm/receipts/${encodeURIComponent(id)}`],
  account: id => [`/api/accounts/${encodeURIComponent(id)}`],
  block: id => [`/api/blocks/${encodeURIComponent(id)}`],
  contract: id => [`/chain/ide/contracts/${encodeURIComponent(id)}`, `/chain/ide/verifier/${encodeURIComponent(id)}`],
  resource: id => [`/api/resources/${encodeURIComponent(id)}`],
  trust: id => [`/chain/trust/traces/${encodeURIComponent(id)}`],
  governance: id => [`/chain/governance/proposals/${encodeURIComponent(id)}`]
};

export async function universalSearch(query: string) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
  if (!response.ok) throw new Error(`Search unavailable (${response.status})`);
  return response.json();
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

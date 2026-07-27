export type EvidenceKind = 'block' | 'transaction' | 'account' | 'contract' | 'resource' | 'trust' | 'governance';

export interface EvidenceSelection {
  kind: EvidenceKind;
  id: string;
}

export interface SearchResult {
  query?: string;
  type?: string;
  normalizedAddress?: string;
}

const segmentByKind: Record<EvidenceKind, string> = {
  block: 'block',
  transaction: 'tx',
  account: 'address',
  contract: 'contract',
  resource: 'resource',
  trust: 'trust',
  governance: 'governance'
};

const kindBySegment = Object.fromEntries(
  Object.entries(segmentByKind).map(([kind, segment]) => [segment, kind])
) as Record<string, EvidenceKind>;

function normalizeSelection(kind: string | null | undefined, id: string | null | undefined): EvidenceSelection | undefined {
  if (!kind || !id || !(kind in segmentByKind)) return undefined;
  const normalized = id.trim();
  if (!normalized || normalized.length > 512) return undefined;
  return { kind: kind as EvidenceKind, id: normalized };
}

export function selectionFromURL(input: Pick<URL, 'pathname' | 'searchParams'>): EvidenceSelection | undefined {
  const parts = input.pathname.split('/').filter(Boolean);
  if (parts.length === 2) {
    const kind = kindBySegment[parts[0]];
    if (!kind) return undefined;
    try {
      return normalizeSelection(kind, decodeURIComponent(parts[1]));
    } catch {
      return undefined;
    }
  }
  if (parts.length !== 0) return undefined;
  return normalizeSelection(input.searchParams.get('kind'), input.searchParams.get('id'));
}

export function pathForSelection(selection: EvidenceSelection): string {
  const normalized = normalizeSelection(selection.kind, selection.id);
  if (!normalized) throw new Error('Invalid evidence selection');
  return `/${segmentByKind[normalized.kind]}/${encodeURIComponent(normalized.id)}`;
}

export function selectionFromSearchResult(result: SearchResult): EvidenceSelection | undefined {
  const id = result.type === 'account' ? result.normalizedAddress || result.query : result.query;
  return normalizeSelection(result.type, id);
}

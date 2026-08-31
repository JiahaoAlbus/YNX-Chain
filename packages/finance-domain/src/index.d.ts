export const FINANCE_DOMAIN_VERSION: "ynx-finance-domain-v1";
export const MODEL_KINDS: readonly ["Asset", "Market", "Quote", "Candle", "Order", "Trade", "Position", "Portfolio", "LiquidityPool", "Strategy", "RiskLimit"];
export type ModelKind = typeof MODEL_KINDS[number];
export const ERROR_CODES: Readonly<Record<string, string>>;

export type SourceClassification = "authoritative" | "verified-index" | "reference" | "testnet";
export type SourceStatus = "live" | "stale" | "unavailable" | "partial";
export interface SourceMetadata {
  owner: string;
  system: string;
  version: string;
  asOf: string;
  classification: SourceClassification;
  status: SourceStatus;
  confidence?: string;
  coverage?: string;
}
export interface DomainRecord { schemaVersion: typeof FINANCE_DOMAIN_VERSION; source: SourceMetadata; [key: string]: unknown }
export function validateSource(source: SourceMetadata): SourceMetadata;
export function validateDecimal(value: string, field?: string): string;
export function validateModel(kind: ModelKind, value: DomainRecord): DomainRecord;
export function createError(input: { code: string; message: string; requestId: string; retryable?: boolean; details?: unknown }): Readonly<object>;
export function validateWriteHeaders(headers: { requestId: string; idempotencyKey: string; expectedVersion: string }): object;

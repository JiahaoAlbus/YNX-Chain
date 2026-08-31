export const FINANCE_DOMAIN_VERSION: "ynx-finance-domain-v1";
export const FINANCE_READ_ENVELOPE_VERSION: "ynx-finance-read-envelope-v1";
export const FINANCE_STREAM_ENVELOPE_VERSION: "ynx-finance-stream-envelope-v1";
export const MODEL_KINDS: readonly ["Asset", "Market", "Quote", "Candle", "Order", "Trade", "Position", "Portfolio", "LiquidityPool", "Strategy", "RiskLimit"];
export const ORDER_STATUSES: readonly ["pending", "open", "partially_filled", "filled", "cancelled", "rejected", "expired", "execution_unknown"];
export type ModelKind = typeof MODEL_KINDS[number];
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ERROR_CODES: Readonly<Record<string, string>>;

export type SafeErrorDetailValue = string | number | boolean | null | readonly SafeErrorDetailValue[] | Readonly<Record<string, SafeErrorDetailValue>>;
export type FinanceErrorDetails = Readonly<Record<string, SafeErrorDetailValue>>;

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
export interface FinanceReadEnvelope {
  schemaVersion: typeof FINANCE_READ_ENVELOPE_VERSION;
  kind: ModelKind;
  requestId: string;
  readOnly: true;
  capabilities: readonly "read"[];
  sourceStatus: SourceStatus;
  data: DomainRecord;
  cursor?: string;
}
export interface FinanceStreamEnvelope {
  schemaVersion: typeof FINANCE_STREAM_ENVELOPE_VERSION;
  event: "snapshot" | "upsert" | "reconciled";
  eventId: string;
  requestId: string;
  sequence: number;
  emittedAt: string;
  readOnly: true;
  kind: ModelKind;
  sourceStatus: SourceStatus;
  data: DomainRecord;
  cursor?: string;
}
export function validateSource(source: SourceMetadata): SourceMetadata;
export function validateDecimal(value: string, field?: string): string;
export function compareDecimal(left: string, right: string): -1 | 0 | 1;
export function validateModel(kind: ModelKind, value: DomainRecord): DomainRecord;
export function validateReadEnvelope(value: FinanceReadEnvelope): FinanceReadEnvelope;
export function validateStreamEnvelope(value: FinanceStreamEnvelope): FinanceStreamEnvelope;
export function createError(input: { code: string; message: string; requestId: string; retryable?: boolean; details?: FinanceErrorDetails }): Readonly<object>;
export function validateWriteHeaders(headers: { requestId: string; idempotencyKey: string; expectedVersion: string }): object;
export function evaluateWritePrecondition(input: {
  headers: { requestId: string; idempotencyKey: string; expectedVersion: string };
  currentVersion: string;
  requestDigest: string;
  idempotencyRecord?: { idempotencyKey: string; requestDigest: string; resourceVersion: string; outcome: "accepted" | "rejected" | "execution_unknown" };
}): Readonly<{ action: "create"; expectedVersion: string } | { action: "replay"; outcome: "accepted" | "rejected" | "execution_unknown"; resourceVersion: string }>;
export function assertOrderTransition(fromStatus: OrderStatus, toStatus: OrderStatus): OrderStatus;
export function assertStrategyRiskAuthorization(input: {
  strategy: DomainRecord & { strategyId: string; ownerAccountId: string; lifecycle: "draft" | "paper" | "testnet" | "paused" | "stopped" | "completed" };
  riskLimit: DomainRecord & { riskLimitId: string; ownerAccountId: string; maxNotional: string; maxOrderNotional: string; maxSlippageBps: number; expiresAt: string; killSwitch: boolean };
  requestedNotional: string;
  requestedSlippageBps: number;
  evaluatedAt: string;
  /** Product-owned freshness policy for Strategy and RiskLimit provenance; maximum 24h. */
  maxRiskSourceAgeMs: number;
}): Readonly<{ ownerAccountId: string; strategyId: string; riskLimitId: string; evaluatedAt: string }>;

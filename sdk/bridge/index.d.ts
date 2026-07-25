export type BridgePhase =
  | "quote"
  | "user_review"
  | "source_submitted"
  | "source_accepted"
  | "source_finalized"
  | "proof_attestation_available"
  | "proof_verified"
  | "destination_mint_release_submitted"
  | "destination_mint_release_confirmed"
  | "destination_available"
  | "failed"
  | "retryable"
  | "refund_pending"
  | "refunded"
  | "recovery_required"
  | "disputed"
  | "corrected"
  | "expired"
  | "paused";

export interface YNXBridgeSDKErrorOptions {
  cause?: unknown;
  status?: number;
  requestId?: string;
  errorId?: string;
}

export class YNXBridgeSDKError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly errorId?: string;
  constructor(message: string, options?: YNXBridgeSDKErrorOptions);
}

export interface YNXBridgeClientOptions {
  baseURL: string | URL;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BridgeBuildInfo {
  commit: string;
  release: string;
  buildTime: string;
}

export interface BridgeHealth {
  ok: boolean;
  degraded: boolean;
  service: "ynx-bridged";
  schemaVersion: 7;
  stateMachineVersion: "ynx.bridge.lifecycle.v1";
  startedAt: string;
  providerStatus: string;
  providerCount: number;
  availableProviderCount: number;
  contractStatus: string;
  reconciliationStatus: string;
  liveBridge: boolean;
  externalSubmissionEnabled: boolean;
  truthfulStatus: string;
  [key: string]: unknown;
}

export interface BridgeVersion {
  service: "ynx-bridged";
  source: "ynx-bridge-runtime";
  schemaVersion: 7;
  stateMachineVersion: "ynx.bridge.lifecycle.v1";
  startedAt: string;
  asOf: string;
  degraded: boolean;
  paused: boolean;
  providerStatus: string;
  providerCount: number;
  availableProviderCount: number;
  contractStatus: string;
  reconciliationStatus: string;
  lastSuccessfulTransfer: string | null;
  lastReconciliation: string | null;
  liveBridge: boolean;
  externalSubmissionEnabled: boolean;
  build: BridgeBuildInfo;
}

export interface BridgeStateDefinition {
  id: BridgePhase;
  terminal: boolean;
  destinationAssetAvailable: boolean;
  description: string;
}

export interface BridgeStateTransition {
  from: BridgePhase;
  to: BridgePhase;
  condition: string;
}

export interface BridgeStateMachine {
  version: "ynx.bridge.lifecycle.v1";
  source: "ynx-bridge-runtime";
  asOf: string;
  states: BridgeStateDefinition[];
  transitions: BridgeStateTransition[];
  legacyAliases: Record<string, BridgePhase>;
}

export interface BridgeProviderRegistryEntry {
  id: string;
  provider: string;
  product: string;
  classification: string;
  routeId: string;
  sourceChain: string;
  destinationChain: string;
  supportedAssets: string[];
  sourceContract: null;
  destinationContract: null;
  apiVersion: "not-configured";
  sdkVersion: "not-configured";
  authentication: "not-applicable-route-unavailable";
  rateLimit: "unknown-route-unavailable";
  fees: Readonly<Record<string, unknown>>;
  slippage: Readonly<Record<string, unknown>>;
  estimatedTime: Readonly<Record<string, unknown>>;
  finality: Readonly<Record<string, unknown>>;
  refundPolicy: Readonly<Record<string, unknown>>;
  recoveryProcess: string;
  limits: Readonly<Record<string, unknown>>;
  jurisdiction: "not-approved";
  license: "not-approved";
  terms: "not-approved";
  dataRetention: "not-reviewed";
  dataRights: "not-reviewed";
  custodyModel: "not-established";
  securityModel: string;
  auditStatus: "not-reviewed";
  incidentHistory: ReadonlyArray<Readonly<Record<string, unknown>>>;
  incidentHistoryComplete: false;
  health: "not-connected";
  lastSuccess: null;
  lastFailure: null;
  fallback: "none";
  decommissionPlan: string;
  testnetStatus: "unavailable";
  productionStatus: "unavailable";
  credentialsConfigured: false;
  agreementApproved: false;
  contractsConfigured: false;
  routeAvailable: false;
  executable: false;
  failureStatus: "provider-support-contracts-credentials-agreement-and-funding-unavailable";
}

export interface BridgeProviderRegistry {
  schemaVersion: 1;
  source: "ynx-bridge-provider-registry";
  asOf: string;
  coverage: "configured-provider-identities-and-routes-only-no-live-provider-session-commercial-rights-or-independent-incident-history";
  providers: BridgeProviderRegistryEntry[];
}

export interface BridgeTransferAvailabilityInput {
  phase: BridgePhase;
  updatedAt: string;
  stateMachineVersion?: "ynx.bridge.lifecycle.v1";
  destinationAssetAvailable?: boolean;
}

export interface BridgeTransferAvailability {
  schemaVersion: 2;
  source: "ynx-bridge-lifecycle";
  stateMachineVersion: "ynx.bridge.lifecycle.v1";
  asOf: string;
  coverage: "coordinator-recorded-phase-and-explicit-availability-not-independent-chain-proof";
  phase: BridgePhase;
  assetAvailable: boolean;
  mayPay: boolean;
  mayCreditExchange: boolean;
  showRecovery: boolean;
}

export class YNXBridgeClient {
  readonly baseURL: string;
  constructor(options: YNXBridgeClientOptions);
  getHealth(): Promise<BridgeHealth>;
  getVersion(): Promise<BridgeVersion>;
  getStateMachine(): Promise<BridgeStateMachine>;
  getTransparency(): Promise<Readonly<Record<string, unknown>>>;
  getRoutes(): Promise<Readonly<Record<string, unknown>>>;
  getProviders(): Promise<Readonly<BridgeProviderRegistry>>;
  getAssets(): Promise<Readonly<Record<string, unknown>>>;
  getStatus(): Promise<Readonly<Record<string, unknown>>>;
}

export function bridgeTransferAvailability(transfer: BridgeTransferAvailabilityInput): Readonly<BridgeTransferAvailability>;

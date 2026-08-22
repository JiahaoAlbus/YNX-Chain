export type ProductBinding = Readonly<{
  requestingProduct: string;
  bundleId: string;
  callbacks: readonly string[];
  scopes: readonly string[];
  maxScopes?: number;
}>;
export type ProductDeviceAlgorithm = "p256-sha256";
export type AuthorizationRequest = Readonly<{
  version: "1";
  nonce: string;
  chainId: "ynx_6423-1";
  requestingProduct: string;
  productClientId: string;
  bundleId: string;
  productDeviceAlgorithm: ProductDeviceAlgorithm;
  productDeviceKey: string;
  callback: string;
  scopes: readonly string[];
  purpose: string;
  issuedAt: string;
  expiresAt: string;
}>;
export type AuthorizationResponse = Readonly<{
  version: "1";
  requestDigest: string;
  nonce: string;
  chainId: "ynx_6423-1";
  requestingProduct: string;
  productClientId: string;
  bundleId: string;
  productDeviceAlgorithm: ProductDeviceAlgorithm;
  productDeviceKey: string;
  callback: string;
  account: string;
  accountPublicKey: string;
  grantedScopes: readonly string[];
  purpose: string;
  issuedAt: string;
  expiresAt: string;
  walletSignature: string;
}>;
export type GatewayChallenge = Readonly<{
  version: "1";
  challenge: string;
  requestDigest: string;
  productClientId: string;
  bundleId: string;
  productDeviceAlgorithm: ProductDeviceAlgorithm;
  productDeviceKey: string;
  account: string;
  scopes: readonly string[];
  issuedAt: string;
  expiresAt: string;
}>;
export type GatewayCompletion = Readonly<{
  challenge: GatewayChallenge;
  deviceSignature: string;
}>;
export type DeveloperDeploymentPayload = Readonly<{
  name: string;
  source: string;
  deployedBytecode: string;
  constructorArgs: readonly string[];
  idempotencyKey: string;
  requestHash: string;
}>;
export type DeveloperDeploymentRequest = Readonly<{
  version: "1";
  chainId: 6423;
  productClientId: "ynx-developer-v1";
  bundleId: "com.ynxweb4.developer.testnetpreview";
  callback: "ynxdeveloper://deployment/callback";
  sessionBinding: string;
  account: string;
  nonce: number;
  action: "ide_contract_deploy";
  payload: DeveloperDeploymentPayload;
  artifactDigest: string;
  simulation: Readonly<{
    chainId: 6423;
    blockNumber: number;
    gasEstimate: string;
    gasPriceWei: string;
    maxFeeWei: string;
    compilerVersion: string;
    artifactDigest: string;
    source: string;
    asOf: string;
  }>;
  issuedAt: string;
  expiresAt: string;
}>;
export type DeveloperDeploymentResponse = Readonly<{
  version: "1";
  requestDigest: string;
  productClientId: "ynx-developer-v1";
  bundleId: "com.ynxweb4.developer.testnetpreview";
  callback: "ynxdeveloper://deployment/callback";
  sessionBinding: string;
  account: string;
  action: "ide_contract_deploy";
  artifactDigest: string;
  signedTransaction: Readonly<Record<string, unknown>>;
  canonicalPayloadHex: string;
  transactionHash: string;
  issuedAt: string;
  expiresAt: string;
}>;
export type DexActionName =
  | "dex_swap_exact_input"
  | "dex_swap_exact_output"
  | "dex_liquidity_add"
  | "dex_liquidity_remove";
export type DexActionPayload = Readonly<
  Record<string, number | string> & { poolId: string; deadlineUnix: number }
>;
export type DexQuote = Readonly<{
  poolId: string;
  poolBlockHeight: number;
  poolUpdatedAt: string;
  asset0: string;
  asset1: string;
  reserve0: number;
  reserve1: number;
  feeBps: number;
  expectedAmount: number;
}>;
export type DexActionRequest = Readonly<{
  version: "1";
  chainId: 6423;
  productClientId: "ynx-dex-web-v1";
  bundleId: "com.ynxweb4.dex.web";
  callback: "https://dex.ynxweb4.com/wallet-action/callback";
  sessionBinding: string;
  account: string;
  nonce: number;
  action: DexActionName;
  payload: DexActionPayload;
  quote: DexQuote;
  issuedAt: string;
  expiresAt: string;
}>;
export type DexActionResponse = Readonly<{
  version: "1";
  requestDigest: string;
  productClientId: "ynx-dex-web-v1";
  bundleId: "com.ynxweb4.dex.web";
  callback: "https://dex.ynxweb4.com/wallet-action/callback";
  sessionBinding: string;
  account: string;
  action: DexActionName;
  payloadHash: string;
  signedTransaction: Readonly<Record<string, unknown>>;
  canonicalPayloadHex: string;
  transactionHash: string;
  issuedAt: string;
  expiresAt: string;
}>;
export type CentralRegistryEntryV1 = Readonly<{
  schemaVersion: 1;
  productClientId: string;
  requestingProduct: string;
  bundleId: string;
  callback: string;
  scopes: readonly string[];
  maxScopes: number;
}>;
export type CentralRegistryEntry = Readonly<{
  schemaVersion: 2;
  productClientId: string;
  requestingProduct: string;
  bundleId: string;
  callbacks: readonly string[];
  scopes: readonly string[];
  maxScopes: number;
  productDeviceAlgorithms: readonly ProductDeviceAlgorithm[];
}>;
export type CentralReviewState = "approved" | "pending-review" | "disabled";
export type CentralProductRegistration = Readonly<
  Omit<CentralRegistryEntry, "schemaVersion"> & {
    schemaVersion: 3;
    productId: string;
    displayName: string;
    reviewState: CentralReviewState;
    enabled: boolean;
    sessionDurationSeconds: number;
    revocationPolicy: Readonly<{
      session: true;
      approval: true;
      device: true;
      accountAllDevices: true;
    }>;
  }
>;
export type CentralRegistryDocument = Readonly<{
  registryVersion: 2;
  chainId: "ynx_6423-1";
  products: readonly CentralProductRegistration[];
}>;
export type CentralWalletSession = Readonly<{
  verifierVersion: "wallet-auth-v1";
  sessionBinding: string;
  chainId: "ynx_6423-1";
  requestingProduct: string;
  productClientId: string;
  bundleId: string;
  callback: string;
  productDeviceAlgorithm: ProductDeviceAlgorithm;
  productDeviceKey: string;
  deviceBinding: string;
  account: string;
  accountPublicKey: string;
  scopes: readonly string[];
  nonce: string;
  purpose: string;
  requestDigest: string;
  approvalDigest: string;
  issuedAt: string;
  expiresAt: string;
}>;
export type CentralRevocationState = Readonly<{
  revokedSessionBindings: readonly string[];
  revokedApprovalDigests: readonly string[];
  revokedDeviceBindings: readonly string[];
  accountLogoutRecords: readonly Readonly<{
    account: string;
    before: string;
  }>[];
}>;
export type CentralWalletStoreSnapshot = Readonly<{
  schemaVersion: 1;
  consumedNonces: readonly string[];
  consumedRequestDigests: readonly string[];
  consumedChallenges: readonly string[];
  sessions: readonly CentralWalletSession[];
  revokedSessionBindings: readonly string[];
  revokedApprovalDigests: readonly string[];
  revokedDeviceBindings: readonly string[];
  accountLogoutRecords: readonly Readonly<{
    account: string;
    before: string;
  }>[];
  audit: readonly Readonly<{
    sequence: number;
    type: string;
    subject: string;
    at: string;
    previousHash: string | null;
    hash: string;
  }>[];
}>;
export type CentralWalletSessionInactiveReason =
  | "issued-in-future"
  | "expired"
  | "session-revoked"
  | "approval-revoked"
  | "device-revoked"
  | "account-logout";
export type CentralWalletSessionInventoryItem = Readonly<
  Pick<
    CentralWalletSession,
    | "sessionBinding"
    | "requestingProduct"
    | "productClientId"
    | "bundleId"
    | "callback"
    | "productDeviceAlgorithm"
    | "productDeviceKey"
    | "deviceBinding"
    | "approvalDigest"
    | "scopes"
    | "purpose"
    | "issuedAt"
    | "expiresAt"
  > & {
    active: boolean;
    inactiveReasons: readonly CentralWalletSessionInactiveReason[];
  }
>;
export type CentralWalletConnectedApp = Readonly<{
  requestingProduct: string;
  productClientId: string;
  bundleId: string;
  sessionBindings: readonly string[];
  activeSessionBindings: readonly string[];
  approvalDigests: readonly string[];
  deviceBindings: readonly string[];
  active: boolean;
}>;
export type CentralWalletApprovalInventoryItem = Readonly<{
  approvalDigest: string;
  requestingProduct: string;
  productClientId: string;
  bundleId: string;
  sessionBindings: readonly string[];
  activeSessionBindings: readonly string[];
  revoked: boolean;
}>;
export type CentralWalletDeviceInventoryItem = Readonly<{
  deviceBinding: string;
  requestingProduct: string;
  productClientId: string;
  bundleId: string;
  productDeviceAlgorithm: ProductDeviceAlgorithm;
  productDeviceKey: string;
  sessionBindings: readonly string[];
  activeSessionBindings: readonly string[];
  revoked: boolean;
}>;
export type CentralWalletSessionInventory = Readonly<{
  schemaVersion: 1;
  account: string;
  asOf: string;
  connectedApps: readonly CentralWalletConnectedApp[];
  approvals: readonly CentralWalletApprovalInventoryItem[];
  devices: readonly CentralWalletDeviceInventoryItem[];
  sessions: readonly CentralWalletSessionInventoryItem[];
}>;
export type SignedNativeTransfer = Readonly<{
  version: 1;
  chainId: 6423;
  type: "transfer";
  from: string;
  to: string;
  amount: number;
  fee: 1;
  nonce: number;
  publicKey: string;
  signature: string;
}>;
export declare const WALLET_AUTH_VERSION: "1";
export declare const YNX_NATIVE_CHAIN_ID: "ynx_6423-1";
export declare const YNX_EVM_CHAIN_ID: 6423;
export declare const PRODUCT_DEVICE_ALGORITHM: "p256-sha256";
export declare const CENTRAL_REGISTRY_SCHEMA_VERSION: 2;
export declare const CENTRAL_VERIFIER_VERSION: "wallet-auth-v1";
export declare const CENTRAL_REGISTRY_DOCUMENT_VERSION: 2;
export declare const CENTRAL_REGISTRY_PRODUCT_COUNT: 34;
export declare const CENTRAL_PRODUCT_SCHEMA_VERSION: 3;
export declare const CENTRAL_WALLET_SESSION_INVENTORY_SCHEMA_VERSION: 1;
export declare const NATIVE_TRANSACTION_DOMAIN: "YNX_NATIVE_TX_V1";
export declare const NATIVE_TRANSACTION_CHAIN_ID: 6423;
export declare const NATIVE_TRANSACTION_FEE_YNXT: 1;
export declare class WalletAuthError extends Error {
  readonly code: string;
}
export declare function canonicalJSON(value: unknown): string;
export declare function digestHex(domain: string, value: unknown): string;
export declare function parseAuthorizationRequest(
  input: string | unknown,
  options: { now?: Date; registry: Record<string, ProductBinding> },
): AuthorizationRequest;
export declare function requestDigest(request: AuthorizationRequest): string;
export declare function walletIdentity(
  secretHex: string,
): Readonly<{ account: string; accountPublicKey: string }>;
export declare function walletIdentityFromPublicKey(
  publicKeyHex: string,
): string;
export declare function evmAddressFromYNX(account: string): string;
export declare function ynxAddressFromEVM(address: string): string;
export declare function signAuthorization(
  request: AuthorizationRequest,
  input: { accountSecret: string; account?: string; issuedAt: string },
): AuthorizationResponse;
export declare function verifyAuthorization(
  response: unknown,
  expected: AuthorizationRequest & { requestDigest: string; now: Date },
): AuthorizationResponse;
export declare function encodeRequestDeepLink(
  request: AuthorizationRequest,
): string;
export declare function parseWalletDeepLink(
  url: string,
  platform: "android" | "ios",
  options: { now?: Date; registry: Record<string, ProductBinding> },
): Readonly<{ platform: string; request: AuthorizationRequest }>;
export declare function createCallbackURL(
  response: Record<string, unknown> & { callback: string },
): string;
export declare function parseCallbackURL(
  url: string,
  expectedCallback: string,
): unknown;
export type ExchangeOrderParameters = Readonly<{
  market: "YNXT-YUSD_TEST";
  side: "buy" | "sell";
  type: "limit";
  priceMicro: number;
  amountMicro: number;
  idempotencyKey: string;
}>;
export type ExchangeCancelParameters = Readonly<{ orderId: string; idempotencyKey: string }>;
export type ExchangeMarginTransferParameters = Readonly<{ direction: "deposit" | "withdraw"; amountMicro: number; idempotencyKey: string }>;
export type ExchangePerpetualOrderParameters = Readonly<{ market: "YNXT-YUSD_TEST-PERP"; side: "buy" | "sell"; type: "limit"; timeInForce: "gtc" | "ioc" | "fok"; priceMicro: number; amountMicro: number; leverage: number; reduceOnly: boolean; idempotencyKey: string }>;
export type ExchangeActionParameters = ExchangeOrderParameters | ExchangeCancelParameters | ExchangeMarginTransferParameters | ExchangePerpetualOrderParameters;
export type ExchangeActionName = "exchange.order.place" | "exchange.order.cancel" | "exchange.margin.transfer" | "exchange.perpetual.order.place" | "exchange.perpetual.order.cancel";
type ExchangeActionBase = Readonly<{
  version: "1";
  chainId: "ynx_6423-1";
  productClientId: "ynx-exchange-v1";
  bundleId: "com.ynxweb4.exchange";
  callback:
    | "https://exchange.ynxweb4.com/wallet-action/callback"
    | "ynxexchange://wallet-auth/callback";
  sessionBinding: string;
  account: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}>;
export type ExchangeOrderActionRequest = ExchangeActionBase & Readonly<
  | { action: "exchange.order.place"; parameters: ExchangeOrderParameters }
  | { action: "exchange.order.cancel"; parameters: ExchangeCancelParameters }
  | { action: "exchange.margin.transfer"; parameters: ExchangeMarginTransferParameters }
  | { action: "exchange.perpetual.order.place"; parameters: ExchangePerpetualOrderParameters }
  | { action: "exchange.perpetual.order.cancel"; parameters: ExchangeCancelParameters }
>;
export type ExchangeOrderActionResponse = Readonly<
  ExchangeOrderActionRequest & {
    requestDigest: string;
    accountPublicKey: string;
    walletSignature: string;
  }
>;
export declare function parseExchangeOrderActionRequest(
  input: string | unknown,
  at?: Date,
): ExchangeOrderActionRequest;
export declare function exchangeOrderActionRequestDigest(
  input: ExchangeOrderActionRequest,
): string;
export declare function exchangeOrderAuthorizationPayload(
  account: string,
  parameters: ExchangeOrderParameters,
): string;
export declare function exchangeActionAuthorizationPayload(
  account: string,
  action: ExchangeActionName,
  parameters: ExchangeActionParameters,
): string;
export declare function signExchangeOrderAction(
  request: ExchangeOrderActionRequest,
  input: { accountSecret: string; account: string; issuedAt: string },
): ExchangeOrderActionResponse;
export declare function verifyExchangeOrderActionResponse(
  input: unknown,
  expected: ExchangeOrderActionRequest,
  at?: Date,
): ExchangeOrderActionResponse;
export declare function encodeExchangeOrderActionDeepLink(
  request: ExchangeOrderActionRequest,
): string;
export declare function parseExchangeOrderActionDeepLink(
  url: string,
  at?: Date,
): ExchangeOrderActionRequest;
export type QuantMandateActionParameters = Readonly<Record<string, string | number | boolean> & { Account:string; StrategyHash:string; Market:"YNXT-YUSD_TEST"; ExpiresAt:string; TestnetOnly:true }>;
export type QuantOrderActionParameters = Readonly<{Account:string;Market:"YNXT-YUSD_TEST";Side:"buy"|"sell";Price:number;Amount:number;IdempotencyKey:string}>;
export type QuantActionRequest = Readonly<{version:"1";chainId:"ynx_6423-1";productClientId:"ynx-quant-v1";bundleId:"com.ynxweb4.quant";callback:"https://quant.ynxweb4.com/wallet-action/callback";sessionBinding:string;account:string;action:"quant.mandate.activate"|"quant.order.place";parameters:QuantMandateActionParameters|QuantOrderActionParameters;nonce:string;issuedAt:string;expiresAt:string}>;
export type QuantActionResponse = QuantActionRequest & Readonly<{requestDigest:string;accountPublicKey:string;walletSignature:string}>;
export declare function parseQuantActionRequest(input:string|unknown,at?:Date):QuantActionRequest;
export declare function quantActionRequestDigest(input:QuantActionRequest):string;
export declare function quantActionAuthorizationPayload(action:QuantActionRequest["action"],parameters:QuantActionRequest["parameters"]):string;
export declare function signQuantAction(request:QuantActionRequest,input:{accountSecret:string;account:string;issuedAt:string}):QuantActionResponse;
export declare function verifyQuantActionResponse(input:unknown,expected:QuantActionRequest,at?:Date):QuantActionResponse;
export declare function encodeQuantActionDeepLink(request:QuantActionRequest):string;
export declare function parseQuantActionDeepLink(url:string,at?:Date):QuantActionRequest;
export declare class OneTimeNonceStore {
  constructor(records?: readonly [string, string][]);
  consume(request: AuthorizationRequest, at?: Date): void;
  snapshot(): readonly [string, string][];
}
export declare function createGatewayChallenge(
  approval: AuthorizationResponse,
  input: { challenge: string; expiresAt: string },
  at?: Date,
): GatewayChallenge;
export declare function parseGatewayChallenge(input: unknown): GatewayChallenge;
export declare function gatewayChallengeSignBytes(
  challenge: GatewayChallenge,
): string;
export declare function signGatewayChallenge(
  challenge: GatewayChallenge,
  productDeviceSecret: string,
): GatewayCompletion;
export declare function verifyGatewayCompletion(
  completion: GatewayCompletion,
  expected: AuthorizationResponse,
  at?: Date,
): Readonly<{
  sessionBinding: string;
  productClientId: string;
  bundleId: string;
  productDeviceAlgorithm: ProductDeviceAlgorithm;
  account: string;
  scopes: readonly string[];
  expiresAt: string;
}>;
export declare function migrateCentralRegistryEntry(
  input: CentralRegistryEntryV1 | CentralRegistryEntry,
): CentralRegistryEntry;
export declare function parseCentralRegistryEntry(
  input: unknown,
): CentralRegistryEntry;
export declare function registryParserBinding(
  input: CentralRegistryEntry,
): Readonly<Record<string, ProductBinding>>;
export declare function verifyCentralWalletSession(
  input: Readonly<{
    registryEntry: CentralRegistryEntry;
    authorizationRequest: AuthorizationRequest;
    walletApproval: AuthorizationResponse;
    gatewayCompletion: GatewayCompletion;
  }>,
  at?: Date,
): CentralWalletSession;
export declare function parseCentralWalletSession(
  input: unknown,
): CentralWalletSession;
export declare function centralApprovalDigest(
  approval: AuthorizationResponse,
): string;
export declare function centralDeviceBinding(
  requestOrSession: Pick<
    CentralWalletSession,
    | "chainId"
    | "requestingProduct"
    | "productClientId"
    | "bundleId"
    | "callback"
    | "productDeviceAlgorithm"
    | "productDeviceKey"
  >,
  account: string,
): string;
export declare function assertCentralWalletSessionActive(
  session: CentralWalletSession,
  input: CentralRevocationState,
  at?: Date,
): CentralWalletSession;
export declare function parseCentralRegistryDocument(
  input: unknown,
): CentralRegistryDocument;
export declare function migrateCentralRegistryDocumentV1(
  input: unknown,
): CentralRegistryDocument;
export declare function parseCentralProductRegistration(
  input: unknown,
): CentralProductRegistration;
export declare function centralProtocolEntry(
  registration: CentralProductRegistration,
  options?: { requireEnabled?: boolean },
): CentralRegistryEntry;
export declare function centralRegistrationByProduct(
  document: CentralRegistryDocument,
  productId: string,
  options?: { requireEnabled?: boolean },
): CentralProductRegistration;
export declare class CentralWalletSessionStore {
  constructor(snapshot?: CentralWalletStoreSnapshot);
  complete(
    input: Readonly<{
      registryEntry: CentralRegistryEntry;
      authorizationRequest: AuthorizationRequest;
      walletApproval: AuthorizationResponse;
      gatewayCompletion: GatewayCompletion;
    }>,
    at?: Date,
  ): CentralWalletSession;
  introspect(
    sessionBinding: string,
    context: Readonly<{
      productClientId: string;
      bundleId: string;
      productDeviceKey: string;
      requiredScopes: readonly string[];
    }>,
    at?: Date,
  ): Readonly<{ active: true; session: CentralWalletSession }>;
  inventory(account: string, at?: Date): CentralWalletSessionInventory;
  revokeSession(sessionBinding: string, at?: Date): string;
  revokeApproval(approvalDigest: string, at?: Date): string;
  revokeDevice(deviceBinding: string, at?: Date): string;
  logoutAllDevices(
    account: string,
    at?: Date,
  ): Readonly<{ account: string; before: string }>;
  revocationState(): CentralRevocationState;
  snapshot(): CentralWalletStoreSnapshot;
}
export declare function parseCentralWalletStoreSnapshot(
  input: unknown,
): CentralWalletStoreSnapshot;
export declare function createSignedNativeTransfer(
  input: Readonly<{
    accountSecret: string;
    to: string;
    amount: number;
    nonce: number;
  }>,
): Readonly<{
  transaction: SignedNativeTransfer;
  payload: string;
  hash: string;
}>;
export declare function parseSignedNativeTransfer(
  input: string | unknown,
): SignedNativeTransfer;
export declare function nativeTransferSignJSON(
  transaction: Omit<SignedNativeTransfer, "signature"> | SignedNativeTransfer,
): string;
export declare function nativeTransferHash(payload: string): string;
export type SmartAccountCall = Readonly<{
  target: string;
  selector: string;
  value: number;
  dataDigest: string;
}>;
export type UserOperationEnvelope = Readonly<{
  schemaVersion: 1;
  chainId: 6423;
  entryPoint: string;
  sender: string;
  nonceKey: string;
  nonceSequence: number;
  calls: readonly SmartAccountCall[];
  callGasLimit: number;
  verificationGasLimit: number;
  preVerificationGas: number;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
  validAfter: string;
  validUntil: string;
}>;
export type SponsorshipPolicy = Readonly<{
  schemaVersion: 1;
  policyId: string;
  enabled: boolean;
  sponsorType: "first-action" | "product" | "merchant" | "developer-testnet";
  productClientId: string;
  paymaster: string;
  entryPoint: string;
  allowedTargets: readonly string[];
  allowedSelectors: readonly string[];
  maxCalls: number;
  maxCostPerOperation: number;
  maxCostPerSubjectDay: number;
  maxCostPerSponsorDay: number;
  requiresFirstAction: boolean;
  validAfter: string;
  validUntil: string;
  provider: string;
  fees: string;
  risk: string;
  revocation: string;
  source: string;
  asOf: string;
  version: string;
}>;
export type SponsorshipRequest = Readonly<{
  schemaVersion: 1;
  policyId: string;
  sponsorType: SponsorshipPolicy["sponsorType"];
  productClientId: string;
  sessionBinding: string;
  account: string;
  userOperationDigest: string;
  antiSybilBinding: string;
  requestedCost: number;
  subjectDailyUsed: number;
  sponsorDailyUsed: number;
  firstAction: boolean;
  source: string;
  asOf: string;
  version: string;
}>;
export declare const SMART_ACCOUNT_SCHEMA_VERSION: 1;
export declare const SMART_ACCOUNT_CHAIN_ID: 6423;
export declare function parseUserOperationEnvelope(
  input: unknown,
): UserOperationEnvelope;
export declare function userOperationDigest(input: unknown): string;
export declare function parseSponsorshipPolicy(
  input: unknown,
): SponsorshipPolicy;
export declare function parseSponsorshipRequest(
  input: unknown,
): SponsorshipRequest;
export declare function evaluateSponsorship(
  operation: unknown,
  request: unknown,
  policy: unknown,
  at?: Date,
): Readonly<{
  eligible: boolean;
  reasons: readonly string[];
  policyId: string;
  userOperationDigest: string;
  paymaster: string;
  approvedCost: number;
  remainingSubjectBudget: number;
  remainingSponsorBudget: number;
}>;
export type PackedUserOperation = Readonly<{
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: string;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}>;
export declare const ERC_7769_VERSION: "ERC-7769";
export declare const YNX_TESTNET_CHAIN_QUANTITY: "0x1917";
export declare function parsePackedUserOperation(
  input: unknown,
): PackedUserOperation;
export declare class ERC7769BundlerClient {
  constructor(config: {
    endpoint: string;
    entryPoint: string;
    timeoutMs?: number;
    maxRequestsPerSecond?: number;
    authentication?: { header: "authorization" | "x-api-key"; value: string };
  });
  health(): Promise<Readonly<Record<string, unknown>>>;
  estimateUserOperationGas(
    operation: unknown,
  ): Promise<Readonly<Record<string, unknown>>>;
  sendUserOperation(
    operation: unknown,
  ): Promise<Readonly<Record<string, unknown>>>;
  getUserOperationByHash(
    hash: string,
  ): Promise<Readonly<Record<string, unknown>>>;
  getUserOperationReceipt(
    hash: string,
  ): Promise<Readonly<Record<string, unknown>>>;
}
export declare const STRATEGY_MANDATE_SCHEMA_VERSION: 2;
export declare const STRATEGY_ACTION_SCHEMA_VERSION: 1;
export declare const STRATEGY_MANDATE_STORE_SCHEMA_VERSION: 1;
export declare function parseStrategyMandate(
  input: unknown,
): Readonly<Record<string, unknown>>;
export declare function strategyMandateDigest(input: unknown): string;
export declare function parseStrategyAction(
  input: unknown,
): Readonly<Record<string, unknown>>;
export declare function authorizeStrategyAction(
  mandate: unknown,
  action: unknown,
  at?: Date,
): Readonly<{
  authorized: true;
  mandateId: string;
  mandateDigest: string;
  actionDigest: string;
  nonceDomain: string;
  nonce: string;
  at: string;
}>;
export declare function strategyActionNonceKey(
  nonceDomain: string,
  nonce: string,
): string;
export declare function parseStrategyMandateStoreSnapshot(
  input: unknown,
): Readonly<Record<string, unknown>>;
export declare class StrategyMandateStore {
  constructor(snapshot?: unknown);
  activate(mandate: unknown, at?: Date): Readonly<Record<string, unknown>>;
  authorize(
    mandateId: string,
    action: unknown,
    at?: Date,
  ): Readonly<{
    authorized: true;
    mandateId: string;
    mandateDigest: string;
    actionDigest: string;
    nonceDomain: string;
    nonce: string;
    at: string;
  }>;
  revoke(mandateId: string, at?: Date): string;
  kill(mandateId: string, at?: Date): string;
  emergencyExit(
    mandateId: string,
    reason: string,
    at?: Date,
  ): Readonly<{ mandateDigest: string; at: string; reason: string }>;
  inventory(
    account: string,
    at?: Date,
  ): readonly Readonly<{
    mandate: Readonly<Record<string, unknown>>;
    mandateDigest: string;
    status: "active" | "expired" | "revoked" | "killed" | "emergency-exit";
  }>[];
  snapshot(): Readonly<Record<string, unknown>>;
}
export declare function parseCapitalProductReview(
  input: unknown,
): Readonly<Record<string, unknown>>;
export declare function parseCredentialCandidate(
  input: unknown,
  at?: Date,
): Readonly<Record<string, unknown>>;
export declare function credentialCandidateDigest(
  input: unknown,
  at?: Date,
): string;
export declare function createSignedIntent(
  input: Readonly<Record<string, unknown> & { accountSecret: string }>,
): Readonly<Record<string, unknown>>;
export declare function parseSignedIntent(
  input: unknown,
): Readonly<Record<string, unknown>>;
export declare function signedIntentDigest(input: unknown): string;
export declare function exportSignedIntent(input: unknown): string;
export declare function assertSignedIntentActive(
  input: unknown,
  context: Readonly<Record<string, unknown>>,
  at?: Date,
): Readonly<Record<string, unknown>>;
export declare function createDeveloperDeploymentDeepLink(
  input: unknown,
  at?: Date,
): string;
export declare function parseDeveloperDeploymentDeepLink(
  value: string,
  at?: Date,
): DeveloperDeploymentRequest;
export declare function parseDeveloperDeploymentRequest(
  input: unknown,
  at?: Date,
): DeveloperDeploymentRequest;
export declare function developerDeploymentRequestHash(
  payload: unknown,
): string;
export declare function developerArtifactDigest(payload: unknown): string;
export declare function developerDeploymentDigest(request: unknown): string;
export declare function signDeveloperDeployment(
  request: unknown,
  input: { accountSecret: string; account?: string },
  at?: Date,
): DeveloperDeploymentResponse;
export declare function parseDeveloperDeploymentResponse(
  input: unknown,
  expectedRequest: unknown,
  at?: Date,
): DeveloperDeploymentResponse;
export declare function createDeveloperDeploymentCallback(
  response: unknown,
  expectedRequest: unknown,
  at?: Date,
): string;
export declare function createDexActionDeepLink(
  input: unknown,
  at?: Date,
): string;
export declare function parseDexActionDeepLink(
  value: string,
  at?: Date,
): DexActionRequest;
export declare function parseDexActionRequest(
  input: unknown,
  at?: Date,
): DexActionRequest;
export declare function dexActionRequestDigest(input: DexActionRequest): string;
export declare function signDexAction(
  request: unknown,
  input: { accountSecret: string; account?: string },
  at?: Date,
): DexActionResponse;
export declare function parseDexActionResponse(
  input: unknown,
  expectedRequest: unknown,
  at?: Date,
): DexActionResponse;
export declare function createDexActionCallback(
  response: unknown,
  expectedRequest: unknown,
  at?: Date,
): string;
export declare function createProductSessionProof(
  session: CentralWalletSession,
  input: Readonly<{
    method: string;
    path: string;
    bodyDigest: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
  }>,
  productDeviceSecret: string,
): Readonly<Record<string, unknown>>;
export declare function createProductDeviceIdentity(
  secretInput?: string,
): Readonly<{ productDeviceSecret: string; productDeviceKey: string }>;
export declare function encodeProductSessionProofHeader(
  proofInput: unknown,
): string;
export declare function parseProductSessionProof(
  input: unknown,
): Readonly<Record<string, unknown>>;
export declare function productSessionProofSignBytes(input: unknown): string;
export declare function productSessionProofDigest(input: unknown): string;
export declare function httpBodyDigest(body: string | Uint8Array): string;
export declare function verifyProductSessionProof(
  proof: unknown,
  session: CentralWalletSession,
  expected: Readonly<{ method: string; path: string; bodyDigest: string }>,
  at?: Date,
): Readonly<Record<string, unknown>>;
export declare const CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION: 2;
export declare class CanonicalWalletGatewayAdapter {
  constructor(registry: unknown, snapshot?: unknown);
  complete(
    input: Readonly<Record<string, unknown>>,
    at?: Date,
  ): CentralWalletSession;
  introspect(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): Readonly<{ active: true; session: CentralWalletSession }>;
  sessionInventory(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): CentralWalletSessionInventory;
  revokeSession(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): string;
  revokeApproval(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): string;
  revokeDevice(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): string;
  logoutAllDevices(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): Readonly<{ account: string; before: string }>;
  activateMandate(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): Readonly<Record<string, unknown>>;
  authorizeMandateAction(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): Readonly<Record<string, unknown>>;
  mandateInventory(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): readonly Readonly<Record<string, unknown>>[];
  revokeMandate(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): string;
  killMandate(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): string;
  emergencyExitMandate(
    input: Readonly<Record<string, unknown>>,
    request: Readonly<Record<string, unknown>>,
    at?: Date,
  ): Readonly<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>>;
}
export declare function parseGatewayAdapterSnapshot(
  input: unknown,
  registryVersion: number,
): Readonly<Record<string, unknown>>;
export declare const CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION: 1;
export declare const CANONICAL_GATEWAY_HTTP_MAX_BODY_BYTES: 1048576;
export type CanonicalGatewayHttpInput = Readonly<{
  method: string;
  path: string;
  contentType: string;
  body: string;
  proof: Readonly<Record<string, unknown>> | null;
}>;
export type CanonicalGatewayHttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
  mutated: boolean;
}>;
export declare class CanonicalWalletGatewayHttpKernel {
  constructor(registry: unknown, snapshot?: unknown);
  dispatch(
    input: CanonicalGatewayHttpInput,
    at?: Date,
  ): CanonicalGatewayHttpResponse;
  snapshot(): Readonly<Record<string, unknown>>;
}
export declare function gatewayStateDigest(snapshot: unknown): string;
export declare const STANDARD_WALLET_CHAIN_ID: "0x1917";
export declare const STANDARD_WALLET_CONNECT_STATUS: Readonly<{IDLE:"idle";DISCOVERING:"discovering";AWAITING_ACCOUNT:"awaiting-account";SWITCHING_CHAIN:"switching-chain";CONNECTED:"connected";WRONG_CHAIN:"wrong-chain";DISCONNECTED:"disconnected";FAILED:"failed"}>;
export declare const STANDARD_WALLET_PRIVATE_SERVICE: Readonly<{NOT_REQUESTED:"not-requested";CONNECTING:"connecting";READY:"ready";DEGRADED:"degraded"}>;
export declare const STANDARD_WALLET_RPC_PROBE: Readonly<{NOT_RUN:"not-run";READY:"ready";DEGRADED:"degraded"}>;
export declare const STANDARD_WALLET_RPC_PROBE_TRANSPORT: "accepted-cors-safe";
export type StandardWalletConnectState = Readonly<Record<string, unknown>>;
export declare function createStandardWalletConnectState(): StandardWalletConnectState;
export declare function reduceStandardWalletConnectState(current: StandardWalletConnectState, event: Readonly<Record<string, unknown>>): StandardWalletConnectState;

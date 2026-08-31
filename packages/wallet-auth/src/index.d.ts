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
export type AuthorizationRejection = Readonly<{
  version: "1";
  decision: "rejected";
  requestDigest: string;
  nonce: string;
  chainId: "ynx_6423-1";
  requestingProduct: string;
  productClientId: string;
  bundleId: string;
  callback: string;
  decisionCode: "USER_REJECTED";
  rejectedAt: string;
  authorityGranted: false;
  grantedScopes: readonly [];
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
export declare const CENTRAL_REGISTRY_PRODUCT_COUNT: 35;
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
export declare function createAuthorizationRejection(
  request: AuthorizationRequest,
  input: { decisionCode: "USER_REJECTED"; rejectedAt: string },
): AuthorizationRejection;
export declare function parseAuthorizationRejection(input: string | unknown): AuthorizationRejection;
export declare function verifyAuthorizationRejection(
  input: string | unknown,
  request: AuthorizationRequest,
  at?: Date,
): AuthorizationRejection;
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
export declare const WALLET_AUTHORIZE_ROUTE: "ynxwallet://authorize";
export declare const WALLET_AUTHORIZE_REQUEST_PARAMETER: "request";
export declare const WALLET_CALLBACK_RESPONSE_PARAMETER: "response";
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
export declare function parseAuthorizationCallbackURL(
  url: string,
  request: AuthorizationRequest,
  at?: Date,
): AuthorizationResponse | AuthorizationRejection;
export declare const OFFICIAL_YNX_WALLET_DOWNLOAD_URL: "https://www.ynxweb4.com/dapp/download";
export declare const STANDARD_METAMASK_DOWNLOAD_URL: "https://metamask.io/download/";
export declare const AUTHORIZATION_LAUNCH_PLATFORM_MATRIX: Readonly<Record<"android" | "ios" | "macos" | "windows" | "web" | "extension", Readonly<{ strategy: "native-resolver" | "standard-provider-discovery"; requiresPreflight: true }>>>;
export type AuthorizationLaunchStatus = "installed" | "provider-ready" | "unsupported";
export type AuthorizationLaunchResult = Readonly<{ status: AuthorizationLaunchStatus; detail: string; transport: "native-custom-scheme" | "eip-1193" | null; uri: string | null; providerCandidate: WalletProviderCandidate | null; fallbackActions: readonly Readonly<{ id: "official-ynx-wallet-download" | "standard-metamask"; label: string; url: string }>[] }>;
export declare function createCanonicalAuthorizeLaunch(request: AuthorizationRequest): Readonly<{ uri: string; fallbackActions: AuthorizationLaunchResult["fallbackActions"] }>;
export declare function launchWebAuthorization(request: AuthorizationRequest, options?: { scope?: unknown; waitMs?: number }): Promise<AuthorizationLaunchResult>;
export declare function launchNativeAuthorization(request: AuthorizationRequest, platform: "android" | "ios" | "macos" | "windows", resolver?: ((uri: string) => boolean | Promise<boolean>)): Promise<AuthorizationLaunchResult>;
export declare function launchCanonicalAuthorization(request: AuthorizationRequest, options: { platform: "android" | "ios" | "macos" | "windows" | "web" | "extension"; resolver?: ((uri: string) => boolean | Promise<boolean>); scope?: unknown; waitMs?: number }): Promise<AuthorizationLaunchResult>;
export declare const STANDARD_WALLET_CHAIN_ID: "0x1917";
export declare const STANDARD_WALLET_CONNECT_STATUS: Readonly<{ IDLE: "idle"; DISCOVERING: "discovering"; AWAITING_ACCOUNT: "awaiting-account"; SWITCHING_CHAIN: "switching-chain"; CONNECTED: "connected"; WRONG_CHAIN: "wrong-chain"; DISCONNECTED: "disconnected"; FAILED: "failed" }>;
export declare const STANDARD_WALLET_PRIVATE_SERVICE: Readonly<{ NOT_REQUESTED: "not-requested"; CONNECTING: "connecting"; READY: "ready"; DEGRADED: "degraded" }>;
export declare const STANDARD_WALLET_RPC_PROBE: Readonly<{ NOT_RUN: "not-run"; READY: "ready"; DEGRADED: "degraded" }>;
export declare const STANDARD_WALLET_RPC_PROBE_TRANSPORT: "accepted-cors-safe";
export declare function createStandardWalletConnectState(): Readonly<Record<string, unknown>>;
export declare function reduceStandardWalletConnectState(current: Readonly<Record<string, unknown>>, event: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
export declare const STANDARD_WALLET_PROVIDER_EVENTS: readonly ["connect", "disconnect", "accountsChanged", "chainChanged", "message"];
export declare class StandardWalletProviderEventModel { on(name: string, listener: (payload: unknown) => void): this; once(name: string, listener: (payload: unknown) => void): this; removeListener(name: string, listener: (payload: unknown) => void): this; listenerCount(name: string): number; emit(name: string, payload: unknown): void; }
export declare function normalizeStandardWalletAddress(value: unknown): string;
export declare function normalizeStandardWalletChainId(value: unknown): string;
export declare const STANDARD_WALLET_PERMISSION: Readonly<{ ACCOUNTS: "eth_accounts" }>;
export declare class StandardWalletProviderError extends Error { readonly code: number; readonly data: unknown; constructor(code: number, message: string, data?: unknown); }
export declare function providerError(code: number, message: string, data?: unknown): StandardWalletProviderError;
export declare function canonicalWalletOrigin(value: unknown): string;
export declare const STANDARD_WALLET_PERMISSION_SNAPSHOT_VERSION: 1;
export type StandardWalletPermissionSnapshot = Readonly<{ schemaVersion: 1; origin: string; chainId: "0x1917"; accounts: readonly string[] }>;
export interface StandardWalletPermissionStorage { load(input: Readonly<{ origin: string }>): string | StandardWalletPermissionSnapshot | null | undefined | Promise<string | StandardWalletPermissionSnapshot | null | undefined>; save(snapshot: StandardWalletPermissionSnapshot): void | Promise<void>; clear(input: Readonly<{ origin: string }>): void | Promise<void>; }
export declare function createStandardWalletPermissionSnapshot(origin: string, accounts: readonly string[]): StandardWalletPermissionSnapshot;
export declare function parseStandardWalletPermissionSnapshot(input: string | unknown, expectedOrigin: string): StandardWalletPermissionSnapshot;
export declare function serializeStandardWalletPermissionSnapshot(snapshot: StandardWalletPermissionSnapshot): string;
export declare class InMemoryStandardWalletPermissionStorage implements StandardWalletPermissionStorage { load(input: Readonly<{ origin: string }>): Promise<string | null>; save(snapshot: StandardWalletPermissionSnapshot): Promise<void>; clear(input: Readonly<{ origin: string }>): Promise<void>; }
export declare function validateStandardWalletPermissionStorage(value: unknown): StandardWalletPermissionStorage | null;
export declare function createStandardWalletPermissionStorageAdapter(config: Readonly<{ namespace?: string; getItem(key: string): string | null | undefined | Promise<string | null | undefined>; setItem(key: string, value: string): void | Promise<void>; removeItem(key: string): void | Promise<void> }>): StandardWalletPermissionStorage;
export declare class StandardWalletPermissionController { constructor(config: { origin: string; walletAccounts: readonly string[]; approveAccounts: (input: Readonly<{ origin: string; accounts: readonly string[] }>) => readonly string[] | Promise<readonly string[]>; storage?: StandardWalletPermissionStorage | null }); readonly origin: string; readonly accounts: readonly string[]; permissions(): readonly Readonly<Record<string, unknown>>[]; requestAccounts(): Promise<readonly string[]>; requestPermissions(input: unknown): Promise<readonly Readonly<Record<string, unknown>>[]>; revokePermissions(input: unknown): Promise<null>; requireAccount(value: unknown): string; replaceWalletAccounts(accounts: readonly string[]): readonly string[]; revoke(): readonly string[]; restore(): Promise<readonly string[]>; replaceWalletAccountsPersisted(accounts: readonly string[]): Promise<readonly string[]>; revokePersisted(): Promise<readonly string[]>; }
export declare const STANDARD_WALLET_NETWORK: Readonly<{ nativeChainId: "ynx_6423-1"; evmChainId: 6423; chainId: "0x1917"; nativeCurrency: Readonly<{ name: "YNX Testnet"; symbol: "YNXT"; decimals: 18 }> }>;
export declare const STANDARD_WALLET_CHAIN_METADATA: Readonly<{ chainId: "0x1917"; chainName: "YNX Testnet"; nativeCurrency: Readonly<{ name: "YNX Testnet"; symbol: "YNXT"; decimals: 18 }>; rpcUrls: readonly ["https://evm.ynxweb4.com"]; blockExplorerUrls: readonly ["https://explorer.ynxweb4.com"] }>;
export declare const STANDARD_WALLET_READ_METHODS: readonly string[];
export declare class StandardWalletJsonRpcRouter { constructor(config: Readonly<Record<string, unknown>>); request(input: Readonly<{ method: string; params?: unknown }>): Promise<unknown>; }
export declare const STANDARD_WALLET_PROVIDER_AUTHORITY: "standard-wallet-eip1193";
export declare class StandardWalletProviderEngine { constructor(config: Readonly<{ origin: string; walletAccounts: readonly string[]; approveAccounts: (input: Readonly<{ origin: string; accounts: readonly string[] }>) => readonly string[] | Promise<readonly string[]>; permissionStorage?: StandardWalletPermissionStorage | null; rpcTransport?: (request: Readonly<{ method: string; params: unknown }>, network: typeof STANDARD_WALLET_NETWORK) => unknown | Promise<unknown>; signMessage?: (input: Readonly<Record<string, unknown>>) => string | Promise<string>; signTypedData?: (input: Readonly<Record<string, unknown>>) => string | Promise<string>; sendTransaction?: (input: Readonly<Record<string, unknown>>) => string | Promise<string> }>); readonly isYNXWallet: true; readonly isMetaMask: false; readonly providerInfo: Readonly<{ name: "YNX Wallet"; rdns: "com.ynx.wallet"; icon: string }>; readonly chainId: "0x1917"; readonly selectedAddress: string | null; readonly authority: "standard-wallet-eip1193"; readonly state: Readonly<Record<string, unknown>>; on(name: string, listener: (payload: unknown) => void): this; once(name: string, listener: (payload: unknown) => void): this; removeListener(name: string, listener: (payload: unknown) => void): this; request(input: Readonly<{ method: string; params?: unknown }>): Promise<unknown>; restorePermissions(): Promise<Readonly<Record<string, unknown>>>; replaceWalletAccounts(accounts: readonly string[]): Promise<Readonly<Record<string, unknown>>>; setRpcStatus(status: "ready" | "degraded"): Readonly<Record<string, unknown>>; setPrivateServiceStatus(status: "not-requested" | "connecting" | "ready" | "degraded"): Readonly<Record<string, unknown>>; notifyChainChanged(chainId: string): Promise<Readonly<Record<string, unknown>>>; disconnect(): Promise<Readonly<Record<string, unknown>>>; }
export declare function standardWalletEip6963Announcement(provider: StandardWalletProviderEngine, uuid: string): Readonly<{ info: Readonly<{ uuid: string; name: "YNX Wallet"; icon: string; rdns: "com.ynx.wallet" }>; provider: StandardWalletProviderEngine }>;
export declare const STANDARD_WALLET_WALLETCONNECT_CHAIN: "eip155:6423";
export declare const STANDARD_WALLET_WALLETCONNECT_METHODS: readonly string[];
export declare const STANDARD_WALLET_WALLETCONNECT_EVENTS: readonly string[];
export declare const STANDARD_WALLET_WALLETCONNECT_SESSION_VERSION: 1;
export type StandardWalletWalletConnectSessionSnapshot = Readonly<{ schemaVersion: 1; topic: string; chainId: "eip155:6423"; methods: readonly string[]; events: readonly string[]; accounts: readonly string[] }>;
export interface StandardWalletWalletConnectSessionStorage { load(input: Readonly<{ topic: string }>): string | StandardWalletWalletConnectSessionSnapshot | null | undefined | Promise<string | StandardWalletWalletConnectSessionSnapshot | null | undefined>; save(snapshot: StandardWalletWalletConnectSessionSnapshot): void | Promise<void>; clear(input: Readonly<{ topic: string }>): void | Promise<void>; }
export declare function createStandardWalletWalletConnectSessionSnapshot(input: Readonly<{ topic: string; methods: readonly string[]; events: readonly string[]; accounts: readonly string[] }>): StandardWalletWalletConnectSessionSnapshot;
export declare function parseStandardWalletWalletConnectSessionSnapshot(input: string | unknown, expectedTopic: string): StandardWalletWalletConnectSessionSnapshot;
export declare function serializeStandardWalletWalletConnectSessionSnapshot(snapshot: StandardWalletWalletConnectSessionSnapshot): string;
export declare class InMemoryStandardWalletWalletConnectSessionStorage implements StandardWalletWalletConnectSessionStorage { load(input: Readonly<{ topic: string }>): Promise<string | null>; save(snapshot: StandardWalletWalletConnectSessionSnapshot): Promise<void>; clear(input: Readonly<{ topic: string }>): Promise<void>; }
export declare function validateStandardWalletWalletConnectSessionStorage(value: unknown): StandardWalletWalletConnectSessionStorage | null;
export declare function createStandardWalletWalletConnectSessionStorageAdapter(config: Readonly<{ namespace?: string; getItem(key: string): string | null | undefined | Promise<string | null | undefined>; setItem(key: string, value: string): void | Promise<void>; removeItem(key: string): void | Promise<void> }>): StandardWalletWalletConnectSessionStorage;
export declare function walletConnectTopic(value: unknown): string;
export declare class StandardWalletWalletConnectSessionAdapter { constructor(config: Readonly<{ engine: StandardWalletProviderEngine; topic: string; sessionStorage?: StandardWalletWalletConnectSessionStorage | null; emit?: (event: Readonly<{ topic: string; chainId: "eip155:6423"; event: string; payload: unknown }>) => void }>); readonly active: boolean; readonly topic: string; restore(): Promise<Readonly<Record<string, unknown>> | null>; approve(proposal: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>; reject(proposal: Readonly<Record<string, unknown>>): Promise<Readonly<{ topic: string; rejected: true; code: 4001; authority: "walletconnect-proposal-rejected-no-authority" }>>; request(envelope: Readonly<Record<string, unknown>>): Promise<unknown>; disconnect(): Promise<Readonly<{ topic: string; active: false; authority: "walletconnect-session-terminated" }>>; close(): Readonly<{ closed: boolean }>; }
export declare const STANDARD_WALLET_WALLETCONNECT_READINESS_VERSION: "standard-wallet-walletconnect-runtime-readiness-v1";
export type StandardWalletWalletConnectRuntimeReadiness = Readonly<{ version: typeof STANDARD_WALLET_WALLETCONNECT_READINESS_VERSION; ready: boolean; authorityCreated: false; callbacksInvoked: false; capabilities: Readonly<{ permissionStorage: boolean; sessionStorage: boolean; relayEventSink: boolean; rpcTransport: boolean; accountApproval: boolean; personalSignConfirmation: boolean; typedDataConfirmation: boolean; transactionConfirmation: boolean }> }>;
export declare function preflightStandardWalletWalletConnectRuntime(config: Readonly<Record<string, unknown>>): StandardWalletWalletConnectRuntimeReadiness;
export interface StandardWalletWalletConnectRuntime { readonly readiness: StandardWalletWalletConnectRuntimeReadiness; readonly engine: StandardWalletProviderEngine; readonly adapter: StandardWalletWalletConnectSessionAdapter; start(): Promise<boolean>; approve(proposal: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>; reject(proposal: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>; request(envelope: Readonly<Record<string, unknown>>): Promise<unknown>; disconnect(): Promise<Readonly<Record<string, unknown>>>; close(): Readonly<{ closed: boolean }>; }
export declare function createStandardWalletWalletConnectRuntime(config: Readonly<{ topic: string; walletAccounts: readonly string[]; approveAccounts: (input: Readonly<{ origin: string; accounts: readonly string[] }>) => readonly string[] | Promise<readonly string[]>; permissionStorage?: StandardWalletPermissionStorage | null; sessionStorage?: StandardWalletWalletConnectSessionStorage | null; emit?: (event: Readonly<Record<string, unknown>>) => void; rpcTransport?: (request: Readonly<Record<string, unknown>>, network: typeof STANDARD_WALLET_NETWORK) => unknown | Promise<unknown>; signMessage?: (input: Readonly<Record<string, unknown>>) => string | Promise<string>; signTypedData?: (input: Readonly<Record<string, unknown>>) => string | Promise<string>; sendTransaction?: (input: Readonly<Record<string, unknown>>) => string | Promise<string> }>): StandardWalletWalletConnectRuntime;
export declare const STANDARD_WALLET_RUNTIME_VERSION: "1.1.0-p0.0";
export declare const STANDARD_WALLET_RUNTIME_PLATFORMS: readonly ["web", "android", "ios", "macos", "desktop"];
export interface StandardWalletPlatformRuntime { readonly platform: "web" | "android" | "ios" | "macos" | "desktop"; readonly provider: StandardWalletProviderEngine; readonly state: Readonly<Record<string, unknown>>; start(): Promise<Readonly<Record<string, unknown>>>; request(input: Readonly<{ method: string; params?: unknown }>): Promise<unknown>; replaceWalletAccounts(accounts: readonly string[]): Promise<Readonly<Record<string, unknown>>>; notifyChainChanged(chainId: string): Promise<Readonly<Record<string, unknown>>>; disconnect(): Promise<Readonly<Record<string, unknown>>>; setRpcStatus(status: "ready" | "degraded"): Readonly<Record<string, unknown>>; setPrivateServiceStatus(status: "not-requested" | "connecting" | "ready" | "degraded"): Readonly<Record<string, unknown>>; stop(): Readonly<Record<string, unknown>>; }
export declare function createStandardWalletPlatformRuntime(config: Readonly<Record<string, unknown>>): StandardWalletPlatformRuntime;
export declare function markStandardWalletPrivateServiceDegraded(runtime: StandardWalletPlatformRuntime): Readonly<Record<string, unknown>>;
export interface StandardWalletWebInstallation { readonly runtime: StandardWalletPlatformRuntime; readonly provider: StandardWalletProviderEngine; readonly announcement: Readonly<Record<string, unknown>>; readonly legacyInstalled: boolean; announce(): boolean; uninstall(): Readonly<{ uninstalled: boolean }>; }
export declare function installStandardWalletWebRuntime(config: Readonly<Record<string, unknown>>): Promise<StandardWalletWebInstallation>;
export declare const STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS: Readonly<{ READY: "ready"; PROVIDER_UNAVAILABLE: "provider-unavailable"; PROVIDER_AMBIGUOUS: "provider-ambiguous"; WRONG_NETWORK: "wrong-network" }>;
export declare const STANDARD_WALLET_PUBLIC_HANDSHAKE_AUTHORITY: "discovery-and-chain-readback-only";
export type StandardWalletPublicConsumerHandshakeResult = Readonly<{ schemaVersion: 1; status: "ready" | "provider-unavailable" | "provider-ambiguous" | "wrong-network"; code: string | null; consumerId: string; consumerSourceCommit: string; consumerUrl: string; wallet: "ynx-wallet"; providerAvailable: boolean; identity: Readonly<{ name: "YNX Wallet"; rdns: "com.ynx.wallet"; isYNXWallet: true; isMetaMask: false }>; nativeChainId: "ynx_6423-1"; evmChainId: 6423; chainId: "0x1917"; privateService: "not-requested" | "degraded"; standardWalletPreserved: boolean; productSession: false; account: null; authority: "discovery-and-chain-readback-only"; invokedMethods: readonly string[] }>;
export declare function runStandardWalletPublicConsumerHandshake(config: Readonly<{ scope: unknown; waitMs: number; sourceBinding: Readonly<{ consumerId: string; sourceCommit: string; publicUrl: string }>; privateServiceStatus: "not-requested" | "degraded"; onResult: (result: StandardWalletPublicConsumerHandshakeResult) => void | Promise<void> }>): Promise<StandardWalletPublicConsumerHandshakeResult>;
export interface StandardWalletNativeBridge { readonly platform: "android" | "ios" | "macos" | "desktop"; readonly runtime: StandardWalletPlatformRuntime; start(): Promise<Readonly<Record<string, unknown>>>; handle(message: string | Readonly<Record<string, unknown>>): Promise<string>; stop(): Readonly<{ stopped: true }>; }
export declare function createStandardWalletNativeBridge(config: Readonly<Record<string, unknown>>): StandardWalletNativeBridge;
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
  schemaVersion: 2;
  policyId: string;
  sponsorType: SponsorshipPolicy["sponsorType"];
  productClientId: string;
  sessionBinding: string;
  account: string;
  productDeviceKey: string;
  orderedScopes: readonly string[];
  requestNonce: string;
  expiresAt: string;
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
export type SponsorshipBinding = Readonly<{
  productClientId: string;
  sessionBinding: string;
  account: string;
  productDeviceKey: string;
  orderedScopes: readonly string[];
  antiSybilBinding: string;
}>;
export declare function parseSponsorshipBinding(input: unknown): SponsorshipBinding;
export declare function evaluateSponsorship(
  operation: unknown,
  request: unknown,
  policy: unknown,
  binding: unknown,
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
export declare class SponsorshipAuthorizationLedger {
  constructor(options?: { maximumConsumed?: number });
  readonly size: number;
  authorize(
    operation: unknown,
    request: unknown,
    policy: unknown,
    binding: unknown,
    at?: Date,
  ): ReturnType<typeof evaluateSponsorship>;
}
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
export declare function verifyBundlerUserOperationEvidence(
  operation: unknown,
  userOperationHash: string,
  byHash: unknown,
  receipt: unknown,
  entryPoint: string,
  options?: { requireSuccess: boolean },
): Readonly<{
  actualGasCost: string;
  actualGasUsed: string;
  blockHash: string;
  blockNumber: string;
  entryPoint: string;
  nonce: string;
  paymaster: string | null;
  sender: string;
  success: boolean;
  transactionHash: string;
  userOperationHash: string;
}>;
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
  getVerifiedUserOperationEvidence(
    operation: unknown,
    hash: string,
    options?: { requireSuccess: boolean },
  ): Promise<Readonly<Record<string, unknown>>>;
}
export type PublicERC4337Readiness = Readonly<{
  schemaVersion: 1;
  verification: "wallet-auth-public-erc4337-readiness";
  environment: "public-testnet";
  observedAt: string;
  endpoints: Readonly<{ rpc: string; bundler: string }>;
  entryPoint: string | null;
  expectedRuntimeSha256: string | null;
  observedRuntimeSha256: string | null;
  observedRuntimeBytes: number | null;
  supportedEntryPoints: readonly string[];
  checks: Readonly<Record<string, boolean>>;
  observations: Readonly<Record<string, unknown>>;
  ready: boolean;
  releaseClaims: Readonly<{
    entryPointDeployedPublic: boolean;
    bundlerDeployedPublic: boolean;
    paymasterDeployedPublic: false;
    sponsoredReceiptPublic: false;
  }>;
  secretMaterialRecorded: false;
}>;
export declare function probePublicERC4337Readiness(config: {
  rpcEndpoint: string;
  bundlerEndpoint: string;
  entryPoint?: string;
  expectedRuntimeSha256?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PublicERC4337Readiness>;
export type PublicGatewayIdentifierStage = Readonly<{
  status: number;
  requestIdPresent: boolean;
  requestIdValid: boolean;
  traceIdPresent: boolean;
  traceIdValid: boolean;
  errorIdExpected: boolean;
  errorIdPresent: boolean;
  errorIdValid: boolean;
}>;
export declare function summarizePublicGatewayIdentifierEvidence(input: Record<
  "completion" | "introspection" | "replay" | "revocation" | "postRevocation",
  { status: number; requestId: string | null; traceId: string | null; errorId: string | null }
>): Readonly<{
  stages: Readonly<Record<string, PublicGatewayIdentifierStage>>;
  requestIdCompleteness: boolean;
  traceIdCompleteness: boolean;
  errorIdCompleteness: boolean;
  unexpectedErrorIdAbsent: boolean;
  allRequiredIdentifiersComplete: boolean;
  identifierValuesRecorded: false;
}>;
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
  rejectAuthorization(
    input: Readonly<Record<string, unknown>>,
    at?: Date,
  ): never;
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
export declare function verifyPublicERC4337Deployment(config: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
export declare function createWalletTestnetDeploymentManifest(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
export declare function monitorPublicERC4337Deployment(config: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
export declare function buildPublicERC4337MetadataCandidate(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
export declare function createDeploymentArtifactIntegrity(manifestText: string, sourceCommit: string): Readonly<Record<string, unknown>>;
export declare function verifyDeploymentArtifactIntegrity(manifestText: string, integrityText: string, sourceCommit: string): Readonly<Record<string, unknown>>;
export declare function summarizePublicGatewayMultiUserEvidence(input: unknown): Readonly<{
  environment: "public-testnet";
  intendedUsers: number;
  completed: number;
  distinctAccounts: number;
  introspectedActive: number;
  replayRejected: number;
  crossSessionRejected: boolean;
  revoked: number;
  postRevokeRejected: number;
  cleanupComplete: boolean;
  failures: readonly string[];
  boundedSamplePassed: boolean;
  publicCapacityProven: false;
  multiRegionRecoveryProven: false;
  assetMoved: false;
  userClaimed: false;
  providerClaimed: false;
  secretMaterialRecorded: false;
  identifierValuesRecorded: false;
}>;
/* Merge-base declarations duplicated by the v2 branch are already declared above.
export declare function parseCentralWalletStoreSnapshot(input:unknown):CentralWalletStoreSnapshot;
export declare function createSignedNativeTransfer(input:Readonly<{accountSecret:string;to:string;amount:number;nonce:number}>):Readonly<{transaction:SignedNativeTransfer;payload:string;hash:string}>;
export declare function parseSignedNativeTransfer(input:string|unknown):SignedNativeTransfer;
export declare function nativeTransferSignJSON(transaction:Omit<SignedNativeTransfer,"signature">|SignedNativeTransfer):string;
export declare function nativeTransferHash(payload:string):string;
export type SmartAccountCall=Readonly<{target:string;selector:string;value:number;dataDigest:string}>;
export type UserOperationEnvelope=Readonly<{schemaVersion:1;chainId:6423;entryPoint:string;sender:string;nonceKey:string;nonceSequence:number;calls:readonly SmartAccountCall[];callGasLimit:number;verificationGasLimit:number;preVerificationGas:number;maxFeePerGas:number;maxPriorityFeePerGas:number;validAfter:string;validUntil:string}>;
export type SponsorshipPolicy=Readonly<{schemaVersion:1;policyId:string;enabled:boolean;sponsorType:"first-action"|"product"|"merchant"|"developer-testnet";productClientId:string;paymaster:string;entryPoint:string;allowedTargets:readonly string[];allowedSelectors:readonly string[];maxCalls:number;maxCostPerOperation:number;maxCostPerSubjectDay:number;maxCostPerSponsorDay:number;requiresFirstAction:boolean;validAfter:string;validUntil:string;provider:string;fees:string;risk:string;revocation:string;source:string;asOf:string;version:string}>;
export type SponsorshipRequest=Readonly<{schemaVersion:1;policyId:string;sponsorType:SponsorshipPolicy["sponsorType"];productClientId:string;sessionBinding:string;account:string;userOperationDigest:string;antiSybilBinding:string;requestedCost:number;subjectDailyUsed:number;sponsorDailyUsed:number;firstAction:boolean;source:string;asOf:string;version:string}>;
export declare const SMART_ACCOUNT_SCHEMA_VERSION:1;
export declare const SMART_ACCOUNT_CHAIN_ID:6423;
export declare function parseUserOperationEnvelope(input:unknown):UserOperationEnvelope;
export declare function userOperationDigest(input:unknown):string;
export declare function parseSponsorshipPolicy(input:unknown):SponsorshipPolicy;
export declare function parseSponsorshipRequest(input:unknown):SponsorshipRequest;
export declare function evaluateSponsorship(operation:unknown,request:unknown,policy:unknown,at?:Date):Readonly<{eligible:boolean;reasons:readonly string[];policyId:string;userOperationDigest:string;paymaster:string;approvedCost:number;remainingSubjectBudget:number;remainingSponsorBudget:number}>;
export type PackedUserOperation=Readonly<{sender:string;nonce:string;initCode:string;callData:string;accountGasLimits:string;preVerificationGas:string;gasFees:string;paymasterAndData:string;signature:string}>;
export declare const ERC_7769_VERSION:"ERC-7769";
export declare const YNX_TESTNET_CHAIN_QUANTITY:"0x1917";
export declare function parsePackedUserOperation(input:unknown):PackedUserOperation;
export declare class ERC7769BundlerClient{constructor(config:{endpoint:string;entryPoint:string;timeoutMs?:number;maxRequestsPerSecond?:number;authentication?:{header:"authorization"|"x-api-key";value:string}});health():Promise<Readonly<Record<string,unknown>>>;estimateUserOperationGas(operation:unknown):Promise<Readonly<Record<string,unknown>>>;sendUserOperation(operation:unknown):Promise<Readonly<Record<string,unknown>>>;getUserOperationByHash(hash:string):Promise<Readonly<Record<string,unknown>>>;getUserOperationReceipt(hash:string):Promise<Readonly<Record<string,unknown>>>;}
export declare const STRATEGY_MANDATE_SCHEMA_VERSION:2;
export declare const STRATEGY_ACTION_SCHEMA_VERSION:1;
export declare const STRATEGY_MANDATE_STORE_SCHEMA_VERSION:1;
export declare function parseStrategyMandate(input:unknown):Readonly<Record<string,unknown>>;
export declare function strategyMandateDigest(input:unknown):string;
export declare function parseStrategyAction(input:unknown):Readonly<Record<string,unknown>>;
export declare function authorizeStrategyAction(mandate:unknown,action:unknown,at?:Date):Readonly<{authorized:true;mandateId:string;mandateDigest:string;actionDigest:string;nonceDomain:string;nonce:string;at:string}>;
export declare function strategyActionNonceKey(nonceDomain:string,nonce:string):string;
export declare function parseStrategyMandateStoreSnapshot(input:unknown):Readonly<Record<string,unknown>>;
export declare class StrategyMandateStore{constructor(snapshot?:unknown);activate(mandate:unknown,at?:Date):Readonly<Record<string,unknown>>;authorize(mandateId:string,action:unknown,at?:Date):Readonly<{authorized:true;mandateId:string;mandateDigest:string;actionDigest:string;nonceDomain:string;nonce:string;at:string}>;revoke(mandateId:string,at?:Date):string;kill(mandateId:string,at?:Date):string;emergencyExit(mandateId:string,reason:string,at?:Date):Readonly<{mandateDigest:string;at:string;reason:string}>;inventory(account:string,at?:Date):readonly Readonly<{mandate:Readonly<Record<string,unknown>>;mandateDigest:string;status:"active"|"expired"|"revoked"|"killed"|"emergency-exit"}>[];snapshot():Readonly<Record<string,unknown>>;}
export declare function parseCapitalProductReview(input:unknown):Readonly<Record<string,unknown>>;
export declare function parseCredentialCandidate(input:unknown,at?:Date):Readonly<Record<string,unknown>>;
export declare function credentialCandidateDigest(input:unknown,at?:Date):string;

*/
export type ProductSessionPlatform="android"|"ios"|"macos"|"web"|"windows";
export type ProductSessionV2=Readonly<{version:"2";sessionBinding:string;chainId:"ynx_6423-1";productId:string;clientId:string;platform:ProductSessionPlatform;applicationId:string;bundleId:string|null;packageId:string|null;origin:string;callback:string;account:string;deviceId:string;deviceAlgorithm:"p256-sha256";deviceKey:string;deviceBinding:string;nonce:string;state:string;scopes:readonly string[];requestDigest:string;approvalDigest:string;issuedAt:string;expiresAt:string}>;
export declare const PRODUCT_SESSION_REGISTRY_VERSION:3;
export declare const PRODUCT_SESSION_PROTOCOL_VERSION:"2";
export declare const PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION:2;
export declare const PRODUCT_SESSION_PLATFORMS:readonly ProductSessionPlatform[];
export declare const WALLET_ROUTE_STATUS:Readonly<Record<string,string>>;
export declare const PRODUCT_SESSION_CLIENT_STATE:Readonly<Record<string,string>>;
export declare function parseProductSessionRegistry(input:unknown):Readonly<Record<string,unknown>>;
export declare function migrateProductSessionRegistryV1(input:unknown):Readonly<Record<string,unknown>>;
export declare function migrateProductSessionRegistryV2(input:unknown):Readonly<Record<string,unknown>>;
export declare function productPlatformBinding(registry:unknown,productId:string,platform:ProductSessionPlatform):Readonly<Record<string,unknown>>;
export type ProductPlatformStatus=Readonly<{status:"active";productId:string;clientId:string;displayName:string;platform:ProductSessionPlatform;actions:readonly []}|{status:"retired";code:"CLIENT_RETIRED";productId:string;clientId:string;displayName:string;platform:ProductSessionPlatform;applicationId:string;callback:string;retiredAt:string;lastSupportedVersion:string;replacementUrl:string;actions:readonly ["open-replacement","return-to-product"];authority:"none";productSession:false}>;
export declare function productPlatformStatus(registry:unknown,productId:string,platform:ProductSessionPlatform):ProductPlatformStatus;
export declare function migrateLegacyCallback(registry:unknown,legacyValue:string,context:{productId:string;platform:ProductSessionPlatform}):Readonly<Record<string,unknown>>;
export declare function migrateLegacyProductSessionRequest(registry:unknown,legacy:unknown,context:{productId:string;platform:ProductSessionPlatform;deviceId:string;state:string},at?:Date):Readonly<Record<string,unknown>>;
export declare function createProductSessionRequest(registry:unknown,input:Readonly<{productId:string;platform:ProductSessionPlatform;deviceId:string;deviceKey:string;scopes:readonly string[];purpose:string;nonce:string;state:string}>,at?:Date):Readonly<Record<string,unknown>>;
export declare function parseProductSessionRequest(registry:unknown,input:unknown,at?:Date):Readonly<Record<string,unknown>>;
export declare function productSessionRequestDigest(registry:unknown,request:unknown,at?:Date):string;
export declare function signProductSessionApproval(registry:unknown,request:unknown,input:{accountSecret:string;scopes:readonly string[];expiresAt:string},at?:Date):Readonly<Record<string,unknown>>;
export declare function parseProductSessionApproval(registry:unknown,request:unknown,input:unknown,at?:Date):Readonly<Record<string,unknown>>;
export declare function createProductSessionChallenge(registry:unknown,request:unknown,approval:unknown,input:{challenge:string},at?:Date):Readonly<Record<string,unknown>>;
export declare function parseProductSessionChallenge(input:unknown):Readonly<Record<string,unknown>>;
export declare function signProductSessionChallenge(challenge:unknown,deviceSecret:string):Readonly<Record<string,unknown>>;
export type ProductSessionPlatformSigner=(input:Readonly<{purpose:"challenge"|"http-proof";algorithm:"p256-sha256";deviceKey:string;payload:string}>)=>string|Promise<string>;
export declare function signProductSessionChallengeWith(challenge:unknown,signer:ProductSessionPlatformSigner):Promise<Readonly<Record<string,unknown>>>;
export declare function parseProductSessionChallengeCompletion(challenge:unknown,input:unknown):Readonly<Record<string,unknown>>;
export declare function parseProductSession(input:unknown):ProductSessionV2;
export declare class ProductSessionAuthority{constructor(registry:unknown,snapshot?:unknown);issueChallenge(input:{request:unknown;approval:unknown;challenge:string},at?:Date):Readonly<Record<string,unknown>>;complete(input:{request:unknown;approval:unknown;completion:unknown},at?:Date):ProductSessionV2;introspect(sessionBinding:string,context:Readonly<Record<string,unknown>>,at?:Date):Readonly<{active:true;session:ProductSessionV2}>;revokeSession(sessionBinding:string):string;revokeDevice(deviceBinding:string):string;revokeAccount(account:string,at?:Date):Readonly<{account:string;before:string}>;snapshot():Readonly<Record<string,unknown>>;}
export declare function walletConnectionChoices(registry:unknown,productId:string,availability:{ynxWalletInstalled:boolean;metaMaskAvailable:boolean}):readonly Readonly<Record<string,unknown>>[];
export declare const METAMASK_EVM_CONNECTION_STATUS:Readonly<{CONNECTED:"connected-evm"}>;
export declare const METAMASK_EVM_CHAIN_ID:6423;
export declare const METAMASK_EVM_CHAIN_QUANTITY:"0x1917";
export declare const METAMASK_EVM_CHAIN:Readonly<{chainId:"0x1917";chainName:"YNX Testnet";nativeCurrency:Readonly<{name:"YNX Testnet";symbol:"YNXT";decimals:18}>;rpcUrls:readonly ["https://evm.ynxweb4.com"];blockExplorerUrls:readonly ["https://explorer.ynxweb4.com"]}>;
export type MetaMaskEvmConnection=Readonly<{status:"connected-evm";wallet:"metamask";connectionMode:"evm-only";authority:"eip-1193-provider-only";productId:string;chainId:6423;chainQuantity:"0x1917";address:string;ynxProductSession:false;productSession:null;limitations:readonly string[]}>;
export declare class MetaMaskEvmConnectionAdapter{constructor(config:Readonly<{registry:unknown;productId:string;provider:unknown}>);connect():Promise<MetaMaskEvmConnection>};
export declare const WALLET_PROVIDER_DISCOVERY_AUTHORITY:"unverified-injected-candidate";
export declare const WALLET_PROVIDER_KIND:Readonly<{YNX:"ynx-wallet";METAMASK:"metamask"}>;
export declare const WALLET_PROVIDER_DISCOVERY_STATUS:Readonly<{AVAILABLE:"available";NOT_INJECTED:"provider-not-injected";UNSUPPORTED:"unsupported-injected-provider";AMBIGUOUS:"ambiguous-provider";CONFLICTED:"conflicted-announcement"}>;
export declare const WALLET_PROVIDER_NOT_INJECTED_POSSIBLE_CAUSES:readonly ["extension-locked","site-access-denied","extension-disabled","extension-not-installed"];
export type WalletProviderCandidate=Readonly<{kind:"ynx-wallet"|"metamask";provider:Readonly<{request:(input:Readonly<Record<string,unknown>>)=>Promise<unknown>}>;source:"eip6963"|"legacy-injected";uuid:string|null;rdns:string|null;name:string|null;authority:"unverified-injected-candidate"}>;
export type WalletProviderDiscoveryDiagnostics=Readonly<{readyStateStart:"loading"|"interactive"|"complete"|"unavailable";readyStateEnd:"loading"|"interactive"|"complete"|"unavailable";eip6963RequestDispatches:number;domContentLoadedObserved:boolean;injectedRootObserved:boolean;injectedProvidersArrayObserved:boolean;injectedProviderCount:number;exactExtensionStateObservable:false}>;
export type WalletProviderDiscovery=Readonly<{ynx:WalletProviderCandidate|null;metamask:WalletProviderCandidate|null;candidates:readonly WalletProviderCandidate[];ambiguities:readonly ("ynx-wallet"|"metamask")[];conflictedAnnouncements:number;status:"available"|"provider-not-injected"|"unsupported-injected-provider"|"ambiguous-provider"|"conflicted-announcement";possibleCauses:readonly ("extension-locked"|"site-access-denied"|"extension-disabled"|"extension-not-installed")[];diagnostics:WalletProviderDiscoveryDiagnostics;authority:"unverified-injected-candidate"}>;
export declare function discoverInjectedWalletProviders(scope?:unknown):WalletProviderDiscovery;
export declare function discoverEip6963WalletProviders(scope?:unknown,waitMs?:number):Promise<WalletProviderDiscovery>;
export declare function discoverWalletProviders(scope?:unknown,waitMs?:number):Promise<WalletProviderDiscovery>;
export declare function selectWalletProviderCandidates(input:unknown[],conflictedAnnouncements?:number):WalletProviderDiscovery;
export declare function walletAvailabilityFromDiscovery(discovery:WalletProviderDiscovery):Readonly<{ynxWalletInstalled:boolean;metaMaskAvailable:boolean}>;
export declare function encodeProductSessionWalletURL(registry:unknown,request:unknown,at?:Date):string;
export declare function parseProductSessionWalletURL(registry:unknown,url:string,at?:Date):Readonly<Record<string,unknown>>;
export declare function prepareWalletOpen(registry:unknown,request:unknown,environment:{networkAvailable:boolean;walletInstalled:boolean;schemeRegistered:boolean},at?:Date):Readonly<Record<string,unknown>>;
export declare function createProductSessionReturnURL(registry:unknown,request:unknown,result:Readonly<Record<string,unknown>>,at?:Date):string;
export declare function parseProductSessionReturnURL(registry:unknown,request:unknown,url:string,at?:Date):Readonly<Record<string,unknown>>;
export declare function canonicalReturnTarget(registry:unknown,productId:string,platform:ProductSessionPlatform):Readonly<Record<string,unknown>>;
export declare class RecoverableProductSessionClient{constructor(config:Readonly<Record<string,unknown>>);readonly current:Readonly<Record<string,unknown>>;readonly storageKey:string;readonly connectionBinding:Readonly<{productId:string;platform:ProductSessionPlatform;applicationId:string}>;detectWalletEnvironment():Promise<Readonly<{walletInstalled:boolean;schemeRegistered:boolean}>>;beginDetected(automatic?:boolean):Promise<Readonly<Record<string,unknown>>>;retryDetected():Promise<Readonly<Record<string,unknown>>>;restore(networkAvailable?:boolean):Promise<Readonly<Record<string,unknown>>>;begin(environment:{walletInstalled:boolean;schemeRegistered:boolean},automatic?:boolean):Promise<Readonly<Record<string,unknown>>>;handleReturn(url:string):Promise<Readonly<Record<string,unknown>>>;retry(environment:{walletInstalled:boolean;schemeRegistered:boolean}):Promise<Readonly<Record<string,unknown>>>;connectionChoices(availability:{ynxWalletInstalled:boolean;metaMaskAvailable:boolean}):readonly Readonly<Record<string,unknown>>[];setNetworkAvailable(available:boolean):Readonly<Record<string,unknown>>;enterGuest():Readonly<Record<string,unknown>>;disconnect():Promise<Readonly<Record<string,unknown>>>;}
export declare const WALLET_CONNECTION_COORDINATOR_STATUS:Readonly<{OPTIONS_READY:"options-ready";SESSION_STATE:"session-state";WALLET_OPENED:"wallet-opened";WALLET_OPEN_FAILED:"wallet-open-failed";YNX_WALLET_PREFERRED:"ynx-wallet-preferred";EVM_CONNECTED:"evm-connected";EVM_UNAVAILABLE:"evm-unavailable"}>;
export declare class WalletConnectionCoordinator{constructor(config:Readonly<{registry:unknown;productId:string;sessionClient:RecoverableProductSessionClient;scope:unknown;discoveryWaitMs:number;openWallet:(input:Readonly<{url:string;request:Readonly<Record<string,unknown>>;requestId:string;automatic:boolean;productId:string;platform:ProductSessionPlatform}>)=>Readonly<{opened:true}|{opened:false;code:string}>|Promise<Readonly<{opened:true}|{opened:false;code:string}>>;openTimeoutMs:number}>);readonly current:Readonly<Record<string,unknown>>;readonly storageKey:string;readonly connectionBinding:Readonly<{productId:string;platform:ProductSessionPlatform;applicationId:string}>;options():Promise<Readonly<Record<string,unknown>>>;restore(networkAvailable?:boolean):Promise<Readonly<Record<string,unknown>>>;beginYNX():Promise<Readonly<Record<string,unknown>>>;retryYNX():Promise<Readonly<Record<string,unknown>>>;handleReturn(url:string):Promise<Readonly<Record<string,unknown>>>;connectMetaMask():Promise<Readonly<Record<string,unknown>>>;setNetworkAvailable(available:boolean):Readonly<Record<string,unknown>>;enterGuest():Readonly<Record<string,unknown>>;disconnect():Promise<Readonly<Record<string,unknown>>>;}
export declare function createProductSessionProofV2(session:ProductSessionV2,input:Readonly<{method:string;path:string;bodyDigest:string;nonce:string;issuedAt:string;expiresAt:string}>,deviceSecret:string):Readonly<Record<string,unknown>>;
export declare function createProductSessionProofV2With(session:ProductSessionV2,input:Readonly<{method:string;path:string;bodyDigest:string;nonce:string;issuedAt:string;expiresAt:string}>,signer:ProductSessionPlatformSigner):Promise<Readonly<Record<string,unknown>>>;
export declare function parseProductSessionProofV2(input:unknown):Readonly<Record<string,unknown>>;
export declare function verifyProductSessionProofV2(proof:unknown,session:ProductSessionV2,request:Readonly<{method:string;path:string;bodyDigest:string}>,at?:Date):Readonly<Record<string,unknown>>;
export declare function productSessionProofV2SignBytes(input:unknown):string;
export declare function productSessionProofV2Digest(input:unknown):string;
export declare const PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION:2;
export declare class ProductSessionGatewayKernel{constructor(registry:unknown,tokenFactory:()=>string,snapshot?:unknown);dispatch(input:Readonly<{requestId:string;method:string;path:string;body:Readonly<Record<string,unknown>>;proof:Readonly<Record<string,unknown>>|null;networkAvailable:boolean}>,at?:Date):Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string}>;snapshot():Readonly<Record<string,unknown>>;}
export declare function parseProductSessionGatewaySnapshot(input:unknown):Readonly<Record<string,unknown>>;
export declare function migrateProductSessionGatewaySnapshotV1(input:unknown):Readonly<Record<string,unknown>>;
export declare function productSessionRegistryV2MigrationSource(input:unknown):Readonly<Record<string,unknown>>;
export declare function migrateProductSessionGatewayNodeStateRegistryV2(input:Readonly<{currentRegistry:unknown;previousRegistry:unknown;stateEnvelope:unknown}>):Readonly<{registrySha256:string;schemaVersion:1;snapshot:Readonly<Record<string,unknown>>;snapshotSha256:string}>;
export declare function migrateLegacy6cfProductSessionGatewayNodeState(input:Readonly<{currentRegistryBytes:string;expectedCurrentRegistryFileSha256:string;expectedPreviousRegistryFileSha256:string;expectedSourceStateFileSha256:string;previousRegistryBytes:string;stateBytes:string}>):Readonly<{registrySha256:string;schemaVersion:1;snapshot:Readonly<Record<string,unknown>>;snapshotSha256:string}>;
export declare function resolveProductSessionGatewayRuntimePaths(environment:Readonly<Record<string,string|undefined>>,defaults:Readonly<{defaultRegistryPath:string;gatewayStatePath:string}>):Readonly<{registryPath:string;statePath:string}>;
export declare const PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2:"x-ynx-product-session-proof-v2";
export declare const PRODUCT_SESSION_GATEWAY_NATIVE_CHAIN_ID:"ynx_6423-1";
export declare class ProductSessionGatewayFetchAdapter{constructor(config:Readonly<{endpoint:string;fetch:(url:string,init:Readonly<Record<string,unknown>>)=>Promise<unknown>;walletInstalled:()=>boolean|Promise<boolean>;schemeRegistered:()=>boolean|Promise<boolean>;timeoutMs:number}>);walletInstalled():Promise<boolean>;schemeRegistered():Promise<boolean>;challenge(input:Readonly<Record<string,unknown>>):Promise<Readonly<Record<string,unknown>>>;complete(input:Readonly<Record<string,unknown>>):Promise<Readonly<Record<string,unknown>>>;introspect(input:Readonly<Record<string,unknown>>):Promise<Readonly<Record<string,unknown>>>;revoke(input:Readonly<Record<string,unknown>>):Promise<Readonly<Record<string,unknown>>>;}
export declare function decodeProductSessionGatewayProofHeaderV2(value:unknown):Readonly<Record<string,unknown>>;
export declare function encodeProductSessionGatewayProofHeaderV2(value:unknown):string;
export declare const PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES:1048576;
export declare class ProductSessionGatewayHttpHandler{constructor(registry:unknown,tokenFactory:()=>string,snapshot?:unknown);handle(input:Readonly<{requestId:string;method:string;path:string;contentType:string;body:string;proofHeader:string|null;networkAvailable:boolean}>,at?:Date):Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string}>;snapshot():Readonly<Record<string,unknown>>;}
export declare class PersistentProductSessionGatewayNodeHost{constructor(registry:unknown,options:Readonly<{statePath:string;now?:()=>Date;tokenFactory?:()=>string}>);handler():(request:unknown,response:unknown)=>Promise<void>;snapshot():Readonly<Record<string,unknown>>;}
export declare function createSignedIntent(input:Readonly<Record<string,unknown>&{accountSecret:string}>):Readonly<Record<string,unknown>>;
export declare function parseSignedIntent(input:unknown):Readonly<Record<string,unknown>>;
export declare function signedIntentDigest(input:unknown):string;
export declare function exportSignedIntent(input:unknown):string;
export declare function assertSignedIntentActive(input:unknown,context:Readonly<Record<string,unknown>>,at?:Date):Readonly<Record<string,unknown>>;
export declare function createProductSessionProof(session:CentralWalletSession,input:Readonly<{method:string;path:string;bodyDigest:string;nonce:string;issuedAt:string;expiresAt:string}>,productDeviceSecret:string):Readonly<Record<string,unknown>>;
export declare function parseProductSessionProof(input:unknown):Readonly<Record<string,unknown>>;
export declare function productSessionProofSignBytes(input:unknown):string;
export declare function productSessionProofDigest(input:unknown):string;
export declare function httpBodyDigest(body:string|Uint8Array):string;
export declare function verifyProductSessionProof(proof:unknown,session:CentralWalletSession,expected:Readonly<{method:string;path:string;bodyDigest:string}>,at?:Date):Readonly<Record<string,unknown>>;
export declare const CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION:2;
export declare class CanonicalWalletGatewayAdapter{constructor(registry:unknown,snapshot?:unknown);complete(input:Readonly<Record<string,unknown>>,at?:Date):CentralWalletSession;introspect(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):Readonly<{active:true;session:CentralWalletSession}>;sessionInventory(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):CentralWalletSessionInventory;revokeSession(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):string;revokeApproval(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):string;revokeDevice(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):string;logoutAllDevices(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):Readonly<{account:string;before:string}>;activateMandate(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):Readonly<Record<string,unknown>>;authorizeMandateAction(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):Readonly<Record<string,unknown>>;mandateInventory(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):readonly Readonly<Record<string,unknown>>[];revokeMandate(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):string;killMandate(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):string;emergencyExitMandate(input:Readonly<Record<string,unknown>>,request:Readonly<Record<string,unknown>>,at?:Date):Readonly<Record<string,unknown>>;snapshot():Readonly<Record<string,unknown>>}
export declare function parseGatewayAdapterSnapshot(input:unknown,registryVersion:number):Readonly<Record<string,unknown>>;
export declare const CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION:1;
export declare const CANONICAL_GATEWAY_HTTP_MAX_BODY_BYTES:1048576;
export type CanonicalGatewayHttpInput=Readonly<{method:string;path:string;contentType:string;body:string;proof:Readonly<Record<string,unknown>>|null}>;
export type CanonicalGatewayHttpResponse=Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string;mutated:boolean}>;
export declare class CanonicalWalletGatewayHttpKernel{constructor(registry:unknown,snapshot?:unknown);dispatch(input:CanonicalGatewayHttpInput,at?:Date):CanonicalGatewayHttpResponse;snapshot():Readonly<Record<string,unknown>>;}
export declare function gatewayStateDigest(snapshot:unknown):string;

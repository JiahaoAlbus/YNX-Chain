export interface YNXNetworkMetadata {
  readonly chainId: "0x1917";
  readonly chainIdDecimal: 6423;
  readonly chainName: "YNX Testnet";
  readonly nativeCurrency: Readonly<{ name: "YNXT"; symbol: "YNXT"; decimals: 18 }>;
  readonly rpcUrls: readonly string[];
  readonly restUrls: readonly string[];
  readonly blockExplorerUrls: readonly string[];
  readonly faucetUrls: readonly string[];
  readonly infoUrl: string;
}

export interface EIP1193Provider { request(input: { method: string; params?: unknown[] }): Promise<unknown> }
export interface FetchOptions { timeoutMs?: number; fetchImpl?: typeof fetch; id?: string | number; signal?: AbortSignal }
export interface YNXStatus { chainId: number; nativeCurrencySymbol: string; publicNetwork: boolean; height: number; [key: string]: unknown }
export interface YNXSnapshot { status: YNXStatus; evmChainId: string; evmBlockHex: string; evmBlockNumber: number }

export declare const ynxTestnet: YNXNetworkMetadata;
export declare const ynxPublicEndpoints: Readonly<{
  authorityCommit: "d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59";
  authoritySha256: "d344c607c2bbbf7bb0d9d3662b424976d0d6c4ff20428025dd1e2fb92bf31392";
  rpcUrl: "https://rpc.ynxweb4.com/evm";
  restUrl: "https://rest.ynxweb4.com";
  faucetUrl: "https://faucet.ynxweb4.com";
  websiteUrl: "https://www.ynxweb4.com/dapp/wallet";
  explorerUrl: "https://explorer.ynxweb4.com";
  walletCallbackUrl: null;
  allRequiredServicesAvailable: false;
  allRequiredServicesCorsReady: false;
  integratedCentral: false;
}>;
export declare class YNXSDKError extends Error { readonly status?: number; readonly code?: string; readonly rpcCode?: number }
export declare const ynxErrorCodes: Readonly<{
  accountNotFound: "ACCOUNT_NOT_FOUND";
  httpError: "HTTP_ERROR";
  malformedResponse: "MALFORMED_RESPONSE";
  jsonRPCError: "JSON_RPC_ERROR";
  rpcUnavailable: "RPC_UNAVAILABLE";
  transportCancelled: "TRANSPORT_CANCELLED";
  transportTLS: "TRANSPORT_TLS";
  transportTimeout: "TRANSPORT_TIMEOUT";
  wrongChain: "WRONG_CHAIN";
}>;
export declare function redactYNXSDKError(error: unknown): Readonly<{name: "YNXSDKError"; code: string; status?: number; rpcCode?: number}>;
export declare function classifyYNXHTTPFailure(status: number, data: unknown, options?: {accountLookup?: boolean}): "ACCOUNT_NOT_FOUND" | "HTTP_ERROR" | "RPC_UNAVAILABLE";
export declare class YNXWalletError extends Error { readonly code?: number | string; readonly method?: string }
export declare function toYNXAddress(value: string): string;
export declare function toEVMAddress(value: string): string;
export declare function normalizeYNXAddress(value: string): Readonly<{ evmAddress: string; ynxAddress: string }>;
export declare function getYNXStatus(baseUrl: string, options?: FetchOptions): Promise<YNXStatus>;
export declare function callYNXEVM(evmUrl: string, method: string, params?: unknown[], options?: FetchOptions): Promise<unknown>;
export declare function proveYNXTestnetRPC(evmUrl?: string, options?: FetchOptions): Promise<Readonly<{ chainId: "0x1917"; connected: true; network: "YNX Testnet"; rpc: string }>>;
export declare function assertYNXTestnetSnapshot(snapshot: YNXSnapshot, options?: { maximumHeightLag?: number }): YNXSnapshot;
export declare function ynxTestnetAddEthereumChainParameter(): object;
export declare function ensureYNXTestnet(provider: EIP1193Provider): Promise<Readonly<{ added: boolean; chainId: string; switched: boolean }>>;
export declare class YNXClient {
  constructor(options: { restUrl: string; evmUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch });
  getStatus(): Promise<YNXStatus>;
  callEVM(method: string, params?: unknown[]): Promise<unknown>;
  getChainSnapshot(): Promise<YNXSnapshot>;
}

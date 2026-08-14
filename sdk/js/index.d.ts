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
export interface FetchOptions { timeoutMs?: number; fetchImpl?: typeof fetch; id?: string | number }
export interface YNXStatus { chainId: number; nativeCurrencySymbol: string; publicNetwork: boolean; height: number; [key: string]: unknown }
export interface YNXSnapshot { status: YNXStatus; evmChainId: string; evmBlockHex: string; evmBlockNumber: number }

export declare const ynxTestnet: YNXNetworkMetadata;
export declare class YNXSDKError extends Error { readonly status?: number; readonly code?: number | string }
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

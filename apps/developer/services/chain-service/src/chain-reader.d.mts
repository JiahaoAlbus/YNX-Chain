export const CHAIN_PROTOCOL: 'ynx-code-chain/v1';
export const TESTNET_CHAIN_ID: 6423;
export const READ_RPC_METHODS: readonly string[];
export function validateChainStatus(value: unknown): any;
export function validateReadRpc(value: unknown): void;
export function validateChainTransaction(value: unknown, hash: string): any;
export type ChainReadOptions = { signal?: AbortSignal };
export function createChainReader(request: (path: string, options?: { method?: string; body?: string; signal?: AbortSignal }) => Promise<any>): {
  status(options?: ChainReadOptions): Promise<any>;
  compiler(options?: ChainReadOptions): Promise<any>;
  rpc(method: string, params?: unknown[], options?: ChainReadOptions): Promise<any>;
  transaction(hash: string, options?: ChainReadOptions): Promise<any>;
  block(id: string, options?: ChainReadOptions): Promise<any>;
};

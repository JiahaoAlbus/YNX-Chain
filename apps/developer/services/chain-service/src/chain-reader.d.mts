export const CHAIN_PROTOCOL: 'ynx-code-chain/v1';
export const TESTNET_CHAIN_ID: 6423;
export const READ_RPC_METHODS: readonly string[];
export function validateChainStatus(value: unknown): any;
export function validateReadRpc(value: unknown): void;
export function validateChainTransaction(value: unknown, hash: string): any;
export function createChainReader(request: (path: string, options?: { method: string; body: string }) => Promise<any>): {
  status(): Promise<any>;
  compiler(): Promise<any>;
  rpc(method: string, params?: unknown[]): Promise<any>;
  transaction(hash: string): Promise<any>;
  block(id: string): Promise<any>;
};

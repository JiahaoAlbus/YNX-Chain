import type { Address, Quote, VaultState, VaultTransactionRequest } from "./index.js";

export interface StableVaultSubmission {
  status: "submitted-unconfirmed";
  source: "caller-supplied YNX limited-engine transport";
  asOf: string;
  version: "ynx-stable-vault-submission-v1";
  failure: null;
  provider: string;
  transactionHash: `0x${string}`;
  vault: Address;
  nonceDomain: `0x${string}`;
  actionNonce: string;
  requestDigest: `0x${string}`;
  method: string;
}

export declare function buildVaultStableSwapExactInputTx(input: {
  state: unknown;
  quote: Quote;
  slippageBps: number;
  deadline: number;
  now?: Date;
}): VaultTransactionRequest;

export declare function buildVaultStableSwapExactOutputTx(input: {
  state: unknown;
  quote: Quote;
  slippageBps: number;
  deadline: number;
  now?: Date;
}): VaultTransactionRequest;

export declare function buildVaultStableAddLiquidityTx(input: {
  state: unknown;
  pool: Address;
  amount0: bigint | string;
  amount1: bigint | string;
  minLiquidity: bigint | string;
  deadline: number;
  now?: Date;
}): VaultTransactionRequest;

export declare function buildVaultStableRemoveLiquidityTx(input: {
  state: unknown;
  pool: Address;
  liquidity: bigint | string;
  amount0Min: bigint | string;
  amount1Min: bigint | string;
  deadline: number;
  now?: Date;
}): VaultTransactionRequest;

export declare function submitApprovedStableVaultRequest(input: {
  request: VaultTransactionRequest;
  approval: Record<string, unknown>;
  sendTransaction: (request: VaultTransactionRequest) => Promise<Record<string, unknown>>;
  now?: Date;
}): Promise<Readonly<StableVaultSubmission>>;

export declare function parseIndexedStableVaultAction(value: unknown): Readonly<Record<string, unknown>>;
export declare function reconcileIndexedStableVaultAction(input: {
  request: VaultTransactionRequest;
  action: unknown;
}): Readonly<Record<string, unknown>>;

export type { Address, Quote, VaultState, VaultTransactionRequest };

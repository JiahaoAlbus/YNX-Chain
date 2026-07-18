export type Address = `0x${string}`;
export interface Token { address: Address; chainId: 6423; decimals: number; name: string; symbol: string; verified: boolean }
export interface Pool { address: Address; feeBps: number; reserve0: bigint | string; reserve1: bigint | string; token0: Token; token1: Token; updatedAt: string }
export interface QuoteStep { pool: Address; tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint; reserveIn: bigint; reserveOut: bigint; feeBps: number }
export interface Quote { kind: "exact-input" | "exact-output"; amountIn: bigint; amountOut: bigint; path: readonly Address[]; steps: readonly QuoteStep[]; quotedAt: string }
export interface TransactionRequest { chainId: 6423; to: Address; functionName: string; args: readonly unknown[]; value: "0" }
export declare class DexSdkError extends Error { code: string }
export declare const MAX_HOPS: 4;
export declare function parseToken(value: unknown): Readonly<Token>;
export declare function parsePool(value: unknown): Readonly<Pool & { reserve0: bigint; reserve1: bigint }>;
export declare function amountOut(amountIn: bigint | string, reserveIn: bigint | string, reserveOut: bigint | string, feeBps?: number): bigint;
export declare function amountIn(amountOut: bigint | string, reserveIn: bigint | string, reserveOut: bigint | string, feeBps?: number): bigint;
export declare function quoteExactInput(input: { amountIn: bigint | string; tokenIn: Address; tokenOut: Address; pools: Pool[]; maxHops?: number; now?: Date }): Readonly<Quote>;
export declare function quoteExactOutput(input: { amountOut: bigint | string; tokenIn: Address; tokenOut: Address; pools: Pool[]; maxHops?: number; now?: Date }): Readonly<Quote>;
export declare function minimumOutput(amount: bigint | string, slippageBps: number): bigint;
export declare function maximumInput(amount: bigint | string, slippageBps: number): bigint;
export declare function priceImpactBps(quote: Quote): number;
export declare function assertFreshQuote(quote: Quote, options?: { now?: Date; maxAgeMs?: number }): Quote;
export declare function buildSwapExactInputTx(input: Record<string, unknown>): TransactionRequest;
export declare function buildSwapExactOutputTx(input: Record<string, unknown>): TransactionRequest;
export declare function buildAddLiquidityTx(input: Record<string, unknown>): TransactionRequest;
export declare function buildRemoveLiquidityTx(input: Record<string, unknown>): TransactionRequest;

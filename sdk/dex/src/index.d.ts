export type Address = `0x${string}`;
export interface Token { address: Address; chainId: 6423; decimals: number; name: string; symbol: string; verified: boolean }
export interface Pool { address: Address; feeBps: number; reserve0: bigint | string; reserve1: bigint | string; token0: Token; token1: Token; updatedAt: string }
export interface QuoteStep { pool: Address; tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint; reserveIn: bigint; reserveOut: bigint; feeBps: number }
export interface Quote { kind: "exact-input" | "exact-output"; amountIn: bigint; amountOut: bigint; path: readonly Address[]; steps: readonly QuoteStep[]; quotedAt: string }
export interface TransactionRequest { chainId: 6423; to: Address; functionName: string; args: readonly unknown[]; value: "0" }
export interface Position { account: string; pool: Address; netLpAmount: string; addedToken0: string; addedToken1: string; removedToken0: string; removedToken1: string }
export interface SpotPrice { pool:Address;token0:Address;token1:Address;price0Numerator:string;price0Denominator:string;price1Numerator:string;price1Denominator:string;updatedBlock:number }
export interface TWAP { pool:Address;token0:Address;token1:Address;price0AverageX112:string;price1AverageX112:string;intervalSeconds:number;fromBlock:number;toBlock:number }
export interface FeeSummary { pool:Address;token0:Address;token1:Address;swapFee0:string;swapFee1:string;claimedFee0:string;claimedFee1:string }
export declare class DexSdkError extends Error { code: string }
export declare const MAX_HOPS: 4;
export declare function parseToken(value: unknown): Readonly<Token>;
export declare function parsePool(value: unknown): Readonly<Pool & { reserve0: bigint; reserve1: bigint }>;
export declare function parsePosition(value: unknown): Readonly<Position>;
export declare function parseSpotPrice(value: unknown): Readonly<SpotPrice>;
export declare function parseTWAP(value: unknown): Readonly<TWAP>;
export declare function parseFeeSummary(value: unknown): Readonly<FeeSummary>;
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

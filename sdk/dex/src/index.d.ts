export type Address = `0x${string}`;
export interface Token { address: Address; chainId: 6423; decimals: number; name: string; symbol: string; verified: boolean }
export interface Pool { address: Address; feeBps: number; reserve0: bigint | string; reserve1: bigint | string; token0: Token; token1: Token; updatedAt: string }
export interface QuoteStep { pool: Address; tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint; reserveIn: bigint; reserveOut: bigint; feeBps: number }
export interface Quote { kind: "exact-input" | "exact-output"; amountIn: bigint; amountOut: bigint; path: readonly Address[]; steps: readonly QuoteStep[]; quotedAt: string }
export interface TransactionRequest { chainId: 6423; to: Address; functionName: string; args: readonly unknown[]; value: "0" }
export interface VaultMandate { maxVaultValue:bigint;maxTradeValue:bigint;maxGasPrice:bigint;expiresAt:bigint;minActionInterval:bigint;oracleMaxAge:bigint;maxSlippageBps:bigint;maxImpactBps:bigint;maxDailyLossBps:bigint;maxDrawdownBps:bigint;depegToleranceBps:bigint;performanceFeeBps:0n;feeAsset:Address;feeRecipient:Address }
export interface VaultState { chainId:6423;vault:Address;owner:Address;engine:Address;router:Address;oracle:Address;nonceDomain:`0x${string}`;actionNonce:bigint;configured:boolean;paused:boolean;revoked:boolean;killed:boolean;mandate:Readonly<VaultMandate>;source:"YNX Testnet EVM RPC";asOf:string;version:"ynx-strategy-vault-v1";failure:null }
export interface VaultTransactionRequest extends TransactionRequest { executor:Address;authority:"owner"|"limited-engine-session";approvalRequired:true;nonceDomain:`0x${string}`;sourceStateAsOf:string }
export interface VaultReconciliation { source:"confirmed YNX Testnet EVM receipt";asOf:string;version:"ynx-vault-reconciliation-v1";coverage:string;confidence:"confirmed-on-chain";failure:null;transactionHash:`0x${string}`;blockNumber:number;confirmations:number;vault:Address;nonceDomain:`0x${string}`;actionNonce:string;method:string;beforeValue:string;afterValue:string }
export interface IndexedVaultAction { vault:Address;nonceDomain:`0x${string}`;actionNonce:string;method:string;methodSelector:`0x${string}`;beforeValue:string;afterValue:string;transactionHash:`0x${string}`;blockHash:`0x${string}`;blockNumber:number;logIndex:number;asOf:string;source:"confirmed YNX Testnet EVM logs";version:"ynx-vault-action-v1";confidence:"confirmed-on-chain";coverage:string;failure:null }
export interface ExecutionSnapshot { chainId:6423;vault:Address;source:"YNX Testnet RPC + owner-reviewed oracle";version:"ynx-execution-snapshot-v1";confidence:"preflight-observed";coverage:string;failure:null;asOf:string;gas:{estimatedGas:bigint;gasPrice:bigint;estimatedFeeNative:bigint;provider:string};fees:{hiddenSpreadBps:0;performanceFeeBps:0;protocolFeeShareBps:number;venueFeeBps:number};oracle:{address:Address;deviationBps:number;updatedAt:string};risk:{dailyLossBps:number;drawdownBps:number;priceImpactBps:number;slippageBps:number;tradeValue:bigint;vaultValue:bigint} }
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
export declare function parseVaultState(value: unknown): Readonly<VaultState>;
export declare function assertExecutableVaultState(state: unknown, options?: { now?:Date;maxAgeMs?:number }): Readonly<VaultState>;
export declare function buildVaultSwapExactInputTx(input: Record<string, unknown>): VaultTransactionRequest;
export declare function buildVaultSwapExactOutputTx(input: Record<string, unknown>): VaultTransactionRequest;
export declare function buildVaultAddLiquidityTx(input: Record<string, unknown>): VaultTransactionRequest;
export declare function buildVaultRemoveLiquidityTx(input: Record<string, unknown>): VaultTransactionRequest;
export declare function parseExecutionSnapshot(value:unknown,options:{state:unknown;now?:Date;maxAgeMs?:number}):Readonly<ExecutionSnapshot>;
export declare function attributeQuoteFees(input:{quote:Quote;protocolFeeShareBps:number}):Readonly<Record<string,unknown>>;
export declare function describePoolFeeCollection(input:{poolType:string}):Readonly<Record<string,unknown>>;
export declare function buildVaultCollectFeesTx(input:{poolType:string}):never;
export declare function buildVaultCompoundTx(input:Record<string,unknown>):VaultTransactionRequest;
export declare function buildVaultRebalancePlan(input:{state:unknown;remove:Record<string,unknown>;target:{tokenA:Address;tokenB:Address};now?:Date}):Readonly<Record<string,unknown>>;
export declare function buildPauseVaultTx(input: Record<string, unknown>): VaultTransactionRequest;
export declare function buildEmergencyExitTx(input: Record<string, unknown>): VaultTransactionRequest;
export declare function reconcileVaultAction(input: Record<string, unknown>): Readonly<VaultReconciliation>;
export declare function parseIndexedVaultAction(value:unknown):Readonly<IndexedVaultAction>;
export declare function reconcileIndexedVaultAction(input:Record<string,unknown>):Readonly<Record<string,unknown>>;
export declare function digestVaultRequest(request: VaultTransactionRequest): Promise<`0x${string}`>;
export declare function submitApprovedVaultRequest(input: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;

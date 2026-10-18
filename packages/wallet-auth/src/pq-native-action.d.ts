/** Public complete signing DATA only; syntax never proves business authority. */
export const PQ_NATIVE_ACTION_DOMAIN:'YNX-NATIVE-ACTION/v1';
export const PQ_NATIVE_ACTION_MAX_BYTES:8192;
export const PQ_NATIVE_ACTION_MAX_PAYLOAD_BYTES:4096;
export type PQNativeActionU64=string|bigint;
export interface PQNativeActionPayloadMap {
 stake:{amount:PQNativeActionU64};
 resource_delegation_create:{provider:string;beneficiary:string;amountYNXT:PQNativeActionU64;policyHash:string;idempotencyKey:string;requestHash:string};
 resource_rental_create:{address:string;provider:string;bandwidth:PQNativeActionU64;compute:PQNativeActionU64;aiCredits:PQNativeActionU64;trustCredits:PQNativeActionU64;quoteID:string;quoteExpiresAt:string;policyHash:string;maxPriceYNXT:PQNativeActionU64;idempotencyKey:string;requestHash:string};
 dex_asset_create:{assetID:string;symbol:string;name:string;decimals:number;maxSupply:PQNativeActionU64;initialSupply:PQNativeActionU64};
 dex_asset_mint:{assetID:string;amount:PQNativeActionU64};dex_asset_transfer:{assetID:string;recipient:string;amount:PQNativeActionU64};
 dex_pool_create:{poolID:string;asset0:string;asset1:string;feeBps:number};
 dex_liquidity_add:{poolID:string;amount0:PQNativeActionU64;amount1:PQNativeActionU64;minShares:PQNativeActionU64;deadlineUnix:PQNativeActionU64};
 dex_liquidity_remove:{poolID:string;shares:PQNativeActionU64;minAmount0:PQNativeActionU64;minAmount1:PQNativeActionU64;deadlineUnix:PQNativeActionU64};
 dex_swap_exact_input:{poolID:string;assetIn:string;amountIn:PQNativeActionU64;minAmountOut:PQNativeActionU64;deadlineUnix:PQNativeActionU64};
 dex_swap_exact_output:{poolID:string;assetOut:string;amountOut:PQNativeActionU64;maxAmountIn:PQNativeActionU64;deadlineUnix:PQNativeActionU64};
 contract_deploy:{name:'SampleEVMWriteCounter'|'SampleYNXTCompatibleERC20';sourceHash:string;deployedBytecodeHash:string;compilerConfigHash:string;constructorArgs:readonly [PQNativeActionU64];value:PQNativeActionU64};
 contract_execute:{name:'SampleEVMWriteCounter'|'SampleYNXTCompatibleERC20';target:string;sourceHash:string;deployedBytecodeHash:string;compilerConfigHash:string;expectedStorageCommitment:string;calldata:string;value:PQNativeActionU64};
 stake_delegate:{validator:string;amountYNXT:PQNativeActionU64};stake_unbond:{delegationID:string;amountYNXT:PQNativeActionU64};stake_withdraw:{unbondingID:string};
}
export type PQNativeActionKind=keyof PQNativeActionPayloadMap;
type NormalizedField<T>=T extends readonly [PQNativeActionU64]?readonly [string]:T extends number?number:T extends PQNativeActionU64?string:never;
export type PQNativeActionPayload<K extends PQNativeActionKind>=Readonly<{[P in keyof PQNativeActionPayloadMap[K]]:NormalizedField<PQNativeActionPayloadMap[K][P]>}>;
export type PQNativeActionInput<K extends PQNativeActionKind=PQNativeActionKind>={ [P in K]:Readonly<{chainId:string;nativeChainId:PQNativeActionU64;owner:string;nonce:PQNativeActionU64;fee:PQNativeActionU64;kind:P;payload:Readonly<PQNativeActionPayloadMap[P]>}>}[K];
export type PQNativeAction<K extends PQNativeActionKind=PQNativeActionKind>={ [P in K]:Readonly<{chainId:string;nativeChainId:string;owner:string;nonce:string;fee:string;kind:P;payload:PQNativeActionPayload<P>}>}[K];
export function normalizePQNativeAction<K extends PQNativeActionKind>(input:PQNativeActionInput<K>):PQNativeAction<K>;
export function encodePQNativeAction(input:PQNativeActionInput):Uint8Array;
export function decodePQNativeAction(wire:Uint8Array):PQNativeAction;
export function encodePQNativeActionPayload<K extends PQNativeActionKind>(kind:K,payload:Readonly<PQNativeActionPayloadMap[K]>):Uint8Array;
export function decodePQNativeActionPayload<K extends PQNativeActionKind>(kind:K,wire:Uint8Array):PQNativeActionPayload<K>;

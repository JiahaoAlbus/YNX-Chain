export type Pool = { address:string; token0:string; token1:string; reserve0:string; reserve1:string; contractVersion:string; updatedBlock:number; updatedAt:string };
export type Position = { account:string; pool:string; netLpAmount:string; addedToken0:string; addedToken1:string; removedToken0:string; removedToken1:string };
export type ChainEvent = { id:string; type:string; pool:string; account:string; amount0:string; amount1:string; fee0:string; fee1:string; blockNumber:number; txHash:string; timestamp:string };
export type Analytics = { source:string; indexedEvents:number; pools:number; swaps:number; liquidityEvents:number; latestBlock:number };
export type Loadable<T> = { state:"loading" } | { state:"ready"; data:T; stale:boolean } | { state:"error"; message:string };
export type Locale = "en"|"zh-CN"|"zh-TW"|"ja"|"ko"|"es"|"fr"|"de"|"pt"|"ru"|"ar"|"id";
